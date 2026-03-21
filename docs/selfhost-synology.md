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
- `runtime/cloudflared/config.yml`
- `runtime/cloudflared/<tunnel-id>.json`

其中：

- `OPENCLAW_HOME=/app/runtime`
- `OPENCLAW_OFFICE_CONFIG_PATH=/app/runtime/openclaw-office.config.json`

不要把 `OPENCLAW_CONFIG_JSON` / `OPENCLAW_OFFICE_CONFIG_JSON` 設成檔案路徑，因為這兩個環境變數會被當成原始 JSON 字串解析。

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

## 備註

- 第一輪先把 app 跑起來，不綁死平台。
- 公網入口可接 Cloudflare Tunnel、Synology Reverse Proxy 或既有網域代理。
- 若使用 Cloudflare Tunnel，建議把 `copilot` 入口做成獨立 tunnel，避免和其他本機服務共用同一條 ingress 設定。
- 若之後要把 SQLite 升到 Postgres，可以只調整 env 與 compose，不必重改 app。
