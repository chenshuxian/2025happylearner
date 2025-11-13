import { db } from '../db/client';
import { env } from '../lib/utils/env';
import { createQueueClient, UpstashMessage } from './queueClient';
import { JobHandler } from './jobHandler';

/**
 * Worker entrypoint: 從 Upstash 佇列拉取 generation job，交由 jobHandler 處理。
 *
 * 使用方式：
 *   NODE_ENV=production node ./dist/worker/index.js
 *
 * env vars:
 *  - UPSTASH_REDIS_URL | UPSTASH_REST_URL + UPSTASH_REST_TOKEN
 *  - UPSTASH_QUEUE_NAME
 *  - WORKER_CONCURRENCY
 */
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? '3');
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? '1000');
const SHORT_WAIT_MS = 500;
let stopped = false;

const running = new Set<string>();

/**
 * 暫停工具
 * @param ms 毫秒
 */
async function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * 主流程：建立 queue client 與 job handler，進入拉取迴圈。
 */
async function main() {
	console.info('[worker] starting worker', { concurrency: CONCURRENCY });

	const queueClient = await createQueueClient();
	const handler = new JobHandler(db, env);

	async function loop() {
		while (!stopped) {
			try {
				if (running.size >= CONCURRENCY) {
					await sleep(SHORT_WAIT_MS);
					continue;
				}

				const msg: UpstashMessage | null = await queueClient.pop();
				if (!msg) {
					await sleep(POLL_INTERVAL_MS);
					continue;
				}

				const jobId = msg.jobId;
				if (!jobId) {
					console.warn('[worker] received invalid message without jobId', {
						msg,
					});
					continue;
				}

				// idempotency: avoid processing same job concurrently
				if (running.has(jobId)) {
					console.info('[worker] job already processing, skipping', { jobId });
					continue;
				}

				running.add(jobId);

				// process asynchronously without blocking the loop
				(async () => {
					const startedAt = Date.now();
					try {
						console.info('[worker] processing job', { jobId });
						await handler.handle(jobId);
						console.info('[worker] job completed', {
							jobId,
							durationMs: Date.now() - startedAt,
						});
					} catch (err) {
						console.error('[worker] job failed', { jobId, err });
					} finally {
						running.delete(jobId);
					}
				})();
			} catch (err) {
				console.error('[worker] loop error', err);
				await sleep(POLL_INTERVAL_MS);
			}
		}
	}

	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	await loop();

	async function shutdown() {
		if (stopped) return;
		stopped = true;
		console.info('[worker] shutdown requested, waiting for running jobs', {
			runningCount: running.size,
		});
		const startWait = Date.now();
		while (running.size > 0 && Date.now() - startWait < 30000) {
			await sleep(500);
		}
		try {
			await queueClient.close();
		} catch (e) {
			console.warn('[worker] error closing queue client', e);
		}
		console.info('[worker] exiting');
		process.exit(0);
	}
}

// allow running directly
if (require.main === module) {
	main().catch((e) => {
		console.error('[worker] fatal error', e);
		process.exit(1);
	});
}
