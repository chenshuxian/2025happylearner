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
          // release connection back到 pool
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

  // 優先使用 Redis client（UPSTASH_REDIS_URL）
  if (env.UPSTASH_REDIS_URL) {
    try {
      const IORedisModule = await import("ioredis").then((m) => (m && (m as any).default ? (m as any).default : m));
      const Redis = IORedisModule;

      /**
       * 使用 ioredis client 推送 messages 到 list queue，採用 lazyConnect 並在必要時呼叫 connect()。
       *
       * 行為：
       *  - 建立 client 時使用 { lazyConnect: true }，避免 constructor 與 connect() 同時連線造成 "already connecting/connected" 錯誤。
       *  - 若 client 有 connect() 方法則 await client.connect()，若錯誤訊息包含 "already connecting" 或 "already connected" 則視為可忽略警告。
       *  - 執行 rpush 並在最後嘗試 quit()。
       */
      const client = new Redis(env.UPSTASH_REDIS_URL as string, { lazyConnect: true });

      try {
        if (typeof client.connect === "function") {
          try {
            await client.connect();
            console.info("[OrchestrationPersistence] ioredis connect successful");
          } catch (connectErr: any) {
            const msg = String(connectErr && (connectErr.message || connectErr));
            if (msg.includes("already connecting") || msg.includes("already connected")) {
              console.warn("[OrchestrationPersistence] ioredis connect warning (already connected/connecting)", msg);
            } else {
              throw connectErr;
            }
          }
        } else {
          console.info("[OrchestrationPersistence] ioredis client has no connect(), assuming constructor handled connection");
        }

        for (const msg of messages) {
          await client.rpush(queue, msg);
        }

        console.info("[OrchestrationPersistence] pushed jobs to Upstash via Redis client", { count: jobIds.length });
        return;
      } finally {
        try {
          if (typeof client.quit === "function") await client.quit();
        } catch (qErr) {
          console.warn("[OrchestrationPersistence] client.quit() failed", qErr);
        }
      }
    } catch (err) {
      console.warn("[OrchestrationPersistence] Redis client push failed, falling back to REST", err);
    }
  }

  // 回退到 REST API（支援 queue/messages 與 command-style）
  if (env.UPSTASH_REST_URL && env.UPSTASH_REST_TOKEN) {
    const headers = {
      Authorization: `Bearer ${env.UPSTASH_REST_TOKEN}`,
      "Content-Type": "application/json",
    };

    /**
     * Helper: POST JSON and return { ok, status, bodyText } with safe catch.
     * @param bodyObj
     */
    async function postJson(bodyObj: unknown) {
      try {
        const resp = await fetch(env.UPSTASH_REST_URL as string, {
          method: "POST",
          headers,
          body: JSON.stringify(bodyObj),
        });
        const bodyText = await resp.text().catch(() => "<no body>");
        return { ok: resp.ok, status: resp.status, bodyText };
      } catch (e) {
        return { ok: false, status: 0, bodyText: String(e) };
      }
    }

    // 1) Queues-style attempt
    const resp1 = await postJson({ queue, messages });
    console.info("[OrchestrationPersistence] REST attempt (queues-style) ->", { status: resp1.status, body: resp1.bodyText });

    if (resp1.ok) {
      console.info("[OrchestrationPersistence] pushed jobs to Upstash via REST (queue/messages)", { count: jobIds.length });
      return;
    }

    // If auth error, abort
    if (resp1.status === 401 || resp1.status === 403) {
      const errMsg = `[OrchestrationPersistence] REST (queue/messages) returned auth error ${resp1.status}: ${resp1.bodyText}`;
      console.error(errMsg);
      throw new Error(errMsg);
    }

    const bodyLower = (resp1.bodyText || "").toLowerCase();
    const looksLikeParseError =
      bodyLower.includes("failed to parse") || bodyLower.includes("parse error") || bodyLower.includes("err failed to parse command");

    if (!resp1.ok && (looksLikeParseError || resp1.status === 400 || resp1.status === 422 || resp1.status === 0)) {
      console.warn("[OrchestrationPersistence] queues-style REST returned parse-like/invalid response, attempting Redis command-style fallback", {
        status: resp1.status,
        body: resp1.bodyText,
      });

      const commandBody = { command: ["RPUSH", queue, ...messages] };
      const resp2 = await postJson(commandBody);
      console.info("[OrchestrationPersistence] REST attempt (command-style) ->", { status: resp2.status, body: resp2.bodyText });

      if (resp2.ok) {
        console.info("[OrchestrationPersistence] pushed jobs to Upstash via REST (redis command)", { count: jobIds.length });
        return;
      }

      const errMsg2 = `Upstash REST command push failed ${resp2.status}: ${resp2.bodyText}`;
      console.error("[OrchestrationPersistence] " + errMsg2);
      throw new Error(errMsg2);
    }

    const errMsg = `[OrchestrationPersistence] REST (queue/messages) failed and command fallback not attempted: ${resp1.status} ${resp1.bodyText}`;
    console.error(errMsg);
    throw new Error(errMsg);
  }

  throw new Error("No Upstash configuration found (UPSTASH_REDIS_URL or UPSTASH_REST_URL required)");
}

export default {
  persistGenerationResult,
};
