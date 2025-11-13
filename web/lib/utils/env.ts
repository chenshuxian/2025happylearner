import { z } from "zod";

/**
 * 環境變數 schema，於啟動時即刻驗證必要設定。
 *
 * 增加可選的 SLACK_WEBHOOK、UPSTASH、IMAGE、TTS 與 UPLOAD_DIR 相關設定，以供 Worker / ErrorHandler 使用（皆為 optional）。
 */
const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  SLACK_WEBHOOK: z.string().url().optional(),
  UPSTASH_REDIS_URL: z.string().optional(),
  UPSTASH_REST_URL: z.string().optional(),
  UPSTASH_REST_TOKEN: z.string().optional(),
  UPSTASH_QUEUE_NAME: z.string().optional(),
  IMAGE_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  UPLOAD_DIR: z.string().optional(),
});

/**
 * 匯出 Env 型別以供其他模組使用（避免在多處使用 typeof env 引起型別循環）
 */
export type Env = z.infer<typeof envSchema>;

/**
 * 允許在測試中繞過嚴格驗證（會使用 test-key 作為預設金鑰）
 * 或透過環境變數 SKIP_ENV_VALIDATION=true 明確跳過（開發用）。
 */
const rawEnv = {
  OPENAI_API_KEY:
    process.env.OPENAI_API_KEY ??
    (process.env.NODE_ENV === "test" ? "test-key" : undefined) ??
    (process.env.SKIP_ENV_VALIDATION === "true" ? "test-key" : undefined),
  SLACK_WEBHOOK: process.env.SLACK_WEBHOOK,
  UPSTASH_REDIS_URL: process.env.UPSTASH_REDIS_URL,
  UPSTASH_REST_URL: process.env.UPSTASH_REST_URL,
  UPSTASH_REST_TOKEN: process.env.UPSTASH_REST_TOKEN,
  UPSTASH_QUEUE_NAME: process.env.UPSTASH_QUEUE_NAME ?? "generation_jobs",
  IMAGE_API_KEY: process.env.IMAGE_API_KEY,
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  UPLOAD_DIR: process.env.UPLOAD_DIR,
};

/**
 * 匯出已驗證的環境變數（以及其明確型別 Env）
 */
export const env: Env = envSchema.parse(rawEnv);
