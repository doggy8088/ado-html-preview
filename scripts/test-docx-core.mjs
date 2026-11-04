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
assert(light.includes('.md-bar') && light.includes('--text'), '外殼主題 CSS（AdoMarkdownTheme）已內嵌（測試須載入 md-theme.js）');

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

fs.rmSync(fixture, { force: true });
console.log(failed ? 'FAILED' : 'ALL PASS');
process.exit(failed);
