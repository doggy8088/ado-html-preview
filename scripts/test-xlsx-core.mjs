#!/usr/bin/env node
// xlsx-core.js 的測試套件（make test）：解析 → 模型 → 主題化唯讀表格文件。
// 除了行為斷言，還有**視覺驗證**的兩條硬性檢查（AGENTS.md 的視覺驗證規則）：
//   1. 紙張語意不變性：所有 <td> 的樣式在深色 / 淺色建置下必須完全一致
//      （儲存格配色跟著「檔案」而不是 App 主題——否則深色模式會出現淺色底＋白字的不可讀組合）。
//   2. 對比檢查：每個儲存格的最終前景 × 最終背景（含預設值）須達 WCAG AA 4.5:1。
// 用法：node scripts/test-xlsx-core.mjs（會先呼叫 python3 + openpyxl 產生測試檔）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
global.XLSX = require(path.join(root, 'vendor', 'xlsx.full.min.js'));
require(path.join(root, 'md-theme.js')); // 外殼主題 CSS 的來源（生產由 manifest / userscript 載入；測試不可漏）
require(path.join(root, 'xlsx-core.js'));
const { AdoXlsx } = global;

let failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✓ ' + msg); } else { console.error('  ✗ ' + msg); failed = 1; }
};

// ---- 測試檔 ----
const fixture = path.join(os.tmpdir(), 'ado-xlsx-fixture.xlsx');
execFileSync('python3', [path.join(root, 'scripts', 'xlsx-fixture.py'), fixture], { stdio: 'inherit' });
const buf = fs.readFileSync(fixture);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const model = AdoXlsx.parse(ab);

console.log('== 解析 ==');
console.log('工作表：', model.sheets.map((s) => s.name).join(' / '));
assert(model.sheets.length === 3, '三個工作表');
assert(model.sheets[1].name === 'Notes & 附註', `工作表名稱的 XML 實體已解碼（實際 ${JSON.stringify(model.sheets[1].name)}）`);
const s1 = model.sheets[0];
assert(s1.rows === 5 && s1.cols === 4, `sheet1 尺寸 5×4（實際 ${s1.rows}×${s1.cols}）`);
assert(!s1.truncated, 'sheet1 未觸發截斷');
console.log('  freeze =', JSON.stringify(s1.freeze));
assert(s1.freeze && s1.freeze.rows === 1 && s1.freeze.cols === 1, '凍結窗格 B2 解析為 1 列 + 1 欄（ZIP 掃描備援）');
assert(s1.merges.length === 1 && s1.merges[0].r === 0 && s1.merges[0].cs === 4, '合併儲存格 A1:D1（colspan=4）');
assert(s1.covered.has('0:1') && s1.covered.has('0:3'), '被合併覆蓋的格子已標記');
console.log('  colWidths =', JSON.stringify(s1.colWidths), 'rowHeights =', JSON.stringify(s1.rowHeights));
assert(s1.colWidths[0] === 84 && s1.colWidths[1] === 252, '自訂欄寬（wpx 原樣換算）');
assert(s1.rowHeights[0] >= 34 && s1.rowHeights[0] <= 36, `第一列列高 26pt ≈ 35px（實際 ${s1.rowHeights[0]}）`);
assert(s1.rowHeights[2] >= 52 && s1.rowHeights[2] <= 54, `第三列列高 40pt ≈ 53px（實際 ${s1.rowHeights[2]}）`);

console.log('== 值與樣式 ==');
const A1 = s1.cells[0][0], A2 = s1.cells[1][0], B3 = s1.cells[2][1], C3 = s1.cells[2][2], D3 = s1.cells[2][3];
const B4 = s1.cells[3][1], B5 = s1.cells[4][1], C5 = s1.cells[4][2], D5 = s1.cells[4][3];
assert(A1.text === 'ERP 外掛程式改善初步上線程式表', 'A1 共用字串值');
assert(/font-weight:600/.test(A1.css) && /background:#4472c4/.test(A1.css) && /color:#ffffff/.test(A1.css), 'A1 樣式：粗體＋藍底＋白字（字型與填色都還原）');
assert(/text-align:center/.test(A1.css) && /vertical-align:middle/.test(A1.css), 'A1 對齊：置中');
assert(/font-size:17px/.test(A1.css), 'A1 字級 13pt ≈ 17px');
assert(/text-align:center/.test(A2.css), '表頭置中對齊');
assert(C3.text === '2023/11/20', `C3 日期格式化顯示（實際 ${JSON.stringify(C3.text)}）`);
assert(D3.text === '85%', `D3 百分比格式（實際 ${JSON.stringify(D3.text)}）`);
assert(B4.text === '內嵌字串測試 & <esc>', `B4 內嵌字串（實際 ${JSON.stringify(B4.text)}）`);
assert(/italic/.test(B5.css) && /background:#fff2cc/.test(B5.css) && /white-space:normal/.test(B5.css), 'B5 樣式：斜體＋黃底＋自動換行');
assert(/text-align:right/.test(B5.css), 'B5 右對齊');
assert(B5.text.includes('1,234,567.89'), `B5 千分位數字格式（實際 ${JSON.stringify(B5.text)}）`);
assert(C5.text === 'TRUE', '布林值');
assert(String(D5.text).includes('#N/A'), '錯誤值');
assert(model.sheets[1].cells[1][0].text === '42', 'sheet2 數值');

console.log('== 工作表 XML 對應（workbook.xml + rels，內部檔名與頁籤順序錯開） ==');
// 測試檔把 程式表 → sheet3.xml、Notes → sheet1.xml、邊界 → sheet2.xml：以 sheetN 編號對應時，
// 上面 A1 的樣式斷言與下面的凍結窗格都會對錯表
assert(s1.freeze.rows === 1 && s1.freeze.cols === 1 && model.sheets[1].freeze.rows === 0, '凍結窗格依 rels 對到正確的工作表（程式表 B2、Notes 無）');
const s3 = model.sheets[2];
assert(s3.freeze.rows === 4 && s3.freeze.cols === 3, `邊界表凍結窗格 D5（工作表座標 4 列 3 欄；實際 ${JSON.stringify(s3.freeze)}）`);
{
  // 非標準生成器常把 rels 的 Target 寫成 xl/worksheets/...（漏前導 /）或 ../worksheets/...（誤以 xl/_rels/ 為基準）：
  // 改寫 ZIP 內的 workbook.xml.rels 逐一驗證（SheetJS 本身不認 ../worksheets/，以原 wb 搭配改寫後的 ZIP 測 rawSheetExtras）
  const rewriteRels = (prefix) => {
    const tmp = path.join(os.tmpdir(), 'ado-xlsx-rels-variant.xlsx');
    execFileSync('python3', ['-c', `
import re, sys, zipfile
src, dst, pfx = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(src) as z:
    items = [(i.filename, z.read(i.filename)) for i in z.infolist()]
with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in items:
        if name == "xl/_rels/workbook.xml.rels":
            t = re.sub(r'Target="worksheets/(sheet\\d+\\.xml)"', lambda m: f'Target="{pfx}worksheets/{m.group(1)}"', data.decode("utf-8"))
            data = t.encode("utf-8")
        z.writestr(name, data)
`, fixture, tmp, prefix]);
    const b = fs.readFileSync(tmp);
    fs.rmSync(tmp, { force: true });
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
  const origRead = global.XLSX.read;
  const cachedWb = origRead(ab, { type: 'array', cellStyles: true, cellNF: true, cellText: true, cellDates: false });
  for (const [label, prefix, stubWb] of [
    ['xl/worksheets/…（漏前導 /）', 'xl/', false],
    ['/xl/worksheets/…（根路徑）', '/xl/', false],
    ['../worksheets/…（相對路徑越界）', '../', true],
  ]) {
    const altAb = rewriteRels(prefix);
    if (stubWb) global.XLSX.read = () => cachedWb;
    let m;
    try { m = AdoXlsx.parse(altAb); } finally { global.XLSX.read = origRead; }
    const ok = m.sheets[0].freeze.rows === 1 && m.sheets[1].freeze.rows === 0 && m.sheets[2].freeze.rows === 4
      && /background:#4472c4/.test(m.sheets[0].cells[0][0].css);
    assert(ok, `rels Target="${prefix}worksheets/..." 仍正確對到各工作表樣式與凍結窗格（${label}）`);
  }
}

console.log('== indexed 色（SheetJS 會掉前導零）／ indexed 填色 ==');
assert(s3.r0 === 2 && s3.c0 === 2 && s3.rows === 6 && s3.cols === 4, `可見範圍 C3:F8（r0=${s3.r0} c0=${s3.c0} ${s3.rows}×${s3.cols}）`);
const E = (a1) => { const m = /^([A-Z])(\d+)$/.exec(a1); return s3.cells[+m[2] - 1 - s3.r0][m[1].charCodeAt(0) - 65 - s3.c0]; };
assert(/color:#ff0000;/.test(E('C3').css) && /background:#000000/.test(E('C3').css), `indexed 10 字色 = #ff0000、indexed 8 填色 = #000000（實際 ${E('C3').css}）`);
assert(/color:#00ff00;/.test(E('E3').css), `indexed 11 字色 = #00ff00（SheetJS 給 '0ff0'；實際 ${E('E3').css}）`);
assert(/color:#ffff00;/.test(E('F3').css) && /background:#000080/.test(E('F3').css), `indexed 13 字色 = #ffff00、indexed 18 填色 = #000080（實際 ${E('F3').css}）`);
assert(/color:#0000ff;/.test(E('D4').css), `indexed 12 字色 = #0000ff（實際 ${E('D4').css}）`);

console.log('== 空白格 ==');
assert(E('D3') && E('D3').text === '' && /background:#fff2cc/.test(E('D3').css), '凍結列內有樣式的空白格保留填色（不再當成無資料略過）');
assert(E('E6') && E('E6').text === '' && /background:#4472c4/.test(E('E6').css), "有樣式的空白格（t: 'z'）保留填色");
assert(E('C4') === null, '完全沒樣式的空白格不輸出 inline 樣式（交給表格層預設配色）');

console.log('== 視覺驗證：紙張語意 ==');
const htmlLight = AdoXlsx.buildDocument({ arrayBuffer: ab, fileName: '測試.xlsx', theme: 'light', nonce: 'TESTNONCE' });
const htmlDark = AdoXlsx.buildDocument({ arrayBuffer: ab, fileName: '測試.xlsx', theme: 'dark', nonce: 'TESTNONCE' });
// 每個 <td>（含沒有 style 屬性的空白格）都要算進來：沒有 inline 色的格子吃表格層的預設規則（.xs-grid td{color;background}），
// 先前只抓帶 style 的 <td>，空白格的缺色會被靜默略過
const tds = (html) => [...html.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)].map((m) => ({ style: (/style="([^"]*)"/.exec(m[1]) || [])[1] || '', text: m[2] }));
const baseRule = (html) => /\.xs-grid td\{color:(#[0-9a-f]{6});background:(#[0-9a-f]{6})\}/.exec(html);
const lightTds = tds(htmlLight);
const darkTds = tds(htmlDark);
const lightStyles = lightTds.map((t) => t.style);
const darkStyles = darkTds.map((t) => t.style);
assert(lightTds.length > 0 && lightTds.length === darkTds.length, `深淺色建置的 <td> 數量一致（${lightTds.length}，含 ${lightTds.filter((t) => !t.style).length} 個無 inline 樣式的空白格）`);
assert(JSON.stringify(lightStyles) === JSON.stringify(darkStyles), '所有 <td> 樣式在深 / 淺色建置完全一致（配色跟著檔案，不跟主題）');
const baseL = baseRule(htmlLight), baseD = baseRule(htmlDark);
assert(!!baseL && !!baseD && baseL[0] === baseD[0], `表格層預設配色存在且深淺一致（${baseL ? baseL[0] : '缺'}）`);
const effective = (t) => ({
  fg: (t.style.match(/(?:^|;)color:(#[0-9a-f]{6})/) || [])[1] || (baseL && baseL[1]),
  bg: (t.style.match(/background:(#[0-9a-f]{6})/) || [])[1] || (baseL && baseL[2]),
});
assert(lightTds.every((t) => effective(t).fg), '每個 <td> 都有顯式字色（inline 或表格層預設，含預設值）');
assert(lightTds.every((t) => effective(t).bg), '每個 <td> 都有顯式底色（inline 或表格層預設，含預設值）');
assert(!lightStyles.some((s) => /#[0-9a-f]{3,5}(?![0-9a-f])/i.test(s)), '沒有 3–5 位數的 hex 色（#RGB / #RGBA 會讀成別的顏色或透明）');
assert(lightTds.filter((t) => /position:sticky/.test(t.style)).every((t) => effective(t).bg), '凍結格都有不透明底色（捲動內容不會透出來）');

console.log('== 視覺驗證：對比（WCAG AA 4.5:1） ==');
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
let min = { ratio: Infinity, style: '' };
for (const t of lightTds) {
  if (!t.text) continue; // 空白格沒有文字，對比無意義
  const { fg, bg } = effective(t);
  const ratio = contrast(fg, bg);
  if (ratio < min.ratio) min = { ratio, style: t.style || '(表格層預設)' };
}
console.log(`  最低對比 ${min.ratio.toFixed(2)}:1 — ${min.style}`);
assert(min.ratio >= 4.5, `所有儲存格前景/背景對比 ≥ 4.5:1（最低 ${min.ratio.toFixed(2)}）`);

console.log('== 輸出文件 ==');
assert(htmlLight.startsWith('<!DOCTYPE html>'), '輸出為完整 HTML 文件');
assert(htmlLight.includes('nonce="TESTNONCE"'), 'bootstrap 腳本帶上 CSP nonce');
assert(htmlLight.includes('colspan="4"') && !htmlLight.includes('rowspan="2"'), '合併以 colspan 呈現');
assert(htmlLight.includes('&lt;esc&gt;') && !htmlLight.includes('<esc>'), '儲存格文字已 HTML 轉義');
assert(htmlLight.includes('role="tab"') && htmlLight.includes('role="tabpanel"'), '工作表頁籤具有無障礙角色');
assert(htmlLight.includes('position:sticky;top:26px') && htmlLight.includes('position:sticky;left:48px'), '凍結窗格以 sticky 位移呈現');
assert(htmlLight.includes('3 個工作表') && htmlLight.includes('data-theme="light"'), '頂欄統計與淺色初始主題');
{
  console.log('== 凍結窗格與版面 ==');
  const sec = htmlLight.split('<section class="xs-sheet"')[3] || '';
  const heads = [...sec.matchAll(/<th class="(xs-colhead[^"]*)"[^>]*>([A-Z]+)<\/th>/g)].map((m) => [m[2], /xs-frozen/.test(m[1])]);
  const rowsH = [...sec.matchAll(/<th class="(xs-rowhead[^"]*)"[^>]*>(\d+)<\/th>/g)].map((m) => [m[2], /xs-frozen/.test(m[1])]);
  assert(JSON.stringify(heads) === JSON.stringify([['C', true], ['D', false], ['E', false], ['F', false]]), `欄字母依工作表座標、凍結欄依 c0 換算（D5 凍結、範圍從 C 起 → 只凍結 C；實際 ${JSON.stringify(heads)}）`);
  assert(JSON.stringify(rowsH.map((r) => r[0])) === JSON.stringify(['3', '4', '5', '6', '7', '8']) && rowsH.filter((r) => r[1]).length === 2 && rowsH[1][1] && !rowsH[2][1],
    `列號依工作表座標、凍結列依 r0 換算（3、4 列凍結；實際 ${JSON.stringify(rowsH)}）`);
  const stickyTds = [...sec.matchAll(/<td\b[^>]*style="([^"]*position:sticky[^"]*)"/g)].length;
  const allTds = [...sec.matchAll(/<td\b/g)].length;
  assert(stickyTds === 2 * 4 + 4 * 1 && allTds === 24, `邊界表凍結格數 = 2 列×4 欄 + 其餘 4 列的 C 欄（實際 ${stickyTds}/${allTds}）`);
  assert(/<td style="position:sticky;top:\d+px;left:48px;z-index:3"><\/td>/.test(sec), '凍結區內無樣式的空白格（C4）仍輸出 sticky，底色由表格層預設提供');
  const zOf = (sel) => +((new RegExp(sel.replace(/[.]/g, '\\.') + '\\{[^}]*z-index:(\\d+)').exec(htmlLight) || [])[1] || 0);
  const zBase = zOf('.xs-corner,.xs-colhead,.xs-rowhead'), zFrozen = zOf('.xs-colhead.xs-frozen,.xs-rowhead.xs-frozen'), zCorner = zOf('.xs-corner');
  assert(zBase > 0 && zFrozen > zBase && zCorner > zFrozen, `凍結標頭 z-index 高於一般標頭、低於左上角（${zBase} < ${zFrozen} < ${zCorner}）`);
  assert(/\.xs-sheets\{[^}]*height:100%/.test(htmlLight) && /\.xs-scroll\{[^}]*overflow:auto[^}]*flex:1 1 auto[^}]*min-height:0/.test(htmlLight),
    '.xs-sheets 撐滿 .md-main、.xs-scroll 是工作表的捲動容器（截斷提示不會跟著捲走）');
  assert(!/<table class="xs-grid" style="width:/.test(htmlLight) && /\.xs-grid\{[^}]*width:max-content/.test(htmlLight),
    '.xs-grid 用 width:max-content（不寫死總寬壓縮列號欄或鄰欄）');
  assert(/\.xs-corner,\.xs-rowhead\{width:48px;min-width:48px;max-width:48px\}/.test(htmlLight) && /class="xs-colhead[^"]*" style="width:\d+px;min-width:\d+px;/.test(sec),
    '列號欄鎖定 48px、欄標頭帶 min-width（寬文字只撐開自身欄，不擠壓列號欄造成凍結欄錯位）');
  // 驗證 bootstrap 的 syncSticky：當凍結欄 / 凍結列被寬文字或換行撐大（如第 0 欄 96.5px、第 0 列 50.25px），
  // 會依實際 getBoundingClientRect 重算後續凍結欄 / 列的 left / top（含跨欄列合併與切頁籤）
  const cell = (w, h, frozen = false, rs = 1, cs = 1) => ({
    rowSpan: rs, colSpan: cs, style: {},
    classList: { contains: (k) => k === 'xs-frozen' && frozen },
    getBoundingClientRect: () => ({ width: w, height: h }),
  });
  const hCells = [cell(48, 26), cell(96.5, 26, true), cell(70, 26, true), cell(64, 26, false)];
  const r0Cells = [cell(48, 50.25, true), cell(166.5, 50.25, false, 1, 2), cell(64, 50.25, false)]; // 合併 c0..c1
  const r1Cells = [cell(48, 24, true), cell(96.5, 48, false, 2, 1), cell(70, 24, false), cell(64, 24, false)]; // c0 跨兩列
  const r2Cells = [cell(48, 24, false), cell(70, 24, false), cell(64, 24, false)]; // c0 被上一列覆蓋，cells[1] 是 c1！
  const mkRow = (h, cells) => ({ cells, getBoundingClientRect: () => ({ width: 0, height: h }) });
  const mockSec = {
    hidden: true,
    querySelector: (sel) => sel === '.xs-grid' ? {
      tHead: { rows: [mkRow(26, hCells)] },
      tBodies: [{ rows: [mkRow(50.25, r0Cells), mkRow(24, r1Cells), mkRow(24, r2Cells)] }],
    } : null,
  };
  let tabClick = null;
  const tab0 = { setAttribute: () => {}, getAttribute: () => 's0', addEventListener: () => {} };
  const tab1 = { setAttribute: () => {}, getAttribute: () => 's1', addEventListener: (_, fn) => { tabClick = fn; } };
  const sec0 = { hidden: false, querySelector: () => null };
  const boot = htmlLight.slice(htmlLight.lastIndexOf('<script nonce="TESTNONCE">') + '<script nonce="TESTNONCE">'.length, htmlLight.lastIndexOf('</script>'));
  vm.runInNewContext(boot, {
    document: {
      documentElement: { setAttribute: () => {}, getAttribute: () => 'light' },
      querySelector: (sel) => sel === '.xs-sheet:not([hidden])' ? (!sec0.hidden ? sec0 : mockSec) : null,
      querySelectorAll: (sel) => sel === '.xs-tab' ? [tab0, tab1] : [],
      getElementById: (id) => id === 's0' ? sec0 : mockSec,
    },
    window: { addEventListener: () => {} },
  });
  tabClick(); // 切到第二個頁籤，觸發 syncSticky(mockSec)
  assert(hCells[1].style.left === '48px' && hCells[2].style.left === '144.5px',
    `syncSticky 依實測欄寬更新凍結欄標頭 left（預期 48px / 144.5px，實際 ${hCells[1].style.left} / ${hCells[2].style.left}）`);
  assert(r0Cells[0].style.top === '26px' && r1Cells[0].style.top === '76.25px',
    `syncSticky 依實測列高更新凍結列標頭 top（預期 26px / 76.25px，實際 ${r0Cells[0].style.top} / ${r1Cells[0].style.top}）`);
  assert(r0Cells[1].style.left === '48px' && r0Cells[1].style.top === '26px'
    && r1Cells[2].style.left === '144.5px' && r1Cells[2].style.top === '76.25px'
    && r2Cells[1].style.left === '144.5px',
    `syncSticky 正確跳過 rowspan/colspan 被覆蓋格並更新後續凍結格（r2 c1 left=${r2Cells[1].style.left}）`);
}
{
  console.log('== <script> 內 JSON 跳脫 ==');
  const evil = AdoXlsx.buildDocument({ arrayBuffer: ab, fileName: 'x.xlsx', theme: '</script><script>alert(1)</script><!--', nonce: '' });
  assert(!evil.includes('</script><script>alert(1)') && !evil.includes('<!--'), "cfg JSON 內的 '<' 已跳脫為 \\u003c（不會關閉 script 標籤）");
  assert(evil.includes('\\u003c/script>\\u003cscript>alert(1)'), 'cfg 以 \\u003c 保留原值（JS 讀到的字串不變）');
}
assert(htmlLight.includes('.md-bar') && htmlLight.includes('--fg-muted:'), '外殼主題 CSS（AdoMarkdownTheme）已內嵌（測試須載入 md-theme.js）');
{
  // 外殼 CSS 引用的變數都要在主題定義：名稱不存在時靜默退回 fallback 淺色值，深色模式變白底（v0.3.3 前的頁籤列）
  const themeCss = global.AdoMarkdownTheme.css;
  const defined = new Set((themeCss.match(/--[\w-]+(?=\s*:)/g) || []));
  const xsCss = htmlLight.slice(htmlLight.indexOf('.xs-meta{'));
  const used = [...new Set((xsCss.match(/var\(--[\w-]+/g) || []).map((v) => v.slice(4)))];
  const undef = used.filter((v) => !defined.has(v));
  assert(used.length > 0 && undef.length === 0, `xs-* 樣式引用的 CSS 變數都在主題中定義（${used.join(' ')}${undef.length ? '；未定義：' + undef.join(' ') : ''}）`);
  // 頁籤列是 .md-app flex 直欄的子項且 overflow-x:auto（最小高度 0）：沒有 flex:0 0 auto 時大表會把它擠成 0 高
  assert(/\.xs-tabs\{[^}]*flex:0 0 auto/.test(htmlLight), '工作表頁籤列不可被壓縮（flex:0 0 auto）');
}
assert(htmlDark.includes('data-theme="dark"'), '深色初始主題');
const htmlFull = AdoXlsx.buildDocument({ arrayBuffer: ab, fileName: 'x.xlsx', theme: 'dark', nonce: '' });
assert(!htmlFull.includes('nonce="'), '全螢幕模式（nonce 為空）不寫 nonce 屬性');

console.log('== 截斷保護 ==');
const huge = { Sheets: { Big: {} }, SheetNames: ['Big'] };
huge.Sheets.Big['!ref'] = 'A1:CV4000'; // 100 欄 × 4000 列 = 40 萬格
const realRead = global.XLSX.read;
global.XLSX.read = () => huge;
const model2 = AdoXlsx.parse(ab);
global.XLSX.read = realRead;
const big1 = model2.sheets[0];
assert(big1.truncated && big1.rows * big1.cols <= 60000 + big1.cols, `截斷保護生效（${big1.rows}×${big1.cols}）`);

fs.rmSync(fixture, { force: true });
console.log(failed ? 'FAILED' : 'ALL PASS');
process.exit(failed);
