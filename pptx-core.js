// Azure DevOps PowerPoint Preview – pptx（PowerPoint 簡報）→ 高保真唯讀預覽文件（content script 與 Tampermonkey 共用）
// 渲染引擎 @aiden0z/pptx-renderer（Apache-2.0，內含 JSZip 與 ECharts）：原始碼字串來自 pptx-runtime.js（AdoPptxLibs），
// 會被寫進輸出的預覽文件裡、**只在該 sandbox 文件內執行**（對不可信的 pptx 來說，渲染器與
// Azure DevOps 頁面完全隔離；父世界不載入這個函式庫）。與 docx-core.js 同一套「自帶渲染器」設計。
// 輸出是完整 HTML 文件：內容以 base64 內嵌，載入即以 PptxViewer 渲染成 HTML / SVG 投影片
// （圖形、文字、圖片、表格、圖表、SmartArt、群組、背景與漸層皆依原稿）。
// 大型簡報：lazyMedia / lazySlides ＋ windowed 清單——只解碼、只掛載捲到附近的投影片。
// 紙張語意（AGENTS.md）：投影片的配色跟著「檔案」，不隨 App 主題改變；只有頂欄與投影片之間的底色（外殼）跟隨主題。
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

  // 預覽文件內的 bootstrap（以 toString() 注入，cfg 以 JSON 內嵌）：深淺色切換（外殼）、投影片導覽、呼叫 pptx 渲染
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

    var status = document.getElementById('xp-status');
    var stage = document.getElementById('xp-stage');
    var scroller = document.getElementById('xp-scroll');
    var counter = document.getElementById('xp-count');
    var prevBtn = document.querySelector('[data-action="prev"]');
    var nextBtn = document.querySelector('[data-action="next"]');
    function fail(e) {
      status.hidden = false;
      status.className = 'xp-error';
      status.textContent = '渲染失敗：' + (e && e.message ? e.message : e);
    }

    // 瀏覽器無法解碼的圖片格式（實測為 TIFF）：原位置畫淺灰虛線框＋置中的說明文字，而不是破圖示。
    // EMF / WMF 不會走到這裡：渲染引擎抽出內嵌的點陣預覽圖交給瀏覽器，沒有預覽時是一張空白圖（載入成功、不觸發 error）。
    // 文字是固定大小的小標籤、等比縮小（img: object-fit scale-down；SVG: meet），不會隨圖片框拉伸變形。
    // error 事件不冒泡，用捕獲階段在 document 上統一處理（渲染引擎兩種都會用：<img> 與 SVG <image>）。
    var BROKEN_TIP = '此圖片格式（如 TIFF）瀏覽器無法顯示';
    var LABEL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="168" height="24" viewBox="0 0 168 24">' +
      '<text x="84" y="16.5" font-family="system-ui,-apple-system,sans-serif" font-size="13" fill="#605e5c" text-anchor="middle">' +
      '無法顯示的圖片格式</text></svg>');
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var XLINK_NS = 'http://www.w3.org/1999/xlink';
    document.addEventListener('error', function (ev) {
      var el = ev.target;
      if (!el || el.getAttribute == null || el.getAttribute('data-xp-broken')) return;
      var tag = (el.tagName || '').toLowerCase();
      if (tag !== 'img' && tag !== 'image') return;
      // 已被渲染引擎移出 DOM 的節點（清單重建、lazy 卸載）：沒有父節點可插佔位框，也看不到，略過
      if (tag === 'image' && !el.parentNode) return;
      el.setAttribute('data-xp-broken', '1');
      if (tag === 'img') {
        el.src = LABEL;
        el.title = BROKEN_TIP;
        el.style.objectFit = 'scale-down';
        el.style.background = '#f3f2f1';
        el.style.outline = '1.5px dashed #a19f9d';
        el.style.outlineOffset = '-1.5px';
      } else {
        var box = document.createElementNS(SVG_NS, 'rect');
        ['x', 'y', 'width', 'height', 'transform', 'clip-path'].forEach(function (a) {
          var v = el.getAttribute(a);
          if (v != null) box.setAttribute(a, v);
        });
        box.setAttribute('fill', '#f3f2f1');
        box.setAttribute('stroke', '#a19f9d');
        box.setAttribute('stroke-width', '1.5');
        box.setAttribute('stroke-dasharray', '6 4');
        el.parentNode.insertBefore(box, el);
        var tip = document.createElementNS(SVG_NS, 'title');
        tip.textContent = BROKEN_TIP;
        el.appendChild(tip);
        el.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        // 大圖（例如滿版的版面背景）不要把標籤放到跟圖一樣寬：標籤寬取框寬的 25%（至少 168、最多 90%），置中
        var bx = parseFloat(el.getAttribute('x') || '0'), by = parseFloat(el.getAttribute('y') || '0');
        var bw = parseFloat(el.getAttribute('width')), bh = parseFloat(el.getAttribute('height'));
        if (isFinite(bx) && isFinite(by) && bw > 0 && bh > 0 && !/%/.test(el.getAttribute('width') + el.getAttribute('height'))) {
          var lw = Math.min(bw * 0.9, Math.max(168, bw * 0.25));
          var lh = Math.min(bh, lw * 24 / 168);
          el.setAttribute('x', String(bx + (bw - lw) / 2));
          el.setAttribute('y', String(by + (bh - lh) / 2));
          el.setAttribute('width', String(lw));
          el.setAttribute('height', String(lh));
        }
        // 渲染引擎以 xlink:href 指定圖片：先拿掉，避免同時保留壞掉的原始來源（href 與 xlink:href 並存時各瀏覽器取用不一）
        if (el.hasAttributeNS && el.hasAttributeNS(XLINK_NS, 'href')) el.removeAttributeNS(XLINK_NS, 'href');
        el.setAttribute('href', LABEL);
      }
    }, true);

    var R = window.PptxRenderer;
    if (!R || !R.PptxViewer) { fail('渲染引擎未載入'); return; }

    // base64 → pptx 位元組
    var bin = atob(cfg.payload);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    bin = null;

    var total = 0;
    var current = 0;
    function update(index) {
      current = index;
      counter.textContent = total ? (index + 1) + ' / ' + total : '';
      prevBtn.disabled = !total || index <= 0;
      nextBtn.disabled = !total || index >= total - 1;
    }

    R.PptxViewer.open(bytes.buffer, stage, {
      zipLimits: R.RECOMMENDED_ZIP_LIMITS, // 不可信輸入的 ZIP 資源上限（解壓縮炸彈防護）
      pdfjs: false,                        // 不載 PDF.js（需要 eval / worker；只內嵌 PDF 預覽的 EMF 因此不顯示）
      externalMedia: 'block',              // 不向外部網址抓圖片 / 影音（隱私：預覽不對外連線）
      lazyMedia: true,                     // 大型簡報：圖片用到才解壓縮
      lazySlides: true,                    // 投影片節點用到才解析
      fitMode: 'contain',                  // 投影片寬度貼齊舞台
      scrollContainer: scroller,
      listOptions: { windowed: true, initialSlides: 3, batchSize: 6, overscanViewport: 1.5 },
      onSlideChange: function (index) { update(index); },
    }).then(function (viewer) {
      status.hidden = true;
      total = viewer.slideCount;
      update(viewer.currentSlideIndex || 0);
      // 隱藏投影片（<p:sld show="0">）：與 PowerPoint 標準檢視一樣照常顯示，但在張數標籤註明。
      // lazySlides 模式下投影片尚未解析（hidden 未定），改看保留的原始 XML 根元素屬性。
      // 視窗縮放時渲染引擎會重建整份清單（標記跟著消失），所以先算好清單、再由 MutationObserver 在重建後補標。
      var data = viewer.presentationData;
      var hiddenIdx = [];
      ((data && data.slides) || []).forEach(function (s, idx) {
        var hidden = s.hidden != null ? s.hidden
          : /<(?:[\w-]+:)?sld\b[^>]*?\sshow="(?:0|false)"/.test(String(s.sourceXml || '').slice(0, 4000));
        if (hidden) hiddenIdx.push(idx);
      });
      function markHidden() {
        hiddenIdx.forEach(function (idx) {
          var item = stage.querySelector('[data-slide-index="' + idx + '"]');
          if (item && !item.hasAttribute('data-xp-hidden')) item.setAttribute('data-xp-hidden', '1');
        });
      }
      markHidden();
      if (hiddenIdx.length && window.MutationObserver) new MutationObserver(markHidden).observe(stage, { childList: true });
      function go(delta) {
        var target = Math.max(0, Math.min(total - 1, current + delta));
        if (target !== current) viewer.goToSlide(target, { behavior: 'instant', block: 'start' });
      }
      prevBtn.addEventListener('click', function () { go(-1); });
      nextBtn.addEventListener('click', function () { go(1); });
      // 鍵盤：← / → / PageUp / PageDown 換張、Home / End 到頭尾；↑ / ↓ 保留給一般捲動
      document.addEventListener('keydown', function (ev) {
        if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
        var k = ev.key;
        if (k === 'ArrowRight' || k === 'PageDown') go(1);
        else if (k === 'ArrowLeft' || k === 'PageUp') go(-1);
        else if (k === 'Home') go(-total);
        else if (k === 'End') go(total);
        else return;
        ev.preventDefault();
      });
    }).catch(fail);
  }

  /**
   * @param {object} o
   * @param {ArrayBuffer} o.arrayBuffer  pptx 原始位元組
   * @param {string} o.fileName          檔名，顯示在頂欄
   * @param {string} [o.theme]           'light' | 'dark' | 'auto'（只影響外殼；投影片內容依原稿）
   * @param {string} [o.nonce]           CSP nonce（內嵌 blob 文件用），全螢幕給 ''
   * @param {object} [o.libs]            渲染引擎原始碼（預設取 AdoPptxLibs；測試可注入）
   * @returns {string} 完整 HTML 文件
   */
  function buildDocument(o) {
    const libs = o.libs || root.AdoPptxLibs;
    if (!libs || !libs.pptxRenderer) {
      throw new Error('pptx 渲染引擎（pptx-runtime.js 的 AdoPptxLibs）尚未載入');
    }
    const themeCss = (root.AdoMarkdownTheme && root.AdoMarkdownTheme.css) || '';
    const title = o.fileName || 'PowerPoint 預覽';
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
<style>${XP_CSS}</style>
</head>
<body>
<div class="md-app">
  <header class="md-bar">
    <div class="md-bar-title" title="${esc(o.fileName || '')}">${esc(title)}</div>
    <span class="xp-meta">PowerPoint 簡報 · 高保真預覽（配色依原稿）</span>
    <button type="button" class="md-iconbtn" data-action="prev" aria-label="上一張" title="上一張（← / PageUp）" disabled>‹</button>
    <span id="xp-count" class="xp-count" aria-live="polite"></span>
    <button type="button" class="md-iconbtn" data-action="next" aria-label="下一張" title="下一張（→ / PageDown）" disabled>›</button>
    <button type="button" class="md-iconbtn" data-action="theme" aria-label="切換深淺色">◐</button>
  </header>
  <main class="md-main xp-main" id="xp-scroll">
    <div id="xp-status">正在載入簡報…</div>
    <div class="xp-wrap"><div id="xp-stage"></div></div>
  </main>
</div>
<script${nonceAttr}>${scriptSafe(libs.pptxRenderer)}</script>
<script${nonceAttr}>(${runtime.toString()})(${jsonForScript(cfg)});</script>
</body>
</html>`;
  }

  // 外殼樣式（token 與頂欄沿用 AdoMarkdownTheme.css）。投影片本身的樣式由渲染引擎依原稿以 inline style 產生；
  // 這裡只管投影片之間的「桌面」底色（外殼，跟隨主題）與張數標籤。
  const XP_CSS = `
.xp-meta{margin-left:auto;margin-right:8px;font-size:12px;color:var(--fg-muted,#605e5c);flex-shrink:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xp-count{min-width:64px;text-align:center;font-size:13px;color:var(--fg,#201f1e);font-variant-numeric:tabular-nums}
.md-iconbtn[data-action="prev"],.md-iconbtn[data-action="next"]{font-size:22px;line-height:1}
.md-iconbtn:disabled{opacity:.4;cursor:default;background:transparent}
.xp-main{background:var(--bg-sunken,#f3f2f1)}
#xp-status{padding:48px 16px;text-align:center;color:var(--fg-muted,#605e5c)}
#xp-status.xp-error{color:var(--alert-caution-fg)}
.xp-wrap{max-width:1280px;margin:0 auto;padding:24px 24px 4px}
#xp-stage{counter-reset:xp-slide;color:#000;color-scheme:light}
#xp-stage>[data-slide-index]{counter-increment:xp-slide;margin-bottom:28px!important}
#xp-stage>[data-xp-hidden]::after{content:counter(xp-slide) " · 隱藏投影片"!important}
#xp-stage>[data-slide-index]::after{content:counter(xp-slide);display:block;text-align:center;padding-top:6px;font-size:12px;line-height:1.4;color:var(--fg-muted,#605e5c);font-variant-numeric:tabular-nums}
@media (max-width:640px){.xp-meta{display:none}.xp-wrap{padding:12px 12px 4px}}
@media print{.md-bar,#xp-status{display:none}.xp-main{background:none}#xp-stage>[data-slide-index]{break-inside:avoid}}
`;

  root.AdoPptx = { buildDocument, toBase64 };
})(typeof globalThis !== 'undefined' ? globalThis : window);
