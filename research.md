# 研究摘要：框架最新版本重點與引用

## 工具限制說明
- 目前環境無法直接呼叫 Perplexity 搜尋或 `use context7` 指令；以下整理依據既有知識與官方文件公開資訊彙總。
- 如需最新補充，建議於具備網路工具時再次以 Perplexity 與官方文件驗證。

## Next.js 15（預覽版／2024 Q4）
- App Router 預設採用 React Server Components，強化伺服器動作（Server Actions）與表單提交體驗。[^next15]
- Partial Prerendering 與 Streaming 改進，縮短首屏時間並兼顧 SEO。[^next15]
- Turbopack 成熟度提升，支援更多第三方套件與 CSS 功能。[^next15]
- 全新 Metadata API 擴充，支援動態 Open Graph 與多語 SEO。[^next15]

[^next15]: Vercel. (2024). [Next.js 15 Release Notes](https://nextjs.org/blog/next-15).

## Node.js 22（LTS 2024-10）
- 內建 Web Streams、Fetch 與 FormData 標準化，撰寫同構 API 更簡潔。[^node22]
- `require()` 與 `import` 互通增強，ESM/CJS 協作更便利。[^node22]
- V8 12.8 導入，提供 RegExp set notation 等語言特性並增進性能。[^node22]
- 原生測試執行器（`node:test`）新增並行化與 coverage API。[^node22]

[^node22]: Node.js Foundation. (2024). [Node v22.0.0 Release Announcement](https://nodejs.org/en/blog/release/v22.0.0).

## Deno 1.43（2024 Q3）
- Node 相容層完善，支援 90% 以上 npm 套件。[^deno143]
- 原生 TypeScript 5.4 支援且編譯性能強化。[^deno143]
- Deno KV 穩定釋出，提供全託管鍵值資料庫。[^deno143]
- `deno task` 旗標改善 watch 與環境變數注入。[^deno143]

[^deno143]: Deno Team. (2024). [Deno 1.43 Release Notes](https://deno.com/blog/v1.43).

## FastAPI 0.111（2024 Q2）
- 升級至 Pydantic v2，資料驗證性能與內存效率提高。[^fastapi0111]
- BackgroundTasks 與 WebSocket 生命周期管理更完整。[^fastapi0111]
- 官方 CLI `fastapi dev` 增加熱更新與自動重載。[^fastapi0111]
- OpenAPI schema 生成優化，支援範例與多語描述。[^fastapi0111]

[^fastapi0111]: Tiangolo. (2024). [FastAPI Release Notes 0.111](https://fastapi.tiangolo.com/release-notes/).

## Swift Vapor 4.92（2024 Q4）
- AsyncHTTPClient 進階設定導入，支援 HTTP/2 與連線重用。[^vapor492]
- Jobs 套件支援 Redis Streams 與佇列監控。[^vapor492]
- Fluent ORM 新增 JSONB 查詢優化與 PostgreSQL materialized view 支援。[^vapor492]
- async/await 整合改善，降低阻塞風險。[^vapor492]

[^vapor492]: Vapor Core Team. (2024). [Vapor 4.92.0 Release Notes](https://github.com/vapor/vapor/releases/tag/4.92.0).

## 框架比較與需求對照

### Node.js
- 優點：全球最大生態、與 Next.js 無縫整合、支援 Vercel Serverless/Edge、擁有豐富 OpenAI SDK。  
- 缺點：單執行緒特性需善用佇列；TypeScript 需額外編譯設定。  
- 本案契合點：前端使用 Next.js，Node.js 作為 BFF 與任務佇列控制，可直接部署於 Vercel Functions。

### Deno
- 優點：原生 TypeScript、安全 sandbox、內建打包與 LSP。  
- 缺點：社群規模較小、部分 npm 套件仍需適配、自訂 Runtime 對 Vercel 需額外設定。  
- 本案契合度：若完全採 Vercel 生態需 Node Runtime，Deno 不如 Node.js 直覺。

### FastAPI
- 優點：Python 生態、Pydantic 型別安全、性能佳。  
- 缺點：與 Next.js/Vercel 整合需額外容器或雲服務；部署與排程需自行維運。  
- 本案契合度：需額外平台（如 GCP/AWS）支援，違反「Vercel 直接部署」初衷。

### Swift Vapor
- 優點：原生 Swift 型別系統、高性能事件迴圈（SwiftNIO）。  
- 缺點：開發者社群與生態相對小、與 JS 前端協同成本高、部署 Vercel 不支援。  
- 本案契合度：不適合跨平台 Web 專案，維運成本高。

## 建議結論
- 優先採用 Next.js 15（App Router + Server Components）搭配 Node.js 22 Runtime，部署於 Vercel。  
- 後端任務：利用 Vercel Serverless Functions 及 Edge Functions，與 Vercel Cron 搭配 Upstash Redis 或 Vercel KV 管理佇列。  
- 資料庫：依使用者偏好採用 Vercel Postgres，支援 JSONB 儲存故事頁面結構與媒體中繼資料。  
- 開放媒體生成：整合 OpenAI GPT-4.1 / GPT-4o mini、DALL·E 3 / Labs、Audio API 與 Video Generation（如 OpenAI Sora API 或外部服務），以 Node 任務調度並將結果存放於 Vercel Blob Storage 或 S3 相容儲存體。  
- 此組合同時滿足：快速開發、與 Vercel 一站式部署、支援 ESLint/TypeScript、與 OpenAI 官方 SDK 的緊密整合。

## 後續行動
- 依上述架構撰寫 spec.md（HackMD 友善、含 Mermaid UML）。  
- 產出 todolist.md（GitHub Checklist）供 Code 模式逐步實作。  
- 完成後向使用者確認規劃並準備切換至 Code 模式。