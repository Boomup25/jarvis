import { prisma } from "./db";

export async function createActivity(input: {
  userId: string;
  kind: string;
  pageSlug?: string | null;
  note?: string;
  value?: unknown;
  occurredAt?: unknown;
}) {
  const now = new Date();
  const note = String(input.note ?? "").trim();
  const value = typeof input.value === "object" && input.value ? input.value : {};
  let occurredAt = input.occurredAt ? new Date(String(input.occurredAt)) : now;
  // A completed activity cannot be in the future. This also protects against
  // an assistant using an incorrect current date from inventing one.
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > now.getTime() + 5 * 60_000) occurredAt = now;

  const recent = await prisma.logEntry.findMany({
    where: {
      userId: input.userId,
      kind: input.kind,
      pageSlug: input.pageSlug ?? null,
      note,
      createdAt: { gte: new Date(now.getTime() - 30_000) },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const valueKey = JSON.stringify(value);
  const duplicate = recent.find(
    (candidate) => JSON.stringify(candidate.value) === valueKey && Math.abs(candidate.occurredAt.getTime() - occurredAt.getTime()) < 60_000
  );
  if (duplicate) return { log: duplicate, deduplicated: true };

  const log = await prisma.logEntry.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      pageSlug: input.pageSlug ?? null,
      note,
      value,
      occurredAt,
    },
  });
  return { log, deduplicated: false };
}
