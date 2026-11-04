# Changelog

「Azure DevOps HTML Preview」所有版本的變更紀錄，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)。
每個版本的完整說明（含運作方式與已知限制）見 [`release-notes/`](release-notes/) 內的對應檔案，發布包見 [GitHub Releases](https://github.com/doggy8088/ado-html-preview/releases)。

## [0.3.0] – 2026-11-05 — 檔案格式大擴充：Excel、Word 預覽與視覺驗證框架

> 完整說明：[release-notes/v0.3.0.md](release-notes/v0.3.0.md)

### 新功能（自 v0.2.10–v0.2.12 併入）

- **Excel（.xlsx）預覽**：SheetJS 解析、主題化唯讀表格（多工作表頁籤、樣式、數字格式、
  合併儲存格、欄寬列高、凍結窗格、欄字母／列號標頭）；樣式以 wb.Styles＋sheet XML 的 xf 索引還原。
- **Word（.docx）預覽**：docx-preview＋JSZip 高保真「自帶渲染器」（樣式、表格框線、頁首頁尾、
  圖片、分頁依原稿）；渲染引擎只在 sandbox 預覽文件內執行。
- 三種二進位格式（PDF / xlsx / docx）共用自製「Preview」頁籤機制。

### 品質工程

- **紙張語意**：唯讀表格與文件的配色跟著「檔案」、不隨主題改變（深色模式可讀性修正）。
- **視覺驗證框架**（AGENTS.md）：雙主題親眼確認、run 層對比（WCAG）、紙張語意不變性、
  來源檔 ground truth 對照；`make test` 52 項（xlsx＋docx）。

### 已知限制

- xlsx：僅 .xlsx、不支援圖表／樞紐／篩選（公式顯示快取值）；docx：僅 .docx、追蹤修訂合併顯示。

## [0.2.12] – 2026-11-05（未單獨發布，併入 v0.3.0 一起發布）— 新增 Word（.docx）預覽：高保真版面

> 完整說明：[release-notes/v0.2.12.md](release-notes/v0.2.12.md)

### 新功能

- **Word 預覽 (內嵌 / 全螢幕)**：`.docx` 以「自帶渲染器」的預覽文件高保真顯示（docx-preview 0.4.1 + JSZip）：
  字型樣式、表格框線底色、頁首頁尾、圖片（data URL）、分頁與頁面尺寸依原稿；配色採紙張語意（跟著檔案）。
  內嵌掛自製「Preview」頁籤（與 PDF / xlsx 共用機制）。
- 安全設計：渲染引擎只在 sandbox 預覽文件內執行（原始碼字串打包於 docx-runtime.js），與 ADO 頁面完全隔離；
  `</script` 內容一律跳脫。

### 工程

- `make test` 新增 docx 組裝測試（payload 逐位元回還原、注入安全、雙主題僅外殼不同）；
  build-docx-runtime.mjs 產生渲染引擎字串檔；userscript 內嵌同步（@version 0.2.12）。

### 已知限制

- 僅 .docx（舊 .doc 不支援）；追蹤修訂以合併結果顯示；字型未內嵌時用系統近似字型。

## [0.2.11] – 2026-11-05（未單獨發布，併入 v0.3.0 一起發布）— 修正 Excel 預覽的表格顏色（紙張語意）＋視覺驗證規範

> 完整說明：[release-notes/v0.2.11.md](release-notes/v0.2.11.md)

### 修正

- 深色模式下 Excel 儲存格文字不可讀：未指定字色的儲存格吃 App 主題白字 × 檔案淺色底。
  改採紙張語意——未指定字色 = 檔案 dk1、未指定底色 = 檔案 lt1，配色跟著檔案、不隨主題改變（每格寫顯式值）。
- 移除唯讀表格斑馬紋與 hover 變色（會蓋掉檔案底色）；hover 改為不改配色的疊色。

### 工程

- 新增 `make test`（scripts/test-xlsx-core.mjs）：行為斷言＋紙張語意不變性＋WCAG AA 對比檢查（含預設值）。
- AGENTS.md 新增「視覺驗證」規範（雙主題親眼確認、對比/computed style 判定、截圖工具失效要明說）。

## [0.2.10] – 2026-11-05（未單獨發布，併入 v0.3.0 一起發布）— 新增 Excel（.xlsx）預覽：主題化的唯讀表格

> 完整說明：[release-notes/v0.2.10.md](release-notes/v0.2.10.md)

### 新功能

- **Excel 預覽 (內嵌 / 全螢幕)**：`.xlsx` 以 SheetJS 解析、自家主題的唯讀表格呈現；
  多工作表頁籤、基本樣式（粗體／字色／底色／對齊／自動換行／字級）、數字格式、合併儲存格、
  欄寬列高、凍結窗格、欄字母與列號標頭；內嵌與 PDF 共用自製「Preview」頁籤機制。
- 樣式還原：SheetJS 只帶 fill，其餘樣式自 wb.Styles 配合直接掃描工作表 XML 的 xf 索引還原。
- 以 octetStream 取回（支援 Git LFS）；vendor 進 SheetJS Community（Apache-2.0）；
  Tampermonkey 版同步（@version 0.2.10）。

### 已知限制

- 僅 .xlsx；不支援圖片、圖表、樞紐分析、篩選（公式顯示快取值）；單表超過 60,000 格截斷並提示。

## [0.2.9] – 2026-11-05 — PDF 預覽改用專用的 Preview 頁籤

> 完整說明：[release-notes/v0.2.9.md](release-notes/v0.2.9.md)

### 行為變更

- PDF 的內嵌預覽改掛**自製的「Preview」頁籤**（ADO 的 PDF 檔案頁沒有 Preview 頁籤）：
  預覽只在這個頁籤顯示，Contents / History / Compare / Blame 正常切換、各自顯示原本的內容
  （修正先前預覽寄生在 Contents 下、切其他頁籤「沒有效果」的問題）；
  切到其他頁籤後再點回「Preview」，PDF 預覽還在。
- 合併 v0.2.7（PDF 預覽）與 v0.2.8（掛載點修正）一起發布。

## [0.2.8] – 2026-11-05（未單獨發布，併入 v0.2.9 一起發布）— 修正 PDF 預覽的掛載點

> 完整說明：[release-notes/v0.2.8.md](release-notes/v0.2.8.md)

### 修正

- 修正「PDF 預覽 (內嵌)」找不到掛載區塊的問題：實測 Azure DevOps 的 PDF 檔案頁後確認
  它沒有 Preview 頁籤與 `.markdown-preview-container` / `.files-hub-content-preview`，
  檔案內容區實際是 `.bolt-tabbar` 的兄弟節點 `div.page-content`；內嵌預覽改為直接取代它顯示。

## [0.2.7] – 2026-11-05（未單獨發布，併入 v0.2.9 一起發布）— 新增 PDF 預覽

> 完整說明：[release-notes/v0.2.7.md](release-notes/v0.2.7.md)

### 新功能

- **PDF 預覽 (內嵌) / PDF 預覽 (全螢幕)**：打開 `.pdf` 檔案時自動以 Chrome 內建的 PDF 檢視器在檔案頁內直接預覽，
  也可開 popup 視窗全螢幕檢視；自帶搜尋、縮圖、列印與表單功能。
- 以 Git Items API 二進位格式取回（支援 Git LFS）；不引入 PDF.js；Tampermonkey 版同步（`@version` 0.2.7）。

### 行為變更

- `.pdf` 檔案頁會出現兩顆「PDF 預覽」按鈕，並與 HTML / Markdown 一樣自動顯示內嵌預覽。
- PDF 的 iframe 不加 `sandbox`（實測 sandbox 會讓 Chrome 內建 PDF 檢視器載不起來）；
  PDF 由 PDFium 算繪、不執行 PDF 內嵌 JavaScript、也不是 HTML，HTML / Markdown 的 sandbox 隔離不變。
- 全螢幕 PDF 走 popup + blob URL，不經 `chrome.storage.session`（10 MB 配額放不下大 PDF）。

### 已知限制

- 預覽內的就地換頁不含 `.pdf`；PDF 連結仍開新分頁到 Azure DevOps 檔案頁。
- PDF 內嵌 JavaScript（表單計算等）不執行——Chrome 內建檢視器的既有行為。

## [0.2.6] – 2026-11-04 — 表格欄位可拖曳搬移，排序全面開放

> 完整說明：[release-notes/v0.2.6.md](release-notes/v0.2.6.md)

### 新功能

- **拖曳搬移欄位順序**：拖曳欄名即可左右搬移整欄（位移超過 4px 進入搬移模式，純點擊仍為排序），
  顯示插入位置標記，表頭與所有資料格隨欄移動；鍵盤可用 Alt/Ctrl+←/→ 在排序鈕上搬移，
  兩者皆以 aria-live 播報「已將 X 欄移至第 n 欄」。
- **「還原順序與欄寬」連欄順一起還原**：還原鈕同時復原列順序、欄位順序、aria-sort 與所有欄寬。

### 行為變更

- **排序不再設 5 列門檻**：2 列以上的簡單表格皆可排序（此前 2–4 列看不到排序控制項）。
- 排序鈕的滑鼠提示加上搬移說明。

### 已知限制

- 合併儲存格、多層表頭、多 tbody 或巢狀表格不支援排序與欄位搬移；表頭含連結／按鈕的欄位
  不加排序鈕但仍可拖曳搬移。

## [0.2.5] – 2026-11-04 — 新增 Makefile 開發指令

> 完整說明：[release-notes/v0.2.5.md](release-notes/v0.2.5.md)

### 新功能

- **`Makefile` 常用開發指令**：`make help` 列出所有指令——`make build`（打包上架 zip）、
  `make userscript`（同步 md 模組到 Tampermonkey 版）、`make lint`（JS 語法、shell 語法、JSON 驗證與
  商店描述 132 字元檢查）、`make install`（檢查 node / jq / zip）、`make clean`（移除 `dist/`）。

### 行為變更

- 無。這是開發工具的新增，擴充功能本身行為完全不變。

### 已知限制

- 專案目前沒有測試套件與 formatter，`make test` 與 `make fmt` 只會印出提示訊息。

## [0.2.4] – 2026-11-04（未單獨發布，併入 v0.2.5 一起發布）— 自適應版面＋hover 複製圖示

> 完整說明：[release-notes/v0.2.4.md](release-notes/v0.2.4.md)

### 新功能

- **依內容結構自動調整版面**：無標題長文改窄版閱讀欄、寬表文件放寬內容欄、多章節參考文件緊湊字級、CJK 自動行距字距。
- **標題裝飾**：`主標 — 副標` 拆兩行、`2.1` 章節編號徽章、H2 主題 Emoji 圖示（約 20 類關鍵字）、標題下顯示閱讀時間。
- **清單卡片化**：「標籤：內容」清單變兩欄屬性表、短清單變卡片（編號清單保留步驟圓牌）、粗體開頭的長編號重點變編號面板。
- **表格互動**：點欄名排序（遞增／遞減／還原三態＋無障礙播報）、12 列以上附篩選與列數、拖曳／方向鍵調整欄寬（雙擊還原）、
  一鍵「還原順序與欄寬」、寬表卡片內水平捲動＋「← 可左右捲動 →」提示、窄螢幕長文字表格堆疊成卡片。
- **狀態徽章**：表格儲存格開頭的 ✅ ⚠️ ❌ ※ 變成對應顏色的圓角徽章。
- **hover 複製圖示**：程式碼區塊右上角的複製圖示滑過淡入、點擊複製、成功變綠色勾號；觸控裝置半透明常駐；列印自動隱藏。

### 行為變更

- 原「複製」文字按鈕改為純圖示按鈕（保留鍵盤操作與螢幕閱讀器標籤）；表格欄名在可排序時變為按鈕、欄邊多了調整握把。
- 各項裝飾由內嵌腳本在載入後加上：停用 JavaScript 時維持原本的靜態版面。
- Tampermonkey 版同步（@version 0.2.5，與 manifest 一致）。

### 已知限制

- Emoji 圖示與徽章是視覺裝飾，不改變內容的查證／狀態語意。
- 合併儲存格、多層表頭、多個 tbody 或巢狀表格只有捲動與徽章，不套用排序、篩選與欄寬控制。

## [0.2.3] – 2026-11-04 — 預覽內的連結就地換頁，像真的在逛網站

> 完整說明：[release-notes/v0.2.3.md](release-notes/v0.2.3.md)

### 新功能

- **預覽內點擊連結不再開新分頁，直接在預覽中換頁**：HTML / Markdown 預覽裡指向 repo 文件的連結
  （`.html` / `.htm` / `.md` / `.markdown`，例如 `../docs/guide.md`）在目前的預覽區塊就地換頁，多頁網站與文件可以一頁頁逛下去。
- **瀏覽器「上一頁 / 前進」逐頁可用**：每次換頁都是一筆真的歷史紀錄，上一頁會回到上一份文件，前進亦然。
- **「← 上一頁」小圓鈕**：換過頁的文件左上角出現低調的圓形按鈕，全螢幕（popup）視窗沒有工具列也能回上一頁；
  它與瀏覽器上一頁走同一條歷史，不會多堆一筆紀錄。
- **跨文件的錨點連結**（`guide.md#installation`）換頁後自動捲到目標段落。
- 內嵌、全螢幕、HTML、Markdown 四種組合都支援；Tampermonkey 版同步（`@version` 0.2.3）。

### 行為變更

- 一般點擊 repo 文件連結＝就地換頁；**Ctrl / ⌘ / Shift 點擊與中鍵點擊**仍開新分頁（對應的 Azure DevOps 檔案頁），外部網址維持開新分頁。
- 往回走了幾頁之後再點連結，會以新頁取代前進歷史（與瀏覽器行為一致）。
- 換頁失敗（檔案不存在、抓取失敗）時顯示錯誤頁，上一頁仍可回到原本的文件。
- 預覽的載入機制由 `srcdoc` 改為 `blob:` URL 導覽（內容與渲染結果不變）：實測 `srcdoc` 反覆重設無法建立可用的歷史，
  上一頁只會重讀目前內容；改用 URL 導覽後上一頁才是真的回到上一份文件。全螢幕模式改用 `sandbox.html?nav=N` 導覽，機制相同。

### 已知限制

- 只有 `.html` / `.htm` / `.md` / `.markdown` 就地換頁；其他相對路徑（`.png`、`.pdf`…）仍開新分頁到 Azure DevOps 的檔案頁。
- 帶 query 的連結（`page.html?id=3`）只會換頁到該文件，query 不會傳遞。
- 全螢幕模式的換頁需要原本的 Azure DevOps 分頁還開著（與按需圖片同一限制）。
- Tampermonkey 全螢幕是 popup 視窗、沒有工具列：回上一頁請用「←」鈕或鍵盤快捷鍵。

## [0.2.2] – 2026-11-04（未單獨發布，併入 v0.2.3 一起發布）— 開啟檔案就自動顯示完整預覽

> 完整說明：[release-notes/v0.2.2.md](release-notes/v0.2.2.md)

### 新功能

- **開啟支援的檔案時自動啟用「完整預覽 (內嵌)」**：在 Azure Repos 打開 `.html` / `.htm` / `.md` / `.markdown`
  （或切換到另一個這類檔案、切換分支）時自動顯示內嵌預覽，不在 Preview 頁籤時自動切過去；HTML 與 Markdown 都適用。
- 兩顆按鈕維持不變，隨時可以重開預覽或改用「全螢幕」模式。

### 行為變更

- 自動預覽**每個檔案（含分支）只觸發一次**：手動切回 Contents 等頁籤後不會被強行拉回 Preview；
  Azure DevOps 重建預覽區塊而讓預覽消失時也不會自動重開，這兩種情況按一下「完整預覽 (內嵌)」即可。
- 網址的 `_a` 參數指向 History / Blame / Commit / Diff 等頁籤時不會自動預覽（不搶走焦點）；
  `_a` 為 `contents`、`preview` 或沒有 `_a` 時視為「打開檔案」，照樣自動顯示。
- 版本選擇器還沒載入、分支尚未確定時不會提前自動預覽（避免抓錯分支的檔案）；確定後才顯示。
- 自動預覽失敗只在瀏覽器 console 留下警告、不會自動重試，可用按鈕手動再試。
- PR、commit 資訊等 `/_git/{repo}/` 之後還有路徑段的頁面不再出現預覽按鈕（那些頁面沒有可取代的預覽區塊）。

### 已知限制

- 想看 Azure DevOps 原生的靜態預覽時，請切到 Contents 頁籤或暫時停用擴充功能。

## [0.2.1] – 2026-10-16 — 執行期才出現的圖片也能顯示

> 完整說明：[release-notes/v0.2.1.md](release-notes/v0.2.1.md)

### 修正

- **網頁用 JavaScript 動態產生的圖片顯示成破圖**：執行期才用 `innerHTML` / `.src` 產生的 `<img src="../x.png">`
  不在原始 HTML 的標籤裡，靜態掃描看不到，先前只剩破圖與 alt 文字。現在預覽文件會按需載入這些圖片。

### 新機制

- 預覽中出現 `src` 為相對路徑的 `<img>`（一開始就有、事後插入或事後改 `src`）時，等圖片捲到視窗附近（約 400px）
  才向擴充功能要圖，再透過 Git REST API 從同一個 repo、同一個分支抓回來；同一個路徑只抓一次並快取。
- 「內嵌」與「全螢幕」、HTML 與 Markdown 預覽都適用；全螢幕視窗由原本的 Azure DevOps 分頁代為抓圖。
- 順帶改善：全螢幕模式因資源總量超額而沒被內嵌的靜態圖片，現在也會在捲到時按需載入，不再是破圖。

### 安全

- 只服務圖片副檔名（png / jpg / jpeg / gif / svg / webp / ico / bmp），路徑限制在同一個 repo，其他請求一律拒絕。

### 已知限制

- 只處理 `<img src>`；`srcset`、`<picture>`、CSS 的 `url()` 背景圖與腳本自己 `fetch` 的檔案仍無法取得。
- 全螢幕視窗的圖片由來源分頁代抓，來源分頁關閉或重新整理後尚未載入的圖片會載入失敗。

## [0.2.0] – 2026-10-10 — 新增 Markdown 預覽

> 完整說明：[release-notes/v0.2.0.md](release-notes/v0.2.0.md)

### 新功能：Markdown 預覽

- 開啟 `.md` / `.markdown` 時按鈕變成 **Markdown 預覽 (內嵌 / 全螢幕)**，以自家排版主題取代 Azure DevOps 內建預覽：
  - 為中英混排設計的排版（系統字型堆疊、內文 16px / 行高 1.8、文章置中）。
  - 一眼可辨的標題層級：h1 墨線、h2 分隔線加主色粗條、h3 主色短線、h4 實心方塊、h5 空心方塊、h6 小字標籤。
  - 深淺色主題：初始跟隨 Azure DevOps 主題，預覽內可隨時切換。
  - 側邊目錄（捲動高亮、可收合）、標題錨點、文內 `[[_TOC_]]`。
  - 表格：表頭固定、淡斑馬紋、超寬表格水平捲動不撐破版面。
  - 程式碼：highlight.js 語法上色、語言標籤、一鍵複製。
  - mermaid 圖表（```` ```mermaid ```` 與 `::: mermaid`）：縮放工具列、Ctrl / ⌘ + 滾輪縮放、全螢幕檢視（拖曳平移、雙擊貼齊、Esc 關閉）、切換深淺色時重畫。
  - GitHub 風格提示區塊（`> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]`）、工作清單、刪除線、YAML front matter、`<kbd>`、換行視為 `<br>`。
  - repo 內相對路徑圖片經 Git REST API 抓回內嵌。

### 修正

- **內嵌預覽後切換檔案，Azure DevOps 顯示「An unexpected error has occurred within this region of the page」**：
  內嵌模式改為隱藏原本的預覽區塊、把 iframe 放在旁邊（不再替換 React 管理的節點）；
  切換檔案或分支時自動移除內嵌預覽並恢復原本的區塊（HTML 與 Markdown 皆適用）。

### 安全

- Markdown 內嵌的 HTML 先經 DOMPurify 消毒，再放進**沒有** `allow-same-origin` 的 sandbox 渲染。
- marked、DOMPurify、highlight.js、mermaid 全部打包在擴充功能內、不從 CDN 載入；mermaid 只在文件含圖時才載入。

### 行為變更

- 內嵌預覽只對目前這個檔案有效：切換到其他檔案時回到 Azure DevOps 內建預覽，需要再按一次按鈕。
- 預覽內相對路徑連結指向 `.md` 時，新分頁會直接開在 Preview 頁籤（先前只有 `.html` 會）。
- 擴充功能體積增加（mermaid 約 3.5 MB），mermaid 只在需要時讀取。

### 相容性

- 仍支援 Chrome 112 以上：mermaid 11 需要的 `URL.canParse` 由預覽文件補上 polyfill。

### 已知限制

- 不支援 Azure DevOps Wiki 專有擴充語法（工作項目連結、`@提及`、影片嵌入等）。
- `<video>`、`<audio>` 等不會內嵌。

## [0.1.1] – 2026-10-09 — 修正非預設分支的檔案預覽失敗

> 完整說明：[release-notes/v0.1.1.md](release-notes/v0.1.1.md)

### 修正

- **網址沒有 `version=` 時預覽失敗（HTTP 404）**：從檔案樹或分享連結開啟檔案時，Azure DevOps 顯示的是
  使用者上次瀏覽的分支、不一定是 repo 預設分支；先前會去抓預設分支而 404。現在改讀版本選擇器上顯示的分支，
  預覽內容與畫面上看到的一致；預覽內的相對路徑連結也會帶上同一個分支。
- **非英文介面在 Contents 等頁籤按「完整預覽 (內嵌)」失敗**：改用不隨語言變動的頁籤識別碼找 Preview 頁籤，
  任何顯示語言都能自動切換（先前用頁籤文字比對，中文介面會報「找不到 Preview 頁籤」）。
- **Git LFS 追蹤的檔案預覽錯誤**：先前抓到 LFS 指標檔而不是實際內容（畫面顯示指標文字、圖片破圖）；
  現在與 Azure DevOps 一樣取得 LFS 的實際檔案內容。

### 行為變更

- 網址有 `version=GB…` / `GT…` / `GC…` 時仍以網址為準；找不到版本選擇器時沿用舊行為抓預設分支。

## [0.1.0] – 2026-10-09 — 首次發布

> 完整說明：[release-notes/v0.1.0.md](release-notes/v0.1.0.md)

Azure DevOps 內建的 Preview 會把 HTML 放進受 CSP 限制的 iframe，`<script>` 全部不執行。
本擴充功能透過 Git REST API 取得原始檔、放進**隔離的 sandbox** 重新渲染：網頁腳本可以執行，但碰不到 Azure DevOps 的 cookie 或 session。

### 新功能

- **完整預覽 (內嵌)**：直接取代 Preview 頁籤裡的預覽區塊，以啟用 JavaScript 的方式顯示網頁；
  在 Contents / History 等頁籤會自動切到 Preview；iframe 高度填滿頁籤列以下的視窗並自動調整。
- **完整預覽 (全螢幕)**：開一個與目前視窗同位置、同尺寸的獨立視窗，在擴充功能自己的 sandbox 頁面中渲染；
  這個模式的 CSP 允許 `eval` / `new Function`，需要它們的函式庫（如 PDF.js）請用這個模式。
- **相對路徑資源內嵌**：預覽前透過 Git Items API 把同 repo 的 `<script src>`、`<link rel="stylesheet">`、`<img src>`
  抓回來內嵌（圖片以二進位格式抓取成 `data:` URL，不會損毀），多檔案組成的網頁也能正常顯示。
- **連結修正**：`#錨點` 正常跳轉；相對路徑在新分頁開啟 repo 內對應的檔案（HTML 直接開在 Preview 頁籤）；外部網址開新分頁。
- **支援分支、tag、commit**：網址的 `version=GB…` / `GT…` / `GC…` 一併帶入，預覽的就是你正在看的版本。
- **支援兩種網址格式**：`/{org}/{project}/_git/{repo}` 與省略專案段的 `/{org}/_git/{repo}`。
- 只在 `.html` / `.htm` 檔案頁顯示按鈕（SPA 切換檔案時自動出現或移除）；按鈕顯示「載入中…」，失敗時顯示原因可直接重試。

### 安全與隱私

- 內嵌 iframe 與 sandbox 頁都**不含** `allow-same-origin`：網頁腳本跑在 null origin，無法讀取 Azure DevOps 的 cookie / localStorage，也不能呼叫 API。
- 只注入 `https://dev.azure.com/*`，只向同一個 Azure DevOps 組織的 Git Items API 讀取正在看的檔案與其相對資源。
- 只要求 `storage` 權限（全螢幕模式以 `chrome.storage.session` 暫存 HTML）；不收集、不傳送任何資料到第三方。

### 已知限制

- 執行期才 `fetch` 的檔案（如 PDF.js 的 worker 與 `.pdf`）與 CSS 的 `url()` 不會內嵌。
- 每頁最多內嵌 60 個資源、單檔上限 8 MB；超過或失敗的資源保留原樣（標上 `data-inline-failed`）。
- HTML 若自己寫了 `<base href>`，尊重作者設定、不做相對路徑內嵌。
- 內嵌模式繼承 Azure DevOps 的 CSP（沒有 `unsafe-eval`），用到 `eval` / `new Function` 的函式庫請改用全螢幕模式。
- 只支援 `dev.azure.com`（不含 `*.visualstudio.com` 與 Azure DevOps Server）；介面文字目前只有繁體中文。

---

版本號定義於 `manifest.json`；每次修改程式或資源檔都必須把 patch 加 1，並新增對應的
`release-notes/v<version>.md`。推到 `main` 且版本號是新的（無對應 `v<version>` tag）就會自動建立 GitHub Release，
詳見 [docs/PUBLISHING.md](docs/PUBLISHING.md)。

[0.3.0]: release-notes/v0.3.0.md
[0.2.12]: release-notes/v0.2.12.md
[0.2.11]: release-notes/v0.2.11.md
[0.2.10]: release-notes/v0.2.10.md
[0.2.9]: release-notes/v0.2.9.md
[0.2.8]: release-notes/v0.2.8.md
[0.2.7]: release-notes/v0.2.7.md
[0.2.6]: release-notes/v0.2.6.md
[0.2.5]: release-notes/v0.2.5.md
[0.2.4]: release-notes/v0.2.4.md
[0.2.3]: release-notes/v0.2.3.md
[0.2.2]: release-notes/v0.2.2.md
[0.2.1]: release-notes/v0.2.1.md
[0.2.0]: release-notes/v0.2.0.md
[0.1.1]: release-notes/v0.1.1.md
[0.1.0]: release-notes/v0.1.0.md
