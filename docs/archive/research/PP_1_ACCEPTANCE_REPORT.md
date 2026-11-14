# PP-1 Acceptance Report

> 技術驗收日期：2026-08-01  
> 最終驗收 Run：`data/pp1-market-semantics/run-2026-08-01-v3`  
> 技術判定：**PASS**  
> Product Owner裁決：**APPROVE PP-1 CLOSEOUT**  
> 工作包狀態：**CLOSED**  
> 安全邊界：`formalWeight=0`、`researchOnly=true`、`executionAuthorized=false`

## 1. 實作結果

PP-1 已建立獨立的 Session／Trade Date／Contract 市場語意層，未改寫既有行情匯入器、Phase A 快照或 Frozen Forward Registry。

- `SessionContext`：明確保存日盤、夜盤、跨午夜、`calendarDate`、`tradeDate`與`sessionTradeDate`。
- Canonical Contract Identity：真實`contractCode`與角色分離；Shioaji `TXFR1`／`TXFR2`只保留為待解析Alias，不冒充真實契約。
- `ContractSelectionSet`：同一Session六種角色共用`selectionSetId`、`policySpecHash`及`policyVersion`。
- 結算語意拆分：`isSettlementTradeDate`、`isFinalTradingSessionForSelectedContract`、到期日及最後交易時間分開保存。
- Gap：同契約才能形成Raw Gap；跨契約為`ROLL_TRANSITION`；開盤與收盤品質依`OWNER_POLICY_V1`判定。
- Continuous Series：Unadjusted、Back-adjusted Points、Return-linked Index分開；非as-of的Back-adjusted資料不得進歷史模型。
- Timestamp Lineage：支援`LIVE`、`HISTORICAL_REPLAY`、`OFFICIAL_BATCH`，只要求各模式適用的時間欄位；`featureAvailableAt`取必要輸入合法可用時間的最大值。
- Legacy Adapter：舊5分鐘檔以純Adapter轉換，不覆寫舊檔。

## 2. Schema Migration／Rollback證據

- Migration：`v2/migrations/019_pp1_market_semantics.sql`
- Rollback：`v2/migrations/rollback/019_pp1_market_semantics.rollback.sql`
- 驗收方式：在隔離SQLite檔執行正向Migration與反向Migration。
- Rollback後：`schemaHash`、`logicalDataHash`、各表Row Count與各表Logical Hash均與Migration前一致。
- `physicalFileHash`另行保存，但本次為反向Migration，不要求SQLite實體頁面位元完全相同。
- 正式`v2/data/research-v2.sqlite`未被本次驗收修改。

## 3. Calendar／Contract Master與原始資料證據

- 觀察範圍：137個交易日、274個Session（日盤137、夜盤137）。
- 跨午夜Session：137。
- Contract Master：43個TX月契約，來源為既有TAIFEX官方批次日契約列；來源雜湊已保存。
- Announcement Overlay：觀察範圍內無另行套用例外；缺少官方資料時系統拒絕猜測。
- 已購買原始逐筆ZIP：116／116日完成重新掃描，共232個日／夜盤證據列。
- 日盤：116／116在Session起點具有`OPENING_AUCTION`旗標；closeAge最大1秒。
- 夜盤：116／116在Session起點具有`OPENING_AUCTION`旗標；closeAge p50=2秒、p95=5秒、p99=9秒、最大17秒。
- 其餘21日缺少同等原始開／收盤證據，Gap品質保持`UNAVAILABLE`，不得硬判PASS。

## 4. Replay／Idempotency證據

- PP-1市場語意與Migration測試：20／20 PASS。
- 連同既有TAIFEX匯入、付費資料、可恢復Runner與V2資料核心回歸：31／31 PASS。
- Legacy Adapter相同輸入重跑Hash一致，`duplicateWrites=0`。
- 最終Run以`--resume`再次執行後，11個Stage的Output Hash全部維持不變。
- 首次v1嘗試在P08因跨假日夜盤錯用「前一日曆日」而停止；失敗輸出保留且未覆寫。
- 修正後Session改以實際交易時間建立；最終v3 Run為P00～P10全部完成。

## 5. Phase A與Frozen Forward保護證據

### Phase A

- `currentRunId=full-historical-phase-a-v1-2026-07-30`
- Snapshot SHA-256：`b29abea925db6ea8958b4b98fcaee0acbfbbacc79a198325cd89e7b2c1245441`
- 已完成工作：2,011筆，全部Output Hash有效。
- 已完成產物Aggregate Hash在P00與P10均為：`95fcb700f5658ac70e057326bbe1afe2a8f57d24493e65a8ae20561205784d8c`
- Snapshot、Research Spec、Target Spec、Feature Spec、Random Seed與既有完成產物均零變更。

### Contract Policy Reconciliation Sidecar

- 獨立Sidecar標記12個契約敏感因子。
- 在目前可對齊範圍識別7個可能受新契約政策影響的交易日。
- Phase A原始值、品質結論與Promotion結果未覆寫。
- `changedFactorValues`保留為後續獨立、針對性Reconciliation工作，不在PP-1內重跑研究或擅改F1／F2／F3狀態。

### Frozen Forward

- P00與P10均為6個檔案。
- Aggregate Hash均為：`78f301ab48d3d7e7bc3ff51fc56c506351e899bcf706429bd01882cf5b32b356`
- Frozen Spec、Models與Registry零變更。

## 6. Acceptance Gate

| Gate | 結果 |
|---|---|
| 三種Lineage Mode正反測試 | PASS |
| Historical缺receivedTimestamp不誤判 | PASS |
| Live缺replayAvailableAt不誤判 | PASS |
| FIRST_LEGAL_TRADE超過60秒不形成Raw Gap | PASS |
| 同Session六角色共用Selection Set | PASS |
| 日／夜盤、跨午夜與結算語意分離 | PASS |
| Back-adjusted無as-of版本不得進模型 | PASS |
| Legacy Adapter deterministic／idempotent | PASS |
| Migration／Rollback Logical Hash | PASS |
| Phase A完成產物零變更 | PASS |
| Frozen Forward產物零變更 | PASS |
| 無Signal、Paper、下單路由 | PASS |
| `executionAuthorized=false` | PASS |

## 7. 安全降級與已知限制

- 既有官方日資料只有全日契約量，沒有「前一完整夜盤／當日完整日盤」的候選契約分Session成交量。因此實際P05快照中的流動性角色安全降級為`UNAVAILABLE`，`SELECTED_TRADING.tradeEligible=false`。
- 兩候選契約成交量齊全時的5%平手、沿用前Session及回退規則已有測試，但本次沒有用不相容的全日成交量冒充Session參考量。
- Contract Master的歷史最後交易時間證據來自既有官方批次契約列；超出已觀察範圍時必須取得新的版本化官方資料，不能只用星期規則猜測。
- 本次Technical PASS只證明市場語意、拒絕規則、重播與保護邊界成立，不代表T0、因子或策略具有Edge。

## 8. Scope Diff

本次新增：PP-1資料契約、隔離Migration、來源證據掃描、Session／Contract Adapter、Gap品質、Continuous Series、Legacy Adapter、可恢復P00～P10 Runner、Reconciliation Sidecar及Acceptance報告。

本次未新增：T0、H0／H1、Group State、Signal、Strategy、Risk Engine產品化、Paper Trading、Dashboard、CVD／Flow、Greeks／DEX／GEX、Broker委託或Automated Execution。

## 9. Closeout狀態

- `PP-1 Design=APPROVED`
- `PP-1 Implementation=PASS`
- `PP-1 Acceptance=PASS`
- `PP-1 Work Package=CLOSED`
- `pp1SemanticGate=PASS`
- `pp1ReplayGate=PASS`
- `pp1MigrationRollbackGate=PASS`
- `liquiditySelectionLogic=PASS`
- `liquiditySelectionCoverage=PARTIAL`
- `gapSemantics=PASS`
- `rawGapHistoricalCoverage=PARTIAL`
- `phaseAContractReconciliation=IDENTIFIED_NOT_EXECUTED`

Product Owner已於2026-08-01正式批准PP-1 Closeout。完整封存雜湊位於最終Run的
`CLOSEOUT_MANIFEST.json`。PP-1完成產物成為唯讀治理基準；資料覆蓋改善與契約敏感因子重算
必須另立工作包並取得明確授權。

下一個候選工作包只有`T0 DAY SESSION TECHNICAL BASELINE — SPEC FREEZE`，目前未啟動、未實作。
