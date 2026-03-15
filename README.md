# OpenClaw Office

OpenClaw Office 現在內建一個可直接操作的 `AI 餐飲 SaaS / F&B Copilot` demo。

這個版本不是只有展示畫面，而是已經包含：
- 低負擔店家流程：店家主要在 `LINE 對話式 Copilot` 裡核准、補資料、看摘要
- `Autopilot Policy Engine`：自動分流 `auto-send / merchant-approve / ops-review`
- 每週計畫、優惠追蹤、代理成效事件、週摘要
- 內部 `Ops Console`，可直接模擬店家核准、加領券、加導航、重算週摘要
- provider-backed F&B persistence：本地 `SQLite demo` 與雲端 `Postgres staging` 共用同一套 service contract
- 最小可用的 `LINE webhook / OAuth` 與 `Google OAuth / publish` 路由骨架

## 最快開始

在 [openclaw-office](/Users/brian/.openclaw/openclaw-office) 目錄執行：

```bash
npm run demo
```

這個指令會自動：
1. 補齊 `.env.local` 與 `openclaw-office.config.json`（若缺少）
2. 檢查依賴
3. 重新編譯 `better-sqlite3`
4. 啟動開發環境於 `http://localhost:4200`

`demo` 模式也會自動停用 generic OpenClaw gateway 連線，避免出現與餐飲功能無關的 WebSocket 錯誤。

啟動後直接打開：

[http://localhost:4200](http://localhost:4200)

首頁預設就是 `F&B Copilot` 分頁。

現在也正式拆成三個入口：

- `/merchant`：店家使用面
- `/ops`：內部營運面
- `/office`：舊版 generic office dashboard

`/ops` 現在也包含真正商家 onboarding：

- 可直接建立 `tenant + location + merchant profile + brand pack + menu`
- 建立後自動產生商家綁定入口與 dashboard deep links
- 可切換不同 location
- 會顯示當前 persistence provider 是 `SQLite` 還是 `Postgres`

如果你不是用 `npm run demo`，而是自己手動跑 `npm run dev`，可先用下面這個網址直接預覽商家身份：

```bash
http://localhost:4200/merchant?lineUserId=line:merchant-azhu
```

## 你現在能做什麼

在 F&B Copilot 頁面，你可以直接操作這些流程：

- `產新一週計畫`
- `執行 Autopilot`
- `重算週摘要`
- 在 `Merchant Copilot Inbox` 按：
  - `同意排程`
  - `延到明天`
  - `先跳過`
- 手動模擬代理成效：
  - `+1 領券`
  - `+1 導航`
- 模擬店家回覆：
  - 回報停售品項
  - 提交營業更新
  - 補發本週摘要

`/merchant` 現在也已經改成 `單一官方 LINE OA + LIFF mini app` 思維，主分頁固定是：

- `待審核`
- `顧客資訊`
- `店家設定`
- `本週摘要`

## 路由分工

- [首頁](/Users/brian/.openclaw/openclaw-office/app/page.js)：入口與角色分流
- [Merchant](/Users/brian/.openclaw/openclaw-office/app/merchant/page.js)：店家低負擔介面
- [Ops](/Users/brian/.openclaw/openclaw-office/app/ops/page.js)：內部營運主控台
- [Office](/Users/brian/.openclaw/openclaw-office/app/office/page.js)：舊版 office dashboard

## Demo 資料

系統目前會自動 seed 一家 demo 店：

- 店名：`阿珠小吃 赤峰店`
- 類型：`台式小吃`
- 目標：`離峰補客與熟客回流`
- 預設週投入時間：`15 分鐘`

這套 demo data 會自動生成：
- LINE / Google channel connection 狀態
- autopilot rules
- 一週 campaign plan
- drafts
- approval card
- offer / short link
- attribution events
- weekly digest

## API

如果你要直接看資料或串接前端，主要入口是：

- `GET /api/fnb/ops`
- `POST /api/fnb/ops`
- `GET /api/liff/bootstrap`
- `GET /api/fnb/merchant/home`
- `GET /api/fnb/merchant/approvals`
- `POST /api/fnb/merchant/approvals/:id/respond`
- `GET /api/fnb/merchant/customers`
- `POST /api/fnb/merchant/customers/:id/notes`
- `POST /api/fnb/merchant/customers/:id/tags`
- `POST /api/line/rich-menu/sync`
- `GET /api/fnb/onboarding`
- `POST /api/fnb/onboarding`
- `POST /api/fnb/publish`
- `POST /api/webhooks/line`
- `GET|POST /api/auth/line/start`
- `GET /api/auth/line/callback`
- `GET|POST /api/auth/google/start`
- `GET /api/auth/google/callback`

支援的 `action` 包含：

- `onboard-merchant`
- `generate-plan`
- `run-autopilot`
- `send-approval-card`
- `merchant-reply`
- `record-event`
- `generate-digest`

## Persistence 與 Migration

F&B domain 現在會依照環境自動切換：

- 沒有 `DATABASE_URL`：走 `SQLite demo`
- 有 `DATABASE_URL`：走 `Postgres-ready` provider

如果要進真實 pilot，不建議只靠 demo seed。現在可以直接進 `/ops` 用 onboarding form 建真商家資料，再觀察 provider 卡是否已切成 `Postgres`。

可手動驗證 schema 初始化：

```bash
npm run migrate:fnb
```

測試同時覆蓋 `SQLite demo` 與 `pg-mem` 模擬 Postgres：

```bash
npm run test:fnb
```

## Render 部署

如果要上雲做 staging / pilot，已經補好：

- [render.yaml](/Users/brian/.openclaw/openclaw-office/render.yaml)
- [F&B Postgres schema](/Users/brian/.openclaw/openclaw-office/db/fnb-postgres-schema.sql)

目前 Blueprint 會：

- 部署 web service
- 建立一個 managed Postgres database
- 關閉 generic gateway 連線噪音
- 預留 `LINE Messaging / Login`、`Google OAuth`、`FNB_PUBLIC_BASE_URL` 等環境變數

## Merchant LINE 上線流程

商家工作台現在預設走「獨立商家 OA / LIFF」模式，和原本的 `SuperFish` 產品入口分開。

建議順序如下：

1. 先準備本地 `.env.local` 與 rich menu 圖檔：

```bash
npm run merchant-line:prepare-env
```

這個指令會：
- 把 `FNB_PUBLIC_BASE_URL` 預設成 `https://copilot.bw-space.com`
- 產生一組新的 `FNB_INTERNAL_API_TOKEN`
- 準備 `FNB_LINE_*` 命名空間，不再共用其他產品的 `LINE_*`
- 若有 `OPENAI_API_KEY`，用 OpenAI 產商家入口 rich menu 圖
- 若沒有 `OPENAI_API_KEY`，退回 repo 內建 SVG 產一張可直接上傳 LINE 的 placeholder 圖
- 預設把 rich menu base64 存成檔案，並把路徑寫進 `FNB_LINE_RICH_MENU_IMAGE_BASE64_PATH`

2. 在 LINE Developers Console 建立同 provider 下的 `LINE Login channel`，然後把這三個值補進 `.env.local`：

- `FNB_LINE_LOGIN_CHANNEL_ID`
- `FNB_LINE_LOGIN_CHANNEL_SECRET`
- `NEXT_PUBLIC_FNB_LINE_LIFF_ID` 先留空

3. 自動建立 LIFF app：

```bash
npm run merchant-line:liff
```

這個指令會：
- 用 `FNB_LINE_LOGIN_CHANNEL_ID / FNB_LINE_LOGIN_CHANNEL_SECRET` 換取 channel access token
- 呼叫 `POST https://api.line.me/liff/v1/apps`
- 建立 `BW-Copilot Merchant`
- 把回傳的 `NEXT_PUBLIC_FNB_LINE_LIFF_ID` 寫回 `.env.local`

4. 設定 LINE webhook 指向正式網址：

```bash
npm run merchant-line:webhook
```

這會把 webhook 設到：

```bash
https://copilot.bw-space.com/api/webhooks/line
```

並自動呼叫官方 webhook test endpoint。

5. rich menu 與 LIFF 都 ready 後，再同步 rich menu：

```bash
npm run merchant-line:sync-rich-menu
```

預設若 `NEXT_PUBLIC_FNB_LINE_LIFF_ID` 尚未設定，script 會拒絕同步，避免把按鈕導到非 LIFF 網址。若你真的要先導到 browser URL，可明確加：

```bash
npm run merchant-line:sync-rich-menu -- --allow-browser-fallback
```

腳本輸出檔會放在：

- `data/fnb-merchant/merchant-rich-menu.jpg`
- `data/fnb-merchant/merchant-rich-menu.base64.txt`
- `data/fnb-merchant/merchant-rich-menu.json`

提醒：
- `LIFF` 不能再新建在 Messaging API channel 上，必須使用新的 `LINE Login channel`
- 商家入口只讀 `FNB_LINE_*`，不再自動吃原本其他產品的 `LINE_*`
- 你曾貼在對話裡的 Messaging API access token 應視為已曝光；正式上線後建議重新簽發再更新 Render env
- `copilot.bw-space.com` 的 Cloudflare CNAME 與 Render custom domain 仍需在外部服務完成

## macOS 常駐

目前 `copilot.bw-space.com` 仍是經由這台 Mac 的 `Next.js + Cloudflare Tunnel` 提供，因此最實用的下一步是把兩個程序做成 `launchd` 常駐服務。

安裝並立即啟動：

```bash
npm run copilot:install-service
```

會安裝兩個 `LaunchAgent`：

- `ai.openclaw.office`
- `ai.openclaw.copilot-tunnel`

來源檔案在：

- [ai.openclaw.office.plist](/Users/brian/.openclaw/openclaw-office/launchd/ai.openclaw.office.plist)
- [ai.openclaw.copilot-tunnel.plist](/Users/brian/.openclaw/openclaw-office/launchd/ai.openclaw.copilot-tunnel.plist)

移除：

```bash
npm run copilot:uninstall-service
```

常駐 wrapper script 在：

- [run-openclaw-office-prod.sh](/Users/brian/.openclaw/openclaw-office/scripts/run-openclaw-office-prod.sh)
- [run-openclaw-copilot-tunnel.sh](/Users/brian/.openclaw/openclaw-office/scripts/run-openclaw-copilot-tunnel.sh)

## 驗證

```bash
npm run test:fnb
npm run build
```

## 目前仍需外部帳號設定的部分

這版已經是 pilot-ready 骨架，但以下仍需要你填入真實憑證與 location resource 才會 live：

- `FNB_LINE_CHANNEL_ID`、`FNB_LINE_CHANNEL_ACCESS_TOKEN`、`FNB_LINE_CHANNEL_SECRET`
- `FNB_LINE_LOGIN_CHANNEL_ID`、`FNB_LINE_LOGIN_CHANNEL_SECRET`
- `NEXT_PUBLIC_FNB_LINE_LIFF_ID`
- `FNB_LINE_RICH_MENU_IMAGE_BASE64_PATH`
- `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`
- Google Business Profile 的實際 `locationName`
- 真實短連結服務與 QR 掃碼回傳

Rich Menu 的 repo 內素材與 manifest 在：

- [Rich menu manifest](/Users/brian/.openclaw/openclaw-office/lib/fnb/merchant-rich-menu.json)
- [Rich menu preview](/Users/brian/.openclaw/openclaw-office/public/line/merchant-rich-menu.svg)

## 主要檔案

- [首頁入口](/Users/brian/.openclaw/openclaw-office/app/page.js)
- [F&B Ops Console](/Users/brian/.openclaw/openclaw-office/components/FnbOpsConsole.js)
- [F&B domain/service](/Users/brian/.openclaw/openclaw-office/lib/fnb-service.js)
- [F&B persistence](/Users/brian/.openclaw/openclaw-office/lib/fnb/persistence.js)
- [F&B channel adapters](/Users/brian/.openclaw/openclaw-office/lib/fnb/channels.js)
- [Merchant surface](/Users/brian/.openclaw/openclaw-office/components/FnbMerchantSurface.js)
- [LIFF bootstrap API](/Users/brian/.openclaw/openclaw-office/app/api/liff/bootstrap/route.js)
- [F&B API](/Users/brian/.openclaw/openclaw-office/app/api/fnb/ops/route.js)
- [F&B 測試](/Users/brian/.openclaw/openclaw-office/tests/fnb-service.test.mjs)
