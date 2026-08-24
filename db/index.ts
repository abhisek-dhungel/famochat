import { createClient, type Client } from "@libsql/client";

let client: Client | null = null;
let schemaPromise: Promise<void> | null = null;

export function getDb(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not configured.");

  if (!client) {
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }

  return client;
}

export async function ensureSchema(): Promise<Client> {
  const database = getDb();
  schemaPromise ??= database
    .batch(
      [
        `CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY NOT NULL,
          username TEXT NOT NULL COLLATE NOCASE UNIQUE,
          name TEXT NOT NULL,
          email TEXT NOT NULL COLLATE NOCASE UNIQUE,
          phone TEXT NOT NULL DEFAULT '',
          password_salt TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS relationship_requests (
          id TEXT PRIMARY KEY NOT NULL,
          from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          relation TEXT NOT NULL,
          category TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(from_user_id, to_user_id)
        )`,
        `CREATE TABLE IF NOT EXISTS contacts (
          owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          contact_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          relation TEXT NOT NULL,
          category TEXT NOT NULL,
          approved INTEGER NOT NULL DEFAULT 0,
          location_shared INTEGER NOT NULL DEFAULT 0,
          parental_control INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          PRIMARY KEY(owner_id, contact_id)
        )`,
        `CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          text TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL DEFAULT 'text',
          media_url TEXT,
          media_public_id TEXT,
          mime_type TEXT,
          file_name TEXT,
          duration INTEGER,
          created_at INTEGER NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS idx_sessions_user_expiry ON sessions(user_id, expires_at)",
        "CREATE INDEX IF NOT EXISTS idx_requests_recipient_created ON relationship_requests(to_user_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id)",
        "CREATE INDEX IF NOT EXISTS idx_messages_sender_recipient_created ON messages(sender_id, recipient_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_messages_recipient_sender_created ON messages(recipient_id, sender_id, created_at)",
      ],
      "write",
    )
    .then(() => undefined)
    .catch((error) => {
      schemaPromise = null;
      throw error;
    });

  await schemaPromise;
  return database;
}
