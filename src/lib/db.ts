import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export const PROFILE_ID = "me";

export async function getProfile() {
  const existing = await prisma.profile.findUnique({ where: { id: PROFILE_ID } });
  if (existing) return existing;
  return prisma.profile.create({
    data: {
      id: PROFILE_ID,
      displayName: process.env.OWNER_NAME || "Sir",
      timezone: process.env.TZ || "America/Chicago",
    },
  });
}
