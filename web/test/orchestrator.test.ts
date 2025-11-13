/**
 * orchestrator.test.ts
 *
 * 單元測試 StoryGenerationOrchestrator.run 的主要行為：
 * - 注入一個可控制回應的 mock OpenAI adapter（createChatCompletion）
 * - 驗證 Orchestrator 會依序產生 story / translation / vocabulary
 * - 驗證回傳的結構與 usage 欄位存在
 *
 * 每個函式或主要區塊均包含註解以符合專案規範。
 */
import { it, expect, vi } from "vitest";
import { StoryGenerationOrchestrator } from "../lib/openai/StoryGenerationOrchestrator";
import type { StoryGenerationPayload } from "../lib/openai/types";

/**
 * Helper: 建立 10 頁的 story payload（符合 ResultAssembler 的 schema）
 * @param title 英文標題
 */
function makeFakeStoryPayload(title = "Fake Story") {
  const pages = Array.from({ length: 10 }).map((_, i) => ({
    page_number: i + 1,
    text_en: `Page ${i + 1} content.`,
    summary_en: `Summary ${i + 1}`,
  }));

  return {
    title_en: title,
    synopsis_en: "A short fake synopsis",
    pages,
  };
}

/**
 * Helper: 建立 10 頁的 translation payload
 * @param titleZh 中文標題
 */
function makeFakeTranslationPayload(titleZh = "假故事") {
  const pages = Array.from({ length: 10 }).map((_, i) => ({
    page_number: i + 1,
    text_zh: `第${i + 1}頁內容。`,
    notes_zh: `備註 ${i + 1}`,
  }));

  return {
    title_zh: titleZh,
    synopsis_zh: "短摘要",
    pages,
  };
}

/**
 * Helper: 建立 10 個 vocabulary entries
 */
function makeFakeVocabPayload() {
  const entries = Array.from({ length: 10 }).map((_, i) => ({
    word: `word${i + 1}`,
    part_of_speech: "noun",
    definition_en: `Definition ${i + 1}`,
    definition_zh: `定義 ${i + 1}`,
    example_sentence: `Example sentence ${i + 1}.`,
    example_translation: `範例翻譯 ${i + 1}.`,
    cefr_level: "A1",
  }));

  return { entries };
}

/**
 * 測試：Orchestrator.run 在注入 mock AI 時可成功回傳已解析的 story/translation/vocabulary 與 usage
 */
it("returns parsed story, translation and vocabulary with usage when AI adapter responds correctly", async () => {
  // 建立三階段的 fake payloads (story / translation / vocabulary)
  const fakeStory = makeFakeStoryPayload("Sunny's Big Smile");
  const fakeTranslation = makeFakeTranslationPayload("陽陽的大笑容");
  const fakeVocab = makeFakeVocabPayload();

  // 呼叫次數計數器，用以在 createChatCompletion 不同階段回傳對應資料
  let callIndex = 0;

  /**
   * Mock AI adapter：只實作 createChatCompletion
   * 回傳格式與 OpenAIClientAdapter.createChatCompletion 的回傳 shape 相容：
   * { data: T, usage: { promptTokens, completionTokens, totalTokens } }
   */
  const mockAi = {
    createChatCompletion: vi.fn(async (params: any) => {
      callIndex += 1;
      // 輔助 usage 物件
      const usage = { promptTokens: 10 * callIndex, completionTokens: 20 * callIndex, totalTokens: 30 * callIndex };

      // 第一階段：故事腳本
      if (callIndex === 1) {
        return { data: fakeStory, usage };
      }
      // 第二階段：翻譯
      if (callIndex === 2) {
        return { data: fakeTranslation, usage };
      }
      // 第三階段：精選單字
      if (callIndex === 3) {
        return { data: fakeVocab, usage };
      }

      // 若有額外呼叫，回傳空物件以避免未預期錯誤
      return { data: {}, usage };
    }),
  };

  // 建立 Orchestrator 並注入 mockAi（以及預設的 ErrorHandler）
  const orchestrator = new StoryGenerationOrchestrator(mockAi as any);

  // 建立測試 payload（storyId, theme, tone, ageRange）
  const payload: StoryGenerationPayload = {
    storyId: "test-story-001",
    theme: "friendly meadow",
    tone: "warm",
    ageRange: "0-6",
    regenerate: false,
  };

  // 執行 orchestrator
  const result = await orchestrator.run(payload);

  // 確認 createChatCompletion 被呼叫 3 次（script, translation, vocabulary）
  expect((mockAi.createChatCompletion as any).mock.calls.length).toBe(3);

  // 確認回傳物件包含 story / translation / vocabulary
  expect(result).toHaveProperty("story");
  expect(result).toHaveProperty("translation");
  expect(result).toHaveProperty("vocabulary");
  expect(result).toHaveProperty("usages");

  // 檢查 story content 與頁數
  expect(result.story.titleEn).toBe(fakeStory.title_en);
  expect(result.story.pages.length).toBe(10);
  expect(result.translation.titleZh).toBe(fakeTranslation.title_zh);
  expect(result.translation.pages.length).toBe(10);
  expect(result.vocabulary.entries.length).toBe(10);

  // usages 應當包含 story/translation/vocabulary 的 usage（數值來自 mockAi）
  expect(result.usages.story).toBeDefined();
  expect(result.usages.translation).toBeDefined();
  expect(result.usages.vocabulary).toBeDefined();

  // 最後檢查 usage totalTokens 為非 0 的數值（代表有計費資訊）
  expect(result.usages.story?.totalTokens).toBeGreaterThan(0);
  expect(result.usages.translation?.totalTokens).toBeGreaterThan(0);
  expect(result.usages.vocabulary?.totalTokens).toBeGreaterThan(0);
});