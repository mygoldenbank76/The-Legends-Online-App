import { pgTable, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const contactsTable = pgTable(
  "contacts",
  {
    ownerId: integer("owner_id").notNull(),
    contactUserId: integer("contact_user_id").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.contactUserId] })],
);

export type Contact = typeof contactsTable.$inferSelect;
