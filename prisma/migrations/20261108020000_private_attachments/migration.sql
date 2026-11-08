CREATE TABLE "Attachment" (
 "id" UUID NOT NULL, "taskId" UUID NOT NULL, "uploaderId" UUID NOT NULL,
 "submissionId" UUID, "fileName" TEXT NOT NULL, "mimeType" TEXT NOT NULL,
 "byteSize" INTEGER NOT NULL, "sha256" TEXT NOT NULL, "storageKey" TEXT NOT NULL,
 "uploadKey" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
 "attemptId" UUID, "leaseUntil" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ NOT NULL, CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "Attachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "Attachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "Person"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "Attachment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "Attachment_size" CHECK ("byteSize">0 AND "byteSize"<=4194304),
 CONSTRAINT "Attachment_mime" CHECK ("mimeType" IN ('application/pdf','image/png','image/jpeg','text/plain')),
 CONSTRAINT "Attachment_sha256" CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
 CONSTRAINT "Attachment_state" CHECK (status IN ('PENDING','READY','ATTACHED','DELETING','DELETED')),
 CONSTRAINT "Attachment_submission_state" CHECK ((status='ATTACHED')=("submissionId" IS NOT NULL))
);
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");
CREATE UNIQUE INDEX "Attachment_taskId_uploaderId_uploadKey_key" ON "Attachment"("taskId","uploaderId","uploadKey");
CREATE INDEX "Attachment_taskId_status_idx" ON "Attachment"("taskId","status");
CREATE INDEX "Attachment_submissionId_idx" ON "Attachment"("submissionId");
CREATE FUNCTION protect_attachment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.status='ATTACHED' THEN RAISE EXCEPTION 'Submitted attachments are immutable'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.status='ATTACHED' THEN RAISE EXCEPTION 'Submitted attachments are immutable'; END IF;
 IF NEW.status='ATTACHED' AND NOT EXISTS(SELECT 1 FROM "Submission" s WHERE s.id=NEW."submissionId" AND s."taskId"=NEW."taskId" AND s."submittedBy"=NEW."uploaderId") THEN
  RAISE EXCEPTION 'Attachment must belong to the submission task and author';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Attachment_history" BEFORE INSERT OR UPDATE OR DELETE ON "Attachment" FOR EACH ROW EXECUTE FUNCTION protect_attachment_history();
ALTER TABLE "Attachment" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "Attachment" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "Attachment" FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON "Attachment" TO encova_app;
  CREATE POLICY encova_server_access ON "Attachment" TO encova_app USING(true) WITH CHECK(true);
 END IF;
END $$;
