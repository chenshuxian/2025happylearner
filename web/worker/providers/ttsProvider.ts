import { env } from "../../lib/utils/env";

/**
 * TTS provider abstraction（stub）
 *
 * - 若設定 TTS provider key（例如 ELEVENLABS_API_KEY），可在此實作實際呼叫。
 * - 預設回傳一公開可訪問的示例 MP3（方便在開發 / staging 使用）。
 *
 * Return shape:
 * {
 *   uri: string,
 *   format: string, // e.g. "mp3", "wav"
 *   metadata?: Record<string, unknown>
 * }
 */

/**
 * TTS options
 */
export interface TTSOptions {
  text: string;
  voice?: string;
  format?: "mp3" | "wav";
  speed?: number;
}

/**
 * TTS provider result
 */
export interface TTSResult {
  uri: string;
  format: string;
  metadata?: Record<string, unknown>;
}

/**
 * 呼叫 TTS provider 產生語音（目前為 stub）
 * @param opts
 * @param envVars
 * @returns TTSResult
 */
export async function callTTSProvider(opts: TTSOptions, envVars: Partial<typeof env> = env): Promise<TTSResult> {
  // 若有設定實際 TTS provider，這裡可實作 HTTP 呼叫
  if (envVars.ELEVENLABS_API_KEY) {
    try {
      // TODO: 呼叫 ElevenLabs 或其他 TTS 服務
      // 範例（註解）：
      // const resp = await fetch("https://api.elevenlabs.io/v1/text-to-speech/...", { method: "POST", headers: { Authorization: `Bearer ${envVars.ELEVENLABS_API_KEY}` }, body: ... });
      // const blob = await resp.arrayBuffer();
      // 上傳 blob 到 blob storage 並回傳其 URI
      console.info("[ttsProvider] ELEVENLABS_API_KEY set but provider call not implemented; returning placeholder");
    } catch (err) {
      console.warn("[ttsProvider] provider call failed, falling back to placeholder", err);
    }
  }

  // Fallback: public demo MP3 (for development)
  const demoMp3 = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";

  return {
    uri: demoMp3,
    format: opts.format ?? "mp3",
    metadata: {
      provider: envVars.ELEVENLABS_API_KEY ? "configured-but-unimplemented" : "placeholder",
      textSnippet: opts.text.slice(0, 80),
      voice: opts.voice ?? "default",
    },
  };
}