import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { stories } from "./stories";

/**
 * 精選單字資料表定義。
 */
export const vocabEntries = pgTable("vocab_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  storyId: uuid("story_id")
    .references(() => stories.id, { onDelete: "cascade" })
    .notNull(),
  word: varchar("word", { length: 120 }).notNull(),
  partOfSpeech: varchar("part_of_speech", { length: 60 }),
  definitionEn: text("definition_en").notNull(),
  definitionZh: text("definition_zh").notNull(),
  exampleSentence: text("example_sentence"),
  exampleTranslation: text("example_translation"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * 精選單字資料表關聯設定。
 */
export const vocabEntriesRelations = relations(vocabEntries, ({ one }) => ({
  story: one(stories, {
    fields: [vocabEntries.storyId],
    references: [stories.id],
  }),
}));