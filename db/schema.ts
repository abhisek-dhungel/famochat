import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  passwordSalt: text("password_salt").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("users_username_unique").on(table.username),
  uniqueIndex("users_email_unique").on(table.email),
]);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_sessions_user_expiry").on(table.userId, table.expiresAt)]);

export const relationshipRequests = sqliteTable("relationship_requests", {
  id: text("id").primaryKey(),
  fromUserId: text("from_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  toUserId: text("to_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  relation: text("relation").notNull(),
  category: text("category").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("requests_sender_recipient_unique").on(table.fromUserId, table.toUserId),
  index("idx_requests_recipient_created").on(table.toUserId, table.createdAt),
]);

export const contacts = sqliteTable("contacts", {
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  contactId: text("contact_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  relation: text("relation").notNull(),
  category: text("category").notNull(),
  approved: integer("approved", { mode: "boolean" }).notNull().default(false),
  locationShared: integer("location_shared", { mode: "boolean" }).notNull().default(false),
  parentalControl: integer("parental_control", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.contactId] }),
  index("idx_contacts_owner").on(table.ownerId),
]);

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  senderId: text("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  recipientId: text("recipient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  text: text("text").notNull().default(""),
  kind: text("kind").notNull().default("text"),
  mediaUrl: text("media_url"),
  mediaPublicId: text("media_public_id"),
  mimeType: text("mime_type"),
  fileName: text("file_name"),
  duration: integer("duration"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("idx_messages_sender_recipient_created").on(table.senderId, table.recipientId, table.createdAt),
  index("idx_messages_recipient_sender_created").on(table.recipientId, table.senderId, table.createdAt),
]);
