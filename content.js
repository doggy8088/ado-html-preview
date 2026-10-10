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

  function parseLocation() {
    // 兩種網址：
    //   /{org}/{project}/_git/{repo}?path=/x.html&version=GBbranch
    //   /{org}/_git/{repo}?path=/x.html            ← 專案名稱與 repo 同名時 Azure DevOps 會省略專案段
    // 後者的 REST API 仍需要專案段，實測用 repo 名當專案名可正常取得檔案（org 層級不帶專案會回 400）。
    const m = location.pathname.match(/^\/([^/]+)(?:\/([^/]+))?\/_git\/([^/?#]+)/);
    if (!m) return null;
    const qs = new URLSearchParams(location.search);
    const path = qs.get('path');
    if (!path) return null;
    const kind = /\.html?$/i.test(path) ? 'html' : /\.(md|markdown)$/i.test(path) ? 'md' : null;
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
  // 限制：只處理靜態標籤；CSS 內的 url()、腳本在執行期 fetch 的檔案（例如 PDF.js 的 worker 與 .pdf）仍無法取得。
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

  // 回傳 { size, value }：size 是原始位元組數（給總量上限用），value 是文字或 data: URL
  async function fetchAsset(info, repoPath, asText) {
    const res = await fetch(rawUrl({ ...info, path: repoPath }, 'octetStream'), { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (blob.size > ASSET_MAX_BYTES) throw new Error('too large');
    if (asText) return { size: blob.size, value: await blob.text() };
    // 回應的 content-type 形如 image/png; api-version=7.1，只取主型別
    const ext = (repoPath.split('.').pop() || '').toLowerCase();
    const mime = MIME[ext] || (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { size: blob.size, value: `data:${mime};base64,${btoa(bin)}` };
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

    // 先平行抓回所有資源，再依固定順序決定哪些納入總量上限：
    // 腳本與樣式表（缺了整個網頁就壞）優先於圖片，同類之間依 DOM 順序，結果不受回應先後影響。
    const results = await Promise.all(jobs.map(async (el) => {
      const tag = el.tagName.toLowerCase();
      const ref = el.getAttribute(tag === 'link' ? 'href' : 'src');
      try {
        const repoPath = resolveRepoPath(ref, info);
        return { el, tag, ref, asset: await fetchAsset(info, repoPath, tag !== 'img') };
      } catch (e) {
        return { el, tag, ref, error: String(e && e.message || e) };
      }
    }));
    const order = (r) => (r.tag === 'img' ? 1 : 0);
    let used = 0;
    for (const r of results.slice().sort((a, b) => order(a) - order(b))) {
      const { el, tag, ref } = r;
      if (r.error) { el.setAttribute('data-inline-failed', r.error); continue; } // 抓不到就保留原樣，不影響其他資源
      if (opts.totalBytes != null && used + r.asset.size > opts.totalBytes) {
        el.setAttribute('data-inline-failed', 'total asset budget exceeded');
        continue;
      }
      used += r.asset.size;
      if (tag === 'script') {
        const inline = doc.createElement('script');
        for (const a of el.attributes) if (a.name !== 'src') inline.setAttribute(a.name, a.value);
        inline.setAttribute('data-inlined-from', ref);
        // 內嵌後 JS 原始碼裡若含 </script 會提前結束標籤，改寫成 <\/script（字串語意不變）
        inline.textContent = r.asset.value.replace(/<\/script/gi, '<\\/script');
        el.replaceWith(inline);
      } else if (tag === 'link') {
        const style = doc.createElement('style');
        style.setAttribute('data-inlined-from', ref);
        if (el.media) style.setAttribute('media', el.media);
        style.textContent = r.asset.value.replace(/<\/style/gi, '<\\/style');
        el.replaceWith(style);
      } else {
        el.setAttribute('src', r.asset.value);
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
  // 問題：在 srcdoc iframe 裡點 <a href="#x"> 會被解析成「父頁面網址#x」，整個 iframe 會被導去載入 Azure DevOps 頁面，
  //       看起來就像預覽壞掉、JS 沒在跑（console 會出現一堆 ms.vss-*.min.js 的錯誤）。
  // 做法：攔截所有連結點擊——
  //   - #錨點：改用 location.hash，可正常觸發 hashchange（實測 srcdoc 內不會重載）
  //   - 相對路徑（../docs/x.md）：換算成 repo 內路徑，在新分頁開啟對應的 Azure DevOps 檔案
  //   - 絕對網址：在新分頁開啟
  //   新分頁需要 sandbox 的 allow-popups-to-escape-sandbox 才不會被 sandbox 限制。
  function linkFixScript(info, nonce) {
    const cfg = JSON.stringify({
      repoUrl: `${location.origin}/${info.org}/${info.project}/_git/${encodeURIComponent(info.repo)}`,
      dir: info.path.replace(/[^/]*$/, ''),
      version: info.version,
    });
    return `<script nonce="${nonce}">(function(){
var cfg=${cfg};
document.addEventListener('click',function(e){
  if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;
  var href=a.getAttribute('href')||'';
  if(href.charAt(0)==='#'){e.preventDefault();location.hash=href;return;}
  if(/^(javascript|mailto|tel|data|blob):/i.test(href))return;
  e.preventDefault();
  var target=href;
  if(!/^[a-z][a-z0-9+.-]*:/i.test(href)&&href.indexOf('//')!==0){
    var parts=href.split('#');
    var path=decodeURIComponent(new URL(parts[0],'https://repo.invalid'+cfg.dir).pathname);
    var q=new URLSearchParams({path:path});
    if(cfg.version)q.set('version',cfg.version);
    if(/\\.(html?|md|markdown)$/i.test(path))q.set('_a','preview');
    target=cfg.repoUrl+'?'+q.toString()+(parts[1]?'#'+parts[1]:'');
  }
  window.open(target,'_blank','noopener');
},true);
})();<\/script>`;
  }

  function injectBeforeBodyEnd(html, snippet) {
    return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, snippet + '</body>') : html + snippet;
  }

  // 確保目前在 Preview 頁籤，並回傳 ADO 自己的預覽區塊：
  //   HTML → ADO 的 srcdoc iframe；Markdown → ADO 自己渲染的 .markdown-preview-container。
  // 不含我們自己建立的 iframe（呼叫前會先 clearInlinePreview）。
  async function ensurePreviewTarget(kind) {
    const selector = kind === 'md'
      ? '.markdown-preview-container, .files-hub-content-preview'
      : `iframe[srcdoc]:not([${FRAME_ATTR}])`;
    const find = () => document.querySelector(selector);
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

    // Markdown 預覽文件的 <script> 在 buildDocument 時已帶 nonce；HTML 檔則在這裡統一補上
    let doc = info.kind === 'md' || !nonce ? html : html.replace(/<script\b/gi, `<script nonce="${nonce}"`);
    doc = injectBeforeBodyEnd(doc, linkFixScript(info, nonce));

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
    f.srcdoc = doc;
    const oldDisplay = old.style.display;
    old.insertAdjacentElement('afterend', f);
    old.style.display = 'none';
    active = { key: previewKey(info), frame: f, old, oldDisplay };
    fitFrame();
  }

  // 讓內嵌 iframe 填滿頁籤列以下的視窗高度，網頁在 iframe 內自行捲動
  // （不用內容高度撐開：vh 單位的版面會跟著 iframe 一起長，形成無限迴圈）
  function fitFrame() {
    const f = document.querySelector(`iframe[${FRAME_ATTR}]`);
    if (!f) return;
    const top = f.getBoundingClientRect().top;
    f.style.height = `${Math.max(400, Math.floor(window.innerHeight - top - 16))}px`;
  }
  window.addEventListener('resize', fitFrame);

  // ---------- 2. 全螢幕（新視窗） ----------
  async function openWindow() {
    const info = parseLocation();
    if (!info) return;
    // 全螢幕模式跑在擴充功能的 sandbox 頁（非 srcdoc），#錨點本來就正常；
    // 仍注入連結修正腳本，讓相對路徑連結能開到對應的 Azure DevOps 檔案。sandbox CSP 允許 inline script，nonce 給空字串即可。
    const html = injectBeforeBodyEnd(await buildDocument(info, '', { totalBytes: ASSET_TOTAL_BYTES }), linkFixScript(info, ''));
    const size = byteSize(html);
    if (size > PAYLOAD_MAX_BYTES) {
      throw new Error(`預覽內容 ${(size / 1024 / 1024).toFixed(1)} MB 超過全螢幕模式的暫存上限（10 MB），請改用內嵌預覽`);
    }
    const title = `${info.path.split('/').pop()} – ${LABELS[info.kind].windowSuffix}`;
    const reply = await chrome.runtime.sendMessage({ type: 'open-preview', html, title });
    if (!reply?.ok) throw new Error(reply?.error || '無法開啟預覽視窗');
  }

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
