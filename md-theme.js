// Azure DevOps Markdown Preview – 預覽主題（content script 與 Tampermonkey 共用）
// 設計說明：
// - 色彩 token：直接取 Fluent / Azure DevOps 中性色階。淺色 app 底 #faf9f8、內容面 #fff、文字 #201f1e、線 #edebe9；
//   深色 #201f1e 底、#292827 沉面、#3b3a39 線、文字 #f3f2f1。主色 #0078d4（深色改 #4ba0e8 以保對比），
//   成功色 #107c10 / #5db564。所有顏色都是 :root 與 html[data-theme="dark"] 上的 CSS 變數，並設定 color-scheme。
// - 字型：系統堆疊（Segoe UI / PingFang TC / Noto Sans TC / Microsoft JhengHei），等寬 SF Mono / Menlo / Consolas / Cascadia。
// - 字級與行高：正文 16px / 1.8（≤640px 時 15px / 1.75），文章欄 904px 置中（含 48px 內距）；
//   h1 32px + 下方 1px 墨線作「刊頭」，h2 23px 以「上方 64px 留白 + 1px 強灰線 + 20px 內距」切分章節，
//   h3 文字下方一段主色短線、h4 前置實心主色方塊、h5 前置空心方塊、h6 小字大寫灰字（每級都有自己的記號，不只靠字級），
//   標題緊接標題時自動收緊；表格 14px / 1.6，程式碼 13.5px / 1.65。
// - 版面：.md-bar 48px 固定（Command Bar 風格，CSS 文件圖示）；.md-toc 272px 常駐側欄（800–1099px 收為 232px，
//   <800px 浮出面板），Fluent Nav 的 3px 圓角選取指示條，長標題換行不截斷；.md-main 是唯一捲動容器（position: relative）。
// - 表格：DetailsList 風格卡片，.md-table-wrap 用 overflow: clip（不是捲動容器），表頭因此能 sticky 在 .md-main 頂端、
//   整張表展開不內捲；斑馬紋 + hover、第一欄不折行且收窄到內容寬（# / commit / ID）、th 等寬數字。
//   7 欄以上（或 md-shell 加 .is-wide）的寬表格改在卡片內水平捲動（放棄 sticky），儲存格 max-content 排版、上限 26em。
// - 程式碼：卡片（1px 邊框 + 6px 圓角 + 36px head），底色比頁底深一階；語言標籤等寬大寫（空值顯示 text），
//   Fluent DefaultButton 複製鈕，.is-done 變成實心成功綠 + 勾號；hljs 淺色為降飽和的 VS Code Light+、深色為 Dark+。
// - 提示區塊：MessageBar 風格，五種類型各有純 CSS 圖示（i / ✓ / ! / 填滿方塊 ! / 填滿圓 ×）；
//   淺色實色底、標題文字對比 ≥ 6:1，深色改透明底 + 同色系邊框，不用大面積實色。
// - 其他：引用主色左欄、[[_TOC_]] 雙欄卡片、front matter 可收合卡片、hr 64px 置中短線、
//   mermaid 卡片並覆蓋 svg 內邊標籤底色（深色不出灰塊）、失敗時以 data-error 顯示紅色標頭、自繪 checkbox、
//   錨點 hover 才顯示、focus-visible 焦點環、prefers-reduced-motion、列印樣式。
// - 深淺色切換：md-shell 切換 html[data-theme]，所有樣式皆由 token 驅動，不需要重新渲染。
(function (root) {
  'use strict';
  const css = `
/* ==========================================================================
   Azure DevOps Markdown Preview — 預覽主題（最終版）
   基底：Fluent（Segoe UI、#0078d4、ADO 中性色階、Fluent Nav 指示條、
   DetailsList 表格、MessageBar 提示區塊、VS Code 配色程式碼）。
   移植：editorial 的標題節奏與 16px/1.8 正文、第一欄不折行、短 hr、
   mermaid 邊標籤覆蓋；devdocs 的側欄長標題換行、程式碼卡片層次、
   深色 alert 透明底、填滿式 icon、ol 標號 tabular-nums。
   ========================================================================== */

/* ---------- Tokens ---------- */
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Segoe UI Web (West European)", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Cascadia Code", "Cascadia Mono", "Noto Sans Mono CJK TC", monospace;

  --bar-h: 48px;
  --toc-w: 272px;
  --content-w: 904px;            /* 含左右 48px 內距，文字量尺約 808px */
  --radius: 4px;
  --radius-lg: 6px;
  --ease: cubic-bezier(.1, .9, .2, 1);     /* Fluent decelerate 曲線 */
  --dur: 180ms;

  /* Light — Fluent 中性色階 */
  --bg-app: #faf9f8;
  --bg-surface: #ffffff;
  --bg-sunken: #f3f2f1;
  --bg-hover: #f3f2f1;
  --bg-pressed: #edebe9;
  --bg-code: #f5f4f3;
  --bg-code-head: #edebe9;
  --bg-inline-code: #f3f2f1;
  --bg-kbd: #ffffff;
  --bg-table-head: #faf9f8;
  --bg-table-stripe: #faf9f8;
  --bg-table-hover: #f3f2f1;

  --fg: #201f1e;
  --fg-2: #323130;
  --fg-muted: #605e5c;
  --fg-faint: #8a8886;
  --fg-disabled: #a19f9d;

  --line: #edebe9;
  --line-strong: #d2d0ce;
  --line-faint: #f3f2f1;

  --accent: #0078d4;
  --accent-hover: #106ebe;
  --accent-pressed: #005a9e;
  --accent-tint: #eff6fc;
  --accent-tint-2: #deecf9;
  --accent-fg: #ffffff;
  --success: #107c10;
  --success-fg: #ffffff;

  --shadow-2: 0 1.6px 3.6px rgba(0,0,0,.132), 0 .3px .9px rgba(0,0,0,.108);
  --shadow-8: 0 3.2px 7.2px rgba(0,0,0,.132), 0 .6px 1.8px rgba(0,0,0,.108);
  --shadow-16: 0 6.4px 14.4px rgba(0,0,0,.132), 0 1.2px 3.6px rgba(0,0,0,.108);

  /* MessageBar 色票（淺色：實色底；標題文字對比皆 ≥ 6:1） */
  --alert-note-bg: #eff6fc;      --alert-note-fg: #005a9e;      --alert-note-line: #0078d4;
  --alert-tip-bg: #dff6dd;       --alert-tip-fg: #0b6a0b;       --alert-tip-line: #107c10;
  --alert-important-bg: #efe6f8; --alert-important-fg: #5c2e91; --alert-important-line: #8764b8;
  --alert-warning-bg: #fff4ce;   --alert-warning-fg: #6b5300;   --alert-warning-line: #c19c00;
  --alert-caution-bg: #fde7e9;   --alert-caution-fg: #a4262c;   --alert-caution-line: #d13438;
  --alert-icon-fg: #ffffff;

  /* highlight.js — VS Code Light+（稍降飽和度，避免在文件頁裡太吵） */
  --hl-keyword: #1f3fbf;
  --hl-control: #8f2fb0;
  --hl-string: #a3301f;
  --hl-comment: #227a22;
  --hl-number: #0c7b5a;
  --hl-type: #237a90;
  --hl-function: #7a5c16;
  --hl-attr: #b3261e;
  --hl-variable: #0a2a72;
  --hl-meta: #1a56a8;
  --hl-tag: #7a1f1f;
  --hl-regexp: #811f3f;
  --hl-addition-bg: #e6ffec;
  --hl-deletion-bg: #ffebe9;

  --selection: #cfe4fa;
  --focus-ring: #605e5c;
  color-scheme: light;
}

html[data-theme="dark"] {
  --bg-app: #201f1e;
  --bg-surface: #201f1e;
  --bg-sunken: #292827;
  --bg-hover: #323130;
  --bg-pressed: #3b3a39;
  --bg-code: #171615;            /* 比頁底深一階，不只靠邊框 */
  --bg-code-head: #262524;
  --bg-inline-code: #323130;
  --bg-kbd: #292827;
  --bg-table-head: #292827;
  --bg-table-stripe: #252423;
  --bg-table-hover: #323130;

  --fg: #f3f2f1;
  --fg-2: #e1dfdd;
  --fg-muted: #c8c6c4;
  --fg-faint: #a19f9d;
  --fg-disabled: #797775;

  --line: #3b3a39;
  --line-strong: #605e5c;
  --line-faint: #323130;

  --accent: #4ba0e8;
  --accent-hover: #6cb8f6;
  --accent-pressed: #2899f5;
  --accent-tint: #0f2a40;
  --accent-tint-2: #163a5a;
  --accent-fg: #000000;
  --success: #5db564;
  --success-fg: #000000;

  --shadow-2: 0 1.6px 3.6px rgba(0,0,0,.4), 0 .3px .9px rgba(0,0,0,.35);
  --shadow-8: 0 3.2px 7.2px rgba(0,0,0,.45), 0 .6px 1.8px rgba(0,0,0,.4);
  --shadow-16: 0 6.4px 14.4px rgba(0,0,0,.5), 0 1.2px 3.6px rgba(0,0,0,.45);

  /* 深色：透明底 + 同色系邊框，不用大面積實色 */
  --alert-note-bg: rgba(75,160,232,.11);      --alert-note-fg: #9ccbf3;      --alert-note-line: #4ba0e8;
  --alert-tip-bg: rgba(93,181,100,.11);       --alert-tip-fg: #92d59b;       --alert-tip-line: #5db564;
  --alert-important-bg: rgba(169,137,221,.12); --alert-important-fg: #c5aef0; --alert-important-line: #a989dd;
  --alert-warning-bg: rgba(214,180,58,.11);   --alert-warning-fg: #f0d36b;   --alert-warning-line: #d6b43a;
  --alert-caution-bg: rgba(224,100,105,.12);  --alert-caution-fg: #f4a0a4;   --alert-caution-line: #e06469;
  --alert-icon-fg: #201f1e;

  /* highlight.js — VS Code Dark+ */
  --hl-keyword: #569cd6;
  --hl-control: #c586c0;
  --hl-string: #ce9178;
  --hl-comment: #6a9955;
  --hl-number: #b5cea8;
  --hl-type: #4ec9b0;
  --hl-function: #dcdcaa;
  --hl-attr: #9cdcfe;
  --hl-variable: #9cdcfe;
  --hl-meta: #c586c0;
  --hl-tag: #569cd6;
  --hl-regexp: #d16969;
  --hl-addition-bg: #1b3a24;
  --hl-deletion-bg: #4a1f24;

  --selection: #264f78;
  --focus-ring: #f3f2f1;
  color-scheme: dark;
}

/* ---------- Base ---------- */
*, *::before, *::after { box-sizing: border-box; }

html, body { height: 100%; margin: 0; }

html {
  -webkit-text-size-adjust: 100%;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  background: var(--bg-app);
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.8;
  overflow: hidden;              /* 捲動交給 .md-main */
}

::selection { background: var(--selection); }

:focus { outline: none; }
:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
  border-radius: 2px;
}

/* ---------- App shell ---------- */
.md-app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* 頂欄：Fluent command bar */
.md-bar {
  position: sticky;
  top: 0;
  z-index: 30;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  height: var(--bar-h);
  padding: 0 12px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--line);
}

.md-bar-title {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0 8px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: .01em;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 檔名前的小型文件圖示（純 CSS） */
.md-bar-title::before {
  content: "";
  flex: 0 0 auto;
  width: 12px;
  height: 15px;
  border: 1.5px solid var(--accent);
  border-radius: 2px;
  background:
    linear-gradient(var(--accent), var(--accent)) 2px 4px / 5px 1.5px no-repeat,
    linear-gradient(var(--accent), var(--accent)) 2px 7px / 5px 1.5px no-repeat,
    linear-gradient(var(--accent), var(--accent)) 2px 10px / 3px 1.5px no-repeat;
}

.md-iconbtn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  margin: 0;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.md-iconbtn:hover { background: var(--bg-hover); color: var(--fg); }
.md-iconbtn:active { background: var(--bg-pressed); }
.md-iconbtn[aria-expanded="true"] { color: var(--accent); }
.md-iconbtn[hidden] { display: none; }
.md-iconbtn svg { display: block; }

/* 版面 */
.md-layout {
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
  position: relative;
}

/* ---------- 目錄側欄（Fluent Nav） ---------- */
.md-toc {
  flex: 0 0 var(--toc-w);
  width: var(--toc-w);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px 8px 32px 12px;
  background: var(--bg-app);
  border-right: 1px solid var(--line);
  font-size: 13px;
  line-height: 1.45;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}

.md-toc-title {
  padding: 4px 12px 10px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--fg-muted);
}

.md-toc-list,
.md-toc-list ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.md-toc-list ul { padding-left: 14px; }
.md-toc-list li { margin: 0; }

/* 長標題換行而非省略號（檔名式標題才看得完整） */
.md-toc-list a {
  position: relative;
  display: block;
  padding: 6px 10px 6px 12px;
  margin: 1px 0;
  border-radius: var(--radius);
  color: var(--fg-muted);
  text-decoration: none;
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.4;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.md-toc-list a:hover { background: var(--bg-hover); color: var(--fg); }
.md-toc-list > li > a { color: var(--fg-2); font-weight: 500; }

/* Fluent Nav 的選取指示條：3px 圓角、留上下 8px */
.md-toc-list a::before {
  content: "";
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 2px;
  background: var(--accent);
  transform: scaleY(0);
  transition: transform var(--dur) var(--ease);
}
.md-toc-list a.is-active {
  color: var(--fg);
  font-weight: 600;
  background: var(--bg-hover);
}
.md-toc-list a.is-active::before { transform: scaleY(1); }

/* 側欄狀態 */
html[data-toc="closed"] .md-toc,
html[data-toc="none"] .md-toc { display: none; }

/* ---------- 主區域（唯一捲動容器；position: relative 供 md-shell 以 offsetTop 計算目錄高亮） ---------- */
.md-main {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--bg-surface);
  scroll-padding-top: 24px;
  scrollbar-gutter: stable;
}

.md-content {
  max-width: var(--content-w);
  margin: 0 auto;
  padding: 40px 48px 96px;
  color: var(--fg);
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.md-content > :first-child { margin-top: 0 !important; }
.md-content > :last-child { margin-bottom: 0 !important; }

/* ---------- 文字 ---------- */
.md-content p {
  margin: 0 0 1.1em;
  text-align: start;
  letter-spacing: .005em;
}

.md-content strong, .md-content b { font-weight: 600; color: var(--fg); }
.md-content em, .md-content i { font-style: italic; }
.md-content del { color: var(--fg-muted); text-decoration-color: var(--fg-faint); }

.md-content a {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.md-content a:hover {
  color: var(--accent-hover);
  border-bottom-color: currentColor;
}
.md-content a:active { color: var(--accent-pressed); }

/* 分隔線：64px 置中短線 */
.md-content hr {
  width: 64px;
  height: 0;
  margin: 3em auto;
  border: 0;
  border-top: 1px solid var(--line-strong);
}

.md-content img {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius);
  box-shadow: var(--shadow-2);
  vertical-align: middle;
}
.md-content p > img:only-child { display: block; margin: 8px auto; }

/* ---------- 標題：每一級都有自己的視覺記號，不只靠字級 ----------
   h1 刊頭墨線｜h2 上方分隔線 + 左側主色粗條｜h3 文字下方一小段主色短線｜
   h4 前置實心主色方塊｜h5 前置空心方塊｜h6 小字大寫灰字 */
.md-content h1, .md-content h2, .md-content h3,
.md-content h4, .md-content h5, .md-content h6 {
  position: relative;
  margin: 0;
  color: var(--fg);
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: -.005em;
  scroll-margin-top: 24px;
  overflow-wrap: break-word;
}

/* h1：刊頭，下方一條墨線 */
.md-content h1 {
  font-size: 32px;
  font-weight: 600;
  letter-spacing: -.012em;
  line-height: 1.3;
  margin: 0 0 24px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--fg);
}

/* h2：章節，上方留白 + 強灰線 + 內距構成全頁垂直節奏；左側一條主色粗條，一眼就知道是章節標題 */
.md-content h2 {
  font-size: 23px;
  font-weight: 700;
  margin: 64px 0 18px;
  padding: 20px 0 0 16px;
  border-top: 1px solid var(--line-strong);
}
.md-content h2::before {
  content: "";
  position: absolute;
  left: 0;
  top: 20px;
  bottom: 0;
  width: 4px;
  border-radius: 2px;
  background: var(--accent);
}

/* h3：文字下方一小段主色短線 */
.md-content h3 {
  font-size: 19px;
  font-weight: 700;
  margin: 40px 0 14px;
  padding-bottom: 8px;
}
.md-content h3::after {
  content: "";
  position: absolute;
  left: 0;
  bottom: 0;
  width: 36px;
  height: 3px;
  border-radius: 2px;
  background: var(--accent);
}

/* h4：前置實心主色方塊；h5：前置空心方塊，比 h4 再輕一級 */
.md-content h4 { font-size: 17px; font-weight: 700; margin: 32px 0 10px; }
.md-content h5 { font-size: 16px; font-weight: 700; margin: 28px 0 8px; color: var(--fg-2); }
.md-content h4::before, .md-content h5::before {
  content: "";
  display: inline-block;
  width: 9px;
  height: 9px;
  margin: 0 10px 0 1px;
  vertical-align: 1px;
  border-radius: 2px;
  background: var(--accent);
}
.md-content h5::before {
  width: 7px;
  height: 7px;
  background: transparent;
  border: 2px solid var(--accent);
  vertical-align: 1px;
}
.md-content h6 {
  font-size: 13px;
  margin: 28px 0 8px;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--fg-muted);
}

/* 標題緊接標題時收緊 */
.md-content h1 + h2 { margin-top: 24px; padding-top: 0; border-top: 0; }
.md-content h1 + h2::before { top: 0; }
.md-content h2 + h3, .md-content h3 + h4,
.md-content h4 + h5, .md-content h5 + h6 { margin-top: 16px; }
/* 文件第一個元素若是 h2，不要上線 */
.md-content > h2:first-child { padding-top: 0; border-top: 0; }
.md-content > h2:first-child::before { top: 0; }

/* 段落錨點：浮在標題左側，hover 才顯示 */
.md-anchor {
  position: absolute;
  left: -1.5em;
  top: 0;
  width: 1.3em;
  text-align: center;
  color: var(--accent);
  font-weight: 400;
  text-decoration: none;
  border: 0 !important;
  opacity: 0;
  transition: opacity var(--dur) var(--ease);
}
.md-content h2 > .md-anchor { top: 20px; left: calc(-1.5em - 4px); }
.md-content h1 + h2 > .md-anchor, .md-content > h2:first-child > .md-anchor { top: 0; }
.md-content h1:hover .md-anchor, .md-content h2:hover .md-anchor,
.md-content h3:hover .md-anchor, .md-content h4:hover .md-anchor,
.md-content h5:hover .md-anchor, .md-content h6:hover .md-anchor,
.md-anchor:focus-visible { opacity: 1; }

/* ---------- 清單 ---------- */
.md-content ul, .md-content ol {
  margin: 0 0 1.1em;
  padding-left: 28px;
}
.md-content ul { list-style: disc; }
.md-content ul ul { list-style: circle; }
.md-content ul ul ul { list-style: square; }
.md-content ol ol { list-style: lower-alpha; }
.md-content li { margin: 4px 0; padding-left: 2px; }
.md-content li::marker { color: var(--fg-faint); }
.md-content ol > li::marker { color: var(--fg-muted); font-variant-numeric: tabular-nums; font-weight: 500; }
.md-content li > ul, .md-content li > ol { margin: 4px 0 0; }
.md-content li > p { margin-bottom: 8px; }

/* 待辦清單：Fluent Checkbox */
.md-content li.md-task {
  list-style: none;
  position: relative;
  padding-left: 0;
  margin-left: -22px;
}
.md-content li.md-task > input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  display: inline-block;
  vertical-align: -3px;
  width: 17px;
  height: 17px;
  margin: 0 8px 0 0;
  border: 1px solid var(--fg-muted);
  border-radius: 3px;
  background: var(--bg-surface);
  position: relative;
}
.md-content li.md-task > input[type="checkbox"]:checked {
  border-color: var(--accent);
  background: var(--accent);
}
.md-content li.md-task > input[type="checkbox"]:checked::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 1.5px;
  width: 5px;
  height: 9px;
  border: solid var(--accent-fg);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.md-content li.md-task > input[type="checkbox"]:checked ~ * { color: var(--fg-muted); }

/* 定義清單（部分渲染器支援） */
.md-content dl { margin: 0 0 1.1em; }
.md-content dt { font-weight: 600; margin-top: 12px; }
.md-content dd { margin: 4px 0 0 24px; color: var(--fg-2); }

/* ---------- 行內程式碼 / 按鍵 ---------- */
.md-content code, .md-content kbd, .md-content pre, .md-content samp {
  font-family: var(--font-mono);
  font-feature-settings: "calt" 0;
}

.md-content :not(pre) > code {
  font-size: .875em;
  padding: .12em .4em;
  border-radius: 3px;
  background: var(--bg-inline-code);
  color: var(--fg-2);
  border: 1px solid var(--line-faint);
  white-space: nowrap;
  word-break: normal;
}
.md-content a > code { color: inherit; }

.md-content kbd {
  display: inline-block;
  font-size: .8em;
  line-height: 1.2;
  padding: 2px 6px 1px;
  min-width: 1.8em;
  text-align: center;
  color: var(--fg-2);
  background: var(--bg-kbd);
  border: 1px solid var(--line-strong);
  border-bottom-width: 2px;
  border-radius: 3px;
  vertical-align: 1px;
}

/* ---------- 引用 ---------- */
.md-content blockquote {
  margin: 0 0 20px;
  padding: 10px 20px;
  border-left: 3px solid var(--accent);
  background: var(--bg-sunken);
  border-radius: 0 var(--radius) var(--radius) 0;
  color: var(--fg-2);
}
.md-content blockquote > :last-child { margin-bottom: 0; }
.md-content blockquote > p { margin-bottom: 10px; }
.md-content blockquote blockquote { margin-top: 10px; }

/* ---------- 提示區塊（MessageBar） ---------- */
.md-alert {
  --a-bg: var(--alert-note-bg);
  --a-fg: var(--alert-note-fg);
  --a-line: var(--alert-note-line);
  position: relative;
  margin: 0 0 20px;
  padding: 14px 20px 14px 48px;
  border-radius: var(--radius);
  background: var(--a-bg);
  border: 1px solid color-mix(in srgb, var(--a-line) 30%, transparent);
  border-left: 3px solid var(--a-line);
  color: var(--fg);
}
.md-alert > :last-child { margin-bottom: 0; }
.md-alert > p { margin-bottom: 8px; }
.md-alert :not(pre) > code { background: color-mix(in srgb, var(--fg) 8%, transparent); border-color: transparent; }

.md-alert-title {
  margin: 0 0 4px !important;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: .01em;
  color: var(--a-fg);
}

/* 圖示：純 CSS 繪製 —— note 圓 i、tip 圓 ✓、important 圓 !、warning 填滿方塊 !、caution 填滿圓 × */
.md-alert::before {
  content: "";
  position: absolute;
  left: 18px;
  top: 17px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.75px solid var(--a-fg);
}
.md-alert::after {
  content: "i";
  position: absolute;
  left: 18px;
  top: 17px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font: italic 700 11px/1 Georgia, "Times New Roman", serif;
  color: var(--a-fg);
}

.md-alert-tip { --a-bg: var(--alert-tip-bg); --a-fg: var(--alert-tip-fg); --a-line: var(--alert-tip-line); }
.md-alert-tip::after { content: "✓"; font: 700 12px/1 var(--font-sans); }

.md-alert-important { --a-bg: var(--alert-important-bg); --a-fg: var(--alert-important-fg); --a-line: var(--alert-important-line); }
.md-alert-important::after { content: "!"; font: 700 12px/1 var(--font-sans); }

.md-alert-warning { --a-bg: var(--alert-warning-bg); --a-fg: var(--alert-warning-fg); --a-line: var(--alert-warning-line); }
.md-alert-warning::before { border-radius: 4px; background: var(--a-line); border-color: var(--a-line); }
.md-alert-warning::after { content: "!"; color: var(--alert-icon-fg); font: 800 12px/1 var(--font-sans); }

.md-alert-caution { --a-bg: var(--alert-caution-bg); --a-fg: var(--alert-caution-fg); --a-line: var(--alert-caution-line); }
.md-alert-caution::before { background: var(--a-line); border-color: var(--a-line); }
.md-alert-caution::after { content: "×"; color: var(--alert-icon-fg); font: 700 15px/1 var(--font-sans); margin-top: -1px; }

/* ---------- 表格（DetailsList） ---------- */
/* .md-table-wrap 不是捲動容器（overflow: clip），表頭才能對 .md-main sticky；
   一般表格超出文章欄寬時由 .md-main 水平捲動。 */
.md-table-wrap {
  margin: 0 0 24px;
  width: fit-content;
  min-width: 100%;
  overflow: clip;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  box-shadow: var(--shadow-2);
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}
/* 寬表格（7 欄以上，或 md-shell 加上 .is-wide）：在卡片內自己水平捲動、放棄 sticky 表頭，
   儲存格以 max-content 排版並以 26em 為上限，避免欄位被擠成一字一行 */
.md-table-wrap.is-wide,
.md-table-wrap:has(th:nth-child(7)) {
  width: auto;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}
.md-table-wrap.is-wide thead th,
.md-table-wrap:has(th:nth-child(7)) thead th { position: static; }
.md-table-wrap.is-wide table,
.md-table-wrap:has(th:nth-child(7)) table { width: max-content; min-width: 100%; }
.md-table-wrap.is-wide tbody td,
.md-table-wrap:has(th:nth-child(7)) tbody td { max-width: 26em; }

.md-content table {
  width: 100%;
  max-width: none;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 14px;
  line-height: 1.6;
}

.md-content thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg-table-head);
  color: var(--fg-2);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: .01em;
  font-variant-numeric: tabular-nums;
  text-align: start;
  white-space: nowrap;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line-strong);
  box-shadow: 0 1px 0 var(--line-strong);
}
.md-content th:first-child, .md-content td:first-child { padding-left: 18px; }
.md-content th:last-child, .md-content td:last-child { padding-right: 18px; }

.md-content tbody td {
  padding: 10px 14px;
  vertical-align: top;
  border-bottom: 1px solid var(--line);
  color: var(--fg);
  min-width: 6em;
}
.md-content tbody tr:last-child td { border-bottom: 0; }
.md-content tbody tr:nth-child(even) td { background: var(--bg-table-stripe); }
.md-content tbody tr:hover td { background: var(--bg-table-hover); }

.md-content th[align="center"], .md-content td[align="center"] { text-align: center; }
.md-content th[align="right"], .md-content td[align="right"] { text-align: right; }

.md-content td > :last-child { margin-bottom: 0; }
.md-content td code, .md-content th code { white-space: nowrap; font-size: .85em; }
.md-content td strong { color: var(--fg); }

/* 第一欄常是 # / ID / commit / 名稱：不折行、等寬數字、收窄到內容寬 */
.md-content tbody td:first-child {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  min-width: 0;
  width: 1%;
}

/* ---------- 程式碼區塊（卡片） ---------- */
.md-code {
  margin: 0 0 24px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--bg-code);
  overflow: hidden;
  box-shadow: var(--shadow-2);
}

.md-code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 36px;
  padding: 0 8px 0 14px;
  background: var(--bg-code-head);
  border-bottom: 1px solid var(--line);
}

.md-code-lang {
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--fg-muted);
}
.md-code-lang:empty::before { content: "text"; color: var(--fg-faint); }

/* Fluent DefaultButton，縮小尺寸 */
.md-copy {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  margin: 0;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-2);
  background: var(--bg-surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  cursor: pointer;
  transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease), color var(--dur) var(--ease);
}
.md-copy::before {
  content: "";
  width: 11px;
  height: 11px;
  border: 1.5px solid currentColor;
  border-radius: 2px;
  box-shadow: -3px -3px 0 -1.5px var(--bg-surface), -3px -3px 0 0 currentColor;
  margin-left: 3px;
  margin-top: 2px;
  opacity: .8;
}
.md-copy:hover { background: var(--bg-hover); color: var(--fg); border-color: var(--fg-faint); }
.md-copy:active { background: var(--bg-pressed); }
.md-copy:focus-visible { outline-offset: 2px; }
.md-copy.is-done {
  color: var(--success-fg);
  background: var(--success);
  border-color: var(--success);
}
.md-copy.is-done::before {
  width: 5px; height: 9px;
  border-width: 0 2px 2px 0;
  border-radius: 0;
  box-shadow: none;
  transform: rotate(45deg);
  margin: -2px 5px 0 3px;
  opacity: 1;
}

.md-code pre {
  margin: 0;
  padding: 16px 18px;
  overflow: auto;
  font-size: 13.5px;
  line-height: 1.65;
  tab-size: 4;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}
.md-code pre code {
  display: block;
  padding: 0;
  background: transparent;
  border: 0;
  color: var(--fg);
  font-size: inherit;
  white-space: pre;
}

/* highlight.js 對映 */
.hljs { color: var(--fg); background: transparent; }
.hljs-comment, .hljs-quote { color: var(--hl-comment); font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-doctag { color: var(--hl-keyword); }
.hljs-built_in, .hljs-type, .hljs-class .hljs-title, .hljs-title.class_ { color: var(--hl-type); }
.hljs-literal, .hljs-number, .hljs-symbol, .hljs-bullet { color: var(--hl-number); }
.hljs-string, .hljs-template-tag, .hljs-addition .hljs-string { color: var(--hl-string); }
.hljs-regexp, .hljs-link { color: var(--hl-regexp); }
.hljs-title, .hljs-title.function_, .hljs-function .hljs-title, .hljs-section { color: var(--hl-function); }
.hljs-attr, .hljs-attribute, .hljs-selector-attr, .hljs-selector-class, .hljs-selector-id, .hljs-property { color: var(--hl-attr); }
.hljs-variable, .hljs-template-variable, .hljs-params, .hljs-name { color: var(--hl-variable); }
.hljs-meta, .hljs-meta .hljs-keyword { color: var(--hl-meta); }
.hljs-meta .hljs-string { color: var(--hl-string); }
.hljs-tag { color: var(--hl-tag); }
.hljs-tag .hljs-name { color: var(--hl-tag); }
.hljs-tag .hljs-attr { color: var(--hl-attr); }
.hljs-subst { color: var(--fg); }
.hljs-strong { font-weight: 600; }
.hljs-emphasis { font-style: italic; }
.hljs-addition { background: var(--hl-addition-bg); display: inline-block; width: 100%; }
.hljs-deletion { background: var(--hl-deletion-bg); display: inline-block; width: 100%; }
.hljs-operator, .hljs-punctuation { color: var(--fg-2); }
.hljs-selector-pseudo { color: var(--hl-control); }

/* 殼層：命令提示 */
.language-bash .hljs-built_in, .language-shell .hljs-built_in { color: var(--hl-function); }

/* ---------- Mermaid ---------- */
.md-mermaid {
  margin: 0 0 24px;
  padding: 20px;
  text-align: center;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  overflow-x: auto;
}
.md-mermaid svg { max-width: 100%; height: auto; display: inline-block; }
html[data-theme="dark"] .md-mermaid { background: var(--bg-sunken); }
.md-mermaid { position: relative; }
.md-mermaid.is-zoomed { text-align: start; }   /* 放大後靠左，水平捲動才能看到左緣 */

/* 圖表縮放工具列：hover 或放大後才顯示。外層高度 0 並 sticky，放大後水平捲動時仍停在可見區右上角 */
.md-mz-tools {
  position: sticky;
  left: 0;
  z-index: 1;
  display: flex;
  justify-content: flex-end;
  height: 0;
  margin: -12px -12px 0 0;
  overflow: visible;
  pointer-events: none;
}
.md-mz-bar {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: var(--bg-surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-2);
  opacity: 0;
  transition: opacity .15s ease;
}
.md-mermaid:hover .md-mz-bar,
.md-mz-bar:focus-within,
.md-mermaid.is-zoomed .md-mz-bar { opacity: 1; }
@media (hover: none) { .md-mz-bar { opacity: 1; } }
.md-mz-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  min-width: 26px;
  padding: 0 6px;
  margin: 0;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--fg-2);
  font: 600 12px/1 var(--font-sans);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.md-mz-btn:hover { background: var(--bg-hover); color: var(--fg); }
.md-mz-btn:active { background: var(--bg-pressed); }
.md-mz-pct { min-width: 46px; }
.md-mz-sep { width: 1px; height: 16px; margin: 0 3px; background: var(--line-strong); }

/* 全螢幕檢視（lightbox）：覆蓋整個預覽區；能用 Fullscreen API 時會進入真正的全螢幕 */
.md-lightbox {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
  color: var(--fg);
  outline: none;
}
.md-lightbox-tools { position: absolute; top: 12px; right: 12px; z-index: 2; opacity: 1; box-shadow: var(--shadow-8); }
.md-lightbox-stage {
  flex: 1;
  position: relative;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  user-select: none;
  background:
    linear-gradient(var(--line-faint) 1px, transparent 1px) 0 0 / 24px 24px,
    linear-gradient(90deg, var(--line-faint) 1px, transparent 1px) 0 0 / 24px 24px,
    var(--bg-surface);
}
html[data-theme="dark"] .md-lightbox-stage { background-color: var(--bg-sunken); }
.md-lightbox-stage.is-dragging { cursor: grabbing; }
.md-lightbox-canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.md-lightbox-canvas svg { display: block; }
.md-lightbox-hint {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  padding: 5px 12px;
  font-size: 12px;
  color: var(--fg-muted);
  background: var(--bg-surface);
  border: 1px solid var(--line);
  border-radius: 999px;
  box-shadow: var(--shadow-2);
  pointer-events: none;
  white-space: nowrap;
}
html[data-lightbox="open"] .md-main { overflow: hidden; }
.md-lightbox:fullscreen { background: var(--bg-app); }

/* mermaid 主題會在 svg 內寫死邊標籤底色，改用面板色以免在深色模式出現灰塊（lightbox 內的複本也一樣） */
.md-mermaid .edgeLabel, .md-lightbox .edgeLabel,
.md-mermaid .edgeLabel p, .md-lightbox .edgeLabel p,
.md-mermaid .edgeLabel .labelBkg, .md-lightbox .edgeLabel .labelBkg { background-color: var(--bg-surface) !important; }
.md-mermaid .edgeLabel rect, .md-lightbox .edgeLabel rect { fill: var(--bg-surface) !important; opacity: 1 !important; }
html[data-theme="dark"] .md-mermaid .edgeLabel, html[data-theme="dark"] .md-lightbox .edgeLabel,
html[data-theme="dark"] .md-mermaid .edgeLabel p, html[data-theme="dark"] .md-lightbox .edgeLabel p,
html[data-theme="dark"] .md-mermaid .edgeLabel .labelBkg, html[data-theme="dark"] .md-lightbox .edgeLabel .labelBkg { background-color: var(--bg-sunken) !important; }
html[data-theme="dark"] .md-mermaid .edgeLabel rect, html[data-theme="dark"] .md-lightbox .edgeLabel rect { fill: var(--bg-sunken) !important; }

.md-mermaid pre.mermaid {
  margin: 0;
  text-align: start;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  color: var(--fg-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.md-mermaid.is-failed {
  border-color: var(--alert-caution-line);
  background: var(--alert-caution-bg);
  padding-top: 44px;
  position: relative;
}
.md-mermaid.is-failed::before {
  content: "Mermaid 圖表無法渲染：" attr(data-error);
  position: absolute;
  left: 0; right: 0; top: 0;
  padding: 8px 20px;
  font-size: 12.5px;
  font-weight: 600;
  text-align: start;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--alert-caution-fg);
  border-bottom: 1px solid color-mix(in srgb, var(--alert-caution-line) 40%, transparent);
}

/* ---------- 文內目錄 [[_TOC_]] ---------- */
.md-toc-inline,
.md-toc-inline ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.md-toc-inline {
  margin: 0 0 28px;
  padding: 16px 20px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-lg);
  background: var(--bg-sunken);
  font-size: 14px;
  line-height: 1.6;
  columns: 2;
  column-gap: 32px;
}
.md-toc-inline > li { break-inside: avoid; }
.md-toc-inline ul { padding-left: 18px; }
.md-toc-inline li { margin: 3px 0; }
.md-toc-inline a { color: var(--fg-2); border: 0; }
.md-toc-inline a:hover { color: var(--accent); }
.md-toc-inline > li > a { font-weight: 600; color: var(--fg); }
.md-toc-inline > li > a:hover { color: var(--accent); }

/* ---------- Front matter ---------- */
.md-frontmatter {
  margin: 0 0 24px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--bg-sunken);
  font-size: 13.5px;
}
.md-frontmatter > summary {
  cursor: pointer;
  padding: 10px 16px;
  font-weight: 600;
  color: var(--fg-muted);
  list-style: none;
  display: flex;
  align-items: center;
  gap: 10px;
  user-select: none;
}
.md-frontmatter > summary::-webkit-details-marker { display: none; }
.md-frontmatter > summary::before {
  content: "";
  width: 6px; height: 6px;
  border: solid var(--fg-faint);
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(-45deg);
  transition: transform var(--dur) var(--ease);
  margin-left: 2px;
}
.md-frontmatter[open] > summary::before { transform: rotate(45deg); }
.md-frontmatter[open] > summary { border-bottom: 1px solid var(--line); }
.md-frontmatter > table {
  width: 100%;
  min-width: 0;
  margin: 0;
  border-collapse: collapse;
}
.md-frontmatter td, .md-frontmatter th {
  padding: 7px 16px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
  font-size: 13px;
  white-space: normal;
}
.md-frontmatter tr:last-child td { border-bottom: 0; }
.md-frontmatter td:first-child, .md-frontmatter th:first-child {
  width: 1%;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-muted);
  padding-right: 24px;
}

/* ---------- 中等版面（800–1099px，典型的 ADO 內嵌 iframe）：側欄變窄但仍常駐 ---------- */
@media (max-width: 1099px) {
  :root { --toc-w: 232px; }
  .md-content { padding: 32px 32px 80px; }
  .md-toc { padding-left: 8px; font-size: 12.5px; }
  .md-toc-list ul { padding-left: 10px; }
  .md-content h2 { margin-top: 56px; }
}

/* ---------- 窄版面：側欄浮出 ---------- */
@media (max-width: 799px) {
  .md-toc {
    position: absolute;
    left: 0; top: 0; bottom: 0;
    z-index: 20;
    width: min(var(--toc-w), 85vw);
    background: var(--bg-surface);
    box-shadow: var(--shadow-16);
    border-right: 1px solid var(--line);
  }
}

@media (max-width: 640px) {
  body { font-size: 15px; line-height: 1.75; }
  .md-content { padding: 24px 16px 64px; }
  .md-content h1 { font-size: 26px; }
  .md-content h2 { font-size: 21px; margin-top: 40px; padding-top: 16px; }
  .md-content h2::before { top: 16px; }
  .md-content h3 { font-size: 18px; }
  .md-anchor { display: none; }
  .md-toc-inline { columns: 1; }
  .md-content ul, .md-content ol { padding-left: 22px; }
  .md-alert { padding-left: 44px; }
  .md-alert::before, .md-alert::after { left: 15px; }
}

/* ---------- 動態效果偏好 ---------- */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
  .md-main { scroll-behavior: auto; }
}

/* ---------- 列印 ---------- */
@media print {
  body { overflow: visible; background: #fff; color: #000; }
  .md-app { height: auto; }
  .md-bar, .md-toc { display: none !important; }
  .md-main { overflow: visible; }
  .md-content { max-width: none; padding: 0; }
  .md-table-wrap { box-shadow: none; }
  .md-content thead th { position: static; }
  .md-code { box-shadow: none; break-inside: avoid; }
  .md-copy { display: none; }
  .md-anchor { display: none; }
  .md-mz-tools, .md-lightbox { display: none; }
}
`;
  root.AdoMarkdownTheme = { css };
})(typeof globalThis !== 'undefined' ? globalThis : window);
