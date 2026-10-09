# Chrome Web Store 上架與自動發布手冊

分三個階段：**A. 一次性準備**（開發者帳號、首次手動上架）→ **B. 設定 API 與 GitHub Secrets** → **C. 之後每次發布全自動**。

> **目前狀態：首版 v0.1.0 已上架（<https://chromewebstore.google.com/detail/nmkijdbigeagfllhafiajnjpldbdlbfl>），Repository variable `CWS_AUTO_PUBLISH` = `true`，推到 `main` 的新版本會在建立 GitHub Release 後自動上傳並送審。**
> 需要暫停自動上架時，把 `CWS_AUTO_PUBLISH` 改成 `false` 即可（見 B3-1）。

---

## A. 一次性準備

### A1. 註冊 Chrome Web Store 開發者帳號

1. 用要當發布者的 Google 帳號開啟 <https://chrome.google.com/webstore/devconsole>。
2. 同意開發者協議與政策，支付一次性註冊費（美金 5 元）。
3. 到「帳戶」頁：
   - 填寫**發布者顯示名稱**（例如 `Duotify`）與**聯絡電子郵件**並完成驗證。
   - 該 Google 帳號必須啟用**兩步驟驗證**，否則不能發布或更新。
   - 記下頁面上的 **Publisher ID**（之後 GitHub Secret `CWS_PUBLISHER_ID` 要用）。
   - 「交易者 / 非交易者」聲明依實際狀況填（個人免費擴充功能通常選非交易者）。

### A2. 準備套件

```bash
cd ado-html-preview
./scripts/package.sh          # 產生 dist/ado-html-preview-<version>.zip
```

確認 `manifest.json`：
- `version` 是你要上架的版本（首次建議 `0.1.x`）。
- `description` 在 132 字元以內。
- `icons` 四個尺寸都存在。

### A3. 首次手動上架（API 無法建立新項目，第一次一定要手動）

1. 開發人員主控台 → **新增項目** → 上傳 `dist/*.zip`。
2. 上傳後網址列會出現 32 碼的 **擴充功能 ID**，記下來（`CWS_EXTENSION_ID`）。
3. 依 [`STORE_LISTING.md`](STORE_LISTING.md) 填寫：
   - **商店資訊**：摘要、說明、類別、語言、圖示、截圖（至少 1 張 1280×800）、小型宣傳圖 440×280（`store-assets/promo-small-440x280.png`）。
   - **隱私權**：單一用途、權限理由、遠端程式碼聲明、資料使用認證、隱私權政策網址。
   - **發布範圍**：免費、公開、全部地區。
   - **測試說明**：貼上 `STORE_LISTING.md` 的測試說明。
4. 右上角 **送交審查**。首次審查通常數個工作天；若被退件，依信件內容修正後重送。
5. 審查通過後項目會自動發布（除非你取消勾選「審查通過後自動發布」）。

> 隱私權政策網址必須是公開可讀的網頁。把 repo 推上 GitHub 後，`https://github.com/<owner>/<repo>/blob/main/docs/PRIVACY_POLICY.md` 即可使用；若 repo 不是 `doggy8088/ado-html-preview`，請同步修改 `manifest.json` 的 `homepage_url`、`README.md`、`STORE_LISTING.md` 與 `PRIVACY_POLICY.md` 內的網址。

---

## B. 設定 Chrome Web Store API 與 GitHub Secrets

### B1. 建立 Google Cloud OAuth 用戶端

1. 開啟 <https://console.cloud.google.com/>，建立（或選擇）一個專案，例如 `cws-publish`。
2. **API 和服務 → 程式庫**，搜尋 **Chrome Web Store API** → 啟用。
3. **API 和服務 → OAuth 同意畫面**：
   - 使用者類型選 **外部**。
   - 應用程式名稱隨意（例如 `CWS Publisher`），填支援與開發人員聯絡信箱。
   - 範圍（Scopes）可略過。
   - **測試使用者**：加入你的發布者 Google 帳號。保持「測試中」狀態即可，不需送審。
4. **API 和服務 → 憑證 → 建立憑證 → OAuth 用戶端 ID**：
   - 應用程式類型：**網頁應用程式**。
   - 已授權的重新導向 URI：`https://developers.google.com/oauthplayground`
   - 建立後記下 **用戶端 ID**（`CWS_CLIENT_ID`）與 **用戶端密鑰**（`CWS_CLIENT_SECRET`）。

### B2. 取得 refresh token

1. 開啟 <https://developers.google.com/oauthplayground/>。
2. 右上角齒輪 → 勾選 **Use your own OAuth credentials**，貼上用戶端 ID 與密鑰。
3. 左側 Step 1 的輸入框填入範圍 `https://www.googleapis.com/auth/chromewebstore` → **Authorize APIs**。
4. 用**發布者 Google 帳號**登入並同意（測試中的應用程式會出現警告，按「繼續」）。
5. Step 2 → **Exchange authorization code for tokens**，複製 **Refresh token**（`CWS_REFRESH_TOKEN`）。

> 測試中狀態的 OAuth 應用程式所發的 refresh token 有效期 7 天；若要長期使用，到 OAuth 同意畫面把應用程式**發布**（Publish app）成正式狀態——不需要 Google 審核，因為 chromewebstore 範圍不屬於敏感範圍。發布後重新做一次 B2 取得新的 refresh token。

### B3. 在 GitHub 設定 Secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**，建立五個：

| Secret | 值 |
| --- | --- |
| `CWS_PUBLISHER_ID` | 開發人員主控台「帳戶」頁的 Publisher ID |
| `CWS_EXTENSION_ID` | A3 記下的 32 碼擴充功能 ID |
| `CWS_CLIENT_ID` | B1 的 OAuth 用戶端 ID |
| `CWS_CLIENT_SECRET` | B1 的 OAuth 用戶端密鑰 |
| `CWS_REFRESH_TOKEN` | B2 的 refresh token |

另外確認 **Settings → Actions → General → Workflow permissions** 設為 **Read and write permissions**（workflow 要建 tag 與 Release）。

### B3-1. CWS 上傳開關（Repository variable）

同一頁切到 **Variables** 分頁：

| Variable | 值 |
| --- | --- |
| `CWS_AUTO_PUBLISH` | `true` = 推到 main 時建立 Release 後自動上傳 CWS 並送審；未設定或其他值 = 只建立 GitHub Release |

改這個變數不需要 commit，也不用加版號。

### B4. 驗證自動化（不送審）

Actions 頁 → **Release and Publish to Chrome Web Store** → **Run workflow**，勾選 `cws_upload`、把 `publish` 取消勾選 → Run。
這會把該版本 GitHub Release 上的 zip（Release 不存在時會先建立）只上傳成一個草稿版本（manifest 版本必須比商店目前版本高），到開發人員主控台看到「草稿」即代表 API 設定正確。驗證完可在主控台把草稿捨棄，或直接讓下一次正式發布覆蓋。

---

### B5. 首版上架後開啟自動上傳

首版審查通過、正式上架後：

1. 依 B3-1 把 `CWS_AUTO_PUBLISH` 設為 `true`。
2. 在 CWS 關閉期間已經建立 Release、但還沒上傳商店的版本，可以到 Actions 頁 **Run workflow** 並勾選 `cws_upload`（`publish` 保持勾選），會把 `manifest.json` 目前版本的 Release zip 上傳並送審。

---

## C. 日常發布流程（全自動）

1. 在分支上改程式，把 `manifest.json` 的 `version` patch +1（例如 `0.1.3 → 0.1.4`）。
2. 新增 `release-notes/v<version>.md`，詳細寫出這一版的內容（建議段落：新功能、修正、行為變更、已知限制、升級注意事項；可參考 `release-notes/v0.1.0.md`）。這個檔案就是 GitHub Release 的內文，**缺檔案時 workflow 會直接失敗**。
3. 合併 / 推到 `main`。
4. workflow `publish.yml` 會：
   1. **check**：讀 `manifest.json` 的版本，若 `v<version>` tag 已存在就略過（避免重複發布）；確認 release notes 檔存在；依 `CWS_AUTO_PUBLISH` 決定要不要上傳 CWS。
   2. **release**：執行 `scripts/package.sh` 打包，建立 `v<version>` tag 與 GitHub Release（內文 = release notes 檔 + GitHub 自動產生的變更清單），附上 zip。
   3. **cws**（`CWS_AUTO_PUBLISH=true` 才執行）：下載 Release 上的 zip → 用 refresh token 換 access token → 呼叫 `…/items/{id}:upload` 上傳 → 呼叫 `…/items/{id}:publish` 送審，審核通過後自動上線。
5. 到 Actions 看執行結果；到開發人員主控台看審查狀態。審查期間再推新版本會被 API 拒絕（Release 仍會建立），等上一版審完後用 **Run workflow** 勾選 `cws_upload` 補上傳即可。

### 只改文件不發布

只改 `README.md`、`docs/`、`AGENTS.md` 等不需要動 `version`；workflow 會因為 tag 已存在而跳過。

### 緊急取消送審

```bash
TOKEN=$(curl -s https://oauth2.googleapis.com/token -d client_id=$CWS_CLIENT_ID -d client_secret=$CWS_CLIENT_SECRET -d refresh_token=$CWS_REFRESH_TOKEN -d grant_type=refresh_token | jq -r .access_token)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Length: 0" \
  "https://chromewebstore.googleapis.com/v2/publishers/$CWS_PUBLISHER_ID/items/$CWS_EXTENSION_ID:cancelSubmission"
```

---

## 常見問題

| 狀況 | 原因 / 處理 |
| --- | --- |
| 上傳回 `ITEM_NOT_UPDATABLE` 或版本相關錯誤 | manifest 版本沒有比商店現有版本高，或上一版仍在審查中。 |
| 取得 access token 失敗 `invalid_grant` | refresh token 過期（測試中應用程式 7 天）或被撤銷，重做 B2；或把 OAuth 應用程式發布成正式狀態。 |
| 403 權限錯誤 | OAuth 登入的 Google 帳號不是該項目的擁有者 / 發布者群組成員，或 Chrome Web Store API 未啟用。 |
| 發布回「visibility」相關錯誤 | 在主控台改過發布範圍後，必須先手動發布一次，API 才能再發布。 |
| 審核以「遠端程式碼」退件 | 依 `STORE_LISTING.md` 的遠端程式碼說明申訴，強調內容在無 allow-same-origin 的 sandbox 執行，且是使用者自己的檔案。 |
