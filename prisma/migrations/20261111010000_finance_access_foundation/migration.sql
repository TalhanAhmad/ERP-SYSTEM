-- Access foundation only. No production grant, owner, ledger, or financial data is seeded.
CREATE TABLE "FinanceGrant" (
 "id" UUID PRIMARY KEY,
 "userId" UUID NOT NULL REFERENCES "Person"("id") ON DELETE RESTRICT,
 "grantedById" UUID NOT NULL REFERENCES "Person"("id") ON DELETE RESTRICT,
 "grantedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "revokedById" UUID REFERENCES "Person"("id") ON DELETE RESTRICT,
 "revokedAt" TIMESTAMPTZ,
 "reason" TEXT NOT NULL CHECK (length(trim("reason")) BETWEEN 3 AND 500),
 "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
 CONSTRAINT "FinanceGrant_revocation_pair" CHECK (("revokedAt" IS NULL) = ("revokedById" IS NULL)),
 CONSTRAINT "FinanceGrant_revocation_date" CHECK ("revokedAt" IS NULL OR "revokedAt" >= "grantedAt")
);
CREATE UNIQUE INDEX "FinanceGrant_one_active_user" ON "FinanceGrant"("userId") WHERE "revokedAt" IS NULL;
CREATE INDEX "FinanceGrant_userId_revokedAt_idx" ON "FinanceGrant"("userId","revokedAt");
CREATE TABLE "FinanceAuditEvent" (
 "id" UUID PRIMARY KEY,
 "actorId" UUID NOT NULL REFERENCES "Person"("id") ON DELETE RESTRICT,
 "action" TEXT NOT NULL,
 "entityType" TEXT NOT NULL,
 "entityId" UUID,
 "reason" TEXT NOT NULL CHECK (length(trim("reason")) BETWEEN 3 AND 500),
 "data" JSONB NOT NULL,
 "requestId" UUID NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FinanceAuditEvent_entityType_entityId_createdAt_idx" ON "FinanceAuditEvent"("entityType","entityId","createdAt");
CREATE INDEX "FinanceAuditEvent_actorId_createdAt_idx" ON "FinanceAuditEvent"("actorId","createdAt");
CREATE FUNCTION encova_finance_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Finance audit history is immutable' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER "FinanceAuditEvent_immutable" BEFORE UPDATE OR DELETE ON "FinanceAuditEvent"
 FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
ALTER TABLE "FinanceGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceAuditEvent" ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE table_name TEXT; BEGIN
 FOREACH table_name IN ARRAY ARRAY['FinanceGrant','FinanceAuditEvent'] LOOP
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', table_name);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon', table_name); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated', table_name); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN
  GRANT SELECT ON "FinanceGrant" TO encova_app;
  CREATE POLICY encova_server_read ON "FinanceGrant" FOR SELECT TO encova_app USING(true);
  GRANT SELECT, INSERT ON "FinanceAuditEvent" TO encova_app;
  CREATE POLICY encova_server_read ON "FinanceAuditEvent" FOR SELECT TO encova_app USING(true);
  CREATE POLICY encova_server_append ON "FinanceAuditEvent" FOR INSERT TO encova_app WITH CHECK(true);
 END IF;
END $$;
