/**
 * Failure reporting.
 *
 * Everything that goes wrong lands in SystemEvent so there's a record, and
 * anything severe pushes a notification — the app already has a delivery
 * channel to your phone, so it may as well tell you when it's broken instead
 * of waiting for you to notice.
 */

import { prisma } from "./db";

export type EventSource = "chat" | "agenda" | "speak" | "push" | "auth" | "scheduler" | "search";

export async function logEvent(
  source: EventSource,
  message: string,
  opts?: { level?: "error" | "warn" | "info"; detail?: unknown; notify?: boolean }
) {
  const level = opts?.level ?? "error";
  const detail =
    opts?.detail instanceof Error
      ? `${opts.detail.message}\n${opts.detail.stack ?? ""}`
      : opts?.detail
        ? JSON.stringify(opts.detail).slice(0, 2000)
        : "";

  console[level === "error" ? "error" : "warn"](`[${source}] ${message}`, detail.slice(0, 300));

  try {
    const event = await prisma.systemEvent.create({
      data: { level, source, message: message.slice(0, 500), detail: detail.slice(0, 4000) },
    });

    if (opts?.notify && level === "error") {
      // Imported lazily: the push module pulls in web-push, and the logger is
      // used from places that shouldn't drag that in.
      const { sendPush } = await import("./push");
      // System failures go to the owner, never to members.
      const owner = await prisma.user.findFirst({ where: { role: "owner" } });
      const delivered = owner
        ? await sendPush(owner.id, {
            title: "JARVIS needs attention",
            body: `${source}: ${message}`.slice(0, 160),
            url: "/",
            tag: "system",
          })
        : 0;
      if (delivered > 0) {
        await prisma.systemEvent.update({ where: { id: event.id }, data: { notified: true } });
      }
    }
  } catch {
    // Logging must never be the thing that takes the app down.
  }
}

/** Error count in the recent past — drives the self-health rule in the agenda. */
export async function recentErrorCount(withinMs = 3_600_000): Promise<number> {
  try {
    return await prisma.systemEvent.count({
      where: { level: "error", createdAt: { gte: new Date(Date.now() - withinMs) } },
    });
  } catch {
    return 0;
  }
}
