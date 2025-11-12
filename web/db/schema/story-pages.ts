import { relations } from "drizzle-orm";
import {
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { stories } from "./stories";
import { mediaAssets } from "./media-assets";

/**
 * 故事分頁資料表定義。
 */
/**
 * 使用 ReturnType<typeof pgTable> 保留 Drizzle 的靜態型別資訊，避免使用 any。
 * 若遇到 circular type inference 的編譯問題，可改為導出 ReturnType<typeof pgTable> 並在需要處使用該型別。
 */
export const storyPages = pgTable("story_pages", {
  id: uuid("id").defaultRandom().primaryKey(),
  storyId: uuid("story_id")
    .references(() => stories.id, { onDelete: "cascade" })
    .notNull(),
  pageNumber: smallint("page_number").notNull(),
  textEn: text("text_en").notNull(),
  textZh: text("text_zh").notNull(),
  wordCount: integer("word_count").default(0).notNull(),
  mediaAssetId: uuid("media_asset_id").references(() => mediaAssets.id),
  audioAssetId: uuid("audio_asset_id").references(() => mediaAssets.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}) as unknown as ReturnType<typeof pgTable>;

/**
 * 故事分頁關聯設定。
 */
export const storyPagesRelations = relations(storyPages, ({ one }) => ({
  story: one(stories, {
    fields: [storyPages.storyId],
    references: [stories.id],
  }),
  mediaAsset: one(mediaAssets, {
    fields: [storyPages.mediaAssetId],
    references: [mediaAssets.id],
  }),
  audioAsset: one(mediaAssets, {
    fields: [storyPages.audioAssetId],
    references: [mediaAssets.id],
  }),
}));