# Render Migration Plan for `as84089443/openclaw-office`

這份文件是把 `OpenClaw Office` 的部署 ownership 從舊的外部來源收斂到 `as84089443` 的實作清單。

## 目標

- Git 主線以 `as84089443/openclaw-office` 為唯一來源。
- Render 新服務由 `as84089443` 旗下 workspace 建立。
- 在新服務完全驗證前，不搶走既有 `copilot.bw-space.com`。
- 切網域時保留 rollback 路。

## 已完成

- 本機 repo `origin` 已切到 `as84089443/openclaw-office`
- 最新主線已推到：
  - `https://github.com/as84089443/openclaw-office`
- 遷移專用 Blueprint 已建立：
  - [`render.as84089443.yaml`](/Users/brian/.openclaw/openclaw-office/render.as84089443.yaml)
- 免費版 Blueprint 與替代排程已建立：
  - [`render.as84089443.hobby.yaml`](/Users/brian/.openclaw/openclaw-office/render.as84089443.hobby.yaml)
  - [`.github/workflows/merchant-copilot-pulse.yml`](/Users/brian/.openclaw/openclaw-office/.github/workflows/merchant-copilot-pulse.yml)
- upstream `wickedapp/openclaw-office` PR 已關閉，避免混淆

## 為什麼不用直接改舊服務

- 舊 GitHub repo owner 不是你，之後每次 deploy 都可能再卡一次權限。
- 舊 Render service 的 repo 綁定、domain、env 來源會繼續混在一起。
- 新建一組 service 最容易驗證，也最好回滾。

## 建議遷移順序

如果本輪先不升級付費方案，改走免費版路徑：

- 使用 [`render.as84089443.hobby.yaml`](/Users/brian/.openclaw/openclaw-office/render.as84089443.hobby.yaml)
- 不建立 Render worker
- 用 [`.github/workflows/merchant-copilot-pulse.yml`](/Users/brian/.openclaw/openclaw-office/.github/workflows/merchant-copilot-pulse.yml) 取代背景輪詢
- 詳見：[`docs/render-hobby-free-path.md`](/Users/brian/.openclaw/openclaw-office/docs/render-hobby-free-path.md)

### Phase 1: 建新服務，不綁正式網域

使用 [`render.as84089443.yaml`](/Users/brian/.openclaw/openclaw-office/render.as84089443.yaml) 建立：

- `bw-copilot-db`
- `bw-copilot-web`
- `bw-copilot-worker`

這份 blueprint 刻意不含 `domains:`，避免還沒驗證完就跟現役站衝突。

### Phase 2: 搬環境變數

先把下列 env 完整補到新 web / worker：

#### Web 必填

- `OPENCLAW_CONFIG_JSON`
- `OPENCLAW_OFFICE_CONFIG_JSON`
- `OPENCLAW_GATEWAY_URL`
- `OPENCLAW_OFFICE_DB_PATH`
- `FNB_PUBLIC_BASE_URL`
- `FNB_INTERNAL_API_TOKEN`
- `NEXT_PUBLIC_LINE_LIFF_ID`
- `NEXT_PUBLIC_FNB_LINE_LIFF_ID`
- `LINE_RICH_MENU_IMAGE_BASE64` 或對應 rich menu 檔案策略
- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `LINE_LOGIN_CHANNEL_ID`
- `LINE_LOGIN_CHANNEL_SECRET`
- `FNB_LINE_CHANNEL_ID`
- `FNB_LINE_CHANNEL_ACCESS_TOKEN`
- `FNB_LINE_CHANNEL_SECRET`
- `FNB_LINE_LOGIN_CHANNEL_ID`
- `FNB_LINE_LOGIN_CHANNEL_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

#### Worker 必填

- `FNB_PUBLIC_BASE_URL`
- `FNB_INTERNAL_API_TOKEN`
- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `FNB_LINE_CHANNEL_ID`
- `FNB_LINE_CHANNEL_ACCESS_TOKEN`
- `FNB_LINE_CHANNEL_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

### Phase 3: 先用 Render 預設網址驗證

正式切網域前，先在新服務的 Render 預設網址驗證：

- `/api/health`
- `/office`
- `/browser`
- merchant / ops 入口
- worker 正常跑
- LINE Login callback 沒壞

### Phase 4: 切正式 base URL

新服務驗證完，再把：

- `FNB_PUBLIC_BASE_URL`

改成正式值：

- `https://copilot.bw-space.com`

如果有 LINE / Google OAuth 白名單，也在這一刻同步確認 callback URL 指到新服務。

### Phase 5: 切 custom domain

把 `copilot.bw-space.com` 從舊服務移到新 `bw-copilot-web`。

切完後立刻驗證：

- `https://copilot.bw-space.com/api/health`
- `https://copilot.bw-space.com/office`
- `https://copilot.bw-space.com/browser`

### Phase 6: 觀察與回滾

保留舊服務短期存在，不要立刻刪除。

若新站異常，rollback 順序：

1. 把 custom domain 掛回舊服務
2. 把 `FNB_PUBLIC_BASE_URL` 指回舊站
3. 再處理新服務上的 env / callback 問題

## 驗證清單

- `as84089443/openclaw-office` 的 `master` 為唯一部署來源
- 新 Render web / worker / db 都建立成功
- 新服務可在 Render 預設網址正常打開 `/office` 與 `/browser`
- `FNB_PUBLIC_BASE_URL` 切換後，LINE / Google callback 正常
- `copilot.bw-space.com` 指到新服務後，健康檢查通過

## 目前的實際阻塞

- Git source of truth 已完成切換
- 真正還沒搬的是 Render 平台上的 service / env / domain ownership
- 若要完全自動化，需要可操作的 Render 帳號 session 與穩定的瀏覽器控制通道
