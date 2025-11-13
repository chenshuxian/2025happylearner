import { z } from "zod";
import type {
  ChatCompletionResult,
  StoryScriptPage,
  StoryScriptResult,
  TranslationPage,
  TranslationResult,
  VocabularyEntry,
  VocabularyResult,
} from "./types";

/**
 * ResultAssembler 負責解析與驗證 OpenAI 回傳內容，轉換為專案使用的資料結構。
 *
 * 開發期間會在 parse 前嘗試將 string 形式的 payload safe-parse 成物件，
 * 並在 server console 印出 raw payload 以方便定位模型回傳格式差異。
 */
export class ResultAssembler {
  private readonly storySchema = z.object({
    title_en: z.string().min(1),
    synopsis_en: z.string().optional(),
    pages: z
      .array(
        z.object({
          page_number: z.number().int().min(1),
          text_en: z.string().min(1),
          summary_en: z.string().optional(),
        }),
      )
      .length(10, "Story must contain exactly 10 pages"),
  });

  private readonly translationSchema = z.object({
    title_zh: z.string().min(1),
    synopsis_zh: z.string().optional(),
    pages: z.array(
      z.object({
        page_number: z.number().int().min(1),
        text_zh: z.string().min(1),
        notes_zh: z.string().optional(),
      }),
    ),
  });

  private readonly vocabularySchema = z.object({
    entries: z
      .array(
        z.object({
          word: z.string().min(1),
          part_of_speech: z.string().min(1),
          definition_en: z.string().min(1),
          definition_zh: z.string().min(1),
          example_sentence: z.string().min(1),
          example_translation: z.string().min(1),
          cefr_level: z.string().optional(),
        }),
      )
      .length(10, "Vocabulary list must contain exactly 10 items"),
  });

  /**
   * Helper: 尝试将 result.data safe-parse 成 object（若已是 object 则直接回傳）。
   * 同時在開發環境列印 raw payload。
   */
  private safeParsePayload(raw: unknown): unknown {
    // Log raw for debugging (truncate long output)
    try {
      if (typeof raw === "string") {
        console.info("[ResultAssembler] raw payload (string):", raw.slice(0, 2000));
      } else {
        console.info("[ResultAssembler] raw payload (object):", JSON.stringify(raw).slice(0, 2000));
      }
    } catch {
      // ignore logging errors
    }

    // If already an object, return as-is
    if (raw && typeof raw === "object") return raw;

    if (typeof raw === "string") {
      let s = (raw as string).trim();

      // Remove common markdown code fences (```json ... ```)
      s = s.replace(/```(?:json)?/g, "").trim();

      // Try direct parse first
      try {
        return JSON.parse(s);
      } catch (err) {
        console.warn("[ResultAssembler] direct JSON.parse failed on payload", err);
      }

      // Attempt to extract balanced JSON object by scanning braces from first '{'
      const firstBrace = s.indexOf("{");
      if (firstBrace !== -1) {
        // collect potential end indices
        for (let end = s.length - 1; end > firstBrace; end--) {
          if (s[end] !== "}") continue;
          const candidate = s.slice(firstBrace, end + 1);
          // cleanup common trailing commas before } or ]
          const cleaned = candidate.replace(/,(\s*[}\]])/g, "$1");
          try {
            return JSON.parse(cleaned);
          } catch {
            // continue trying shorter candidates
          }
        }
      }

      // If payload contains a top-level array (e.g., the model returned only the entries array),
      // try extracting the first [...] substring and wrap into { entries: [...] }
      const firstBracket = s.indexOf("[");
      const lastBracket = s.lastIndexOf("]");
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        const arrCandidate = s.slice(firstBracket, lastBracket + 1);
        const cleanedArr = arrCandidate.replace(/,(\s*[}\]])/g, "$1");
        try {
          const parsedArr = JSON.parse(cleanedArr);
          if (Array.isArray(parsedArr)) {
            return { entries: parsedArr };
          }
          return parsedArr;
        } catch {
          // fallthrough
        }
      }
    }

    // 最後回傳原始 raw（會在上層被 zod 檢查並拋出錯誤）
    return raw;
  }

  /**
   * 解析故事腳本輸出。
   */
  parseStoryResult(
    result: ChatCompletionResult<unknown>,
  ): { story: StoryScriptResult; usage?: ChatCompletionResult<unknown>["usage"] } {
    const payload = this.safeParsePayload(result.data);
    const parsed = this.storySchema.parse(payload);

    const pages: StoryScriptPage[] = parsed.pages.map((page) => ({
      pageNumber: page.page_number,
      textEn: page.text_en,
      summaryEn: page.summary_en,
    }));

    const story: StoryScriptResult = {
      titleEn: parsed.title_en,
      synopsisEn: parsed.synopsis_en,
      pages,
    };

    return {
      story,
      usage: result.usage,
    };
  }

  /**
   * 解析中文翻譯輸出。
   */
  parseTranslationResult(
    result: ChatCompletionResult<unknown>,
  ): { translation: TranslationResult; usage?: ChatCompletionResult<unknown>["usage"] } {
    const payload = this.safeParsePayload(result.data);
    const parsed = this.translationSchema.parse(payload);

    const pages: TranslationPage[] = parsed.pages.map((page) => ({
      pageNumber: page.page_number,
      textZh: page.text_zh,
      notesZh: page.notes_zh,
    }));

    const translation: TranslationResult = {
      titleZh: parsed.title_zh,
      synopsisZh: parsed.synopsis_zh,
      pages,
    };

    return {
      translation,
      usage: result.usage,
    };
  }

  /**
   * 解析精選單字輸出。
   */
  parseVocabularyResult(
    result: ChatCompletionResult<unknown>,
  ): { vocabulary: VocabularyResult; usage?: ChatCompletionResult<unknown>["usage"] } {
    const payload = this.safeParsePayload(result.data);
    const parsed = this.vocabularySchema.parse(payload);

    const entries: VocabularyEntry[] = parsed.entries.map((item) => ({
      word: item.word,
      partOfSpeech: item.part_of_speech,
      definitionEn: item.definition_en,
      definitionZh: item.definition_zh,
      exampleSentence: item.example_sentence,
      exampleTranslation: item.example_translation,
      cefrLevel: item.cefr_level,
    }));

    const vocabulary: VocabularyResult = { entries };

    return {
      vocabulary,
      usage: result.usage,
    };
  }
}