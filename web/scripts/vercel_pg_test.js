/**
 * vercel_pg_test.js
 *
 * Minimal test for @vercel/postgres `sql` client to verify basic connectivity.
 *
 * Usage:
 *   set -a && source web/.env.local && set +a && node web/scripts/vercel_pg_test.js
 *
 * This script intentionally performs a simple `SELECT 1` and prints diagnostic info.
 */

/**
 * @fileoverview 簡單測試 @vercel/postgres 是否能在當前環境成功連線並執行查詢。
 */
(async () => {
  try {
    const { sql } = await import("@vercel/postgres");
    console.log("[vercel_pg_test] running SELECT 1...");
    const res = await sql`SELECT 1 AS n`;
    console.log("[vercel_pg_test] raw result:", res);
    // 有些 runtime 會把 rows 放在 res.rows，也有可能是不同 shape，逐項印出以便診斷
    try {
      // @ts-expect-error - dynamic inspection for debugging
      console.log("[vercel_pg_test] result keys:", Object.getOwnPropertyNames(res));
      // @ts-expect-error
      if (res && typeof res === "object" && "rows" in res) {
        // @ts-expect-error
        console.log("[vercel_pg_test] rows:", JSON.stringify(res.rows));
      }
    } catch (inspectErr) {
      console.warn("[vercel_pg_test] inspect error:", inspectErr);
    }
    console.log("[vercel_pg_test] SELECT succeeded");
    process.exit(0);
  } catch (err) {
    console.error("[vercel_pg_test] error:");
    if (err instanceof Error) {
      console.error(err.stack ?? err.message);
    } else {
      console.error(String(err));
    }
    try {
      if (err && typeof err === "object") {
        // @ts-expect-error
        if ("query" in err) console.error("[vercel_pg_test] err.query:", err.query);
        // @ts-expect-error
        if ("params" in err) console.error("[vercel_pg_test] err.params:", err.params);
      }
    } catch (e) {
      // ignore inspection errors
    }
    process.exit(2);
  }
})();