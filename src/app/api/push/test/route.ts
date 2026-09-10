import { guard } from "@/lib/session";
import { sendPush, pushConfigured } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST() {
  const denied = await guard();
  if (denied) return denied;
  if (!pushConfigured()) {
    return Response.json({ error: "VAPID keys are not set on the server" }, { status: 400 });
  }

  const delivered = await sendPush({
    title: "JARVIS",
    body: "Notifications are working. You'll hear from me when something is worth it.",
    url: "/",
    tag: "test",
  });

  return Response.json({ delivered });
}
