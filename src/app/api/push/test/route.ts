import { requireUser } from "@/lib/session";
import { sendPush, pushConfigured } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireUser();
  if ("denied" in auth) return auth.denied;
  if (!pushConfigured()) {
    return Response.json({ error: "VAPID keys are not set on the server" }, { status: 400 });
  }

  const delivered = await sendPush(auth.user.id, {
    title: "JARVIS",
    body: "Notifications are working. You'll hear from me when something is worth it.",
    url: "/",
    tag: "test",
  });

  return Response.json({ delivered });
}
