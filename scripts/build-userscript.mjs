#!/usr/bin/env node
// 把 vendor 函式庫（marked / DOMPurify / highlight.js）與 md-core.js / md-shell.js / md-theme.js
// 同步到 Tampermonkey 版本的 userscript。
// 不用 @require：dev.azure.com 頁面有 AMD 的 define（VSS loader），UMD 函式庫會走 AMD 分支而不會掛到 window；
// 這裡把函式庫包在遮蔽了 define / module / exports、並以 mdLibs 當 globalThis 的函式中執行，讓它們掛到 mdLibs 上。
// userscript 的按鈕 / 內嵌邏輯仍以手動維護，此腳本只替換兩個標記之間的「Markdown 模組」區段：
//   // ---- BEGIN md modules (由 scripts/build-userscript.mjs 產生，請勿手改) ----
//   // ---- END md modules ----
// 用法：node scripts/build-userscript.mjs [userscript 路徑]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] || path.join(os.homedir(), 'projects/TampermonkeyUserscripts/src/AzureDevOpsHtmlPreview.user.js');
const BEGIN = '// ---- BEGIN md modules (由 scripts/build-userscript.mjs 產生，請勿手改) ----';
const END = '// ---- END md modules ----';

const vendors = [
  // [檔名, 執行後要從包裝函式帶出來的變數（IIFE 以 var 宣告的全域，如 hljs）]
  ['vendor/marked.min.js', null],
  ['vendor/purify.min.js', null],
  ['vendor/highlight.min.js', 'hljs'],
].map(([f, local]) => {
  const src = fs.readFileSync(path.join(root, f), 'utf8').trimEnd();
  const tail = local ? `\n        mdLibs.${local} = ${local};` : '';
  return `    // ---- ${f}（原樣內嵌，請勿手改）----\n` +
    // 只遮蔽 define / module / exports / globalThis：window 與 self 要保留真的，DOMPurify 建立實例時需要 window.document
    `    (function (define, module, exports, globalThis) {\n${src}${tail}\n    }).call(mdLibs, undefined, undefined, undefined, mdLibs);`;
});

const modules = ['md-core.js', 'md-theme.js', 'md-shell.js'].map((f) => {
  let src = fs.readFileSync(path.join(root, f), 'utf8').trimEnd();
  // 模組最後一行是 })(typeof globalThis !== 'undefined' ? globalThis : window); → 改成掛在 userscript 內的 mdLibs 物件上
  const tail = "})(typeof globalThis !== 'undefined' ? globalThis : window);";
  if (!src.endsWith(tail)) throw new Error(`${f} 結尾不是預期的 IIFE 呼叫`);
  src = src.slice(0, -tail.length) + '})(mdLibs);';
  return `    // ---- ${f} ----\n` + src.split('\n').map((l) => (l ? '    ' + l : l)).join('\n');
});

const block = `${BEGIN}
    // 與擴充功能相同的函式庫與 Markdown 轉換模組。mdLibs 同時當作函式庫的掛載點（marked / DOMPurify / hljs）
    // 與模組輸出位置（AdoMarkdown / AdoMarkdownTheme / AdoMarkdownShell），避免污染 Azure DevOps 頁面的 window。
    const mdLibs = {};
${vendors.join('\n\n')}

${modules.join('\n\n')}
    ${END}`;

const src = fs.readFileSync(target, 'utf8');
const a = src.indexOf(BEGIN);
const b = src.indexOf(END);
if (a < 0 || b < 0 || b < a) throw new Error(`${target} 找不到標記 ${BEGIN} … ${END}`);
const out = src.slice(0, a) + block + src.slice(b + END.length);
fs.writeFileSync(target, out);
console.log(`updated ${target} (${out.length} chars)`);
