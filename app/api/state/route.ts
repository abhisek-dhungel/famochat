import { errorResponse, requireSessionUser } from "@/lib/auth";
import { getAccountState } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireSessionUser();
    return Response.json({ account: await getAccountState(user) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
