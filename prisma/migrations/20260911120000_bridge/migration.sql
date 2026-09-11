-- The bridge: machines paired with an account, and every command sent to them.
--
-- Written by hand and idempotent throughout, like the multi-user migration, so
-- a partial apply can simply be re-run rather than needing surgery.

-- The bridge passphrase. Empty means this account has never armed the bridge,
-- which is the only safe default for an existing row.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bridgeHash" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "Device" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "tokenHash"    TEXT NOT NULL,
  "platform"     TEXT NOT NULL DEFAULT '',
  "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "roots"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DeviceCommand" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "deviceId"   TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "args"       JSONB NOT NULL DEFAULT '{}',
  "status"     TEXT NOT NULL DEFAULT 'pending',
  "result"     JSONB,
  "error"      TEXT NOT NULL DEFAULT '',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt"     TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "DeviceCommand_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Device_userId_active_idx" ON "Device" ("userId", "active");
CREATE INDEX IF NOT EXISTS "DeviceCommand_userId_createdAt_idx" ON "DeviceCommand" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "DeviceCommand_deviceId_status_idx" ON "DeviceCommand" ("deviceId", "status");

-- Foreign keys, wrapped so a re-run doesn't trip over an existing constraint.
DO $$ BEGIN
  ALTER TABLE "Device"
    ADD CONSTRAINT "Device_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DeviceCommand"
    ADD CONSTRAINT "DeviceCommand_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DeviceCommand"
    ADD CONSTRAINT "DeviceCommand_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
