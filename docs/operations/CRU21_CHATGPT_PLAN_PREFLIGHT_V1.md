# CRU-21｜ChatGPT 訂閱連線前置驗證 V1

## 交付層級與授權

2026-10-05 Owner 批准先驗證「既有訂閱授權 → 真實模型完成回覆 → 後續原面板顯示 → 用量來源」。本候選只完成前置的本機登入／權限／一次固定連線測試工具，不宣稱 Dashboard 內建 AI、V3 證據分析或 V4 異常偵測已交付。

Base：`4d8251686bdb4abbdb469bc00ae798717c0fd583`。無既有 production 檔案修改，沒有掛載到 `server.mjs` 或正式 public entry。CRU59 的既有正式 L5 未完成事實保留；此工具不是其替代驗收。

## 官方合約（核對日 2026-10-05）

- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions

採 locally hosted app 的 dynamic registration，不使用其他應用程式 client ID、Codex 登入檔或 ChatGPT 私有 backend-api。OpenAI 官方 OAuth 登入與使用方案同意由 Owner 本人完成；工具不代填密碼／MFA或代按同意。

## 執行與操作

在此 exact candidate worktree 執行：

```powershell
node scripts/start-chatgpt-plan-preflight.mjs
```

工具只綁 `127.0.0.1:18721`，衝突時退出，不關閉任何既有程序。先獨占連接埠，再初始化受保護儲存區；不接觸 8787、8790 或 8791。正常瀏覽器開啟一次性、短效的本機啟動連結；能力值僅交本機瀏覽器，控制台不印出。入口存在 30 分鐘；不加入 Windows startup 或 Task Scheduler。

Owner 必須在 MSI 上的系統瀏覽器（可透過自己的遠端桌面）完成，而不是在另一支手機瀏覽器開 loopback callback。

1. 於設定頁點 **Continue with ChatGPT**，在 `auth.openai.com` 登入、選擇工作區及授權使用方案。
2. 回到設定頁。確認 ChatGPT 設定的 Apps 額外 credits 未允許，再勾選相應確認；工具無權自動讀取或稽核這個帳務開關。
3. 手動取得模型目錄，選擇實際回傳的模型，再點一次連線測試。每次入口最多接受一次 inference attempt，沒有自動重試／升級／API Key fallback。

測試只傳簡短固定句，不傳行情、raw、SQLite或交易資料。收到 `response.completed` 且回覆非空才為連線成功；取得 ID token、scope 或模型目錄都不等於推理完成。之後才接同一 Dashboard 的受控快照與原頁回答。

## 安全與資料流

- 隨機 state／nonce／PKCE-S256，每次 OAuth attempt 10 分鐘，綁本機 HttpOnly/SameSite=Lax setup session；檢查 callback、state、issued client ID、重放及重複參數。
- RS256/JWKS 簽章、issuer、audience、azp、expiry、nonce、verified subject 檢查；返回帳號不得替換成另一 subject。僅依 token response 的 granted scopes 判定 plan permission。
- 各 registration 依 issuer/client_id/subject 分離，即使 email 相同也不共用；重新授權重用已發行 client ID。這版保留 ID token，但不把它放入前端登入 hints。
- 憑證檔 `%LOCALAPPDATA%\TaiwanQuantDashboard\ChatGPTPlan\siwc-v1.dpapi` 使用 Windows DPAPI CurrentUser，目錄 ACL 限目前使用者／SYSTEM；保護後原子更新，不在 repo、browser JSON 或 log 傳出 tokens。穩定 host ID 一併保留。
- 本機 setup session/CSRF 與正式登入完全獨立；精確 Host/Origin、回圈位址、CSP、no-store、no-referrer、拒絕 proxy forwarding。Browser 僅收到清理過的狀態、帳號辨識 label、模型目錄和測試文字；textContent 顯示模型內容。
- API 固定 `https://api.openai.com/v1/models`、`/v1/responses`。OAuth bearer、`store:false`、`stream:true`；不用不支援的 max_output_tokens、temperature、background 或私有端點。
- 模型 HTTP timeout 60 秒、讀取上限 1MiB、測試可見文字上限 8192 字元；這些是本機執行界限，**不是供應商計費或生成 token 的硬上限**。
- 401/403/429、失敗／不完整／中斷串流明確結束，不自動改走付費 API。是否允許額外 credits 仍以 Owner 官方設定為準，不假稱自動讀到訂閱剩餘量。

## 測試與本輪證據

```powershell
node --test tests/chatgpt-plan-auth.test.mjs tests/chatgpt-plan-setup.test.mjs tests/chatgpt-plan-store.test.mjs tests/ask-gpt-copy-focus.test.mjs tests/ask-gpt-feedback-layout.test.mjs
node scripts/scan-secrets.mjs
```

本輪 MSI：36/36 PASS、0 skip；其中 DPAPI 測試只用臨時目錄／動態產生的合成 token，並刪除自有 fixture。Linux CI 會如實 skip Windows DPAPI case，不能代替此 Windows 證據。

本機 `data/chatgpt-plan-preflight-tests/` 保存定向 TAP、UI-only Chrome 1536/720 寬度 bootstrap smoke 與截圖。UI 測試無 OpenAI login／inference，不能升格 entitlement 或原面板 L5。

最初 Host 負向測試使用 fetch 未有效送出指定 Host，改成原生 HTTP request 檢驗，不放寬伺服器檢查。初次秘密掃描抓到三份測試中的明文假 token；改為 runtime 隨機 fixture，未修改 scanner 或新增例外。最終掃描通過。

## 接續 gate 與限制

本階段沒有 unattended refresh、遠端 revoke、正式多使用者服務、原 Dashboard 整合或模型自動分流。access token 到期只允許本人重新授權；停止 setup 不等於撤銷官方 grant，須在 ChatGPT 設定移除連線。這些限制不得被包裝成完整長期執行 adapter。

下一步先取得真實 Owner authorization／scope／catalog／completed probe，再於同一主線候選整合原面板問答、錯誤狀態、受控快照、模型路由與正式負向測試。Merge／formal rollout 仍需 exact Owner gate，未啟動額外付費服務。

`formalWeight=0 / researchOnly=true / executionAuthorized=false / orderRoutesEnabled=false`。本階段不讀寫市場資料、不啟 CVD、不改 scheduler，也不改既有未驗證研究的權重。
