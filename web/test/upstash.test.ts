/* eslint-disable @typescript-eslint/no-explicit-any */
import { it, expect, vi, beforeEach } from "vitest";

/**
 * Upstash 推送路徑單元測試
 *
 * 測試項目：
 *  - 當設定 UPSTASH_REDIS_URL 時，程式會動態 import("ioredis") 並使用 client.rpush 推送每個 message。
 *  - 當未設定 UPSTASH_REST_URL 但有 UPSTASH_REST_TOKEN 時，會使用 fetch 推送 REST 請求。
 *
 * 設計要點：
 *  - 每個測試都會呼叫 vi.resetModules() 並在動態 import 之前設定 process.env，以確保 env 模組重新解析。
 *  - 使用 vi.mock() 模擬 ../db/client 的 transaction 與 insert/...returning() 行為，使 persistGenerationResult 可以順利運作。
 *  - 以全域變數收集 ioredis.rpush 呼叫或 fetch 呼叫以便斷言（避免 vi.mock factory 與測試作用域 closure 問題）。
 */

/**
 * 建立一個簡易的 db client mock 工廠
 * @param fakeJobId 要回傳的 job id（可重複用於多次 insert）
 */
function makeDbClientMock(fakeJobId = "fake-job-id") {
  // 回傳一個與程式碼使用相容的 db 物件：
  // - db.transaction(tx => { tx.insert(...).values(...).returning() })
  // - db.insert(...).values(...).returning()   (供 ErrorHandler 使用)
  const dbObj = {
    transaction: async (fn: (tx: any) => Promise<void>) => {
      const tx = {
        insert: () => ({
          values: () => ({
            returning: async () => [{ id: fakeJobId }],
          }),
        }),
      };
      await fn(tx);
    },
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: fakeJobId }],
      }),
    }),
  };
  return { db: dbObj };
}

beforeEach(() => {
  // 在每個測試開始時清除 module cache 以利重新解析 env
  vi.resetAllMocks();
  // 清空全域暫存（供 mock 收集 rpush / fetch 呼叫用）
  (globalThis as any).__rpushCalls = [];
  (globalThis as any).__fetchCalls = [];
});

/**
 * 測試：使用 ioredis client 路徑
 */
it("pushes jobs to Upstash via ioredis client when UPSTASH_REDIS_URL is set", async () => {
  // 重新載入模組
  vi.resetModules();

  // 設定測試環境變數（必須在 import 之前）
  (process.env as any).NODE_ENV = "test";
  (process.env as any).UPSTASH_REDIS_URL = "redis://fake-url";
  delete (process.env as any).UPSTASH_REST_URL;
  delete (process.env as any).UPSTASH_REST_TOKEN;
  (process.env as any).UPSTASH_QUEUE_NAME = "test_generation_jobs";

  // 模擬 ioredis（支援 default export 與 named export）
  vi.mock("ioredis", () => {
    class MockRedis {
      constructor(_url: string, _opts: any) {
        // noop
      }
      async rpush(queue: string, msg: string) {
        // push 到全域陣列，避免 closure splice 問題
        (globalThis as any).__rpushCalls.push({ queue, msg });
        return 1;
      }
      async quit() {
        return "OK";
      }
    }
    // return both default and named export forms to be resilient
    return { default: MockRedis, MockRedis };
  });

  // 模擬 db client（必須在 import OrchestrationPersistence 之前 mock）
  vi.mock("../db/client", () => {
    return makeDbClientMock("redis-job-id");
  });

  // 現在動態 import 目標模組（讓 env 與 ioredis mock 生效）
  const { persistGenerationResult } = await import("../lib/openai/OrchestrationPersistence");

  // minimal story payload (2 pages to keep assertions simple)
  const story = {
    titleEn: "Redis Test Story",
    synopsisEn: "Synopsis",
    pages: [
      { pageNumber: 1, textEn: "Page one content." },
      { pageNumber: 2, textEn: "Page two content." },
    ],
  };
  const translation = {
    titleZh: "Redis 測試故事",
    synopsisZh: "簡短",
    pages: [
      { pageNumber: 1, textZh: "第1頁" },
      { pageNumber: 2, textZh: "第2頁" },
    ],
  };
  const vocabulary = { entries: [{ word: "one", partOfSpeech: "noun", definitionEn: "one", definitionZh: "一" }] };

  const created = await persistGenerationResult("redis-test-1", "theme", story as any, translation as any, vocabulary as any);

  // 每頁會產生 image + audio => 2 pages * 2 = 4 jobs
  expect(Array.isArray(created)).toBe(true);
  expect(created.length).toBe(4);

  // rpush 應被呼叫 created.length 次
  const rpushCalls = (globalThis as any).__rpushCalls as Array<{ queue: string; msg: string }>;
  expect(rpushCalls.length).toBe(created.length);

  // 檢查每次 rpush 的 queue 名稱與訊息 JSON 形狀
  for (const call of rpushCalls) {
    expect(call.queue).toBe((process.env as any).UPSTASH_QUEUE_NAME);
    const parsed = JSON.parse(call.msg);
    expect(parsed).toHaveProperty("jobId");
    expect(parsed).toHaveProperty("timestamp");
  }
});

/**
 * 測試：使用 REST fallback 路徑
 */
it("falls back to Upstash REST when UPSTASH_REDIS_URL is not set but REST vars exist", async () => {
  vi.resetModules();

  // env
  (process.env as any).NODE_ENV = "test";
  delete (process.env as any).UPSTASH_REDIS_URL;
  (process.env as any).UPSTASH_REST_URL = "https://api.upstash.test/push";
  (process.env as any).UPSTASH_REST_TOKEN = "rest-token";
  (process.env as any).UPSTASH_QUEUE_NAME = "rest_generation_jobs";

  // 模擬 fetch：push 呼叫到全域 __fetchCalls
  (globalThis as any).fetch = vi.fn(async (url: string, init: any) => {
    (globalThis as any).__fetchCalls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      text: async () => "",
    };
  });

  // 模擬 db client
  vi.mock("../db/client", () => {
    return makeDbClientMock("rest-job-id");
  });

  const { persistGenerationResult } = await import("../lib/openai/OrchestrationPersistence");

  const story = {
    titleEn: "REST Test Story",
    synopsisEn: "Synopsis",
    pages: [{ pageNumber: 1, textEn: "Only one page" }],
  };
  const translation = {
    titleZh: "REST 測試",
    synopsisZh: "簡短",
    pages: [{ pageNumber: 1, textZh: "第1頁" }],
  };
  const vocabulary = { entries: [] };

  const created = await persistGenerationResult("rest-test-1", "theme", story as any, translation as any, vocabulary as any);

  // 1 page => 2 jobs
  expect(created.length).toBe(2);

  // fetch 應被呼叫一次（REST fallback）
  const fetchCalls = (globalThis as any).__fetchCalls as Array<{ url: string; init: any }>;
  expect(fetchCalls.length).toBe(1);

  const call = fetchCalls[0];
  expect(call.url).toBe((process.env as any).UPSTASH_REST_URL);
  expect(call.init.method).toBe("POST");
  expect(call.init.headers.Authorization).toBe(`Bearer ${(process.env as any).UPSTASH_REST_TOKEN}`);
  expect(call.init.headers["Content-Type"]).toBe("application/json");

  const body = JSON.parse(call.init.body);
  expect(body).toHaveProperty("queue", (process.env as any).UPSTASH_QUEUE_NAME);
  expect(Array.isArray(body.messages)).toBe(true);
  expect(body.messages.length).toBe(created.length);
});