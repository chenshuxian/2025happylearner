# Upstash staging validation runbook

目的
- 在 staging 環境驗證 Upstash 推送（Redis client / REST fallback）與 worker 消費流程，確保 `pushJobsToUpstash` 與 consumer 正常運作。

前置條件
- 已有 staging 執行環境（Vercel 或類似）並可以部署或執行 node。
- 可在 staging 或本地取得下列環境變數（見下）。
- 已安裝必要工具於測試機：curl, psql (或 pg cli), redis-cli (若使用 Redis URL)，node (v18+)，以及 ts-node（若執行 TypeScript worker）。

需要的環境變數（staging）
- UPSTASH_REDIS_URL (優先)
- UPSTASH_REST_URL 與 UPSTASH_REST_TOKEN (若使用 REST fallback)
- UPSTASH_QUEUE_NAME (預設: generation_jobs)
- DATABASE_URL 或 POSTGRES_URL
- NODE_ENV=staging
- OPENAI_API_KEY (若要在 worker 執行實際生成)

驗證流程概覽
1) 在 staging 部署最新程式碼（包含 [`web/app/api/generation/story-script/route.ts`](web/app/api/generation/story-script/route.ts:1) 與 [`web/worker/jobHandler.ts`](web/worker/jobHandler.ts:1)）。
2) 呼叫 API 建立 generation job（curl 範例）。
3) 驗證 `generation_jobs` 是否建立於資料庫（psql）。
4) 驗證 Upstash queue 是否有收到 message（redis-cli 或 REST）。
5) 啟動 worker，觀察其消費並以 transaction 更新 job 狀態為 `processing` -> `completed`。
6) 檢查 worker 與 API 日誌以確認流程正常。

詳細步驟（可直接複製執行）

A) 設定 staging env（Vercel 範例）
- 在 Vercel Project Settings -> Environment Variables 新增：
  - `UPSTASH_REDIS_URL` = <your_upstash_redis_url>
  - 或：`UPSTASH_REST_URL` = <your_rest_url>，`UPSTASH_REST_TOKEN` = <token>
  - `UPSTASH_QUEUE_NAME` = generation_jobs
  - `DATABASE_URL` = <your_postgres_url>
  - `OPENAI_API_KEY` = <limited_openai_key_for_staging>
- Deploy 最新 commit。

B) 本地測試（若想在本地模擬 staging，建立 `.env.staging` 並匯入）
- 範例：
  export UPSTASH_REDIS_URL="redis://:password@us1-xxxxx.upstash.io:6379"
  export UPSTASH_QUEUE_NAME="generation_jobs"
  export DATABASE_URL="postgres://user:pass@host:5432/db"
  export OPENAI_API_KEY="sk-..."

C) 建立 generation job（curl 範例）
- 在 staging（或本地 dev server）執行：
  curl -X POST "https://<staging-host>/api/generation/story-script" \
    -H "Content-Type: application/json" \
    -d '{"theme":"Staging test - friendly dragon","tone":"warm","ageRange":"0-6","initiatedBy":"staging"}'

- 預期回應（HTTP 200）：
  {
    "ok": true,
    "storyId": "<uuid>",
    "jobIds": ["<job-uuid>"]
  }

D) 驗證資料庫（psql 範例）
- 使用 psql 或任何 Postgres client 查詢：
  SELECT id, story_id, job_type, status, payload, created_at FROM generation_jobs WHERE story_id = '<storyId>';
- 預期看到一筆 (或多筆) status = 'pending'，payload.type = 'story_script'。

E) 驗證 Upstash queue（使用 Redis client）
- 若使用 `UPSTASH_REDIS_URL`，執行：
  redis-cli -u "$UPSTASH_REDIS_URL" LRANGE "$UPSTASH_QUEUE_NAME" 0 -1
- 預期輸出包含 JSON 字串，例如：{"jobId":"<uuid>","timestamp":...}

- 若無 redis-cli 可用，使用 node 一行程式檢查（在 repo 根目錄）：
  node -e "const Redis=require('ioredis');(async()=>{const r=new (Redis.default||Redis)(process.env.UPSTASH_REDIS_URL);console.log(await r.lrange(process.env.UPSTASH_QUEUE_NAME||'generation_jobs',0,-1));await r.quit();})();"

F) 驗證 REST fallback push（若 UPSTASH_REDIS_URL 未設定）
- 當系統使用 REST 回退，`pushJobsToUpstash` 會 POST 到 `UPSTASH_REST_URL`，可檢查該 endpoint 的回應是否為 200。
- 範例 curl（模擬 REST 寫入）：
  curl -X POST "$UPSTASH_REST_URL" \
    -H "Authorization: Bearer $UPSTASH_REST_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"queue":"generation_jobs","messages":["{\"jobId\":\"<uuid>\",\"timestamp\":12345}"]}'

G) 啟動 worker（staging 或本地）
- 若使用 TypeScript 檔案，請安裝 `ts-node`：
  npm install -D ts-node typescript
- 本地執行（在 repo 根）：
  NODE_ENV=staging UPSTASH_REDIS_URL="$UPSTASH_REDIS_URL" DATABASE_URL="$DATABASE_URL" node -r ts-node/register web/worker/jobHandler.ts
- 或在 production 使用已編譯的 JS，或以 process manager 啟動。

H) 觀察 worker 日誌（應顯示 processing -> completed）
- tail staging log 或在本地查看 console 輸出：
  tail -f /var/log/<your-app>/worker.log
- 或查看 Next.js dev log（本地）：
  tail -f /tmp/next-dev.log

I) 驗證 job 結果回寫
- 在 DB 查詢 job 狀態：
  SELECT id, status, result_uri, failure_reason, retry_count FROM generation_jobs WHERE id = '<jobId>';
- 預期在成功處理後 status = 'completed'，result_uri 或其他欄位被更新。

常見問題與對應處置
- 若 `LRANGE` 無訊息：確認 `pushJobsToUpstash` 是否被呼叫（檢查 API 日誌），檢查 env `UPSTASH_REDIS_URL` 是否正確。
- 若 REST push 失敗：檢查 `UPSTASH_REST_TOKEN` 是否正確，並檢視回應 body。
- 若 worker 無法連 DB：檢查 `DATABASE_URL` 與 network rules，嘗試以 `psql` 連線確認。
- 若出現 Drizzle transaction 錯誤（BEGIN 失敗）：請在 CI/staging 執行 `web/scripts/drizzle_test.js` 與 `web/scripts/vercel_pg_test.js` 收集 debug log，並暫時使用 pg fallback（已在 `OrchestrationPersistence` 支援）。

回報樣板（提交給維運或 QA）
- 報告標題：Upstash E2E validation — <staging-id>
- 提供內容：API curl 輸出、generation_jobs DB rows、LRANGE 輸出、worker 日誌片段、任何錯誤訊息

附錄：快速命令彙整
- 建立 job（curl）：
  curl -X POST "https://<staging-host>/api/generation/story-script" -H "Content-Type: application/json" -d '{"theme":"Staging test","initiatedBy":"staging"}'
- 查詢 DB（psql）：
  psql "$DATABASE_URL" -c "SELECT id, story_id, job_type, status, payload FROM generation_jobs ORDER BY created_at DESC LIMIT 10;"
- 檢查 Upstash list（redis-cli）：
  redis-cli -u "$UPSTASH_REDIS_URL" LRANGE "$UPSTASH_QUEUE_NAME" 0 -1
- 啟動 worker（本地）：
  NODE_ENV=staging UPSTASH_REDIS_URL="$UPSTASH_REDIS_URL" DATABASE_URL="$DATABASE_URL" node -r ts-node/register web/worker/jobHandler.ts

結束 — 若需要，我可以將上述 runbook 以 PR 提交或依照你的 staging CI/CD 流程自動化步驟。