# todolist

- [x] 初始化資料庫 Schema 與 ORM 設定（stories, story_pages, media_assets, vocab_entries, generation_jobs 等）
- [ ] 實作 OpenAI 文字生成流程（故事腳本、中文翻譯、精選單字）
- [x] 建立媒體生成管線（圖像、音訊、影片）並串接 Upstash Redis 佇列（部分完成：加入 ioredis 支援與推送測試）
- [ ] 實裝 Vercel Cron 排程與任務觸發 API
- [ ] 開發 Next.js App Router 前端閱讀介面與精選單字互動
- [ ] 建立管理後台 Server Actions（故事審核、重跑任務、失敗重試）
- [ ] 導入監控與通知（Sentry、排程失敗提醒）並完善部署流程