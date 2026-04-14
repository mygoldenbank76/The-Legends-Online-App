import { pgTable, text, serial, timestamp, integer, unique, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().default("direct"),
  name: text("name"),
  pinnedMessageId: integer("pinned_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const conversationParticipantsTable = pgTable("conversation_participants", {
  id: serial("id").primaryKey(),
  conversationId: serial("conversation_id").notNull(),
  userId: serial("user_id").notNull(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  isMuted: boolean("is_muted").notNull().default(false),
});

export const conversationPinsTable = pgTable("conversation_pins", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  messageId: integer("message_id").notNull(),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.conversationId, t.messageId)]);

export const insertConversationSchema = createInsertSchema(conversationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversationsTable.$inferSelect;
export type ConversationParticipant = typeof conversationParticipantsTable.$inferSelect;
