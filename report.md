# 開發報告摘要（更新）

## 非同步 generation pipeline 改動與驗證（2025-11-13）
- 目的：將目前同步在 HTTP 層執行大量 OpenAI 呼叫的流程改為「非同步優先」，以降低請求延遲、避免超時並提高系統可觀測性。
- 已完成變更：
  - 修改 route：將 [`web/app/api/generation/story-script/route.ts`](web/app/api/generation/story-script/route.ts:1) 改為建立 `generation_jobs`（job_type = "story_script"），並立即回傳 jobIds（status = pending）。
  - 新增 worker skeleton：[`web/worker/jobHandler.ts`](web/worker/jobHandler.ts:1) 為 Upstash list consumer 的範例，示範如何 lpop job message、查詢 `generation_jobs`、以 transaction 更新狀態並示範處理 `story_script` job 的基本流程。
  - 新增 Orchestrator 單元測試：[`web/test/orchestrator.test.ts`](web/test/orchestrator.test.ts:1)（模擬 OpenAI adapter），並已通過本地測試。
- 測試：
  - 在 `web` 目錄執行 `npm test`，所有測試檔案通過（3 files, 4 tests）。
  - Upstash 路徑（ioredis 與 REST fallback）在單元測試中模擬並驗證。
- 風險與建議：
  - 需在 staging 設定真實 `UPSTASH_REDIS_URL` 並驗證 E2E：包括 pushJobsToUpstash 與 worker 消費行為。
  - Drizzle transaction 在某些環境仍有不穩定現象，建議在 CI/staging 執行 `web/scripts/drizzle_test.js` 與 `web/scripts/vercel_pg_test.js`，收集 debug log 並視情況維持 pg client fallback。
  - Worker skeleton 目前為範例，需補上 Orchestrator 與 Persistence 的實際注入與錯誤重試政策（已記錄於 `spec.md`）。
- 下一步（優先順序）：
  1. 在 staging 驗證 Upstash 並執行 E2E（預計 1-2 天）。
  2. 完成 worker 與 Orchestrator 的整合（非同步消費與 persistence）（預計 2-4 天）。
  3. CI 上執行 Drizzle 重現測試並整理 issue-ready report（若重現問題則提交 upstream）。
  4. 加入監控（Sentry）與排程告警（Upstash queue depth/PagerDuty/Slack）。
- 相關檔案（變更清單）：
  - Modified: `web/app/api/generation/story-script/route.ts`
  - Added: `web/worker/jobHandler.ts`
  - Added: `web/test/orchestrator.test.ts`
- Git commit：
  - 已 commit：`feat: async generation endpoint + worker skeleton` (commit id visible in local repo)