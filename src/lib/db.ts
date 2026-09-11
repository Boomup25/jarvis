import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * A user's profile, created on demand.
 *
 * Everything in the app is scoped by userId — there is no global state left,
 * which is what stops one account seeing another's memories.
 */
export async function getProfile(userId: string) {
  const existing = await prisma.profile.findUnique({ where: { userId } });
  if (existing) return existing;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  return prisma.profile.create({
    data: {
      userId,
      displayName: user?.displayName || process.env.OWNER_NAME || "Sir",
      timezone: process.env.TZ || "America/Chicago",
    },
  });
}
