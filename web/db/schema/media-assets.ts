import { relations } from "drizzle-orm";
import { jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { stories } from "./stories";
import { storyPages } from "./story-pages";
import { generationJobs } from "./generation-jobs";

/**
 * 媒體資產類型列舉。
 */
export const mediaTypeEnum = pgEnum("media_type", ["image", "audio", "video"]);

/**
 * 媒體資產資料表定義。
 */
export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  storyId: uuid("story_id")
    .references(() => stories.id, { onDelete: "cascade" })
    .notNull(),
  pageId: uuid("page_id").references(() => storyPages.id, { onDelete: "cascade" }),
  type: mediaTypeEnum("type").notNull(),
  uri: text("uri").notNull(),
  format: varchar("format", { length: 50 }).notNull(),
  duration: varchar("duration", { length: 20 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  generationJobId: uuid("generation_job_id").references(() => generationJobs.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * 媒體資產關聯設定。
 */
export const mediaAssetsRelations = relations(mediaAssets, ({ one }) => ({
  story: one(stories, {
    fields: [mediaAssets.storyId],
    references: [stories.id],
  }),
  page: one(storyPages, {
    fields: [mediaAssets.pageId],
    references: [storyPages.id],
  }),
  generationJob: one(generationJobs, {
    fields: [mediaAssets.generationJobId],
    references: [generationJobs.id],
  }),
}));