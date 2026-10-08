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
  if (!msg || msg.type !== 'open-preview') return;
  (async () => {
    try {
      const id = `preview_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      await chrome.storage.session.set({ [id]: { html: msg.html, title: msg.title } });
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
