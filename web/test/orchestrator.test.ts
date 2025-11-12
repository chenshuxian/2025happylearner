import { describe, it, expect } from "vitest";
import { StoryGenerationOrchestrator } from "../lib/openai/StoryGenerationOrchestrator";
import type { StoryGenerationPayload, OpenAIAdapter } from "../lib/openai/types";

/**
 * 最小整合測試（不呼叫真正的 OpenAI）。
 * - 使用 MockAdapter 模擬 OpenAI SDK 回傳 shape
 * - 執行 orchestrator.run 並驗證回傳結構
 */

class MockAdapter {
  private responses: unknown[];
  private idx = 0;

  constructor(responses: unknown[]) {
    this.responses = responses;
  }
 
  async createChatCompletion(_params: unknown) {
    // 標記參數為已使用以消除 linter 的 unused-vars 警告
    void _params;
    const resp = this.responses[this.idx] ?? this.responses[this.responses.length - 1];
    this.idx += 1;
    return resp;
  }
}

describe("StoryGenerationOrchestrator (integration minimal)", () => {
  it("should run full pipeline (story -> translation -> vocabulary) and return validated structures", async () => {
    // 1) 準備 mock 回應：story / translation / vocabulary
    const storyData = {
      title_en: "The Friendly Cloud",
      synopsis_en: "A cloud learns to share rain with friends.",
      pages: Array.from({ length: 10 }).map((_, i) => ({
        page_number: i + 1,
        text_en: `Page ${i + 1} content.`,
        summary_en: `Summary ${i + 1}`,
      })),
    };

    const translationData = {
      title_zh: "友善的雲",
      synopsis_zh: "一朵雲學會與朋友分享雨水。",
      pages: Array.from({ length: 10 }).map((_, i) => ({
        page_number: i + 1,
        text_zh: `第 ${i + 1} 頁內容。`,
        notes_zh: `註記 ${i + 1}`,
      })),
    };

    const vocabData = {
      entries: Array.from({ length: 10 }).map((_, i) => ({
        word: `word${i + 1}`,
        part_of_speech: "noun",
        definition_en: `Definition ${i + 1}`,
        definition_zh: `定義 ${i + 1}`,
        example_sentence: `Example sentence ${i + 1}`,
        example_translation: `例句翻譯 ${i + 1}`,
        cefr_level: "A1",
      })),
    };

    // 模擬 OpenAI SDK 回傳的物件 shape (choices[0].message.content JSON string + usage)
    const makeResp = (data: unknown) => ({
      choices: [{ message: { content: JSON.stringify(data) } }],
      usage: { prompt_tokens: 10, completion_tokens: 90, total_tokens: 100 },
    });

    const mock = new MockAdapter([makeResp(storyData), makeResp(translationData), makeResp(vocabData)]);
    
    // 2) 建立 orchestrator 並注入 mock adapter
    const orchestrator = new StoryGenerationOrchestrator(mock as unknown as OpenAIAdapter);

    const payload: StoryGenerationPayload = {
      storyId: "test-story-1",
      theme: "friendly cloud",
      tone: "warm",
      ageRange: "0-6",
      regenerate: false,
    };

    // 3) 執行
    const result = await orchestrator.run(payload);

    // 4) 驗證基本結構與內容
    expect(result).toBeDefined();
    expect(result.story).toBeDefined();
    expect(result.story.pages).toHaveLength(10);
    expect(result.story.titleEn).toBe("The Friendly Cloud");

    expect(result.translation).toBeDefined();
    expect(result.translation.pages).toHaveLength(10);
    expect(result.translation.titleZh).toBe("友善的雲");

    expect(result.vocabulary).toBeDefined();
    expect(result.vocabulary.entries).toHaveLength(10);
    expect(result.vocabulary.entries[0].word).toBe("word1");

    // usage 應包含各階段 token 使用資訊
    expect(result.usages.story).toBeDefined();
    expect(result.usages.translation).toBeDefined();
    expect(result.usages.vocabulary).toBeDefined();
  }, 20000);
});