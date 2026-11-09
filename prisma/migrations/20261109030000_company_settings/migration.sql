ALTER TABLE "EmployeeProfile" ADD COLUMN "internshipEndDate" DATE;
CREATE TABLE "CompanySettings" (id TEXT PRIMARY KEY DEFAULT 'workspace' CHECK(id='workspace'),"companyName" TEXT NOT NULL DEFAULT 'Encova Solutions' CHECK(length(trim("companyName")) BETWEEN 1 AND 120),timezone TEXT NOT NULL DEFAULT 'Asia/Karachi' CHECK(timezone='Asia/Karachi'),workweek JSONB NOT NULL,"reportCutoff" TEXT NOT NULL DEFAULT '17:00' CHECK("reportCutoff" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),"policyConfirmedAt" TIMESTAMPTZ,"reportReminders" BOOLEAN NOT NULL DEFAULT true,version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"updatedAt" TIMESTAMPTZ NOT NULL);
INSERT INTO "CompanySettings" (workweek,"updatedAt") VALUES ('[1,2,3,4,5]',now());
ALTER TABLE "CompanySettings" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "CompanySettings" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "CompanySettings" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT SELECT,INSERT,UPDATE ON "CompanySettings" TO encova_app; CREATE POLICY encova_server_access ON "CompanySettings" TO encova_app USING(true) WITH CHECK(true); END IF;
END $$;
