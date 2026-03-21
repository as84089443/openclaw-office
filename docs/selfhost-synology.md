# Synology 自架部署

這份部署路徑是給 `openclaw-office` 在 Synology / 一般 Linux 主機上使用。

## 檔案

- Compose: [`docker-compose.selfhost.yml`](/Users/brian/.openclaw/openclaw-office/docker-compose.selfhost.yml)
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

## 啟動

```bash
docker-compose -f docker-compose.selfhost.yml up -d --build
```

## 驗證

```bash
curl -fsS http://127.0.0.1:4200/api/health
```

## 備註

- 第一輪先把 app 跑起來，不綁死平台。
- 公網入口可再接 Cloudflare Tunnel、Synology Reverse Proxy 或既有網域代理。
- 若之後要把 SQLite 升到 Postgres，可以只調整 env 與 compose，不必重改 app。
