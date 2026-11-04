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
    const sheets = wb.SheetNames.map((name, i) => parseSheet(XLSX, wb.Sheets[name] || {}, name, theme, wb.Styles || {}, extras[i]));
    return { sheets };
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
        return rgb ? '#' + String(rgb).slice(-6).toLowerCase() : null;
      };
      const out = THEME_INDEX.map(pick);
      return out.every(Boolean) ? out : OFFICE_THEME;
    } catch (e) {
      return OFFICE_THEME;
    }
  }

  // 顏色物件（SheetJS 的 font.color / fill.fgColor）→ CSS 顏色。
  // theme 色優先（Excel 常同時給不可靠的預設 rgb），以佈景色盤解析並套用 tint
  function colorCss(v, theme) {
    if (!v) return null;
    if (v.theme != null) {
      const base = theme[v.theme] != null ? theme[v.theme] : OFFICE_THEME[v.theme];
      if (!base) return v.rgb ? '#' + String(v.rgb).slice(-6).toLowerCase() : null;
      return v.tint ? mixWithWhite(base, v.tint) : base.toLowerCase();
    }
    return v.rgb ? '#' + String(v.rgb).slice(-6).toLowerCase() : null;
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

  // 直接掃 xlsx（ZIP）內的 xl/worksheets/sheetN.xml，取得：
  //   - 凍結窗格（<pane topLeftCell="...">）
  //   - 每格的樣式索引（<c r="A1" s="3"> 的 s 屬性 → wb.Styles.CellXf 的索引）
  // 依 sheetN 編號對應工作表順序（實務上與 workbook 順序一致；極端情況下樣式會對錯表，列為已知限制）
  function rawSheetExtras(XLSX, buf) {
    const out = {};
    try {
      const cfb = readCfb(XLSX, buf);
      if (!cfb) return out;
      const dec = new TextDecoder('utf-8');
      for (let i = 0; i < cfb.FullPaths.length; i++) {
        const m = /xl\/worksheets\/sheet(\d+)\.xml$/i.exec(cfb.FullPaths[i]);
        if (!m) continue;
        const content = cfb.FileIndex[i] && cfb.FileIndex[i].content;
        if (!content) continue;
        const xml = dec.decode(content);
        const entry = { freeze: null, xfs: new Map() };
        const pm = /<pane\b[^>]*topLeftCell="([A-Z]+\d+)"/.exec(xml);
        if (pm) entry.freeze = freezeFromTopLeft(pm[1]);
        const re = /<c\b([^>]*)>/g;
        let cm;
        while ((cm = re.exec(xml))) {
          const attrs = cm[1];
          const rm = /\br="([A-Z]+\d+)"/.exec(attrs);
          const sm = /\bs="(\d+)"/.exec(attrs);
          if (rm && sm) entry.xfs.set(rm[1], parseInt(sm[1], 10));
        }
        out[parseInt(m[1], 10) - 1] = entry;
      }
    } catch (e) { /* 讀不到就算了（樣式退回預設） */ }
    return out;
  }

  function parseSheet(XLSX, ws, name, theme, styles, extra) {
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
        if (!cell || cell.t === 'z') { line.push(null); continue; }
        let text = '';
        try { text = XLSX.utils.format_cell(cell); } catch (e) { text = cell.w != null ? String(cell.w) : String(cell.v == null ? '' : cell.v); }
        const xfIdx = (extra && extra.xfs.get(addr)) || 0;
        line.push({ text: text == null ? '' : String(text), css: cellCss(cell, (styles.CellXf || [])[xfIdx] || {}, styles, theme) });
      }
      cells.push(line);
    }

    return {
      name,
      rows, cols, totalRows, totalCols,
      truncated: totalRows > rows || totalCols > cols,
      colWidths, rowHeights, merges, covered, cells,
      freeze: freezeOf(ws, extra && extra.freeze),
    };
  }

  // 儲存格樣式 → inline CSS（Excel 字級單位是 pt，換算 px；填色用 SheetJS 解析好的 cell.s）。
  // 顏色採「紙張語意」：未指定字色 = 檔案的 dk1（通常黑）、未指定底色 = 檔案的 lt1（紙面白），
  // 兩者都寫成顯式值——Excel 檔的樣式是設計過的固定配色，跟隨 App 深淺色主題會產生
  // 「淺色底＋主題白字」這種不可讀的組合（v0.2.11 修正的實測案例）
  function cellCss(cell, xf, styles, theme) {
    const f = (styles.Fonts || [])[xf.fontId || 0] || {};
    const a = xf.alignment || {};
    const out = [];
    if (f.bold) out.push('font-weight:600');
    if (f.italic) out.push('font-style:italic');
    if (f.strike) out.push('text-decoration:line-through');
    else if (f.underline || f.u) out.push('text-decoration:underline');
    out.push('color:' + (colorCss(f.color, theme) || theme[1] || '#000000'));
    const fill = cell.s && cell.s.patternType && cell.s.patternType !== 'none' ? colorCss(cell.s.fgColor, theme) : null;
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
    const fr = Math.min(sh.freeze.rows || 0, sh.rows);
    const fc = Math.min(sh.freeze.cols || 0, sh.cols);

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
    // 欄字母標頭（固定上方）
    h += '<thead><tr style="height:' + HEAD_H + 'px"><th class="xs-corner" style="top:0;left:0"></th>';
    for (let c = 0; c < sh.cols; c++) {
      h += '<th class="xs-colhead" style="top:0' + (c < fc ? ';left:' + colLeft[c] + 'px' : '') + '">' + colName(c) + '</th>';
    }
    h += '</tr></thead><tbody>';

    const mergeAt = new Map(sh.merges.map((m) => [m.r + ':' + m.c, m]));
    for (let r = 0; r < sh.rows; r++) {
      h += '<tr style="height:' + sh.rowHeights[r] + 'px">';
      h += '<th class="xs-rowhead" style="left:0' + (r < fr ? ';top:' + rowTop[r] + 'px' : '') + '">' + (r + 1) + '</th>';
      for (let c = 0; c < sh.cols; c++) {
        if (sh.covered.has(r + ':' + c)) continue;
        const m = mergeAt.get(r + ':' + c);
        const cell = sh.cells[r][c];
        const attrs = [];
        if (m && m.rs > 1) attrs.push('rowspan="' + m.rs + '"');
        if (m && m.cs > 1) attrs.push('colspan="' + m.cs + '"');
        const sticky = [];
        if (r < fr) sticky.push('position:sticky;top:' + rowTop[r] + 'px;z-index:2');
        if (c < fc) sticky.push('position:sticky;left:' + colLeft[c] + 'px;z-index:2');
        if (r < fr && c < fc) sticky.push('z-index:3');
        const css = (cell ? cell.css : '') + (sticky.length ? (cell && cell.css ? ';' : '') + sticky.join(';') : '');
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
<script${nonceAttr}>(${runtime.toString()})(${JSON.stringify({ theme: o.theme || 'auto' })});</script>
</body>
</html>`;
  }

  // 唯讀表格樣式（token 與頂欄沿用 AdoMarkdownTheme.css；這裡只補 xs-* 專用樣式）
  const XLSX_CSS = `
.xs-meta{margin-left:auto;font-size:12px;color:var(--text-2,#605e5c);flex-shrink:0}
.xs-tabs{display:flex;gap:2px;padding:0 16px;background:var(--surface,#fff);border-bottom:1px solid var(--line,#edebe9);overflow-x:auto}
.xs-tab{appearance:none;border:0;background:transparent;font:inherit;font-size:13px;padding:8px 14px;color:var(--text-2,#605e5c);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
.xs-tab:hover{color:var(--text,#201f1e);background:var(--hover,#f3f2f1)}
.xs-tab[aria-selected="true"]{color:var(--accent,#0078d4);border-bottom-color:var(--accent,#0078d4);font-weight:600}
.xs-sheets{padding:0}
.xs-sheet{height:100%}
.xs-scroll{overflow:auto;height:100%}
.xs-notice{padding:8px 16px;font-size:12.5px;color:var(--text-2,#605e5c);background:var(--warn-bg,#fff4ce);border-bottom:1px solid var(--line,#edebe9)}
.xs-empty{padding:48px 16px;text-align:center;color:var(--text-2,#605e5c)}
.xs-grid{border-collapse:separate;border-spacing:0;font-size:13px;line-height:1.5;background:#fff}
.xs-grid td{border-right:1px solid var(--line,#edebe9);border-bottom:1px solid var(--line,#edebe9);padding:2px 6px;white-space:pre;overflow:hidden;text-overflow:ellipsis;max-width:48em}
.xs-grid tbody tr:hover td{box-shadow:inset 0 0 0 99em rgba(0,0,0,.045)}
.xs-corner,.xs-colhead,.xs-rowhead{background:var(--head-bg,#f3f2f1);color:var(--text-2,#605e5c);font-weight:400;font-size:11.5px;text-align:center;position:sticky;z-index:4;border-right:1px solid var(--line,#edebe9);border-bottom:1px solid var(--line,#edebe9)}
.xs-corner{z-index:6}
.xs-rowhead{width:${GUTTER_W}px}
@media print{.xs-tabs,.md-bar{display:none}.xs-scroll{overflow:visible}}
`;

  root.AdoXlsx = { parse, buildDocument };
})(typeof globalThis !== 'undefined' ? globalThis : window);
