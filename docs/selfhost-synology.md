# Synology 自架部署

這份部署路徑是給 `openclaw-office` 在 Synology / 一般 Linux 主機上使用。

## 檔案

- Compose: [`docker-compose.selfhost.yml`](/Users/brian/.openclaw/openclaw-office/docker-compose.selfhost.yml)
- Public tunnel compose: [`docker-compose.selfhost.public.yml`](/Users/brian/.openclaw/openclaw-office/docker-compose.selfhost.public.yml)
- Docker ignore: [`.dockerignore`](/Users/brian/.openclaw/openclaw-office/.dockerignore)

## 目標

- 使用單一 Docker service 先把 `openclaw-office` 跑起來
- 先用 SQLite 落地，避免第一輪同時引入 Postgres
- `runtime/` 內放主機專用 env 與 config，不進 image

## runtime 目錄

需要這些檔案：

- `runtime/.env.production`
- `runtime/openclaw.json`
- `runtime/openclaw-office.config.json`
- `runtime/openclaw-state/device.json`
- `runtime/openclaw-state/device-auth.json`
- `runtime/cloudflared/config.yml`
- `runtime/cloudflared/<tunnel-id>.json`

其中：

- `OPENCLAW_HOME=/app/runtime`
- `OPENCLAW_DIR=/app/runtime/openclaw-state`
- `OPENCLAW_OFFICE_CONFIG_PATH=/app/runtime/openclaw-office.config.json`

不要把 `OPENCLAW_CONFIG_JSON` / `OPENCLAW_OFFICE_CONFIG_JSON` 設成檔案路徑，因為這兩個環境變數會被當成原始 JSON 字串解析。

如果 live 站要接回真實 OpenClaw Gateway，即時互動不走降級模式，記得把本機 `~/.openclaw/identity/` 的：

- `device.json`
- `device-auth.json`

同步到 `runtime/openclaw-state/`。

## 啟動

```bash
docker-compose -f docker-compose.selfhost.yml up -d --build
```

若要把公網入口也一起放到同一台主機：

```bash
docker-compose \
  -f docker-compose.selfhost.yml \
  -f docker-compose.selfhost.public.yml \
  up -d --build
```

## 驗證

```bash
curl -fsS http://127.0.0.1:4200/api/health
```

若 Cloudflare Tunnel 也已啟動，可以再檢查：

```bash
docker logs --tail 50 openclaw-copilot-tunnel
```

### 正式入口

```bash
cd /volume1/docker/openclaw-office

# Host 正式上線
npm run selfhost:deploy:host

# NAS 正式上線（預設 skip public）
npm run selfhost:deploy:nas
```

正式對外只保留這兩條命令：

- `selfhost:deploy:*`：單節點部署入口
- `selfhost:deploy:sync*`：host + NAS 串接入口

內部腳本如 `selfhost-one-click.sh`、`selfhost-autopilot.sh`、`selfhost-auto-deploy.sh` 仍保留給部署鏈使用，但不再當主要操作入口。

正式入口會完成：

- runtime/env 檢查與建置
- 缺漏時補齊必要 runtime 檔（含 `openclaw.json`、`openclaw-office.config.json`、`device*`）
- 啟動服務（含 core + 可選 public）
- 驗證 `/api/health`
- 檢查維運容器是否正常

### 單機正式上線（推薦）

```bash
cd /volume1/docker/openclaw-office && OFFICE_PUBLIC_URL="https://copilot.bw-space.com" \
  OPENCLAW_RUNTIME_ENV="runtime/.env.production" \
  npm run selfhost:deploy:host
```

### 一條命令完成 host + NAS（推薦）

如果 NAS 目錄已掛載到主機（例如 `/volume1/docker/openclaw-office`），可直接執行：

```bash
cd /Users/brian/.openclaw/openclaw-office

export OPENCLAW_HOST_ROOT=/Users/brian/.openclaw/openclaw-office
export OPENCLAW_NAS_ROOT=/volume1/docker/openclaw-office

npm run selfhost:deploy:sync -- \
  --bootstrap-env runtime/bootstrap.env \
  --host-public-url https://copilot.bw-space.com \
  --git-sync
```

常用參數：

- `--skip-host`：只處理 NAS
- `--skip-nas`：只處理 Host
- `--dry-run`：先預覽每一步執行指令
- `--install-docker`：缺 docker 時自動安裝（預設僅在 host 腳本層級會用到）
- `--branch`：預設 `master`
- `--quiet`：只保留完成訊息，不輸出中間流程

預設行為是：

- host 先完成自動化部署（含公網入口）
- 再自動接著跑 NAS step（NAS 用 `--skip-public`）

### 真·零手動流程（推薦）

```bash
cd /volume1/docker/openclaw-office

# 先準備好 bootstrap env（可選）：把你要一次寫入 runtime 環境的變數放這裡
cat > runtime/bootstrap.env <<'EOF'
OFFICE_NAME=BW Copilot Office
OPENCLAW_GATEWAY_TOKEN=你的 token
FNB_INTERNAL_API_TOKEN=你的 token
EOF

# 一鍵完成：補齊 runtime 檔 + 可選安裝 docker + 一次性完整部署
npm run selfhost:deploy:host -- --bootstrap-env runtime/bootstrap.env

# 想每次都同步最新程式可改成
npm run selfhost:deploy:host -- --bootstrap-env runtime/bootstrap.env --git-sync

# 如果是 NAS 只想先跑主網關不出網路入口
npm run selfhost:deploy:nas -- --bootstrap-env runtime/bootstrap.env
```

`selfhost:deploy` 會做的事：

- 若路徑缺少 repo，會嘗試補上 git checkout
- 若 runtime 檔不足會自動補齊
- 可選 `--install-docker` 幫你補 docker
- 接上 `selfhost-auto-deploy` 的 host/nas 全流程
- 不需要手動 clone / copy / 設定 `runtime` 主要文件

常見做法：

- Host 正式：`npm run selfhost:deploy:host`
- NAS 首次：`npm run selfhost:deploy:nas`

腳本會幫你做三件事：

- 寫入/更新 `runtime/.env.production` 的 `FNB_PUBLIC_BASE_URL`
- 啟動 `docker-compose.selfhost.yml`
- 若 `runtime/cloudflared/config.yml` 與憑證檔存在，才會再啟動 `docker-compose.selfhost.public.yml`
- 驗證 `http://127.0.0.1:4200/api/health`
- 若公共入口已啟用，驗證公開 `/api/health`

若你目前先走 NAS 反代，不需要立即設定 Tunnel：

```bash
OPENCLAW_SKIP_PUBLIC=1 npm run selfhost:deploy:nas
```

若主機/NAS 沒有 Docker，啟用一次自動安裝：

```bash
cd /volume1/docker/openclaw-office
OPENCLAW_AUTO_INSTALL_DOCKER=1 npm run selfhost:deploy:host
```

全流程靜默執行：

```bash
cd /Users/brian/.openclaw/openclaw-office
export OPENCLAW_HOST_ROOT=/Users/brian/.openclaw/openclaw-office
export OPENCLAW_NAS_ROOT=/volume1/docker/openclaw-office

npm run selfhost:deploy:sync:quiet -- --bootstrap-env runtime/bootstrap.env --host-public-url https://copilot.bw-space.com
```


### 自主維運常見問題

- `openclaw-maintenance` 沒有自動備份：先檢查是否可執行 `docker exec openclaw-maintenance /app/scripts/selfhost-backup.sh`，並確認 `DOCKER_BIN`/`DOCKER_COMPOSE_BIN` 環境變數是否正確。
- 首次 deploy 看到容器重啟循環：多半是 `runtime/` 環境變數缺失，先看 `docker logs openclaw-office` 再依 `.env.production` 補齊參數。
- Cloudflare tunnel 無法建立：先查 `docker logs --tail 100 openclaw-copilot-tunnel`，再確認 `runtime/cloudflared` 的憑證與 ingress 是否一致。
- 自動更新沒生效：若手動 pull 仍不動，先暫停維運容器、手動跑 `docker-compose -f docker-compose.selfhost.yml -f docker-compose.selfhost.public.yml up -d --build`，再確認遠端分支權限與憑證是否到位。

### 備援

- 一鍵回退流程：
  - 保留上個版本快照：`find /app/backups -maxdepth 1 -type f -name 'openclaw-office-*.tgz' | tail -n 5`
  - 還原時先停止服務、解壓最新快照到新目錄，再以 `docker-compose ... up -d --build` 重建。

### 還原（主機/NAS）

```bash
cd /volume1/docker/openclaw-office
./scripts/selfhost-restore.sh --latest --yes

# 還原指定檔（需 --yes 才會跳過互動）
./scripts/selfhost-restore.sh --file /volume1/docker/openclaw-office-backups/openclaw-office-20260321-020000.tgz --yes

# 還原後不重啟服務（僅改資料）
./scripts/selfhost-restore.sh --latest --yes --no-restart
```

### 通知告警（可選）

維運腳本可直接推播異常到 webhook / Telegram：

```bash
export ALERT_WEBHOOK_URL="<你的 Discord webhook / 通用 webhook>"
export ALERT_TELEGRAM_BOT_TOKEN="<你的 telegram bot token>"
export ALERT_TELEGRAM_CHAT_ID="<chat id>"
export ALERT_THROTTLE_SECONDS=900
export ALERT_ON_FAILURE=1
```

可在 `docker-compose.selfhost.public.yml` 裡設定對應環境變數（建議只在你接受告警的節點啟用）。

## 備註

- 第一輪先把 app 跑起來，不綁死平台。
- 公網入口可接 Cloudflare Tunnel、Synology Reverse Proxy 或既有網域代理。
- 若使用 Cloudflare Tunnel，建議把 `copilot` 入口做成獨立 tunnel，避免和其他本機服務共用同一條 ingress 設定。
- 若之後要把 SQLite 升到 Postgres，可以只調整 env 與 compose，不必重改 app。
- 若要長期維運，建議再搭配每日備份與保守自動更新腳本。
- `docker-compose.selfhost.yml` 已內建 `openclaw-maintenance` 常駐容器，會每天自動執行：
  - `02:30` `selfhost-backup.sh`
  - `03:00` `selfhost-update.sh`
- 任務若執行失敗，該日不會留下標記，會在下個輪詢時間繼續重試，避免單次失敗就錯過維護窗口。
- 可透過環境變數調整：
  - `BACKUP_DIR`: 備份輸出目錄
  - `BRANCH`: 更新來源分支
  - `APP_CONTAINER_NAME`: openclaw 主服務容器名，預設 `openclaw-office`
  - `APP_DIR`: openclaw 專案目錄，預設為本腳本所在目錄的父層
- `DOCKER_COMPOSE_BIN`: docker compose 命令，預設 `/usr/local/bin/docker-compose`
- `DOCKER_BIN`: docker 執行檔路徑（預設 `docker`）
- `OPENCLAW_SKIP_PUBLIC`: `1` 時所有維運動作（更新/還原）不會嘗試啟動 public compose
- `OPENCLAW_RUNTIME_CLOUDFLARE_DIR`: Tunnel 檔案目錄，預設 `./runtime/cloudflared`
- `LOOP_INTERVAL_SECONDS`: 輪詢間隔（秒）
  - `ALERT_WEBHOOK_URL`: 有值時發出告警 webhook（Discord webhook 也可）
  - `ALERT_TELEGRAM_BOT_TOKEN` / `ALERT_TELEGRAM_CHAT_ID`: telegram 告警
  - `ALERT_ON_FAILURE`: 異常告警開關（`1` 開 / `0` 關，預設 `1`）
  - `ALERT_ON_SUCCESS`: 成功事件告警開關（預設 `0`）
  - `ALERT_THROTTLE_SECONDS`: 同類告警最小間隔（秒，預設 `900`）
  - `RUN_ONCE`: 設為 `1` 可讓維運腳本只跑一輪，不進入無窮迴圈（適合手動演練）
  - `RUN_ONCE_TASKS`: 手動輪次要跑哪些任務，用逗號串列，例如 `backup,update`（預設兩者都跑）
