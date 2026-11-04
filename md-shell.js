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
var cfg=${JSON.stringify(cfg).replace(/</g, '\\u003c')};
var root=document.documentElement;
function prefersDark(){try{return window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;}catch(e){return false;}}
var q=null;try{q=new URLSearchParams(location.search).get('theme');}catch(e){}
var theme=q||cfg.theme;if(theme!=='light'&&theme!=='dark')theme=prefersDark()?'dark':'light';
function applyTheme(t){theme=t;root.setAttribute('data-theme',t);if(typeof closeLightbox==='function')closeLightbox();var b=document.querySelector('[data-action="theme"]');if(b)b.setAttribute('aria-label',t==='dark'?'切換為淺色':'切換為深色');renderMermaid();}
document.addEventListener('click',function(e){
  var btn=e.target&&e.target.closest?e.target.closest('[data-action]'):null;if(!btn)return;
  var act=btn.getAttribute('data-action');
  if(act==='theme'){applyTheme(theme==='dark'?'light':'dark');}
  else if(act==='toc'){var open=root.getAttribute('data-toc')!=='open';root.setAttribute('data-toc',open?'open':'closed');btn.setAttribute('aria-expanded',open?'true':'false');}
});
// 目錄：點擊後在窄版面自動收合；捲動時高亮目前段落
var toc=document.querySelector('.md-toc');
if(toc){
  // 只有側欄以浮出面板呈現的窄版面（< 800px，與樣式表的斷點一致）才在點選後自動收合，並同步切換鈕的 aria-expanded
  toc.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href^="#"]');if(a&&window.innerWidth<800){root.setAttribute('data-toc','closed');var tb=document.querySelector('[data-action="toc"]');if(tb)tb.setAttribute('aria-expanded','false');}});
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
  function done(ok){var msg=ok?(btn.getAttribute('data-done')||'已複製'):'無法複製';btn.setAttribute('aria-label',msg);btn.setAttribute('title',msg);btn.classList.toggle('is-done',ok);setTimeout(function(){var back=btn.getAttribute('data-label')||'複製';btn.setAttribute('aria-label',back);btn.setAttribute('title',back);btn.classList.remove('is-done');},1600);}
  function fallback(){try{var ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');ta.style.cssText='position:fixed;top:0;left:0;opacity:0';document.body.appendChild(ta);ta.select();var ok=document.execCommand('copy');ta.remove();done(ok);}catch(err){done(false);}}
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){done(true);},fallback);}else{fallback();}
});
// mermaid：有圖才載入；換主題時用原始碼重畫。
// 直接 <script src> 失敗時（sandbox iframe 的 origin 為 null，可能載不到擴充功能內的檔案），
// 改向父頁面要原始碼（content script / preview.js 會回 ado-md-mermaid-source），以帶 nonce 的 inline script 注入。
var mermaidState='idle';
// mermaid 11 會呼叫 URL.canParse（Chrome 120 才有），擴充功能最低支援 Chrome 112，先補上同義的 polyfill
if(typeof URL!=='undefined'&&typeof URL.canParse!=='function'){URL.canParse=function(u,b){try{new URL(u,b);return true;}catch(e){return false;}};}
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
    // 每個區塊的渲染世代：快速切換主題時較早的 render 可能較晚完成，過期的結果一律丟掉，不回寫舊主題的圖
    var gen=b.__gen=(b.__gen||0)+1;
    b.classList.remove('is-failed');
    window.mermaid.render(id,src).then(function(res){
      if(gen!==b.__gen){var tmp=document.getElementById('d'+id);if(tmp)tmp.remove();return;}
      b.innerHTML=res.svg;if(res.bindFunctions)res.bindFunctions(b);setupMermaidTools(b);
    },function(err){
      var stale=document.getElementById('d'+id);if(stale)stale.remove();
      if(gen!==b.__gen)return;
      b.innerHTML='<pre class="mermaid">'+src.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</pre>';b.classList.add('is-failed');b.setAttribute('data-error',String(err&&err.message||err).split('\\n')[0]);
    });
  });
}
// ---- mermaid 縮放與全螢幕 ----
// 圖上方右側的工具列：縮小 / 百分比（點一下重設）/ 放大 / 全螢幕；Ctrl(⌘)+滾輪也能縮放。
// 全螢幕是把 svg 複製到覆蓋整個預覽的 lightbox，支援滾輪縮放、拖曳平移、雙擊貼齊、Esc 關閉；
// 能用 Fullscreen API 時會順便把 lightbox 送進真正的全螢幕（需要 iframe 的 allow="fullscreen"），不行就只蓋滿預覽區。
var MZ_ICON={
  'in':'<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7 2h2v5h5v2H9v5H7V9H2V7h5z"/></svg>',
  out:'<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2 7h12v2H2z"/></svg>',
  full:'<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2 2h5v2H4v3H2zM9 2h5v5h-2V4H9zM2 9h2v3h3v2H2zM12 9h2v5H9v-2h3z"/></svg>',
  fit:'<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2 2h12v12H2zm2 2v8h8V4zM5 5h6v6H5z" fill-rule="evenodd"/></svg>',
  close:'<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3.3 2 8 6.7 12.7 2 14 3.3 9.3 8 14 12.7 12.7 14 8 9.3 3.3 14 2 12.7 6.7 8 2 3.3z"/></svg>'
};
function mzBtn(act,label,extra){return '<button type="button" class="md-mz-btn'+(extra?' '+extra:'')+'" data-mz="'+act+'" aria-label="'+label+'" title="'+label+'">'+(MZ_ICON[act]||'')+'</button>';}
function clampZoom(z){return Math.min(8,Math.max(0.25,z));}
function svgSize(svg){
  var vb=svg.viewBox&&svg.viewBox.baseVal;
  if(vb&&vb.width&&vb.height)return{w:vb.width,h:vb.height};
  var r=svg.getBoundingClientRect();return{w:r.width||600,h:r.height||400};
}
// 圖表 svg 一定是 .md-mermaid 的直接子元素；工具列裡的圖示也是 svg，所以要用 :scope > svg 區分
function setupMermaidTools(b){
  var svg=b.querySelector(':scope > svg');if(!svg)return;
  // 重畫（例如換主題）後是全新的 svg：縮放狀態、靠左 class 與快取的基準寬度都要歸零
  b.__zoom=1;b.__base=null;b.classList.remove('is-zoomed');b.__maxWidth=svg.style.maxWidth||'';
  // 工具列放在 svg 前面、高度 0 且 sticky left:0：圖放大後水平捲動時工具列仍停在可見區的右上角
  var tools=document.createElement('div');tools.className='md-mz-tools';
  tools.innerHTML='<div class="md-mz-bar" role="toolbar" aria-label="圖表縮放">'+mzBtn('out','縮小')+'<button type="button" class="md-mz-btn md-mz-pct" data-mz="reset" title="重設為 100%">100%</button>'+mzBtn('in','放大')+mzBtn('full','全螢幕檢視')+'</div>';
  b.insertBefore(tools,b.firstChild);
  // 換主題重畫時會再跑一次 setupMermaidTools，wheel 監聽掛在常駐的容器上，只能綁一次
  if(!b.__wheelBound){b.__wheelBound=true;b.addEventListener('wheel',function(e){if(!(e.ctrlKey||e.metaKey))return;e.preventDefault();inlineZoom(b,b.__zoom*(e.deltaY<0?1.1:1/1.1));},{passive:false});}
}
function inlineZoom(b,z){
  var svg=b.querySelector(':scope > svg');if(!svg)return;
  z=clampZoom(z);
  if(Math.abs(z-1)<0.01){z=1;svg.style.width='';svg.style.maxWidth=b.__maxWidth;b.classList.remove('is-zoomed');}
  else{
    if(!b.__base){var r=svg.getBoundingClientRect();b.__base=r.width||svgSize(svg).w;}
    svg.style.maxWidth='none';svg.style.width=Math.round(b.__base*z)+'px';svg.style.height='auto';b.classList.add('is-zoomed');
  }
  b.__zoom=z;var pct=b.querySelector('.md-mz-pct');if(pct)pct.textContent=Math.round(z*100)+'%';
}
document.addEventListener('click',function(e){
  var btn=e.target&&e.target.closest?e.target.closest('.md-mermaid .md-mz-btn'):null;if(!btn)return;
  var b=btn.closest('.md-mermaid');var act=btn.getAttribute('data-mz');
  if(act==='in')inlineZoom(b,b.__zoom*1.25);else if(act==='out')inlineZoom(b,b.__zoom/1.25);else if(act==='reset')inlineZoom(b,1);else if(act==='full')openLightbox(b);
});
var lightbox=null;
function openLightbox(b){
  var svg=b.querySelector(':scope > svg');if(!svg)return;
  closeLightbox();
  var size=svgSize(svg);
  var lb=document.createElement('div');lb.className='md-lightbox';lb.setAttribute('role','dialog');lb.setAttribute('aria-modal','true');lb.setAttribute('aria-label','Mermaid 圖表全螢幕檢視');lb.tabIndex=-1;
  lb.innerHTML='<div class="md-mz-bar md-lightbox-tools" role="toolbar" aria-label="圖表縮放">'+mzBtn('out','縮小')+'<button type="button" class="md-mz-btn md-mz-pct" data-lb="reset" title="重設為 100%">100%</button>'+mzBtn('in','放大')+mzBtn('fit','貼齊視窗')+'<span class="md-mz-sep"></span>'+mzBtn('close','關閉（Esc）')+'</div>'
    +'<div class="md-lightbox-stage"><div class="md-lightbox-canvas"></div></div>'
    +'<div class="md-lightbox-hint">滾輪縮放 · 拖曳平移 · 雙擊貼齊 · Esc 關閉</div>';
  var stage=lb.querySelector('.md-lightbox-stage'),canvas=lb.querySelector('.md-lightbox-canvas'),pct=lb.querySelector('.md-mz-pct');
  var clone=svg.cloneNode(true);clone.removeAttribute('width');clone.removeAttribute('height');clone.style.maxWidth='none';clone.style.width=size.w+'px';clone.style.height=size.h+'px';
  canvas.appendChild(clone);
  var s=1,tx=0,ty=0;
  function apply(){canvas.style.transform='translate('+tx+'px,'+ty+'px) scale('+s+')';pct.textContent=Math.round(s*100)+'%';}
  function fit(){var W=stage.clientWidth,H=stage.clientHeight;s=Math.min(Math.min((W-48)/size.w,(H-48)/size.h),2);if(!(s>0))s=1;tx=(W-size.w*s)/2;ty=(H-size.h*s)/2;apply();}
  function zoomAt(f,mx,my){var ns=Math.min(10,Math.max(0.1,s*f));tx=mx-(mx-tx)*(ns/s);ty=my-(my-ty)*(ns/s);s=ns;apply();}
  function center(){var r=stage.getBoundingClientRect();return{x:r.width/2,y:r.height/2};}
  stage.addEventListener('wheel',function(e){e.preventDefault();var r=stage.getBoundingClientRect();zoomAt(Math.exp(-e.deltaY*0.0015),e.clientX-r.left,e.clientY-r.top);},{passive:false});
  var drag=null;
  stage.addEventListener('pointerdown',function(e){if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,tx:tx,ty:ty};stage.setPointerCapture(e.pointerId);stage.classList.add('is-dragging');});
  stage.addEventListener('pointermove',function(e){if(!drag)return;tx=drag.tx+(e.clientX-drag.x);ty=drag.ty+(e.clientY-drag.y);apply();});
  function endDrag(){drag=null;stage.classList.remove('is-dragging');}
  stage.addEventListener('pointerup',endDrag);stage.addEventListener('pointercancel',endDrag);
  stage.addEventListener('dblclick',function(){fit();});
  lb.addEventListener('click',function(e){
    var btn=e.target.closest&&e.target.closest('.md-mz-btn');if(!btn)return;
    var act=btn.getAttribute('data-mz')||btn.getAttribute('data-lb');var c=center();
    if(act==='in')zoomAt(1.25,c.x,c.y);else if(act==='out')zoomAt(1/1.25,c.x,c.y);else if(act==='reset'){var W=stage.clientWidth,H=stage.clientHeight;s=1;tx=(W-size.w)/2;ty=(H-size.h)/2;apply();}
    else if(act==='fit')fit();else if(act==='close')closeLightbox();
  });
  lb.addEventListener('keydown',function(e){
    var c=center();
    if(e.key==='Tab'){
      // 焦點只在面板內循環（背景已設 inert，這裡再保險一次）
      var f=[].slice.call(lb.querySelectorAll('button:not([disabled])'));if(!f.length)return;
      var first=f[0],last=f[f.length-1];
      if(e.shiftKey&&(document.activeElement===first||document.activeElement===lb)){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      return;
    }
    if(e.key==='Escape'){e.preventDefault();closeLightbox();}
    else if(e.key==='+'||e.key==='='){e.preventDefault();zoomAt(1.25,c.x,c.y);}
    else if(e.key==='-'){e.preventDefault();zoomAt(1/1.25,c.x,c.y);}
    else if(e.key==='0'){e.preventDefault();fit();}
  });
  document.body.appendChild(lb);
  root.setAttribute('data-lightbox','open');
  // 背景設為 inert：鍵盤 Tab 與螢幕閱讀器都碰不到面板以外的內容；關閉時把焦點還給開啟它的按鈕
  // 先記下開啟面板的元素，再把背景設為 inert（inert 之後焦點會被移走，activeElement 就不是按鈕了）
  var opener=document.activeElement;
  var app=document.querySelector('.md-app');if(app)app.inert=true;
  lightbox={el:lb,fit:fit,opener:opener,app:app};
  fit();var firstBtn=lb.querySelector('.md-mz-btn');if(firstBtn)firstBtn.focus();else lb.focus();
  // 盡量進入真正的全螢幕；sandbox 沒開放 fullscreen 時會 reject，忽略即可
  try{if(lb.requestFullscreen){lb.requestFullscreen().then(function(){setTimeout(fit,50);},function(){});}}catch(e){}
}
function closeLightbox(){
  if(!lightbox)return;
  var lb=lightbox.el,opener=lightbox.opener,app=lightbox.app;lightbox=null;
  try{if(document.fullscreenElement===lb&&document.exitFullscreen)document.exitFullscreen().catch(function(){});}catch(e){}
  lb.remove();root.removeAttribute('data-lightbox');
  if(app)app.inert=false;
  if(opener&&opener.isConnected&&opener.focus)try{opener.focus();}catch(e){}
}
document.addEventListener('fullscreenchange',function(){
  // 在真正的全螢幕中按 Esc 只會離開全螢幕，這時一併關掉 lightbox；視窗大小變了也重新貼齊
  if(lightbox&&!document.fullscreenElement)closeLightbox();
});
window.addEventListener('resize',function(){if(lightbox)lightbox.fit();});

${adoEnhanceAll.toString()}
adoEnhanceAll();
// 窄視窗（側欄會以浮出面板呈現）時預設收合目錄，避免一開始就蓋住內文
if(window.innerWidth<800&&root.getAttribute('data-toc')==='open'){root.setAttribute('data-toc','closed');var tb=document.querySelector('[data-action="toc"]');if(tb)tb.setAttribute('aria-expanded','false');}
applyTheme(theme);
})();`;
  }

  // 自適應版面：依文件結構裝飾標題、清單、表格並加上互動控制（不動到文字內容順序）。
  // 以 toString() 注入 bootstrap 模板，避免 template literal 吃掉正則的反斜線。
  function adoEnhanceAll() {
// ===== 自適應版面：依文件結構裝飾標題、清單、表格並加上互動控制（不動到文字內容順序） =====
function fmtNum(n){return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,',');}
function isCjkChar(ch){var c=ch.charCodeAt(0);return (c>=0x4E00&&c<=0x9FFF)||(c>=0x3040&&c<=0x30FF)||(c>=0xAC00&&c<=0xD7AF);}
var ICON_WORDS=[['summary',['摘要','結論','重點','總結','summary','overview','tl;dr','結語']],['info',['文件資訊','文件用途','關於','about','metadata']],['todo',['待查','待辦','待確認','缺口','下一步','todo','next step','action','known gap','清單']],['risk',['風險','注意','限制','陷阱','risk','warning','caveat','pitfall']],['tip',['建議','技巧','最佳實務','tip','best practice','recommend']],['perf',['效能','調校','速度','瓶頸','performance','tuning','latency']],['trouble',['疑難','排錯','排解','錯誤','診斷','troubleshoot','debug','faq','問題']],['schedule',['時程','排程','週','路線','計畫','規劃','schedule','timeline','roadmap','plan']],['video',['影片','video','youtube','頻道']],['people',['角色','權限','帳號','組織','role','permission','team']],['security',['資安','安全','security','授權','license']],['deploy',['上線','部署','安裝','環境','deploy','install','setup','rollback']],['test',['測試','驗收','驗證','test','qa']],['tool',['工具','外掛','tool','plugin','utility']],['arch',['架構','流程','設計','整合','architecture','flow','design','integration']],['code',['api','程式','開發','built-in','trigger','sdk','code','語法']],['history',['歷史','版本','生命週期','支援','history','version','lifecycle']],['goal',['背景','目標','範圍','需求','background','goal','scope','requirement']],['refs',['參考','來源','資源','文件','手冊','書','學習','閱讀順序','reference','resource','source','docs','learning']],['appendix',['附錄','附註','附件','appendix','note']]];
var ICON_EMOJI={'summary':'📌','info':'📄','todo':'☑️','risk':'⚠️','tip':'💡','perf':'⚡','trouble':'🩺','schedule':'🗓️','video':'🎬','people':'👥','security':'🔒','deploy':'🚀','test':'🧪','tool':'🧰','arch':'🧭','code':'🧩','history':'🕰️','goal':'🎯','refs':'📚','appendix':'📎'};
function iconFor(text){var lower=text.toLowerCase();for(var i=0;i<ICON_WORDS.length;i++){for(var j=0;j<ICON_WORDS[i][1].length;j++){if(lower.indexOf(ICON_WORDS[i][1][j])!==-1)return ICON_WORDS[i][0];}}return null;}
function firstTextNode(el){var w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT,null);var n;while((n=w.nextNode())){if(n.parentElement&&n.parentElement.closest&&n.parentElement.closest('.md-anchor'))continue;if(n.data.trim())return n;}return null;}
function itemRoot(li){return (li.children.length===1&&li.firstElementChild.tagName==='P')?li.firstElementChild:li;}
function decorateHeadings(art){
  [].slice.call(art.querySelectorAll('h1,h2,h3,h4')).forEach(function(h){
    var tn=firstTextNode(h);if(!tn)return;
    // 章節編號徽章：「2.1 標題」的「2.1」
    var m=tn.data.match(/^\s*((?:\d+\.)+\d+)\s+/);
    if(m){
      var num=document.createElement('span');num.className='md-h-num';num.textContent=m[1];
      tn.data=tn.data.slice(m[0].length);
      h.insertBefore(num,tn);
    }
    // H1 主副標拆行：「主標 — 副標」
    if(h.tagName==='H1'){
      var t=firstTextNode(h);
      if(t&&/^[^<>\n]*\s+[—–]\s+\S/.test(t.data)){
        var parts=t.data.split(/\s+[—–]\s+/);
        var a=document.createElement('span');a.className='md-title';a.textContent=parts.shift();
        var b=document.createElement('span');b.className='md-subtitle';b.textContent=parts.join(' — ');
        h.insertBefore(a,t);h.insertBefore(b,t);h.removeChild(t);
      }
    }
    // H2 主題 Emoji 圖示（標題已有 emoji 則不加；以 span 呈現，不動到 h2 的既有裝飾）
    if(h.tagName==='H2'){
      var txt=h.textContent||'';
      if(!/\p{Extended_Pictographic}/u.test(txt)){
        var icon=iconFor(txt);
        if(icon&&ICON_EMOJI[icon]){
          var span=document.createElement('span');
          span.className='md-h-icon';span.setAttribute('aria-hidden','true');span.textContent=ICON_EMOJI[icon];
          h.insertBefore(span,h.querySelector('.md-anchor')?h.querySelector('.md-anchor').nextSibling:h.firstChild);
        }
      }
    }
  });
}
function addReadingTime(art){
  var src=art.textContent||'';var cjk=0;
  for(var i=0;i<src.length;i++){if(isCjkChar(src.charAt(i)))cjk++;}
  var minutes=Math.max(1,Math.round(cjk>src.length*0.15?cjk/500:src.length/1400));
  var meta=document.createElement('div');meta.className='md-doc-meta';
  meta.textContent='⏱ 約 '+minutes+' 分鐘閱讀 · '+fmtNum(src.length)+' 字';
  var h1=art.querySelector('h1');
  if(h1&&h1.nextSibling)h1.parentNode.insertBefore(meta,h1.nextSibling);
  else art.insertBefore(meta,art.firstChild);
}
function classifyLists(art){
  [].slice.call(art.children).forEach(function(list){
    if(list.tagName!=='UL'&&list.tagName!=='OL')return;
    var items=[].slice.call(list.children);
    if(items.length<2||items.length>8)return;
    if(list.querySelector('ul,ol,input,pre,blockquote,table'))return;
    // 粗體開頭的長編號重點 → 編號面板（先於屬性表判定，避免長項目被誤吞）
    if(list.tagName==='OL'&&items.length>=3){
      var findings=items.every(function(li){var f=itemRoot(li).firstElementChild;return f&&f.tagName==='STRONG'&&(li.textContent||'').trim().length>40;});
      if(findings){list.classList.add('md-findings');return;}
    }
    // 「標籤：內容」清單（值偏短）→ 屬性表
    var kv=items.every(function(li){var s=(li.textContent||'').trim();return s.length<=80&&/^[^：:\n]{1,24}[：:]\s*\S/.test(s);});
    if(kv){
      items.forEach(function(li){
        var root=itemRoot(li);
        // 粗體鍵：**標籤**：內容 → <strong> 直接當鍵
        var strong=root.firstElementChild;
        if(strong&&strong.tagName==='STRONG'&&strong.nextSibling&&strong.nextSibling.nodeType===3&&/^[：:]/.test(strong.nextSibling.data)){
          strong.nextSibling.data=strong.nextSibling.data.replace(/^[：:]\s*/,'');
          strong.classList.add('md-kv-key');
          li.classList.add('md-kv-item');
          return;
        }
        var t=firstTextNode(root);if(!t)return;
        var m=t.data.match(/^(\s*[^：:\n]{1,24})[：:](\s*)/);
        if(!m)return;
        var key=document.createElement('span');key.className='md-kv-key';
        key.textContent=m[1].trim();
        t.data=t.data.slice(m[0].length);
        root.insertBefore(key,root.firstChild);
        li.classList.add('md-kv-item');
      });
      list.classList.add('md-kv');
      return;
    }
    var flat=items.every(function(li){var s=(li.textContent||'').trim();return s.length>0&&s.length<=120&&!li.querySelector('ul,ol,input,pre,blockquote,img');});
    if(flat&&items.length>=3){
      list.classList.add('md-cards');
      if(list.tagName==='OL')list.classList.add('md-steps');
      return;
    }
  });
}
function badgeStatusCells(wrap){
  var map={'✅':'ok','⚠️':'warn','❌':'bad','※':'info'};
  [].slice.call(wrap.querySelectorAll('td')).forEach(function(td){
    var t=firstTextNode(td);if(!t)return;
    var s=t.data.trim();var ch=s.charAt(0)==='⚠'?'⚠️':s.charAt(0);
    if(!map[ch])return;
    var b=document.createElement('span');b.className='md-badge '+map[ch];b.textContent=ch;
    var idx=t.data.indexOf(ch);
    var rest=t.data.slice(0,idx)+t.data.slice(idx+ch.length);
    t.data=rest.replace(/^\s+/,'');
    td.insertBefore(b,td.firstChild);
  });
}
function setupTables(art){
  [].slice.call(art.querySelectorAll('.md-table-wrap')).forEach(function(wrap){
    var table=wrap.querySelector(':scope > table');if(!table||!table.tHead||!table.tBodies[0])return;
    var head=table.tHead.rows[0];var body=table.tBodies[0];
    var rows=[].slice.call(body.rows);if(!rows.length)return;
    var cells=[].slice.call(head.cells);
    var headers=cells.map(function(th){return (th.textContent||'').replace(/\s+/g,' ').trim();});
    var simple=table.tHead.rows.length===1&&table.querySelectorAll('tbody').length===1&&!table.querySelector('[colspan],[rowspan],table')&&rows.every(function(r){return r.cells.length===cells.length;});
    var wide=cells.length>=6;
    // 寬表：交給 .md-table-wrap.is-wide 的既有樣式（卡片內水平捲動、放棄 sticky 表頭）
    if(wide)wrap.classList.add('is-wide');
    if(wide)art.classList.add('md-wide');
    if(simple&&cells.length<=4&&rows.some(function(r){return [].slice.call(r.cells).some(function(td){return (td.textContent||'').trim().length>=80;});}))wrap.classList.add('is-stackable');
    if(!simple)return;
    if(rows.length>=5)wrap.classList.add('is-sortable');
    if(rows.length>=12)wrap.classList.add('is-filterable');
    if(cells.length>=3)wrap.classList.add('is-resizable');
    if(rows.length>=8||cells.length>=5)wrap.classList.add('is-dense');
    if(simple)rows.forEach(function(r,i){[].slice.call(r.cells).forEach(function(td,ci){if(headers[ci])td.setAttribute('data-label',headers[ci]);});});
    badgeStatusCells(wrap);
    // 工具列：篩選、列數、捲動提示、還原
    var tools=document.createElement('div');tools.className='md-table-tools';
    var label=headers.join(' / ');
    wrap.parentNode.insertBefore(tools,wrap);
    var live=document.createElement('span');live.className='md-visually-hidden';live.setAttribute('aria-live','polite');tools.appendChild(live);
    function announce(msg){live.textContent=msg;}
    var input=null,count=null,hint=null,reset=null;
    if(wrap.classList.contains('is-filterable')){
      input=document.createElement('input');input.type='search';input.className='md-table-filter';
      input.placeholder='篩選表格內容…';input.setAttribute('aria-label','篩選表格內容… — '+label);
      count=document.createElement('span');count.className='md-table-count';count.textContent='共 '+rows.length+' 列';
      tools.appendChild(input);tools.appendChild(count);
      input.addEventListener('input',function(){
        var q=input.value.trim().toLowerCase();var shown=0;
        rows.forEach(function(r){
          var hit=!q||(r.textContent||'').toLowerCase().indexOf(q)!==-1;
          r.hidden=!hit;if(hit)shown++;
        });
        count.textContent=shown===rows.length?'共 '+rows.length+' 列':'顯示 '+shown+' / '+rows.length+' 列';
      });
    }
    function freeze(){if(wrap.classList.contains('is-resized'))return;
      var widths=cells.map(function(c){return c.getBoundingClientRect().width;});
      table.style.width=table.getBoundingClientRect().width+'px';
      cells.forEach(function(c,i){c.style.width=widths[i]+'px';});
      wrap.classList.add('is-resized');}
    function resetWidths(){wrap.classList.remove('is-resized');table.style.width='';cells.forEach(function(c){c.style.width='';});update();}
    if(wrap.classList.contains('is-resizable')){
      cells.slice(0,-1).forEach(function(th,i){
        var grip=document.createElement('span');grip.className='md-col-resize';grip.tabIndex=0;
        grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','vertical');
        grip.setAttribute('aria-label','拖曳調整欄寬（雙擊還原） — '+(headers[i]||i+1));
        grip.title='拖曳調整欄寬（雙擊還原）';
        th.appendChild(grip);
        grip.addEventListener('click',function(e){e.stopPropagation();});
        grip.addEventListener('pointerdown',function(e){
          if(e.button!==0)return;e.preventDefault();freeze();
          var startX=e.clientX,startW=th.offsetWidth;
          grip.setPointerCapture(e.pointerId);grip.classList.add('is-active');
          function move(ev){var w=Math.max(64,startW+(ev.clientX-startX));th.style.width=w+'px';update();}
          function up(){grip.classList.remove('is-active');grip.removeEventListener('pointermove',move);grip.removeEventListener('pointerup',up);grip.removeEventListener('pointercancel',up);}
          grip.addEventListener('pointermove',move);grip.addEventListener('pointerup',up);grip.addEventListener('pointercancel',up);
        });
        grip.addEventListener('keydown',function(e){
          var step=e.key==='ArrowRight'?24:(e.key==='ArrowLeft'?-24:0);if(!step)return;
          e.preventDefault();freeze();var w=Math.max(64,th.offsetWidth+step);th.style.width=w+'px';update();
        });
        grip.addEventListener('dblclick',function(e){e.preventDefault();resetWidths();});
      });
    }
    if(wrap.classList.contains('is-sortable')){
      cells.forEach(function(th,col){
        if(th.querySelector('a,button,input'))return;
        var btn=document.createElement('button');btn.type='button';btn.className='md-th-sort';btn.title='排序';
        while(th.firstChild)btn.appendChild(th.firstChild);
        th.appendChild(btn);
        btn.addEventListener('click',function(){
          var cur=th.getAttribute('aria-sort');
          var dir=cur==='ascending'?-1:(cur==='descending'?0:1);
          cells.forEach(function(h){h.removeAttribute('aria-sort');});
          if(dir>0)th.setAttribute('aria-sort','ascending');
          else if(dir<0)th.setAttribute('aria-sort','descending');
          sortBy(col,dir);
          announce(dir>0?'已依 '+headers[col]+' 遞增排序':(dir<0?'已依 '+headers[col]+' 遞減排序':'已還原原始順序'));
        });
      });
    }
    function sortBy(col,dir){
      var order=rows.map(function(r,i){return i;});
      if(dir){
        var keys=rows.map(function(r){return r.cells[col]?(r.cells[col].textContent||'').trim():'';});
        var numeric=keys.filter(Boolean).every(function(k){return /^[~約≈]?-?[\d,.]+%?$/.test(k.replace(/,/g,''));});
        order.sort(function(a,b){
          var x=keys[a],y=keys[b];
          if(!x||!y)return x?-1:(y?1:a-b);
          var c=numeric?parseFloat(x.replace(/[^\d.\-]/g,''))-parseFloat(y.replace(/[^\d.\-]/g,'')):x.localeCompare(y,'zh-Hant');
          return (c||a-b)*(dir===1?1:-1);
        });
      }
      var frag=document.createDocumentFragment();
      order.forEach(function(i){frag.appendChild(rows[i]);});
      body.appendChild(frag);
    }
    if(wrap.classList.contains('is-sortable')||wrap.classList.contains('is-resizable')){
      reset=document.createElement('button');reset.type='button';reset.className='md-table-reset';
      reset.textContent='還原順序與欄寬';reset.title='還原順序與欄寬';
      tools.appendChild(reset);
      reset.addEventListener('click',function(){
        if(wrap.classList.contains('is-sortable')){sortBy(0,0);cells.forEach(function(h){h.removeAttribute('aria-sort');});}
        if(wrap.classList.contains('is-resizable'))resetWidths();
        announce('已還原原始順序與欄寬');
      });
    }
    // 捲動提示與可鍵盤捲動的區域（只有寬表的卡片會自己水平捲動）
    function update(){
      if(!wrap.classList.contains('is-wide'))return;
      var sx=wrap.scrollWidth>wrap.clientWidth+1;
      if(sx){
        wrap.setAttribute('tabindex','0');wrap.setAttribute('role','region');wrap.setAttribute('aria-label',label||'表格');
      }else{wrap.removeAttribute('tabindex');wrap.removeAttribute('role');wrap.removeAttribute('aria-label');}
      if(sx&&!hint){hint=document.createElement('span');hint.className='md-scroll-hint';hint.textContent='← 可左右捲動 →';tools.appendChild(hint);}
      if(hint)hint.hidden=!sx;
    }
    update();
    if(window.ResizeObserver)new ResizeObserver(update).observe(wrap);
  });
}
function enhanceDocument(){
  var art=document.querySelector('.md-content');if(!art||art.getAttribute('data-enhanced'))return;
  art.setAttribute('data-enhanced','1');
  decorateHeadings(art);
  addReadingTime(art);
  classifyLists(art);
  setupTables(art);
}
enhanceDocument();

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
