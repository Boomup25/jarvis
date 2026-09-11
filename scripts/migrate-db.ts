/**
 * Copy every row from one Postgres database to another.
 *
 *   Neon (source)  ->  Railway (target)
 *
 * Uses the Prisma client that's already installed, so there's nothing to
 * install and no pg_dump/psql needed on Windows.
 *
 * Usage (PowerShell), from the project root:
 *
 *   $env:SOURCE_DATABASE_URL="<your Neon connection string>"
 *   $env:DATABASE_URL="<your Railway PUBLIC connection string>"
 *   npx prisma migrate deploy      # creates the schema on the target
 *   npx tsx scripts/migrate-db.ts  # copies the data
 *
 * Safe to re-run: every insert skips rows that already exist, so a partial
 * run can simply be repeated. Nothing is ever deleted from the source.
 */

import { PrismaClient } from "@prisma/client";

const sourceUrl = process.env.SOURCE_DATABASE_URL;
const targetUrl = process.env.DATABASE_URL;

if (!sourceUrl) throw new Error("SOURCE_DATABASE_URL is not set (this is the OLD database)");
if (!targetUrl) throw new Error("DATABASE_URL is not set (this is the NEW database)");
if (sourceUrl === targetUrl) throw new Error("Source and target are the same database");

const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });

/**
 * Order matters: parents before the rows that reference them.
 *
 * `user` has to lead — every other table now carries a userId foreign key,
 * and LogEntry points at Page.slug, so pages come before logs.
 */
const TABLES = [
  "user",
  "profile",
  "memory",
  "page",
  "conversation",
  "message",
  "task",
  "logEntry",
  "inviteCode",
  "usageRecord",
  "pushSubscription",
  "notification",
  "systemEvent",
] as const;

async function copyTable(name: (typeof TABLES)[number]) {
  const from = (source as any)[name];
  const to = (target as any)[name];

  const rows = await from.findMany();
  if (rows.length === 0) {
    console.log(`  ${name.padEnd(13)} 0 rows — nothing to copy`);
    return { name, copied: 0, total: 0 };
  }

  // Chunked so a large table can't blow the statement size.
  let copied = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const result = await to.createMany({ data: batch, skipDuplicates: true });
    copied += result.count;
  }

  console.log(`  ${name.padEnd(13)} ${copied}/${rows.length} copied`);
  return { name, copied, total: rows.length };
}

async function main() {
  console.log("\nConnecting…");
  const [srcOk, tgtOk] = await Promise.all([
    source.$queryRaw`SELECT 1`.then(() => true).catch((e: Error) => e.message),
    target.$queryRaw`SELECT 1`.then(() => true).catch((e: Error) => e.message),
  ]);
  if (srcOk !== true) throw new Error(`Can't reach the SOURCE database: ${srcOk}`);
  if (tgtOk !== true) throw new Error(`Can't reach the TARGET database: ${tgtOk}`);
  console.log("Both databases reachable.\n");

  console.log("Copying:");
  const results = [];
  for (const table of TABLES) results.push(await copyTable(table));

  console.log("\nVerifying row counts on both sides:");
  let mismatch = false;
  for (const table of TABLES) {
    const [a, b] = await Promise.all([
      (source as any)[table].count(),
      (target as any)[table].count(),
    ]);
    const ok = a === b;
    if (!ok) mismatch = true;
    console.log(`  ${table.padEnd(13)} source ${String(a).padStart(5)}   target ${String(b).padStart(5)}   ${ok ? "OK" : "MISMATCH"}`);
  }

  const moved = results.reduce((sum, r) => sum + r.copied, 0);
  console.log(
    mismatch
      ? `\nDone with mismatches — ${moved} rows copied. Re-run to fill gaps; if a count is still short, tell Claude which table.`
      : `\nDone. ${moved} rows copied, every table matches.\n\nNext: point the Railway app service at the new database, redeploy, and check /api/health.`
  );
}

main()
  .catch((err) => {
    console.error("\nMigration failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await source.$disconnect();
    await target.$disconnect();
  });
