import { assertSameOrigin, errorResponse, HttpError, requireSessionUser } from "@/lib/auth";
import { signCloudinaryParameters } from "@/lib/cloudinary";
import { cloudinaryResourceType, cloudinaryUploadUrl, type MediaMessageKind } from "@/lib/media";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser();
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) throw new HttpError(503, "Cloudinary is not configured yet.");

    const body = await request.json().catch(() => null) as { kind?: unknown } | null;
    const kind = typeof body?.kind === "string" ? body.kind as MediaMessageKind : "text";
    if (!new Set<MediaMessageKind>(["image", "video", "audio", "document"]).has(kind)) {
      throw new HttpError(400, "Choose a supported attachment type.");
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `famochat/${user.id}`;
    const resourceType = cloudinaryResourceType(kind);
    const signature = signCloudinaryParameters({ folder, timestamp }, apiSecret);

    return Response.json({
      cloudName,
      apiKey,
      timestamp,
      folder,
      resourceType,
      uploadUrl: cloudinaryUploadUrl(cloudName, resourceType),
      signature,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
