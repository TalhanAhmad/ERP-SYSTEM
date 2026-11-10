ALTER TABLE "CompanySettings" ADD COLUMN "requirePrivilegedMfa" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Idempotency" ADD COLUMN "actorRole" TEXT;
CREATE TABLE "AppSession" (id UUID PRIMARY KEY,"userId" UUID NOT NULL REFERENCES "Person"(id) ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "AppSession_userId_idx" ON "AppSession"("userId");
ALTER TABLE "AppSession" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "AppSession" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "AppSession" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON "AppSession" TO encova_app; CREATE POLICY encova_server_access ON "AppSession" TO encova_app USING(true) WITH CHECK(true); END IF;
END $$;
