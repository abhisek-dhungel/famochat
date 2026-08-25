import type { CloudinaryResourceType, MediaMessageKind } from "@/lib/media";

const messageKinds = new Set<MediaMessageKind>(["text", "image", "video", "audio", "document"]);

export function serializeMessageRow(row: Record<string, unknown>, currentUserId: string) {
  const mine = String(row.sender_id) === currentUserId;
  const rawKind = String(row.kind ?? "text") as MediaMessageKind;
  const kind = messageKinds.has(rawKind) ? rawKind : "text";
  const partner = mine ? String(row.recipient_username) : String(row.sender_username);

  return {
    partner,
    message: {
      id: Number(row.id),
      senderId: String(row.sender_id),
      recipientId: String(row.recipient_id),
      text: String(row.text ?? ""),
      from: mine ? "me" as const : "them" as const,
      createdAt: Number(row.created_at),
      kind,
      mediaUrl: row.media_url ? String(row.media_url) : undefined,
      mediaPublicId: row.media_public_id ? String(row.media_public_id) : undefined,
      mediaResourceType: row.media_resource_type ? String(row.media_resource_type) as CloudinaryResourceType : undefined,
      mediaFormat: row.media_format ? String(row.media_format) : undefined,
      mediaBytes: row.media_bytes == null ? undefined : Number(row.media_bytes),
      mimeType: row.mime_type ? String(row.mime_type) : undefined,
      fileName: row.file_name ? String(row.file_name) : undefined,
      duration: row.duration == null ? undefined : Number(row.duration),
    },
  };
}

export function serializeMessageRows(rows: Array<Record<string, unknown>>, currentUserId: string) {
  return [...rows]
    .sort((left, right) => Number(left.created_at) - Number(right.created_at) || Number(left.id) - Number(right.id))
    .map((row) => serializeMessageRow(row, currentUserId));
}
