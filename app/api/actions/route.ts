import { ensureSchema } from "@/db";
import { assertSameOrigin, errorResponse, HttpError, requireSessionUser } from "@/lib/auth";
import { getAccountState } from "@/lib/state";

export const runtime = "nodejs";

const categories = new Set(["Family", "Relative", "Close friend"]);
const messageKinds = new Set(["text", "image", "video", "audio", "document"]);

type ActionBody = Record<string, unknown> & { action?: unknown };

function value(body: ActionBody, key: string, max = 500) {
  const result = typeof body[key] === "string" ? body[key].trim() : "";
  if (result.length > max) throw new HttpError(400, `${key} is too long.`);
  return result;
}

function booleanValue(body: ActionBody, key: string) {
  if (typeof body[key] !== "boolean") throw new HttpError(400, `${key} must be true or false.`);
  return body[key] ? 1 : 0;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser();
    const database = await ensureSchema();
    const body = await request.json() as ActionBody;
    const action = value(body, "action", 40);
    const now = Date.now();

    if (action === "send-request") {
      const username = value(body, "username", 80).replace(/^@/, "").toLowerCase();
      const relation = value(body, "relation", 80);
      const category = value(body, "category", 30);
      if (!/^[a-z0-9]{3,}$/.test(username)) throw new HttpError(400, "Enter a valid username.");
      if (relation.length < 2) throw new HttpError(400, "Add the relationship you want them to approve.");
      if (!categories.has(category)) throw new HttpError(400, "Choose a valid circle.");
      if (username === user.username.toLowerCase()) throw new HttpError(400, "You can’t add your own account.");

      const targetResult = await database.execute({ sql: "SELECT id FROM users WHERE username = ? LIMIT 1", args: [username] });
      const target = targetResult.rows[0];
      if (!target) throw new HttpError(404, `No account named @${username} exists.`);
      const targetId = String(target.id);
      const existing = await database.execute({
        sql: `SELECT 1 FROM contacts WHERE owner_id = ? AND contact_id = ?
          UNION ALL
          SELECT 1 FROM relationship_requests
          WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
          LIMIT 1`,
        args: [user.id, targetId, user.id, targetId, targetId, user.id],
      });
      if (existing.rows[0]) throw new HttpError(409, `@${username} is already connected to you or has a pending request.`);

      await database.batch([
        {
          sql: `INSERT INTO contacts
            (owner_id, contact_id, relation, category, approved, created_at)
            VALUES (?, ?, ?, ?, 0, ?)`,
          args: [user.id, targetId, relation, category, now],
        },
        {
          sql: `INSERT INTO relationship_requests
            (id, from_user_id, to_user_id, relation, category, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
          args: [crypto.randomUUID(), user.id, targetId, relation, category, now],
        },
      ], "write");
    } else if (action === "approve-request") {
      const requestId = value(body, "requestId", 100);
      const result = await database.execute({
        sql: "SELECT from_user_id, relation, category FROM relationship_requests WHERE id = ? AND to_user_id = ? LIMIT 1",
        args: [requestId, user.id],
      });
      const relationship = result.rows[0];
      if (!relationship) throw new HttpError(404, "That relationship request is no longer available.");
      const senderId = String(relationship.from_user_id);
      const relation = String(relationship.relation);
      const category = String(relationship.category);
      await database.batch([
        { sql: "DELETE FROM relationship_requests WHERE id = ? AND to_user_id = ?", args: [requestId, user.id] },
        {
          sql: `INSERT INTO contacts (owner_id, contact_id, relation, category, approved, created_at)
            VALUES (?, ?, ?, ?, 1, ?)
            ON CONFLICT(owner_id, contact_id) DO UPDATE SET approved = 1, relation = excluded.relation, category = excluded.category`,
          args: [user.id, senderId, relation, category, now],
        },
        {
          sql: `INSERT INTO contacts (owner_id, contact_id, relation, category, approved, created_at)
            VALUES (?, ?, ?, ?, 1, ?)
            ON CONFLICT(owner_id, contact_id) DO UPDATE SET approved = 1`,
          args: [senderId, user.id, relation, category, now],
        },
        {
          sql: "INSERT INTO messages (sender_id, recipient_id, text, kind, created_at) VALUES (?, ?, ?, 'text', ?)",
          args: [senderId, user.id, "Relationship approved. You can now chat.", now],
        },
      ], "write");
    } else if (action === "decline-request") {
      const requestId = value(body, "requestId", 100);
      const result = await database.execute({
        sql: "SELECT from_user_id FROM relationship_requests WHERE id = ? AND to_user_id = ? LIMIT 1",
        args: [requestId, user.id],
      });
      const relationship = result.rows[0];
      if (!relationship) throw new HttpError(404, "That relationship request is no longer available.");
      const senderId = String(relationship.from_user_id);
      await database.batch([
        { sql: "DELETE FROM relationship_requests WHERE id = ? AND to_user_id = ?", args: [requestId, user.id] },
        { sql: "DELETE FROM contacts WHERE owner_id = ? AND contact_id = ? AND approved = 0", args: [senderId, user.id] },
      ], "write");
    } else if (action === "remove-contact") {
      const username = value(body, "username", 80).toLowerCase();
      const targetResult = await database.execute({ sql: "SELECT id FROM users WHERE username = ? LIMIT 1", args: [username] });
      const target = targetResult.rows[0];
      if (!target) throw new HttpError(404, "That contact no longer exists.");
      const targetId = String(target.id);
      await database.batch([
        { sql: "DELETE FROM contacts WHERE (owner_id = ? AND contact_id = ?) OR (owner_id = ? AND contact_id = ?)", args: [user.id, targetId, targetId, user.id] },
        { sql: "DELETE FROM relationship_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)", args: [user.id, targetId, targetId, user.id] },
        { sql: "DELETE FROM messages WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)", args: [user.id, targetId, targetId, user.id] },
      ], "write");
    } else if (action === "update-contact") {
      const username = value(body, "username", 80).toLowerCase();
      const locationShared = booleanValue(body, "locationShared");
      const parentalControl = booleanValue(body, "parentalControl");
      const contactResult = await database.execute({
        sql: `SELECT c.parental_control FROM contacts c JOIN users u ON u.id = c.contact_id
          WHERE c.owner_id = ? AND u.username = ? AND c.approved = 1 LIMIT 1`,
        args: [user.id, username],
      });
      const contact = contactResult.rows[0];
      if (!contact) throw new HttpError(404, "That approved contact no longer exists.");
      if (Number(contact.parental_control) === 1 && locationShared === 0) {
        throw new HttpError(409, "Parental control is active; the contact must approve pausing location sharing.");
      }
      const result = await database.execute({
        sql: `UPDATE contacts SET location_shared = ?, parental_control = ?
          WHERE owner_id = ? AND contact_id = (SELECT id FROM users WHERE username = ?) AND approved = 1`,
        args: [locationShared, parentalControl, user.id, username],
      });
      if (result.rowsAffected !== 1) throw new HttpError(409, "The location preference could not be updated.");
    } else if (action === "send-message") {
      const username = value(body, "username", 80).toLowerCase();
      const kind = value(body, "kind", 20);
      const text = value(body, "text", 5000);
      if (!messageKinds.has(kind)) throw new HttpError(400, "Choose a supported message type.");
      if (kind === "text" && !text) throw new HttpError(400, "Write a message first.");
      const targetResult = await database.execute({
        sql: `SELECT u.id FROM contacts c JOIN users u ON u.id = c.contact_id
          WHERE c.owner_id = ? AND u.username = ? AND c.approved = 1 LIMIT 1`,
        args: [user.id, username],
      });
      const target = targetResult.rows[0];
      if (!target) throw new HttpError(403, "Messages can only be sent to approved contacts.");

      const mediaUrl = value(body, "mediaUrl", 1000) || null;
      const mediaPublicId = value(body, "mediaPublicId", 500) || null;
      if (kind !== "text") {
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        if (!mediaUrl || !mediaPublicId || !cloudName || !mediaUrl.startsWith(`https://res.cloudinary.com/${cloudName}/`)) {
          throw new HttpError(400, "Upload the attachment before sending it.");
        }
      }
      await database.execute({
        sql: `INSERT INTO messages
          (sender_id, recipient_id, text, kind, media_url, media_public_id, mime_type, file_name, duration, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          user.id,
          String(target.id),
          text,
          kind,
          mediaUrl,
          mediaPublicId,
          value(body, "mimeType", 200) || null,
          value(body, "fileName", 300) || null,
          typeof body.duration === "number" ? Math.max(0, Math.round(body.duration)) : null,
          now,
        ],
      });
    } else {
      throw new HttpError(400, "Unknown action.");
    }

    return Response.json({ account: await getAccountState(user) });
  } catch (error) {
    return errorResponse(error);
  }
}
