# Upstash Staging Validation

目的：在 staging/CI 驗證 Upstash 推送（Redis client 與 REST fallback）。

建議前置條件：
- Staging 環境有可寫的 Postgres（若要執行完整 end-to-end）。
- 有 Upstash Redis 或 REST token 可用於測試。

必要環境變數（請在部署平台或 CI secrets 設定）
- UPSTASH_REDIS_URL: Redis 連線字串 (e.g. redis://:password@eu1-upstash.example:6379)
- UPSTASH_REST_URL: Upstash REST 推送 endpoint (e.g. https://us1-rest.upstash.io/push)
- UPSTASH_REST_TOKEN: REST Bearer token
- UPSTASH_QUEUE_NAME: queue name (預設 generation_jobs)

快速驗證方法（不修改資料庫）

A) 驗證 REST push（使用 curl）
1. 在你本地 / CI 執行：
   curl -X POST "${UPSTASH_REST_URL}" \
     -H "Authorization: Bearer ${UPSTASH_REST_TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"queue":"generation_jobs","messages":["{\"jobId\":\"smoke-1\",\"timestamp\":'"$(date +%s%3N)"' }"]}'
2. 若回傳 HTTP 200，代表 REST push 成功。

B) 驗證 Redis client path（使用 node 與 ioredis）
1. 在 staging/CI runner 安裝依賴或使用已安裝的 ioredis（我們在 repo 已加入 ioredis）。
2. 範例 node 指令（one-liner）：
   node -e "const Redis=require('ioredis');(async()=>{const c=new Redis(process.env.UPSTASH_REDIS_URL);await c.rpush(process.env.UPSTASH_QUEUE_NAME||'generation_jobs',JSON.stringify({jobId:'smoke-redis','timestamp':Date.now()}));await c.quit();console.log('OK');})().catch(e=>{console.error(e);process.exit(1)})"
3. 若輸出 OK，代表 RPUSH 成功（訊息已送到 Upstash list）。

C) 在 staging 執行應用層面驗證（end-to-end smoke）
1. 設定 staging DB 與 Upstash 的環境變數（DB 可使用 staging Postgres）。
2. 呼叫 API（假設已部署 staging web app），例如：
   curl -X POST "https://staging.example.com/api/generation/story-script" \
     -H "Content-Type: application/json" \
     -d '{"theme":"smoke test theme", "tone":"warm"}'
3. 檢查應用日誌與資料庫的 generation_jobs 是否有新紀錄，並確認 Upstash queue（或 Upstash dashboard）有新增訊息。

CI 範例（GitHub Actions）片段
```yaml
name: Upstash Smoke
on: workflow_dispatch
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Node setup
        uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install
        run: cd web && npm ci
      - name: REST push smoke
        env:
          UPSTASH_REST_URL: ${{ secrets.UPSTASH_REST_URL }}
          UPSTASH_REST_TOKEN: ${{ secrets.UPSTASH_REST_TOKEN }}
        run: |
          cd web
          curl -sS -X POST "$UPSTASH_REST_URL" -H "Authorization: Bearer $UPSTASH_REST_TOKEN" -H "Content-Type: application/json" -d "{\"queue\":\"$({{ env.UPSTASH_QUEUE_NAME:-generation_jobs}})\",\"messages\":[\"{\\\"jobId\\\":\\\"ci-smoke\\\",\\\"timestamp\\\":$(date +%s%3N)}\"]}"
```

注意事項與風險
- 若要在 staging 呼叫完整 Orchestrator 路徑，請先確認 DB 與 Blob 儲存設定（以免產生大量測試資源）。
- Upstash Redis 與 REST 介面的速率與費率，測試時請使用低頻或限量訊息。
- 在 CI 中使用 secrets（UPSTASH_REDIS_URL / UPSTASH_REST_TOKEN）並限制誰可啟動 workflow。

建議的驗證清單（manual）
- [ ] 設定 staging secrets：UPSTASH_REDIS_URL 或 UPSTASH_REST_URL/UPSTASH_REST_TOKEN
- [ ] 在 staging 執行 REST smoke 並確認 HTTP 200
- [ ] 在 staging 執行 Redis smoke 並確認 OK
- [ ] 若需要，呼叫 staging API 並檢查 generation_jobs 與 Upstash queue

若你需要我產生一個小的 Node.js smoke script 放在 repo 中（例如 `web/scripts/upstash-smoke.js`）以便在 staging/CI 使用，我可以建立，請回覆「建立 smoke script」。 

參考檔案
- 單元測試：[`web/test/upstash.test.ts`](web/test/upstash.test.ts:1)
- 實作：[`web/lib/openai/OrchestrationPersistence.ts`](web/lib/openai/OrchestrationPersistence.ts:153)
- 環境設定：[`web/lib/utils/env.ts`](web/lib/utils/env.ts:1)

以上步驟若需我產出 CI 工作流程、smoke script 或代為 push commit，請告知。