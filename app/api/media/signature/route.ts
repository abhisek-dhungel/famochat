import { createHash } from "node:crypto";
import { assertSameOrigin, errorResponse, HttpError, requireSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser();
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) throw new HttpError(503, "Cloudinary is not configured yet.");

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `famochat/${user.id}`;
    const signature = createHash("sha1")
      .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
      .digest("hex");

    return Response.json({ cloudName, apiKey, timestamp, folder, signature });
  } catch (error) {
    return errorResponse(error);
  }
}
