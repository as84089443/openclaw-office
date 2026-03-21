# Render 免費版部署路徑

這份文件是給 `as84089443/openclaw-office` 的「不升級 Professional / Starter 先上線」版本。

## 結論

- `Projects` 不是主要付費阻塞。
- 真正會把目前藍圖推到付費的是 `worker`。
- 免費版可先用：
  - 1 個 free web service
  - 1 個 free Postgres
  - GitHub Actions 定時 pulse 取代 Render worker

## 官方限制與影響

- Render 官方的 `Free instance type` 只適用於 `web service`、`static site` 和 `Postgres / Key Value` 的 free 層。
- `background worker` 不是 free instance type，所以目前 [`render.as84089443.yaml`](/Users/brian/.openclaw/openclaw-office/render.as84089443.yaml) 裡的 `bw-copilot-worker` 會把方案推到付費。
- 免費 web service 會在閒置後 spin down，所以若需要定時處理 queue，要改成外部 scheduler 來喚醒。

## 這個 repo 內建的免費替代方案

### 1. 使用免費版 Blueprint

改用 [`render.as84089443.hobby.yaml`](/Users/brian/.openclaw/openclaw-office/render.as84089443.hobby.yaml)，它只建立：

- `bw-copilot-web`（free）
- `bw-copilot-db`（free）

### 2. 用 GitHub Actions 取代常駐 worker

新增 workflow：

- [`.github/workflows/merchant-copilot-pulse.yml`](/Users/brian/.openclaw/openclaw-office/.github/workflows/merchant-copilot-pulse.yml)

它每 5 分鐘呼叫一次：

- `POST /api/fnb/ops`
- body: `{ "action": "merchant-copilot-complete-next" }`

也就是把原本 worker 的「claim + complete next task」改成外部 pulse。

## 需要的 GitHub Secrets

- `FNB_PULSE_BASE_URL`
  - 例：`https://your-service.onrender.com`
- `FNB_INTERNAL_API_TOKEN`
  - 要和 Render web service 內的 `FNB_INTERNAL_API_TOKEN` 一致

## 適合這條免費路的情境

- 先把 `/office`、`/browser`、`/merchant`、`/ops` 上線
- merchant copilot queue 容忍 `5 分鐘級` 延遲
- 先驗證產品與入口，不先追求常駐 background worker

## 不適合這條免費路的情境

- 需要秒級背景處理
- 需要 Render 內部原生 worker 常駐
- 需要更高吞吐或更穩定的即時任務處理

## 推薦順序

1. 先用免費版 Blueprint 起 `web + db`
2. 先用 Render 預設網址驗證 `/api/health`、`/office`、`/browser`
3. 設定 GitHub Actions 的兩個 secrets
4. 驗證 GitHub Actions 可以成功 pulse
5. 再視需要決定是否升級回專用 worker
