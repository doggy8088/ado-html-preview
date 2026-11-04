#!/usr/bin/env node
// 產生 docx-runtime.js：把 vendor 的 docx-preview 與 JSZip 以「原始碼字串」打包成 AdoDocxLibs。
// 這兩個函式庫不在父世界執行——只會被 docx-core.js 寫進 sandbox 預覽文件內執行（安全面乾淨：
// 文件內容的渲染器與 Azure DevOps 頁面完全隔離）。userscript 也是內嵌這份字串檔（不重複載入函式庫）。
// 用法：node scripts/build-docx-runtime.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const src = {
  jszip: read('vendor/jszip.min.js'),
  docxPreview: read('vendor/docx-preview.min.js'),
};

// JSON.stringify 負責跳脫（含 U+2028/2029 由 JSON 規格處理），安全放進 JS 字串
const block = `// ---- BEGIN docx runtime（由 scripts/build-docx-runtime.mjs 產生，請勿手改）----
// docx 預覽文件內執行的渲染引擎原始碼字串（JSZip + docx-preview）。
// 只在 sandbox 預覽文件內執行；內容是 vendor 原樣，對不可信的 docx 而言渲染器與頁面完全隔離。
(function (root) {
  'use strict';
  root.AdoDocxLibs = { jszip: ${JSON.stringify(src.jszip)}, docxPreview: ${JSON.stringify(src.docxPreview)} };
})(typeof globalThis !== 'undefined' ? globalThis : window);
// ---- END docx runtime ----
`;

const out = path.join(root, 'docx-runtime.js');
fs.writeFileSync(out, block);
console.log(`updated ${out} (${block.length} chars; jszip ${src.jszip.length}, docx-preview ${src.docxPreview.length})`);
