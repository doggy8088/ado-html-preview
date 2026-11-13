#!/usr/bin/env node
// docx-core.js 的測試套件（make test）：自帶渲染器預覽文件的組裝正確性。
// 渲染層（docx-preview 端的視覺輸出）依 AGENTS.md 的視覺驗證規範在瀏覽器實測
// （紙張語意、對比、computed style、雙主題），這裡驗證文件組裝：
//   - payload base64 回還原與原檔逐位元一致
//   - 渲染引擎原始碼與 bootstrap 都帶 nonce、</script> 跳脫安全（防內容或函式庫關閉 script）
//   - 深／淺建置只有 data-theme 不同（外殼跟主題、內容 payload 一致＝紙張語意）
//   - 檔名 HTML 轉義
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
require(path.join(root, 'docx-runtime.js'));
require(path.join(root, 'md-theme.js')); // 外殼主題 CSS 的來源（生產由 manifest / userscript 載入；測試不可漏）
require(path.join(root, 'docx-core.js'));
const { AdoDocx } = global;

let failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✓ ' + msg); } else { console.error('  ✗ ' + msg); failed = 1; }
};

const fixture = path.join(os.tmpdir(), 'ado-docx-fixture.docx');
execFileSync('python3', [path.join(root, 'scripts', 'docx-fixture.py'), fixture], { stdio: 'inherit' });
const buf = fs.readFileSync(fixture);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

console.log('== 文件組裝 ==');
const light = AdoDocx.buildDocument({ arrayBuffer: ab, fileName: 'RFP_v3.docx', theme: 'light', nonce: 'TESTNONCE' });
const dark = AdoDocx.buildDocument({ arrayBuffer: ab, fileName: 'RFP_v3.docx', theme: 'dark', nonce: 'TESTNONCE' });
assert(light.startsWith('<!DOCTYPE html>'), '輸出為完整 HTML 文件');
assert((light.match(/<script/g) || []).length === 3, '三個 script（JSZip＋docx-preview＋bootstrap）');
assert((light.match(/nonce="TESTNONCE"/g) || []).length === 3, '三個 script 都帶 CSP nonce');
assert(light.includes('data-theme="light"') && dark.includes('data-theme="dark"'), '外殼初始主題分深淺');
assert(light.includes('.md-bar') && light.includes('--fg-muted:'), '外殼主題 CSS（AdoMarkdownTheme）已內嵌（測試須載入 md-theme.js）');
{
  // docx-core 自己的外殼 CSS 引用的變數都要在主題定義：不存在時靜默退回 fallback 淺色值（v0.3.3 前的 --text-2）
  const defined = new Set(global.AdoMarkdownTheme.css.match(/--[\w-]+(?=\s*:)/g) || []);
  const used = [...new Set((fs.readFileSync(path.join(root, 'docx-core.js'), 'utf8').match(/var\(--[\w-]+/g) || []).map((v) => v.slice(4)))];
  const undef = used.filter((v) => !defined.has(v));
  assert(undef.length === 0, `docx-core.js 引用的 CSS 變數都在主題中定義${undef.length ? '（未定義：' + undef.join(' ') + '）' : ''}`);
}

console.log('== payload 完整性 ==');
const m = light.match(/"payload":"([A-Za-z0-9+/=]+)"/);
assert(!!m, 'payload 以 base64 內嵌');
const back = Buffer.from(m[1], 'base64');
assert(back.equals(buf), `payload 回還原與原檔逐位元一致（${back.length} 位元組）`);

console.log('== 紙張語意（組裝層） ==');
const strip = (h) => h.replace(/data-theme="[a-z]+"/g, 'data-theme="X"').replace(/"theme":"[a-z]+"/g, '"theme":"X"');
assert(strip(light) === strip(dark), '深／淺建置僅 data-theme 不同（內容 payload 與渲染引擎一致）');

console.log('== 注入安全 ==');
const evil = AdoDocx.buildDocument({
  arrayBuffer: ab, fileName: '<img src=x onerror=alert(1)>.docx', theme: 'light', nonce: '',
  libs: { jszip: 'var a="</script><script>alert(1)</script>";', docxPreview: 'window.docx={renderAsync:function(){return Promise.resolve()}};' },
});
assert(!evil.includes('<img src=x onerror'), '檔名已 HTML 轉義');
assert(!evil.includes('</script><script>alert(1)'), '函式庫內的 </script> 已跳脫（不會關閉 script 標籤）');
assert((evil.match(/<script>/g) || []).length >= 3, 'nonce 為空時 script 仍正常建立（全螢幕模式）');

console.log('== 渲染引擎 ==');
assert(/renderAsync/.test(light) && /JSZip|jszip/i.test(light), '文件內含渲染引擎原始碼');
assert(AdoDocx.toBase64(ab).length > 0, 'toBase64 可用（content script 測試亦會用到）');

console.log('== 外殼配色：錯誤訊息對比（WCAG AA 4.5:1，深淺兩套 token 都要過） ==');
{
  // 錯誤狀態寫死顏色時只會在其中一個主題可讀（v0.4.1 前的 #a4262c 在深色底只有 2.27:1）：
  // 規則必須引用主題 token，並以 md-theme.js 兩套 token 的實際值量對比（底色＝.md-main 的 --bg-surface）
  const css = global.AdoMarkdownTheme.css;
  const block = (sel) => { const i = css.indexOf(sel + ' {'); return i < 0 ? '' : css.slice(i, css.indexOf('}', i)); };
  const tok = (b, name) => (new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})').exec(b) || [])[1];
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const rule = (/#xd-status\.xd-error\{color:([^};]+)/.exec(light) || [])[1] || '';
  const v = (/^var\(--([\w-]+)\)$/.exec(rule.trim()) || [])[1];
  assert(!!v, `錯誤訊息字色引用主題 token（實際 ${rule || '缺'}）`);
  for (const [name, sel] of [['淺色', ':root'], ['深色', 'html[data-theme="dark"]']]) {
    const fg = v && tok(block(sel), v), bg = tok(block(sel), 'bg-surface');
    const r = fg && bg ? contrast(fg, bg) : 0;
    assert(r >= 4.5, `${name}：錯誤訊息 ${fg} on ${bg} = ${r.toFixed(2)}:1 ≥ 4.5`);
  }
  assert(/#xd-stage\{[^}]*color-scheme:light/.test(light), '#xd-stage 宣告 color-scheme:light（文件內的表單控制項 / 捲軸維持紙張的淺色）');
}

console.log('== <script> 內 JSON 跳脫 ==');
{
  const x = AdoDocx.buildDocument({ arrayBuffer: ab, fileName: 'x.docx', theme: '</script><script>alert(1)</script><!--', nonce: '' });
  assert(!x.includes('</script><script>alert(1)') && !x.includes('<!--'), "cfg JSON 內的 '<' 已跳脫為 \\u003c（不會關閉 script 標籤）");
  assert(x.includes('\\u003c/script>\\u003cscript>alert(1)'), 'cfg 以 \\u003c 保留原值（JS 讀到的字串不變）');
}

fs.rmSync(fixture, { force: true });
console.log(failed ? 'FAILED' : 'ALL PASS');
process.exit(failed);
