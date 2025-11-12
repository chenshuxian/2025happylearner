import OpenAI from "openai";
import type { ClientOptions } from "openai";
import pRetry, { AbortError } from "p-retry";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat";
import { env } from "../utils/env";
import type { ChatCompletionResult } from "./types";

/**
 * Type-guard / helper to safely read numeric status from unknown error objects.
 */
function getStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "status" in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return undefined;
}

/**
 * Tolerant extractor for usage objects (handles snake_case and camelCase).
 */
function extractUsage(obj: unknown): ChatCompletionResult<unknown>["usage"] | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;
  const usageObj = obj as Record<string, unknown>;
  const prompt = usageObj.prompt_tokens ?? usageObj.promptTokens;
  const completion = usageObj.completion_tokens ?? usageObj.completionTokens;
  const total = usageObj.total_tokens ?? usageObj.totalTokens;
  if (typeof prompt === "number" && typeof completion === "number" && typeof total === "number") {
    return {
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total,
    };
  }
  return undefined;
}

/**
 * OpenAI 客戶端封裝，負責 retry、超時與日誌統一管理。
 *
 * 注意：此 adapter 會嘗試解析第一個 choice 的 message.content 為 JSON，
 * 若解析失敗則回傳原始字串作為 data。
 */
export class OpenAIClientAdapter {
  private readonly client: OpenAI;

  /**
   * @param options OpenAI SDK 自訂設定，例如 baseURL。
   */
  constructor(options?: ClientOptions) {
    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      ...options,
    });
  }

  /**
   * 執行 Chat Completions 呼叫，並使用指數退避策略重試。
   * 會回傳統一的 ChatCompletionResult<T> 格式，方便上層不直接依賴 SDK 型別。
   *
   * @param params ChatCompletion 請求參數。
   * @param retryCount 重試次數。
   */
  async createChatCompletion<T = unknown>(
    params: ChatCompletionCreateParamsNonStreaming,
    retryCount = 3,
  ): Promise<ChatCompletionResult<T>> {
    const start = performance.now();

    try {
      const response = await pRetry(
        async () => {
          try {
            return await this.client.chat.completions.create({
              ...params,
            });
          } catch (error) {
            // 判斷是否為可重試的 server/rate-limit 錯誤
            const status = getStatus(error);
            if (status !== undefined && status >= 500) {
              throw error; // 伺服器錯誤 -> 可重試
            }
            if (status === 429) {
              throw error; // rate limit -> 可重試
            }
            // 其他錯誤視為不可重試
            throw new AbortError((error as Error).message);
          }
        },
        {
          retries: retryCount,
          factor: 2,
          minTimeout: 1000,
        },
      );

      const duration = performance.now() - start;

      const choice = response?.choices?.[0];
      // 支援 new SDK shape: choice.message.content
      // 使用明確的 runtime guard 取代 @ts-expect-error，以便在不同 SDK shape 下安全擷取字串
      const maybeMessage = (choice as unknown as { message?: { content?: unknown } } | undefined)?.message;
      const maybeMessageContent = maybeMessage?.content;
      const maybeText = (choice as unknown as { text?: unknown } | undefined)?.text;
      const contentStr =
        typeof maybeMessageContent === "string"
          ? maybeMessageContent
          : typeof maybeText === "string"
          ? maybeText
          : undefined;

      let parsed: unknown = contentStr ?? null;
      if (typeof contentStr === "string") {
        try {
          parsed = JSON.parse(contentStr);
        } catch {
          // 不是 JSON，保留原始字串
          parsed = contentStr;
        }
      }

      const usage = extractUsage((response as unknown as Record<string, unknown>)?.usage);

      console.info("[openai] chat completion success", {
        model: params.model,
        durationMs: duration,
        usage,
      });

      return {
        data: parsed as T,
        usage,
      };
    } catch (error) {
      const duration = performance.now() - start;
      console.error("[openai] chat completion failed", {
        model: params.model,
        durationMs: duration,
        error,
      });
      throw error;
    }
  }
}