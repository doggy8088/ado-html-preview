# Azure DevOps HTML Preview

Chrome 擴充功能：在 Azure DevOps Repos 的檔案頁籤列加上兩顆按鈕，讓你以**啟用 JavaScript** 的方式完整預覽 repo 裡的 HTML 檔案，並以**更美觀、支援深淺色**的排版預覽 Markdown 檔案。

Azure DevOps 內建的 Preview 會把 HTML 放進被 CSP 限制的 iframe，檔案裡的 `<script>` 全部不會執行，只能看到沒有互動的靜態畫面。這個擴充功能自己透過 Git REST API 抓原始檔，再放進**隔離的 sandbox** 重新渲染，腳本可以跑、頁面不能碰 Azure DevOps 的 cookie 或 session。

![icon](icons/icon128.png)

## 功能

| 按鈕 | 行為 |
| --- | --- |
| **完整預覽 (內嵌)** | 直接取代 Preview 頁籤內的預覽區塊，高度填滿視窗。若目前在 Contents / History 等頁籤會自動切到 Preview。 |
| **完整預覽 (全螢幕)** | 開一個與目前視窗同尺寸的獨立視窗，在擴充功能自己的 sandbox 頁面中渲染。 |

預覽內的連結也會修正：`#錨點` 正常跳轉、相對路徑（例如 `../docs/x.md`）會在新分頁開啟 repo 內對應的檔案、外部網址開新分頁。

### Markdown 預覽

開啟 `.md` / `.markdown` 檔時，兩顆按鈕變成 **Markdown 預覽 (內嵌)** 與 **Markdown 預覽 (全螢幕)**，用自家的排版主題取代 Azure DevOps 內建的 Markdown 預覽：

- 針對中英混排調整的字型、字級、行高與段落節奏；文章置中、表格可超出文章寬度並水平捲動、表頭固定。
- 深淺色主題：依 Azure DevOps 目前的主題決定初始模式，預覽內可隨時切換。
- 側邊目錄（跟著捲動高亮目前段落、可收合）、標題錨點、文內 `[[_TOC_]]`。
- 程式碼區塊語法上色（highlight.js）與一鍵複製；`mermaid` 圖表（```` ```mermaid ```` 或 `::: mermaid`）；GitHub 風格的 `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` 提示區塊；工作清單；YAML front matter。
- 相對路徑的圖片會透過 Git REST API 讀回來內嵌，跟 Azure DevOps 內建預覽一樣能顯示 repo 內的圖片。
- Markdown 內的 HTML 會先經 DOMPurify 消毒，再放進沒有 `allow-same-origin` 的 sandbox 中渲染。

同功能的 Tampermonkey 版本：[AzureDevOpsHtmlPreview.user.js](https://github.com/doggy8088/TampermonkeyUserscripts/raw/main/src/AzureDevOpsHtmlPreview.user.js)。

## 安裝

- Chrome Web Store：<https://chromewebstore.google.com/detail/nmkijdbigeagfllhafiajnjpldbdlbfl>
- 從原始碼：`git clone` 後到 `chrome://extensions` 開啟「開發人員模式」→「載入未封裝項目」→ 選擇此資料夾。

## 使用方式

1. 在 Azure DevOps 打開任何 `.html` / `.htm` 或 `.md` / `.markdown` 檔案（網址為 `https://dev.azure.com/{org}/{project}/_git/{repo}?path=/x.html`）。
2. 頁籤列右側會出現「完整預覽 (內嵌)」與「完整預覽 (全螢幕)」（Markdown 檔則是「Markdown 預覽 (內嵌)」與「Markdown 預覽 (全螢幕)」）。
3. 點其中一顆即可。

## 安全設計

- 預覽 iframe 與 sandbox 頁都**沒有** `allow-same-origin`：網頁腳本跑在 null origin，無法讀取 Azure DevOps 的 cookie、localStorage 或呼叫 API。
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
