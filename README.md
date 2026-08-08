# 台股籌碼面板 V1（安全獨立版）

這是從 CubeLV 原型分離出的第一個正式版本。它刻意只做一件事：

> **安全地整理台股、台指期與選擇權籌碼資料，形成可追蹤的研究面板。**

V1 **不連接券商、不提供下單、不保存券商憑證**。

## Windows 新手快速啟動

1. 安裝 Node.js 20 以上 LTS。
2. 雙擊 `1_SETUP.bat` 設定登入密碼。
3. 雙擊 `OPEN_DASHBOARD.bat`，它會在需要時背景啟動服務並開啟瀏覽器。
4. 瀏覽器開啟 `http://127.0.0.1:8787`，輸入剛設定的密碼。

若希望之後只開桌面捷徑或瀏覽器書籤：

1. 雙擊一次 `10_INSTALL_AUTO_START.bat`。
2. Windows登入後會自動啟動本機面板。
3. 週一至週五08:30自動補齊前一交易日官方資料。
4. 桌面會出現 `Taiwan Stock Dashboard` 一鍵捷徑。
5. 如需取消，雙擊 `11_REMOVE_AUTO_START.bat`。

`2_START.bat`仍保留作為顯示啟動錯誤的故障排除工具。

也可閱讀 `0_READ_ME_FIRST.txt`。

## 已完成

- 私人登入與登入嘗試限制
- `scrypt` 密碼雜湊
- HttpOnly／SameSite Session Cookie
- CSRF 防護
- 前端零秘密
- 所有市場資料由後端統一抓取
- 固定上游來源白名單與請求逾時
- TWSE 三大法人，並拆開自營商自行與避險
- TAIFEX 期貨行情、法人部位與大額交易人
- TXO 依到期契約分組，不混加週選與月選
- OI Put／Call Ratio、Call／Put OI 牆與 Max Pain
- 上市／上櫃市場寬度
- 融資融券、美元／台幣與 VIX
- 每一來源的資料日期、抓取時間、失敗與舊快取狀態
- 透明籌碼分數與「等待／觀察觸發」狀態
- 本機 JSON 快取與最多 400 日歷史檔案
- Docker 安全預設與秘密掃描腳本

## 本機啟動

需要 Node.js 20 以上。

```bash
cd standalone-v1
cp .env.example .env
npm run password:hash -- "請換成至少12字元的高強度密碼"
```

將輸出的完整字串放到 `.env`：

```dotenv
DASHBOARD_PASSWORD_HASH=scrypt-v1$...
COOKIE_SECURE=0
MOCK_DATA=1
```

載入環境變數並啟動：

```bash
set -a
source .env
set +a
npm start
```

瀏覽：`http://127.0.0.1:8787`

初次測試建議 `MOCK_DATA=1`；確認介面與登入正常後，再改成 `MOCK_DATA=0` 讀取正式來源。

## Docker 啟動

```bash
cp .env.example .env
# 設定 DASHBOARD_PASSWORD_HASH，並保留 COOKIE_SECURE=1 給 HTTPS 正式環境
docker compose up -d --build
```

Compose 只綁定 `127.0.0.1:8787`。正式遠端使用應透過 HTTPS 反向代理、Tailscale 或 VPN，不要直接暴露連接埠。

## 驗證

```bash
npm test
npm run security:scan
```

## 重要限制

- V1 的籌碼分數是透明規則，不是已證明有正期望值的策略。
- 官方資料發布時間不同，假日或尚未公布時會顯示最近資料並標記為舊資料。
- Yahoo 資料適合作為面板背景資訊；正式量化與實單階段應評估授權行情來源。
- V1 使用 JSON 快取；V2目前使用本機SQLite研究資料庫與不可覆寫的原始快照。只有在資料頻率、規模或部署需求明顯增加時，才依正式決策重新評估PostgreSQL。

詳見 [`SECURITY.md`](SECURITY.md) 與 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 專案交接與進度

Codex或開發者開始一般維護時，只讀最小集合：

1. [`AGENTS.md`](AGENTS.md)
2. [`ROADMAP.md`](ROADMAP.md)
3. [`CURRENT_STATUS.md`](CURRENT_STATUS.md)
4. [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md)

再依任務選讀專項規格。`NEXT_TASKS.md`只作歷史索引；`DECISIONS.md`與`CHANGELOG.md`應依主題搜尋，不應在一般任務中全文載入。欄位定義見[`DATA_DICTIONARY.md`](DATA_DICTIONARY.md)，驗收規則見[`VALIDATION_CHECKLIST.md`](VALIDATION_CHECKLIST.md)，詳細路由見[`docs/WORKFLOW.md`](docs/WORKFLOW.md)。
