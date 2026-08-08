# V1 驗證紀錄

已在 Node.js 22 執行：

- 所有 `.mjs` 與前端 JavaScript 語法檢查通過。
- `npm test`：4 項測試通過。
- `npm run security:scan`：未發現常見硬編碼秘密。
- MOCK 模式服務啟動成功。
- `/healthz` 回傳正常。
- 未登入存取 `/api/v1/dashboard` 回傳 HTTP 401。
- 登入後可讀取面板資料。
- CSRF 驗證後可手動更新。
- API 明確回報 `readOnly: true`、`brokerConnected: false`。

## 尚未完成的外部驗證

執行環境沒有對外 DNS，因此未能在此環境實際連線測試 TWSE、TAIFEX、TPEx 與 Yahoo 回應。正式資料模式已依原 CubeLV 程式所使用的欄位與端點重寫，部署後仍需進行一次來源逐項驗收。

## 股票即時行情可靠性驗收

執行：

```text
npm run live:event:audit
```

驗收報告位於`data/live-events/audits/`。`latest.json`只代表最新單日運行稽核，
`acceptance.json`代表已完成且會重新驗證來源ledger的持久化里程碑驗收。
較短的新單日樣本不會覆蓋既有PASS；若PASS來源ledger完整性或條件重新驗證失敗，
持久化驗收必須失效。正式通過至少需要：

- 同時收到IX0001與2330。
- 每個商品至少100筆事件。
- 連續觀察至少30分鐘。
- 重複率不超過1%。
- 沒有序號缺口、超過5秒的時鐘偏差或事件亂序。
- 任兩筆事件間沒有超過5分鐘的疑似斷線空窗。
- 至少完成一次受控橋接重啟，並留下停止／斷線後重新訂閱成功的生命週期證據。
- append-only雜湊鏈完整，且維持`executionAuthorized=false`。

這些門檻只代表資料管線可供研究，不代表策略有效，也不授權交易。非交易時段的`stale`不應單獨解讀為行情服務故障。

## V3.9.7 離線 CURRENT 驗證

```text
npm run paper:event:offline-validate
npm run paper:event:audit
npm run live:event:audit
npm run current:audit
npm test
npm test --prefix v2
npm run security:scan
```

- Paper離線驗證只使用已通過audit的官方歷史replay，且不得修改正式Paper ledger。
- `data/readiness/latest.json`是證據門檻，不是開始NEXT或FUTURE的授權。
- Shioaji health的`dropped`與`writerErrors`必須為0；callback只排隊，不寫磁碟。
- 交易時段另驗證IX0001與2330至少30分鐘連續性，以及受控重啟後重新訂閱。
