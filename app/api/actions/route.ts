import { ensureSchema } from "@/db";
import { assertSameOrigin, errorResponse, HttpError, requireSessionUser } from "@/lib/auth";
import { verifyCloudinaryUploadSignature } from "@/lib/cloudinary";
import { cloudinaryResourceType, isCloudinaryDeliveryUrl, type CloudinaryResourceType, type MediaMessageKind } from "@/lib/media";
import { getAccountState } from "@/lib/state";

export const runtime = "nodejs";

const categories = new Set(["Family", "Relative", "Close friend"]);
const messageKinds = new Set(["text", "image", "video", "audio", "document"]);
const reactionEmojis = new Set(["❤️", "😂", "😮", "😢", "👍", "🔥"]);

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

function integerValue(body: ActionBody, key: string) {
  const result = typeof body[key] === "number" ? Math.round(body[key]) : 0;
  if (!Number.isSafeInteger(result) || result <= 0) throw new HttpError(400, `${key} is invalid.`);
  return result;
}

function optionalIntegerValue(body: ActionBody, key: string) {
  if (body[key] == null) return null;
  return integerValue(body, key);
}

type Database = Awaited<ReturnType<typeof ensureSchema>>;

async function approvedContactId(database: Database, ownerId: string, username: string) {
  const result = await database.execute({
    sql: `SELECT u.id FROM contacts c JOIN users u ON u.id = c.contact_id
      WHERE c.owner_id = ? AND u.username = ? AND c.approved = 1 LIMIT 1`,
    args: [ownerId, username],
  });
  return result.rows[0] ? String(result.rows[0].id) : null;
}

async function conversationMessage(database: Database, messageId: number, userId: string) {
  const result = await database.execute({
    sql: `SELECT id, sender_id, recipient_id, kind, created_at, deleted_at
      FROM messages WHERE id = ? AND (sender_id = ? OR recipient_id = ?) LIMIT 1`,
    args: [messageId, userId, userId],
  });
  return result.rows[0] ?? null;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser();
    const database = await ensureSchema();
    const body = await request.json() as ActionBody;
    const action = value(body, "action", 40);
    const now = Date.now();
    await database.execute({
      sql: "UPDATE users SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)",
      args: [now, user.id, now - 15_000],
    });

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
      const protection = await database.execute({
        sql: `SELECT 1 FROM contacts
          WHERE parental_control = 1 AND (
            (owner_id = ? AND contact_id = ?) OR
            (owner_id = ? AND contact_id = ?)
          ) LIMIT 1`,
        args: [user.id, targetId, targetId, user.id],
      });
      if (protection.rows[0]) {
        throw new HttpError(409, "This contact is protected by parental control and cannot be deleted.");
      }
      await database.batch([
        { sql: "DELETE FROM contacts WHERE (owner_id = ? AND contact_id = ?) OR (owner_id = ? AND contact_id = ?)", args: [user.id, targetId, targetId, user.id] },
        { sql: "DELETE FROM relationship_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)", args: [user.id, targetId, targetId, user.id] },
        { sql: "DELETE FROM location_pause_requests WHERE (requester_id = ? AND approver_id = ?) OR (requester_id = ? AND approver_id = ?)", args: [user.id, targetId, targetId, user.id] },
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
    } else if (action === "request-location-pause") {
      const username = value(body, "username", 80).toLowerCase();
      const targetId = await approvedContactId(database, user.id, username);
      if (!targetId) throw new HttpError(404, "That approved contact no longer exists.");
      const contactResult = await database.execute({
        sql: `SELECT location_shared, parental_control FROM contacts
          WHERE owner_id = ? AND contact_id = ? AND approved = 1 LIMIT 1`,
        args: [user.id, targetId],
      });
      const contact = contactResult.rows[0];
      if (!contact || Number(contact.location_shared) !== 1 || Number(contact.parental_control) !== 1) {
        throw new HttpError(409, "Parental location sharing is no longer active.");
      }
      const result = await database.execute({
        sql: `INSERT OR IGNORE INTO location_pause_requests
          (id, requester_id, approver_id, created_at) VALUES (?, ?, ?, ?)`,
        args: [crypto.randomUUID(), user.id, targetId, now],
      });
      if (result.rowsAffected !== 1) throw new HttpError(409, `A pause request is already waiting for @${username}.`);
    } else if (action === "approve-location-pause") {
      const requestId = value(body, "requestId", 100);
      const requestResult = await database.execute({
        sql: "SELECT requester_id FROM location_pause_requests WHERE id = ? AND approver_id = ? LIMIT 1",
        args: [requestId, user.id],
      });
      const pauseRequest = requestResult.rows[0];
      if (!pauseRequest) throw new HttpError(404, "That location pause request is no longer available.");
      const requesterId = String(pauseRequest.requester_id);
      const result = await database.batch([
        {
          sql: `UPDATE contacts SET location_shared = 0
            WHERE owner_id = ? AND contact_id = ? AND approved = 1
              AND parental_control = 1 AND location_shared = 1`,
          args: [requesterId, user.id],
        },
        { sql: "DELETE FROM location_pause_requests WHERE id = ? AND approver_id = ?", args: [requestId, user.id] },
      ], "write");
      if (result[0].rowsAffected !== 1) throw new HttpError(409, "Location sharing was already changed.");
    } else if (action === "decline-location-pause") {
      const requestId = value(body, "requestId", 100);
      const result = await database.execute({
        sql: "DELETE FROM location_pause_requests WHERE id = ? AND approver_id = ?",
        args: [requestId, user.id],
      });
      if (result.rowsAffected !== 1) throw new HttpError(404, "That location pause request is no longer available.");
    } else if (action === "update-live-context") {
      const latitude = typeof body.latitude === "number" ? body.latitude : Number.NaN;
      const longitude = typeof body.longitude === "number" ? body.longitude : Number.NaN;
      const temperature = typeof body.temperature === "number" && Number.isFinite(body.temperature) ? body.temperature : null;
      const battery = typeof body.battery === "number" && Number.isFinite(body.battery) ? Math.round(body.battery) : null;
      const charging = typeof body.charging === "boolean" ? (body.charging ? 1 : 0) : null;
      const locationLabel = value(body, "locationLabel", 220);
      const weather = value(body, "weather", 80) || "Unavailable";
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new HttpError(400, "Latitude is invalid.");
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new HttpError(400, "Longitude is invalid.");
      if (!locationLabel) throw new HttpError(400, "Location name is required.");
      if (temperature != null && (temperature < -100 || temperature > 100)) throw new HttpError(400, "Temperature is invalid.");
      if (battery != null && (battery < 0 || battery > 100)) throw new HttpError(400, "Battery level is invalid.");

      await database.execute({
        sql: `INSERT INTO live_contexts
          (user_id, latitude, longitude, location_label, temperature, weather, battery, charging, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            location_label = excluded.location_label,
            temperature = excluded.temperature,
            weather = excluded.weather,
            battery = excluded.battery,
            charging = excluded.charging,
            updated_at = excluded.updated_at`,
        args: [user.id, latitude, longitude, locationLabel, temperature, weather, battery, charging, now],
      });
    } else if (action === "mark-read") {
      const username = value(body, "username", 80).toLowerCase();
      const targetId = await approvedContactId(database, user.id, username);
      if (!targetId) throw new HttpError(404, "That approved contact no longer exists.");
      await database.execute({
        sql: "UPDATE messages SET read_at = COALESCE(read_at, ?) WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL",
        args: [now, targetId, user.id],
      });
    } else if (action === "typing") {
      const username = value(body, "username", 80).toLowerCase();
      const typing = booleanValue(body, "typing") === 1;
      const targetId = await approvedContactId(database, user.id, username);
      if (!targetId) throw new HttpError(404, "That approved contact no longer exists.");
      if (typing) {
        await database.execute({
          sql: `INSERT INTO typing_indicators (user_id, recipient_id, expires_at)
            VALUES (?, ?, ?) ON CONFLICT(user_id, recipient_id)
            DO UPDATE SET expires_at = excluded.expires_at`,
          args: [user.id, targetId, now + 5_000],
        });
      } else {
        await database.execute({
          sql: "DELETE FROM typing_indicators WHERE user_id = ? AND recipient_id = ?",
          args: [user.id, targetId],
        });
      }
    } else if (action === "react-message") {
      const messageId = integerValue(body, "messageId");
      const emoji = value(body, "emoji", 12);
      const message = await conversationMessage(database, messageId, user.id);
      if (!message || message.deleted_at != null) throw new HttpError(404, "That message is no longer available.");
      if (!emoji) {
        await database.execute({ sql: "DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?", args: [messageId, user.id] });
      } else {
        if (!reactionEmojis.has(emoji)) throw new HttpError(400, "Choose a supported reaction.");
        await database.execute({
          sql: `INSERT INTO message_reactions (message_id, user_id, emoji, created_at)
            VALUES (?, ?, ?, ?) ON CONFLICT(message_id, user_id)
            DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`,
          args: [messageId, user.id, emoji, now],
        });
      }
    } else if (action === "edit-message") {
      const messageId = integerValue(body, "messageId");
      const text = value(body, "text", 5000);
      if (!text) throw new HttpError(400, "Write a message first.");
      const result = await database.execute({
        sql: `UPDATE messages SET text = ?, edited_at = ?
          WHERE id = ? AND sender_id = ? AND kind = 'text' AND deleted_at IS NULL
            AND created_at >= ?`,
        args: [text, now, messageId, user.id, now - 15 * 60 * 1000],
      });
      if (result.rowsAffected !== 1) throw new HttpError(409, "Messages can only be edited for 15 minutes after sending.");
    } else if (action === "delete-message") {
      const messageId = integerValue(body, "messageId");
      const message = await conversationMessage(database, messageId, user.id);
      if (!message || String(message.sender_id) !== user.id || message.deleted_at != null) {
        throw new HttpError(404, "That message can no longer be removed.");
      }
      const result = await database.batch([
        { sql: "DELETE FROM message_reactions WHERE message_id = ?", args: [messageId] },
        {
          sql: `UPDATE messages SET text = '', media_url = NULL, media_public_id = NULL,
            media_resource_type = NULL, media_format = NULL, media_bytes = NULL,
            mime_type = NULL, file_name = NULL, duration = NULL, deleted_at = ?
            WHERE id = ? AND sender_id = ? AND deleted_at IS NULL`,
          args: [now, messageId, user.id],
        },
      ], "write");
      if (result[1].rowsAffected !== 1) throw new HttpError(404, "That message can no longer be removed.");
    } else if (action === "send-message") {
      const username = value(body, "username", 80).toLowerCase();
      const kind = value(body, "kind", 20);
      const text = value(body, "text", 5000);
      const clientId = value(body, "clientId", 100) || crypto.randomUUID();
      const replyToId = optionalIntegerValue(body, "replyToId");
      if (!messageKinds.has(kind)) throw new HttpError(400, "Choose a supported message type.");
      if (kind === "text" && !text) throw new HttpError(400, "Write a message first.");
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(clientId)) throw new HttpError(400, "Message identifier is invalid.");
      const targetId = await approvedContactId(database, user.id, username);
      if (!targetId) throw new HttpError(403, "Messages can only be sent to approved contacts.");
      if (replyToId != null) {
        const reply = await conversationMessage(database, replyToId, user.id);
        const belongsToConversation = reply && (
          (String(reply.sender_id) === user.id && String(reply.recipient_id) === targetId)
          || (String(reply.sender_id) === targetId && String(reply.recipient_id) === user.id)
        );
        if (!belongsToConversation || reply?.deleted_at != null) throw new HttpError(400, "The replied-to message is no longer available.");
      }

      const mediaUrl = value(body, "mediaUrl", 1000) || null;
      const mediaPublicId = value(body, "mediaPublicId", 500) || null;
      const mediaResourceType = value(body, "mediaResourceType", 20) as CloudinaryResourceType;
      const mediaFormat = value(body, "mediaFormat", 40).toLowerCase();
      const mimeType = value(body, "mimeType", 200) || null;
      const fileName = value(body, "fileName", 300) || null;
      let mediaBytes: number | null = null;
      if (kind !== "text") {
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;
        const uploadVersion = integerValue(body, "uploadVersion");
        const uploadSignature = value(body, "uploadSignature", 128);
        mediaBytes = integerValue(body, "mediaBytes");
        const expectedResourceType = cloudinaryResourceType(kind as MediaMessageKind);
        const byteLimit = kind === "image" ? 25 * 1024 * 1024 : kind === "video" ? 100 * 1024 * 1024 : kind === "document" ? 50 * 1024 * 1024 : 25 * 1024 * 1024;
        const mimeMatches = !mimeType
          || (kind === "image" && mimeType.startsWith("image/"))
          || (kind === "video" && mimeType.startsWith("video/"))
          || (kind === "audio" && mimeType.startsWith("audio/"))
          || kind === "document";
        if (!mediaUrl || !mediaPublicId || !mediaFormat || !cloudName || !apiSecret || mediaResourceType !== expectedResourceType || mediaBytes > byteLimit || !mimeMatches) {
          throw new HttpError(400, "Upload the attachment before sending it.");
        }
        if (!verifyCloudinaryUploadSignature({ publicId: mediaPublicId, version: uploadVersion, signature: uploadSignature, apiSecret })) {
          throw new HttpError(400, "Cloudinary could not verify this upload.");
        }
        if (!isCloudinaryDeliveryUrl({ url: mediaUrl, cloudName, resourceType: expectedResourceType, publicId: mediaPublicId, version: uploadVersion, format: mediaFormat })) {
          throw new HttpError(400, "The uploaded file URL is invalid.");
        }
      }
      await database.execute({
        sql: `INSERT OR IGNORE INTO messages
          (sender_id, recipient_id, text, kind, media_url, media_public_id, media_resource_type,
            media_format, media_bytes, mime_type, file_name, duration, client_id, reply_to_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          user.id,
          targetId,
          text,
          kind,
          mediaUrl,
          mediaPublicId,
          mediaResourceType || null,
          mediaFormat || null,
          mediaBytes,
          mimeType,
          fileName,
          typeof body.duration === "number" ? Math.max(0, Math.round(body.duration)) : null,
          clientId,
          replyToId,
          now,
        ],
      });
      await database.execute({ sql: "DELETE FROM typing_indicators WHERE user_id = ? AND recipient_id = ?", args: [user.id, targetId] });
    } else {
      throw new HttpError(400, "Unknown action.");
    }

    return Response.json({ account: await getAccountState(user) });
  } catch (error) {
    return errorResponse(error);
  }
}
