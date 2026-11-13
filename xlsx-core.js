// Azure DevOps Excel Preview – 工作簿（.xlsx）轉主題化的唯讀預覽文件（content script 與 Tampermonkey 共用）
// 解析用 SheetJS（vendor/xlsx.full.min.js 的全域 XLSX）；輸出完整 HTML 文件，
// 內嵌（blob 文件、<script> 補頁面 CSP nonce）與全螢幕（sandbox 頁、nonce 為空）共用同一份。
// 樣式資料來源（SheetJS 社區版只把 fill 放進 cell.s，其餘樣式在 wb.Styles 但不帶每格的 xf 索引）：
// 值與顯示文字、合併、欄寬、列高 → SheetJS；每格的 xf 索引 → 直接掃 xlsx（ZIP）內的 sheet XML（s="N" 屬性）；
// 字型／填色／對齊 → wb.Styles（Fonts / Fills / CellXf）；佈景主題色 → wb.Themes（索引順序 lt1, dk1, lt2, dk2, accent1–6…）。
// 唯讀預覽範圍：多工作表頁籤、儲存格顯示值（含數字格式）、基本樣式（粗體／斜體／底線／刪除線／字色／底色／
// 對齊／自動換行／字級）、合併儲存格、欄寬、列高、凍結窗格、欄字母與列號標頭。
// 不支援（已知限制）：圖片、圖表、樞紐分析、篩選、公式（顯示快取值）、富文字多段格式（取顯示文字）。
(function (root) {
  'use strict';

  const MAX_ROWS = 5000;      // 單一工作表最多顯示的列數
  const MAX_COLS = 4096;      // 單一工作表最多顯示的欄數
  const CELL_BUDGET = 60000;  // 單一工作表的儲存格預算（避免巨大表格把預覽文件撐爆）
  const GUTTER_W = 48;        // 列號欄寬 px
  const HEAD_H = 26;          // 欄字母標頭列高 px
  const DEFAULT_COL = 64;     // 未指定欄寬時的預設寬 px（Excel 預設欄寬 8.43 字元）
  const DEFAULT_ROW = 22;     // 未指定列高時的預設高 px

  // theme 色的索引順序（注意 lt/dk 交錯）：0:lt1 1:dk1 2:lt2 3:dk2 4–9:accent1–6 10:hlink 11:folHlink
  const THEME_INDEX = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  // 讀不到檔案內建 theme 時的近似值（Office 預設佈景主題）
  const OFFICE_THEME = ['#ffffff', '#000000', '#eeece1', '#1f497d', '#4f81bd', '#c0504d', '#9bbb59', '#8064a2', '#4bacc6', '#f79646', '#0000ff', '#800080'];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 放進 <script> 的 JSON：跳脫 '<'，字串裡的 </script> 或 <!-- 不會提早結束 / 改變 script 的解析
  const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

  // 表格層的預設儲存格配色（沒有樣式的格子吃這條；inline 樣式優先）：值來自檔案，深淺色建置完全一致
  function cellBaseCss(model) {
    const safe = (c, d) => (/^#[0-9a-f]{6}$/.test(c || '') ? c : d);
    const fg = safe(model.defaultFg, '#000000'), bg = safe(model.defaultBg, '#ffffff');
    return '.xs-grid{background:' + bg + '}.xs-grid td{color:' + fg + ';background:' + bg + '}';
  }

  // 欄索引轉欄字母：0→A、25→Z、26→AA
  function colName(i) {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  // ---------------------------------------------------------------------------
  // 解析：ArrayBuffer → 模型（每格已備好顯示文字與 inline 樣式）
  // ---------------------------------------------------------------------------
  function parse(arrayBuffer) {
    const XLSX = root.XLSX;
    if (!XLSX) throw new Error('SheetJS（vendor/xlsx.full.min.js）尚未載入');
    const wb = XLSX.read(arrayBuffer, { type: 'array', cellStyles: true, cellNF: true, cellText: true, cellDates: false });
    const theme = themePalette(wb);
    const extras = rawSheetExtras(XLSX, arrayBuffer);
    // 色盤與填色：SheetJS 對 indexed 色的 rgb 會掉前導零（紅 FF0000 → 'ff00'）、indexed 填色則整個丟掉，
    // 所以 indexed 一律查色盤（檔案自訂的 <indexedColors> 優先），填色以 styles.xml 掃描結果為準
    const ctx = { theme, palette: extras.palette || INDEXED, fills: extras.fills || null };
    const styles = wb.Styles || {};
    // 工作表對應：以 workbook.xml + workbook.xml.rels 解析的「工作表名稱 → sheet XML」為準，退回同順序
    const sheets = wb.SheetNames.map((name, i) =>
      parseSheet(XLSX, wb.Sheets[name] || {}, name, ctx, styles, extras.byName.get(name) || extras.list[i]));
    // 沒有儲存格資料（或無樣式）的格子用的預設配色：xf 0 的字色 / 填色，否則 dk1 / lt1——同樣是紙張語意，跟著檔案
    const base = defaultColors(styles, ctx);
    return { sheets, defaultFg: base.fg, defaultBg: base.bg };
  }

  // Excel 預設的 indexed 色盤（0–63；64 = 系統前景、65 = 系統背景，視同未指定）
  const INDEXED = [
    '000000', 'ffffff', 'ff0000', '00ff00', '0000ff', 'ffff00', 'ff00ff', '00ffff',
    '000000', 'ffffff', 'ff0000', '00ff00', '0000ff', 'ffff00', 'ff00ff', '00ffff',
    '800000', '008000', '000080', '808000', '800080', '008080', 'c0c0c0', '808080',
    '9999ff', '993366', 'ffffcc', 'ccffff', '660066', 'ff8080', '0066cc', 'ccccff',
    '000080', 'ff00ff', 'ffff00', '00ffff', '800080', '800000', '008080', '0000ff',
    '00ccff', 'ccffff', 'ccffcc', 'ffff99', '99ccff', 'ff99cc', 'cc99ff', 'ffcc99',
    '3366ff', '33cccc', '99cc00', 'ffcc00', 'ff9900', 'ff6600', '666699', '969696',
    '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
  ].map((h) => '#' + h);

  // rgb / argb 字串 → #rrggbb；長度不是 6 或 8 的視為無效（不輸出 3–5 位數的 hex：CSS 會讀成 #RGB / #RGBA）
  function hexOf(rgb) {
    const s = String(rgb == null ? '' : rgb).replace(/^#/, '');
    if (!/^[0-9a-f]+$/i.test(s) || (s.length !== 6 && s.length !== 8)) return null;
    return '#' + s.slice(-6).toLowerCase();
  }

  function defaultColors(styles, ctx) {
    const xf0 = (styles.CellXf || [])[0] || {};
    const f0 = (styles.Fonts || [])[xf0.fontId || 0] || {};
    const fill0 = ctx.fills ? ctx.fills[xf0.fillId || 0] : null;
    return {
      fg: colorCss(f0.color, ctx) || ctx.theme[1] || '#000000',
      bg: (fill0 && fillCss(fill0, ctx)) || ctx.theme[0] || '#ffffff',
    };
  }

  // 檔案內建佈景主題的色盤（依 THEME_INDEX 順序）；讀不到就用 Office 預設色盤
  function themePalette(wb) {
    try {
      const scheme = wb && wb.Themes && wb.Themes.themeElements && wb.Themes.themeElements.clrScheme;
      if (!scheme) return OFFICE_THEME;
      const byName = {};
      if (Array.isArray(scheme)) {
        for (const e of scheme) if (e && e.name) byName[e.name] = e;
      } else {
        for (const k of Object.keys(scheme)) byName[k] = scheme[k];
      }
      const pick = (name) => {
        const e = byName[name] || {};
        const rgb = e.rgb || (e.srgbClr && (e.srgbClr.val || e.srgbClr)) || null;
        return hexOf(rgb);
      };
      const out = THEME_INDEX.map(pick);
      return out.every(Boolean) ? out : OFFICE_THEME;
    } catch (e) {
      return OFFICE_THEME;
    }
  }

  // 顏色物件（SheetJS 的 font.color / styles.xml 掃描到的 fgColor）→ CSS 顏色。
  // 優先序：theme（Excel 常同時給不可靠的預設 rgb）→ indexed（查色盤；SheetJS 給的 rgb 掉前導零不可用）→ rgb；
  // tint 依規格可套在任何一種上
  function colorCss(v, ctx) {
    if (!v) return null;
    const theme = ctx.theme;
    let base = null;
    if (v.theme != null) {
      base = theme[v.theme] != null ? theme[v.theme] : OFFICE_THEME[v.theme];
      if (!base) base = hexOf(v.rgb);
    } else if (v.index != null || v.indexed != null) {
      const idx = Number(v.index != null ? v.index : v.indexed);
      base = (ctx.palette || INDEXED)[idx] || null; // 64 / 65（系統前景 / 背景）＝未指定，交給預設值
    } else {
      base = hexOf(v.rgb);
    }
    if (!base) return null;
    return v.tint ? mixWithWhite(base, Number(v.tint)) : base.toLowerCase();
  }

  // styles.xml 掃描到的填色 → CSS 背景色；none / 無前景色 → null（交給預設的 lt1）
  function fillCss(fill, ctx) {
    if (!fill || !fill.patternType || fill.patternType === 'none') return null;
    return colorCss(fill.fgColor, ctx);
  }

  // Excel 的 tint（-1～1）：正數混白、負數混黑（近似）
  function mixWithWhite(hex, tint) {
    const n = parseInt(hex.slice(1), 16);
    const t = Math.max(-1, Math.min(1, tint));
    const mix = (c) => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t));
    const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  // 凍結窗格：SheetJS 各版本對 sheetView/pane 的暴露不一（實測 0.20.3 皆為 null），
  // 主要走 rawSheetExtras 的 ZIP 掃描（<pane topLeftCell="B2">＝第一個可捲動儲存格）
  function freezeOf(ws, fallback) {
    try {
      const f = ws['!freeze'] || (ws['!views'] && ws['!views'][0] && ws['!views'][0].pane) || null;
      if (typeof f === 'string') return freezeFromTopLeft(f);
      if (f && typeof f === 'object') {
        if (f.topLeftCell) return freezeFromTopLeft(f.topLeftCell);
        if (f.xSplit != null || f.ySplit != null) {
          return { cols: Math.max(0, Math.round(f.xSplit || 0)), rows: Math.max(0, Math.round(f.ySplit || 0)) };
        }
      }
    } catch (e) { /* 繼續用備援 */ }
    return fallback || { rows: 0, cols: 0 };
  }

  function freezeFromTopLeft(a1) {
    const m = /^([A-Z]+)(\d+)$/.exec(String(a1 || '').toUpperCase());
    if (!m) return { rows: 0, cols: 0 };
    let c = 0;
    for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
    return { rows: Math.max(0, parseInt(m[2], 10) - 1), cols: Math.max(0, c - 1) };
  }

  // XLSX.CFB.read 各環境吃的型別不一致（node 要 Buffer/Uint8Array、瀏覽器給 ArrayBuffer），
  // 逐一嘗試可用的組合；SheetJS 0.20.3 實測 ArrayBuffer+type:'array' 會丟例外
  function readCfb(XLSX, buf) {
    const views = [buf, new Uint8Array(buf)];
    for (const v of views) for (const type of ['buffer', 'array']) {
      try {
        const cfb = XLSX.CFB.read(v, { type });
        if (cfb && cfb.FullPaths && cfb.FileIndex) return cfb;
      } catch (e) { /* 換下一種組合 */ }
    }
    return null;
  }

  // 直接掃 xlsx（ZIP）內的 XML，取得 SheetJS 社區版不暴露的資料：
  //   - 每個工作表：凍結窗格（<pane topLeftCell="...">）與每格的樣式索引（<c r="A1" s="3"> → wb.Styles.CellXf）
  //   - styles.xml：填色清單（含 indexed 色；SheetJS 會丟掉）與檔案自訂的 indexed 色盤
  // 工作表 XML 依 xl/workbook.xml 的 <sheet name r:id> ＋ xl/_rels/workbook.xml.rels 的 Id → Target 解析
  // （內部檔名 sheetN 不一定等於頁籤順序：移動或刪除過工作表的檔案常見）；兩者讀不到時才退回 sheetN 編號
  function rawSheetExtras(XLSX, buf) {
    const out = { byName: new Map(), list: [], fills: null, palette: null };
    try {
      const cfb = readCfb(XLSX, buf);
      if (!cfb) return out;
      const dec = new TextDecoder('utf-8');
      const files = new Map(); // 小寫的 ZIP 內路徑（不含 Root Entry/）→ FileIndex 索引
      for (let i = 0; i < cfb.FullPaths.length; i++) {
        files.set(String(cfb.FullPaths[i]).replace(/^[^/]*\//, '').toLowerCase(), i);
      }
      const read = (p) => {
        const i = files.get(String(p).replace(/^\/+/, '').toLowerCase());
        const content = i != null && cfb.FileIndex[i] && cfb.FileIndex[i].content;
        return content ? dec.decode(content) : null;
      };

      const stylesXml = read('xl/styles.xml');
      if (stylesXml) Object.assign(out, parseStylesXml(stylesXml));

      const wbXml = read('xl/workbook.xml');
      const relsXml = read('xl/_rels/workbook.xml.rels');
      if (wbXml && relsXml) {
        const targets = new Map();
        for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
          const id = attr(m[0], 'Id'), target = attr(m[0], 'Target');
          if (id && target) targets.set(id, resolvePart('xl/', target));
        }
        for (const m of wbXml.matchAll(/<(?:[\w-]+:)?sheet\b[^>]*>/g)) {
          const name = xmlDecode(attr(m[0], 'name') || '');
          const rm = /\s[\w-]+:id=(?:"([^"]*)"|'([^']*)')/.exec(m[0]);
          const rid = rm ? (rm[1] != null ? rm[1] : rm[2]) : null;
          const xml = rid && targets.has(rid) ? read(targets.get(rid)) : null;
          const entry = xml ? sheetEntry(xml) : null;
          out.list.push(entry);
          if (entry && !out.byName.has(name)) out.byName.set(name, entry);
        }
      }
      if (!out.list.some(Boolean)) {
        // 備援：沒有 workbook / rels 時依 sheetN 編號對應順序
        out.list = [];
        for (const [p, i] of files) {
          const m = /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(p);
          const content = m && cfb.FileIndex[i] && cfb.FileIndex[i].content;
          if (content) out.list[parseInt(m[1], 10) - 1] = sheetEntry(dec.decode(content));
        }
      }
    } catch (e) { /* 讀不到就算了（樣式退回預設） */ }
    return out;
  }

  function sheetEntry(xml) {
    const entry = { freeze: null, xfs: new Map() };
    const pm = /<pane\b[^>]*topLeftCell=["']([A-Z]+\d+)["']/.exec(xml);
    if (pm) entry.freeze = freezeFromTopLeft(pm[1]);
    const re = /<c\b([^>]*)>/g;
    let cm;
    while ((cm = re.exec(xml))) {
      const attrs = cm[1];
      const rm = /\br=["']([A-Z]+\d+)["']/.exec(attrs);
      const sm = /\bs=["'](\d+)["']/.exec(attrs);
      if (rm && sm) entry.xfs.set(rm[1], parseInt(sm[1], 10));
    }
    return entry;
  }

  // styles.xml → { fills: [{ patternType, fgColor }], palette: 自訂 indexed 色盤或 null }
  function parseStylesXml(xml) {
    const colorOf = (tag) => {
      if (!tag) return null;
      const c = {};
      const theme = attr(tag, 'theme'), indexed = attr(tag, 'indexed'), rgb = attr(tag, 'rgb'), tint = attr(tag, 'tint');
      if (theme != null) c.theme = parseInt(theme, 10);
      if (indexed != null) c.index = parseInt(indexed, 10);
      if (rgb != null) c.rgb = rgb;
      if (tint != null) c.tint = parseFloat(tint);
      return Object.keys(c).length ? c : null;
    };
    let fills = null;
    const fm = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(xml);
    if (fm) {
      fills = [];
      for (const m of fm[1].matchAll(/<fill\b[^>]*?(?:\/>|>([\s\S]*?)<\/fill>)/g)) {
        const body = m[1] || '';
        const pf = /<patternFill\b[^>]*>/.exec(body);
        if (!pf) { fills.push(null); continue; } // gradientFill 等：交給 SheetJS 的 cell.s
        fills.push({ patternType: attr(pf[0], 'patternType') || 'none', fgColor: colorOf((/<fgColor\b[^>]*>/.exec(body) || [])[0]) });
      }
    }
    let palette = null;
    const im = /<indexedColors\b[^>]*>([\s\S]*?)<\/indexedColors>/.exec(xml);
    if (im) {
      const custom = [...im[1].matchAll(/<rgbColor\b[^>]*>/g)].map((m) => hexOf(attr(m[0], 'rgb')));
      if (custom.length) palette = INDEXED.map((d, i) => custom[i] || d);
    }
    return { fills, palette };
  }

  function attr(tag, name) {
    const m = new RegExp('\\s' + name + '=(?:"([^"]*)"|\'([^\']*)\')').exec(tag);
    return m ? (m[1] != null ? m[1] : m[2]) : null;
  }

  function xmlDecode(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      if (e[0] === '#') {
        const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
      }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
    });
  }

  // rels 的 Target（相對於 base 目錄，或以 / 開頭的絕對路徑）→ ZIP 內路徑
  function resolvePart(base, target) {
    const parts = (target.startsWith('/') ? target.slice(1) : base + target).split('/');
    const outParts = [];
    for (const p of parts) {
      if (p === '..') outParts.pop();
      else if (p && p !== '.') outParts.push(p);
    }
    return outParts.join('/');
  }

  function parseSheet(XLSX, ws, name, ctx, styles, extra) {
    const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } };
    const totalRows = Math.max(0, range.e.r - range.s.r + 1);
    const totalCols = Math.max(0, range.e.c - range.s.c + 1);
    const cols = Math.min(totalCols, MAX_COLS);
    // 儲存格預算：欄多的表格先收斂可見列數
    const rows = Math.min(totalRows, MAX_ROWS, cols > 0 ? Math.max(1, Math.floor(CELL_BUDGET / cols)) : 0);
    const r0 = range.s.r, c0 = range.s.c;

    // 欄寬 / 列高（SheetJS 的 !cols 給 wpx 或 wch；!rows 的 ht 單位是 pt，換算 px）
    const colWidths = [];
    for (let c = 0; c < cols; c++) {
      const spec = (ws['!cols'] || [])[c0 + c] || {};
      colWidths.push(spec.wpx || (spec.wch ? Math.round(spec.wch * 7) + 5 : DEFAULT_COL));
    }
    const rowHeights = [];
    for (let r = 0; r < rows; r++) {
      const spec = (ws['!rows'] || [])[r0 + r] || {};
      rowHeights.push(spec.hpt != null ? Math.round(spec.hpt * 4 / 3) : (spec.hpx || DEFAULT_ROW));
    }

    // 合併儲存格：轉成 {r, c, rs, cs}（以可見區左上為原點），並記下被覆蓋的格子
    const merges = [];
    const covered = new Set();
    for (const m of ws['!merges'] || []) {
      const r = m.s.r - r0, c = m.s.c - c0;
      const rs = Math.min(m.e.r, r0 + rows - 1) - m.s.r + 1;
      const cs = Math.min(m.e.c, c0 + cols - 1) - m.s.c + 1;
      if (r < 0 || c < 0 || rs <= 0 || cs <= 0) continue;
      merges.push({ r, c, rs, cs });
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) {
        if (i || j) covered.add((r + i) + ':' + (c + j));
      }
    }

    // 儲存格：顯示值用 SheetJS 的格式化文字（吃數字格式 / 日期）；樣式由 xf 索引 → wb.Styles 還原
    const cells = [];
    for (let r = 0; r < rows; r++) {
      const line = [];
      for (let c = 0; c < cols; c++) {
        const addr = XLSX.utils.encode_cell({ r: r0 + r, c: c0 + c });
        const cell = ws[addr];
        const xfRaw = extra ? extra.xfs.get(addr) : undefined;
        const empty = !cell || cell.t === 'z';
        // 沒有值的格子：有樣式（s 屬性非 0 或 SheetJS 帶了填色）就照樣式輸出（底色、字色、框都要保留），
        // 完全沒樣式才交給表格層的預設配色（省下大表裡大量空白格的 inline 樣式）
        if (empty && !xfRaw && !(cell && cell.s && cell.s.patternType && cell.s.patternType !== 'none')) { line.push(null); continue; }
        let text = '';
        if (!empty) {
          try { text = XLSX.utils.format_cell(cell); } catch (e) { text = cell.w != null ? String(cell.w) : String(cell.v == null ? '' : cell.v); }
        }
        const xfIdx = xfRaw || 0;
        line.push({ text: text == null ? '' : String(text), css: cellCss(cell || { t: 'z' }, (styles.CellXf || [])[xfIdx] || {}, styles, ctx) });
      }
      cells.push(line);
    }

    return {
      name,
      rows, cols, totalRows, totalCols, r0, c0,
      truncated: totalRows > rows || totalCols > cols,
      colWidths, rowHeights, merges, covered, cells,
      freeze: freezeOf(ws, extra && extra.freeze),
    };
  }

  // 儲存格樣式 → inline CSS（Excel 字級單位是 pt，換算 px；填色以 styles.xml 掃描為準、退回 SheetJS 的 cell.s）。
  // 顏色採「紙張語意」：未指定字色 = 檔案的 dk1（通常黑）、未指定底色 = 檔案的 lt1（紙面白），
  // 兩者都寫成顯式值——Excel 檔的樣式是設計過的固定配色，跟隨 App 深淺色主題會產生
  // 「淺色底＋主題白字」這種不可讀的組合（v0.2.11 修正的實測案例）
  function cellCss(cell, xf, styles, ctx) {
    const theme = ctx.theme;
    const f = (styles.Fonts || [])[xf.fontId || 0] || {};
    const a = xf.alignment || {};
    const out = [];
    if (f.bold) out.push('font-weight:600');
    if (f.italic) out.push('font-style:italic');
    if (f.strike) out.push('text-decoration:line-through');
    else if (f.underline || f.u) out.push('text-decoration:underline');
    out.push('color:' + (colorCss(f.color, ctx) || theme[1] || '#000000'));
    const raw = ctx.fills && xf.fillId != null ? ctx.fills[xf.fillId] : undefined;
    const fill = raw !== undefined && raw !== null
      ? fillCss(raw, ctx)
      : (cell.s && cell.s.patternType && cell.s.patternType !== 'none' ? colorCss(cell.s.fgColor, ctx) : null);
    out.push('background:' + (fill || theme[0] || '#ffffff'));
    const align = a.horizontal || (cell.t === 'n' || cell.t === 'd' ? 'right' : 'left');
    out.push('text-align:' + align);
    out.push('vertical-align:' + ({ top: 'top', center: 'middle', bottom: 'bottom' }[a.vertical] || 'middle'));
    if (a.wrapText) out.push('white-space:normal;word-break:break-word');
    if (f.sz) out.push('font-size:' + Math.round(f.sz * 4 / 3) + 'px');
    return out.join(';');
  }

  // ---------------------------------------------------------------------------
  // 渲染：模型 → 主題化唯讀表格 HTML（一個工作表一張表）
  // ---------------------------------------------------------------------------
  function sheetHtml(sh) {
    if (!sh.rows || !sh.cols) {
      return '<div class="xs-empty">這個工作表沒有資料</div>';
    }
    // 凍結窗格以「工作表座標」記錄（topLeftCell B2 → 1 列 1 欄），可見範圍從 r0 / c0 開始時要換算成可見區的列 / 欄數
    const fr = Math.max(0, Math.min((sh.freeze.rows || 0) - (sh.r0 || 0), sh.rows));
    const fc = Math.max(0, Math.min((sh.freeze.cols || 0) - (sh.c0 || 0), sh.cols));

    // 凍結窗格的位移：資料列 / 資料欄的累計座標（加上固定標頭與列號欄）
    const rowTop = [];
    let acc = HEAD_H;
    for (let r = 0; r < sh.rows; r++) { rowTop.push(acc); acc += sh.rowHeights[r]; }
    const colLeft = [];
    acc = GUTTER_W;
    for (let c = 0; c < sh.cols; c++) { colLeft.push(acc); acc += sh.colWidths[c]; }

    let h = '<table class="xs-grid" style="width:' + acc + 'px">';
    h += '<colgroup><col style="width:' + GUTTER_W + 'px">';
    for (let c = 0; c < sh.cols; c++) h += '<col style="width:' + sh.colWidths[c] + 'px">';
    h += '</colgroup>';
    // 欄字母標頭（固定上方）；欄字母 / 列號依工作表座標（可見範圍不一定從 A1 開始）。
    // 凍結區的標頭加 xs-frozen：z-index 高於一般標頭，水平 / 垂直捲動時一般標頭才不會蓋過它
    h += '<thead><tr style="height:' + HEAD_H + 'px"><th class="xs-corner" style="top:0;left:0"></th>';
    for (let c = 0; c < sh.cols; c++) {
      h += '<th class="xs-colhead' + (c < fc ? ' xs-frozen' : '') + '" style="top:0' + (c < fc ? ';left:' + colLeft[c] + 'px' : '') + '">' + colName((sh.c0 || 0) + c) + '</th>';
    }
    h += '</tr></thead><tbody>';

    const mergeAt = new Map(sh.merges.map((m) => [m.r + ':' + m.c, m]));
    for (let r = 0; r < sh.rows; r++) {
      h += '<tr style="height:' + sh.rowHeights[r] + 'px">';
      h += '<th class="xs-rowhead' + (r < fr ? ' xs-frozen' : '') + '" style="left:0' + (r < fr ? ';top:' + rowTop[r] + 'px' : '') + '">' + ((sh.r0 || 0) + r + 1) + '</th>';
      for (let c = 0; c < sh.cols; c++) {
        if (sh.covered.has(r + ':' + c)) continue;
        const m = mergeAt.get(r + ':' + c);
        const cell = sh.cells[r][c];
        const attrs = [];
        if (m && m.rs > 1) attrs.push('rowspan="' + m.rs + '"');
        if (m && m.cs > 1) attrs.push('colspan="' + m.cs + '"');
        // 凍結格一定要有不透明底色（捲動的格子會從底下穿過）：有樣式的格子 inline 帶底色，
        // 無樣式的格子吃表格層的預設底色（.xs-grid td，檔案的 xf 0 / lt1）
        const sticky = [];
        if (r < fr || c < fc) {
          sticky.push('position:sticky');
          if (r < fr) sticky.push('top:' + rowTop[r] + 'px');
          if (c < fc) sticky.push('left:' + colLeft[c] + 'px');
          sticky.push('z-index:' + (r < fr && c < fc ? 3 : 2));
        }
        const css = [cell ? cell.css : '', sticky.join(';')].filter(Boolean).join(';');
        h += '<td' + (attrs.length ? ' ' + attrs.join(' ') : '') + (css ? ' style="' + esc(css) + '"' : '') + '>'
          + (cell && cell.text ? esc(cell.text) : '') + '</td>';
      }
      h += '</tr>';
    }
    h += '</tbody></table>';
    return h;
  }

  // bootstrap 以 toString() 注入文件（與 md-shell 相同作法），cfg 以 JSON 內嵌
  function runtime(cfg) {
    var rootEl = document.documentElement;
    if (cfg.theme === 'dark' || (cfg.theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      rootEl.setAttribute('data-theme', 'dark');
    }
    var themeBtn = document.querySelector('[data-action="theme"]');
    if (themeBtn) themeBtn.addEventListener('click', function () {
      var dark = rootEl.getAttribute('data-theme') === 'dark';
      rootEl.setAttribute('data-theme', dark ? 'light' : 'dark');
      themeBtn.setAttribute('aria-label', dark ? '切換為深色' : '切換為淺色');
    });
    var tabs = [].slice.call(document.querySelectorAll('.xs-tab'));
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) {
          var on = t === tab;
          t.setAttribute('aria-selected', on ? 'true' : 'false');
          t.tabIndex = on ? 0 : -1;
          document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
        });
      });
    });
  }

  /**
   * @param {object} o
   * @param {ArrayBuffer} o.arrayBuffer  xlsx 原始位元組
   * @param {string} o.fileName          檔名，顯示在頂欄
   * @param {string} [o.theme]           'light' | 'dark' | 'auto'
   * @param {string} [o.nonce]           CSP nonce（內嵌 blob 文件用），全螢幕給 ''
   * @returns {string} 完整 HTML 文件
   */
  function buildDocument(o) {
    const model = parse(o.arrayBuffer);
    const themeCss = (root.AdoMarkdownTheme && root.AdoMarkdownTheme.css) || '';
    const title = o.fileName || 'Excel 預覽';
    const nonceAttr = o.nonce ? ' nonce="' + esc(o.nonce) + '"' : '';
    const initial = o.theme === 'dark' ? 'dark' : 'light';
    const totalCells = model.sheets.reduce((n, s) => n + s.totalRows * s.totalCols, 0);
    const meta = model.sheets.length + ' 個工作表 · ' + totalCells.toLocaleString('en-US') + ' 個儲存格';

    const tabs = model.sheets.map((s, i) =>
      '<button type="button" class="xs-tab" role="tab" id="xs-tab-' + i + '" aria-controls="xs-sheet-' + i + '" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '">' + esc(s.name) + '</button>').join('');
    const bodies = model.sheets.map((s, i) => {
      const notice = s.truncated
        ? '<div class="xs-notice">表格過大：僅顯示前 ' + s.rows.toLocaleString('en-US') + ' 列 × ' + s.cols.toLocaleString('en-US') + ' 欄（共 ' + s.totalRows.toLocaleString('en-US') + ' 列 × ' + s.totalCols.toLocaleString('en-US') + ' 欄）</div>'
        : '';
      return '<section class="xs-sheet" id="xs-sheet-' + i + '" role="tabpanel" aria-labelledby="xs-tab-' + i + '"' + (i === 0 ? '' : ' hidden') + '>' + notice + '<div class="xs-scroll">' + sheetHtml(s) + '</div></section>';
    }).join('');

    return `<!DOCTYPE html>
<html lang="zh-Hant" data-theme="${initial}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<style>${themeCss}</style>
<style>${XLSX_CSS}</style>
<style>${cellBaseCss(model)}</style>
</head>
<body>
<div class="md-app">
  <header class="md-bar">
    <div class="md-bar-title" title="${esc(o.fileName || '')}">${esc(title)}</div>
    <span class="xs-meta">${esc(meta)}</span>
    <button type="button" class="md-iconbtn" data-action="theme" aria-label="切換深淺色">◐</button>
  </header>
  ${model.sheets.length > 1 ? `<nav class="xs-tabs" role="tablist" aria-label="工作表">${tabs}</nav>` : ''}
  <main class="md-main"><div class="xs-sheets">${bodies}</div></main>
</div>
<script${nonceAttr}>(${runtime.toString()})(${jsonForScript({ theme: o.theme || 'auto' })});</script>
</body>
</html>`;
  }

  // 唯讀表格樣式（token 與頂欄沿用 AdoMarkdownTheme.css；這裡只補 xs-* 專用樣式）
  // .xs-tabs 必須 flex:0 0 auto：它是 .md-app（flex 直欄）的子項、又有 overflow-x:auto（最小高度因此為 0），
  // 大表時 .md-main 的內容高度會把它擠成 0 高，工作表頁籤消失（v0.3.3 修正）
  // 外殼（統計、頁籤、提示）只用 md-theme.js 有定義的 token（--fg / --fg-muted / --bg-surface…）：名稱不存在時會
  // 靜默退回 fallback 的淺色值，深色模式變白底（v0.3.3 修正）。欄列標頭屬於紙張，寫死色、不跟主題
  const XLSX_CSS = `
.md-main{overflow:hidden}
.xs-meta{margin-left:auto;font-size:12px;color:var(--fg-muted);flex-shrink:0}
.xs-tabs{flex:0 0 auto;display:flex;gap:2px;padding:0 16px;background:var(--bg-surface);border-bottom:1px solid var(--line);overflow-x:auto}
.xs-tab{appearance:none;border:0;background:transparent;font:inherit;font-size:13px;padding:8px 14px;color:var(--fg-muted);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
.xs-tab:hover{color:var(--fg);background:var(--bg-hover)}
.xs-tab[aria-selected="true"]{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}
.xs-sheets{padding:0;height:100%}
.xs-sheet{height:100%;display:flex;flex-direction:column}
.xs-sheet[hidden]{display:none}
.xs-scroll{overflow:auto;flex:1 1 auto;min-height:0}
.xs-notice{flex:0 0 auto;padding:8px 16px;font-size:12.5px;color:var(--fg-muted);background:var(--alert-warning-bg);border-bottom:1px solid var(--line)}
.xs-empty{padding:48px 16px;text-align:center;color:var(--fg-muted)}
.xs-grid{border-collapse:separate;border-spacing:0;font-size:13px;line-height:1.5}
.xs-grid td{border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:2px 6px;white-space:pre;overflow:hidden;text-overflow:ellipsis;max-width:48em}
.xs-grid tbody tr:hover td{box-shadow:inset 0 0 0 99em rgba(0,0,0,.045)}
.xs-corner,.xs-colhead,.xs-rowhead{background:#f3f2f1;color:#605e5c;font-weight:400;font-size:11.5px;text-align:center;position:sticky;z-index:4;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
.xs-colhead.xs-frozen,.xs-rowhead.xs-frozen{z-index:5}
.xs-corner{z-index:6}
.xs-rowhead{width:${GUTTER_W}px}
@media print{.xs-tabs,.md-bar{display:none}.md-main,.xs-scroll{overflow:visible}.xs-sheets,.xs-sheet{height:auto}}
`;

  root.AdoXlsx = { parse, buildDocument };
})(typeof globalThis !== 'undefined' ? globalThis : window);
