CREATE TABLE "JobRun" (
 id UUID PRIMARY KEY,"kind" TEXT NOT NULL DEFAULT 'ATTENDANCE',"workDate" DATE NOT NULL,
 reason TEXT NOT NULL,source TEXT NOT NULL,"requestedBy" UUID,"scheduleKey" TEXT,
 audience UUID[] NOT NULL,total INTEGER NOT NULL,cursor INTEGER NOT NULL DEFAULT 0,"updatedCount" INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'QUEUED',"activeAttemptId" UUID,"leaseUntil" TIMESTAMPTZ,
 "errorCode" TEXT,version INTEGER NOT NULL DEFAULT 1,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ NOT NULL,"finishedAt" TIMESTAMPTZ,
 CONSTRAINT "JobRun_requestedBy_fkey" FOREIGN KEY("requestedBy") REFERENCES "Person"(id) ON DELETE RESTRICT,
 CONSTRAINT "JobRun_kind" CHECK(kind='ATTENDANCE'),
 CONSTRAINT "JobRun_source" CHECK(source IN ('ADMIN','CRON','CLI')),
 CONSTRAINT "JobRun_state" CHECK(status IN ('QUEUED','RUNNING','FAILED','SUCCEEDED')),
 CONSTRAINT "JobRun_bounds" CHECK(total=cardinality(audience) AND cursor>=0 AND cursor<=cardinality(audience) AND cardinality(audience)<=1000 AND "updatedCount">=0 AND "updatedCount"<=cursor AND version>0),
 CONSTRAINT "JobRun_lease" CHECK((status='RUNNING' AND "activeAttemptId" IS NOT NULL AND "leaseUntil" IS NOT NULL) OR (status<>'RUNNING' AND "activeAttemptId" IS NULL AND "leaseUntil" IS NULL))
);
CREATE UNIQUE INDEX "JobRun_scheduleKey_key" ON "JobRun"("scheduleKey");
CREATE INDEX "JobRun_status_createdAt_idx" ON "JobRun"(status,"createdAt");
CREATE TABLE "JobAttempt" (
 id UUID PRIMARY KEY,"runId" UUID NOT NULL,"requestKey" TEXT NOT NULL,source TEXT NOT NULL,
 "actorId" UUID,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'RUNNING',"startCursor" INTEGER NOT NULL,"endCursor" INTEGER NOT NULL,
 "errorCode" TEXT,"startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"finishedAt" TIMESTAMPTZ,
 CONSTRAINT "JobAttempt_runId_fkey" FOREIGN KEY("runId") REFERENCES "JobRun"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "JobAttempt_actorId_fkey" FOREIGN KEY("actorId") REFERENCES "Person"(id) ON DELETE RESTRICT,
 CONSTRAINT "JobAttempt_source" CHECK(source IN ('ADMIN','CRON','CLI')),
 CONSTRAINT "JobAttempt_state" CHECK(status IN ('RUNNING','PARTIAL','SUCCEEDED','FAILED','ABANDONED')),
 CONSTRAINT "JobAttempt_bounds" CHECK("startCursor">=0 AND "endCursor">="startCursor"),
 CONSTRAINT "JobAttempt_finished" CHECK((status='RUNNING')=("finishedAt" IS NULL))
);
CREATE UNIQUE INDEX "JobAttempt_runId_requestKey_key" ON "JobAttempt"("runId","requestKey");
CREATE INDEX "JobAttempt_runId_startedAt_idx" ON "JobAttempt"("runId","startedAt");
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_activeAttemptId_fkey" FOREIGN KEY("activeAttemptId") REFERENCES "JobAttempt"(id) ON DELETE RESTRICT;
CREATE FUNCTION protect_job_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Job execution history is retained'; END IF;
 IF TG_TABLE_NAME='JobAttempt' THEN
  IF OLD.status<>'RUNNING' THEN RAISE EXCEPTION 'Finished job attempts are immutable'; END IF;
 ELSE
  IF OLD.status='SUCCEEDED' THEN RAISE EXCEPTION 'Completed jobs are immutable'; END IF;
  IF NEW.total<>OLD.total OR NEW.audience IS DISTINCT FROM OLD.audience OR NEW."workDate"<>OLD."workDate" OR NEW.kind<>OLD.kind OR NEW.source<>OLD.source OR NEW.reason<>OLD.reason OR NEW."requestedBy" IS DISTINCT FROM OLD."requestedBy" OR NEW."scheduleKey" IS DISTINCT FROM OLD."scheduleKey" THEN RAISE EXCEPTION 'Job scope is immutable'; END IF;
  IF NEW.cursor<OLD.cursor OR NEW."updatedCount"<OLD."updatedCount" THEN RAISE EXCEPTION 'Job progress cannot move backward'; END IF;
  IF NEW."activeAttemptId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "JobAttempt" a WHERE a.id=NEW."activeAttemptId" AND a."runId"=NEW.id AND a.status='RUNNING') THEN RAISE EXCEPTION 'Job attempt scope mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "JobRun_history" BEFORE UPDATE OR DELETE ON "JobRun" FOR EACH ROW EXECUTE FUNCTION protect_job_history();
CREATE TRIGGER "JobAttempt_history" BEFORE UPDATE OR DELETE ON "JobAttempt" FOR EACH ROW EXECUTE FUNCTION protect_job_history();
ALTER TABLE "JobRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobAttempt" ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['JobRun','JobAttempt'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO encova_app',t);
   EXECUTE format('CREATE POLICY encova_server_access ON %I TO encova_app USING(true) WITH CHECK(true)',t);
  END IF;
 END LOOP;
END $$;
