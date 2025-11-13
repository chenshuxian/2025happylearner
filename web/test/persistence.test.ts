import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Mock db client and fetch to test OrchestrationPersistence.persistGenerationResult
 *
 * - 使用 vitest 的 module mock 替換 `web/db/client.ts` 的 `db` export 為一個簡單的 transaction stub
 * - stub 出 tx.insert(...).values(...).returning() 的回傳 shape，以符合 OrchestrationPersistence 的使用
 * - stub global fetch 用來模擬 Upstash REST push 成功
 */

vi.mock("../db/client", () => {
  // 一個簡易的 tx stub：insert(...).values(...).returning() -> Promise<[ { id } ]>
  const tx = {
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: "fake-job-id" }],
      }),
    }),
  };

  const db = {
    transaction: async (fn: (t: typeof tx) => Promise<void>) => {
      // 在 transaction 中呼叫傳入函式，傳入 tx stub
      await fn(tx as unknown as typeof tx);
    },
  };

  return { db };
});

beforeEach(() => {
  // stub global fetch 用於 pushJobsToUpstash
  (globalThis as any).fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => "",
  }));
});

import { persistGenerationResult } from "../lib/openai/OrchestrationPersistence";
import type {
  StoryScriptResult,
  TranslationResult,
  VocabularyResult,
} from "../lib/openai/types";

describe("OrchestrationPersistence.persistGenerationResult", () => {
  it("should write story/pages/vocab and create image+audio generation jobs per page, and return job ids", async () => {
    // arrange: minimal story with 3 pages and 3 vocab entries
    const story: StoryScriptResult = {
      titleEn: "Test Story",
      synopsisEn: "A short synopsis",
      pages: [
        { pageNumber: 1, textEn: "Page one content." },
        { pageNumber: 2, textEn: "Page two content." },
        { pageNumber: 3, textEn: "Page three content." },
      ],
    };

    const translation: TranslationResult = {
      titleZh: "測試故事",
      synopsisZh: "簡短摘要",
      pages: [
        { pageNumber: 1, textZh: "第1頁內容。" },
        { pageNumber: 2, textZh: "第2頁內容。" },
        { pageNumber: 3, textZh: "第3頁內容。" },
      ],
    };

    const vocabulary: VocabularyResult = {
      entries: [
        {
          word: "apple",
          partOfSpeech: "noun",
          definitionEn: "A fruit",
          definitionZh: "一種水果",
          exampleSentence: "I eat an apple.",
          exampleTranslation: "我吃一個蘋果。",
        },
        {
          word: "blue",
          partOfSpeech: "adjective",
          definitionEn: "A color",
          definitionZh: "一種顏色",
          exampleSentence: "The sky is blue.",
          exampleTranslation: "天空是藍色的。",
        },
        {
          word: "run",
          partOfSpeech: "verb",
          definitionEn: "To move fast",
          definitionZh: "快速移動",
          exampleSentence: "They run in the park.",
          exampleTranslation: "他們在公園跑步。",
        },
      ],
    };

    // act
    const createdJobIds = await persistGenerationResult("test-story-1", "friendly theme", story, translation, vocabulary);

    // assert
    // 每頁會建立 image + audio 兩個 job，因此期望數量為 pages.length * 2
    expect(Array.isArray(createdJobIds)).toBe(true);
    expect(createdJobIds.length).toBe(story.pages.length * 2);
    // job ids 應為字串
    expect(createdJobIds.every((id) => typeof id === "string")).toBe(true);
  });
});