import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { generationJobs } from "./generation-jobs";

/**
 * 失敗任務追蹤資料表定義。
 */
export const failedJobs = pgTable("failed_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  generationJobId: uuid("generation_job_id")
    .references(() => generationJobs.id, { onDelete: "cascade" })
    .notNull(),
  errorCode: text("error_code"),
  errorMessage: text("error_message").notNull(),
  resolved: text("resolved").notNull().default("false"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});