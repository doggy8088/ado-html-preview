// Azure DevOps Markdown Preview – 預覽文件外殼（content script 與 Tampermonkey 共用）
// 把 md-core.js 產出的文章 HTML 包成完整的 HTML 文件：
//   頂欄（檔名、目錄 / 深淺色切換）、側邊目錄、文章本體、以及在 iframe 內執行的 bootstrap 腳本
//   （深淺色切換、目錄高亮、程式碼複製、mermaid 圖渲染）。
// 樣式來自 md-theme.js 的 AdoMarkdownTheme.css。
// bootstrap 腳本需要帶 nonce 才能在繼承 Azure DevOps CSP 的 srcdoc iframe 內執行；
// 全螢幕模式（擴充功能 sandbox 頁）nonce 給空字串即可。

(function (root) {
  'use strict';

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const ICON_TOC = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 5h14v1.5H3zM3 9.25h10v1.5H3zM3 13.5h14V15H3z"/></svg>';
  const ICON_THEME = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 1.5v13a6.5 6.5 0 0 1 0-13z"/></svg>';

  function bootstrap(cfg) {
    // 這段會被轉成字串注入到預覽文件，請維持 ES5 風格、不要引用外部變數
    return `(function(){
var cfg=${JSON.stringify(cfg)};
var root=document.documentElement;
function prefersDark(){try{return window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;}catch(e){return false;}}
var q=null;try{q=new URLSearchParams(location.search).get('theme');}catch(e){}
var theme=q||cfg.theme;if(theme!=='light'&&theme!=='dark')theme=prefersDark()?'dark':'light';
function applyTheme(t){theme=t;root.setAttribute('data-theme',t);var b=document.querySelector('[data-action="theme"]');if(b)b.setAttribute('aria-label',t==='dark'?'切換為淺色':'切換為深色');renderMermaid();}
document.addEventListener('click',function(e){
  var btn=e.target&&e.target.closest?e.target.closest('[data-action]'):null;if(!btn)return;
  var act=btn.getAttribute('data-action');
  if(act==='theme'){applyTheme(theme==='dark'?'light':'dark');}
  else if(act==='toc'){var open=root.getAttribute('data-toc')!=='open';root.setAttribute('data-toc',open?'open':'closed');btn.setAttribute('aria-expanded',open?'true':'false');}
});
// 目錄：點擊後在窄版面自動收合；捲動時高亮目前段落
var toc=document.querySelector('.md-toc');
if(toc){
  toc.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href^="#"]');if(a&&window.innerWidth<1100){root.setAttribute('data-toc','closed');}});
  var links=[].slice.call(toc.querySelectorAll('a[href^="#"]'));
  var byId={};links.forEach(function(a){byId[decodeURIComponent(a.getAttribute('href').slice(1))]=a;});
  var heads=[].slice.call(document.querySelectorAll('.md-content h1[id],.md-content h2[id],.md-content h3[id],.md-content h4[id],.md-content h5[id],.md-content h6[id]')).filter(function(h){return byId[h.id];});
  var scroller=document.querySelector('.md-main')||window;
  var ticking=false;
  function update(){
    ticking=false;
    var top=(scroller===window?window.scrollY:scroller.scrollTop)+120;var cur=heads[0];
    for(var i=0;i<heads.length;i++){var y=scroller===window?heads[i].getBoundingClientRect().top+window.scrollY:heads[i].offsetTop;if(y<=top)cur=heads[i];else break;}
    links.forEach(function(a){a.classList.remove('is-active');});
    if(cur&&byId[cur.id]){var a=byId[cur.id];a.classList.add('is-active');var r=a.getBoundingClientRect(),tr=toc.getBoundingClientRect();if(r.top<tr.top||r.bottom>tr.bottom)a.scrollIntoView({block:'nearest'});}
  }
  scroller.addEventListener('scroll',function(){if(!ticking){ticking=true;requestAnimationFrame(update);}},{passive:true});
  update();
}
// 複製程式碼：sandbox 內 navigator.clipboard 可能不可用，退回 execCommand
document.addEventListener('click',function(e){
  var btn=e.target&&e.target.closest?e.target.closest('.md-copy'):null;if(!btn)return;
  var code=btn.closest('.md-code');var pre=code&&code.querySelector('pre');if(!pre)return;
  var text=pre.textContent;
  function done(ok){btn.textContent=ok?(btn.getAttribute('data-done')||'已複製'):'無法複製';btn.classList.toggle('is-done',ok);setTimeout(function(){btn.textContent=btn.getAttribute('data-label')||'複製';btn.classList.remove('is-done');},1600);}
  function fallback(){try{var ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');ta.style.cssText='position:fixed;top:0;left:0;opacity:0';document.body.appendChild(ta);ta.select();var ok=document.execCommand('copy');ta.remove();done(ok);}catch(err){done(false);}}
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){done(true);},fallback);}else{fallback();}
});
// mermaid：有圖才載入；換主題時用原始碼重畫。
// 直接 <script src> 失敗時（sandbox iframe 的 origin 為 null，可能載不到擴充功能內的檔案），
// 改向父頁面要原始碼（content script / preview.js 會回 ado-md-mermaid-source），以帶 nonce 的 inline script 注入。
var mermaidState='idle';
function mermaidFailed(){mermaidState='failed';renderMermaid();}
function requestFromParent(){
  // 父頁面沒有回應端（例如 Tampermonkey 版本）時直接判定失敗，不用等逾時
  if(!cfg.mermaidFallback||!window.parent||window.parent===window){mermaidFailed();return;}
  var timer=setTimeout(function(){window.removeEventListener('message',onMsg);if(mermaidState==='loading')mermaidFailed();},20000);
  function onMsg(ev){
    // 只接受父頁面送來的訊息，其他跨來源 iframe 不能借此把腳本塞進預覽
    if(ev.source!==window.parent||!ev.data||ev.data.type!=='ado-md-mermaid-source')return;
    clearTimeout(timer);window.removeEventListener('message',onMsg);
    if(!ev.data.source){mermaidFailed();return;}
    try{var t=document.createElement('script');if(cfg.nonce)t.setAttribute('nonce',cfg.nonce);t.textContent=ev.data.source;document.head.appendChild(t);}catch(e){}
    if(window.mermaid){mermaidState='ready';renderMermaid();}else{mermaidFailed();}
  }
  window.addEventListener('message',onMsg);
  window.parent.postMessage({type:'ado-md-mermaid-request'},'*');
}
function renderMermaid(){
  var blocks=[].slice.call(document.querySelectorAll('.md-mermaid'));if(!blocks.length||!cfg.mermaidSrc)return;
  if(mermaidState==='idle'){
    mermaidState='loading';
    var s=document.createElement('script');s.src=cfg.mermaidSrc;if(cfg.nonce)s.setAttribute('nonce',cfg.nonce);
    s.onload=function(){mermaidState='ready';renderMermaid();};
    s.onerror=function(){s.remove();requestFromParent();};
    document.head.appendChild(s);return;
  }
  if(mermaidState==='failed'){blocks.forEach(function(b){b.classList.add('is-failed');b.setAttribute('data-error','無法載入 mermaid');});return;}
  if(mermaidState!=='ready'||!window.mermaid)return;
  try{window.mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:theme==='dark'?'dark':'default',fontFamily:'inherit'});}catch(e){}
  blocks.forEach(function(b,i){
    if(b.__src==null){var pre=b.querySelector('pre');b.__src=pre?pre.textContent:b.textContent;}
    var src=b.__src;var id='md-mermaid-'+i+'-'+Date.now();
    b.classList.remove('is-failed');
    window.mermaid.render(id,src).then(function(res){b.innerHTML=res.svg;if(res.bindFunctions)res.bindFunctions(b);},function(err){
      var stale=document.getElementById('d'+id);if(stale)stale.remove();
      b.innerHTML='<pre class="mermaid">'+src.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</pre>';b.classList.add('is-failed');b.setAttribute('data-error',String(err&&err.message||err).split('\\n')[0]);
    });
  });
}
// 窄視窗（側欄會以浮出面板呈現）時預設收合目錄，避免一開始就蓋住內文
if(window.innerWidth<800&&root.getAttribute('data-toc')==='open'){root.setAttribute('data-toc','closed');var tb=document.querySelector('[data-action="toc"]');if(tb)tb.setAttribute('aria-expanded','false');}
applyTheme(theme);
})();`;
  }

  /**
   * @param {object} o
   * @param {string} o.html        文章 HTML（AdoMarkdown.render 的輸出）
   * @param {Array}  o.toc         目錄
   * @param {string} o.title       文件標題（h1），沒有時用檔名
   * @param {string} o.fileName    檔名，顯示在頂欄
   * @param {string} o.theme       'light' | 'dark' | 'auto'
   * @param {string} o.nonce       CSP nonce（srcdoc 用），全螢幕給 ''
   * @param {string} o.mermaidSrc  mermaid 函式庫網址；空字串表示不支援
   * @param {boolean} [o.mermaidFallback] 父頁面是否會回應 ado-md-mermaid-request（擴充功能 true、userscript false）
   * @param {string} [o.css]       覆寫樣式（預設用 AdoMarkdownTheme.css）
   */
  function buildDocument(o) {
    const css = o.css != null ? o.css : (root.AdoMarkdownTheme && root.AdoMarkdownTheme.css) || '';
    const title = o.title || o.fileName || 'Markdown 預覽';
    const toc = root.AdoMarkdown.tocHtml(o.toc || [], 'md-toc-list');
    const nonceAttr = o.nonce ? ` nonce="${esc(o.nonce)}"` : '';
    const cfg = { theme: o.theme || 'auto', nonce: o.nonce || '', mermaidSrc: o.mermaidSrc || '', mermaidFallback: !!o.mermaidFallback };
    const initial = o.theme === 'dark' ? 'dark' : 'light';
    return `<!DOCTYPE html>
<html lang="zh-Hant" data-theme="${initial}" data-toc="${toc ? 'open' : 'none'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<style>${css}</style>
</head>
<body>
<div class="md-app">
  <header class="md-bar">
    <button type="button" class="md-iconbtn" data-action="toc" aria-label="切換目錄" aria-expanded="${toc ? 'true' : 'false'}"${toc ? '' : ' hidden'}>${ICON_TOC}</button>
    <div class="md-bar-title" title="${esc(o.fileName || '')}">${esc(o.fileName || title)}</div>
    <button type="button" class="md-iconbtn" data-action="theme" aria-label="切換深淺色">${ICON_THEME}</button>
  </header>
  <div class="md-layout">
    ${toc ? `<nav class="md-toc" aria-label="目錄"><div class="md-toc-title">目錄</div>${toc}</nav>` : ''}
    <main class="md-main"><article class="md-content">${o.html}</article></main>
  </div>
</div>
<script${nonceAttr}>${bootstrap(cfg)}</script>
</body>
</html>`;
  }

  root.AdoMarkdownShell = { buildDocument };
})(typeof globalThis !== 'undefined' ? globalThis : window);
