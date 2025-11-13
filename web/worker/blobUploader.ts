import fs from "fs";
import path from "path";
import { env } from "../lib/utils/env";

/**
 * Blob uploader (local fallback)
 *
 * 提供簡單的上傳介面：若未設定外部儲存（S3/GCS）時，會把檔案儲存在 local upload dir（預設：./tmp/uploads）
 * 並回傳可用的 file:// URI。未來可擴充成支援 S3 / GCS。
 *
 * 使用情境：
 *  - videoComposer 產生檔案後呼叫 uploadLocalFile -> 取得公開可存取 URI（file:// or uploaded URL）
 *
 * 函式級 JSDoc（符合專案規範）
 */

/**
 * Upload options
 */
export interface UploadOptions {
  /**
   * 指定上傳目錄（預設會使用 env.UPLOAD_DIR 或 ./tmp/uploads）
   */
  uploadDir?: string;
  /**
   * 要用作檔名的 key（若未提供會自動產生隨機檔名）
   */
  filename?: string;
}

/**
 * 將本地檔案上傳（實際為搬移或複製到 uploadDir），並回傳可用的 URI
 * @param srcPath 本地檔案路徑
 * @param opts UploadOptions
 * @returns {Promise<{ uri: string; path: string }>} 回傳檔案 URI（file://）與實際儲存路徑
 */
export async function uploadLocalFile(
  srcPath: string,
  opts: UploadOptions = {}
): Promise<{ uri: string; path: string }> {
  const uploadDir = opts.uploadDir ?? env.UPLOAD_DIR ?? path.join(process.cwd(), "tmp", "uploads");
  await ensureDir(uploadDir);

  const filename = opts.filename ?? path.basename(srcPath);
  const destPath = path.join(uploadDir, `${Date.now()}_${sanitizeFilename(filename)}`);

  await fs.promises.copyFile(srcPath, destPath);

  // Return file:// URI (consumer may upload to CDN in future)
  return { uri: `file://${destPath}`, path: destPath };
}

/**
 * 將 Buffer 以指定檔名寫入 uploadDir，並回傳 URI
 * @param buf Buffer
 * @param filename 檔名（例如 story_video_123.mp4）
 * @param opts UploadOptions
 * @returns {Promise<{ uri: string; path: string }>}
 */
export async function uploadBuffer(
  buf: Buffer,
  filename: string,
  opts: UploadOptions = {}
): Promise<{ uri: string; path: string }> {
  const uploadDir = opts.uploadDir ?? env.UPLOAD_DIR ?? path.join(process.cwd(), "tmp", "uploads");
  await ensureDir(uploadDir);

  const destPath = path.join(uploadDir, `${Date.now()}_${sanitizeFilename(filename)}`);
  await fs.promises.writeFile(destPath, buf);

  return { uri: `file://${destPath}`, path: destPath };
}

/**
 * Ensure directory exists
 * @param dir
 */
async function ensureDir(dir: string) {
  await fs.promises.mkdir(dir, { recursive: true });
}

/**
 * Sanitize filename to avoid path traversal / invalid chars
 * @param name
 */
function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}