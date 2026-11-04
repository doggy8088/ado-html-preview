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
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
global.XLSX = require(path.join(root, 'vendor', 'xlsx.full.min.js'));
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
assert(model.sheets.length === 2, '兩個工作表');
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

console.log('== 視覺驗證：紙張語意 ==');
const htmlLight = AdoXlsx.buildDocument({ arrayBuffer: ab, fileName: '測試.xlsx', theme: 'light', nonce: 'TESTNONCE' });
const htmlDark = AdoXlsx.buildDocument({ arrayBuffer: ab, fileName: '測試.xlsx', theme: 'dark', nonce: 'TESTNONCE' });
const tdStyles = (html) => (html.match(/<td[^>]*style="[^"]*"/g) || []).map((s) => s.slice(s.indexOf('style="') + 7, -1));
const lightStyles = tdStyles(htmlLight);
const darkStyles = tdStyles(htmlDark);
assert(lightStyles.length > 0 && lightStyles.length === darkStyles.length, `深淺色建置的 <td> 數量一致（${lightStyles.length}）`);
assert(JSON.stringify(lightStyles) === JSON.stringify(darkStyles), '所有 <td> 樣式在深 / 淺色建置完全一致（配色跟著檔案，不跟主題）');
assert(lightStyles.every((s) => /color:#[0-9a-f]{6}/.test(s)), '每個 <td> 都有顯式字色（含預設值）');
assert(lightStyles.every((s) => /background:#[0-9a-f]{6}/.test(s)), '每個 <td> 都有顯式底色（含預設值）');

console.log('== 視覺驗證：對比（WCAG AA 4.5:1） ==');
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
let min = { ratio: Infinity, style: '' };
for (const s of lightStyles) {
  const fg = (s.match(/color:(#[0-9a-f]{6})/) || [])[1];
  const bg = (s.match(/background:(#[0-9a-f]{6})/) || [])[1];
  const ratio = contrast(fg, bg);
  if (ratio < min.ratio) min = { ratio, style: s };
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
assert(htmlLight.includes('2 個工作表') && htmlLight.includes('data-theme="light"'), '頂欄統計與淺色初始主題');
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
