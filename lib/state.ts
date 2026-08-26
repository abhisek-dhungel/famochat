import { ensureSchema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { serializeMessageRows } from "@/lib/messages";

function toneFor(value: string) {
  const tones = ["tone-dark", "tone-mid", "tone-light", "tone-soft", "tone-silver"];
  const total = [...value].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return tones[total % tones.length];
}

function contextAge(value: number | null) {
  if (!value) return "Waiting for the first location update";
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60000));
  if (minutes < 1) return "Updated just now";
  if (minutes === 1) return "Updated 1 minute ago";
  if (minutes < 60) return `Updated ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return `Updated ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}

function lastSeenLabel(value: number | null, now: number) {
  if (!value) return "Offline";
  const minutes = Math.max(0, Math.floor((now - value) / 60000));
  if (minutes < 2) return "Active recently";
  if (minutes < 60) return `Active ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Active ${hours}h ago`;
  return `Active ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value))}`;
}

function messagePreview(message: ReturnType<typeof serializeMessageRows>[number]["message"]) {
  if (message.deletedAt) return "Message removed";
  if (message.kind === "image") return "Photo";
  if (message.kind === "video") return "Video";
  if (message.kind === "audio") return "Voice message";
  if (message.kind === "document") return message.fileName || "Document";
  return message.text.replace(/\s+/g, " ").trim() || "Message";
}

export async function getAccountState(user: SessionUser) {
  const database = await ensureSchema();
  const now = Date.now();
  await database.execute({
    sql: "UPDATE users SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)",
    args: [now, user.id, now - 15_000],
  });

  const [contactsResult, requestsResult, pauseRequestsResult, messagesResult, reactionsResult] = await Promise.all([
    database.execute({
      sql: `SELECT u.username, u.name, c.relation, c.category, c.approved,
          c.location_shared, c.parental_control,
          EXISTS(
            SELECT 1 FROM location_pause_requests pause
            WHERE pause.requester_id = c.owner_id AND pause.approver_id = c.contact_id
          ) AS pause_request_pending,
          u.last_seen_at,
          EXISTS(
            SELECT 1 FROM typing_indicators typing
            WHERE typing.user_id = c.contact_id AND typing.recipient_id = c.owner_id
              AND typing.expires_at > ?
          ) AS typing,
          shared.location_shared AS live_context_shared,
          shared.parental_control AS reverse_parental_control,
          context.latitude, context.longitude, context.location_label,
          context.temperature, context.weather, context.battery,
          context.charging, context.updated_at
        FROM contacts c
        JOIN users u ON u.id = c.contact_id
        LEFT JOIN contacts shared ON shared.owner_id = c.contact_id
          AND shared.contact_id = c.owner_id AND shared.approved = 1
        LEFT JOIN live_contexts context ON context.user_id = c.contact_id
          AND shared.location_shared = 1
        WHERE c.owner_id = ?
        ORDER BY c.approved DESC, u.name COLLATE NOCASE`,
      args: [now, user.id],
    }),
    database.execute({
      sql: `SELECT r.id, u.username AS from_username, u.name AS from_name,
          r.relation, r.category, r.created_at
        FROM relationship_requests r
        JOIN users u ON u.id = r.from_user_id
        WHERE r.to_user_id = ?
        ORDER BY r.created_at DESC`,
      args: [user.id],
    }),
    database.execute({
      sql: `SELECT pause.id, requester.username AS from_username,
          requester.name AS from_name, pause.created_at
        FROM location_pause_requests pause
        JOIN users requester ON requester.id = pause.requester_id
        WHERE pause.approver_id = ?
        ORDER BY pause.created_at DESC`,
      args: [user.id],
    }),
    database.execute({
      sql: `SELECT m.id, m.sender_id, m.recipient_id, sender.username AS sender_username,
          recipient.username AS recipient_username, m.text, m.kind, m.media_url,
          m.media_public_id, m.media_resource_type, m.media_format, m.media_bytes,
          m.mime_type, m.file_name, m.duration, m.client_id, m.reply_to_id,
          m.edited_at, m.deleted_at, m.read_at, m.created_at,
          reply.text AS reply_text, reply.kind AS reply_kind,
          reply.sender_id AS reply_sender_id, reply.deleted_at AS reply_deleted_at,
          reply_sender.name AS reply_sender_name
        FROM messages m
        JOIN users sender ON sender.id = m.sender_id
        JOIN users recipient ON recipient.id = m.recipient_id
        LEFT JOIN messages reply ON reply.id = m.reply_to_id
        LEFT JOIN users reply_sender ON reply_sender.id = reply.sender_id
        WHERE m.sender_id = ? OR m.recipient_id = ?
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1000`,
      args: [user.id, user.id],
    }),
    database.execute({
      sql: `SELECT reactions.message_id, reactions.user_id, reactions.emoji, users.username
        FROM message_reactions reactions
        JOIN messages message ON message.id = reactions.message_id
        JOIN users ON users.id = reactions.user_id
        WHERE message.sender_id = ? OR message.recipient_id = ?
        ORDER BY reactions.created_at, reactions.user_id`,
      args: [user.id, user.id],
    }),
  ]);

  const baseContacts = contactsResult.rows.map((row) => {
    const approved = Number(row.approved) === 1;
    const username = String(row.username);
    const lastSeenAt = row.last_seen_at == null ? null : Number(row.last_seen_at);
    const online = approved && lastSeenAt != null && now - lastSeenAt < 75_000;
    const liveContextShared = Number(row.live_context_shared) === 1;
    const latitude = row.latitude == null ? null : Number(row.latitude);
    const longitude = row.longitude == null ? null : Number(row.longitude);
    const locationFallback = latitude == null || longitude == null ? "Waiting for location" : `${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°`;
    return {
      id: username,
      name: String(row.name),
      username,
      relation: String(row.relation),
      category: String(row.category),
      online,
      approved,
      typing: Number(row.typing) === 1,
      unreadCount: 0,
      lastMessagePreview: "",
      lastMessageAt: null,
      lastSeenAt,
      locationShared: Number(row.location_shared) === 1,
      liveContextShared,
      parentalControl: Number(row.parental_control) === 1,
      pauseRequestPending: Number(row.pause_request_pending) === 1,
      contactRemovalLocked: Number(row.parental_control) === 1 || Number(row.reverse_parental_control) === 1,
      activity: approved ? online ? "Online" : lastSeenLabel(lastSeenAt, now) : "Pending",
      speed: liveContextShared ? "Live" : "—",
      location: row.location_label ? String(row.location_label) : locationFallback,
      eta: contextAge(row.updated_at == null ? null : Number(row.updated_at)),
      temperature: row.temperature == null ? "—" : `${Math.round(Number(row.temperature))}°`,
      weather: row.weather ? String(row.weather) : "Unavailable",
      battery: row.battery == null ? null : Number(row.battery),
      charging: row.charging == null ? null : Number(row.charging) === 1,
      tone: toneFor(username),
    };
  });

  const reactionsByMessage = new Map<number, Array<Record<string, unknown>>>();
  for (const row of reactionsResult.rows) {
    const messageId = Number(row.message_id);
    const items = reactionsByMessage.get(messageId) ?? [];
    items.push({ emoji: row.emoji, userId: row.user_id, username: row.username });
    reactionsByMessage.set(messageId, items);
  }

  const messages: Record<string, ReturnType<typeof serializeMessageRows>[number]["message"][]> = {};
  const messageRows = messagesResult.rows.map((row) => ({
    ...row,
    reactions: reactionsByMessage.get(Number(row.id)) ?? [],
  }));
  for (const { partner, message } of serializeMessageRows(messageRows, user.id)) {
    messages[partner] ??= [];
    messages[partner].push(message);
  }

  const contacts = baseContacts.map((contact) => {
    const conversation = messages[contact.username] ?? [];
    const lastMessage = conversation.at(-1);
    return {
      ...contact,
      unreadCount: conversation.filter((message) => message.from === "them" && !message.readAt).length,
      lastMessagePreview: lastMessage ? messagePreview(lastMessage) : "",
      lastMessageAt: lastMessage?.createdAt ?? null,
    };
  }).sort((left, right) => {
    if (left.approved !== right.approved) return left.approved ? -1 : 1;
    if (left.lastMessageAt !== right.lastMessageAt) return (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0);
    return left.name.localeCompare(right.name);
  });

  return {
    name: user.name,
    username: user.username,
    email: user.email,
    phone: user.phone,
    contacts,
    requests: requestsResult.rows.map((row) => ({
      id: String(row.id),
      fromUsername: String(row.from_username),
      fromName: String(row.from_name),
      relation: String(row.relation),
      category: String(row.category),
      createdAt: Number(row.created_at),
    })),
    pauseRequests: pauseRequestsResult.rows.map((row) => ({
      id: String(row.id),
      fromUsername: String(row.from_username),
      fromName: String(row.from_name),
      createdAt: Number(row.created_at),
    })),
    messages,
  };
}
