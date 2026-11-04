# AGENTS.md

本專案是 Chrome 擴充功能「Azure DevOps HTML Preview」（Manifest V3），
在 Azure DevOps Repos 的檔案頁籤列加上兩顆按鈕：
HTML 檔是「完整預覽 (內嵌)」與「完整預覽 (全螢幕)」，讓 HTML 能在啟用 JavaScript 的隔離 sandbox 中預覽；
Markdown 檔（.md / .markdown）是「Markdown 預覽 (內嵌)」與「Markdown 預覽 (全螢幕)」，
以自家的排版主題（深淺色、側邊目錄、程式碼上色、mermaid）取代 Azure DevOps 內建的 Markdown 預覽；
PDF 檔（.pdf）是「PDF 預覽 (內嵌)」與「PDF 預覽 (全螢幕)」，
以 Git Items API（`$format=octetStream`）取回原始位元組，交給 Chrome 內建的 PDF 檢視器顯示（不用 PDF.js）；
Excel 檔（.xlsx）是「Excel 預覽 (內嵌)」與「Excel 預覽 (全螢幕)」，
以 SheetJS 解析、`xlsx-core.js`（AdoXlsx）產出主題化的唯讀表格文件（多工作表頁籤、樣式、合併儲存格、凍結窗格）；
Word 檔（.docx）是「Word 預覽 (內嵌)」與「Word 預覽 (全螢幕)」，
以 `docx-core.js`（AdoDocx）產出「自帶渲染器」的高保真預覽文件（docx-preview 在 sandbox 文件內執行）。

## 版本號規則

- 版本號定義在 `manifest.json` 的 `version` 欄位，格式為 `major.minor.patch`。
- **每次修改任何程式或資源檔（content.js、background.js、preview.*、sandbox.html、manifest.json 等）後，都必須把 patch 版號加 1**，例如 `0.1.0` → `0.1.1`。
- 不要自行更動 major / minor，除非使用者明確要求。
- 只改 AGENTS.md、README、docs/ 等純文件時不需要加版號。
- **每次加版號都要同時新增 `release-notes/v<version>.md`**，詳細寫出這一版的新功能、修正、行為變更與已知限制（給使用者看，不是 commit 清單）。缺這個檔案時 workflow 會失敗、不會發布。
- **版本號一推到 main 就會觸發自動發布**（workflow 以 `v<version>` tag 是否存在判斷）：先建立 GitHub Release，再視 Repository variable `CWS_AUTO_PUBLISH` 是否為 `true` 上傳 Chrome Web Store。還沒準備好發布的程式請留在分支或 PR，不要直接推 main。
- manifest 的 `description` 必須維持 132 字元以內（Chrome Web Store 限制）。
- Tampermonkey 版本不在本 repo，位於 `~/projects/TampermonkeyUserscripts/src/AzureDevOpsHtmlPreview.user.js`；
  修改 `content.js` 的按鈕或內嵌邏輯時要同步更新它，並把它的 `@version` patch 版號加 1。
  改到 `md-core.js` / `md-shell.js` / `md-theme.js` 或 `vendor/` 時，執行 `node scripts/build-userscript.mjs`
  把它們重新內嵌到 userscript 的標記區段（不用 @require：dev.azure.com 有 AMD 的 `define`，UMD 函式庫會掛不到 window）。

## 檔案說明

| 檔案 | 用途 |
| --- | --- |
| `manifest.json` | 擴充功能設定：權限、background、sandbox 頁面與其 CSP |
| `content.js` | 注入 dev.azure.com：在 `.bolt-tabbar` 右側加按鈕；內嵌模式用 sandbox iframe 取代預覽區塊；全螢幕模式把 HTML 送給 background。`.md` 檔會先經 `md-core.js` + `md-shell.js` 轉成預覽文件再走同樣的路徑；`.pdf` 檔以 octetStream 抓原始位元組、包成 `blob: application/pdf` 交給 Chrome 內建 PDF 檢視器；`.xlsx` 檔以 octetStream 抓原始位元組、交給 `xlsx-core.js` 產出唯讀表格文件；支援自動預覽與預覽內的「就地換頁」 |
| `md-core.js` | Markdown → 文章 HTML（marked + highlight.js + DOMPurify）：標題錨點、目錄、`[[_TOC_]]`、`::: mermaid`、GitHub 風格 `> [!NOTE]` 提示、YAML front matter、表格 / 程式碼 / 工作清單的額外 class |
| `md-shell.js` | 把文章包成完整預覽文件：頂欄、側邊目錄、文章本體，以及在 iframe 內執行的 bootstrap（深淺色切換、目錄高亮、複製程式碼、mermaid 載入與重畫） |
| `xlsx-core.js` | xlsx（Excel 工作簿）→ 主題化的唯讀預覽文件（SheetJS 解析、樣式還原、多工作表頁籤、合併儲存格、欄寬列高、凍結窗格）；輸出完整 HTML 文件，內嵌（sandbox iframe）與全螢幕（sandbox 頁）共用 |
| `docx-core.js` | docx（Word 文件）→「自帶渲染器」的高保真唯讀預覽文件（內容 base64 內嵌、docx-preview / JSZip 只在 sandbox 文件內執行、紙張語意）；內嵌與全螢幕共用 |
| `docx-runtime.js` | 產生檔（`node scripts/build-docx-runtime.mjs`，請勿手改）：docx-preview / JSZip 的原始碼字串（AdoDocxLibs），只被寫進預覽文件內執行 |
| `md-theme.js` | 預覽主題 CSS（`AdoMarkdownTheme.css`），用 CSS 變數定義 light / dark 兩套 token |
| `vendor/` | 第三方函式庫（marked、DOMPurify、highlight.js common build、SheetJS Community、mermaid、docx-preview 與 JSZip）；前四者以 content script 載入，mermaid 列在 `web_accessible_resources`、只在文件含圖時才載入；docx-preview / JSZip **不載入到頁面**——以原始碼字串打包進 `docx-runtime.js`、只在 sandbox 預覽文件內執行 |
| `background.js` | Service worker：把 HTML 暫存到 `chrome.storage.session`，再用 `chrome.windows.create` 開新視窗 |
| `preview.html` / `preview.js` | 新視窗的外層頁面（一般 extension CSP），負責取出 HTML 並交給內層 sandbox；也負責就地換頁的頁次堆疊（`pages[k]`）與訊息中繼 |
| `sandbox.html` | 列在 manifest `sandbox` 清單的頁面（origin 為 null），收到 `render` 訊息後整頁 `document.write`；就地換頁時外層把 iframe 導來 `sandbox.html?nav=N`，這一頁以 `ready(nav)` 取回該頁內容 |
| `_locales/` | i18n 訊息（en 為 default_locale、zh_TW），manifest 的 name / description 以 `__MSG_appName__` / `__MSG_appDesc__` 引用 |
| `icons/` | 擴充功能圖示（16/32/48/128 與 1024 母檔），由 AI 生成；userscript 的圖示是同一張，放在 TampermonkeyUserscripts 的 `images/AzureDevOpsHtmlPreview.png` |
| `store-assets/` | Chrome Web Store 宣傳圖（440×280、1400×560）與截圖 |
| `docs/` | `PUBLISHING.md` 上架步驟、`STORE_LISTING.md` 商店文案、`PRIVACY_POLICY.md` 隱私權政策 |
| `scripts/package.sh` | 打包上架用 zip，本機與 CI 共用 |
| `release-notes/` | 每個版本一個 `v<version>.md`，作為 GitHub Release 的內文 |
| `.github/workflows/publish.yml` | 推到 main 且版本號是新的（無 `v<version>` tag）就建立 GitHub Release；`CWS_AUTO_PUBLISH=true` 時再上傳 Chrome Web Store 並送審 |

## 開發注意事項

- **視覺驗證（改到版面、樣式、顏色、主題時必做；寫「視覺 QA 通過」前的硬性要求）**：
  1. **自動檢查先過**：`make test`（scripts/test-xlsx-core.mjs）內含「紙張語意不變性」（`<td>` 樣式在深／淺建置必須完全一致）、
     每格顯式前景／背景（含預設值）、WCAG AA 4.5:1 對比。改 `xlsx-core.js` 或任何主題 CSS 後必跑。
  2. **真實內容實測**：拿真實檔案算全表對比（含預設值），並在瀏覽器用 `getComputedStyle` 抽查前景／背景的實際值。
     對比要量在**文字 run 層**（有文字的最內層元素）而不是容器層——容器常是未上色的預設值，量到它會誤判
     （docx 實測教訓：量到 TD 容器誤報 4.03:1，run 層才是檔案指定的白字）；判定依 WCAG：一般 4.5:1、
     大字／粗體 3:1。**來源檔案本身的低對比如實還原、回報註明**，不得擅自「修正」（違反紙張語意）；
     存疑時解剖來源檔 XML（如 word/document.xml 的 w:color / w:shd）當 ground truth 對照。
  3. **深色與淺色都要親眼看到成品**：兩個主題各留一份證據（截圖或放大裁切圖）；只看過單一主題不算通過。
     實測教訓（v0.2.10）：只看淺色截圖就宣告「視覺 QA 通過」，漏掉深色模式「未指定字色吃主題白字 × 檔案淺色底」不可讀。
  4. **工具失效要明說**：截圖工具回傳快取／重複影像時不得拿它當證據（同一次連拍兩張相同 md5 即為警訊），改用
     computed style ＋檔案層級證據，並在回報中註明視覺證據的缺口；沒親眼確認的東西不可以寫「通過」。
  5. xlsx 唯讀表格是**紙張語意**：未指定字色 = 檔案 dk1、未指定底色 = 檔案 lt1，配色跟著「檔案」、不隨 App 主題改變
     （Excel 裡是什麼顏色就顯示什麼顏色）。這是刻意設計，不要「修正」成跟隨主題。

- 安全設計：內嵌 iframe 與 sandbox 頁都**不得**加 `allow-same-origin`，網頁腳本不能接觸 Azure DevOps 的 cookie / session。
  唯一例外是 PDF 預覽的 iframe（完全不加 `sandbox` 屬性），理由見下方的 PDF 段落，不要把它「修正」成 sandboxed。
- 內嵌 iframe 的 srcdoc 會繼承 dev.azure.com 的 CSP，所以每個 `<script>` 都要補上頁面的 nonce。
- 內嵌 iframe 高度是「填滿頁籤列以下的視窗」，不要改成依內容高度撐開：使用 vh 單位的網頁會形成無限增長迴圈。
- 內嵌模式**不能**用 `replaceWith` 拿掉 ADO 的預覽節點（React 管理）：切換檔案時 React 更新不到節點，整個區塊會報
  「An unexpected error has occurred within this region of the page」。只能隱藏原節點、把 iframe 插在旁邊，
  並由 `reconcileInlinePreview()` 在換檔案 / ADO 重建節點時移除 iframe、恢復原節點。
- macOS 上 `chrome.windows.create` 的 `type:'popup'` 搭配 `state:'maximized'` 會產生 1×33px 的視窗，務必用明確的 left/top/width/height。
- 網址有兩種：`/{org}/{project}/_git/{repo}` 與省略專案段的 `/{org}/_git/{repo}`（專案名 = repo 名），`parseLocation()` 兩種都要支援，後者以 repo 名當專案名呼叫 API。
- 預覽前會把 HTML 內相對路徑的 `<script src>`、`<link rel=stylesheet>`、`<img src>` 透過 Git Items API 抓回來內嵌（`inlineRelativeAssets`）；執行期 fetch 的資源與 CSS 內的 `url()` 不處理。抓資源必須用 `$format=octetStream`，`text` 會把二進位檔轉碼損毀。
- 執行期才出現的 `<img>`（JS 用 innerHTML / `.src` 產生，靜態掃描看不到）由 `lazyImageScript` 注入預覽文件按需載入：
  iframe 內用 MutationObserver + IntersectionObserver 發現相對路徑圖片、進入視窗附近才送 `ado-asset-request`，
  父頁面用 `fetchImageDataUrl` 抓回 data: URL 以 `ado-asset-response` 回傳。內嵌模式的回應端是 content script；
  全螢幕模式的父頁面 `preview.js` 沒有 ADO cookie，經 background 的 `fetch-asset` 轉給原本的 ADO 分頁（`open-preview` 時存下 `tabId` 與 `info`）。
  請求來自不受信任的網頁腳本，所以只服務圖片副檔名（`IMAGE_EXT`），不要放寬成任意檔案。
  作者有 `<base href>` 時不注入。Tampermonkey 版也有同樣機制（全螢幕 popup 由主頁面監聽 popup 的 message）。
- 內嵌模式與 userscript 的 srcdoc 會繼承 Azure DevOps 的 CSP（沒有 `unsafe-eval`），需要 eval / new Function 的函式庫（如 PDF.js）只能用擴充功能的「全螢幕」模式（extension sandbox 頁的 CSP 允許 unsafe-eval）。
- PDF（.pdf）預覽刻意**不用 PDF.js**（需要 eval）：主檔以 `$format=octetStream` 取回原始位元組（`text` 會轉碼損毀），
  包成 `application/pdf` 的 `blob:` URL 交給 Chrome 內建的 PDF 檢視器（`fetchPdfBlob` / `pdfBlobUrl`）。
  內嵌預覽掛**自製的「Preview」頁籤**（`renderPdfInline` / `ensurePdfPreviewTab` / `syncPdfView`）：
  ADO 的 PDF 檔案頁沒有 Preview 頁籤（只有 Contents / History / Compare / Blame），預覽寄生在 Contents 下
  會讓其他頁籤切不動；`.bolt-tabbar` 與 `.page-content` 節點由 React 保留（內容依頁籤替換，實測確認），
  所以切頁籤只是顯示 / 隱藏切換，預覽不收掉，再點回「Preview」就回來。
  PDF 的 iframe **不加 `sandbox`**：實測 sandbox（無 `allow-same-origin`）時內建檢視器載不起來（blob URL 與直接 URL 皆然）。
  這不是安全漏洞——PDF 由 PDFium 算繪、不執行 PDF 內嵌的 JavaScript、也不是 HTML，不會被當成可執行腳本的文件。
  全螢幕模式在使用者手勢的同步階段先開 popup（否則被快顯攔截），抓完檔直接導去 blob URL；
  不走 `chrome.storage.session`（10 MB 配額放不下大 PDF）。Tampermonkey 版要同步。
- xlsx（.xlsx）預覽用 SheetJS Community（`vendor/xlsx.full.min.js`，Apache-2.0）解析、`xlsx-core.js` 渲染。
  **樣式還原的關鍵**：SheetJS 只把填色放進 `cell.s`；字型／對齊在 `wb.Styles`（Fonts / CellXf）卻不帶每格的樣式索引——
  `rawSheetExtras` 會直接掃 xlsx（ZIP）內的 sheet XML 抓每格 `s="N"` 還原完整樣式，凍結窗格
  （`<pane topLeftCell>`）也取自同一條掃描（SheetJS 0.20.3 不暴露 pane）。
  注意 `XLSX.CFB.read` 各環境吃的型別不一致（node 要 Buffer / Uint8Array、瀏覽器給 ArrayBuffer），
  已用 `readCfb` 多組合嘗試，不要簡化掉；theme 色的索引順序是 lt1, dk1, lt2, dk2, accent1–6…（lt/dk 交錯）。
  單一工作表有 60,000 格預算與 5,000 列上限（截斷並提示）。`build-userscript.mjs` 會把 SheetJS 與
  xlsx-core.js 一起內嵌進 userscript 的標記區段。Tampermonkey 版要同步。
- docx（.docx）預覽刻意採「**自帶渲染器**」設計：docx-preview（Apache-2.0）＋JSZip（MIT）以原始碼字串打包在
  `docx-runtime.js`（`node scripts/build-docx-runtime.mjs` 產生，改 vendor 版本後要重跑），只寫進 sandbox
  預覽文件內執行——父網頁與 userscript 都不載入這兩個函式庫（渲染不可信 docx 的程式與 ADO 頁面完全隔離）。
  文件內容以 base64 內嵌、載入即 `docx.renderAsync` 渲染（**`useBase64URL: true` 必須保留**：圖片轉 data URL，
  否則序列化後的 blob 連結會失效）。配色採紙張語意（內容跟著檔案、頂欄外殼才跟主題）。
  `<script>` 內容一律過 `scriptSafe`（跳脫 `</script`）。`make test` 的 scripts/test-docx-core.mjs 驗證組裝
  （payload 逐位元回還原、跳脫、雙主題僅外殼不同）；渲染層依「視覺驗證」規範實測。
  `build-userscript.mjs` 把 docx-runtime.js 當 vendor（包裝後掛 `mdLibs.AdoDocxLibs`）、docx-core.js 當模組內嵌。
- 內嵌 iframe 載的是我們建立的 **blob: 文件**（不是 srcdoc）：就地換頁靠「iframe 導覽不同 blob: URL」建立歷史紀錄，
  瀏覽器上一頁 / 前進才會逐頁可用（實測反覆重設 srcdoc 不會留下可用的歷史，上一頁只會重讀目前內容）。
  blob 文件繼承 dev.azure.com 的 CSP（實測其 `frame-src` / `child-src` 允許 `blob:`，但擋 `chrome-extension:`），
  所以每個 `<script>` 都要補上頁面的 nonce；blob URL 建立後不可 revoke（上一頁靠重新載入它）。
- 就地換頁協定（`linkFixScript` 產生的預覽內腳本 ↔ 父頁面）：點 repo 文件連結送 `ado-nav-request {path, hash, from}`，
  父頁面組好新文件（`finalizeDoc`）後導覽 iframe（內嵌 / userscript 用 blob: URL；全螢幕用 `sandbox.html?nav=N`，
  由 background 的 `build-preview-doc` 轉給來源分頁組檔）；`ado-nav-back` 則呼叫父視窗的 `history.back()`。
  每份文件的 `info` 存在 `navInfos[k]`（換頁時依 `from` 截斷），相對路徑資源與按需圖片才能以正確的目錄為基準。
  預覽文件左上角的「← 上一頁」圓鈕由 `linkFixScript` 注入（nav > 0 才顯示）；Tampermonkey 的 popup 用自己的一份 stack。
- 打開支援的檔案時 `content.js` 的 `maybeAutoPreview()` 會自動顯示內嵌預覽：每個檔案 key（path + version）只自動觸發一次
  （避免 MutationObserver → render → mutation 的迴圈，也不在使用者切走頁籤後把他拉回 Preview），
  `_a` 指向 History / Blame 等非預覽頁籤、或分支尚未確定（version 為空）時不自動顯示；Tampermonkey 版要同步。
- 改完程式後需到 `chrome://extensions` 重新載入擴充功能，並重新整理 Azure DevOps 頁面才會生效。
- Markdown 預覽的 DOM 結構由 `md-shell.js` 決定、樣式只在 `md-theme.js`；改版面請先改 CSS，真的需要新元素再動 shell，並同步更新 Tampermonkey 版本（它把三個 md-*.js 內嵌在同一個檔案裡）。
- Markdown 預覽的 iframe 取代的是 ADO 的 `.markdown-preview-container`（Markdown 沒有 srcdoc iframe）；ADO 的深色模式以 `body.ms-vss-web-vsts-theme-dark` 判斷，預覽文件的初始主題由此決定，之後可在預覽內切換。
- mermaid 在 sandbox iframe（origin 為 null）內可能載不到 `chrome-extension://` 的檔案，`md-shell.js` 的 bootstrap 會改向父頁面（content script / preview.js）要原始碼再以 inline script 注入；不要拿掉這個備援。
- Markdown 本身的 HTML 會經 DOMPurify 消毒（移除 script / style / iframe 等），預覽文件只有我們自己的 bootstrap 腳本帶 nonce。
- `scratchpad` 以外若要離線檢視主題效果，可用 node 載入 `vendor/marked.min.js`、`vendor/highlight.min.js`、`md-core.js`、`md-shell.js`、`md-theme.js` 後呼叫 `AdoMarkdown.render` + `AdoMarkdownShell.buildDocument`。
