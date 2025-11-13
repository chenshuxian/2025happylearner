import { db } from "../../db/client";
import { failedJobs } from "../../db/schema/failed-jobs";
import { env } from "../utils/env";
import { Client } from "pg";

/**
 * ErrorHandler
 *
 * 負責：
 * - 將 generation job 的錯誤寫入 failed_jobs（供後台檢視與人工介入）
 * - 選擇性通知 Slack（若設定 SLACK_WEBHOOK）
 * - 提供格式化與重試判斷輔助（ex: 是否達到重試上限）
 *
 * 設計原則：
 * - 不直接決定 job 的重試行為（上層 worker/orchestrator 負責重新推入佇列）
 * - 提供一個簡單的統一錯誤紀錄與通知介面
 *
 * 所有公開方法都有 function-level JSDoc。
 */

/**
 * 失敗紀錄的最小上下文結構。
 */
export interface FailureContext {
  generationJobId: string;
  stage?: string; // e.g., "story", "translation", "vocabulary"
  attempt?: number;
  extra?: Record<string, unknown>;
}

/**
 * ErrorHandler Configuration。
 */
export interface ErrorHandlerOptions {
  /**
   * 是否在記錄後同步發出 Slack 通知（若未設定 webhook，則不會發送）。
   */
  notifySlack?: boolean;
  /**
   * 傳入的 DB 實例（預設使用 web/db/client.ts 匯出的 db）。
   */
  dbClient?: typeof db;
}

/**
 * 預設 ErrorHandler 類別。
 */
export class ErrorHandler {
  private dbClient: typeof db;
  private slackWebhook?: string;
  private notifySlackFlag: boolean;

  /**
   * 建構子
   * @param opts ErrorHandlerOptions
   */
  constructor(opts?: ErrorHandlerOptions) {
    this.dbClient = opts?.dbClient ?? db;
    // 避免使用 `any` cast，使用更保守的 unknown -> Record 型別斷言取得可選環境變數
    this.slackWebhook = (env as unknown as Record<string, string | undefined>).SLACK_WEBHOOK;
    this.notifySlackFlag = !!opts?.notifySlack;
  }

  /**
   * 將失敗寫入資料庫 failed_jobs。
   *
   * @param context FailureContext 包含 generationJobId 與其他描述
   * @param error Error 或任意錯誤物件
   * @returns 寫入的 failed_jobs 記錄（若寫入失敗則拋出錯誤）
   */
  async recordFailure(context: FailureContext, error: unknown) {
    // 格式化錯誤內容
    const errMessage =
      error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : JSON.stringify(error);

    const errorRecord = {
      generationJobId: context.generationJobId,
      errorCode: getErrorCode(error),
      errorMessage: `stage=${context.stage ?? "unknown"} attempt=${context.attempt ?? 0} message=${errMessage}`,
    };

    // 優先使用原生 pg client 直接寫入，避免 Drizzle/@vercel/postgres 在 dev 中的 transaction/連線問題
    try {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        const res = await client.query(
          `INSERT INTO failed_jobs (generation_job_id, error_code, error_message) VALUES ($1,$2,$3) RETURNING id, generation_job_id, error_code, error_message, resolved, created_at, updated_at`,
          [errorRecord.generationJobId ?? null, errorRecord.errorCode, errorRecord.errorMessage],
        );

        // 在寫入成功後，視情況通知 Slack
        if (this.notifySlackFlag && this.slackWebhook) {
          void this.notifySlack(context, errMessage).catch((e) => {
            console.error("[ErrorHandler] failed to send slack notification", e);
          });
        }

        try {
          await client.end();
        } catch {
          // ignore
        }

        return res.rows[0];
      } catch (pgErr) {
        try {
          await client.end();
        } catch {
          // ignore
        }
        throw pgErr;
      }
    } catch (pgErr) {
      // 如果原生 pg 也失敗，嘗試回退策略：
      // 1) 若注入的 dbClient 支援 Drizzle-style insert API，使用它寫入 failed_jobs
      // 2) 否則重新拋出原始 pgErr（讓呼叫端決定如何處理）
      try {
        if (this.dbClient && typeof (this.dbClient as any).insert === "function") {
          const inserted = await (this.dbClient as any).insert(failedJobs).values({
            generationJobId: errorRecord.generationJobId,
            errorCode: errorRecord.errorCode,
            errorMessage: errorRecord.errorMessage,
          }).returning();
    
          if (this.notifySlackFlag && this.slackWebhook) {
            void this.notifySlack(context, errMessage).catch((e) => {
              console.error("[ErrorHandler] failed to send slack notification", e);
            });
          }
    
          return inserted;
        }
      } catch (fallbackErr) {
        // 忽略 fallback 自身錯誤，接下來會拋出原始 pgErr
        console.error("[ErrorHandler] fallback to drizzle insert failed:", fallbackErr);
      }
    
      // 無可行的回退，重新拋出原始 pgErr
      throw pgErr;
    }
  }

  /**
   * 通知 Slack（private helper）。
   *
   * @param context FailureContext
   * @param errMessage 已格式化的錯誤字串
   */
  private async notifySlack(context: FailureContext, errMessage: string) {
    if (!this.slackWebhook) {
      return;
    }

    const payload = {
      text: `:warning: generation job failed\n• job: ${context.generationJobId}\n• stage: ${context.stage ?? "unknown"}\n• attempt: ${context.attempt ?? 0}\n• error: ${errMessage.slice(0, 2000)}`, // Slack message limit safety
    };

    // Node / Edge 環境皆支援 fetch；若不支援，這裡會拋出錯誤由呼叫端處理
    const resp = await fetch(this.slackWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "<no body>");
      console.error("[ErrorHandler] Slack webhook failed", resp.status, text);
    }
  }

  /**
   * 根據錯誤與嘗試次數判定是否應該進行重試（輕度輔助邏輯）。
   * - 預設策略：HTTP 5xx / rate-limit 可重試，且嘗試次數小於 3。
   *
   * @param error 任意錯誤物件
   * @param attempt 已嘗試次數
   * @returns boolean 是否建議重試
   */
  shouldRetry(error: unknown, attempt = 0): boolean {
    // 如果已嘗試超過 3 次，不建議再重試
    if (attempt >= 3) return false;

    // 嘗試從 error 中擷取 status/code 判定
    const status = getStatus(error);
    if (typeof status === "number") {
      if (status >= 500 || status === 429) return true;
      return false;
    }

    // 若為 AbortError (p-retry 中止) 則不重試
    const name = getErrorName(error);
    if (typeof name === "string" && name.includes("Abort")) return false;

    // 對於其他未知錯誤採保守策略：不自動重試
    return false;
  }
}

/**
 * 從未知錯誤物件擷取狀態碼（若存在）。
 */
function getStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    const maybeStatus = e.status ?? e.statusCode ?? e.code;
    if (typeof maybeStatus === "number") return maybeStatus;
  }
  return undefined;
}

/**
 * 從未知錯誤物件擷取錯誤名稱或代碼（字串）。
 */
function getErrorName(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    const name = e.name ?? e.code;
    if (typeof name === "string") return name;
  }
  if (err instanceof Error) return err.name;
  return undefined;
}

/**
 * 從未知錯誤物件擷取錯誤代碼（字串或 null）。
 */
function getErrorCode(err: unknown): string | null {
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    const code = e.code ?? e.errorCode;
    if (typeof code === "string") return code;
  }
  return null;
}

export default ErrorHandler;