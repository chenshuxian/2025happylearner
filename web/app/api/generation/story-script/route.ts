import { NextResponse } from "next/server";
import { StoryGenerationOrchestrator } from "../../../../lib/openai/StoryGenerationOrchestrator";
import { persistGenerationResult } from "../../../../lib/openai/OrchestrationPersistence";

/**
 * POST /api/generation/story-script
 *
 * 由管理者或 Cron 觸發的同步測試端點（注意：實際上線應改為非同步佇列）
 * Body JSON 範例：
 * {
 *   "storyId": "optional-existing-id",
 *   "theme": "A friendly dragon",
 *   "tone": "warm",
 *   "ageRange": "0-6"
 * }
 *
 * 路由流程（測試/管理介面模式）：
 * 1) 呼叫 StoryGenerationOrchestrator 生成文字階段（同步）
 * 2) 將生成結果落地：寫入 stories / story_pages / vocab_entries 並建立 media generation jobs
 * 3) 若已設定 Upstash，將媒體 job id 推入 Queue 供 Worker 非同步處理
 *
 * 生產環境建議：直接建立 generation_jobs 並回傳 job id，將實際生成推入 worker 非同步處理以避免超時與高額成本。
 */

/** POST handler */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    if (!body.theme) {
      return NextResponse.json({ ok: false, error: "missing theme" }, { status: 400 });
    }

    const payload = {
      storyId: body.storyId ?? crypto.randomUUID(),
      theme: String(body.theme),
      tone: body.tone ?? "warm",
      ageRange: body.ageRange ?? "0-6",
      regenerate: body.regenerate === true,
    };

    const orchestrator = new StoryGenerationOrchestrator();

    // 同步執行文字生成（注意：在生產環境請避免長時間同步呼叫）
    const result = await orchestrator.run(payload);

    // 將結果落地並建立媒體 generation jobs（transaction 保證一致性）
    const createdJobIds = await persistGenerationResult(
      payload.storyId,
      payload.theme,
      result.story,
      result.translation,
      result.vocabulary,
    );

    return NextResponse.json(
      {
        ok: true,
        storyId: payload.storyId,
        result,
        createdJobIds,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    // 使用 unknown 並安全取得錯誤訊息，避免使用 any
    const message = err instanceof Error ? err.message : String(err);
    console.error("[route] generation/story-script failed", { error: err });
    return NextResponse.json(
      {
        ok: false,
        error: message || "unknown error",
      },
      { status: 500 },
    );
  }
}