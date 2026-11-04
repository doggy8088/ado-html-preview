// Duotify Azure DevOps HTML Preview
// 在 Azure DevOps Repos 檔案頁的頁籤列（Contents / Preview / History…）右側加兩顆按鈕：
//   HTML 檔（.html / .htm）：
//   1. 完整預覽 (內嵌)：抓取原始檔、補上頁面 CSP nonce，
//      用 sandbox="allow-scripts"（不含 allow-same-origin）的 iframe 取代現有預覽區塊，
//      iframe 高度填滿頁籤列以下的視窗。
//   2. 完整預覽 (全螢幕)：把原始檔交給 background，開一個新視窗在擴充功能的 sandbox 頁面中渲染。
//   Markdown 檔（.md / .markdown）：
//   1. Markdown 預覽 (內嵌) / 2. Markdown 預覽 (全螢幕)：
//      用 md-core.js（marked + highlight.js + DOMPurify）把 Markdown 轉成 HTML，
//      再以 md-shell.js + md-theme.js 包成支援深淺色、側邊目錄、程式碼複製與 mermaid 的預覽文件，
//      之後走與 HTML 相同的兩種顯示路徑。相對路徑的圖片會透過 Git Items API 抓回來內嵌。
//
// 開啟支援的檔案（.html / .htm / .md / .markdown）時，內嵌預覽會自動啟用、不必按按鈕（見 maybeAutoPreview）；
// 兩顆按鈕保留，用來重開預覽或改用全螢幕。
// 預覽內點擊指向 repo 文件的連結會「就地換頁」（不開新分頁），瀏覽器上一頁 / 前進逐頁可用，像真的在逛網站；
// 每份文件左上角另有「← 上一頁」小圓鈕（見「就地換頁」段落）。

(() => {
  const WRAP_ID = '__ado_js_preview_wrap';
  const FRAME_ATTR = 'data-ado-js-preview';
  const LABELS = {
    html: {
      inline: '完整預覽 (內嵌)', inlineTitle: '在目前的預覽區塊以啟用 JavaScript 的方式顯示完整網頁',
      window: '完整預覽 (全螢幕)', windowTitle: '在新視窗以啟用 JavaScript 的方式全螢幕預覽此 HTML',
      windowSuffix: '完整預覽',
    },
    md: {
      inline: 'Markdown 預覽 (內嵌)', inlineTitle: '在目前的預覽區塊以更易讀的排版顯示此 Markdown（支援深淺色、目錄、mermaid）',
      window: 'Markdown 預覽 (全螢幕)', windowTitle: '在新視窗以更易讀的排版全螢幕預覽此 Markdown',
      windowSuffix: 'Markdown 預覽',
    },
  };
  const MERMAID_URL = chrome.runtime.getURL('vendor/mermaid.min.js');

  // 檔案類型：HTML（.html / .htm）與 Markdown（.md / .markdown）；其他檔案不支援預覽
  const kindOf = (path) => (/\.html?$/i.test(path) ? 'html' : /\.(md|markdown)$/i.test(path) ? 'md' : null);

  function parseLocation() {
    // 兩種網址：
    //   /{org}/{project}/_git/{repo}?path=/x.html&version=GBbranch
    //   /{org}/_git/{repo}?path=/x.html            ← 專案名稱與 repo 同名時 Azure DevOps 會省略專案段
    // 後者的 REST API 仍需要專案段，實測用 repo 名當專案名可正常取得檔案（org 層級不帶專案會回 400）。
    // 結尾的 repo 段後不能再有路徑段：PR / commit 等頁面（/_git/{repo}/pullrequest/123?path=/x.html）
    // 也會帶 path= 參數，但那些頁面沒有可取代的預覽區塊，不是本擴充功能的對象。
    const m = location.pathname.match(/^\/([^/]+)(?:\/([^/]+))?\/_git\/([^/?#]+)\/?$/);
    if (!m) return null;
    const qs = new URLSearchParams(location.search);
    const path = qs.get('path');
    if (!path) return null;
    const kind = kindOf(path);
    if (!kind) return null;
    const version = qs.get('version') || currentBranchVersion();
    const repo = decodeURIComponent(m[3]);
    const project = m[2] ? decodeURIComponent(m[2]) : repo;
    return { org: m[1], project, repo, path, version, kind };
  }

  // 網址沒有 version= 時，Azure DevOps 顯示的是使用者上次瀏覽的分支（不一定是 repo 預設分支），
  // 但 API 不帶版本會用預設分支 → 檔案只存在於其他分支時回 404。改讀版本選擇器上顯示的分支。
  // 選 tag / commit 時 ADO 一定會把 GT / GC 寫進網址，所以這裡只需處理分支（OpenSource 圖示）。
  function currentBranchVersion() {
    const icon = document.querySelector('.artifact-dropdown-icon.ms-Icon--OpenSource');
    const name = icon?.closest('button')?.textContent.trim();
    return name ? `GB${name}` : '';
  }

  // format：主 HTML 用 text；其他資源一律用 octetStream——text 會把二進位檔（png/jpg）當文字轉碼而損毀
  function rawUrl({ org, project, repo, path, version }, format = 'text') {
    const p = new URLSearchParams({
      path,
      includeContent: 'true',
      // 與 ADO 自己的請求一致：LFS 追蹤的檔案回傳實際內容，而不是 LFS 指標檔；一般檔案結果不變
      resolveLfs: 'true',
      'api-version': '7.1',
      '$format': format,
    });
    // version=GBbranch / GTtag / GCcommit
    if (version.length > 2) {
      const type = { GB: 'branch', GT: 'tag', GC: 'commit' }[version.slice(0, 2)];
      if (type) {
        p.set('versionDescriptor.version', version.slice(2));
        p.set('versionDescriptor.versionType', type);
      }
    }
    return `${location.origin}/${org}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/items?${p}`;
  }

  // 主檔（HTML 或 Markdown）以 text 格式取回
  async function fetchSource(info) {
    const res = await fetch(rawUrl(info), { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  // ---------- 相對路徑資源內嵌 ----------
  // sandbox iframe 裡的相對網址會解析到 Azure DevOps 的頁面網址而不是 repo 檔案，
  // 所以 <script src="viewer.js">、<link rel="stylesheet" href="x.css">、<img src="a.png"> 全部載不到。
  // 做法：在渲染前用同一個 Git Items API 把這些同 repo 的相對資源抓回來，直接內嵌成
  // <script>…</script>、<style>…</style> 與 data: URL。
  // 限制：這裡只處理靜態標籤；執行期才出現的 <img> 由 lazyImageScript 按需載入（見下方）。
  //       CSS 內的 url()、腳本在執行期 fetch 的檔案（例如 PDF.js 的 worker 與 .pdf）仍無法取得。
  const ASSET_LIMIT = 60;            // 最多內嵌幾個資源
  const ASSET_MAX_BYTES = 8 * 1024 * 1024;
  // 全螢幕模式的體積上限：整份 HTML 要放進 chrome.storage.session（配額 10 MB）。
  //   ASSET_TOTAL_BYTES：資源原始位元組加總（base64 後 ×1.33）的上限，再扣掉主檔本身的大小；
  //   超過的資源保留原樣不內嵌。內嵌模式的 srcdoc 沒有這個限制，不套用。
  //   PAYLOAD_MAX_BYTES：最終序列化後的 HTML 上限（留餘裕給 JSON 與標題），超過就直接報錯，
  //   不送給 background 以免 storage 寫入失敗後才出現不明錯誤。
  const ASSET_TOTAL_BYTES = 6 * 1024 * 1024;
  const PAYLOAD_MAX_BYTES = 9.5 * 1024 * 1024;
  const byteSize = (s) => new Blob([s]).size;

  function isRelativeRef(ref) {
    return !!ref && !/^[a-z][a-z0-9+.-]*:/i.test(ref) && !ref.startsWith('//') && !ref.startsWith('#') && !ref.startsWith('data:');
  }

  // 把相對路徑換算成 repo 內的絕對路徑（處理 ../ 與 ./），並去掉 query / hash
  function resolveRepoPath(ref, info) {
    const dir = info.path.replace(/[^/]*$/, '');
    const clean = ref.split('#')[0].split('?')[0];
    return decodeURIComponent(new URL(clean, 'https://repo.invalid' + dir).pathname);
  }

  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp' };

  // 先只抓回 blob（檢查單檔上限），轉成文字 / data: URL 是另一步，讓總量上限能在轉 base64 之前判斷
  async function fetchAssetBlob(info, repoPath) {
    const res = await fetch(rawUrl({ ...info, path: repoPath }, 'octetStream'), { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (blob.size > ASSET_MAX_BYTES) throw new Error('too large');
    return { blob, contentType: res.headers.get('content-type') || '' };
  }

  async function assetValue({ blob, contentType }, repoPath, asText) {
    if (asText) return blob.text();
    // 回應的 content-type 形如 image/png; api-version=7.1，只取主型別
    const ext = (repoPath.split('.').pop() || '').toLowerCase();
    const mime = MIME[ext] || (contentType || 'application/octet-stream').split(';')[0].trim();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return `data:${mime};base64,${btoa(bin)}`;
  }

  // ---------- 執行期圖片（按需載入） ----------
  // 靜態 <img> 在渲染前就已內嵌，但許多網頁的圖片是 JS 執行期才用 innerHTML / .src 產生的，
  // 渲染前的靜態掃描看不到。iframe 內會注入 lazyImageScript：發現相對路徑的 <img> 且進入視窗附近時，
  // 向父頁面送 ado-asset-request，由這裡抓回 data: URL 後以 ado-asset-response 回傳。
  // 只服務圖片副檔名：請求來自不受信任的網頁腳本，不能讓它藉此讀取 repo 內任意檔案。
  const IMAGE_EXT = new RegExp(`\\.(${Object.keys(MIME).join('|')})$`, 'i');

  async function fetchImageDataUrl(info, ref) {
    const repoPath = resolveRepoPath(ref, info);
    if (!IMAGE_EXT.test(repoPath)) throw new Error('not an image');
    return assetValue(await fetchAssetBlob(info, repoPath), repoPath, false);
  }

  function replyAsset(target, ref, info) {
    // sandbox iframe 的 origin 為 null，targetOrigin 只能用 '*'
    fetchImageDataUrl(info, ref).then(
      (value) => target.postMessage({ type: 'ado-asset-response', ref, value }, '*'),
      (e) => target.postMessage({ type: 'ado-asset-response', ref, error: String(e?.message || e) }, '*'),
    );
  }

  // opts.totalBytes：所有資源原始位元組加總的上限（只有全螢幕模式需要，見 ASSET_TOTAL_BYTES）；
  // 省略 = 不限制總量（內嵌模式）。
  async function inlineRelativeAssets(html, info, opts = {}) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.querySelector('base[href]')) return html; // 作者自己指定了 base，尊重它

    const jobs = [];
    const take = (el) => {
      if (jobs.length >= ASSET_LIMIT) return false;
      jobs.push(el);
      return true;
    };
    for (const el of doc.querySelectorAll('script[src]')) {
      if (isRelativeRef(el.getAttribute('src'))) take(el);
    }
    for (const el of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
      if (isRelativeRef(el.getAttribute('href'))) take(el);
    }
    for (const el of doc.querySelectorAll('img[src]')) {
      if (isRelativeRef(el.getAttribute('src'))) take(el);
    }
    if (!jobs.length) return html;

    // 處理順序：腳本與樣式表（缺了整個網頁就壞）優先於圖片，同類之間依 DOM 順序。
    // 有總量上限（全螢幕模式）時依此順序「逐一」抓取，剩餘額度不夠就不再抓、也不轉 base64，
    // 避免先把幾十個大圖全部下載進記憶體才發現要丟掉；沒有上限（內嵌模式）時平行抓取。
    const items = jobs.map((el) => {
      const tag = el.tagName.toLowerCase();
      return { el, tag, ref: el.getAttribute(tag === 'link' ? 'href' : 'src') };
    }).sort((a, b) => (a.tag === 'img' ? 1 : 0) - (b.tag === 'img' ? 1 : 0));
    const budgeted = opts.totalBytes != null;
    let remaining = budgeted ? opts.totalBytes : Infinity;
    const load = async (r) => {
      try {
        if (budgeted && remaining <= 0) throw new Error('total asset budget exceeded');
        const repoPath = resolveRepoPath(r.ref, info);
        const fetched = await fetchAssetBlob(info, repoPath);
        // 一旦有資源放不進剩餘額度就視為額度用盡：後面（優先序更低）的資源直接略過，不再逐一下載後丟棄
        if (budgeted && fetched.blob.size > remaining) { remaining = 0; throw new Error('total asset budget exceeded'); }
        remaining -= fetched.blob.size;
        r.value = await assetValue(fetched, repoPath, r.tag !== 'img');
      } catch (e) {
        r.error = String(e && e.message || e);
      }
    };
    if (budgeted) { for (const r of items) await load(r); } else { await Promise.all(items.map(load)); }
    for (const r of items) {
      const { el, tag, ref } = r;
      if (r.error) { el.setAttribute('data-inline-failed', r.error); continue; } // 抓不到就保留原樣，不影響其他資源
      if (tag === 'script') {
        const inline = doc.createElement('script');
        for (const a of el.attributes) if (a.name !== 'src') inline.setAttribute(a.name, a.value);
        inline.setAttribute('data-inlined-from', ref);
        // 內嵌後 JS 原始碼裡若含 </script 會提前結束標籤，改寫成 <\/script（字串語意不變）
        inline.textContent = r.value.replace(/<\/script/gi, '<\\/script');
        el.replaceWith(inline);
      } else if (tag === 'link') {
        const style = doc.createElement('style');
        style.setAttribute('data-inlined-from', ref);
        if (el.media) style.setAttribute('media', el.media);
        style.textContent = r.value.replace(/<\/style/gi, '<\\/style');
        el.replaceWith(style);
      } else {
        el.setAttribute('src', r.value);
      }
    }

    const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : '<!DOCTYPE html>';
    return doctype + '\n' + doc.documentElement.outerHTML;
  }

  function getNonce() {
    // nonce 屬性在 DOM 中會被隱藏，但 .nonce property 仍可讀
    for (const s of document.querySelectorAll('script')) {
      if (s.nonce) return s.nonce;
    }
    return '';
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 注入到預覽 HTML 尾端的連結修正腳本。
  // 問題：在 sandbox iframe 裡點 <a href="#x"> 會被解析成「父頁面網址#x」，整個 iframe 會被導去載入 Azure DevOps 頁面，
  //       看起來就像預覽壞掉、JS 沒在跑（console 會出現一堆 ms.vss-*.min.js 的錯誤）。
  // 做法：攔截所有連結點擊——
  //   - #錨點：改用 location.hash，可正常觸發 hashchange（實測不會重載）
  //   - 相對路徑的支援格式（.html / .htm / .md / .markdown）：送 ado-nav-request 給父頁面「就地換頁」，
  //     不開新分頁，就像真的在逛網站
  //   - 其他相對路徑（../docs/x.png）：換算成 repo 內路徑，在新分頁開啟對應的 Azure DevOps 檔案
  //   - 絕對網址：在新分頁開啟
  //   新分頁需要 sandbox 的 allow-popups-to-escape-sandbox 才不會被 sandbox 限制。
  // 另外注入「← 上一頁」小圓鈕（nav > 0 才顯示）：popup 型視窗沒有工具列，需要一個看得見的回上一頁入口；
  // 點它與瀏覽器上一頁走同一條歷史（由父頁面呼叫 history.back()，見「就地換頁」段落）。
  function linkFixScript(info, nonce, nav, hash) {
    // JSON.stringify 不會跳脫 <，網址裡的路徑 / 分支名若含 </script> 會提前結束這段 script；統一改寫成 \u003c
    const cfg = JSON.stringify({
      repoUrl: `${location.origin}/${info.org}/${info.project}/_git/${encodeURIComponent(info.repo)}`,
      dir: info.path.replace(/[^/]*$/, ''),
      version: info.version,
      nav,
      hash: hash || '',
    }).replace(/</g, '\\u003c');
    return `<script nonce="${nonce}">(function(){
var cfg=${cfg};
var DOC_RE=/\\.(html?|md|markdown)$/i;
// 回傳 {path,hash}（repo 內的相對路徑）或 {url}（絕對網址）或 null（#錨點、javascript: 等交回原本的處理）
function resolve(a){
  var href=a.getAttribute('href')||'';
  if(href.charAt(0)==='#'||/^(javascript|mailto|tel|data|blob):/i.test(href))return null;
  if(/^[a-z][a-z0-9+.-]*:/i.test(href)||href.indexOf('//')===0)return {url:href};
  var parts=href.split('#');
  var path=decodeURIComponent(new URL(parts[0],'https://repo.invalid'+cfg.dir).pathname);
  return {path:path,hash:parts[1]||''};
}
function adoUrl(r){
  var q=new URLSearchParams({path:r.path});
  if(cfg.version)q.set('version',cfg.version);
  if(DOC_RE.test(r.path))q.set('_a','preview');
  return cfg.repoUrl+'?'+q.toString()+(r.hash?'#'+r.hash:'');
}
function findLink(e){return e.target&&e.target.closest?e.target.closest('a[href]'):null;}
document.addEventListener('click',function(e){
  if(e.defaultPrevented)return;
  var a=findLink(e);if(!a)return;
  var href=a.getAttribute('href')||'';
  var modified=e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey;
  if(href.charAt(0)==='#'){if(modified)return;e.preventDefault();location.hash=href;return;}
  var r=resolve(a);if(r===null)return;
  // Ctrl / ⌘ / Shift 點擊：把 href 改寫成 repo 內對應的網址後交給瀏覽器，保留原生的「在新分頁 / 新視窗開啟」行為
  if(modified){a.setAttribute('href',r.url||adoUrl(r));a.setAttribute('target','_blank');a.setAttribute('rel','noopener');return;}
  // 支援格式的文件：就地換頁（父頁面組好新文件後導覽預覽 iframe），不開新分頁
  if(r.path&&DOC_RE.test(r.path)){
    e.preventDefault();e.stopPropagation();
    window.parent.postMessage({type:'ado-nav-request',path:r.path,hash:r.hash,from:cfg.nav},'*');
    return;
  }
  e.preventDefault();
  window.open(r.url||adoUrl(r),'_blank','noopener');
},true);
// 中鍵點擊是 auxclick（不會觸發 click），一樣先把 href 改寫成 repo 內的網址再讓瀏覽器在新分頁開啟
document.addEventListener('auxclick',function(e){
  if(e.button!==1)return;
  var a=findLink(e);if(!a)return;
  var r=resolve(a);if(r)a.setAttribute('href',r.url||adoUrl(r));
},true);
// 換頁過來帶有錨點時（x.md#install 之類的連結）捲到目標
if(cfg.hash){
  var go=function(){
    var h=cfg.hash;try{h=decodeURIComponent(h);}catch(_e){}
    var el=document.getElementById(h)||document.getElementsByName(h)[0];
    if(el&&el.scrollIntoView)el.scrollIntoView();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();
}
// ← 上一頁：與瀏覽器上一頁走同一條歷史（由父頁面呼叫 history.back()），不會再多堆一筆紀錄
if(cfg.nav>0){
  var b=document.createElement('button');
  b.type='button';
  b.title='上一頁（回到上一份文件）';
  b.textContent='←';
  b.setAttribute('style','position:fixed;top:10px;left:10px;z-index:2147483647;width:30px;height:30px;padding:0;border-radius:50%;border:1px solid rgba(0,0,0,.2);background:rgba(255,255,255,.85);color:#333;font:16px/1 system-ui,sans-serif;cursor:pointer;opacity:.45;box-shadow:0 1px 4px rgba(0,0,0,.2)');
  b.addEventListener('mouseenter',function(){b.style.opacity='1';});
  b.addEventListener('mouseleave',function(){b.style.opacity='.45';});
  b.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();window.parent.postMessage({type:'ado-nav-back',from:cfg.nav},'*');});
  var mount=function(){document.body.appendChild(b);};
  if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount);
}
})();<\/script>`;
  }

  // 注入到預覽 HTML 尾端的「相對路徑圖片按需載入」腳本（與 fetchImageDataUrl 成對）。
  // 對象是執行期才出現的 <img>（含 innerHTML 塞入、事後改 src）：
  //   - 登記 src 為相對路徑的 <img>，用 IntersectionObserver 等它進入視窗附近（400px）才向父頁面要圖，
  //     display:none 或捲到很遠的圖不會下載；沒有 IntersectionObserver 時立刻要
  //   - 同一個路徑只問一次（cache / waiting），失敗也記錄起來不重試，並在 img 標上 data-ado-img-failed
  //   - 父頁面的回應端：內嵌模式是 content script，全螢幕模式是 preview.js（再經 background 轉給來源分頁）
  // 瀏覽器會先拿相對網址對照父頁面網址發出一個無效請求（回傳 ADO 頁面而非圖片），無法避免，只是浪費一次請求。
  function lazyImageScript(nonce, nav) {
    return `<script nonce="${nonce}">(function(){
var cache=new Map();   // ref → data URL；null 代表失敗
var waiting=new Map(); // ref → 等待回應的 <img> 陣列
var tracked=new WeakMap(); // img → 登記時的 src 屬性值
function isRel(r){return !!r&&!/^[a-z][a-z0-9+.-]*:/i.test(r)&&r.indexOf('//')!==0&&r.charAt(0)!=='#';}
function apply(img,ref,v){
  if(tracked.get(img)!==ref||img.getAttribute('src')!==ref)return; // 等待期間網頁已改掉 src
  tracked.delete(img);
  if(v)img.setAttribute('src',v);else img.setAttribute('data-ado-img-failed','1');
}
function request(img){
  var ref=tracked.get(img);if(ref==null)return;
  if(cache.has(ref)){apply(img,ref,cache.get(ref));return;}
  var list=waiting.get(ref);
  if(list){list.push(img);return;}
  waiting.set(ref,[img]);
  window.parent.postMessage({type:'ado-asset-request',ref:ref,from:${nav}},'*');
}
var io=typeof IntersectionObserver==='function'?new IntersectionObserver(function(es){
  es.forEach(function(e){if(e.isIntersecting){io.unobserve(e.target);request(e.target);}});
},{rootMargin:'400px'}):null;
function handle(img){
  var ref=img.getAttribute('src');
  if(!isRel(ref)){tracked.delete(img);return;}
  if(tracked.get(img)===ref)return;
  tracked.set(img,ref);
  if(cache.has(ref)){apply(img,ref,cache.get(ref));return;}
  if(io)io.observe(img);else request(img);
}
function scan(n){
  if(n.nodeType!==1)return;
  if(n.tagName==='IMG')handle(n);
  [].forEach.call(n.querySelectorAll('img'),handle);
}
window.addEventListener('message',function(ev){
  var d=ev.data;
  if(ev.source!==window.parent||!d||d.type!=='ado-asset-response')return;
  var list=waiting.get(d.ref)||[];waiting.delete(d.ref);
  var v=typeof d.value==='string'?d.value:null;
  if(!v)console.warn('[Azure DevOps HTML Preview] 無法載入圖片 '+d.ref+'：'+(d.error||'unknown'));
  cache.set(d.ref,v);
  list.forEach(function(img){apply(img,d.ref,v);});
});
new MutationObserver(function(ms){
  ms.forEach(function(m){
    if(m.type==='attributes'){if(m.target.tagName==='IMG')handle(m.target);}
    else[].forEach.call(m.addedNodes,scan);
  });
}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
scan(document.documentElement);
})();<\/script>`;
  }

  function injectBeforeBodyEnd(html, snippet) {
    return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, snippet + '</body>') : html + snippet;
  }

  // 預覽文件尾端要注入的腳本：連結修正 + 圖片按需載入。
  // 作者自己指定了 <base href> 時，相對網址由他的 base 決定（inlineRelativeAssets 也同樣尊重），不注入圖片腳本。
  function previewScripts(html, info, nonce, nav = 0, hash = '') {
    return linkFixScript(info, nonce, nav, hash) + (/<base\b[^>]*\bhref\s*=/i.test(html) ? '' : lazyImageScript(nonce, nav));
  }

  // 組出最終放入 sandbox 的完整預覽文件：HTML 檔補上 CSP nonce、注入連結修正與圖片按需載入腳本。
  // nav / hash：就地換頁時的頁次與錨點（第一頁 nav=0、無錨點）。
  function finalizeDoc(html, info, nonce, nav = 0, hash = '') {
    // Markdown 預覽文件的 <script> 在 buildDocument 時已帶 nonce；HTML 檔則在這裡統一補上
    const doc = info.kind === 'md' || !nonce ? html : html.replace(/<script\b/gi, `<script nonce="${nonce}"`);
    return injectBeforeBodyEnd(doc, previewScripts(doc, info, nonce, nav, hash));
  }

  // ---------- 就地換頁（像逛網站一樣） ----------
  // 預覽文件之間的連結不再開新分頁：父頁面組好目標文件後，讓預覽 iframe 在「blob: URL」之間導覽。
  //   - blob 文件沿用建立者（Azure DevOps 頁面）的 CSP，既有的 nonce 機制照常運作
  //     （實測 dev.azure.com 的 frame-src / child-src 有開放 blob:；chrome-extension:// 反而會被 CSP 擋下）。
  //   - 每次導覽都是一筆真的歷史紀錄，瀏覽器上一頁 / 前進會逐頁回到之前的文件
  //     （實測：反覆重設 srcdoc 不會留下可用的歷史，上一頁只會重讀目前的 srcdoc 內容）。
  //   - blob URL 建立後不能 revoke：上一頁就是靠瀏覽器重新載入它。
  // 全螢幕模式由 preview.js 用 sandbox.html?nav=N 做同一件事（擴充功能頁面的 CSP 不允許 blob 文件跑 inline script）。
  let navInfos = []; // 第 k 份文件的 info（相對路徑資源以它為基準）；換頁時依 from 截斷
  let navUrls = [];  // 第 k 份文件的 blob URL

  function docBlobUrl(doc) {
    return URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
  }

  // 換頁失敗時的錯誤文件（像瀏覽器的錯誤頁，上一頁仍可回去）
  function errorDocument(info, nav, message) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const html = '<!DOCTYPE html><html><body style="font:14px/1.8 system-ui,sans-serif;color:#444;padding:24px">' +
      `<h3 style="margin:0 0 8px;font-size:16px">無法載入 ${esc(info.path)}</h3><p style="margin:0">${esc(message)}</p></body></html>`;
    return injectBeforeBodyEnd(html, linkFixScript(info, '', nav, ''));
  }

  // 確保目前在 Preview 頁籤，並回傳 ADO 自己的預覽區塊：
  //   HTML → ADO 的 srcdoc iframe；Markdown → ADO 自己渲染的 .markdown-preview-container。
  // 不含我們自己建立的 iframe（呼叫前會先 clearInlinePreview）。
  async function ensurePreviewTarget(kind) {
    // Markdown：優先找 .markdown-preview-container，找不到才退回較外層的 .files-hub-content-preview
    //（selector list 會回傳文件順序最前的元素，兩者巢狀時會抓到外層，所以要分開查）
    const find = kind === 'md'
      ? () => document.querySelector('.markdown-preview-container') || document.querySelector('.files-hub-content-preview')
      : () => document.querySelector(`iframe[srcdoc]:not([${FRAME_ATTR}])`);
    let frame = find();
    if (frame) return frame;
    // 頁籤文字會隨 ADO 顯示語言改變，先用與 _a=preview 對應的 id 找，文字比對只當備援
    const tab = document.querySelector('.bolt-tabbar #__bolt-tab-preview')
      || [...document.querySelectorAll('.bolt-tabbar [role="tab"]')]
        .find((t) => /^preview$/i.test(t.textContent.trim()));
    if (!tab) throw new Error('找不到 Preview 頁籤');
    tab.click();
    for (let i = 0; i < 40 && !(frame = find()); i++) await sleep(100);
    if (!frame) throw new Error('Preview 區塊尚未出現，請再試一次');
    return frame;
  }

  // ---------- Markdown ----------
  // Azure DevOps 目前的主題：body 有 ms-vss-web-vsts-theme-dark 即深色；預覽文件以此決定初始深淺色。
  function adoTheme() {
    const cls = document.body.className;
    if (/ms-vss-web-vsts-theme-dark/.test(cls)) return 'dark';
    if (/ms-vss-web-vsts-theme/.test(cls)) return 'light';
    return 'auto';
  }

  // 把 Markdown 原始碼轉成完整的預覽 HTML 文件（含主題、目錄、bootstrap 腳本），
  // 並把相對路徑的圖片透過 Git Items API 抓回來內嵌。
  async function buildMarkdownDocument(md, info, nonce, assetOpts) {
    const r = AdoMarkdown.render(md);
    const fileName = info.path.split('/').pop(); // path 來自 URLSearchParams，已經是解碼後的值
    const doc = AdoMarkdownShell.buildDocument({
      html: r.html, toc: r.toc, title: r.title, fileName,
      theme: adoTheme(), nonce, mermaidSrc: r.hasMermaid ? MERMAID_URL : '', mermaidFallback: true,
    });
    return inlineRelativeAssets(doc, info, assetOpts);
  }

  // mermaid 的備援載入：sandbox iframe（origin 為 null）直接 <script src="chrome-extension://…"> 可能被擋，
  // 失敗時預覽文件會向父頁面要原始碼，由 content script 用擴充功能的身分抓回來再 postMessage 回去。
  window.addEventListener('message', (ev) => {
    if (ev.data?.type !== 'ado-md-mermaid-request' || !ev.source) return;
    const frame = document.querySelector(`iframe[${FRAME_ATTR}]`);
    if (!frame || ev.source !== frame.contentWindow) return;
    fetch(MERMAID_URL).then((r) => r.text()).then(
      (source) => ev.source.postMessage({ type: 'ado-md-mermaid-source', source }, '*'),
      (e) => ev.source.postMessage({ type: 'ado-md-mermaid-source', error: String(e?.message || e) }, '*'),
    );
  });

  // 依檔案類型產生要放進 sandbox 的完整 HTML（尚未補 nonce / 連結修正腳本）
  // assetOpts：傳給 inlineRelativeAssets（全螢幕模式帶 totalBytes）
  async function buildDocument(info, nonce, assetOpts) {
    const source = await fetchSource(info);
    // 資源上限要先扣掉主檔本身的大小，總量才會真的落在配額內
    if (assetOpts && assetOpts.totalBytes != null) {
      assetOpts = { ...assetOpts, totalBytes: Math.max(0, assetOpts.totalBytes - byteSize(source)) };
    }
    return info.kind === 'md'
      ? buildMarkdownDocument(source, info, nonce, assetOpts)
      : inlineRelativeAssets(source, info, assetOpts);
  }

  // ---------- 1. 內嵌 ----------
  // ADO 的預覽區塊是 React 管理的節點，不能用 replaceWith 拿掉：切換檔案時 React 要更新那個
  // 已不在 DOM 裡的節點，整個區塊會變成「An unexpected error has occurred within this region of the page」。
  // 做法：把原節點隱藏、把我們的 iframe 插在它後面；換檔案或 ADO 重建預覽區塊時再把 iframe 移除、恢復原節點。
  let active = null; // { key, frame, old, oldDisplay }

  // key 用 info.version（網址的 version= 或版本選擇器上推斷的分支），切換分支時即使網址沒變也會重建
  const previewKey = (info) => `${info.path}|${info.version}`;

  function clearInlinePreview() {
    if (!active) return;
    active.frame.remove();
    if (active.old.isConnected) active.old.style.display = active.oldDisplay;
    active = null;
    navInfos = [];
    navUrls = [];
  }

  // 由 MutationObserver 持續呼叫：網址換了檔案 / 分支，或 ADO 把原節點或我們的 iframe 拿掉，就清掉內嵌預覽
  function reconcileInlinePreview() {
    if (!active) return;
    const info = parseLocation();
    if (!info || !active.old.isConnected || !active.frame.isConnected) { clearInlinePreview(); return; }
    // 版本選擇器在 SPA 重繪時可能暫時不存在（info.version 為空），這時無法判斷分支，不要誤清
    if (!info.version && !new URLSearchParams(location.search).get('version')) return;
    if (previewKey(info) !== active.key) clearInlinePreview();
  }

  // 每次 renderInline 的世代編號：抓檔期間若使用者切到別的檔案並開了新的預覽，舊的那次完成後要直接放棄，
  // 不能清掉新預覽、把舊內容塞進已失效的節點
  let renderGen = 0;

  async function renderInline() {
    const info = parseLocation();
    if (!info) return;
    const gen = ++renderGen;
    clearInlinePreview();
    // srcdoc 會繼承 dev.azure.com 的 CSP（script-src 'nonce-…' 'strict-dynamic'），
    // 所以每個 <script> 都要帶上同一個 nonce 才會被允許執行。
    const nonce = getNonce();
    const [html, old] = await Promise.all([buildDocument(info, nonce), ensurePreviewTarget(info.kind)]);
    // 等待期間有更新的一次 renderInline、或使用者已切到別的檔案 / 分支：這次的結果作廢
    const now = parseLocation();
    if (gen !== renderGen || !now || previewKey(now) !== previewKey(info) || !old.isConnected) return;
    clearInlinePreview(); // 這次是最新的；若仍有舊預覽（例如同一檔案重按），先清掉

    const doc = finalizeDoc(html, info, nonce, 0, '');

    const f = document.createElement('iframe');
    f.className = info.kind === 'md' ? '' : old.className;
    f.setAttribute(FRAME_ATTR, '1');
    const bg = info.kind === 'md' && adoTheme() === 'dark' ? '#1b1b1f' : '#fff';
    f.style.cssText = `width:100%;height:80vh;border:0;background:${bg};display:block`;
    // 刻意不加 allow-same-origin：頁面腳本無法存取 Azure DevOps 的 cookie / session
    f.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals');
    // 讓 Markdown 預覽的 mermaid 全螢幕檢視能用 Fullscreen API（不給也能運作，只會蓋滿預覽區）
    f.setAttribute('allow', 'fullscreen');
    f.setAttribute('allowfullscreen', '');
    // 用 blob: URL 導覽而不是 srcdoc：每份文件都是真的歷史紀錄，瀏覽器上一頁 / 前進可用（見「就地換頁」段落）
    navInfos = [info];
    navUrls = [docBlobUrl(doc)];
    f.src = navUrls[0];
    const oldDisplay = old.style.display;
    old.insertAdjacentElement('afterend', f);
    old.style.display = 'none';
    active = { key: previewKey(info), frame: f, old, oldDisplay, info };
    fitFrame();
  }

  // 執行期圖片的回應端（內嵌模式）：只服務目前的內嵌 iframe，用它建立時的 info（之後即使換了檔案也不受影響）
  window.addEventListener('message', (ev) => {
    if (ev.data?.type !== 'ado-asset-request' || typeof ev.data.ref !== 'string' || !ev.source) return;
    if (!active || ev.source !== active.frame.contentWindow) return;
    // from：這份文件在換頁歷史中的頁次；換頁後相對路徑要以「那份文件」所在的目錄為基準
    replyAsset(ev.source, ev.data.ref, navInfos[ev.data.from] || active.info);
  });

  // 就地換頁的請求端（內嵌模式）：預覽文件點到另一份支援格式的文件
  window.addEventListener('message', async (ev) => {
    const d = ev.data;
    if (d?.type !== 'ado-nav-request' || typeof d.path !== 'string' || !ev.source) return;
    if (!active || ev.source !== active.frame.contentWindow) return;
    const from = typeof d.from === 'number' ? d.from : navInfos.length - 1;
    const base = navInfos[from] || active.info;
    const info = { ...base, path: d.path, kind: kindOf(d.path) };
    const nav = from + 1;
    const nonce = getNonce();
    let doc;
    try {
      doc = finalizeDoc(await buildDocument(info, nonce), info, nonce, nav, d.hash || '');
    } catch (e) {
      doc = errorDocument(info, nav, String(e?.message || e));
    }
    // 抓檔期間使用者可能又換了檔案或又點了連結：只認同一個還在的 iframe
    if (!active || ev.source !== active.frame.contentWindow) return;
    navInfos = navInfos.slice(0, from + 1); navInfos.push(info);
    navUrls = navUrls.slice(0, from + 1); navUrls.push(docBlobUrl(doc));
    active.frame.src = navUrls[nav];
    active.info = info;
    fitFrame();
  });

  // ← 上一頁（預覽文件內的按鈕）：呼叫瀏覽器上一頁，與工具列的上一頁走同一條歷史，不會多堆一筆
  window.addEventListener('message', (ev) => {
    if (ev.data?.type !== 'ado-nav-back' || !ev.source) return;
    if (!active || ev.source !== active.frame.contentWindow) return;
    history.back();
  });

  // 讓內嵌 iframe 填滿頁籤列以下的視窗高度，網頁在 iframe 內自行捲動
  // （不用內容高度撐開：vh 單位的版面會跟著 iframe 一起長，形成無限迴圈）
  function fitFrame() {
    const f = document.querySelector(`iframe[${FRAME_ATTR}]`);
    if (!f) return;
    const top = f.getBoundingClientRect().top;
    f.style.height = `${Math.max(400, Math.floor(window.innerHeight - top - 16))}px`;
  }
  window.addEventListener('resize', fitFrame);

  // ---------- 自動預覽 ----------
  // 開啟支援的檔案時自動顯示內嵌預覽，不必按按鈕。
  // 每個檔案 key 只自動觸發一次，切換檔案 / 分支（key 改變）才會再自動顯示：
  //   - renderInline 會改動 DOM、觸發本檔底部的 MutationObserver，不去重會形成「自動預覽 → DOM 變動 → 又自動預覽」的迴圈
  //   - 使用者手動切回 Contents 等頁籤後不該被強行拉回 Preview；ADO 重建預覽區塊時同理，需要時按按鈕即可
  let autoKey = null;        // 最後一次自動顯示（含嘗試失敗）的檔案 key
  let autoRendering = false; // 自動顯示進行中：避免 renderInline 改 DOM 引發的 MutationObserver 重入

  // 使用者明確停留在其他頁籤（History / Blame / Commit…）時不要搶走焦點；
  // 沒有 _a、_a=contents 或 _a=preview 則視為「打開檔案」，自動顯示預覽。
  function inOtherTab() {
    const a = new URLSearchParams(location.search).get('_a') || '';
    if (!a || /^(contents|preview)$/i.test(a)) return false;
    // 未知的 _a 值仍照樣自動預覽：ADO 改頁籤參數時寧可多預覽一次，也不要功能整個失效
    return /^(history|blame|commit|branch|tag|diff|compare|push|pull|shelveset|setting)/i.test(a);
  }

  function maybeAutoPreview(info) {
    if (autoRendering || inOtherTab()) return;
    // 版本選擇器還沒渲染時 version 為空，抓檔會落到 API 的預設分支（檔案不在預設分支時回 404）；
    // 等分支確定後的 MutationObserver 呼叫再自動顯示。網址帶 version= 時一開始就緒。
    if (!info.version) return;
    const key = previewKey(info);
    if (key === autoKey || (active && active.key === key)) { autoKey = key; return; }
    autoKey = key;
    autoRendering = true;
    renderInline()
      .catch((e) => console.warn('[Azure DevOps HTML Preview] 自動預覽失敗：', e))
      .finally(() => { autoRendering = false; });
  }

  // ---------- 2. 全螢幕（新視窗） ----------
  async function openWindow() {
    const info = parseLocation();
    if (!info) return;
    // 全螢幕模式跑在擴充功能的 sandbox 頁（非 srcdoc），#錨點本來就正常；
    // 仍注入連結修正腳本，讓相對路徑連結能開到對應的 Azure DevOps 檔案。sandbox CSP 允許 inline script，nonce 給空字串即可。
    const built = await buildDocument(info, '', { totalBytes: ASSET_TOTAL_BYTES });
    const html = finalizeDoc(built, info, '', 0, '');
    const title = `${info.path.split('/').pop()} – ${LABELS[info.kind].windowSuffix}`;
    // chrome.storage.session 的配額算的是 JSON 序列化後的大小（含跳脫字元、key 與標題），
    // 所以用與 background 寫入時相同的物件來量，而不是只量 HTML 字串
    const size = byteSize(JSON.stringify({ html, title, info }));
    if (size > PAYLOAD_MAX_BYTES) {
      throw new Error(`預覽內容 ${(size / 1024 / 1024).toFixed(1)} MB 超過全螢幕模式的暫存上限（10 MB），請改用內嵌預覽`);
    }
    const reply = await chrome.runtime.sendMessage({ type: 'open-preview', html, title, info });
    if (!reply?.ok) throw new Error(reply?.error || '無法開啟預覽視窗');
  }

  // 執行期圖片的回應端（全螢幕模式）：新視窗的 preview.js 沒有 Azure DevOps 的 cookie，
  // 經 background 轉到這裡，由原本的 ADO 分頁代為抓圖；info 是開啟視窗當下的檔案資訊
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'fetch-asset' && typeof msg.ref === 'string' && msg.info) {
      fetchImageDataUrl(msg.info, msg.ref).then(
        (value) => sendResponse({ ok: true, value }),
        (e) => sendResponse({ ok: false, error: String(e?.message || e) }),
      );
      return true; // 非同步回覆
    }
    // 全螢幕視窗裡就地換頁：preview.js 沒有 Azure DevOps 的 cookie，轉來這裡組好整份預覽文件再回傳
    if (msg?.type === 'build-preview-doc' && msg.info) {
      (async () => {
        try {
          const info = { ...msg.info, kind: kindOf(msg.info.path) };
          const html = finalizeDoc(await buildDocument(info, '', { totalBytes: ASSET_TOTAL_BYTES }), info, '', msg.nav || 0, msg.hash || '');
          sendResponse({ ok: true, html });
        } catch (e) {
          sendResponse({ ok: false, error: String(e?.message || e) });
        }
      })();
      return true; // 非同步回覆
    }
  });

  // ---------- 按鈕 ----------
  function makeButton(label, title, action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = title;
    btn.textContent = label;
    btn.style.cssText =
      'padding:5px 12px;border-radius:4px;border:1px solid #0078d4;background:#0078d4;' +
      'color:#fff;cursor:pointer;font-size:13px;line-height:1.4;white-space:nowrap';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '載入中…';
      try {
        await action();
        btn.textContent = label;
      } catch (e) {
        const msg = /Extension context invalidated/i.test(e.message)
          ? '擴充功能已更新，請重新整理頁面'
          : e.message;
        btn.textContent = `失敗：${msg}（再試一次）`;
      } finally {
        btn.disabled = false;
      }
    });
    return btn;
  }

  function ensureButtons() {
    reconcileInlinePreview();
    const info = parseLocation();
    const tabbar = document.querySelector('.bolt-tabbar');
    const existing = document.getElementById(WRAP_ID);
    if (!info || !tabbar) { existing?.remove(); return; }
    maybeAutoPreview(info);
    // 同一個頁籤列、同一種檔案類型就不重建（在 .html 與 .md 之間切換時要換按鈕文字）
    if (existing && existing.parentElement === tabbar && existing.dataset.kind === info.kind) return;
    existing?.remove();
    const labels = LABELS[info.kind];
    const wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    wrap.dataset.kind = info.kind;
    wrap.style.cssText = 'margin-left:auto;align-self:center;flex-shrink:0;display:flex;gap:8px';
    wrap.append(
      makeButton(labels.inline, labels.inlineTitle, renderInline),
      makeButton(labels.window, labels.windowTitle, openWindow),
    );
    tabbar.appendChild(wrap);
  }

  // Azure DevOps 是 SPA，切換檔案 / 分頁時 DOM 會重建
  new MutationObserver(ensureButtons).observe(document.body, { childList: true, subtree: true });
  ensureButtons();
})();
