CREATE TABLE "TaskComment" (id UUID PRIMARY KEY,"taskId" UUID NOT NULL REFERENCES "Task"(id) ON DELETE RESTRICT,"authorId" UUID NOT NULL REFERENCES "Person"(id) ON DELETE RESTRICT,body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 2000),"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "TaskComment_taskId_createdAt_idx" ON "TaskComment"("taskId","createdAt");
CREATE TRIGGER "TaskComment_immutable" BEFORE UPDATE OR DELETE ON "TaskComment" FOR EACH ROW EXECUTE FUNCTION deny_immutable_change();
ALTER TABLE "TaskComment" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "TaskComment" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "TaskComment" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT SELECT,INSERT ON "TaskComment" TO encova_app; CREATE POLICY encova_server_access ON "TaskComment" TO encova_app USING(true) WITH CHECK(true); END IF;
END $$;
