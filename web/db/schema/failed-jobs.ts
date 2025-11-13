import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { generationJobs } from "./generation-jobs";

/**
 * 失敗任務追蹤資料表定義。
 */
export const failedJobs = pgTable("failed_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Allow null generationJobId because some failures are at the story/orchestration level
  // (e.g. persistence for a story) and may not have a corresponding generation_jobs row.
  // In Drizzle the column is nullable by default if not marked with .notNull().
  generationJobId: uuid("generation_job_id")
    .references(() => generationJobs.id, { onDelete: "cascade" }),
  // errorCode can be absent; leave as nullable by omitting .notNull().
  errorCode: text("error_code"),
  errorMessage: text("error_message").notNull(),
  resolved: text("resolved").notNull().default("false"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});