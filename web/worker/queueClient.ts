/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Env } from '../lib/utils/env';
import { env } from '../lib/utils/env';

/**
 * Upstash queue message shape（由 OrchestrationPersistence 推送）
 */
export interface UpstashMessage {
	jobId: string;
	timestamp?: number;
}

/**
 * Queue client interface
 */
export interface QueueClient {
	/**
	 * 取出一則訊息（若無可取則回傳 null）
	 */
	pop(): Promise<UpstashMessage | null>;

	/**
	 * 推回一則訊息（用於 requeue）
	 */
	push(msg: UpstashMessage): Promise<void>;

	/**
	 * 關閉 client（關閉 redis 連線等）
	 */
	close(): Promise<void>;
}

/**
 * Minimal Redis-like client shape used by this module.
 * We keep it intentionally small to avoid coupling to concrete types.
 */
type RedisLike = {
	brpop(queue: string, timeoutSec: number): Promise<unknown>;
	rpush(queue: string, value: string): Promise<unknown>;
	quit?(): Promise<void>;
	disconnect?(): void;
	connect?(): Promise<void>;
};

/**
 * No-op client: 用於未設定 Upstash 時，避免 runtime crash
 */
class NoopQueueClient implements QueueClient {
	async pop(): Promise<UpstashMessage | null> {
		return null;
	}
	async push(_msg: UpstashMessage): Promise<void> {
		throw new Error('UPSTASH not configured; push not supported');
	}
	async close(): Promise<void> {
		// noop
	}
}

/**
 * REST fallback client for Upstash REST push (push-only).
 *
 * NOTE: This implementation only supports push() via REST, and pop() returns null because
 * Upstash REST push is usually used to push messages to Upstash lists; there's no generic REST poll.
 */
class RestQueueClient implements QueueClient {
	private restUrl: string;
	private token: string;
	private queueName: string;

	constructor(restUrl: string, token: string, queueName: string) {
		this.restUrl = restUrl;
		this.token = token;
		this.queueName = queueName;
	}

	async pop(): Promise<UpstashMessage | null> {
		// REST poll not implemented generically
		return null;
	}

	async push(msg: UpstashMessage): Promise<void> {
		const body = { queue: this.queueName, messages: [JSON.stringify(msg)] };
		const resp = await fetch(this.restUrl, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		});
		if (!resp.ok) {
			const text = await resp.text().catch(() => '<no body>');
			throw new Error(`Upstash REST push failed ${resp.status} ${text}`);
		}
	}

	async close(): Promise<void> {
		// noop
	}
}

/**
 * 建立一個支援 Upstash Redis 的 queue client（優先使用 ioredis），否則回退到 REST (push-only)，最後回傳 noop client。
 *
 * @param opts 可選參數，允許覆寫 env 與 queueName（方便測試）
 */
export async function createQueueClient(opts?: {
	envVars?: Env;
	queueName?: string;
}): Promise<QueueClient> {
	const envVars = opts?.envVars ?? env;
	const queueName =
		opts?.queueName ?? envVars.UPSTASH_QUEUE_NAME ?? 'generation_jobs';

	// 1) 優先使用 Redis client（UPSTASH_REDIS_URL）
	if (envVars.UPSTASH_REDIS_URL) {
		try {
			const IORedisModule = await import('ioredis').then((m) =>
				m && (m as unknown as any).default ? (m as unknown as any).default : m
			);

			const RedisCtor = IORedisModule as any;
			const clientInstance = new RedisCtor(
				envVars.UPSTASH_REDIS_URL as string,
				{ lazyConnect: false }
			) as RedisLike;

			// Ensure connected if possible
			if (typeof (clientInstance as any).connect === 'function') {
				try {
					await (clientInstance as any).connect();
				} catch {
					// some ioredis versions don't require explicit connect; ignore
				}
			}

			const redisClient = clientInstance as RedisLike;

			async function pop(): Promise<UpstashMessage | null> {
				try {
					const timeoutSec = 5;
					const resp = await redisClient.brpop(queueName, timeoutSec);
					if (!resp) return null;
					if (Array.isArray(resp) && resp.length >= 2) {
						const msgStr = resp[1];
						try {
							const parsed = JSON.parse(msgStr) as UpstashMessage;
							return parsed;
						} catch (e) {
							console.warn('[queueClient] failed to parse message JSON', e, {
								raw: msgStr,
							});
							return null;
						}
					}
					// unknown shape
					return null;
				} catch (err) {
					console.error('[queueClient] redis brpop error', err);
					return null;
				}
			}

			async function push(msg: UpstashMessage): Promise<void> {
				try {
					await redisClient.rpush(queueName, JSON.stringify(msg));
				} catch (err) {
					console.error('[queueClient] redis rpush error', err);
					throw err;
				}
			}

			async function close(): Promise<void> {
				try {
					if (typeof (redisClient as any).quit === 'function')
						await (redisClient as any).quit();
					else if (typeof (redisClient as any).disconnect === 'function')
						(redisClient as any).disconnect();
				} catch (err) {
					console.warn('[queueClient] error closing redis client', err);
				}
			}

			return { pop, push, close };
		} catch (err) {
			console.warn(
				'[createQueueClient] Redis client initialization failed, falling back to REST',
				err
			);
			// fallthrough to REST
		}
	}

	// 2) REST fallback (supports push)
	if (envVars.UPSTASH_REST_URL && envVars.UPSTASH_REST_TOKEN) {
		return new RestQueueClient(
			envVars.UPSTASH_REST_URL,
			envVars.UPSTASH_REST_TOKEN,
			queueName
		);
	}

	// 3) No configuration -> noop client
	console.info(
		'[createQueueClient] No Upstash configuration found; returning noop client'
	);
	return new NoopQueueClient();
}
