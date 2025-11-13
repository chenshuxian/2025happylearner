import type { Env } from "../lib/utils/env";
import { claimJob, getJob, markJobCompleted, markJobFailed, incrementRetry, insertMediaAssetIfNotExists } from "./db";
import { callImageProvider } from "./providers/imageProvider";
import { callTTSProvider } from "./providers/ttsProvider";
import { composeVideo } from "./videoComposer";
import { uploadLocalFile } from "./blobUploader";

/**
 * Minimal representation of a generation_jobs row used by the worker.
 */
interface GenerationJobRow {
  id: string;
  story_id: string;
  page_id?: string | null;
  job_type: "image" | "audio" | "video" | string;
  payload: Record<string, unknown>;
  retry_count: number;
}

/**
 * Normalize unknown DB row into GenerationJobRow if possible.
 * Returns null when required fields are missing or types mismatch.
 */
function normalizeGenerationJobRow(row: unknown): GenerationJobRow | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : undefined;
  const story_id = typeof r.story_id === "string" ? r.story_id : undefined;
  const job_type = typeof r.job_type === "string" ? r.job_type : undefined;
  const payload = typeof r.payload === "object" && r.payload !== null ? (r.payload as Record<string, unknown>) : {};
  const retry_count = typeof r.retry_count === "number" ? r.retry_count : (typeof r.retry_count === "bigint" ? Number(r.retry_count) : undefined);

  if (!id || !story_id || !job_type || retry_count === undefined) return null;

  return {
    id,
    story_id,
    page_id: typeof r.page_id === "string" ? (r.page_id as string) : null,
    job_type: job_type as GenerationJobRow["job_type"],
    payload,
    retry_count,
  };
}

/**
 * JobHandler
 *
 * 處理單一 generation_job 的主要邏輯：
 * - claim job
 * - 根據 jobType 路由呼叫 provider
 * - 插入 media_assets 並更新 generation_jobs
 */
export class JobHandler {
  private maxRetries: number;
  private backoffBaseMs: number;

  constructor(private dbClient: unknown, private env: Env) {
    this.maxRetries = Number(process.env.WORKER_MAX_RETRIES ?? "3");
    this.backoffBaseMs = Number(process.env.WORKER_BACKOFF_BASE_MS ?? "2000");
  }

  /**
   * 處理 job
   * @param jobId generation_jobs.id
   */
  async handle(jobId: string): Promise<void> {
    // claim job atomically
    const claimed = await claimJob(jobId);
    if (!claimed) {
      console.info("[JobHandler] job not claimable or already processed", { jobId });
      return;
    }
 
    // normalize and validate claimed row into GenerationJobRow
    const maybeJob = normalizeGenerationJobRow(claimed);
    if (!maybeJob) {
      console.error("[JobHandler] claimed row is not a valid GenerationJobRow", { jobId, row: claimed });
      await markJobFailed(jobId, "invalid_job_row_shape");
      return;
    }
    const job = maybeJob;
    const jobType = job.job_type;
    const payload = job.payload ?? {};

    try {
      if (jobType === "image") {
        const result = await this.handleImage(job, payload);
        // runtime guard: ensure uri is a string before passing to markJobCompleted
        if (result && typeof (result as Record<string, unknown>).uri === "string") {
          await markJobCompleted(jobId, String((result as Record<string, unknown>).uri));
        } else {
          await markJobFailed(jobId, "image provider returned no asset");
        }
      } else if (jobType === "audio") {
        const result = await this.handleAudio(job, payload);
        if (result && typeof (result as Record<string, unknown>).uri === "string") {
          await markJobCompleted(jobId, String((result as Record<string, unknown>).uri));
        } else {
          await markJobFailed(jobId, "tts provider returned no asset");
        }
      } else if (jobType === "video") {
        // Video job handling:
        // payload expected: { imageUris: string[], audioUri?: string, perPageDurations?: number[] }
        const imageUris = (payload["imageUris"] as string[]) ?? [];
        const audioUri = (payload["audioUri"] as string) ?? undefined;
        const perPageDurations = (payload["perPageDurations"] as number[]) ?? undefined;

        if (imageUris.length === 0) {
          await markJobFailed(jobId, "video job missing imageUris");
        } else {
          // 1) compose video (local file path)
          const composeRes = await composeVideo({
            imageUris,
            audioUri,
            perPageDurations,
            outputDir: undefined,
            outputFilename: `story_video_${jobId}`,
            format: "mp4",
          });

          // 2) upload result to blob storage (local uploader used as fallback)
          const uploadRes = await uploadLocalFile(composeRes.uri, { filename: `story_video_${jobId}.${composeRes.format}` });

          // 3) insert media asset
          await insertMediaAssetIfNotExists({
            story_id: job.story_id,
            page_id: job.page_id ?? null,
            type: "video",
            uri: uploadRes.uri,
            format: composeRes.format,
            metadata: composeRes.metadata ?? {},
            generation_job_id: job.id,
          });

          // 4) mark completed with uploaded URI
          await markJobCompleted(jobId, uploadRes.uri);
        }
      } else {
        await markJobFailed(jobId, `unknown job type: ${jobType}`);
      }
    } catch (err: unknown) {
      console.error("[JobHandler] processing error", { jobId, error: String(err) });
      await this.handleFailure(jobId, err);
    }
  }

  private async handleImage(job: GenerationJobRow, payload: Record<string, unknown>) {
    // payload expected: { storyId, pageNumber, textEn, textZh, promptOverrides? }
    const prompt = (payload["prompt"] as string) ?? (payload["textEn"] as string) ?? "illustration";
    const size = (payload["size"] as string) ?? "1024x1024";
    const providerResp = await callImageProvider({ prompt, size }, this.env);
    // providerResp: { uri, format, metadata? }
    const asset = await insertMediaAssetIfNotExists({
      story_id: job.story_id,
      page_id: job.page_id ?? null,
      type: "image",
      uri: providerResp.uri,
      format: providerResp.format ?? "png",
      metadata: providerResp.metadata ?? {},
      generation_job_id: job.id,
    });
    return asset;
  }

  private async handleAudio(job: GenerationJobRow, payload: Record<string, unknown>) {
    // payload expected: { storyId, pageNumber, textEn, textZh, voice? }
    const text = (payload["textZh"] as string) ?? (payload["textEn"] as string) ?? "";
    const voice = (payload["voice"] as string) ?? "default";
    const format = (payload["format"] as string) ?? "mp3";
    const providerResp = await callTTSProvider({ text, voice, format: format as "mp3" | "wav" }, this.env);
    const asset = await insertMediaAssetIfNotExists({
      story_id: job.story_id,
      page_id: job.page_id ?? null,
      type: "audio",
      uri: providerResp.uri,
      format: providerResp.format ?? "mp3",
      metadata: providerResp.metadata ?? {},
      generation_job_id: job.id,
    });
    return asset;
  }

  /**
   * 將 unknown 型別的錯誤轉為可供紀錄/回傳的字串
   * @param err
   */
  private errorMessage(err: unknown): string {
    if (err === undefined || err === null) return String(err);
    if (typeof err === "string") return err;
    if (typeof err === "object") {
      const maybeMsg = (err as { message?: unknown }).message;
      if (typeof maybeMsg === "string") return maybeMsg;
      try {
        return JSON.stringify(err);
      } catch {
        return String(err);
      }
    }
    return String(err);
  }

  private async handleFailure(jobId: string, err: unknown) {
    // increment retry count
    await incrementRetry(jobId);
    const job = await getJob(jobId);
    const retryCount = (job?.retry_count as number) ?? 0;
    const msg = this.errorMessage(err);

    if (retryCount < this.maxRetries) {
      // temporary error: mark job as pending again or requeue by external system.
      // Here we mark failed with a temporary tag to make the error visible; orchestration can requeue.
      await markJobFailed(jobId, `temporary_error: ${msg}`);
    } else {
      // exceeded retries -> permanent failure
      await markJobFailed(jobId, `permanent_error: ${msg}`);
      // hook for notifications (Slack / ErrorHandler) can be added here
    }
  }
}