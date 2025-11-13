import { NextResponse } from "next/server";
import { db } from "../../../../db/client";
import { generationJobs } from "../../../../db/schema";
 
/**
 * POST /api/generation/story-script
 *
 * 非同步優先版路由（建立 generation_jobs 並立即回傳 jobIds）
 *
 * Body JSON 範例：
 * {
 *   "storyId": "optional-existing-id",
 *   "theme": "A friendly dragon",
 *   "tone": "warm",
 *   "ageRange": "0-6",
 *   "scheduledAt": "2025-11-13T09:00:00.000Z",
 *   "initiatedBy": "cron" // or "admin"
 * }
 *
 * 行為：
 * - 建立一個或多個 generation_jobs（此 endpoint 以建立 story_script job 為主）
 * - 回傳 { ok: true, storyId, jobIds: ["..."] }
 *
 * 註：實際的消費者會由 worker（web/worker/）非同步取出 job 並執行故事生成流程。
 */
 
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
 
    if (!body.theme) {
      return NextResponse.json({ ok: false, error: "missing theme" }, { status: 400 });
    }
 
    // 建立或使用傳入的 storyId
    const storyId = typeof body.storyId === "string" && body.storyId.length > 0 ? body.storyId : crypto.randomUUID();
    const theme = String(body.theme);
    const tone = body.tone ?? "warm";
    const ageRange = body.ageRange ?? "0-6";
    const scheduledAt = body.scheduledAt ?? new Date().toISOString();
    const initiatedBy = body.initiatedBy ?? "manual";
 
    // Job payload contract (請參考 spec.md)
    const jobPayload = {
      type: "story_script",
      storyId,
      theme,
      tone,
      ageRange,
      scheduledAt,
      initiatedBy,
    };
 
    // 嘗試使用 Drizzle insert（開發/測試環境可能 mock 此行）
    let createdJobIds: string[] = [];
    try {
      const insertRes = await db.insert(generationJobs).values({
        storyId: storyId,
        jobType: "story_script",
        status: "pending",
        retryCount: 0,
        // Drizzle 的 jsonb 欄位接受物件，直接傳 jobPayload (非字串化)
        payload: jobPayload,
      }).returning();
      createdJobIds = Array.isArray(insertRes)
        ? insertRes.map((r) => String((r as { id: unknown }).id))
        : [];
      console.info("[route] created generation_jobs via drizzle", { storyId, createdJobIds, initiatedBy });
    } catch (drizzleErr) {
      // 若 Drizzle insert 因環境（fetch/WS）問題失敗，嘗試使用 pg pool fallback
      console.warn("[route] drizzle insert failed, attempting pg fallback", { error: drizzleErr });
      try {
        // 建立或取用全域單例 pg Pool（動態 import 以避免在未安裝 pg 時造成錯誤）
        const getPgPool = async () => {
          const g = globalThis as any;
          if (g.__pgPool && typeof g.__pgPool.connect === "function") return g.__pgPool;
          const { Pool } = await import("pg");
          const pool = new Pool({ connectionString: process.env.DATABASE_URL });
          g.__pgPool = pool;
          return pool;
        };
 
        const pool = await getPgPool();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const res = await client.query(
            `INSERT INTO generation_jobs (story_id, job_type, status, retry_count, payload)
             VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [storyId, "story_script", "pending", 0, JSON.stringify(jobPayload)],
          );
          await client.query("COMMIT");
          createdJobIds = res.rows ? res.rows.map((r: any) => String(r.id)) : [];
          console.info("[route] created generation_jobs via pg fallback", { storyId, createdJobIds, initiatedBy });
        } catch (pgErr) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // ignore rollback error
          }
          console.error("[route] pg fallback insert failed", pgErr);
          throw pgErr;
        } finally {
          try {
            client.release();
          } catch {
            // ignore
          }
        }
      } catch (fallbackErr) {
        console.error("[route] both drizzle and pg fallback failed", { drizzleErr, fallbackErr });
        // 回傳錯誤給呼叫端（勿回傳敏感資訊）
        return NextResponse.json({ ok: false, error: "database insert failed" }, { status: 500 });
      }
    }
 
    return NextResponse.json({ ok: true, storyId, jobIds: createdJobIds }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[route] generation/story-script (async) failed", { error: err });
    return NextResponse.json({ ok: false, error: message || "unknown error" }, { status: 500 });
  }
}