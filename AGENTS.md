# AGENTS.md

本專案是 Chrome 擴充功能「Azure DevOps HTML Preview」（Manifest V3），
在 Azure DevOps Repos 的檔案頁籤列加上「完整預覽 (內嵌)」與「完整預覽 (全螢幕)」兩顆按鈕，
讓 HTML 檔能在啟用 JavaScript 的隔離 sandbox 中預覽。

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

## 檔案說明

| 檔案 | 用途 |
| --- | --- |
| `manifest.json` | 擴充功能設定：權限、background、sandbox 頁面與其 CSP |
| `content.js` | 注入 dev.azure.com：在 `.bolt-tabbar` 右側加按鈕；內嵌模式用 sandbox iframe 取代預覽區塊；全螢幕模式把 HTML 送給 background |
| `background.js` | Service worker：把 HTML 暫存到 `chrome.storage.session`，再用 `chrome.windows.create` 開新視窗 |
| `preview.html` / `preview.js` | 新視窗的外層頁面（一般 extension CSP），負責取出 HTML 並交給內層 sandbox |
| `sandbox.html` | 列在 manifest `sandbox` 清單的頁面（origin 為 null），收到 HTML 後整頁 `document.write` |
| `_locales/` | i18n 訊息（en 為 default_locale、zh_TW），manifest 的 name / description 以 `__MSG_appName__` / `__MSG_appDesc__` 引用 |
| `icons/` | 擴充功能圖示（16/32/48/128 與 1024 母檔），由 AI 生成；userscript 的圖示是同一張，放在 TampermonkeyUserscripts 的 `images/AzureDevOpsHtmlPreview.png` |
| `store-assets/` | Chrome Web Store 宣傳圖（440×280、1400×560）與截圖 |
| `docs/` | `PUBLISHING.md` 上架步驟、`STORE_LISTING.md` 商店文案、`PRIVACY_POLICY.md` 隱私權政策 |
| `scripts/package.sh` | 打包上架用 zip，本機與 CI 共用 |
| `release-notes/` | 每個版本一個 `v<version>.md`，作為 GitHub Release 的內文 |
| `.github/workflows/publish.yml` | 推到 main 且版本號是新的（無 `v<version>` tag）就建立 GitHub Release；`CWS_AUTO_PUBLISH=true` 時再上傳 Chrome Web Store 並送審 |

## 開發注意事項

- 安全設計：內嵌 iframe 與 sandbox 頁都**不得**加 `allow-same-origin`，網頁腳本不能接觸 Azure DevOps 的 cookie / session。
- 內嵌 iframe 的 srcdoc 會繼承 dev.azure.com 的 CSP，所以每個 `<script>` 都要補上頁面的 nonce。
- 內嵌 iframe 高度是「填滿頁籤列以下的視窗」，不要改成依內容高度撐開：使用 vh 單位的網頁會形成無限增長迴圈。
- macOS 上 `chrome.windows.create` 的 `type:'popup'` 搭配 `state:'maximized'` 會產生 1×33px 的視窗，務必用明確的 left/top/width/height。
- 網址有兩種：`/{org}/{project}/_git/{repo}` 與省略專案段的 `/{org}/_git/{repo}`（專案名 = repo 名），`parseLocation()` 兩種都要支援，後者以 repo 名當專案名呼叫 API。
- 預覽前會把 HTML 內相對路徑的 `<script src>`、`<link rel=stylesheet>`、`<img src>` 透過 Git Items API 抓回來內嵌（`inlineRelativeAssets`）；執行期 fetch 的資源與 CSS 內的 `url()` 不處理。抓資源必須用 `$format=octetStream`，`text` 會把二進位檔轉碼損毀。
- 內嵌模式與 userscript 的 srcdoc 會繼承 Azure DevOps 的 CSP（沒有 `unsafe-eval`），需要 eval / new Function 的函式庫（如 PDF.js）只能用擴充功能的「全螢幕」模式（extension sandbox 頁的 CSP 允許 unsafe-eval）。
- 改完程式後需到 `chrome://extensions` 重新載入擴充功能，並重新整理 Azure DevOps 頁面才會生效。
