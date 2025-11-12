import { relations } from "drizzle-orm";
import {
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { storyPages } from "./story-pages";
import { mediaAssets } from "./media-assets";
import { vocabEntries } from "./vocab-entries";
import { generationJobs } from "./generation-jobs";

/**
 * 故事狀態列舉。
 */
export const storyStatusEnum = pgEnum("story_status", [
  "draft",
  "scheduled",
  "processing",
  "published",
  "failed",
]);

/**
 * 故事資料表定義。
 */
export const stories = pgTable("stories", {
  id: uuid("id").defaultRandom().primaryKey(),
  titleEn: varchar("title_en", { length: 200 }).notNull(),
  titleZh: varchar("title_zh", { length: 200 }).notNull(),
  theme: varchar("theme", { length: 120 }).notNull(),
  status: storyStatusEnum("status").notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ageRange: varchar("age_range", { length: 20 }).default("0-6").notNull(),
  createdBy: uuid("created_by")
    .references(() => users.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * 故事資料表關聯設定。
 */
export const storiesRelations = relations(stories, ({ one, many }) => ({
  author: one(users, {
    fields: [stories.createdBy],
    references: [users.id],
  }),
  pages: many(storyPages),
  mediaAssets: many(mediaAssets),
  vocabEntries: many(vocabEntries),
  generationJobs: many(generationJobs),
}));