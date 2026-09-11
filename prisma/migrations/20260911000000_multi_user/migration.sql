-- Multi-user migration.
--
-- Existing rows belong to a single implicit owner, so this creates that owner
-- first, backfills every table with its id, and only then makes the column
-- required. Written by hand rather than generated, because the generated
-- version would try to add a NOT NULL column to populated tables and fail.
--
-- Every statement is idempotent so a partial run can be repeated safely.

-- ---------------------------------------------------------------- new tables
CREATE TABLE IF NOT EXISTS "User" (
    "id"           TEXT PRIMARY KEY,
    "username"     TEXT NOT NULL,
    "displayName"  TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role"         TEXT NOT NULL DEFAULT 'member',
    "active"       BOOLEAN NOT NULL DEFAULT true,
    "monthlyQuota" INTEGER NOT NULL DEFAULT 200,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"   TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
CREATE INDEX IF NOT EXISTS "User_active_idx" ON "User"("active");

CREATE TABLE IF NOT EXISTS "InviteCode" (
    "id"             TEXT PRIMARY KEY,
    "code"           TEXT NOT NULL,
    "createdById"    TEXT NOT NULL,
    "usedByUsername" TEXT,
    "usedAt"         TIMESTAMP(3),
    "note"           TEXT NOT NULL DEFAULT '',
    "expiresAt"      TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "InviteCode_code_key" ON "InviteCode"("code");
CREATE INDEX IF NOT EXISTS "InviteCode_createdById_idx" ON "InviteCode"("createdById");

CREATE TABLE IF NOT EXISTS "UsageRecord" (
    "id"        TEXT PRIMARY KEY,
    "userId"    TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "period"    TEXT NOT NULL,
    "model"     TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "UsageRecord_userId_period_kind_idx" ON "UsageRecord"("userId","period","kind");
CREATE INDEX IF NOT EXISTS "UsageRecord_createdAt_idx" ON "UsageRecord"("createdAt");

CREATE TABLE IF NOT EXISTS "SystemEvent" (
    "id"        TEXT PRIMARY KEY,
    "level"     TEXT NOT NULL DEFAULT 'error',
    "source"    TEXT NOT NULL,
    "message"   TEXT NOT NULL,
    "detail"    TEXT NOT NULL DEFAULT '',
    "notified"  BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SystemEvent_level_createdAt_idx" ON "SystemEvent"("level","createdAt");
CREATE INDEX IF NOT EXISTS "SystemEvent_createdAt_idx" ON "SystemEvent"("createdAt");

-- may already exist from the message_image migration
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;

-- ------------------------------------------------------------- the owner row
-- 'bootstrap' is a sentinel: the login route swaps it for a real scrypt hash
-- the first time the existing APP_PASSWORD is used, so nobody has to reset
-- anything by hand.
INSERT INTO "User" ("id","username","displayName","passwordHash","role","monthlyQuota")
VALUES ('owner','owner','Owner','bootstrap','owner',0)
ON CONFLICT ("id") DO NOTHING;

-- ------------------------------------------------------- add + backfill keys
ALTER TABLE "Profile"          ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "Memory"           ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "Page"             ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "Conversation"     ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "Task"             ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "LogEntry"         ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "PushSubscription" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "Notification"     ADD COLUMN IF NOT EXISTS "userId" TEXT;

UPDATE "Profile"          SET "userId" = 'owner' WHERE "userId" IS NULL;
UPDATE "Memory"           SET "userId" = 'owner' WHERE "userId" IS NULL;
UPDATE "Page"             SET "userId" = 'owner' WHERE "userId" IS NULL;
UPDATE "Conversation"     SET "userId" = 'owner' WHERE "userId" IS NULL;
UPDATE "Task"             SET "userId" = 'owner' WHERE "userId" IS NULL;
UPDATE "LogEntry"         SET "userId" = 'owner' WHERE "userId" IS NULL;
UPDATE "PushSubscription" SET "userId" = 'owner' WHERE "userId" IS NULL;
UPDATE "Notification"     SET "userId" = 'owner' WHERE "userId" IS NULL;

ALTER TABLE "Profile"          ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Memory"           ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Page"             ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Conversation"     ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Task"             ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "LogEntry"         ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "PushSubscription" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Notification"     ALTER COLUMN "userId" SET NOT NULL;

-- --------------------------------------------- constraints that are now wrong
-- Slugs and dedupe keys were globally unique; they must now be per-user, or
-- two people can't both have a page called "push-day-a".
-- Constraint FIRST: a unique index backed by a constraint cannot be dropped
-- with DROP INDEX, and doing so aborts the whole migration.
-- The LogEntry foreign key REFERENCES Page(slug), so it depends on that unique
-- index and has to go first. Order matters more than it looks here.
ALTER TABLE "LogEntry" DROP CONSTRAINT IF EXISTS "LogEntry_pageSlug_fkey";
ALTER TABLE "Page" DROP CONSTRAINT IF EXISTS "Page_slug_key";
ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_dedupeKey_key";
DROP INDEX IF EXISTS "Page_slug_key";
DROP INDEX IF EXISTS "Notification_dedupeKey_key";

DROP INDEX IF EXISTS "Page_type_archived_idx";
DROP INDEX IF EXISTS "Page_archived_updatedAt_idx";
DROP INDEX IF EXISTS "Memory_active_importance_idx";
DROP INDEX IF EXISTS "Memory_category_idx";
DROP INDEX IF EXISTS "Conversation_updatedAt_idx";
DROP INDEX IF EXISTS "Task_done_dueAt_idx";
DROP INDEX IF EXISTS "LogEntry_kind_occurredAt_idx";
DROP INDEX IF EXISTS "PushSubscription_active_idx";
DROP INDEX IF EXISTS "Notification_kind_createdAt_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "Profile_userId_key"        ON "Profile"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "Page_userId_slug_key"      ON "Page"("userId","slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_userId_dedupeKey_key" ON "Notification"("userId","dedupeKey");

CREATE INDEX IF NOT EXISTS "Page_userId_type_archived_idx"        ON "Page"("userId","type","archived");
CREATE INDEX IF NOT EXISTS "Page_userId_archived_updatedAt_idx"   ON "Page"("userId","archived","updatedAt");
CREATE INDEX IF NOT EXISTS "Memory_userId_active_importance_idx"  ON "Memory"("userId","active","importance");
CREATE INDEX IF NOT EXISTS "Memory_userId_category_idx"           ON "Memory"("userId","category");
CREATE INDEX IF NOT EXISTS "Conversation_userId_updatedAt_idx"    ON "Conversation"("userId","updatedAt");
CREATE INDEX IF NOT EXISTS "Task_userId_done_dueAt_idx"           ON "Task"("userId","done","dueAt");
CREATE INDEX IF NOT EXISTS "LogEntry_userId_kind_occurredAt_idx"  ON "LogEntry"("userId","kind","occurredAt");
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_active_idx"   ON "PushSubscription"("userId","active");
CREATE INDEX IF NOT EXISTS "Notification_userId_kind_createdAt_idx" ON "Notification"("userId","kind","createdAt");

-- ------------------------------------------------------------- foreign keys
DO $$ BEGIN
  ALTER TABLE "Profile"          ADD CONSTRAINT "Profile_userId_fkey"          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Memory"           ADD CONSTRAINT "Memory_userId_fkey"           FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Page"             ADD CONSTRAINT "Page_userId_fkey"             FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Conversation"     ADD CONSTRAINT "Conversation_userId_fkey"     FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Task"             ADD CONSTRAINT "Task_userId_fkey"             FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LogEntry"         ADD CONSTRAINT "LogEntry_userId_fkey"         FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Notification"     ADD CONSTRAINT "Notification_userId_fkey"     FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InviteCode"       ADD CONSTRAINT "InviteCode_createdById_fkey"  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "UsageRecord"      ADD CONSTRAINT "UsageRecord_userId_fkey"      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
