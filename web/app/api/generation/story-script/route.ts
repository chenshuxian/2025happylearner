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
 
    // 使用 drizzle db insert 建立 generation job（status = pending）
    // 在測試環境可能會被 mock，因此以 db.insert(...).values(...).returning() 寫法為主
    const insertRes = await db.insert(generationJobs).values({
      storyId: storyId,
      jobType: "story_script",
      status: "pending",
      retryCount: 0,
      // Drizzle 的 jsonb 欄位接受物件，直接傳 jobPayload (非字串化)
      payload: jobPayload,
    }).returning();
 
    // insertRes 型態視 db client 而定，統一轉為 string id 陣列
    const createdJobIds = Array.isArray(insertRes)
      ? insertRes.map((r) => String((r as { id: unknown }).id))
      : [];
 
    console.info("[route] created generation_jobs", { storyId, createdJobIds, initiatedBy });
 
    return NextResponse.json({ ok: true, storyId, jobIds: createdJobIds }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[route] generation/story-script (async) failed", { error: err });
    return NextResponse.json({ ok: false, error: message || "unknown error" }, { status: 500 });
  }
}