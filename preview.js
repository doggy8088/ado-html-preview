// 外層 extension page（一般 CSP）：從 chrome.storage.session 取出 HTML，
// 等內層 sandbox.html（sandbox CSP，允許 inline / 外部 script）送出 ready 後再交給它渲染。
// 換頁：預覽內點到 repo 文件的連結會送 ado-nav-request 來這裡（經 background 轉給來源分頁組好整份文件），
// 之後把 iframe 導去 sandbox.html?nav=N——每個頁次都是一筆真的歷史紀錄，
// 上一頁（popup 視窗沒有工具列，用鍵盤或文件左上角的「←」鈕）會逐頁回到上一份文件。

(async () => {
  const msg = document.getElementById('msg');
  const id = location.hash.slice(1);
  if (!id) { msg.textContent = '缺少預覽資料。'; return; }

  const data = (await chrome.storage.session.get(id))[id];
  if (!data) { msg.textContent = '預覽資料已失效，請回 Azure DevOps 重新點選「完整預覽 (全螢幕)」。'; return; }
  chrome.storage.session.remove(id);

  document.title = data.title || 'HTML 預覽';

  // 換頁堆疊：第 k 頁的完整內容與檔案資訊。上一頁重新載入 sandbox.html?nav=k 時由這裡取回內容。
  const pages = [{ html: data.html, info: data.info }];
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // 換頁失敗時的錯誤文件（像瀏覽器的錯誤頁）；sandbox.html 會照常描繪
  const errorPage = (path, message) =>
    '<!DOCTYPE html><html><body style="font:14px/1.8 system-ui,sans-serif;color:#444;padding:24px">' +
    `<h3 style="margin:0 0 8px;font-size:16px">無法載入 ${esc(path)}</h3><p style="margin:0">${esc(message)}</p></body></html>`;

  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads');
  frame.setAttribute('allow', 'fullscreen'); // Markdown 預覽的 mermaid 全螢幕檢視
  frame.setAttribute('allowfullscreen', '');
  window.addEventListener('message', (ev) => {
    if (ev.source !== frame.contentWindow) return;
    const d = ev.data || {};
    if (d.type === 'ready') {
      // 首次載入或上一頁 / 前進重新載入：把該頁次的內容交給 sandbox.html 描繪
      const page = pages[d.nav] || pages[0];
      frame.contentWindow.postMessage({ type: 'render', html: page.html }, '*');
    } else if (d.type === 'title' && d.title) {
      document.title = d.title;
    } else if (d.type === 'ado-asset-request' && typeof d.ref === 'string') {
      // 網頁在執行期才出現的相對路徑圖片：請 background 轉給原本的 ADO 分頁抓回 data: URL
      const ref = d.ref;
      const info = (pages[d.from] || pages[0]).info;
      const reply = (r) => frame.contentWindow?.postMessage(
        r?.ok ? { type: 'ado-asset-response', ref, value: r.value } : { type: 'ado-asset-response', ref, error: r?.error || 'unknown' }, '*');
      if (data.tabId == null || !info) { reply({ ok: false, error: '缺少來源分頁資訊' }); return; }
      chrome.runtime.sendMessage({ type: 'fetch-asset', tabId: data.tabId, info, ref }).then(reply,
        (e) => reply({ ok: false, error: String(e?.message || e) }));
    } else if (d.type === 'ado-nav-request' && typeof d.path === 'string') {
      // 就地換頁：請來源分頁組好目標文件（抓檔、內嵌資源、Markdown 排版都在那邊做），再導去下一個頁次。
      // from 是這份文件的頁次：往前走了幾步再點連結時，新的頁次要取代前進歷史（與瀏覽器一致）。
      const from = typeof d.from === 'number' ? d.from : pages.length - 1;
      const base = (pages[from] || pages[0]).info || {};
      const info = { ...base, path: d.path };
      const fail = (message) => {
        pages.length = from + 1;
        pages.push({ html: errorPage(d.path, message), info });
        frame.src = chrome.runtime.getURL(`sandbox.html?nav=${from + 1}`);
      };
      chrome.runtime.sendMessage({ type: 'build-preview-doc', tabId: data.tabId, info, nav: from + 1, hash: d.hash || '' })
        .then((r) => {
          if (r?.ok) {
            pages.length = from + 1;
            pages.push({ html: r.html, info });
            frame.src = chrome.runtime.getURL(`sandbox.html?nav=${from + 1}`);
          } else {
            fail(r?.error || 'unknown');
          }
        }, (e) => fail(String(e?.message || e)));
    } else if (d.type === 'ado-nav-back') {
      // 與鍵盤上一頁走同一條歷史（iframe 的每個頁次都在這個視窗的共同歷史裡），不會多堆一筆
      history.back();
    } else if (d.type === 'ado-md-mermaid-request') {
      // Markdown 預覽要畫 mermaid 圖但 sandbox 內載不到檔案時，由這裡讀擴充功能內的 mermaid 再傳進去
      fetch(chrome.runtime.getURL('vendor/mermaid.min.js')).then((r) => r.text()).then(
        (source) => frame.contentWindow.postMessage({ type: 'ado-md-mermaid-source', source }, '*'),
        (e) => frame.contentWindow.postMessage({ type: 'ado-md-mermaid-source', error: String(e?.message || e) }, '*'),
      );
    }
  });
  frame.src = chrome.runtime.getURL('sandbox.html?nav=0');
  msg.replaceWith(frame);
})();
