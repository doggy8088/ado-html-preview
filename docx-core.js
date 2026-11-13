// Azure DevOps Word Preview – docx（Word 文件）→ 高保真唯讀預覽文件（content script 與 Tampermonkey 共用）
// 渲染引擎 docx-preview（Apache-2.0）+ JSZip（MIT）：原始碼字串來自 docx-runtime.js（AdoDocxLibs），
// 會被寫進輸出的預覽文件裡、**只在該 sandbox 文件內執行**（對不可信的 docx 來說，渲染器與
// Azure DevOps 頁面完全隔離；父世界不載入這兩個函式庫）。
// 輸出是「自帶渲染器」的完整 HTML 文件：內容以 base64 內嵌，載入即以 docx.renderAsync 高保真渲染
// （樣式、表格框線、頁首頁尾、圖片（useBase64URL）、分頁與頁面尺寸皆依原稿）。
// 紙張語意（AGENTS.md）：文件頁面的配色跟著「檔案」（docx-preview 依原稿樣式輸出），不隨 App 主題改變；
// 只有頂欄外殼跟隨主題。
(function (root) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // <script> 內容安全化：把結束標籤拆開（字串／正則內的等價寫法），避免函式庫原始碼意外關閉 script
  const scriptSafe = (src) => String(src).replace(/<\/script/gi, '<\\/script');
  // 放進 <script> 的 JSON：跳脫 '<'，字串裡的 </script> 或 <!-- 不會提早結束 / 改變 script 的解析
  const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

  // ArrayBuffer → base64（分段轉以免超大陣列的參數上限）
  function toBase64(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
    }
    return btoa(bin);
  }

  // 預覽文件內的 bootstrap（以 toString() 注入，cfg 以 JSON 內嵌）：深淺色切換（外殼）＋呼叫 docx 渲染
  function runtime(cfg) {
    var rootEl = document.documentElement;
    if (cfg.theme === 'dark' || (cfg.theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      rootEl.setAttribute('data-theme', 'dark');
    }
    var themeBtn = document.querySelector('[data-action="theme"]');
    if (themeBtn) themeBtn.addEventListener('click', function () {
      var dark = rootEl.getAttribute('data-theme') === 'dark';
      rootEl.setAttribute('data-theme', dark ? 'light' : 'dark');
      themeBtn.setAttribute('aria-label', dark ? '切換為深色' : '切換為淺色');
    });
    // base64 → docx 位元組
    var bin = atob(cfg.payload);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var stage = document.getElementById('xd-stage');
    var status = document.getElementById('xd-status');
    // docx 與 JSZip 已由文件內的兩個 script 準備好（window.docx / window.JSZip）
    window.docx.renderAsync(bytes.buffer, stage, document.getElementById('xd-styles'), {
      inWrapper: true,
      useBase64URL: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
    }).then(function () {
      status.hidden = true;
    }).catch(function (e) {
      status.className = 'xd-error';
      status.textContent = '渲染失敗：' + (e && e.message ? e.message : e);
    });
  }

  /**
   * @param {object} o
   * @param {ArrayBuffer} o.arrayBuffer  docx 原始位元組
   * @param {string} o.fileName          檔名，顯示在頂欄
   * @param {string} [o.theme]           'light' | 'dark' | 'auto'（只影響外殼；文件內容依原稿）
   * @param {string} [o.nonce]           CSP nonce（內嵌 blob 文件用），全螢幕給 ''
   * @param {object} [o.libs]            渲染引擎原始碼（預設取 AdoDocxLibs；測試可注入）
   * @returns {string} 完整 HTML 文件
   */
  function buildDocument(o) {
    const libs = o.libs || root.AdoDocxLibs;
    if (!libs || !libs.jszip || !libs.docxPreview) {
      throw new Error('docx 渲染引擎（docx-runtime.js 的 AdoDocxLibs）尚未載入');
    }
    const themeCss = (root.AdoMarkdownTheme && root.AdoMarkdownTheme.css) || '';
    const title = o.fileName || 'Word 預覽';
    const nonceAttr = o.nonce ? ' nonce="' + esc(o.nonce) + '"' : '';
    const initial = o.theme === 'dark' ? 'dark' : 'light';
    const cfg = { theme: o.theme || 'auto', payload: toBase64(o.arrayBuffer) };

    return `<!DOCTYPE html>
<html lang="zh-Hant" data-theme="${initial}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<style>${themeCss}</style>
<style>${XD_CSS}</style>
</head>
<body>
<div class="md-app">
  <header class="md-bar">
    <div class="md-bar-title" title="${esc(o.fileName || '')}">${esc(title)}</div>
    <span class="xd-meta">Word 文件 · 高保真預覽（配色依原稿）</span>
    <button type="button" class="md-iconbtn" data-action="theme" aria-label="切換深淺色">◐</button>
  </header>
  <main class="md-main">
    <div id="xd-status">正在渲染文件…</div>
    <div id="xd-styles"></div>
    <div id="xd-stage"></div>
  </main>
</div>
<script${nonceAttr}>${scriptSafe(libs.jszip)}</script>
<script${nonceAttr}>${scriptSafe(libs.docxPreview)}</script>
<script${nonceAttr}>(${runtime.toString()})(${jsonForScript(cfg)});</script>
</body>
</html>`;
  }

  // 外殼樣式（token 與頂欄沿用 AdoMarkdownTheme.css；文件內容樣式由 docx-preview 依原稿產生）
  const XD_CSS = `
.xd-meta{margin-left:auto;font-size:12px;color:var(--fg-muted);flex-shrink:0}
#xd-status{padding:48px 16px;text-align:center;color:var(--fg-muted)}
#xd-status.xd-error{color:var(--alert-caution-fg)}
#xd-stage{padding:0;color-scheme:light}
@media print{.md-bar,#xd-status{display:none}}
`;

  root.AdoDocx = { buildDocument, toBase64 };
})(typeof globalThis !== 'undefined' ? globalThis : window);
