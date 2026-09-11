/**
 * Accounts, invites and quotas.
 *
 * Signup is invite-only: a public URL with open signup would let strangers
 * spend the owner's OpenRouter credit. Quotas are the second half of that —
 * an invited friend still can't run up an unbounded bill.
 */

import { randomBytes } from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "./db";
import { hashPassword, verifyPassword, BOOTSTRAP_HASH } from "./password";

export const OWNER_ID = "owner";

export function currentPeriod(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/* ----------------------------- authentication ---------------------------- */

/**
 * Checks credentials.
 *
 * The owner row is created by the migration with a sentinel hash, so the first
 * successful login using the old APP_PASSWORD upgrades it to a real scrypt
 * hash in place. Nobody has to reset anything.
 */
export async function authenticate(username: string, password: string): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { username: username.toLowerCase().trim() } });
  if (!user || !user.active) return null;

  if (user.passwordHash === BOOTSTRAP_HASH) {
    const legacy = process.env.APP_PASSWORD;
    if (!legacy || password !== legacy) return null;
    const upgraded = await hashPassword(password);
    return prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: upgraded, lastSeenAt: new Date() },
    });
  }

  if (!(await verifyPassword(password, user.passwordHash))) return null;

  return prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
}

/* --------------------------------- invites -------------------------------- */

/** Readable but not guessable — 6 groups of 4 would be tedious to type. */
function makeCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1
  const bytes = randomBytes(12);
  let code = "";
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) code += "-";
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

export async function createInvite(createdById: string, note = "", expiresInDays = 14) {
  return prisma.inviteCode.create({
    data: {
      code: makeCode(),
      createdById,
      note: note.slice(0, 80),
      expiresAt: new Date(Date.now() + expiresInDays * 86_400_000),
    },
  });
}

export interface RedeemResult {
  user?: User;
  error?: string;
}

/** Creates an account against an unused, unexpired invite. */
export async function redeemInvite(
  code: string,
  username: string,
  displayName: string,
  password: string
): Promise<RedeemResult> {
  const invite = await prisma.inviteCode.findUnique({
    where: { code: code.toUpperCase().trim() },
  });

  if (!invite) return { error: "That invite code isn't valid." };
  if (invite.usedAt) return { error: "That invite has already been used." };
  if (invite.expiresAt && invite.expiresAt < new Date()) return { error: "That invite has expired." };

  const handle = username.toLowerCase().trim();
  if (await prisma.user.findUnique({ where: { username: handle } })) {
    return { error: "That username is taken." };
  }

  const user = await prisma.user.create({
    data: {
      username: handle,
      displayName: displayName.trim().slice(0, 40) || handle,
      passwordHash: await hashPassword(password),
      role: "member",
      monthlyQuota: Number(process.env.DEFAULT_MONTHLY_QUOTA) || 200,
      profile: {
        create: {
          displayName: displayName.trim().slice(0, 40) || handle,
          timezone: process.env.TZ || "America/Chicago",
        },
      },
    },
  });

  await prisma.inviteCode.update({
    where: { id: invite.id },
    data: { usedAt: new Date(), usedByUsername: handle },
  });

  return { user };
}

/* --------------------------------- quotas --------------------------------- */

export interface QuotaState {
  used: number;
  limit: number;
  /** 0 means unlimited. */
  unlimited: boolean;
  exceeded: boolean;
}

export async function quotaFor(user: User, kind = "chat"): Promise<QuotaState> {
  if (user.monthlyQuota === 0) {
    return { used: 0, limit: 0, unlimited: true, exceeded: false };
  }
  const used = await prisma.usageRecord.count({
    where: { userId: user.id, period: currentPeriod(), kind },
  });
  return {
    used,
    limit: user.monthlyQuota,
    unlimited: false,
    exceeded: used >= user.monthlyQuota,
  };
}

export async function recordUsage(userId: string, kind: string, model = "") {
  await prisma.usageRecord
    .create({ data: { userId, kind, period: currentPeriod(), model: model.slice(0, 80) } })
    .catch(() => {});
}

export const isOwner = (user: { role: string }) => user.role === "owner";
