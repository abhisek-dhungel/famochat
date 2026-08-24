import { ensureSchema } from "@/db";
import type { SessionUser } from "@/lib/auth";

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

export async function getAccountState(user: SessionUser) {
  const database = await ensureSchema();
  const [contactsResult, requestsResult, messagesResult] = await Promise.all([
    database.execute({
      sql: `SELECT u.username, u.name, c.relation, c.category, c.approved,
          c.location_shared, c.parental_control,
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
      args: [user.id],
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
      sql: `SELECT m.id, m.sender_id, sender.username AS sender_username,
          recipient.username AS recipient_username, m.text, m.kind, m.media_url,
          m.media_public_id, m.mime_type, m.file_name, m.duration, m.created_at
        FROM messages m
        JOIN users sender ON sender.id = m.sender_id
        JOIN users recipient ON recipient.id = m.recipient_id
        WHERE m.sender_id = ? OR m.recipient_id = ?
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1000`,
      args: [user.id, user.id],
    }),
  ]);

  const contacts = contactsResult.rows.map((row) => {
    const approved = Number(row.approved) === 1;
    const username = String(row.username);
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
      online: approved,
      approved,
      locationShared: Number(row.location_shared) === 1,
      liveContextShared,
      parentalControl: Number(row.parental_control) === 1,
      contactRemovalLocked: Number(row.parental_control) === 1 || Number(row.reverse_parental_control) === 1,
      activity: approved ? "Online" : "Pending",
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

  const messages: Record<string, unknown[]> = {};
  for (const row of [...messagesResult.rows].reverse()) {
    const mine = String(row.sender_id) === user.id;
    const partner = mine ? String(row.recipient_username) : String(row.sender_username);
    messages[partner] ??= [];
    messages[partner].push({
      id: Number(row.id),
      text: String(row.text ?? ""),
      from: mine ? "me" : "them",
      createdAt: Number(row.created_at),
      kind: String(row.kind),
      mediaUrl: row.media_url ? String(row.media_url) : undefined,
      mediaPublicId: row.media_public_id ? String(row.media_public_id) : undefined,
      mimeType: row.mime_type ? String(row.mime_type) : undefined,
      fileName: row.file_name ? String(row.file_name) : undefined,
      duration: row.duration == null ? undefined : Number(row.duration),
    });
  }

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
    messages,
  };
}
