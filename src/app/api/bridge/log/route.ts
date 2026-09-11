import { prisma } from "@/lib/db";
import { requireUnlockedBridge } from "@/lib/bridgeGuard";

export const dynamic = "force-dynamic";

/**
 * The audit trail. Every instruction ever sent to a machine, newest first,
 * whether it succeeded, failed, or was refused at the other end.
 *
 * Results are summarised rather than returned whole — a screenshot or a file
 * dump has no business being re-sent on every poll of the log.
 */
export async function GET(req: Request) {
  const auth = await requireUnlockedBridge();
  if ("denied" in auth) return auth.denied;

  const url = new URL(req.url);
  const take = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 40)));
  const since = url.searchParams.get("since");

  const commands = await prisma.deviceCommand.findMany({
    where: {
      userId: auth.user.id,
      ...(since ? { createdAt: { gt: new Date(since) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      capability: true,
      args: true,
      status: true,
      error: true,
      result: true,
      createdAt: true,
      finishedAt: true,
      device: { select: { id: true, name: true } },
    },
  });

  return Response.json({
    commands: commands.map((c) => ({
      id: c.id,
      capability: c.capability,
      args: c.args,
      status: c.status,
      error: c.error,
      summary: summarise(c.result),
      createdAt: c.createdAt,
      finishedAt: c.finishedAt,
      device: c.device,
    })),
    remainingMs: auth.remainingMs,
  });
}

/** A one-line gist of whatever came back. */
function summarise(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result.slice(0, 160);
  if (Array.isArray(result)) return `${result.length} items`;
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (typeof obj.summary === "string") return obj.summary.slice(0, 160);
    if (Array.isArray(obj.entries)) return `${obj.entries.length} entries`;
    if (typeof obj.bytes === "number") return `${obj.bytes} bytes`;
    const keys = Object.keys(obj).slice(0, 4);
    return keys.length ? keys.join(", ") : "";
  }
  return String(result).slice(0, 160);
}
