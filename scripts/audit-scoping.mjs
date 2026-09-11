/**
 * Fails the build if a Prisma query on a user-owned model forgets its userId.
 *
 * The schema makes userId *required* on every write, so the compiler already
 * rejects an unscoped create or update-with-data. Reads are the gap:
 * findMany({ where: { archived: false } }) type-checks perfectly and quietly
 * returns every account's rows. That is the one mistake in this codebase that
 * would leak one person's memories to another, so it gets its own check.
 *
 *   npm run audit
 *
 * A genuine exception — a row already fetched through a userId filter, then
 * updated by its primary key — is silenced with a `// audit-ok: why` comment
 * on the line above the call.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const OWNED = new Set([
  "profile",
  "memory",
  "page",
  "conversation",
  "message",
  "task",
  "logEntry",
  "pushSubscription",
  "notification",
  "usageRecord",
  "device",
  "deviceCommand",
]);

// What counts as proof the query is scoped to one person.
const SCOPES = ["userId", "userId_slug", "conversationId"];
const LOOKAHEAD = 420;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const hits = [];

for (const path of walk("src")) {
  const src = readFileSync(path, "utf8");
  for (const match of src.matchAll(/prisma\.(\w+)\.(\w+)\(/g)) {
    const [, model, op] = match;
    if (!OWNED.has(model)) continue;

    const chunk = src.slice(match.index, match.index + LOOKAHEAD);
    if (SCOPES.some((scope) => chunk.includes(scope))) continue;

    const before = src.slice(0, match.index);
    const previousLine = before.split("\n").at(-2) ?? "";
    if (previousLine.includes("audit-ok:")) continue;

    hits.push({ path, line: before.split("\n").length, call: `prisma.${model}.${op}` });
  }
}

if (hits.length) {
  console.error(`\nUNSCOPED QUERIES: ${hits.length}\n`);
  for (const h of hits) console.error(`  ${h.path}:${h.line}  ${h.call}`);
  console.error(
    "\nEach of these reads user-owned rows without naming a user. Add userId to\n" +
      "the where clause, or if the row was already fetched through one, mark it\n" +
      "with `// audit-ok: <reason>` on the line above.\n"
  );
  process.exit(1);
}

console.log("Scoping audit clean — every query on an owned model names a user.");
