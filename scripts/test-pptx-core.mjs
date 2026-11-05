#!/usr/bin/env node
// pptx-core.js 的測試套件（make test）：自帶渲染器預覽文件的組裝正確性。
// 渲染層（@aiden0z/pptx-renderer 的視覺輸出）依 AGENTS.md 的視覺驗證規範在瀏覽器實測
// （紙張語意、對比、computed style、雙主題），這裡驗證文件組裝：
//   - payload base64 回還原與原檔逐位元一致
//   - 渲染引擎與 bootstrap 都帶 nonce、</script> 跳脫安全（防內容或函式庫關閉 script）
//   - 深／淺建置只有 data-theme 不同（外殼跟主題、內容 payload 一致＝紙張語意）
//   - 檔名 HTML 轉義
//   - pptx-runtime.js 的渲染引擎是可執行的 classic script（ESM 語法已轉換）且匯出 PptxViewer
//   - bootstrap 的安全設定：pdfjs 關閉、外部媒體封鎖、ZIP 上限
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
require(path.join(root, 'pptx-runtime.js'));
require(path.join(root, 'md-theme.js')); // 外殼主題 CSS 的來源（生產由 manifest / userscript 載入；測試不可漏）
require(path.join(root, 'pptx-core.js'));
const { AdoPptx, AdoPptxLibs } = global;

let failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✓ ' + msg); } else { console.error('  ✗ ' + msg); failed = 1; }
};

const fixture = path.join(os.tmpdir(), 'ado-pptx-fixture.pptx');
execFileSync('python3', [path.join(root, 'scripts', 'pptx-fixture.py'), fixture], { stdio: 'inherit' });
const buf = fs.readFileSync(fixture);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

console.log('== 文件組裝 ==');
const light = AdoPptx.buildDocument({ arrayBuffer: ab, fileName: 'Deck_v3.pptx', theme: 'light', nonce: 'TESTNONCE' });
const dark = AdoPptx.buildDocument({ arrayBuffer: ab, fileName: 'Deck_v3.pptx', theme: 'dark', nonce: 'TESTNONCE' });
assert(light.startsWith('<!DOCTYPE html>'), '輸出為完整 HTML 文件');
assert((light.match(/<script/g) || []).length === 2, '兩個 script（pptx-renderer＋bootstrap）');
assert((light.match(/nonce="TESTNONCE"/g) || []).length === 2, '兩個 script 都帶 CSP nonce');
assert(light.includes('data-theme="light"') && dark.includes('data-theme="dark"'), '外殼初始主題分深淺');
assert(light.includes('.md-bar') && light.includes('--fg'), '外殼主題 CSS（AdoMarkdownTheme）已內嵌（測試須載入 md-theme.js）');
assert(light.includes('id="xp-stage"') && light.includes('id="xp-scroll"') && light.includes('id="xp-count"'), '舞台、捲動容器與張數指示齊備');

console.log('== payload 完整性 ==');
const m = light.match(/"payload":"([A-Za-z0-9+/=]+)"/);
assert(!!m, 'payload 以 base64 內嵌');
const back = Buffer.from(m[1], 'base64');
assert(back.equals(buf), `payload 回還原與原檔逐位元一致（${back.length} 位元組）`);

console.log('== 紙張語意（組裝層） ==');
const strip = (h) => h.replace(/data-theme="[a-z]+"/g, 'data-theme="X"').replace(/"theme":"[a-z]+"/g, '"theme":"X"');
assert(strip(light) === strip(dark), '深／淺建置僅 data-theme 不同（內容 payload 與渲染引擎一致）');

console.log('== 注入安全 ==');
const evil = AdoPptx.buildDocument({
  arrayBuffer: ab, fileName: '<img src=x onerror=alert(1)>.pptx', theme: 'light', nonce: '',
  libs: { pptxRenderer: 'var a="</script><script>alert(1)</script>";' },
});
assert(!evil.includes('<img src=x onerror'), '檔名已 HTML 轉義');
assert(!evil.includes('</script><script>alert(1)'), '函式庫內的 </script> 已跳脫（不會關閉 script 標籤）');
assert((evil.match(/<script>/g) || []).length >= 2, 'nonce 為空時 script 仍正常建立（全螢幕模式）');
let threw = false;
try { AdoPptx.buildDocument({ arrayBuffer: ab, fileName: 'x.pptx', libs: {} }); } catch { threw = true; }
assert(threw, '渲染引擎缺席時明確報錯（不產出空殼文件）');

console.log('== bootstrap 安全設定 ==');
assert(/pdfjs:\s*false/.test(light), 'pdfjs: false（不載 PDF.js：需要 eval / worker，內嵌 CSP 跑不起來）');
assert(/externalMedia:\s*'block'/.test(light), "externalMedia: 'block'（預覽不向外部網址抓媒體）");
assert(/zipLimits:\s*R\.RECOMMENDED_ZIP_LIMITS/.test(light), 'zipLimits 套用 RECOMMENDED_ZIP_LIMITS（解壓縮炸彈防護）');
assert(/lazyMedia:\s*true/.test(light) && /windowed:\s*true/.test(light), '大型簡報：lazyMedia＋windowed 清單');

console.log('== 渲染引擎（pptx-runtime.js） ==');
const src = AdoPptxLibs && AdoPptxLibs.pptxRenderer;
assert(typeof src === 'string' && src.length > 100000, `渲染引擎原始碼字串已載入（${src ? src.length : 0} 字元）`);
let parsed = false;
try { new vm.Script(src); parsed = true; } catch (e) { console.error('    ' + e.message); }
assert(parsed, '可當 classic script 解析（export / import.meta 已轉換）');
assert(!/^export\s/m.test(src) && !/\bimport\.meta\b/.test(src), '不含 ESM 專屬語法');
assert(/^var PptxRenderer = \(function \(\) \{\n'use strict';/.test(src), 'IIFE 包裝＋strict mode（維持 ESM 語意）');
assert(/return \{[^}]*\bPptxViewer: /.test(src) && /RECOMMENDED_ZIP_LIMITS: /.test(src), '匯出 PptxViewer 與 RECOMMENDED_ZIP_LIMITS');
assert(!src.includes('const r = ze(n, "adj", 16667), i = Math.min(t, e) * r;') && (src.match(/Math\.min\(Math\.max\(ze\(n, "adj", 16667\), 0\), 0\.5\)/g) || []).length === 3,
  'roundRect / round1Rect / snip1Rect 的 adj 已依 ECMA-376 夾在 0–50000（上游缺漏的修補）');
assert(light.includes(src.slice(0, 2000).replace(/<\/script/gi, '<\\/script')), '預覽文件內含渲染引擎原始碼');
assert(AdoPptx.toBase64(ab).length > 0, 'toBase64 可用');

fs.rmSync(fixture, { force: true });
console.log(failed ? 'FAILED' : 'ALL PASS');
process.exit(failed);
