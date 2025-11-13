import { env } from "../../lib/utils/env";

/**
 * Image provider abstraction
 *
 * 目前為範例 stub 實作：
 * - 若設定 IMAGE_API_KEY（代表你有第三方影像服務），可以在此擴充實際的 HTTP 呼叫。
 * - 預設回傳一個 placeholder URI（可直接供前端或後續 pipeline 使用）。
 *
 * Return shape:
 * {
 *   uri: string,    // 可公開存取的資源位置（若為 base64，請在 caller 上傳至 blob）
 *   format: string, // e.g., "png", "webp", "jpg"
 *   metadata?: Record<string, unknown>
 * }
 */

/**
 * Image generation options
 */
export interface ImageOptions {
  prompt: string;
  size?: string;
  seed?: number;
  style?: string;
}

/**
 * Provider response shape
 */
export interface ImageProviderResult {
  uri: string;
  format: string;
  metadata?: Record<string, unknown>;
}

/**
 * 呼叫 image provider 產生圖片
 * @param opts 圖片生成參數
 * @param envVars 環境變數抽象（方便測試）
 * @returns ImageProviderResult
 */
export async function callImageProvider(opts: ImageOptions, envVars = env): Promise<ImageProviderResult> {
  // 範例：若有設定 IMAGE_API_KEY，可在此實作真實 provider 呼叫
  if (envVars.IMAGE_API_KEY) {
    try {
      // TODO: implement real provider call (OpenAI Images / Stability / Replicate / custom API)
      // 範例流程（註解）：
      // const resp = await fetch(providerUrl, { method: "POST", headers: {...}, body: JSON.stringify({ prompt: opts.prompt, size: opts.size }) });
      // const data = await resp.json();
      // if (data.url) return { uri: data.url, format: detectFormatFromUrl(data.url), metadata: { provider: "example" } };
      // if (data.base64) { upload to blob and return blob uri }

      // 現階段 fallback 到 placeholder（避免未實作時造成 runtime crash）
      console.info("[imageProvider] IMAGE_API_KEY set but provider call not implemented; returning placeholder");
    } catch (err) {
      console.warn("[imageProvider] provider call failed, falling back to placeholder", err);
    }
  }

  // Fallback placeholder: 可以替換為你自己的 blob 存儲或 CDN
  const width = opts.size?.split("x")?.[0] ?? "1024";
  const height = opts.size?.split("x")?.[1] ?? "1024";
  const placeholderUri = `https://placehold.co/${width}x${height}/png?text=${encodeURIComponent(
    opts.prompt.slice(0, 40),
  )}`;

  return {
    uri: placeholderUri,
    format: "png",
    metadata: {
      provider: envVars.IMAGE_API_KEY ? "configured-but-unimplemented" : "placeholder",
      prompt: opts.prompt,
      size: opts.size ?? "1024x1024",
    },
  };
}

/**
 * Utility: detect format from a URL (simple heuristic)
 * @param url
 */
export function detectFormatFromUrl(url: string): string {
  const m = url.match(/\\.([a-zA-Z0-9]+)(?:\\?|$)/);
  if (!m) return "bin";
  const ext = m[1].toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "png") return "png";
  if (ext === "webp") return "webp";
  if (ext === "gif") return "gif";
  return ext;
}