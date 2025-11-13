/**
 * jobHandler.ts
 *
 * Worker skeleton for consuming generation_jobs from Upstash and dispatching
 * them to the text generation pipeline (StoryGenerationOrchestrator) and
 * persistence (OrchestrationPersistence).
 *
 * - 使用範例（本檔為範例 skeleton，包含可注入點與日誌/錯誤處理）：
 *   NODE_ENV=production UPSTASH_REDIS_URL="redis://..." node ./web/worker/jobHandler.ts
 *
 * 實作重點（需根據專案實際需求補足）：
 * - 在 worker 中注入可測試的 StoryGenerationOrchestrator 與 OrchestrationPersistence
 * - 以 transaction 更新 generation_jobs 的狀態（pending -> processing -> completed/failed）
 * - 當需要時呼叫 pushJobsToUpstash（已在 OrchestrationPersistence 實作）
 *
 * 函式級註解（JSDoc）已提供供後續擴充使用。
 */
import { env } from "../lib/utils/env";
import type { Pool } from "pg";

const DEFAULT_POLL_INTERVAL_MS = 2000;

/**
 * Connect to Upstash using ioredis (if UPSTASH_REDIS_URL 設定) or fail-over to REST (not implemented here).
 * 使用動態 import 以避免在未安裝 ioredis 時造成啟動錯誤（同 OrchestrationPersistence 的策略）。
 *
 * @returns Promise<{ client?: any, queueName: string }>
 */
async function connectUpstash() {
  const queueName = env.UPSTASH_QUEUE_NAME ?? "generation_jobs";
  if (env.UPSTASH_REDIS_URL) {
    try {
      const IORedisModule = await import("ioredis").then((m) => (m && (m as any).default ? (m as any).default : m));
      const Redis = IORedisModule as any;
      const client = new Redis(env.UPSTASH_REDIS_URL as string, { lazyConnect: false });
      console.info("[worker] connected to Upstash Redis via ioredis");
      return { client, queueName };
    } catch (err) {
      console.warn("[worker] failed to import/connect ioredis, will not start redis consumer", err);
      return { client: undefined, queueName };
    }
  } else {
    console.warn("[worker] UPSTASH_REDIS_URL not set — worker will not poll Redis. Configure UPSTASH_REDIS_URL to enable consumption.");
    return { client: undefined, queueName };
  }
}

/**
 * Minimal pg pool helper — uses dynamic import of pg and reads DATABASE_URL from env.
 * This mirrors the fallback pattern used elsewhere in the codebase.
 *
 * @returns Promise<Pool | undefined>
 */
async function getPgPool(): Promise<Pool | undefined> {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) {
    console.warn("[worker] no DATABASE_URL / POSTGRES_URL found — DB operations will be skipped");
    return undefined;
  }
  try {
    const { Pool: PgPool } = await import("pg");
    const pool = new PgPool({ connectionString });
    return pool as unknown as Pool;
  } catch (err) {
    console.error("[worker] failed to import pg Pool", err);
    return undefined;
  }
}

/**
 * Process a single jobId message retrieved from Upstash.
 *
 * NOTE:
 * - 本範例僅示範流程與錯誤處理框架；實際執行需實作：
 *   - 查詢 generation_jobs 欄位與 payload
 *   - 根據 payload.type 決定呼叫 Orchestrator 或其他 handler
 *   - 在 DB transaction 中更新 job 狀態與寫入 results（或呼叫 OrchestrationPersistence）
 *
 * @param jobId string job id 從 Upstash message 取得
 * @param pool pg Pool or undefined
 */
async function processJob(jobId: string, pool?: Pool) {
  console.info("[worker] processing job", { jobId });

  if (!pool) {
    console.warn("[worker] no pg pool available — skipping job processing (demo mode)");
    return;
  }

  const client = await pool.connect();
  try {
    // 1) 將 job 狀態設為 processing
    await client.query("BEGIN");
    await client.query("UPDATE generation_jobs SET status = $1, updated_at = now() WHERE id = $2", ["processing", jobId]);

    // 2) 讀取 job payload（簡化示範）
    const res = await client.query("SELECT payload, job_type FROM generation_jobs WHERE id = $1 FOR UPDATE", [jobId]);
    if (!res.rows || res.rows.length === 0) {
      throw new Error(`job not found: ${jobId}`);
    }
    const row = res.rows[0];
    const payload = row.payload as Record<string, unknown>;
    const jobType = row.job_type as string;

    console.info("[worker] job payload", { jobId, jobType, payload });

    // 3) 根據 jobType 決定處理器（此處僅示範 story_script）
    if (jobType === "story_script" || (payload && (payload as any).type === "story_script")) {
      // TODO: 注入與呼叫 StoryGenerationOrchestrator 與 OrchestrationPersistence
      // e.g. const orchestrator = new StoryGenerationOrchestrator();
      // const result = await orchestrator.run({ storyId: payload.storyId, theme: payload.theme, ... });
      // await persistGenerationResult(...)

      // Demo 行為：在 DB 中寫入一個簡短的 note 並標記為 completed
      await client.query(
        "UPDATE generation_jobs SET status = $1, result_uri = $2, updated_at = now() WHERE id = $3",
        ["completed", "demo://no-op", jobId],
      );

      console.info("[worker] demo processed job (marked completed)", { jobId });
    } else {
      // 未支援的 job type
      console.warn("[worker] unsupported job type — marking failed", { jobId, jobType });
      await client.query(
        "UPDATE generation_jobs SET status = $1, failure_reason = $2, updated_at = now() WHERE id = $3",
        ["failed", `unsupported job type: ${jobType}`, jobId],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("[worker] rollback failed", rollbackErr);
    }
    console.error("[worker] error processing job", { jobId, error: err });
    // 增加 retry_count 並決定是否重新推入佇列（此處僅示意）
    try {
      await client.query("UPDATE generation_jobs SET retry_count = retry_count + 1, status = $1, updated_at = now() WHERE id = $2", ["failed", jobId]);
    } catch (e) {
      console.error("[worker] failed to update retry_count", e);
    }
  } finally {
    try {
      client.release();
    } catch {
      // ignore
    }
  }
}

/**
 * Poll loop: 從 Upstash queue lpop 取得 message，解析後呼叫 processJob。
 *
 * message format expected: JSON.stringify({ jobId: "<uuid>", timestamp: <ms> })
 */
async function pollLoop() {
  const { client, queueName } = await connectUpstash();
  const pool = await getPgPool();

  if (!client) {
    console.warn("[worker] no redis client — exiting poll loop");
    return;
  }

  const redis = client as any;

  console.info("[worker] starting poll loop for queue", queueName);

  let running = true;
  process.on("SIGINT", () => {
    console.info("[worker] SIGINT received — shutting down");
    running = false;
  });
  process.on("SIGTERM", () => {
    console.info("[worker] SIGTERM received — shutting down");
    running = false;
  });

  while (running) {
    try {
      // 使用 LPOP 取出 single message（Upstash 支援 list ops）
      // 若需要 blocking pop 可改為 BRPOP 等待
      const raw = await redis.lpop(queueName);
      if (!raw) {
        // no message
        await new Promise((r) => setTimeout(r, DEFAULT_POLL_INTERVAL_MS));
        continue;
      }

      let parsed: { jobId?: string } | null = null;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        console.warn("[worker] failed to parse message, skipping", raw);
        continue;
      }

      if (!parsed || !parsed.jobId) {
        console.warn("[worker] invalid message shape, skipping", parsed);
        continue;
      }

      await processJob(parsed.jobId, pool);
    } catch (err) {
      console.error("[worker] poll error", err);
      // backoff on error
      await new Promise((r) => setTimeout(r, DEFAULT_POLL_INTERVAL_MS * 2));
    }
  }

  // close redis client and pg pool
  try {
    await (client as any).quit();
  } catch {
    // ignore
  }
  if (pool) {
    try {
      await pool.end();
    } catch {
      // ignore
    }
  }

  console.info("[worker] stopped");
}

/**
 * Entrypoint
 */
if (require.main === module) {
  (async () => {
    try {
      await pollLoop();
    } catch (err) {
      console.error("[worker] fatal error", err);
      process.exit(1);
    }
  })();
}
