import { ensureSchema } from "@/db";
import { errorResponse, HttpError, requireSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    if (!cloudName) throw new HttpError(503, "Photo delivery is not configured.");

    const source = new URL(request.url).searchParams.get("url") ?? "";
    let parsed: URL;
    try {
      parsed = new URL(source);
    } catch {
      throw new HttpError(400, "Photo URL is invalid.");
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com" || parsed.search || parsed.hash || !parsed.pathname.startsWith(`/${cloudName}/image/upload/`)) {
      throw new HttpError(400, "Photo URL is invalid.");
    }

    const database = await ensureSchema();
    const allowed = await database.execute({
      sql: `SELECT 1 FROM messages
        WHERE media_url = ? AND kind = 'image'
          AND (sender_id = ? OR recipient_id = ?)
        LIMIT 1`,
      args: [source, user.id, user.id],
    });
    if (!allowed.rows[0]) throw new HttpError(404, "Photo was not found in this conversation.");

    const response = await fetch(source, { cache: "force-cache" });
    const contentType = response.headers.get("content-type") ?? "";
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (!response.ok || !contentType.toLowerCase().startsWith("image/") || (contentLength > 0 && contentLength > MAX_IMAGE_BYTES) || !response.body) {
      throw new HttpError(502, "Photo could not be loaded from storage.");
    }

    const headers = new Headers({
      "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    });
    if (contentLength > 0) headers.set("Content-Length", String(contentLength));
    return new Response(response.body, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
