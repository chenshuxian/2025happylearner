import { relations } from "drizzle-orm";
import { integer, jsonb, pgEnum, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { stories } from "./stories";
import { mediaAssets } from "./media-assets";

/**
 * 媒體生成工作狀態列舉。
 */
export const generationJobStatusEnum = pgEnum("generation_job_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

/**
 * 媒體生成工作類型列舉。
 */
export const generationJobTypeEnum = pgEnum("generation_job_type", [
  "story_script",
  "translation",
  "vocabulary",
  "image",
  "audio",
  "video",
]);

/**
 * 媒體生成工作資料表定義。
 */
export const generationJobs = pgTable("generation_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  storyId: uuid("story_id")
    .references(() => stories.id, { onDelete: "cascade" })
    .notNull(),
  jobType: generationJobTypeEnum("job_type").notNull(),
  status: generationJobStatusEnum("status").notNull().default("pending"),
  retryCount: integer("retry_count").notNull().default(0),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  resultUri: varchar("result_uri", { length: 512 }),
  failureReason: varchar("failure_reason", { length: 512 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * 媒體生成工作關聯設定。
 */
export const generationJobsRelations = relations(generationJobs, ({ one, many }) => ({
  story: one(stories, {
    fields: [generationJobs.storyId],
    references: [stories.id],
  }),
  mediaAssets: many(mediaAssets),
}));