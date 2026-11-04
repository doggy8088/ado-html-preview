# Azure DevOps HTML Preview

Chrome 擴充功能：在 Azure DevOps Repos 的檔案頁籤列加上兩顆按鈕，讓你以**啟用 JavaScript** 的方式完整預覽 repo 裡的 HTML 檔案、以**更美觀、支援深淺色**的排版預覽 Markdown 檔案、用 **Chrome 內建的 PDF 檢視器**預覽 PDF 檔案、以**主題化的唯讀表格**預覽 Excel（`.xlsx`）工作簿，並以**高保真版面**預覽 Word（`.docx`）文件。

Azure DevOps 內建的 Preview 會把 HTML 放進被 CSP 限制的 iframe，檔案裡的 `<script>` 全部不會執行，只能看到沒有互動的靜態畫面。這個擴充功能自己透過 Git REST API 抓原始檔，再放進**隔離的 sandbox** 重新渲染，腳本可以跑、頁面不能碰 Azure DevOps 的 cookie 或 session。

![icon](icons/icon128.png)

## 功能

開啟 `.html` / `.htm`、`.md` / `.markdown`、`.pdf`、`.xlsx` 或 `.docx` 檔案時，**內嵌預覽會自動啟用**（不在 Preview 頁籤時會自動切過去），不必按按鈕。每個檔案（含分支）只自動觸發一次：手動切回 Contents 等頁籤後不會被強行拉回 Preview，切換檔案 / 分支時才會再次自動顯示；網址的 `_a` 指向 History / Blame 等頁籤時不搶走焦點。想重開預覽或換全螢幕時才用這兩顆按鈕：

| 按鈕 | 行為 |
| --- | --- |
| **完整預覽 (內嵌)** | 直接取代 Preview 頁籤內的預覽區塊，高度填滿視窗。若目前在 Contents / History 等頁籤會自動切到 Preview。 |
| **完整預覽 (全螢幕)** | 開一個與目前視窗同尺寸的獨立視窗，在擴充功能自己的 sandbox 頁面中渲染。 |

預覽內由 JavaScript 動態產生的相對路徑圖片會在捲到視窗附近時按需載入。

預覽內的連結會像逛網站一樣處理：指向 repo 文件的連結（`.html` / `.htm` / `.md` / `.markdown`）**就地換頁**，不開新分頁；瀏覽器的上一頁 / 前進逐頁可用，換過頁的文件左上角另有「← 上一頁」小圓鈕（全螢幕 popup 沒有工具列也能回去）。`#錨點` 與跨文件錨點（`x.md#install`）正常跳轉；Ctrl / ⌘ / Shift 點擊、中鍵點擊與外部網址維持開新分頁。

### Markdown 預覽

開啟 `.md` / `.markdown` 檔時，兩顆按鈕變成 **Markdown 預覽 (內嵌)** 與 **Markdown 預覽 (全螢幕)**，用自家的排版主題取代 Azure DevOps 內建的 Markdown 預覽：

- 針對中英混排調整的字型、字級、行高與段落節奏；文章置中、表格可超出文章寬度並水平捲動、表頭固定。
- 深淺色主題：依 Azure DevOps 目前的主題決定初始模式，預覽內可隨時切換。
- 側邊目錄（跟著捲動高亮目前段落、可收合）、標題錨點、文內 `[[_TOC_]]`。
- 程式碼區塊語法上色（highlight.js）與一鍵複製；`mermaid` 圖表（```` ```mermaid ```` 或 `::: mermaid`，可縮放與全螢幕檢視）；GitHub 風格的 `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` 提示區塊；工作清單；YAML front matter。
- 相對路徑的圖片會透過 Git REST API 讀回來內嵌，跟 Azure DevOps 內建預覽一樣能顯示 repo 內的圖片。
- Markdown 內的 HTML 會先經 DOMPurify 消毒，再放進沒有 `allow-same-origin` 的 sandbox 中渲染。

### Excel 預覽

開啟 `.xlsx` 檔時，兩顆按鈕變成 **Excel 預覽 (內嵌)** 與 **Excel 預覽 (全螢幕)**：以 Git REST API 的二進位格式取回原始檔，經 **SheetJS**（Community，Apache-2.0）解析後以自家主題的**唯讀表格**呈現。

- 多工作表以頁籤切換；儲存格保留基本樣式（粗體／斜體／底線／刪除線／字色／底色／對齊／自動換行／字級）與數字格式（日期、百分比、千分位…）、合併儲存格、欄寬、列高、凍結窗格，並附 Excel 風格的欄字母與列號標頭。
- 內嵌預覽與 PDF 一樣掛自製的「Preview」頁籤（Contents / History 等原生頁籤正常切換）；全螢幕走 sandbox 頁（輸出即 HTML 文件）。
- 樣式還原：SheetJS 只把填色放進 `cell.s`，其餘樣式自 `wb.Styles` 配合直接掃描工作表 XML 的每格樣式索引（xf）還原（見 `xlsx-core.js`）。配色採**紙張語意**（跟著檔案、不隨深淺色主題改變），深色模式下表格仍維持檔案設計的原色。
- 已知限制：僅 `.xlsx`；不支援圖片、圖表、樞紐分析與篩選（公式顯示快取值）；富文字取顯示文字；單一工作表超過 60,000 格會截斷並提示。

### Word 預覽

開啟 `.docx` 檔時，兩顆按鈕變成 **Word 預覽 (內嵌)** 與 **Word 預覽 (全螢幕)**：以 Git REST API 的二進位格式取回原始檔，產出**自帶渲染器**的高保真預覽文件（docx-preview ＋ JSZip 只在 sandbox 文件內執行）。

- 依原稿還原：字型樣式、表格框線與底色、頁首頁尾、圖片（內嵌 data URL）、分頁與頁面尺寸。
- 配色採**紙張語意**（跟著檔案、不隨深淺色主題改變）；頂欄外殼才跟隨主題。
- 安全：渲染器與文件內容都在 sandbox 內執行，與 Azure DevOps 頁面完全隔離；內容中的 `</script>` 會被跳脫。
- 已知限制：僅 `.docx`（舊 `.doc` 不支援）；追蹤修訂以合併結果顯示；字型未內嵌時以系統近似字型呈現。

### PDF 預覽

開啟 `.pdf` 檔時，兩顆按鈕變成 **PDF 預覽 (內嵌)** 與 **PDF 預覽 (全螢幕)**：以 Git REST API 的二進位格式取回原始檔，包成 `blob: application/pdf` 交給 **Chrome 內建的 PDF 檢視器**顯示，自帶搜尋、縮圖、列印與表單功能。

- 內嵌預覽掛在頁籤列上**自製的「Preview」頁籤**（Azure DevOps 的 PDF 檔案頁沒有 Preview 頁籤）：預覽只在這個頁籤顯示，Contents / History / Compare / Blame 可正常切換，切走後再點回「Preview」預覽還在。

- 不引入 PDF.js：它需要 `eval` / `new Function`，Azure DevOps 的 CSP（沒有 `unsafe-eval`）下只有全螢幕模式跑得動；內建檢視器兩種模式都可用。
- 全螢幕不走 `chrome.storage.session`（配額 10 MB，大 PDF 放不下）：開一個 popup 視窗直接導去 PDF 的 blob URL。
- 安全：PDF 由 PDFium 算繪、不執行 PDF 內嵌的 JavaScript，內容不是 HTML、也碰不到 Azure DevOps 的 cookie 或 session。
  也因此 PDF 的 iframe **不加 sandbox**（實測 sandbox 且無 `allow-same-origin` 會讓內建檢視器載不起來），這是 PDF 專屬的例外。

同功能的 Tampermonkey 版本：[AzureDevOpsHtmlPreview.user.js](https://github.com/doggy8088/TampermonkeyUserscripts/raw/main/src/AzureDevOpsHtmlPreview.user.js)。

## 安裝

- Chrome Web Store：<https://chromewebstore.google.com/detail/nmkijdbigeagfllhafiajnjpldbdlbfl>
- 從原始碼：`git clone` 後到 `chrome://extensions` 開啟「開發人員模式」→「載入未封裝項目」→ 選擇此資料夾。

## 使用方式

1. 在 Azure DevOps 打開任何 `.html` / `.htm`、`.md` / `.markdown`、`.pdf` 或 `.xlsx` 檔案（網址為 `https://dev.azure.com/{org}/{project}/_git/{repo}?path=/x.html`）。
2. 內嵌預覽自動顯示（Markdown 檔是「Markdown 預覽」的排版，PDF 檔是 Chrome 內建的 PDF 檢視器，Excel 是唯讀表格）。
3. 頁籤列右側另有「完整預覽 (內嵌)」與「完整預覽 (全螢幕)」（Markdown 檔則是「Markdown 預覽 (內嵌)」與「Markdown 預覽 (全螢幕)」，PDF 檔則是「PDF 預覽 (內嵌)」與「PDF 預覽 (全螢幕)」，Excel 則是「Excel 預覽 (內嵌)」與「Excel 預覽 (全螢幕)」），可重開預覽或改用全螢幕。

## 安全設計

- 預覽 iframe 與 sandbox 頁都**沒有** `allow-same-origin`：網頁腳本跑在 null origin，無法讀取 Azure DevOps 的 cookie、localStorage 或呼叫 API。
- PDF 是唯一的例外：Chrome 內建 PDF 檢視器在 sandbox iframe 中載不起來，所以 PDF 的 iframe 不加 sandbox。
  PDF 由 PDFium 算繪、不執行 PDF 內嵌的 JavaScript，內容也不是 HTML，不會有網頁腳本的疑慮（見上方「PDF 預覽」）。
- 擴充功能只在 `https://dev.azure.com/*` 注入，只向同一個 Azure DevOps 組織的 Git Items API 讀取你正在看的那個檔案（以及它以相對路徑引用的同 repo 資源）。
- 所有函式庫（marked、DOMPurify、highlight.js、mermaid）都打包在擴充功能內，不從 CDN 載入。
- 不收集、不傳送任何資料到第三方，沒有分析、沒有遠端伺服器。詳見 [隱私權政策](docs/PRIVACY_POLICY.md)。

## 開發

```
manifest.json     擴充功能設定（MV3）
content.js        注入 dev.azure.com：按鈕、內嵌預覽、全螢幕請求
md-core.js        Markdown → HTML（marked + highlight.js + DOMPurify）
md-shell.js       Markdown 預覽文件外殼與 iframe 內的 bootstrap（主題切換、目錄、複製、mermaid）
md-theme.js       Markdown 預覽主題 CSS（light / dark）
vendor/           marked、DOMPurify、highlight.js、mermaid
background.js     Service worker：暫存 HTML 並開啟預覽視窗
preview.html/js   預覽視窗外層頁
sandbox.html      manifest sandbox 頁，實際渲染 HTML
icons/            圖示
docs/             上架文件、隱私權政策
scripts/package.sh 打包 zip
```

改完程式後到 `chrome://extensions` 按「重新載入」，並重新整理 Azure DevOps 頁面。每次修改程式都要把 `manifest.json` 的 patch 版號 +1（見 [AGENTS.md](AGENTS.md)）。

## 發布

推到 `main` 且 `manifest.json` 的版本號是新的（尚無對應的 `v<version>` tag），GitHub Actions 會自動打包，並以 `release-notes/v<version>.md` 為內文建立 GitHub Release；Repository variable `CWS_AUTO_PUBLISH` 設為 `true` 時才會接著上傳到 Chrome Web Store 送審。完整步驟見 [docs/PUBLISHING.md](docs/PUBLISHING.md)。

## 授權

MIT
