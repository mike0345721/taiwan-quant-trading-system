# 安全政策

## V1 的安全邊界

- **只讀**：沒有買進、賣出、撤單、平倉或券商 API 路由。
- **零前端秘密**：瀏覽器只收到整理後的市場資料與 CSRF Token；不會收到資料供應商或券商憑證。
- **預設私人**：服務預設只監聽 `127.0.0.1`，所有 `/api/v1/*` 均需登入。
- **密碼不明文保存**：使用 Node.js `scrypt` 產生的雜湊。
- **Session Cookie**：`HttpOnly`、`SameSite=Strict`，正式環境要求 `Secure`。
- **CSRF 防護**：所有狀態變更 POST 都需 `X-CSRF-Token`。
- **來源白名單**：伺服器只呼叫程式碼中固定列出的市場資料端點，不接受使用者輸入 URL。
- **安全標頭**：CSP、禁止 iframe、no-sniff、權限政策與 HSTS（HTTPS 時）。
- **錯誤降級**：上游失敗時可顯示前次快取，但必須標記為舊資料。

## 永遠不可提交到 GitHub

- `.env`
- 券商帳號、密碼、API Token
- 憑證檔（`.pfx`、`.p12`、私鑰）
- 資料庫正式帳密
- Session Cookie 或瀏覽器匯出的 Local Storage

如果秘密曾被提交，即使之後刪除，也應立即撤銷並重新產生，而不是只刪除檔案。

## 正式部署最低要求

1. 透過 HTTPS 反向代理或 Tailscale／VPN 存取。
2. `COOKIE_SECURE=1`。
3. 不直接將 8787 連接埠暴露到公網。
4. 主機與 GitHub 帳號啟用多因素驗證。
5. 定期執行 `npm run security:scan`。
6. V2 接資料庫後，使用只讀帳號供面板查詢。
# Shioaji credential protection (2026-07-23)

- Broker credentials are stored in `.shioaji.credentials.json` using Windows
  DPAPI CurrentUser protection.
- The legacy plaintext `.shioaji.env` file is removed after a verified
  migration.
- The dashboard process never receives broker credentials.
- The local quote bridge binds only to `127.0.0.1:8790` and exposes market data
  plus health status only.
- Order, cancel, position, balance, trade-event, and certificate routes are not
  implemented.
- Both credential files are excluded from Git.
- A future execution service must be a separate process with its own credentials,
  risk engine, audit log, and kill switch. It must not reuse this quote bridge.
