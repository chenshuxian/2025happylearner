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

/**
 * Main smoke runner (supports ioredis client, Queues-style REST, and Redis REST command-style fallback)
 *
 * The script will:
 *  - If UPSTASH_REDIS_URL is provided, attempt to use ioredis to RPUSH a single message.
 *  - Otherwise if UPSTASH_REST_URL + UPSTASH_REST_TOKEN are provided, attempt:
 *      1) Queues-style POST { queue, messages }
 *      2) If non-2xx or body indicates parse error, fallback to Redis command-style POST { command: ["RPUSH", queue, ...messages] }
 *
 * Env:
 *  - UPSTASH_REDIS_URL
 *  - UPSTASH_REST_URL
 *  - UPSTASH_REST_TOKEN
 *  - UPSTASH_QUEUE_NAME
 */

/**
 * Perform a REST POST to the provided URL with given headers and body, returning { ok, status, bodyText }.
 * @param {string} url - REST endpoint
 * @param {Record<string,string>} headers - HTTP headers
 * @param {unknown} bodyObj - Body object to JSON.stringify
 * @returns {Promise<{ok:boolean,status:number,bodyText:string}>}
 */
async function postJson(url, headers, bodyObj) {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyObj),
    });
    const bodyText = await resp.text().catch(() => "<no body>");
    return { ok: resp.ok, status: resp.status, bodyText };
  } catch (err) {
    return { ok: false, status: 0, bodyText: String(err) };
  }
}

(async () => {
  const queue = process.env.UPSTASH_QUEUE_NAME ?? "generation_jobs";
  const redisUrl = process.env.UPSTASH_REDIS_URL;
  const restUrl = process.env.UPSTASH_REST_URL;
  const restToken = process.env.UPSTASH_REST_TOKEN;

  const message = { jobId: `smoke-${Date.now()}`, timestamp: Date.now() };

  // 1) Try ioredis path if configured
  if (redisUrl) {
    console.log("[smoke] UPSTASH_REDIS_URL detected, trying ioredis client path");
    try {
      const IORedisModule = await import("ioredis").then((m) => (m && m.default ? m.default : m));
      const Redis = IORedisModule;
      // prefer lazyConnect so constructor does not immediately attempt network ops;
      // however, some mocks/implementations may ignore options — only call connect() if available.
      const client = new Redis(redisUrl, { lazyConnect: true });
      try {
        if (typeof client.connect === "function") {
          await client.connect();
          console.log("[smoke] ioredis connect successful");
        } else {
          console.log("[smoke] ioredis client has no connect() method, assuming constructor handled connection");
        }

        await client.rpush(queue, JSON.stringify(message));
        console.log("[smoke] rpush OK", { queue, message });
        try {
          if (typeof client.quit === "function") await client.quit();
        } catch (qErr) {
          console.warn("[smoke] client.quit() failed", qErr);
        }
        process.exit(0);
      } catch (opErr) {
        console.error("[smoke] ioredis operation failed", opErr);
        try {
          if (typeof client.quit === "function") await client.quit();
        } catch {
          // ignore
        }
        // fallthrough to REST attempts
      }
    } catch (err) {
      console.error("[smoke] dynamic import ioredis or client instantiation failed", err);
      // fallthrough to REST attempts
    }
  }

  // 2) REST path (supports queues-style and redis command-style fallback)
  if (restUrl && restToken) {
    console.log("[smoke] UPSTASH_REST_URL detected, trying REST push path (queues-style then command-style fallback)");
    const headers = {
      Authorization: `Bearer ${restToken}`,
      "Content-Type": "application/json",
    };

    // queues-style
    const queuesBody = { queue, messages: [JSON.stringify(message)] };
    const res1 = await postJson(restUrl, headers, queuesBody);
    console.log("[smoke] REST attempt (queues-style) -> status:", res1.status, "body:", res1.bodyText);

    // if success, finish
    if (res1.ok) {
      console.log("[smoke] REST push (queues-style) OK", { queue, message, status: res1.status });
      process.exit(0);
    }

    // determine if we should attempt command-style fallback:
    // - non-2xx AND not an auth error (401/403)
    // - or body contains parser error hints e.g., "ERR failed to parse command"
    const bodyLower = (res1.bodyText || "").toLowerCase();
    const looksLikeParseError =
      bodyLower.includes("failed to parse") || bodyLower.includes("parse error") || bodyLower.includes("err failed to parse command");

    if (res1.status === 401 || res1.status === 403) {
      console.error("[smoke] REST queues-style returned auth error, aborting fallback (status)", res1.status);
      process.exit(2);
    }

    if (!res1.ok && (looksLikeParseError || res1.status === 400 || res1.status === 422 || res1.status === 0)) {
      console.log("[smoke] Will attempt Redis REST command-style fallback due to non-ok response or parse-like error");
      const commandBody = { command: ["RPUSH", queue, JSON.stringify(message)] };
      const res2 = await postJson(restUrl, headers, commandBody);
      console.log("[smoke] REST attempt (command-style) -> status:", res2.status, "body:", res2.bodyText);

      if (res2.ok) {
        console.log("[smoke] REST push (command-style) OK", { queue, message, status: res2.status });
        process.exit(0);
      } else {
        console.error("[smoke] REST command-style push failed", { status: res2.status, body: res2.bodyText });
        process.exit(3);
      }
    }

    // If we reach here, we didn't attempt command fallback or it wasn't allowed
    console.error("[smoke] REST queues-style push failed and command-style fallback not attempted", { status: res1.status, body: res1.bodyText });
    process.exit(2);
  }

  console.error("[smoke] No Upstash configuration found. Set UPSTASH_REDIS_URL or UPSTASH_REST_URL + UPSTASH_REST_TOKEN");
  process.exit(4);
})();