#!/usr/bin/env node
// 產生 pptx-runtime.js：把 vendor 的 @aiden0z/pptx-renderer（Apache-2.0，standalone 瀏覽器 ESM 版，
// 已內含 JSZip 與 ECharts）轉成「classic script 原始碼字串」，打包成 AdoPptxLibs。
// 與 docx 相同的「自帶渲染器」設計：這個函式庫不在父世界執行——只會被 pptx-core.js 寫進
// sandbox 預覽文件內執行（渲染不可信 pptx 的程式與 Azure DevOps 頁面完全隔離）。
//
// 為什麼要轉換：預覽文件以 <script nonce> 內嵌（內嵌模式的 blob 文件繼承 dev.azure.com 的 CSP），
// ES module 的 `export {…}` 與 `import.meta` 在 classic script 是語法錯誤。轉換只做三件事（另加一項上游 bug 修補，見下方），
// 且逐項斷言命中次數：
//   1. 整份包進 IIFE（加 'use strict'：ES module 隱含 strict mode，語意要一致），避免頂層宣告污染預覽文件的全域
//   2. `import.meta.resolve`（只用來自動尋找可選的 PDF.js；我們固定傳 pdfjs: false）→ undefined
//   3. 結尾的 `export { a as B, … }` → `return { B: a, … }`，掛成 window.PptxRenderer
// 不需要 bundler（repo 刻意沒有套件管理器）；改 vendor 版本後重跑本腳本即可重現。
// 用法：node scripts/build-pptx-runtime.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = 'vendor/pptx-renderer/pptx-renderer.browser.es.js';
let src = fs.readFileSync(path.join(root, VENDOR), 'utf8');

const replaceOnce = (pattern, replacement, what) => {
  const hits = src.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'));
  if (!hits || hits.length !== 1) throw new Error(`${what}：預期命中 1 次，實際 ${hits ? hits.length : 0} 次（vendor 版本改了？請檢查轉換規則）`);
  src = src.replace(pattern, replacement);
};

// 修補（Apache-2.0 §4(b)：修改處於此註明，vendor 檔本身保持原樣）——上游 1.4.0 的預設圖形 bug：
//   roundRect / round1Rect / snip1Rect 沒有依 ECMA-376 presetShapeDefinitions 把 adj 夾在 `pin 0 adj 50000`，
//   adj 超過 50000（PowerPoint 允許存檔，畫面上會自動夾住；實測評選簡報的膠囊形按鈕 adj=140944）時
//   圓角半徑大於短邊一半，畫成交叉弧線。同檔的 plaque / snip2DiagRect 有夾，這裡補上同樣的夾值。
const ADJ_LINE = 'const r = ze(n, "adj", 16667), i = Math.min(t, e) * r;';
const ADJ_FIXED = 'const r = Math.min(Math.max(ze(n, "adj", 16667), 0), 0.5), i = Math.min(t, e) * r;';
{
  const n = src.split(ADJ_LINE).length - 1;
  if (n !== 3) throw new Error(`adj 夾值修補：預期命中 3 次（roundRect / round1Rect / snip1Rect），實際 ${n} 次（vendor 版本改了？請檢查上游是否已修正）`);
  src = src.split(ADJ_LINE).join(ADJ_FIXED);
}

// 2. import.meta（classic script 不允許）
replaceOnce(/import\.meta\.resolve/, 'undefined', 'import.meta.resolve');
if (/\bimport\.meta\b/.test(src)) throw new Error('仍有其他 import.meta 用法，classic script 無法執行');
// 頂層靜態 import 不應存在（standalone 版已把依賴打包進來）
if (/^import\s/m.test(src)) throw new Error('vendor 檔有頂層 import，不是 standalone 版');

// 3. 結尾的 export 清單
let exported = null;
replaceOnce(/^export\s*\{([^}]*)\};?\s*$/m, (_, list) => {
  exported = list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
    if (!m) throw new Error(`無法解析 export 項目：${s}`);
    return `${m[2] || m[1]}: ${m[1]}`;
  });
  return `return { ${exported.join(', ')} };`;
}, 'export { … }');
if (/^export\s/m.test(src)) throw new Error('仍有其他 export 敘述');
if (!exported.some((e) => e.startsWith('PptxViewer:'))) throw new Error('export 清單沒有 PptxViewer');

// 1. IIFE 包裝 → window.PptxRenderer
const classic = `var PptxRenderer = (function () {\n'use strict';\n${src}\n})();\n`;

// JSON.stringify 負責跳脫（含 U+2028/2029 由 JSON 規格處理），安全放進 JS 字串
const block = `// ---- BEGIN pptx runtime（由 scripts/build-pptx-runtime.mjs 產生，請勿手改）----
// pptx 預覽文件內執行的渲染引擎原始碼字串（@aiden0z/pptx-renderer，內含 JSZip 與 ECharts）。
// 授權：@aiden0z/pptx-renderer 為 Apache-2.0（https://github.com/aiden0z/pptx-renderer）；內含的 mtx-decompressor
// 為 MPL-2.0、JSZip 為 MIT、ECharts 為 Apache-2.0。全文見 vendor/pptx-renderer/LICENSE 與 THIRD_PARTY_NOTICES.md。
// 只在 sandbox 預覽文件內執行；內容是 vendor 原樣，僅做 ESM → classic script 的機械轉換，
// 外加一處修補（roundRect / round1Rect / snip1Rect 的 adj 依 ECMA-376 夾在 0–50000，見 scripts/build-pptx-runtime.mjs），
// 對不可信的 pptx 而言渲染器與頁面完全隔離。
(function (root) {
  'use strict';
  root.AdoPptxLibs = { pptxRenderer: ${JSON.stringify(classic)} };
})(typeof globalThis !== 'undefined' ? globalThis : window);
// ---- END pptx runtime ----
`;

const out = path.join(root, 'pptx-runtime.js');
fs.writeFileSync(out, block);
console.log(`updated ${out} (${block.length} chars; renderer ${classic.length}; exports: ${exported.map((e) => e.split(':')[0]).join(', ')})`);
