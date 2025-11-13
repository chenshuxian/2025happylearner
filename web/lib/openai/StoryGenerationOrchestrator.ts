import { OpenAIClientAdapter } from "./OpenAIClientAdapter";
import { PromptToolkit } from "./PromptToolkit";
import { ResultAssembler } from "./ResultAssembler";
import ErrorHandler from "./ErrorHandler";
import type {
  StoryGenerationPayload,
  ChatCompletionResult,
  StoryScriptResult,
  TranslationResult,
  VocabularyResult,
  OpenAIAdapter,
} from "./types";

/**
 * StoryGenerationOrchestrator
 *
 * 負責協調故事腳本、翻譯與精選單字的整個同步生成流程。
 * - 以 PromptToolkit 產生 prompt
 * - 透過 OpenAIClientAdapter 呼叫模型
 * - 使用 ResultAssembler 驗證並轉換輸出
 * - 在錯誤時交由 ErrorHandler 記錄 failed_jobs 並通知（若設定）
 *
 * 注意：此實作專注於「文字生成階段」的串聯與資料驗證，
 * 實際的資料庫寫入與佇列推送應由上層的 Route Handler / Worker 負責。
 */
export class StoryGenerationOrchestrator {
  private ai: OpenAIClientAdapter;
  private prompts: PromptToolkit;
  private assembler: ResultAssembler;
  private errorHandler: ErrorHandler;

  /**
   * @param ai (optional) 外部注入的 OpenAIClientAdapter 實例，便於測試
   * @param errorHandler (optional) 外部注入的 ErrorHandler 實例
   */
  constructor(ai?: OpenAIAdapter, errorHandler?: ErrorHandler) {
    // 支援注入任何符合 OpenAIAdapter 介面的實作（包括 OpenAIClientAdapter 與測試 mock）
    this.ai = (ai as OpenAIClientAdapter) ?? new OpenAIClientAdapter();
    this.prompts = new PromptToolkit();
    this.assembler = new ResultAssembler();
    this.errorHandler = errorHandler ?? new ErrorHandler();
  }

  /**
   * 執行整個文字生成流程（腳本 -> 翻譯 -> 單字）。
   * 回傳已驗證的結構化結果與每階段 token usage。
   *
   * 錯誤策略：
   * - 若任一階段拋出錯誤，會先透過 ErrorHandler.recordFailure 記錄（包含 stage 與 storyId），
   *   然後將錯誤向上拋出，由上層負責重試或標記 generation_jobs 為 failed。
   *
   * @param payload 生成任務所需參數（storyId, theme, tone, ageRange）
   * @returns 物件包含 story、translation、vocabulary 與 usage 彙總
   */
  async run(
    payload: StoryGenerationPayload,
  ): Promise<{
    story: StoryScriptResult;
    translation: TranslationResult;
    vocabulary: VocabularyResult;
    usages: {
      story?: ChatCompletionResult<unknown>["usage"];
      translation?: ChatCompletionResult<unknown>["usage"];
      vocabulary?: ChatCompletionResult<unknown>["usage"];
    };
  }> {
    const usages: {
      story?: ChatCompletionResult<unknown>["usage"];
      translation?: ChatCompletionResult<unknown>["usage"];
      vocabulary?: ChatCompletionResult<unknown>["usage"];
    } = {};

    try {
      // 1) 產生故事腳本（使用 OpenAIClientAdapter 回傳的標準格式）
      const storyMessages = this.prompts.getStoryScriptPrompt(payload);
      const storyResp = await this.ai.createChatCompletion<StoryScriptResult>({
        model: "gpt-4.1",
        messages: storyMessages,
        temperature: 0.8,
        max_tokens: 2000,
      });

      // 直接使用 adapter 解析後的 data 與 usage，交給 Assembler 驗證
      const { story, usage: storyUsage } = this.assembler.parseStoryResult({
        data: storyResp.data,
        usage: storyResp.usage,
      });

      usages.story = storyUsage;

      // 2) 中文翻譯（使用 story 內容作為上下文）
      const translationMessages = this.prompts.getTranslationPrompt(story);
      const translationResp = await this.ai.createChatCompletion<TranslationResult>({
        model: "gpt-4o-mini",
        messages: translationMessages,
        temperature: 0.2,
        max_tokens: 1500,
      });

      const { translation, usage: translationUsage } = this.assembler.parseTranslationResult({
        data: translationResp.data,
        usage: translationResp.usage,
      });

      usages.translation = translationUsage;

      // 3) 精選單字（以翻譯後內容為輸入，方便中英文對照）
      const vocabMessages = this.prompts.getVocabularyPrompt(translation);
      const vocabResp = await this.ai.createChatCompletion<VocabularyResult>({
        model: "gpt-4o-mini",
        messages: vocabMessages,
        temperature: 0.1,
        max_tokens: 800,
      });

      const { vocabulary, usage: vocabularyUsage } = this.assembler.parseVocabularyResult({
        data: vocabResp.data,
        usage: vocabResp.usage,
      });

      usages.vocabulary = vocabularyUsage;

      // 回傳所有已驗證的資料，讓上層負責寫入 DB 與排隊媒體生成任務
      return {
        story,
        translation,
        vocabulary,
        usages,
      };
    } catch (err) {
      // 記錄失敗（將 storyId 當作 generationJobId 的替代）
      try {
        await this.errorHandler.recordFailure(
          { generationJobId: payload.storyId, stage: "orchestrator", attempt: 0, extra: { theme: payload.theme } },
          err,
        );
      } catch (recordErr) {
        // 若記錄失敗，僅記 log，不遮蔽原始錯誤
        console.error("[StoryGenerationOrchestrator] failed to record error", recordErr);
      }
      // 向上拋出原始錯誤，讓上層決定是否重試或標記為 failed
      throw err;
    }
  }
}