/**
 * check_upstash.js (CommonJS)
 *
 * 用 ioredis 連到 UPSTASH_REDIS_URL 並列出 queue（LRANGE）
 * 若未設定或 ioredis 無法使用，會嘗試 REST push（若 UPSTASH_REST_URL/UPSTASH_REST_TOKEN 有設定）
 *
 * 使用：
 *   set -a && source .env.local && set +a
 *   node web/scripts/check_upstash.js
 *
 * 可選參數：
 *   --push-test    會嘗試用 client 或 REST push 一則測試訊息到 queue
 *
 * 注意：請勿在公開場所貼上包含密碼的 UPSTASH_REDIS_URL 或 UPSTASH_REST_TOKEN。
 */
(function () {
  const queue = process.env.UPSTASH_QUEUE_NAME || "generation_jobs";
  const redisUrl = process.env.UPSTASH_REDIS_URL;
  const restUrl = process.env.UPSTASH_REST_URL;
  const restToken = process.env.UPSTASH_REST_TOKEN;
  const args = process.argv.slice(2);
  const doPushTest = args.includes("--push-test");

  console.info("[check_upstash] queue =", queue);

  (async () => {
    if (redisUrl) {
      try {
        // Use require to remain CommonJS-compatible
        const IORedisModule = require("ioredis");
        const Redis = IORedisModule && IORedisModule.default ? IORedisModule.default : IORedisModule;
        const client = new Redis(redisUrl, { lazyConnect: false });

        try {
          console.info("[check_upstash] connected to Upstash via ioredis, LRANGE -> getting items ...");
          const items = await client.lrange(queue, 0, -1);
          console.info("[check_upstash] LRANGE result count=", Array.isArray(items) ? items.length : 0);
          if (Array.isArray(items)) {
            items.forEach((it, i) => console.log(`${i}: ${it}`));
          } else {
            console.log("LRANGE returned non-array:", items);
          }

          if (doPushTest) {
            const msg = JSON.stringify({ jobId: `check-${Date.now()}`, timestamp: Date.now() });
            console.info("[check_upstash] push-test: RPUSH ->", msg);
            await client.rpush(queue, msg);
            console.info("[check_upstash] push-test completed");
          }
          await client.quit();
          process.exit(0);
        } catch (err) {
          try { await client.quit(); } catch {}
          console.error("[check_upstash] ioredis operation failed:", err && err.message ? err.message : err);
        }
      } catch (err) {
        console.error("[check_upstash] failed to load/connect ioredis:", err && err.message ? err.message : err);
        console.warn("[check_upstash] falling back to REST check (if configured)");
      }
    } else {
      console.warn("[check_upstash] UPSTASH_REDIS_URL not set, attempting REST fallback (if configured)");
    }

    // REST fallback: attempt to POST messages (note: REST API may not expose LRANGE)
    if (restUrl && restToken) {
      console.info("[check_upstash] UPSTASH_REST_URL configured - attempting REST push test (this will append a message)");
      const messages = [JSON.stringify({ jobId: `check-rest-${Date.now()}`, timestamp: Date.now() })];
      try {
        const resp = await fetch(restUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${restToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ queue, messages }),
        });
        const txt = await resp.text().catch(() => "<no body>");
        if (resp.ok) {
          console.info("[check_upstash] REST push succeeded, response:", txt);
          process.exit(0);
        } else {
          console.error("[check_upstash] REST push failed:", resp.status, txt);
          process.exit(2);
        }
      } catch (e) {
        console.error("[check_upstash] REST push error:", e && e.message ? e.message : e);
        process.exit(3);
      }
    }

    console.error("[check_upstash] no usable Upstash configuration found or all checks failed.");
    console.error(" - Ensure UPSTASH_REDIS_URL or UPSTASH_REST_URL+UPSTASH_REST_TOKEN is set in your environment.");
    console.error(" - If using a TLS URL (rediss://...), your local redis-cli may not accept the URL directly; use the node script or parse into --tls -h -p -a form.");
    console.error(" - To push a test message via REST, run with UPSTASH_REST_URL/UPSTASH_REST_TOKEN set and --push-test flag.");
    process.exit(4);
  })();
})();