# CRU-55 當前連續觀測段 CVD V1

Owner scope: [PR73 comment 5826936270](https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5826936270), CRU-55 最新授權。基線 d8cd6cbace0714e2e5c206b784a07d8f06f722d4。

## 契約與資料路徑

既有原始帳本 → 原分類／連續性累加器 → FULL_PREFIX_BEFORE_PUBLICATION → immutable stream artifact → reader 驗 hash／binding → 唯讀 `buildActiveSegmentObservation` → 原認證 API／原總覽。

API additive 欄位 `activeSegmentObservation.schemaVersion=cru55-active-segment-observation-v1`。其 artifactHash 指向已驗原 artifact，不宣稱新欄位已寫入 frozen artifact。產製器、累加器、舊 sessionContext、原 artifact schema／bytes 不改；reader 每次回應才建立觀測欄位，API 不讀 raw。

合法 current 必須同一 generation／projection／cutoff，chart 與 relationship 的 identity、segment、current scalar 相等，segment origin 一致且未 terminalInvalid，trade lineage 可用且位於 origin 至 cutoff 之間。scalar 僅取 chart.currentCvd，絕不取歷史曲線最後點。值為 0 保留；未知、中斷 pending、無合法新 trade 保持 null。不同連續段不相加；新段沿用原累加器已認定的新 origin。正常 reader/process 重啟不建立新的觀測起點。

可顯示時 scope=`CURRENT_CONTINUOUS_OBSERVED_SEGMENT`；不可用時 scope=`UNAVAILABLE`，scalar／identity／origin／lastTrade 皆 null，仍保留 publication cutoff、原 reason 與品質。沒有完整盤別證據，故 sessionStartProven=false、captureCompleteness=UNPROVEN。

主卡明示「當前連續觀測段 CVD」、段與 origin 筆序、契約／交易日／盤別、cutoff、原始成交 clocks。數值資格、資料年齡／clock anomaly、六窗 ΔCVD 完整度與 Relationship 各自呈現。新契約不升 LIVE、不把 partial 升 READY。availableAt 早於 sourceTime 仍顯示時間順序異常，資料年齡不可用；合法段數值不因此被改寫。

stream API 缺失／錯誤綁定新欄位時主卡 fail closed，不 fallback 舊 context。既有非 stream 路徑維持原觀測主卡。Data Quality 同時揭露新欄位及舊 context reason，舊 context 的 SINGLE_SEGMENT_REQUIRED/null 保持原樣。

## 驗證範圍

針對單／同盤重連第二段／換盤第二段、pending、舊 context 不變、identity／origin／cutoff、錯誤 binding、未知／0、no-current、PARTIAL、clock anomaly、checkpoint resume 與 API reader restart 驗證。真資料 managed／登入／原頁結果另記 M4 驗收報告；M2 登入安全、三尺寸、恢復與效能成果沿用，不重開優化。此文件不是正式 runtime 啟用授權。

formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false。
