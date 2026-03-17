# OpenClaw Office Dev Plan

## In Progress

### 主動進度回報系統 v2
- [ ] 加入任務狀態機：planning / executing / blocked / done
- [ ] 將「下一步」從聊天文字改成可執行狀態欄位（nextStepRequired / pendingAction）
- [ ] 里程碑回報後自動檢查是否仍有未完成 nextStep，若有則續跑
- [ ] 超時未回報檢查：任務非 done/blocked 且長時間無更新時，自動標記 stale 並補推播
- [ ] 區分 progress update vs decision request，避免里程碑變停工點
- [ ] 回覆後自檢是否仍有低風險 nextStep，可直接續跑
- [ ] completion-gate：回覆前/回覆後檢查內容是否包含「還沒做 / 下一步 / 還剩 / 可再補」等未完成訊號；若屬低風險則禁止把此輪任務判定為完成
- [ ] 檔案操作規則：檔案不存在用 write；已存在才用 edit；先檢查存在性再選工具

## Done
- [x] Office 任務面板 v1：CurrentTasksPanel + task detail view
- [x] Office 任務欄位：milestone / nextStep / lastUpdate
- [x] Telegram milestone 推播：開始 / 完成 / 卡住
- [x] 任務面板 stale 標記
- [x] DB 持久化修正：不再預設落入 in-memory fallback
