import { z } from 'zod';
 
/**
 * 環境變數 schema，於啟動時即刻驗證必要設定。
 * 在測試環境 (NODE_ENV === 'test') 或設定 SKIP_ENV_VALIDATION 時，
 * 允許使用測試用的預設值以利本地測試。
 *
 * 增加可選的 SLACK_WEBHOOK 與 UPSTASH 相關設定，以供 ErrorHandler 與佇列推送使用（皆為 optional）。
 */
const envSchema = z.object({
	OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
	SLACK_WEBHOOK: z.string().url().optional(),
	UPSTASH_REDIS_URL: z.string().optional(),
	UPSTASH_REST_URL: z.string().optional(),
	UPSTASH_REST_TOKEN: z.string().optional(),
	UPSTASH_QUEUE_NAME: z.string().optional(),
});
 
/**
 * 允許在測試中繞過嚴格驗證（會使用 test-key 作為預設金鑰）
 * 或透過環境變數 SKIP_ENV_VALIDATION=true 明確跳過（開發用）。
 */
const rawEnv = {
	OPENAI_API_KEY:
		process.env.OPENAI_API_KEY ??
		(process.env.NODE_ENV === 'test' ? 'test-key' : undefined) ??
		(process.env.SKIP_ENV_VALIDATION === 'true' ? 'test-key' : undefined),
	SLACK_WEBHOOK: process.env.SLACK_WEBHOOK,
	UPSTASH_REDIS_URL: process.env.UPSTASH_REDIS_URL,
	UPSTASH_REST_URL: process.env.UPSTASH_REST_URL,
	UPSTASH_REST_TOKEN: process.env.UPSTASH_REST_TOKEN,
	UPSTASH_QUEUE_NAME: process.env.UPSTASH_QUEUE_NAME ?? "generation_jobs",
};
 
/**
 * 匯出已驗證的環境變數。
 */
export const env = envSchema.parse(rawEnv);
