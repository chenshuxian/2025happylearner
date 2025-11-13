# Report — Upstash ioredis Integration and Tests

## 摘要
- 完成將 Upstash 推送支援納入 OrchestrationPersistence，包含 Redis client 與 REST fallback。
- 新增 ioredis 依賴並加入相關單元測試（mock ioredis 與 fetch）。
- 更新規格與代辦清單，並在本地建立 commit（尚未 push）。

## 相關檔案 & 變更
- 已新增 / 修改：
- [`web/package.json`](web/package.json:15) — 新增依賴 `ioredis`
- [`web/lib/utils/env.ts`](web/lib/utils/env.ts:1) — 新增 `UPSTASH_REDIS_URL` 支援
- [`web/lib/openai/OrchestrationPersistence.ts`](web/lib/openai/OrchestrationPersistence.ts:153) — 已實作動態 import 與 pushJobsToUpstash（參考位置）
- [`web/test/upstash.test.ts`](web/test/upstash.test.ts:1) — 新增 Upstash 推送單元測試（ioredis client 與 REST fallback）
- [`spec.md`](spec.md:96) — 文件補充 Upstash 推送流程與測試說明
- [`todolist.md`](todolist.md:3) — 更新任務狀態

## 測試
- 使用 Vitest 本地執行測試，所有測試包含新增的 Upstash 測試皆通過。
- 測試位置：[`web/test/upstash.test.ts`](web/test/upstash.test.ts:1)
- 測試要點：
  - 當設定 `UPSTASH_REDIS_URL` 時，會使用 mock 的 `ioredis` 並驗證 `rpush` 被呼叫。
  - 當未設定 `UPSTASH_REDIS_URL` 且有 REST 參數時，會使用 mock `fetch` 並驗證 POST 內容與 headers。

## Commit
- 本地 commit 已建立（尚未 push）
- Commit 訊息：feat: add ioredis dependency and Upstash push unit tests (mock ioredis & fetch)

## 建議的下一步
1. 若要同步遠端：執行 git push origin HEAD（我可代為執行）。
2. 在 staging 環境測試真實 Upstash（先設 `UPSTASH_REDIS_URL` 或 REST 參數）。
3. 若需要，將 spec 的流程圖匯出為 SVG 並置入文件以利 review。

## 備註
- 若要我進行 push 或產出更詳盡的 release note，請回覆「push」或「release note」。
## 2025-11-12 — Drizzle / @vercel/postgres transaction BEGIN 失敗（已記錄）

時間：2025-11-12T09:18:00+08:00

問題摘要
- 在本機開發環境中，使用 Drizzle + @vercel/postgres 執行 db.transaction(...) 時在 BEGIN 階段失敗，錯誤訊息為 "Failed query: begin"（底層顯示為 WebSocket/HTTP fetch 嘗試連到 ::1:443 / 127.0.0.1:443 並被拒絕，出現 `NeonDbError: fetch failed` / ECONNREFUSED）。
- 原生 `pg` (TCP) 可連到本機 Postgres (localhost:5432) 並執行 INSERT/COMMIT（`web/scripts/pgtest.js` 為驗證腳本，但該腳本會 ROLLBACK 做連線驗證，不會持久化）。

重現與測試
- 重現腳本：
  - [`web/scripts/drizzle_test.js`](web/scripts/drizzle_test.js:1) — 使用 Drizzle + @vercel/postgres 並執行 db.transaction()（重現 Failed query: begin）。
  - [`web/scripts/vercel_pg_test.js`](web/scripts/vercel_pg_test.js:1) — 直接用 `@vercel/postgres` 的 `sql` 做最小 SELECT（回傳 NeonDbError）。
  - [`web/scripts/pgtest.js`](web/scripts/pgtest.js:1) — 使用原生 `pg` 客戶端驗證 TCP 連線（成功，注意此腳本會 ROLLBACK）。
- 觀察到的低階 debug（執行 `NODE_DEBUG=net,ws`）：
  - client 嘗試連到 ::1:443 / 127.0.0.1:443（HTTPS/WS），連線失敗（status -61），導致 Drizzle/@vercel/postgres 的 BEGIN 失敗。

已採取的臨時處理（短期修補）
- 為立即恢復功能，將 Orchestration persistence 實作改為使用原生 `pg` client（明確使用 BEGIN / INSERT / COMMIT / RETURNING）。
  - 變更檔案：[`web/lib/openai/OrchestrationPersistence.ts`](web/lib/openai/OrchestrationPersistence.ts:1)
  - 已在 dev server 上測試並驗證：POST /api/generation/story-script 回傳 200，並在資料庫看到寫入紀錄（createdJobIds）。
  - 變更已 commit（commit: 08a515e — "feat: use pg client fallback for persistence to avoid vercel-postgres transaction issue"）。

後續建議（待處理）
1. 短期：在 CI / staging 保留 pg fallback，確保功能穩定運作並觀察。  
2. 中期 / root cause：在乾淨環境或 CI 上重現 Drizzle/@vercel/postgres 的行為，嘗試下列步驟以判定根因：
   - 檢查 `@vercel/postgres` 是否在本機環境預設使用 serverless/fetch (Neon) 路徑；若可設定，強制改為 TCP。  
   - 嘗試不同版本的 `@vercel/postgres` 與 `drizzle-orm`，並在每次變更後執行重現腳本（上面三個腳本）。  
   - 若無法解決，整理 issue-ready report 並提交給 upstream（Drizzle / @vercel/postgres / Neon），附上重現步驟與 `NODE_DEBUG=net,ws` 日誌。
3. 文件：將決策（採用 pg fallback）與調查結果寫入 `spec.md` 作為設計紀錄，並更新 `todolist.md` 為後續追蹤事項。

相關檔案索引（重點）
- 實作與變更：[`web/lib/openai/OrchestrationPersistence.ts`](web/lib/openai/OrchestrationPersistence.ts:1)
- Drizzle 重現腳本：[`web/scripts/drizzle_test.js`](web/scripts/drizzle_test.js:1)
- @vercel/postgres 測試：[`web/scripts/vercel_pg_test.js`](web/scripts/vercel_pg_test.js:1)
- 原生 pg 測試：[`web/scripts/pgtest.js`](web/scripts/pgtest.js:1)

後續可執行動作（選一）
- A) 我幫你把 issue-ready report 建成檔案並準備提交資料（包含重現步驟與 debug 日誌）。  
- B) 保留目前狀態（已記錄），由團隊在 CI/staging 跟進。  
- C) 我立即把決策寫入 `spec.md` 並更新 `todolist.md`（把 root-cause 調查加入排程）。

（記錄完畢）