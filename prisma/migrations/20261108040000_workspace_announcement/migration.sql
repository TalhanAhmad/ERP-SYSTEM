CREATE TABLE "Announcement" (
 id UUID PRIMARY KEY, slot TEXT NOT NULL DEFAULT 'workspace' UNIQUE,
 title TEXT NOT NULL, body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 "publishedBy" UUID NOT NULL REFERENCES "Person"(id) ON DELETE RESTRICT,
 "updatedBy" UUID NOT NULL REFERENCES "Person"(id) ON DELETE RESTRICT,
 "publishedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ NOT NULL, "expiresAt" TIMESTAMPTZ NOT NULL,
 CONSTRAINT "Announcement_slot" CHECK(slot='workspace'),
 CONSTRAINT "Announcement_content" CHECK(length(trim(title)) BETWEEN 1 AND 120 AND length(trim(body)) BETWEEN 1 AND 2000),
 CONSTRAINT "Announcement_version" CHECK(version>0),
 CONSTRAINT "Announcement_expiry" CHECK("expiresAt">"publishedAt")
);
ALTER TABLE "Announcement" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "Announcement" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "Announcement" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON "Announcement" TO encova_app;
  CREATE POLICY encova_server_access ON "Announcement" TO encova_app USING(true) WITH CHECK(true);
 END IF;
END $$;
