/**
 * Upstash smoke script
 *
 * 用法：
 *   UPSTASH_REDIS_URL="redis://:pw@eu1-upstash.example:6379" node web/scripts/upstash-smoke.js
 *   或：
 *   UPSTASH_REST_URL="https://us1-rest.upstash.io/push" UPSTASH_REST_TOKEN="token" node web/scripts/upstash-smoke.js
 *
 * 此腳本會：
 *  - 若設定 UPSTASH_REDIS_URL，嘗試使用 ioredis rpush 將一則 message 推到 queue（預設 queue: generation_jobs）
 *  - 若未設定 UPSTASH_REDIS_URL 但有 UPSTASH_REST_URL & UPSTASH_REST_TOKEN，使用 REST API 推送
 *
 * 注意：此為 smoke 測試，非生產程式庫。請在 CI / staging 上用 secrets 提供 env。
 */

(async () => {
  const queue = process.env.UPSTASH_QUEUE_NAME ?? "generation_jobs";
  const redisUrl = process.env.UPSTASH_REDIS_URL;
  const restUrl = process.env.UPSTASH_REST_URL;
  const restToken = process.env.UPSTASH_REST_TOKEN;

  const message = { jobId: `smoke-${Date.now()}`, timestamp: Date.now() };

  if (redisUrl) {
    console.log("[smoke] UPSTASH_REDIS_URL detected, trying ioredis path");
    try {
      const IORedisModule = await import("ioredis").then((m) => (m && m.default ? m.default : m));
      const Redis = IORedisModule;
      const client = new Redis(redisUrl, { lazyConnect: false });
      await client.connect();
      await client.rpush(queue, JSON.stringify(message));
      console.log("[smoke] rpush OK", { queue, message });
      await client.quit();
      process.exit(0);
    } catch (err) {
      console.error("[smoke] ioredis path failed", err);
      // fallthrough to REST if possible
    }
  }

  if (restUrl && restToken) {
    console.log("[smoke] trying REST push path");
    try {
      const body = {
        queue,
        messages: [JSON.stringify(message)],
      };
      const resp = await fetch(restUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${restToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const text = await resp.text();
      if (!resp.ok) {
        console.error("[smoke] REST push failed", resp.status, text);
        process.exit(2);
      }
      console.log("[smoke] REST push OK", { queue, message, respStatus: resp.status, body: text });
      process.exit(0);
    } catch (err) {
      console.error("[smoke] REST path failed", err);
      process.exit(3);
    }
  }

  console.error("[smoke] No Upstash configuration found. Set UPSTASH_REDIS_URL or UPSTASH_REST_URL + UPSTASH_REST_TOKEN");
  process.exit(4);
})();