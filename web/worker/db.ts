import { sql } from '@vercel/postgres';

/**
 * DB helpers for worker
 *
 * 使用原生 tagged sql (from @vercel/postgres) 以減少對 Drizzle query API 的相依與型別摩擦。
 * 每個函式以最小回傳結構為主，足以讓 JobHandler 做後續處理。
 */

/**
 * Claim a generation job atomically: set status -> 'processing' only if current status is 'pending'.
 * @param jobId generation_jobs.id
 * @returns the claimed job row or null if not claimed (already taken or missing)
 */
export async function claimJob(
	jobId: string
): Promise<Record<string, unknown> | null> {
	const res = await sql`
 	   UPDATE generation_jobs
 	   SET status = 'processing', updated_at = now()
 	   WHERE id = ${jobId} AND status = 'pending'
 	   RETURNING *
 	 `;
	const maybe = res as unknown as { rows?: unknown[] } | undefined;
	const rows = Array.isArray(maybe?.rows) ? (maybe!.rows as Record<string, unknown>[]) : [];
	return rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
}

/**
 * Fetch job by id (read-only)
 * @param jobId
 */
export async function getJob(
	jobId: string
): Promise<Record<string, unknown> | null> {
	const res =
		await sql`SELECT * FROM generation_jobs WHERE id = ${jobId} LIMIT 1`;
	const maybeRes = res as unknown as { rows?: unknown[] } | undefined;
	const rows = Array.isArray(maybeRes?.rows) ? (maybeRes!.rows as Record<string, unknown>[]) : [];
	return rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
}

/**
 * Mark a job as completed and write resultUri
 * @param jobId
 * @param resultUri
 */
export async function markJobCompleted(jobId: string, resultUri: string) {
	await sql`
    UPDATE generation_jobs
    SET status = 'completed', result_uri = ${resultUri}, updated_at = now()
    WHERE id = ${jobId}
  `;
}

/**
 * Mark a job as failed with reason
 * @param jobId
 * @param reason
 */
export async function markJobFailed(jobId: string, reason: string) {
	await sql`
    UPDATE generation_jobs
    SET status = 'failed', failure_reason = ${reason}, updated_at = now()
    WHERE id = ${jobId}
  `;
}

/**
 * Increment retry count
 * @param jobId
 */
export async function incrementRetry(jobId: string) {
	await sql`
    UPDATE generation_jobs
    SET retry_count = retry_count + 1, updated_at = now()
    WHERE id = ${jobId}
  `;
}

/**
 * Insert a media_assets record linking to the generation job.
 * If a media asset for the same generation_job_id already exists, return that (idempotency).
 *
 * @param data
 */
export async function insertMediaAssetIfNotExists(data: {
	story_id: string;
	page_id?: string | null;
	type: 'image' | 'audio' | 'video';
	uri: string;
	format: string;
	metadata?: Record<string, unknown>;
	generation_job_id?: string | null;
}): Promise<Record<string, unknown> | null> {
	if (data.generation_job_id) {
		const find =
			await sql`SELECT * FROM media_assets WHERE generation_job_id = ${data.generation_job_id} LIMIT 1`;
		const maybeFind = find as unknown as { rows?: unknown[] } | undefined;
		const exists = Array.isArray(maybeFind?.rows) ? (maybeFind!.rows as Record<string, unknown>[]) : [];
		if (exists.length) return exists[0];
	}

	const res = await sql`
	   INSERT INTO media_assets (id, story_id, page_id, type, uri, format, metadata, generation_job_id, created_at, updated_at)
	   VALUES (gen_random_uuid(), ${data.story_id}, ${data.page_id ?? null}, ${data.type}, ${data.uri}, ${data.format}, ${JSON.stringify(
		data.metadata ?? {}
	)}::jsonb, ${data.generation_job_id ?? null}, now(), now())
	   RETURNING *
	 `;
	const maybeInsert = res as unknown as { rows?: unknown[] } | undefined;
	const rows = Array.isArray(maybeInsert?.rows) ? (maybeInsert!.rows as Record<string, unknown>[]) : [];
	return rows.length > 0 ? rows[0] : null;
}
