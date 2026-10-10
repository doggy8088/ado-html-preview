// 外層 extension page（一般 CSP）：從 chrome.storage.session 取出 HTML，
// 等內層 sandbox.html（sandbox CSP，允許 inline / 外部 script）送出 ready 後再交給它渲染。

(async () => {
  const msg = document.getElementById('msg');
  const id = location.hash.slice(1);
  if (!id) { msg.textContent = '缺少預覽資料。'; return; }

  const data = (await chrome.storage.session.get(id))[id];
  if (!data) { msg.textContent = '預覽資料已失效，請回 Azure DevOps 重新點選「以 JS 模式預覽」。'; return; }
  chrome.storage.session.remove(id);

  document.title = data.title || 'HTML 預覽';

  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads');
  frame.setAttribute('allow', 'fullscreen'); // Markdown 預覽的 mermaid 全螢幕檢視
  frame.setAttribute('allowfullscreen', '');
  window.addEventListener('message', (ev) => {
    if (ev.source !== frame.contentWindow) return;
    if (ev.data?.type === 'ready') {
      frame.contentWindow.postMessage({ type: 'render', html: data.html }, '*');
    } else if (ev.data?.type === 'title' && ev.data.title) {
      document.title = ev.data.title;
    } else if (ev.data?.type === 'ado-md-mermaid-request') {
      // Markdown 預覽要畫 mermaid 圖但 sandbox 內載不到檔案時，由這裡讀擴充功能內的 mermaid 再傳進去
      fetch(chrome.runtime.getURL('vendor/mermaid.min.js')).then((r) => r.text()).then(
        (source) => frame.contentWindow.postMessage({ type: 'ado-md-mermaid-source', source }, '*'),
        (e) => frame.contentWindow.postMessage({ type: 'ado-md-mermaid-source', error: String(e?.message || e) }, '*'),
      );
    }
  });
  frame.src = chrome.runtime.getURL('sandbox.html');
  msg.replaceWith(frame);
})();
