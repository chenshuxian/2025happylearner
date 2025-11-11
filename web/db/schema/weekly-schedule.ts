import { pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * 每週產出排程資料表定義。
 */
export const weeklySchedule = pgTable("weekly_schedule", {
  id: uuid("id").defaultRandom().primaryKey(),
  scheduledDate: timestamp("scheduled_date", { withTimezone: true }).notNull(),
  storyCount: smallint("story_count").notNull().default(2),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});