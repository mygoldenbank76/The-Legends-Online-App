import { pgTable, text, serial, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  senderId: integer("sender_id").notNull(),
  content: text("content"),
  imageUrl: text("image_url"),
  // Intrinsic media dimensions captured at upload time so the receiving
  // client can size the bubble correctly on the very first paint — no
  // landscape→portrait flash, no loading placeholder. Both nullable for
  // backwards compatibility with rows created before these columns existed.
  mediaWidth: integer("media_width"),
  mediaHeight: integer("media_height"),
  audioUrl: text("audio_url"),
  audioDuration: integer("audio_duration"),
  pollId: integer("poll_id"),
  linkPreview: jsonb("link_preview"),
  mediaAlbum: jsonb("media_album"),
  replyToId: integer("reply_to_id"),
  // Call log fields (when message represents a call event, à la WhatsApp)
  callType: text("call_type"),       // 'audio' | 'video'
  callStatus: text("call_status"),   // 'missed' | 'answered' | 'declined' | 'ongoing'
  callDuration: integer("call_duration"), // seconds; null for missed/declined
  editedAt: timestamp("edited_at", { withTimezone: true }),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const reactionsTable = pgTable("reactions", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull(),
  userId: integer("user_id").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pollsTable = pgTable("polls", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  isAnonymous: boolean("is_anonymous").notNull().default(true),
  isMultipleChoice: boolean("is_multiple_choice").notNull().default(false),
  isQuiz: boolean("is_quiz").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pollOptionsTable = pgTable("poll_options", {
  id: serial("id").primaryKey(),
  pollId: integer("poll_id").notNull(),
  text: text("text").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const pollVotesTable = pgTable("poll_votes", {
  id: serial("id").primaryKey(),
  pollId: integer("poll_id").notNull(),
  optionId: integer("option_id").notNull(),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertReactionSchema = createInsertSchema(reactionsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
export type InsertReaction = z.infer<typeof insertReactionSchema>;
export type Reaction = typeof reactionsTable.$inferSelect;
export type Poll = typeof pollsTable.$inferSelect;
export type PollOption = typeof pollOptionsTable.$inferSelect;
export type PollVote = typeof pollVotesTable.$inferSelect;
