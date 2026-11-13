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
{
  // 雙調整值的四個圖形：靜態檢查修補已套用，並實際執行圖形路徑函式（adj 超標時圓角 / 切角不得超過短邊一半）
  const shapes = ['round2SameRect', 'round2DiagRect', 'snip2SameRect', 'snipRoundRect'];
  const clamp = (name) => `Math.min(Math.max(ze(n, "${name}", `;
  const fnSrc = (shape) => {
    const i = src.indexOf(`q.set("${shape}", (t, e, n) => {`);
    if (i < 0) return '';
    const j = src.indexOf('\nq.set(', i + 1);
    return j < 0 ? '' : src.slice(i, j);
  };
  const ok = shapes.every((s) => { const f = fnSrc(s); return f.includes(clamp('adj1')) && f.includes(clamp('adj2')); });
  assert(ok, `${shapes.join(' / ')} 的 adj1 / adj2 已依 ECMA-376 夾在 0–50000`);
  let maxR = 0, ran = 0;
  for (const s of shapes) {
    const f = fnSrc(s);
    if (!f) continue;
    const q = new Map();
    vm.runInNewContext(f, { q, ze: (m, k, d) => ((m && m.get(k)) ?? d) / 1e5 });
    const d = q.get(s)(200, 100, new Map([['adj1', 140944], ['adj2', 140944]]));
    for (const m of d.matchAll(/A([\d.]+),/g)) maxR = Math.max(maxR, +m[1]);
    for (const m of d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)) if (+m[1] < 0 || +m[1] > 200 || +m[2] < 0 || +m[2] > 100) maxR = Infinity;
    ran++;
  }
  assert(ran === 4 && maxR <= 50, `adj=140944 時四個圖形的弧半徑 ≤ 短邊一半、頂點不超出外框（最大半徑 ${maxR}，短邊 100）`);
}
assert(light.includes(src.slice(0, 2000).replace(/<\/script/gi, '<\\/script')), '預覽文件內含渲染引擎原始碼');
assert(AdoPptx.toBase64(ab).length > 0, 'toBase64 可用');

console.log('== 外殼配色：錯誤訊息對比（WCAG AA 4.5:1，深淺兩套 token 都要過） ==');
{
  // 錯誤狀態寫死顏色時只會在其中一個主題可讀（v0.4.1 前的 #a4262c 在深色 --bg-sunken 只有 2.03:1）
  const css = global.AdoMarkdownTheme.css;
  const block = (sel) => { const i = css.indexOf(sel + ' {'); return i < 0 ? '' : css.slice(i, css.indexOf('}', i)); };
  const tok = (b, name) => (new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})').exec(b) || [])[1];
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const rule = (/#xp-status\.xp-error\{color:([^};]+)/.exec(light) || [])[1] || '';
  const v = (/^var\(--([\w-]+)\)$/.exec(rule.trim()) || [])[1];
  assert(!!v, `錯誤訊息字色引用主題 token（實際 ${rule || '缺'}）`);
  // 底色＝.xp-main 的 --bg-sunken
  assert(/\.xp-main\{background:var\(--bg-sunken/.test(light), '錯誤訊息所在的 .xp-main 底色是 --bg-sunken');
  for (const [name, sel] of [['淺色', ':root'], ['深色', 'html[data-theme="dark"]']]) {
    const fg = v && tok(block(sel), v), bg = tok(block(sel), 'bg-sunken');
    const r = fg && bg ? contrast(fg, bg) : 0;
    assert(r >= 4.5, `${name}：錯誤訊息 ${fg} on ${bg} = ${r.toFixed(2)}:1 ≥ 4.5`);
  }
  // 外殼 CSS 引用的變數都要在主題定義（不存在時靜默退回 fallback）
  const defined = new Set(css.match(/--[\w-]+(?=\s*:)/g) || []);
  const used = [...new Set((fs.readFileSync(path.join(root, 'pptx-core.js'), 'utf8').match(/var\(--[\w-]+/g) || []).map((x) => x.slice(4)))];
  const undef = used.filter((x) => !defined.has(x));
  assert(undef.length === 0, `pptx-core.js 引用的 CSS 變數都在主題中定義${undef.length ? '（未定義：' + undef.join(' ') + '）' : ''}`);
}

console.log('== <script> 內 JSON 跳脫 ==');
{
  const x = AdoPptx.buildDocument({ arrayBuffer: ab, fileName: 'x.pptx', theme: '</script><script>alert(1)</script><!--', nonce: '' });
  const tail = x.slice(x.lastIndexOf('<script>'));
  assert(!tail.includes('</script><script>alert(1)') && !tail.includes('<!--'), "cfg JSON 內的 '<' 已跳脫為 \\u003c（不會關閉 script 標籤）");
  assert(tail.includes('\\u003c/script>\\u003cscript>alert(1)'), 'cfg 以 \\u003c 保留原值（JS 讀到的字串不變）');
}

console.log('== 無法解碼的圖片：佔位框（bootstrap 以假 DOM 執行） ==');
{
  // 取出預覽文件的 bootstrap，在沒有渲染引擎的假 DOM 裡跑：它會先掛上 document 的 error 捕獲處理器，
  // 再因找不到 window.PptxRenderer 而顯示錯誤並結束——足以單獨驗證佔位框邏輯
  const XLINK = 'http://www.w3.org/1999/xlink';
  const mkEl = (tag, attrs = {}) => {
    const a = new Map(Object.entries(attrs));
    const ns = new Map();
    const el = {
      tagName: tag, style: {}, children: [], parentNode: null,
      getAttribute: (k) => (a.has(k) ? a.get(k) : null),
      setAttribute: (k, val) => { a.set(k, String(val)); },
      hasAttribute: (k) => a.has(k),
      hasAttributeNS: (n, k) => ns.has(n + '|' + k),
      removeAttributeNS: (n, k) => { ns.delete(n + '|' + k); },
      setAttributeNS: (n, k, val) => { ns.set(n + '|' + k, val); },
      appendChild: (c) => { el.children.push(c); c.parentNode = el; return c; },
      insertBefore: (c, ref) => { el.children.splice(Math.max(0, el.children.indexOf(ref)), 0, c); c.parentNode = el; return c; },
    };
    return el;
  };
  let onError = null;
  const status = mkEl('div');
  const document = {
    documentElement: mkEl('html'),
    querySelector: () => null,
    getElementById: (id) => (id === 'xp-status' ? status : mkEl('div')),
    addEventListener: (type, fn, capture) => { if (type === 'error' && capture) onError = fn; },
    createElementNS: (n, tag) => mkEl(tag),
  };
  const boot = light.slice(light.lastIndexOf('<script nonce="TESTNONCE">') + '<script nonce="TESTNONCE">'.length, light.lastIndexOf('</script>'));
  let ran = false;
  try { vm.runInNewContext(boot, { document, window: {}, encodeURIComponent }); ran = true; } catch (e) { console.error('    ' + e.message); }
  assert(ran && typeof onError === 'function', 'bootstrap 在 document 上以捕獲階段掛 error 處理器');
  assert(/渲染引擎未載入/.test(status.textContent || ''), '渲染引擎缺席時顯示錯誤訊息');

  // 1. 已離開 DOM 的 SVG <image>（清單重建 / lazy 卸載）：不得拋例外（先前 el.parentNode.insertBefore 會 TypeError）
  const orphan = mkEl('image', { x: '0', y: '0', width: '400', height: '300' });
  let threwOrphan = false;
  try { onError({ target: orphan }); } catch (e) { threwOrphan = true; console.error('    ' + e.message); }
  assert(!threwOrphan, '已離開 DOM 的 <image> 觸發 error 時不拋例外');

  // 2. 在 DOM 中的 SVG <image>：插入虛線框、拿掉 xlink:href、改指向說明標籤
  const g = mkEl('g');
  const img = mkEl('image', { x: '10', y: '20', width: '800', height: '600' });
  img.setAttributeNS(XLINK, 'href', 'data:image/tiff;base64,AAAA');
  g.appendChild(img);
  onError({ target: img });
  assert(g.children.length === 2 && g.children[0].tagName === 'rect' && g.children[0].getAttribute('stroke-dasharray'), '原位置插入虛線框（<rect>）');
  assert(!img.hasAttributeNS(XLINK, 'href'), '壞掉的 xlink:href 已移除（不與新的 href 並存）');
  assert(/^data:image\/svg\+xml/.test(img.getAttribute('href') || '') && img.getAttribute('data-xp-broken') === '1', 'href 改指向「無法顯示的圖片格式」標籤並標記已處理');
  const before = g.children.length;
  onError({ target: img });
  assert(g.children.length === before, '同一張圖不重複處理');

  // 3. HTML <img>
  const hi = mkEl('img');
  onError({ target: hi });
  assert(/^data:image\/svg\+xml/.test(hi.src || '') && hi.style.outline, '<img> 換成說明標籤＋虛線外框');
}

fs.rmSync(fixture, { force: true });
console.log(failed ? 'FAILED' : 'ALL PASS');
process.exit(failed);
