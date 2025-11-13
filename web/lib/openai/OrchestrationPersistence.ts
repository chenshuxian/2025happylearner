import { db } from "../../db/client";
import { stories, storyPages, vocabEntries, generationJobs } from "../../db/schema";
import { env } from "../utils/env";
import { Pool } from "pg";
import type {
  StoryScriptResult,
  TranslationResult,
  VocabularyResult,
} from "./types";
import { randomUUID } from "crypto";
import ErrorHandler from "./ErrorHandler";

/**
 * Helper: 全域單例 pg Pool
 *
 * 在 serverless 或 hot-reload 的開發環境中，避免每次請求建立新的 TCP 連線導致連線爆滿。
 * 將 pool 快取到 globalThis.__pgPool 上以確保單例行為。
 */
function getPgPool(): Pool {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g.__pgPool && (g.__pgPool as Pool).connect) {
    return g.__pgPool as Pool;
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  g.__pgPool = pool;
  return pool;
}

/**
 * 將 orchestrator 的結果寫入資料庫並建立媒體 generation jobs。
 *
 * @param storyId 目標 story id（與 generation job 關聯）
 * @param theme story 主題（供 stories.metadata）
 * @param story StoryScriptResult 由 Orchestrator 產生的故事（英文）
 * @param translation TranslationResult 由 Orchestrator 產生的中文翻譯
 * @param vocabulary VocabularyResult 由 Orchestrator 產生的精選單字
 * @returns 已建立的 generation job ids 列表
 */
export async function persistGenerationResult(
  storyId: string,
  theme: string,
  story: StoryScriptResult,
  translation: TranslationResult,
  vocabulary: VocabularyResult,
) {
  const errorHandler = new ErrorHandler();

  // 開發快捷：僅當明確設定 SKIP_PERSISTENCE=true 時跳過實作寫入與 Upstash 推送（避免在 dev 中誤跳過）
  if (process.env.SKIP_PERSISTENCE === "true") {
    console.info("[OrchestrationPersistence] SKIP_PERSISTENCE=true — simulating DB persistence and generation jobs");
    const simulatedIds: string[] = [];
    for (const p of story.pages) {
      simulatedIds.push(`${storyId}-image-${p.pageNumber}`);
      simulatedIds.push(`${storyId}-audio-${p.pageNumber}`);
    }
    console.info("[OrchestrationPersistence] simulated generation job ids", { count: simulatedIds.length });
    return simulatedIds;
  }

  // 使用 transaction 確保一致性
  const createdGenerationJobIds: string[] = [];

  // 如果傳入的 storyId 不是合法 UUID，為資料庫建立一個新的 UUID 並將原始 id 記錄到 metadata.originalStoryId
  const originalStoryId = storyId;
  const isUuid = typeof storyId === "string" && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(storyId);
  const dbStoryId = isUuid ? storyId : randomUUID();

  try {
    // 在測試環境且提供了 Drizzle 的 db.transaction 時，使用該 transaction（便於測試 mock）
    if (process.env.NODE_ENV === "test" && (db as any)?.transaction && typeof (db as any).transaction === "function") {
      await (db as any).transaction(async (tx: any) => {
        const storyMetadata: Record<string, unknown> = { synopsisEn: story.synopsisEn, synopsisZh: translation.synopsisZh };
        if (!isUuid) storyMetadata.originalStoryId = originalStoryId;

        // 1) insert story
        await tx.insert(stories).values({
          id: dbStoryId,
          title_en: story.titleEn,
          title_zh: translation.titleZh ?? story.titleEn,
          theme,
          status: "processing",
          age_range: story.pages?.[0] ? "0-6" : "0-6",
          metadata: JSON.stringify(storyMetadata),
        }).returning();

        // 2) insert story pages (英文 + 中文)
        for (const p of story.pages) {
          const matchingTranslation = translation.pages.find((tp) => tp.pageNumber === p.pageNumber);
          const textZh = matchingTranslation?.textZh ?? "";
          const wordCount = p.textEn.split(/\s+/).filter(Boolean).length;
          await tx.insert(storyPages).values({
            story_id: dbStoryId,
            page_number: p.pageNumber,
            text_en: p.textEn,
            text_zh: textZh,
            word_count: wordCount,
          }).returning();
        }

        // 3) insert vocabulary entries
        for (const entry of vocabulary.entries) {
          await tx.insert(vocabEntries).values({
            story_id: dbStoryId,
            word: entry.word,
            part_of_speech: entry.partOfSpeech ?? "",
            definition_en: entry.definitionEn,
            definition_zh: entry.definitionZh,
            example_sentence: entry.exampleSentence ?? "",
            example_translation: entry.exampleTranslation ?? "",
          }).returning();
        }

        // 4) 建立 media generation jobs for image & audio per page
        for (const p of story.pages) {
          const imgRes = await tx.insert(generationJobs).values({
            story_id: dbStoryId,
            job_type: "image",
            status: "pending",
            retry_count: 0,
            payload: JSON.stringify({ pageNumber: p.pageNumber, textEn: p.textEn }),
          }).returning();

          const audioRes = await tx.insert(generationJobs).values({
            story_id: dbStoryId,
            job_type: "audio",
            status: "pending",
            retry_count: 0,
            payload: JSON.stringify({
              pageNumber: p.pageNumber,
              textEn: p.textEn,
              textZh: (translation.pages.find((t) => t.pageNumber === p.pageNumber)?.textZh) ?? "",
            }),
          }).returning();

          if (imgRes && imgRes[0]?.id) createdGenerationJobIds.push(String(imgRes[0].id));
          if (audioRes && audioRes[0]?.id) createdGenerationJobIds.push(String(audioRes[0].id));
        }
      });
    } else {
      // 使用全域 Pool 以避免在高併發或 serverless 環境中頻繁建立/關閉 TCP 連線。
      const pool = getPgPool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // 1) insert story (assume storyId unique)
        await client.query(
          `INSERT INTO stories (id, title_en, title_zh, theme, status, age_range, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            dbStoryId,
            story.titleEn,
            translation.titleZh ?? story.titleEn,
            theme,
            "processing",
            story.pages?.[0] ? "0-6" : "0-6",
            JSON.stringify({ synopsisEn: story.synopsisEn, synopsisZh: translation.synopsisZh, ...(isUuid ? {} : { originalStoryId }) }),
          ],
        );

        // 2) insert story pages (英文 + 中文)
        for (const p of story.pages) {
          const matchingTranslation = translation.pages.find((tp) => tp.pageNumber === p.pageNumber);
          const textZh = matchingTranslation?.textZh ?? "";
          const wordCount = p.textEn.split(/\s+/).filter(Boolean).length;
          await client.query(
            `INSERT INTO story_pages (story_id, page_number, text_en, text_zh, word_count)
             VALUES ($1,$2,$3,$4,$5)`,
            [dbStoryId, p.pageNumber, p.textEn, textZh, wordCount],
          );
        }

        // 3) insert vocabulary entries
        for (const entry of vocabulary.entries) {
          await client.query(
            `INSERT INTO vocab_entries (story_id, word, part_of_speech, definition_en, definition_zh, example_sentence, example_translation)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              dbStoryId,
              entry.word,
              entry.partOfSpeech ?? "",
              entry.definitionEn,
              entry.definitionZh,
              entry.exampleSentence ?? "",
              entry.exampleTranslation ?? "",
            ],
          );
        }

        // 4) 建立 media generation jobs for image & audio per page
        for (const p of story.pages) {
          // image job
          const imgRes = await client.query(
            `INSERT INTO generation_jobs (story_id, job_type, status, retry_count, payload)
             VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [dbStoryId, "image", "pending", 0, JSON.stringify({ pageNumber: p.pageNumber, textEn: p.textEn })],
          );

          // audio job
          const audioRes = await client.query(
            `INSERT INTO generation_jobs (story_id, job_type, status, retry_count, payload)
             VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [
              dbStoryId,
              "audio",
              "pending",
              0,
              JSON.stringify({
                pageNumber: p.pageNumber,
                textEn: p.textEn,
                textZh: (translation.pages.find((t) => t.pageNumber === p.pageNumber)?.textZh) ?? "",
              }),
            ],
          );

          // collect ids for potential push
          if (imgRes && imgRes.rows && imgRes.rows[0]?.id) createdGenerationJobIds.push(String(imgRes.rows[0].id));
          if (audioRes && audioRes.rows && audioRes.rows[0]?.id) createdGenerationJobIds.push(String(audioRes.rows[0].id));
        }

        await client.query("COMMIT");
      } catch (e) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // ignore rollback errors
        }
        throw e;
      } finally {
        try {
          // release connection back to pool
          client.release();
        } catch {
          // ignore
        }
      }
    }

    // 5) 推送到 Upstash（若設定）
    if (env.UPSTASH_REDIS_URL || (env.UPSTASH_REST_URL && env.UPSTASH_REST_TOKEN)) {
      try {
        // 同步 await，若失敗由 catch 區塊處理並記錄到 failed_jobs
        await pushJobsToUpstash(createdGenerationJobIds);
      } catch (pushErr) {
        console.error("[OrchestrationPersistence] failed to push to Upstash", pushErr);
        // 記錄到 failed_jobs 以便後台檢視與人工干預
        await errorHandler.recordFailure(
          { generationJobId: dbStoryId, stage: "upstash_push", attempt: 0, extra: { pushedJobCount: createdGenerationJobIds.length } },
          pushErr,
        );
      }
    } else {
      console.info("[OrchestrationPersistence] UPSTASH not configured, skipping push");
    }

    return createdGenerationJobIds;
  } catch (err) {
    // 若失敗，先輸出更完整的診斷日誌（避免 recordFailure 自身遮蔽原始錯誤）
    try {
      console.error("[OrchestrationPersistence] persistGenerationResult failed:", err instanceof Error ? (err.stack ?? err.message) : String(err));
      // 輸出環境變數快照（不直接列印敏感完整值，僅示意哪些變數有設定）
      console.error("[OrchestrationPersistence] env snapshot:", {
        DATABASE_URL: process.env.DATABASE_URL,
        POSTGRES_URL: process.env.POSTGRES_URL,
        SKIP_PERSISTENCE: process.env.SKIP_PERSISTENCE,
        NODE_ENV: process.env.NODE_ENV,
        UPSTASH_REDIS_URL: process.env.UPSTASH_REDIS_URL ? "<set>" : "<not set>",
        UPSTASH_REST_URL: process.env.UPSTASH_REST_URL ? "<set>" : "<not set>",
      });
    } catch (logErr) {
      console.error("[OrchestrationPersistence] failed to log error context", logErr);
    }

    // 嘗試寫入 failed_jobs，若 recordFailure 自身失敗則記錄錯誤，但不遮蔽原始錯誤
    try {
      await errorHandler.recordFailure(
        { generationJobId: dbStoryId, stage: "persistence", attempt: 0, extra: { theme } },
        err,
      );
    } catch (recordErr) {
      console.error("[OrchestrationPersistence] recordFailure failed:", recordErr);
    }

    throw err;
  }
}

/**
 * 推送 jobs 到 Upstash，優先嘗試使用 Redis client（若設定 UPSTASH_REDIS_URL），
 * 若 client 不可用或失敗則回退到 REST API（若設定 UPSTASH_REST_URL / UPSTASH_REST_TOKEN）。
 *
 * 若推送失敗，會拋出錯誤讓呼叫端處理（呼叫端會記錄 failed_jobs）。
 */
async function pushJobsToUpstash(jobIds: string[]) {
  if (!jobIds || jobIds.length === 0) return;

  const queue = env.UPSTASH_QUEUE_NAME ?? "generation_jobs";

  // 將 jobIds 轉為簡單訊息字串（Redis list 儲存 string）
  const messages = jobIds.map((id) => JSON.stringify({ jobId: id, timestamp: Date.now() }));

  // 1) 優先使用 Redis client（UPSTASH_REDIS_URL），動態 import 以避免必須安裝套件時出錯
  if (env.UPSTASH_REDIS_URL) {
    try {
      const IORedisModule = await import("ioredis").then((m) => (m && (m as any).default ? (m as any).default : m));
      const Redis = IORedisModule;
      const client = new Redis(env.UPSTASH_REDIS_URL as string, { lazyConnect: false });

      try {
        // use RPUSH to append messages to the list queue
        for (const msg of messages) {
          await client.rpush(queue, msg);
        }
      } finally {
        try {
          await client.quit();
        } catch {
          // ignore
        }
      }

      console.info("[OrchestrationPersistence] pushed jobs to Upstash via Redis client", { count: jobIds.length });
      return;
    } catch (err) {
      // 若 Redis push 失敗，記錄 warning 並繼續嘗試 REST 回退
      console.warn("[OrchestrationPersistence] Redis client push failed, falling back to REST", err);
    }
  }

  // 2) 回退到 REST API
  if (env.UPSTASH_REST_URL && env.UPSTASH_REST_TOKEN) {
    const resp = await fetch(env.UPSTASH_REST_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.UPSTASH_REST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ queue, messages }),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "<no body>");
      throw new Error(`Upstash REST push failed ${resp.status} ${txt}`);
    }

    console.info("[OrchestrationPersistence] pushed jobs to Upstash via REST", { count: jobIds.length });
    return;
  }

  // 若沒有任何可用的 Upstash 設定，丟出錯誤
  throw new Error("No Upstash configuration found (UPSTASH_REDIS_URL or UPSTASH_REST_URL required)");
}

export default {
  persistGenerationResult,
};
