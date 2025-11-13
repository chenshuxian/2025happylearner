# 在 macOS 安裝 redis-cli 與檢查 Upstash（快速指南）

本檔說明如何在 macOS 安裝 `redis-cli`（建議使用 Homebrew），以及如何用它檢查 Upstash 的 queue (LRANGE)，並示範如何啟動 worker 並收集日誌供後續分析。

1) 若尚未安裝 Homebrew（僅在需要時執行）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

2) 安裝 redis（包含 redis-cli）
brew update
brew install redis

3) 驗證 redis-cli 是否安裝成功
redis-cli --version

4) 使用 redis-cli 檢查 Upstash queue（請先在 shell 設定好 env）
export UPSTASH_REDIS_URL="redis://:PASSWORD@...."
export UPSTASH_QUEUE_NAME="generation_jobs"
redis-cli -u "$UPSTASH_REDIS_URL" LRANGE "${UPSTASH_QUEUE_NAME:-generation_jobs}" 0 -1

說明：
- Upstash 的 URL 通常包含使用者/密碼與 TLS 資訊，`redis-cli -u` 需要新版本（7+）才支援 URL 參數。
- 若出現 TLS 或認證錯誤，請確保 URL 正確（不要把密碼貼到公開處）。

5) 若不想安裝 redis-cli，可使用 Node (ioredis) 檢查（替代）
node -e "const Redis=require('ioredis');(async()=>{const r=new (Redis.default||Redis)(process.env.UPSTASH_REDIS_URL);console.log(await r.lrange(process.env.UPSTASH_QUEUE_NAME||'generation_jobs',0,-1));await r.quit();})();"

6) 啟動 worker（TypeScript 範例）
(a) 使用 ts-node（開發用）：
cd web
npm install -D ts-node typescript
npx ts-node web/worker/jobHandler.ts &> /tmp/worker.log & sleep 6 && tail -n 200 /tmp/worker.log

(b) 或先編譯再執行（production-like）：
npx tsc web/worker/jobHandler.ts --outDir dist
node dist/web/worker/jobHandler.js &> /tmp/worker.log & sleep 6 && tail -n 200 /tmp/worker.log

7) 常見問題與建議
- 若 `redis-cli not found`：請用 Homebrew 安裝（brew install redis）。
- 若 `redis-cli` 與 Upstash TLS/URL 互動有問題，請使用上面 Node/ioredis 指令作為替代。
- 不要在公開場所貼出 `UPSTASH_REDIS_URL` 或 `UPSTASH_REST_TOKEN`。測試完成後請 rotate / 撤銷測試憑證。
- 若 worker 以 TypeScript 寫成（.ts），請用 ts-node 或先 transpile 成 JS 再以 node 執行。
- 若你需要，我可以在 repo 加入 `web/scripts/check_upstash.js`（使用 ioredis）或額外的 JS worker 入口（可直接用 node 執行）。

完成：請按照上述步驟在本機執行 `redis-cli -u "$UPSTASH_REDIS_URL" LRANGE ...` 並啟動 worker，然後把 `/tmp/worker.log` 與 LRANGE 的輸出貼上給我，我會分析下一步。