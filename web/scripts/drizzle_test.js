/**
 * drizzle_test.js
 *
 * 測試用途：使用 drizzle-orm/vercel-postgres 與 @vercel/postgres 建立 db 實例，
 * 並呼叫 db.transaction() 來刻意觸發 BEGIN，觀察是否會出現與 API 相同的
 * "Failed query: begin" / connection refused 類型錯誤。
 *
 * 使用方式：
 *   set -a && source web/.env.local && set +a && node web/scripts/drizzle_test.js
 *
 * 此腳本不會對現有資料表做變更，transaction 內不包含 INSERT（僅觸發 BEGIN）。
 */

(async () => {
  try {
    // 動態 import 以支援 ESM 套件與避免 require 問題
    const { drizzle } = await import("drizzle-orm/vercel-postgres");
    const { sql } = await import("@vercel/postgres");

    // 建立簡單的 Drizzle 實例（不傳入完整 schema）
    const db = drizzle(sql, { schema: {} });

    console.log("[drizzle_test] starting transaction test...");

    // 嘗試執行一個 transaction（僅觸發 BEGIN）
    await db.transaction(async (tx) => {
      console.log("[drizzle_test] inside transaction callback (no-op) - should have executed BEGIN already");
      // 不做任何 DB mutation，僅停留於 transaction callback
    });

    console.log("[drizzle_test] transaction completed successfully");
    process.exit(0);
  } catch (err) {
    console.error("[drizzle_test] transaction failed:");
    if (err instanceof Error) {
      console.error(err.stack ?? err.message);
    } else {
      console.error(String(err));
    }
    // 若有內部 .query / .params 等，嘗試印出以便診斷
    try {
      // @ts-ignore
      if (err && typeof err === "object" && "query" in err) {
        // @ts-ignore
        console.error("[drizzle_test] err.query:", err.query);
      }
      // @ts-ignore
      if (err && typeof err === "object" && "params" in err) {
        // @ts-ignore
        console.error("[drizzle_test] err.params:", err.params);
      }
    } catch (e) {
      // ignore
    }
    process.exit(2);
  }
})();