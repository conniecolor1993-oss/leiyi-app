# 雷翼公司APP（公司後勤 APP）

左側目錄、右側操作的桌面程式。這是一個**空的櫃子**：架構固定，資料依照架構放進去。
任何公司都能用：公司名稱、統編、人員、事業線、會計科目、各種門檻都在「設定」裡改，程式裡沒有寫死任何公司的資料。

## 安裝與使用（Windows）
- `dist/雷翼公司APP 1.0.0.exe`：免安裝版，雙擊就能開
- 第一次開會出現「Windows 已保護您的電腦」：點「其他資訊」→「仍要執行」（程式沒有付費簽章，屬正常現象）
- 第一次開啟時填公司名稱即可開始
- 資料存在：`%APPDATA%\雷翼公司APP\leiyi-data.json`（每次存檔會保留上一版 `.bak`）
- 換電腦或給別人：在「設定 → 資料與備份」匯出備份，到另一台匯入

> 目前是**本機版**：每台電腦各自存資料。線上同步（接 Notion）是下一階段，只要新增一個資料轉接器，畫面不用改。

## 連線 Notion（正本放 Notion）

1. 到 https://www.notion.so/profile/integrations 按「新增整合」，類型選「內部」，名稱填「雷翼APP」，權限勾讀取、更新、插入內容，複製 `ntn_` 開頭的金鑰。
2. 在 Notion 打開要同步的頁面（例如後勤中心總頁、工作任務總表、人脈表），右上角「⋯ → 連線」把「雷翼APP」加進去。總頁加了，底下的資料表都會一起分享。
3. APP「設定 → Notion 同步」貼上金鑰按「連線測試」，確認自動配對好的資料表，選要不要把本機已有資料上傳，按「開始同步」。

- 開啟時、每 5 分鐘、按「立即同步」都會從 Notion 拉最新資料；在 APP 改的東西約 1.5 秒內上傳。
- 沒網路時照常使用，左下角顯示「離線」，連上後自動補傳。
- Notion 沒有的欄位只存在這台電腦；Notion 的「人員」欄位要到 Notion 改。
- Notion 拒絕的資料會列在「同步問題」，不會卡住其他資料。
- 金鑰加密存在這台電腦，不會出現在備份檔。中斷連線後改回只存本機，資料保留。

## 給開發者：架構

同步程式在 `app/sync.js`；Notion 呼叫只經過 `main.js` 的 `notion:request`（只允許 users/me、search、pages、data_sources）。測試：`node tests/unit.test.js`、`python3 tests/e2e.py`、`python3 tests/e2e_regression.py`、`xvfb-run -a node tests/sync_e2e.js`（用 `tests/mock_notion.js` 假 Notion）。

```
main.js        桌面主程式：開視窗、安全讀寫資料檔（先寫暫存再改名＋保留 .bak）、匯出
preload.js     只開放 4 個通道給畫面：load / save / dataPath / exportFile
app/
  schema.js    櫃子本身：左側目錄、每個格子的欄位、下拉選項、計算公式、預設設定
  store.js     資料層：固定介面 load/save/list/get/upsert/archive；目前 LocalAdapter，之後加 NotionAdapter
  flows.js     資料通道：模組之間互相應用只走這裡（分派、建立評估、轉專案、衍生專案、帳務待確認）
  app.js       畫面：通用清單／表單、首頁總覽、營業稅整理、設定
  styles.css   樣式
tests/
  unit.test.js 計算規則與架構一致性（node tests/unit.test.js）
  e2e.py       端對端測試：逐一操作每個格子與每條通道
```

### 資料通道（模組之間怎麼互通）
| 通道 | 起點 | 結果 |
| --- | --- | --- |
| 分派 | 收件匣（選「分派至」） | 在目標格子建一筆，兩邊互相連結，收件匣標完成 |
| 建立評估 | 想法池 | 建評估並連結；評估填了結論，想法自動標「已評估」 |
| 轉成專案 | 評估（結論＝做） | 建專案並連結，評估標完成 |
| 建立衍生專案 | 會議紀錄 | 建專案，決議第一行當「下一步」 |
| 帳務確認 | 帳務（收入，或超過門檻的支出） | 自動建「待確認」L3；在待確認選同意 → 帳務自動「已確認」；帳務直接勾已確認或封存 → 待確認自動關閉 |
| 彙總 | 帳務關聯專案 | 專案自動算收入合計、支出合計、毛利（只算公司） |

所有新增、修改、封存都自動寫入「處理紀錄」。資料不會被刪除，只會封存。

### 想加一個欄位或格子
只改 `app/schema.js`：在模組的 `fields` 加一行，例如
`{ key: '付款期限', type: 'date', list: true }`。畫面、表單、篩選會自動長出來。
欄位類型：text、longtext、select、date、number、money、checkbox、relation、url、link、formula、rollup。

### 開發與打包
```bash
npm install
npm start               # 開發模式開啟
npm test                # 單元測試
npm run dist:win        # 在 Windows 打包（安裝版＋免安裝版）
npm run dist:mac        # 在 Mac 打包 .dmg
```
端對端測試：在 `app/` 啟動 `python3 -m http.server 8765`，再執行 `python3 tests/e2e.py`（需要 Playwright）。

### 給另一間公司用
1. 直接用同一個程式，第一次開啟填新公司名稱即可
2. 若要改程式名稱：改 `package.json` 的 `productName`、`build.productName`，以及 `main.js` 與 `app/index.html` 的標題，再重新打包
