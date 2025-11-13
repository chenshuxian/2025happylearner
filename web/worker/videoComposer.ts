import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { env } from "../lib/utils/env";

/**
 * Video composer
 *
 * 簡易的 ffmpeg-based video composer 範例（同步呼叫外部 ffmpeg binary）。
 * - 將多張 image 與對應 audio 合成一支影片（單一 audio 或 per-page audio 可擴充）
 * - 輸出為 local file path（在實際部署時請將結果上傳至 blob 存儲並回傳公開 URI）
 *
 * 注意：
 * - 需要系統安裝 ffmpeg 並可在 PATH 下執行。
 * - 此為示範實作，生產環境建議用專門的媒體服務或把 ffmpeg 放到容器中執行並將結果上傳到 S3/GCS。
 */

/**
 * Compose options
 */
export interface ComposeOptions {
  imageUris: string[]; // array of image URLs (or local paths)
  audioUri?: string; // single audio track for whole video (optional)
  perPageDurations?: number[]; // seconds per image; if omitted: evenly split
  outputDir?: string; // where to store temporary outputs
  outputFilename?: string; // desired output filename (without dir)
  format?: "mp4" | "webm" | "gif";
  fps?: number;
}

/**
 * Compose result
 */
export interface ComposeResult {
  uri: string; // local file path (recommend upload to blob and return public URI)
  format: string;
  metadata?: Record<string, unknown>;
}

/**
 * Ensure directory exists
 * @param dir
 */
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Download remote images to local temp files (naive implementation).
 * In production, prefer streaming to disk with proper retries & timeouts.
 * @param uris
 * @param destDir
 * @returns array of local file paths (same order)
 */
async function downloadImagesToLocal(uris: string[], destDir: string): Promise<string[]> {
  ensureDir(destDir);
  const results: string[] = [];

  // naive implementation: if uri is already a local path, use it
  for (let i = 0; i < uris.length; i++) {
    const uri = uris[i];
    if (uri.startsWith("http://") || uri.startsWith("https://")) {
      // fetch and save
      const outPath = path.join(destDir, `img_${i}.png`);
      const res = await fetch(uri);
      if (!res.ok) throw new Error(`failed to download image ${uri}: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(outPath, buffer);
      results.push(outPath);
    } else {
      // assume local path
      if (!fs.existsSync(uri)) throw new Error(`local image not found: ${uri}`);
      results.push(uri);
    }
  }

  return results;
}

/**
 * Compose images + audio into a single video using ffmpeg.
 * This implementation:
 *  - creates an input file list for ffmpeg (concat via image2 demuxer)
 *  - uses -loop 1 per image with concat filter (safe approach is to create a video segment per image then concat)
 *
 * For simplicity and reliability we create a temporary directory, create per-image video segments, then concat.
 *
 * @param opts
 * @returns ComposeResult
 */
export async function composeVideo(opts: ComposeOptions): Promise<ComposeResult> {
  const tmpDir = opts.outputDir ?? path.join(process.cwd(), "tmp", "video_composer");
  ensureDir(tmpDir);

  const outFilename = opts.outputFilename ?? `story_video_${Date.now()}.${opts.format ?? "mp4"}`;
  const outPath = path.join(tmpDir, outFilename);
  const format = opts.format ?? "mp4";
  const fps = opts.fps ?? 24;
  const imagePaths = await downloadImagesToLocal(opts.imageUris, path.join(tmpDir, "images"));

  // compute durations
  const durations =
    opts.perPageDurations && opts.perPageDurations.length === imagePaths.length
      ? opts.perPageDurations
      : imagePaths.map(() => 3); // default 3s per image

  // Step 1: create per-image video segments
  const segmentPaths: string[] = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const img = imagePaths[i];
    const dur = durations[i];
    const segPath = path.join(tmpDir, `seg_${i}.mp4`);
    // ffmpeg command:
    // ffmpeg -y -loop 1 -i img -c:v libx264 -t {dur} -pix_fmt yuv420p -vf scale=1280:720 -r {fps} segPath
    await runFfmpeg([
      "-y",
      "-loop",
      "1",
      "-i",
      img,
      "-c:v",
      "libx264",
      "-t",
      String(dur),
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "scale=1280:720",
      "-r",
      String(fps),
      segPath,
    ]);
    segmentPaths.push(segPath);
  }

  // Step 2: create concat file
  const concatFile = path.join(tmpDir, "concat_list.txt");
  const concatContent = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(concatFile, concatContent, "utf-8");

  // Step 3: concat segments
  const videoOnlyPath = path.join(tmpDir, `video_only_${Date.now()}.mp4`);
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", videoOnlyPath]);

  let finalPath = outPath;

  // Step 4: if audio provided, merge audio
  if (opts.audioUri) {
    // download audio if needed
    let audioPath = opts.audioUri;
    if (audioPath.startsWith("http://") || audioPath.startsWith("https://")) {
      const audioDest = path.join(tmpDir, `audio_${Date.now()}.mp3`);
      const resp = await fetch(audioPath);
      if (!resp.ok) throw new Error(`failed to download audio ${audioPath}: ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(audioDest, buf);
      audioPath = audioDest;
    } else {
      if (!fs.existsSync(audioPath)) throw new Error(`audio file not found: ${audioPath}`);
    }

    // merge audio and video (shorten or loop audio as needed is out-of-scope)
    finalPath = path.join(tmpDir, `final_${Date.now()}.${format}`);
    await runFfmpeg(["-y", "-i", videoOnlyPath, "-i", audioPath, "-c:v", "copy", "-c:a", "aac", "-shortest", finalPath]);
  } else {
    finalPath = videoOnlyPath;
  }

  // Note: In production, upload finalPath to blob storage and return public URI instead of local path.
  return {
    uri: finalPath,
    format,
    metadata: {
      segments: segmentPaths.length,
      durationSeconds: durations.reduce((a, b) => a + b, 0),
    },
  };
}

/**
 * Run ffmpeg with args, return a promise that resolves when done
 * @param args
 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", args, { stdio: "inherit" });
    ff.on("error", (err) => {
      reject(err);
    });
    ff.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}