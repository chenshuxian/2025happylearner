import { relations } from "drizzle-orm";
import { pgEnum, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { stories } from "./stories";
import { auditLogs } from "./audit-logs";

/**
 * 使用者角色列舉。
 */
export const userRoleEnum = pgEnum("user_role", ["parent", "admin"]);

/**
 * 使用者資料表定義。
 */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  role: userRoleEnum("role").notNull().default("parent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * 使用者關聯設定。
 */
export const usersRelations = relations(users, ({ many }) => ({
  stories: many(stories),
  auditLogs: many(auditLogs),
}));