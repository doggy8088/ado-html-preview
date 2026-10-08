// Duotify Azure DevOps HTML Preview
// 在 Azure DevOps Repos 檔案頁的頁籤列（Contents / Preview / History…）右側加兩顆按鈕：
//   1. 完整預覽 (內嵌)：抓取原始檔、補上頁面 CSP nonce，
//      用 sandbox="allow-scripts"（不含 allow-same-origin）的 iframe 取代現有預覽區塊，
//      iframe 高度填滿頁籤列以下的視窗。
//   2. 完整預覽 (全螢幕)：把原始檔交給 background，開一個新視窗在擴充功能的 sandbox 頁面中渲染。

(() => {
  const WRAP_ID = '__ado_js_preview_wrap';
  const FRAME_ATTR = 'data-ado-js-preview';
  const LABEL_INLINE = '完整預覽 (內嵌)';
  const LABEL_WINDOW = '完整預覽 (全螢幕)';

  function parseLocation() {
    // 兩種網址：
    //   /{org}/{project}/_git/{repo}?path=/x.html&version=GBbranch
    //   /{org}/_git/{repo}?path=/x.html            ← 專案名稱與 repo 同名時 Azure DevOps 會省略專案段
    // 後者的 REST API 仍需要專案段，實測用 repo 名當專案名可正常取得檔案（org 層級不帶專案會回 400）。
    const m = location.pathname.match(/^\/([^/]+)(?:\/([^/]+))?\/_git\/([^/?#]+)/);
    if (!m) return null;
    const qs = new URLSearchParams(location.search);
    const path = qs.get('path');
    if (!path || !/\.html?$/i.test(path)) return null;
    const version = qs.get('version') || '';
    const repo = decodeURIComponent(m[3]);
    const project = m[2] ? decodeURIComponent(m[2]) : repo;
    return { org: m[1], project, repo, path, version };
  }

  // format：主 HTML 用 text；其他資源一律用 octetStream——text 會把二進位檔（png/jpg）當文字轉碼而損毀
  function rawUrl({ org, project, repo, path, version }, format = 'text') {
    const p = new URLSearchParams({
      path,
      includeContent: 'true',
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

  async function fetchHtml(info) {
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

  async function fetchAsset(info, repoPath, asText) {
    const res = await fetch(rawUrl({ ...info, path: repoPath }, 'octetStream'), { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (blob.size > ASSET_MAX_BYTES) throw new Error('too large');
    if (asText) return blob.text();
    // 回應的 content-type 形如 image/png; api-version=7.1，只取主型別
    const ext = (repoPath.split('.').pop() || '').toLowerCase();
    const mime = MIME[ext] || (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return `data:${mime};base64,${btoa(bin)}`;
  }


  async function inlineRelativeAssets(html, info) {
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

    await Promise.all(jobs.map(async (el) => {
      const tag = el.tagName.toLowerCase();
      const ref = el.getAttribute(tag === 'link' ? 'href' : 'src');
      let repoPath;
      try { repoPath = resolveRepoPath(ref, info); } catch { return; }
      try {
        if (tag === 'script') {
          const code = await fetchAsset(info, repoPath, true);
          const inline = doc.createElement('script');
          for (const a of el.attributes) if (a.name !== 'src') inline.setAttribute(a.name, a.value);
          inline.setAttribute('data-inlined-from', ref);
          // 內嵌後 JS 原始碼裡若含 </script 會提前結束標籤，改寫成 <\/script（字串語意不變）
          inline.textContent = code.replace(/<\/script/gi, '<\\/script');
          el.replaceWith(inline);
        } else if (tag === 'link') {
          const css = await fetchAsset(info, repoPath, true);
          const style = doc.createElement('style');
          style.setAttribute('data-inlined-from', ref);
          if (el.media) style.setAttribute('media', el.media);
          style.textContent = css.replace(/<\/style/gi, '<\\/style');
          el.replaceWith(style);
        } else {
          el.setAttribute('src', await fetchAsset(info, repoPath, false));
        }
      } catch (e) {
        // 抓不到就保留原樣，不影響其他資源
        el.setAttribute('data-inline-failed', String(e && e.message || e));
      }
    }));

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
    if(/\\.html?$/i.test(path))q.set('_a','preview');
    target=cfg.repoUrl+'?'+q.toString()+(parts[1]?'#'+parts[1]:'');
  }
  window.open(target,'_blank','noopener');
},true);
})();<\/script>`;
  }

  function injectBeforeBodyEnd(html, snippet) {
    return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, snippet + '</body>') : html + snippet;
  }

  // 確保目前在 Preview 頁籤，並回傳 ADO 的預覽 iframe
  async function ensurePreviewFrame() {
    const find = () => document.querySelector('iframe[srcdoc]');
    let frame = find();
    if (frame) return frame;
    const tab = [...document.querySelectorAll('.bolt-tabbar [role="tab"]')]
      .find((t) => /^preview$/i.test(t.textContent.trim()));
    if (!tab) throw new Error('找不到 Preview 頁籤');
    tab.click();
    for (let i = 0; i < 40 && !(frame = find()); i++) await sleep(100);
    if (!frame) throw new Error('Preview 區塊尚未出現，請再試一次');
    return frame;
  }

  // ---------- 1. 內嵌 ----------
  async function renderInline() {
    const info = parseLocation();
    if (!info) return;
    const [rawHtml, old] = await Promise.all([fetchHtml(info), ensurePreviewFrame()]);
    const html = await inlineRelativeAssets(rawHtml, info);

    // srcdoc 會繼承 dev.azure.com 的 CSP（script-src 'nonce-…' 'strict-dynamic'），
    // 所以每個 <script> 都要帶上同一個 nonce 才會被允許執行。
    const nonce = getNonce();
    let doc = nonce ? html.replace(/<script\b/gi, `<script nonce="${nonce}"`) : html;
    doc = injectBeforeBodyEnd(doc, linkFixScript(info, nonce));

    const f = document.createElement('iframe');
    f.className = old.className;
    f.setAttribute(FRAME_ATTR, '1');
    f.style.cssText = 'width:100%;height:80vh;border:0;background:#fff;display:block';
    // 刻意不加 allow-same-origin：頁面腳本無法存取 Azure DevOps 的 cookie / session
    f.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals');
    f.srcdoc = doc;
    old.replaceWith(f);
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
    const html = injectBeforeBodyEnd(await inlineRelativeAssets(await fetchHtml(info), info), linkFixScript(info, ''));
    const title = `${info.path.split('/').pop()} – 完整預覽`;
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
    const info = parseLocation();
    const tabbar = document.querySelector('.bolt-tabbar');
    const existing = document.getElementById(WRAP_ID);
    if (!info || !tabbar) { existing?.remove(); return; }
    if (existing && existing.parentElement === tabbar) return;
    existing?.remove();
    const wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    wrap.style.cssText = 'margin-left:auto;align-self:center;flex-shrink:0;display:flex;gap:8px';
    wrap.append(
      makeButton(LABEL_INLINE, '在目前的預覽區塊以啟用 JavaScript 的方式顯示完整網頁', renderInline),
      makeButton(LABEL_WINDOW, '在新視窗以啟用 JavaScript 的方式全螢幕預覽此 HTML', openWindow),
    );
    tabbar.appendChild(wrap);
  }

  // Azure DevOps 是 SPA，切換檔案 / 分頁時 DOM 會重建
  new MutationObserver(ensureButtons).observe(document.body, { childList: true, subtree: true });
  ensureButtons();
})();
