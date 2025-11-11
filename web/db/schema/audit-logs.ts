import { pgTable, jsonb, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * 系統操作紀錄資料表定義。
 */
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 120 }).notNull(),
  context: jsonb("context").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});