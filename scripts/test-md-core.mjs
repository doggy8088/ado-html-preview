#!/usr/bin/env node
// md-core.js / md-shell.js / md-theme.js 的測試套件（make test）。
//
// 第一部分（node，必跑）：載入 vendor 的 marked / highlight.js 與三個 md-*.js（同 AGENTS.md 的離線檢視方式），驗證
//   - 圍籬判定：```inline``` 這種行內程式碼不是圍籬，後面的 [[_TOC_]] / ::: mermaid 仍有效；真的圍籬內不改寫
//   - 鬆散工作清單（<li><p><input>）也加上 .md-task
//   - 帶屬性 / 大寫 / 沒關閉的 <table> 都正確包上 .md-table-wrap，<div> 開關成對
//   - 目錄文字取自 marked tokens：屬性值含 > 的 inline HTML、只有圖片的標題（用 alt）、實體與轉義
//   - bootstrap 不直接呼叫 window.mermaid、捲動高亮不用 offsetTop；淺色主題三個 token 的 WCAG AA 對比
// 第二部分（headless Chrome，找得到才跑；CHROME=<path> 可指定、MD_TEST_NO_BROWSER=1 可略過）：
//   以 file:// 開啟 node 產出的預覽文件，讓真正的 bootstrap 執行，再由測試腳本把結果寫回 DOM（--dump-dom 取回）：
//   - 含 **粗體** / [連結] 的標題不再丟 NotFoundError，編號徽章與主副標正確，後續增強步驟照常執行
//   - .md-alert 內的標題：捲動高亮以捲動容器為基準
//   - 欄位拖曳在按鈕外放開後，下一次排序點擊不會被吞；pointercancel 不搬欄
//   - 「1.2.3」這類版本字串不當成數字排序
//   - id="mermaid" 冒充 window.mermaid 時 bootstrap 判定失敗（不丟未捕捉例外）；真的 mermaid 仍能畫圖
//   - DOMPurify（瀏覽器內）：img 的 name 被移除、<a name> 保留、hook 用完即移除、標題 id 保留
//
// 另有展示模式：node scripts/test-md-core.mjs --write-preview <輸出目錄> [--src <md-*.js 所在目錄>] [--label <名稱>]
//   以內建的展示用 Markdown 產出深／淺兩份預覽文件（file:// 可直接開啟），--src 可指向舊版程式做前後對照。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const srcDir = path.resolve(argOf('--src') || root);

// UMD 函式庫在 node 會走 module.exports 分支；用 runInThisContext 執行（此時沒有 module / exports），掛到 globalThis
const load = (file) => vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
load(path.join(root, 'vendor', 'marked.min.js'));
load(path.join(root, 'vendor', 'highlight.min.js'));
for (const f of ['md-theme.js', 'md-core.js', 'md-shell.js']) load(path.join(srcDir, f));
const { AdoMarkdown, AdoMarkdownShell, AdoMarkdownTheme } = globalThis;

const MERMAID_URL = pathToFileURL(path.join(root, 'vendor', 'mermaid.min.js')).href;

// ---------- 展示用 Markdown（前後對照與瀏覽器實測共用） ----------
const SHOWCASE_MD = [
  '# **Azure DevOps 預覽 — 已知問題回歸文件**',
  '',
  '行內程式碼 ```inline``` 出現在行首（不是圍籬），後面的 TOC 與 mermaid 仍要正常。',
  '',
  '[[_TOC_]]',
  '',
  '## **2.1 粗體標題**',
  '',
  '## [3.4 連結標題](https://example.com)',
  '',
  '## `4.2` 程式碼開頭',
  '',
  '## ![logo 圖片](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)',
  '',
  '## <a title="<b title=x>" href="#">屬性含大於號</a>',
  '',
  '## 符號 &amp; 實體 &#169; 與 \\*轉義\\*',
  '',
  '## Mermaid',
  '',
  '::: mermaid',
  'graph TD',
  '  A[開始] --> B[結束]',
  ':::',
  '',
  '## 工作清單',
  '',
  '- [ ] 鬆散項目一',
  '',
  '- [x] 鬆散項目二',
  '',
  '## 表格',
  '',
  '| 版本 | 數量 | 說明 |',
  '| --- | --- | --- |',
  '| 1.2.3 | 1,000 | 甲 |',
  '| 10.1.0 | 25 | 乙 |',
  '| 2.0.0 | 3.5 | 丙 |',
  '',
  '<table border="1"><tr><td>原始 HTML 表格（帶屬性）</td></tr></table>',
  '',
  '> [!NOTE]',
  '> ### 提示框內的標題',
  '> 提示框是 position: relative，offsetTop 會量錯。',
  '',
  ...Array.from({ length: 40 }, (_, i) => `段落 ${i + 1}：撐開文件高度，讓捲動高亮有空間。`),
  '',
  '## 結尾段落',
  '',
  ...Array.from({ length: 40 }, (_, i) => `結尾 ${i + 1}。`),
  '',
].join('\n');

function buildDoc(md, theme, extra = {}) {
  const r = AdoMarkdown.render(md);
  return AdoMarkdownShell.buildDocument({
    html: r.html, toc: r.toc, title: r.title, fileName: 'known-issues.md', theme,
    nonce: '', mermaidSrc: MERMAID_URL, mermaidFallback: false, ...extra,
  });
}

if (args.includes('--write-preview')) {
  const out = path.resolve(argOf('--write-preview'));
  const label = argOf('--label') || 'preview';
  fs.mkdirSync(out, { recursive: true });
  for (const theme of ['light', 'dark']) {
    const file = path.join(out, `${label}-${theme}.html`);
    fs.writeFileSync(file, buildDoc(SHOWCASE_MD, theme));
    console.log(pathToFileURL(file).href);
  }
  process.exit(0);
}

let failed = 0;
const assert = (cond, msg, detail) => {
  if (cond) console.log('  ✓ ' + msg);
  else { console.error('  ✗ ' + msg + (detail !== undefined ? '\n      ' + JSON.stringify(detail) : '')); failed = 1; }
};
const count = (s, re) => (s.match(re) || []).length;

// ---------- 第一部分：node ----------
console.log('== 圍籬判定 ==');
{
  const r = AdoMarkdown.render('```inline``` text\n\n[[_TOC_]]\n\n# A\n\n::: mermaid\ngraph TD\n  A-->B\n:::\n');
  assert(r.html.includes('<code>inline</code>'), '```inline``` 渲染為行內程式碼');
  assert(r.html.includes('md-toc-inline'), '行內 ``` 之後的 [[_TOC_]] 仍換成目錄', r.html);
  assert(r.hasMermaid && r.html.includes('class="md-mermaid"'), '行內 ``` 之後的 ::: mermaid 仍轉成圖', r.html);
  const fenced = AdoMarkdown.render('```\n[[_TOC_]]\n::: mermaid\ngraph TD\n:::\n```\n\n# B\n');
  assert(fenced.html.includes('[[_TOC_]]') && !fenced.html.includes('md-toc-inline') && !fenced.hasMermaid, '真的圍籬內不改寫 [[_TOC_]] / ::: mermaid');
  const tilde = AdoMarkdown.render('~~~ info `x` ok\n[[_TOC_]]\n~~~\n\n# C\n');
  assert(tilde.html.includes('[[_TOC_]]') && !tilde.html.includes('md-toc-inline'), '~~~ 圍籬的 info string 可含反引號');
  const four = AdoMarkdown.render('````\n```\n[[_TOC_]]\n```\n````\n\n[[_TOC_]]\n\n# D\n');
  assert(four.html.includes('[[_TOC_]]') && count(four.html, /md-toc-inline/g) === 1, '````（4 個）圍籬內的 ``` 不會提早關閉，圍籬外的 [[_TOC_]] 照常');
}

console.log('== 工作清單 ==');
{
  const loose = AdoMarkdown.render('- [ ] a\n\n- [x] b\n');
  assert(count(loose.html, /<li class="md-task">/g) === 2, '鬆散工作清單兩項都有 .md-task', loose.html);
  const tight = AdoMarkdown.render('- [ ] a\n- [x] b\n- c\n');
  assert(count(tight.html, /<li class="md-task">/g) === 2, '緊湊工作清單只標 checkbox 項目', tight.html);
}

console.log('== 表格包裝 ==');
{
  const balanced = (h) => count(h, /<div\b/g) === count(h, /<\/div>/g);
  const attr = AdoMarkdown.render('<table border="1"><tr><td>x</td></tr></table>\n');
  assert(/<div class="md-table-wrap"><table border="1">/.test(attr.html) && balanced(attr.html), '<table border="1"> 包上 .md-table-wrap、沒有落單的 </div>', attr.html);
  const md = AdoMarkdown.render('| a | b |\n| - | - |\n| 1 | 2 |\n');
  assert(md.html.includes('<div class="md-table-wrap"><table>') && balanced(md.html), 'Markdown 表格照常包裝');
  const upper = AdoMarkdown.render('<TABLE class="x"><tr><td>x</td></tr></TABLE>\n');
  assert(count(upper.html, /md-table-wrap/g) === 1 && balanced(upper.html), '大寫 <TABLE> 也成對包裝', upper.html);
  const nested = AdoMarkdown.render('<table><tr><td><table data-x=">"><tr><td>y</td></tr></table></td></tr></table>\n');
  assert(count(nested.html, /md-table-wrap/g) === 2 && balanced(nested.html), '巢狀表格與屬性值含 > 時開關成對', nested.html);
  const unclosed = AdoMarkdown.render('<table><tr><td>z\n');
  assert(balanced(unclosed.html) && /<\/table><\/div>\s*$/.test(unclosed.html), '沒關閉的 <table> 在文末補齊', unclosed.html);
  const stray = AdoMarkdown.render('</table>\n\ntext\n');
  assert(balanced(stray.html), '落單的 </table> 不補 </div>', stray.html);
}

console.log('== 目錄文字與錨點 ==');
{
  const r = AdoMarkdown.render([
    '# 主標 — 副標',
    '## <a title="<b title=x>" href="#">x</a>',
    '## ![alt text](u.png)',
    '## **Bold** & `a<b>`',
    '## A &amp; B &#169; &#x41;',
    '## 1 < 2',
    '## 2.1 Title',
    '## \\*literal\\*',
    '## ![logo](x.png) Intro',
    '## ![A &amp; B](u.png)',
  ].join('\n\n'));
  const t = r.toc;
  assert(r.title === '主標 — 副標', 'title 為純文字', r.title);
  assert(t[1].text === 'x' && t[1].id === 'x', '屬性值含 > 的 inline HTML 標題：目錄文字為 x', t[1]);
  assert(t[2].text === 'alt text' && t[2].id === 'alt-text', '只有圖片的標題用 alt 文字', t[2]);
  assert(t[3].text === 'Bold &amp; a&lt;b&gt;' && t[3].id === 'bold-ab', '粗體 / 程式碼標題：文字已轉義', t[3]);
  assert(t[4].text === 'A &amp; B © A' && t[4].id === 'a-b-a', '實體解碼後再轉義（&amp; / &#169; / &#x41;；具名實體的完整解碼在瀏覽器段落驗證）', t[4]);
  assert(t[5].text === '1 &lt; 2' && t[5].id === '1-2', '< 轉義', t[5]);
  assert(t[6].id === '21-title', '一般標題的錨點與舊版相同（2.1 Title → 21-title）', t[6]);
  assert(t[7].text === '*literal*', '\\* 轉義字元保留原字', t[7]);
  assert(t[8].text === 'Intro' && t[8].id === 'intro', '圖片＋文字的標題：目錄與錨點只取文字（與舊版錨點一致）', t[8]);
  assert(t[9].text === 'A &amp; B' && t[9].id === 'a-b', '只有圖片的標題含 HTML 實體：alt 解碼後再轉義（A &amp; B → a-b）', t[9]);
  const toc = AdoMarkdown.tocHtml(t, 'x');
  assert(toc.includes('>1 &lt; 2</a>') && !/<b title/.test(toc), 'tocHtml 輸出不含未轉義的標籤', toc);
}

console.log('== bootstrap 原始碼 ==');
{
  const doc = buildDoc('# a\n\n## b\n', 'light');
  const script = doc.slice(doc.indexOf('<script', doc.indexOf('</main>')));
  assert(!/window\.mermaid\.(render|initialize)/.test(script) && script.includes('function getMermaid'), 'mermaid 一律經 getMermaid() 型別檢查後才呼叫');
  assert(!/heads\[i\]\.offsetTop/.test(script) && /heads\[i\]\.getBoundingClientRect\(\)\.top-base/.test(script), '捲動高亮不使用 offsetTop');
  assert(/catch\(e\)\{if\(window\.console&&console\.warn\)console\.warn\('\[md-preview\] enhancement step failed'/.test(script), 'enhanceDocument 每個步驟各自 try/catch');
  try { new vm.Script(script.replace(/^<script[^>]*>/, '').replace(/<\/script>[\s\S]*$/, '')); assert(true, 'bootstrap 語法正確'); } catch (e) { assert(false, 'bootstrap 語法正確', String(e)); }
}

console.log('== 主題對比（淺色 WCAG AA 4.5:1） ==');
{
  const css = AdoMarkdownTheme.css;
  const block = (sel) => { const i = css.indexOf(sel); return css.slice(i, css.indexOf('}', i)); };
  const tok = (blk, name) => { const m = blk.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})')); return m && m[1]; };
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const light = block(':root');
  const pairs = [['fg-faint', 'bg-surface'], ['fg-faint', 'bg-app'], ['fg-faint', 'bg-sunken'], ['fg-faint', 'bg-code-head'], ['danger', 'bg-sunken'], ['danger', 'bg-surface'], ['hl-type', 'bg-code']];
  for (const [fg, bg] of pairs) {
    const a = tok(light, fg), b = tok(light, bg);
    const r = a && b ? ratio(a, b) : 0;
    assert(r >= 4.5, `--${fg} ${a} 於 --${bg} ${b}：${r.toFixed(2)}:1`);
  }
  assert(!/md-prose|md-reference|is-cjk/.test(css), '未使用的 .md-prose / .md-reference / .is-cjk 已移除');
}

// ---------- 第二部分：headless Chrome ----------
function findChrome() {
  if (process.env.MD_TEST_NO_BROWSER) return null;
  const cands = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return cands.find((p) => p && fs.existsSync(p)) || null;
}

// 在預覽文件結尾（bootstrap 之後）加測試腳本；結果寫進 <pre id="md-test-result">，--dump-dom 取回
function runInChrome(chrome, html, tmp, name) {
  const file = path.join(tmp, name + '.html');
  fs.writeFileSync(file, html);
  const out = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--user-data-dir=' + path.join(tmp, 'profile-' + name), '--window-size=1200,900',
    '--virtual-time-budget=20000', '--dump-dom', pathToFileURL(file).href,
  ], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  const m = out.match(/<pre id="md-test-result">([\s\S]*?)<\/pre>/);
  if (!m) return { error: 'no result in dumped DOM' };
  const txt = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  try { return JSON.parse(txt); } catch (e) { return { error: 'bad JSON: ' + txt.slice(0, 300) }; }
}

const HARNESS_PRE = `<script>window.__errors=[];window.addEventListener('error',function(e){window.__errors.push(String(e.message||e.error));});window.addEventListener('unhandledrejection',function(e){window.__errors.push('rejection: '+String(e.reason&&e.reason.message||e.reason));});</script>`;
const injectHarness = (doc, testJs) => doc
  .replace('<head>', '<head>' + HARNESS_PRE)
  .replace('</body>', `<script>(function(){var R={};function done(){var p=document.createElement('pre');p.id='md-test-result';p.textContent=JSON.stringify(R);document.body.appendChild(p);}
try{${testJs}}catch(e){R.harnessError=String(e&&e.stack||e);done();}})();</script></body>`);

const chrome = findChrome();
if (!chrome) {
  console.log('== 瀏覽器實測：略過（找不到 Chrome；可用 CHROME=<path> 指定） ==');
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ado-md-test-'));
  console.log('== 瀏覽器實測：標題 / 表格 / 捲動高亮（' + path.basename(chrome) + '） ==');
  {
    const doc = injectHarness(buildDoc(SHOWCASE_MD, 'light'), `
var $=function(s){return document.querySelector(s);};
var h1=$('.md-content h1');
R.h1Title=h1.querySelector('.md-title')&&h1.querySelector('.md-title').textContent;
R.h1Sub=h1.querySelector('.md-subtitle')&&h1.querySelector('.md-subtitle').textContent;
R.h1InStrong=!!h1.querySelector('strong .md-subtitle');
var hb=document.getElementById('21-粗體標題');var nb=hb&&hb.querySelector('.md-h-num');
R.boldNum=nb&&nb.textContent;R.boldNumDirect=!!(nb&&nb.parentNode===hb);R.boldNumBeforeStrong=!!(nb&&nb.nextElementSibling&&nb.nextElementSibling.tagName==='STRONG');R.boldText=hb&&hb.querySelector('strong').textContent;
var hl=document.getElementById('34-連結標題');var nl=hl&&hl.querySelector('.md-h-num');
R.linkNum=nl&&nl.textContent;R.linkNumOutsideLink=!!(nl&&nl.parentNode===hl);R.linkText=hl&&hl.querySelector('a:not(.md-anchor)').textContent;
R.readingMeta=!!$('.md-doc-meta');R.tableTools=document.querySelectorAll('.md-table-tools').length;
R.tocTexts=[].map.call(document.querySelectorAll('.md-toc a'),function(a){return a.textContent;});
R.rawTableWrapped=!!$('.md-table-wrap > table[border="1"]');
R.looseCbs=[].map.call(document.querySelectorAll('.md-content li.md-task > p:first-child > input[type="checkbox"]'),function(cb){var cs=getComputedStyle(cb);var aft=getComputedStyle(cb,'::after');return {checked:cb.checked,appearance:cs.appearance,width:cs.width,height:cs.height,afterContent:aft.content};});
// 捲動高亮：初始在頂端時不應高亮提示框內的標題（offsetTop 會量成相對 .md-alert 的小數字）
var main=$('.md-main');
var alertH=$('.md-alert h3');
R.alertHeadingId=alertH&&alertH.id;
R.activeAtTop=($('.md-toc a.is-active')||{}).textContent;
main.scrollTop=alertH.getBoundingClientRect().top-main.getBoundingClientRect().top+main.scrollTop-40;
main.dispatchEvent(new Event('scroll'));
requestAnimationFrame(function(){requestAnimationFrame(function(){
  R.activeAtAlert=($('.md-toc a.is-active')||{}).textContent;
  main.scrollTop=0;
  // 欄位拖曳：在按鈕外（document.body）放開，接著的排序點擊不可被吞
  var wrap=document.querySelector('.md-table-wrap.is-sortable');var ths=wrap.querySelectorAll('thead th');
  var r0=ths[0].getBoundingClientRect(),r2=ths[2].getBoundingClientRect();
  var btn0=ths[0].querySelector('.md-th-sort');
  btn0.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:r0.left+5,clientY:r0.top+5,pointerId:1}));
  document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:r2.right-2,clientY:r0.top+5,pointerId:1}));
  document.body.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,clientX:r2.right-2,clientY:r0.top+5,pointerId:1}));
  var heads=function(){return [].map.call(wrap.querySelectorAll('thead th'),function(t){return t.textContent.trim();});};
  R.afterDrag=heads();
  setTimeout(function(){
    var verTh=[].filter.call(wrap.querySelectorAll('thead th'),function(t){return t.textContent.trim()==='版本';})[0];
    verTh.querySelector('.md-th-sort').click();
    R.sortAfterDrag=verTh.getAttribute('aria-sort');
    var vi=[].indexOf.call(verTh.parentNode.cells,verTh);
    R.versionOrder=[].map.call(wrap.querySelectorAll('tbody tr'),function(tr){return tr.cells[vi].textContent.trim();});
    var cntTh=[].filter.call(wrap.querySelectorAll('thead th'),function(t){return t.textContent.trim()==='數量';})[0];
    cntTh.querySelector('.md-th-sort').click();
    var ci=[].indexOf.call(cntTh.parentNode.cells,cntTh);
    R.countOrder=[].map.call(wrap.querySelectorAll('tbody tr'),function(tr){return tr.cells[ci].textContent.trim();});
    // pointercancel：不搬欄
    var before=heads();var t1=wrap.querySelectorAll('thead th')[1];var b1=t1.querySelector('.md-th-sort');var q=t1.getBoundingClientRect();
    b1.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:q.left+5,clientY:q.top+5,pointerId:2}));
    document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:q.left+200,clientY:q.top+5,pointerId:2}));
    document.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:2}));
    R.cancelKeepsOrder=JSON.stringify(before)===JSON.stringify(heads());
    setTimeout(function(){
      var any=[].filter.call(wrap.querySelectorAll('thead th'),function(t){return !t.hasAttribute('aria-sort');})[0];any.querySelector('.md-th-sort').click();
      R.sortAfterCancel=any.getAttribute('aria-sort');
      // 真的 mermaid（id="mermaid" 標題存在時）仍能畫圖
      var tries=0;(function wait(){var svg=document.querySelector('.md-mermaid > svg');if(svg||tries++>100){R.mermaidSvg=!!svg;R.errors=window.__errors;done();}else setTimeout(wait,100);})();
    },10);
  },10);
});});
`);
    const R = runInChrome(chrome, doc, tmp, 'showcase');
    if (R.error || R.harnessError) assert(false, '瀏覽器測試頁執行', R);
    else {
      assert(R.h1Title === 'Azure DevOps 預覽' && R.h1Sub === '已知問題回歸文件' && R.h1InStrong, '# **主 — 副**：在 <strong> 內拆成主副標', R);
      assert(R.boldNum === '2.1' && R.boldNumDirect && R.boldNumBeforeStrong && R.boldText === '粗體標題', '## **2.1 粗體標題**：編號徽章插在 <strong> 前', R);
      assert(R.linkNum === '3.4' && R.linkNumOutsideLink && R.linkText === '連結標題', '## [3.4 連結標題](url)：編號徽章在連結外', R);
      assert(R.readingMeta && R.tableTools >= 1, '標題增強之後的步驟（閱讀時間、表格工具列）照常執行');
      assert(R.rawTableWrapped, '原始 HTML <table border="1"> 有包裝');
      assert(R.looseCbs && R.looseCbs.length === 2 && R.looseCbs.every((c) => c.appearance === 'none' && c.width === '17px' && c.height === '17px') && R.looseCbs[1].checked && R.looseCbs[1].afterContent !== 'none', '鬆散工作清單 checkbox 套用 Fluent 樣式（appearance: none、17px、勾選符號）', R.looseCbs);
      assert(R.tocTexts.includes('logo 圖片') && R.tocTexts.includes('屬性含大於號') && R.tocTexts.includes('符號 & 實體 © 與 *轉義*'), '側欄目錄文字（圖片 alt、屬性含 >、實體）', R.tocTexts);
      assert(R.activeAtTop && R.activeAtTop !== '提示框內的標題', '捲動在頂端時不會誤高亮提示框內的標題', R.activeAtTop);
      assert(R.activeAtAlert === '提示框內的標題', '捲到提示框時高亮提示框內的標題', R.activeAtAlert);
      assert(R.afterDrag[0] !== '版本', '拖曳表頭在按鈕外放開仍完成搬欄', R.afterDrag);
      assert(R.sortAfterDrag === 'ascending', '拖曳後的下一次排序點擊沒有被吞', R.sortAfterDrag);
      assert(JSON.stringify(R.versionOrder) === JSON.stringify(['1.2.3', '10.1.0', '2.0.0']), '「1.2.3」版本字串不當數字（依文字排序）', R.versionOrder);
      assert(JSON.stringify(R.countOrder) === JSON.stringify(['3.5', '25', '1,000']), '真的數字欄（含千分位）依數值排序', R.countOrder);
      assert(R.cancelKeepsOrder && R.sortAfterCancel === 'ascending', 'pointercancel 不搬欄、也不吞下一次點擊', R);
      assert(R.mermaidSvg, 'id="mermaid" 標題存在時真的 mermaid 仍畫出 svg');
      assert(R.errors.length === 0, '沒有未捕捉的例外', R.errors);
    }
  }

  console.log('== 瀏覽器實測：window.mermaid 被 id 冒充 ==');
  {
    // 腳本載入成功但沒有定義 mermaid（模擬注入的原始碼壞掉）：舊版會把 <div id="mermaid"> 當函式庫呼叫 render 而丟例外
    const md = '## Mermaid\n\n```mermaid\ngraph TD\n  A-->B\n```\n';
    const doc = injectHarness(buildDoc(md, 'dark', { mermaidSrc: 'data:text/javascript,void%200' }), `
var tries=0;(function wait(){var b=document.querySelector('.md-mermaid');if(b.classList.contains('is-failed')||tries++>50){R.failed=b.classList.contains('is-failed');R.clobbered=window.mermaid instanceof HTMLElement;R.errors=window.__errors;done();}else setTimeout(wait,100);})();
`);
    const R = runInChrome(chrome, doc, tmp, 'clobber');
    if (R.error || R.harnessError) assert(false, '瀏覽器測試頁執行', R);
    else {
      assert(R.clobbered, '前提：window.mermaid 是 id="mermaid" 的標題元素');
      assert(R.failed, 'bootstrap 判定 mermaid 載入失敗並標示 .is-failed', R);
      assert(R.errors.length === 0, '沒有未捕捉的例外', R.errors);
    }
  }

  console.log('== 瀏覽器實測：DOMPurify 消毒 ==');
  {
    const v = (f) => pathToFileURL(path.join(root, 'vendor', f)).href;
    const s = (f) => pathToFileURL(path.join(srcDir, f)).href;
    const page = `<!DOCTYPE html><html><head><meta charset="utf-8">
<script src="${v('marked.min.js')}"></script><script src="${v('highlight.min.js')}"></script><script src="${v('purify.min.js')}"></script>
<script src="${s('md-core.js')}"></script></head><body><script>
var R={};try{
var r=AdoMarkdown.render('# Body\\n\\n## Mermaid\\n\\n<img name="querySelector" id="q" src="x.png" alt="a">\\n\\n<a name="anchor"></a>\\n\\n<div id="mermaid">x</div>\\n\\n## A &copy; B\\n');
R.html=r.html;R.toc=r.toc;
var d=document.createElement('div');d.innerHTML=r.html;
R.imgName=d.querySelector('img').getAttribute('name');R.aName=d.querySelector('a[name]')&&d.querySelector('a[name]').getAttribute('name');
R.ids=[].map.call(d.querySelectorAll('[id]'),function(e){return e.id;});
R.hookGone=/name="y"/.test(DOMPurify.sanitize('<img name="y" src="z.png">'));
}catch(e){R.harnessError=String(e&&e.stack||e);}
var p=document.createElement('pre');p.id='md-test-result';p.textContent=JSON.stringify(R);document.body.appendChild(p);
</script></body></html>`;
    const R = runInChrome(chrome, page, tmp, 'purify');
    if (R.error || R.harnessError) assert(false, '瀏覽器測試頁執行', R);
    else {
      assert(R.imgName === null, '<img name="querySelector"> 的 name 被移除（不能冒充 document.querySelector）', R.html);
      assert(R.aName === 'anchor', '<a name="anchor"> 錨點保留');
      assert(R.ids.includes('body') && R.ids.includes('mermaid'), '標題 id（body / mermaid）照常保留（SANITIZE_DOM 關閉）', R.ids);
      assert(R.hookGone, 'uponSanitizeAttribute hook 用完即移除，不影響其他 DOMPurify 呼叫端');
      assert(R.toc[2] && R.toc[2].text === 'A © B', '瀏覽器內以 textarea 解出全部具名實體（&copy;）', R.toc);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failed ? 'FAILED' : 'ALL PASS');
process.exit(failed);
