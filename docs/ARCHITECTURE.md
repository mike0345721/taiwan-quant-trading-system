# V1 架構

```text
瀏覽器
  │ HTTPS + 密碼登入 + HttpOnly Session + CSRF
  ▼
Node.js 只讀面板服務
  ├─ 固定來源白名單抓取器
  ├─ 資料清洗與日期判斷
  ├─ 來源狀態／舊快取標記
  ├─ 透明籌碼評分（不下單）
  └─ 本機 JSON 快取（V1）
        │
        ├─ TWSE
        ├─ TAIFEX
        ├─ TPEx
        └─ Yahoo Finance
```

## 安全隔離

```text
V1 面板（本專案）              未來交易環境（V4 之後）
只讀市場資料                  策略引擎
沒有券商憑證                  → 獨立風控服務
沒有下單端點                  → 獨立訂單管理
不能修改風控                  → Secret Manager
                              → 券商 API
```

即使 V1 網站被突破，攻擊者也不應取得券商憑證或交易能力。

## V1 資料模型

每一來源都必須附帶：

- `ok`
- `source`
- `dataDate`
- `fetchedAt`
- `stale`
- `fallbackFromCache`
- `error`

這些欄位比單一數字更重要，避免把舊資料誤認為今天資料。

## 升級路線

- V1：私人只讀面板、JSON 快取、日資料與透明評分。
- V2.1：本機SQLite、歷史特徵骨架、品質檢查與策略版本。
- V2後期：資料量或同時寫入需求提高後，再評估遷移PostgreSQL。
- V3：分鐘行情、訊號通知、模擬交易。
- V4：獨立交易服務、Secret Manager、固定 IP、完整風控。
