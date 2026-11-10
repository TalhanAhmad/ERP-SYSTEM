ALTER TABLE "AttendanceCorrection" ADD COLUMN "decisionReason" TEXT;
ALTER TABLE "WeeklyFeedback" ADD CONSTRAINT "WeeklyFeedback_rating_explained" CHECK(rating IS NULL OR ("ratingExplanation" IS NOT NULL AND length(trim("ratingExplanation"))>0));
CREATE TABLE "SavedView" (id UUID PRIMARY KEY,"userId" UUID NOT NULL REFERENCES "Person"(id) ON DELETE RESTRICT,entity TEXT NOT NULL CHECK(entity IN ('people','tasks','attendance','report-status')),name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),"normalizedName" TEXT NOT NULL,columns JSONB NOT NULL,filters JSONB NOT NULL,version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL,UNIQUE("userId",entity,"normalizedName"));
CREATE TABLE "ChangePreview" (id UUID PRIMARY KEY,"userId" UUID NOT NULL REFERENCES "Person"(id) ON DELETE RESTRICT,kind TEXT NOT NULL CHECK(kind IN ('TASK_IMPORT','TASK_BULK')),payload JSONB NOT NULL,result JSONB,"expiresAt" TIMESTAMPTZ NOT NULL,"committedAt" TIMESTAMPTZ,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "ChangePreview_userId_expiresAt_idx" ON "ChangePreview"("userId","expiresAt");
DO $$ DECLARE n TEXT; BEGIN FOREACH n IN ARRAY ARRAY['SavedView','ChangePreview'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon',n); END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated',n); END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO encova_app',n); EXECUTE format('CREATE POLICY encova_server_access ON %I TO encova_app USING(true) WITH CHECK(true)',n); END IF;
 END LOOP; END $$;
