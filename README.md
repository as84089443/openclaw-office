# OpenClaw Office

OpenClaw Office 已整合 F&B Copilot（merchant / ops / office 三入口）與 LINE 單一入口流程（OA + LINE Login + LIFF）。

## Quick Start

```bash
npm install
cp .env.example .env.local
cp openclaw-office.config.example.json openclaw-office.config.json
npm run demo
```

啟動後：

- `http://localhost:4200/`：產品入口
- `http://localhost:4200/merchant`：商家面
- `http://localhost:4200/ops`：營運面
- `http://localhost:4200/office`：legacy office

## 主要腳本

```bash
npm run demo
npm run migrate:fnb
npm run superfish:live-check
npm run superfish:go-live
npm run superfish:webhook
npm run superfish:sync-rich-menu
npm run test:fnb
npm run build
```

E2E（Playwright，僅回歸或 UI 除錯）：

```bash
npm run test:e2e
npm run test:e2e:ui
npm run test:e2e:report
```

## 重要環境變數

- `FNB_PUBLIC_BASE_URL`
- `FNB_INTERNAL_API_TOKEN`
- `FNB_APP_ENV`
- `FNB_DEMO_MODE`
- `DATABASE_URL`（有值時走 Postgres，否則 SQLite）
- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `LINE_LOGIN_CHANNEL_ID`
- `LINE_LOGIN_CHANNEL_SECRET`
- `NEXT_PUBLIC_LINE_LIFF_ID`
- `LINE_RICH_MENU_IMAGE_BASE64`

## LINE 商家入口流程

1. 設定 Render env 與 `FNB_PUBLIC_BASE_URL`（正式網址）。
2. `npm run superfish:go-live`（快檢 + webhook + rich menu sync + 再快檢）。
3. 從 OA 測試：`Rich menu -> LIFF -> callback -> /merchant`。

## 最快驗證流程（不靠 Playwright）

1. `npm run superfish:live-check`：檢查 `/api/health` readiness（line/login/liff/richMenu）與 LINE Login redirect。
2. `npm run superfish:webhook`：把 webhook endpoint 寫回 LINE channel 並做 test。
3. `npm run superfish:sync-rich-menu`：同步四格 rich menu 到 OA。
4. 僅保留「手機 OA 人眼驗證」：`Rich menu -> LIFF -> callback -> merchant tab`。

## API（節錄）

- `GET /api/health`
- `GET /api/liff/bootstrap`
- `POST /api/webhooks/line`
- `POST /api/line/rich-menu/sync`
- `GET /api/fnb/merchant/home`
- `GET /api/fnb/merchant/approvals`
- `POST /api/fnb/merchant/approvals/:id/respond`
- `GET /api/fnb/merchant/customers`
- `POST /api/fnb/merchant/customers/:id/notes`
- `POST /api/fnb/merchant/customers/:id/tags`

## 資料層

- `db/fnb-postgres-schema.sql`
- `lib/fnb/persistence.js`
- `lib/fnb-service.js`

## 部署

- Render Blueprint: `render.yaml`
- 建議網域：`copilot.bw-space.com`
- 正式上線前請完成 LINE 與 Google OAuth 外部設定。
