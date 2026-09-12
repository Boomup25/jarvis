import { requireUser } from "@/lib/session";
import { buildHighlights } from "@/lib/highlights";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  return Response.json(await buildHighlights(auth.user.id));
}
