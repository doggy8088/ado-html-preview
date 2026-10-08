# Chrome Web Store 商店資訊（填寫用文案）

把下列內容貼到開發人員主控台對應欄位。預設語言建議選 **繁體中文**，再新增 **English** 翻譯。

## 基本資料

| 欄位 | 值 |
| --- | --- |
| 名稱（取自 manifest） | Azure DevOps HTML Preview |
| 類別 | Developer Tools（開發人員工具） |
| 語言 | 繁體中文（預設）、English |
| 官方網址 | https://github.com/doggy8088/ado-html-preview |
| 支援網址 | https://github.com/doggy8088/ado-html-preview/issues |
| 隱私權政策網址 | https://github.com/doggy8088/ado-html-preview/blob/main/docs/PRIVACY_POLICY.md |

## 摘要（Summary，最多 132 字元）

**zh-TW**

在 Azure DevOps Repos 以啟用 JavaScript 的方式完整預覽 HTML 檔，內嵌或全螢幕，全程在隔離的 sandbox 中執行。

**en**

Preview HTML files in Azure DevOps Repos with JavaScript enabled, inline or full-screen, inside an isolated sandbox.

## 詳細說明（Description）

**zh-TW**

```
Azure DevOps Repos 內建的 Preview 會把 HTML 放進受 CSP 限制的 iframe，檔案裡的 <script> 全部不會執行，你只能看到沒有互動的靜態畫面。

Azure DevOps HTML Preview 在檔案頁籤列（Contents / Preview / History…）右側加上兩顆按鈕：

▶ 完整預覽 (內嵌)
直接在原本的預覽區塊顯示完整網頁，高度填滿視窗；在其他頁籤按下會自動切到 Preview。

▶ 完整預覽 (全螢幕)
開一個與目前視窗同尺寸的獨立視窗，讓使用者看到完整的網頁內容。

兩種模式都會：
• 透過 Azure DevOps Git REST API 讀取你正在看的那個檔案（使用你現有的登入狀態，不需要 PAT）
• 在沒有 allow-same-origin 的 sandbox 中渲染，網頁腳本碰不到 Azure DevOps 的 cookie 與 session
• 修正預覽內的連結：#錨點正常跳轉、相對路徑在新分頁開啟 repo 內對應檔案、外部網址開新分頁

適合把專案文件、設計稿、靜態原型（含 JavaScript）直接放在 repo 裡，讓團隊在 Azure DevOps 內就能完整瀏覽。

不收集任何資料，沒有分析、沒有遠端伺服器。原始碼：https://github.com/doggy8088/ado-html-preview
```

**en**

```
The built-in Preview tab in Azure DevOps Repos renders HTML inside a CSP-restricted iframe, so every <script> in the file is blocked and you only get a static, non-interactive page.

Azure DevOps HTML Preview adds two buttons to the file tab bar (Contents / Preview / History…):

▶ Full preview (inline)
Replaces the built-in preview area with the fully rendered page, sized to fill the window. Switches to the Preview tab automatically if needed.

▶ Full preview (full screen)
Opens a separate window the same size as your current one so you can see the whole page.

Both modes:
• fetch the single file you are viewing through the Azure DevOps Git REST API, using your existing session (no PAT needed)
• render it in a sandbox without allow-same-origin, so page scripts cannot touch Azure DevOps cookies or sessions
• fix links inside the preview: #anchors work, relative paths open the matching repo file in a new tab, external URLs open in a new tab

Ideal for keeping project docs, design mock-ups and static prototypes (with JavaScript) in the repo and browsing them fully inside Azure DevOps.

No data collection, no analytics, no remote server. Source: https://github.com/doggy8088/ado-html-preview
```

## 圖片素材

| 素材 | 規格 | 檔案 |
| --- | --- | --- |
| 商店圖示 | 128×128 PNG（取自 zip 內 manifest icons） | `icons/icon128.png` |
| 截圖（至少 1 張，建議 5 張） | 1280×800 或 640×400，無邊框、無圓角 | `store-assets/screenshot-1-buttons.png`、`screenshot-2-inline.png`、`screenshot-3-builtin-preview.png`、`screenshot-4-fullscreen.png`（已產出，1280×800） |
| 小型宣傳圖（必填） | 440×280 | `store-assets/promo-small-440x280.png` |
| 大型宣傳圖（選填） | 1400×560 | `store-assets/promo-marquee-1400x560.png` |

**已產出的截圖**（上傳順序建議如下，第 1 張會成為商店主圖）：

1. `screenshot-1-buttons.png`：Contents 頁籤下，頁籤列右側的兩顆按鈕。
2. `screenshot-2-inline.png`：「完整預覽 (內嵌)」渲染後的畫面。
3. `screenshot-4-fullscreen.png`：「完整預覽 (全螢幕)」獨立視窗。
4. `screenshot-3-builtin-preview.png`：對照圖，Azure DevOps 內建 Preview（沒有 JS、沒有樣式）。

要重拍時：Chrome 視窗調成內容區 16:10（例如 1104×690），用 macOS `⌘⇧4` + 空白鍵點視窗擷取，裁掉標題列後縮成 1280×800。

Retina 截圖會是 2560×1600，可用下列指令縮成 1280×800：

```bash
sips -z 800 1280 store-assets/screenshot-1.png
```

## 隱私權頁籤（Privacy）

**單一用途（Single purpose）**

```
在 Azure DevOps Repos 的檔案頁面，以啟用 JavaScript 的方式於隔離 sandbox 中預覽使用者正在檢視的 HTML 檔案。
```

**權限理由（Permission justification）**

| 權限 | 理由 |
| --- | --- |
| `storage` | 只使用 chrome.storage.session（記憶體、關閉瀏覽器即清除），在「全螢幕」模式把抓到的 HTML 交給預覽視窗，視窗讀取後立即刪除。不使用 local / sync storage。 |
| 主機權限 `https://dev.azure.com/*` | 需要在 Azure DevOps 檔案頁注入按鈕，並以使用者現有的登入狀態向同一組織的 Git Items REST API 讀取使用者正在檢視的那一個檔案。 |

**遠端程式碼（Remote code）**：選「是」，並填寫：

```
本擴充功能本身的程式碼全部打包在套件內，不從任何遠端位置載入腳本。
唯一會執行的「非套件內程式碼」是使用者自己放在其 Azure DevOps repo 裡、並主動按下預覽按鈕的那一個 HTML 檔案：它會被放進沒有 allow-same-origin 的 sandbox iframe（以及 manifest sandbox 頁）中渲染，這正是擴充功能的單一用途——讓使用者以啟用 JavaScript 的方式預覽自己的 HTML。該內容以 null origin 執行，無法存取擴充功能 API、Azure DevOps 的 cookie 或任何使用者資料，也不會被擴充功能的其他部分執行或信任。
```

> 審核風險提醒：MV3 原則上禁止遠端程式碼，官方文件只明確放行「在 sandbox iframe 中 eval 字串」這類情境，沒有直接寫明「使用者自有的 HTML」。此欄位務必誠實填寫並說明 sandbox 隔離；若被退件，可依退件信引用上述說明申訴，或在測試說明欄附上可公開存取的範例 repo。

**資料使用（Data usage）**：所有「收集的資料類型」都不勾選；三項認證聲明全部勾選（不向第三方出售、不用於無關用途、不用於信用評估）。

**隱私權政策網址**：`https://github.com/doggy8088/ado-html-preview/blob/main/docs/PRIVACY_POLICY.md`

## 測試說明（Test instructions）

```
1. 登入任一 Azure DevOps 組織（dev.azure.com），開啟 repo 內任何 .html 檔案，例如
   https://dev.azure.com/{org}/{project}/_git/{repo}?path=/index.html
2. 頁籤列右側會出現「完整預覽 (內嵌)」與「完整預覽 (全螢幕)」兩顆按鈕。
3. 點「完整預覽 (內嵌)」：預覽區塊會改為啟用 JavaScript 的完整網頁。
4. 點「完整預覽 (全螢幕)」：開啟獨立視窗顯示完整網頁。
若審核人員沒有 Azure DevOps 帳號，免費方案可於 https://azure.microsoft.com/services/devops/ 建立，建立 repo 後上傳任一含 <script> 的 HTML 即可測試。
```

## 發布範圍（Distribution）

- 付費狀態：免費
- 顯示範圍：公開（Public）
- 地區：全部
