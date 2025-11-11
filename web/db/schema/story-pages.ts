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
});

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