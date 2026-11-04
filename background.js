// Duotify Azure DevOps HTML Preview – background service worker
// 收到 content script 送來的 HTML 後，先暫存到 chrome.storage.session，
// 再開一個獨立視窗（沿用來源視窗的位置與大小）載入 preview.html 來渲染。
// 注意：macOS 上 type:'popup' 搭配 state:'maximized' 不會放大視窗（會變成 1×33px），
// 所以一律用明確的 left/top/width/height。

async function sourceBounds(sender) {
  try {
    const win = sender?.tab?.windowId != null
      ? await chrome.windows.get(sender.tab.windowId)
      : await chrome.windows.getLastFocused();
    if (win && win.width > 200 && win.height > 200) {
      return { left: win.left, top: win.top, width: win.width, height: win.height };
    }
  } catch { /* fall through */ }
  return { left: 0, top: 0, width: 1440, height: 900 };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 新視窗的 preview.js 要按需載入執行期圖片：它沒有 Azure DevOps 的 cookie，
  // 轉給開啟視窗的那個 ADO 分頁（content script）代為抓回 data: URL
  if (msg?.type === 'fetch-asset') {
    chrome.tabs.sendMessage(msg.tabId, { type: 'fetch-asset', ref: msg.ref, info: msg.info }).then(
      (reply) => sendResponse(reply || { ok: false, error: '來源分頁沒有回應' }),
      () => sendResponse({ ok: false, error: '來源的 Azure DevOps 分頁已關閉或重新整理，無法載入圖片' }),
    );
    return true; // 非同步回覆
  }
  // 全螢幕視窗裡就地換頁：同樣轉給來源分頁，由它抓檔、內嵌資源、Markdown 排版後回傳整份預覽文件
  if (msg?.type === 'build-preview-doc') {
    chrome.tabs.sendMessage(msg.tabId, { type: 'build-preview-doc', info: msg.info, nav: msg.nav, hash: msg.hash }).then(
      (reply) => sendResponse(reply || { ok: false, error: '來源分頁沒有回應' }),
      () => sendResponse({ ok: false, error: '來源的 Azure DevOps 分頁已關閉或重新整理，無法換頁' }),
    );
    return true; // 非同步回覆
  }
  if (!msg || msg.type !== 'open-preview') return;
  (async () => {
    try {
      const id = `preview_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      // tabId / info：之後 preview.js 要圖片時，據此請原本的 ADO 分頁用同一個檔案的位置去抓
      await chrome.storage.session.set({ [id]: { html: msg.html, title: msg.title, info: msg.info, tabId: sender?.tab?.id } });
      const bounds = await sourceBounds(sender);
      await chrome.windows.create({
        url: chrome.runtime.getURL(`preview.html#${id}`),
        type: 'popup',
        focused: true,
        ...bounds,
      });
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true; // 非同步回覆
});
