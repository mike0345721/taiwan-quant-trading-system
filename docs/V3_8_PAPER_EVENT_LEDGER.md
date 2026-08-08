# V3.8 盤中紙上事件帳本

這是開戶前即可使用的「只記錄、不下單」骨架。它不連券商、不保存帳密，也沒有任何網站或委託API。

## 記錄順序

每個候選機會只能走其中一條路：

```text
candidate（出現候選）→ trigger（紙上觸發）→ exit（紙上離場）→ outcome（收盤檢討）
                    ↘ cancel（條件失效，未進場）
```

事件只能新增，不能修改舊行。每行都保存：

- 凍結規格SHA-256與成本假設SHA-256。
- 前一行雜湊與本行雜湊，形成防竄改鏈。
- 交易日、期貨契約、日／夜盤、5分鐘回放游標與虛擬時間。
- 官方來源與稽核雜湊、資料可見截止時間。
- 紙上進出價格；結果事件由可見K棒自動計算成本後點數、MAE、MFE與淨R。
- `researchOnly=true`及`executionAuthorized=false`。

## 安全閘門

系統會拒絕：

- mock或非官方回放資料。
- 沒有通過盤中資料稽核的交易日。
- 虛擬時間不是目前回放游標的最後一根K棒。
- 虛擬時間晚於電腦目前時間。
- 日盤／夜盤、日期或契約與官方檔案不一致。
- 任一`executionAuthorized=true`事件。
- 不合法順序，例如沒有candidate就直接trigger，或outcome後再追加事件。
- 不符合[V3_8_0_FROZEN_INTRADAY_PROTOCOL.md](../V3_8_0_FROZEN_INTRADAY_PROTOCOL.md)的30／60／120分鐘持有上限、1R停損、1.5R目標或進場規則。

## 目前成本假設

尚未確認券商書面費率前，以指數點同時保存來回4／8／16點三種情境，8點為主要帳面結果。這只是凍結研究假設，不是真實報價。開戶後若費率不同，必須建立新規格版本，不能回頭改舊帳本。

事件遵守完整5分鐘K棒收盤確認，下一根K棒開盤才算紙上進場；同一根K棒若停損與目標都碰到，保守記為停損先到；事件不得跨越日／夜盤。

## 開發者操作

先準備一個事件JSON，內容包含`eventType`、`candidateId`、`tradeDate`、`contract`、`session`、`cursor`及`virtualTime`，並依事件種類補上條件或價格。接著執行：

```text
npm run paper:event:append -- --input <event.json>
npm run paper:event:audit
```

帳本保存在`data/forward/v3.8-paper-events.jsonl`，已排除於Git提交。稽核報告保存在同一資料夾。這兩個指令都只操作本機檔案，不會送出委託。

目前只完成工程骨架，尚未產生候選策略、尚未執行策略研究，也不得用這個帳本宣稱已有正期望值。
