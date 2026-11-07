-- Additive invitation management metadata; preserve existing tokens/history.
ALTER TABLE "Invitation" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_version_positive" CHECK ("version" > 0);
ALTER TABLE "Outbox" ADD COLUMN "canceledAt" TIMESTAMPTZ, ADD COLUMN "invitationId" UUID;
-- Link pre-existing invitation emails without assuming every outbox entry is one.
UPDATE "Outbox" AS o SET "invitationId" = i.id
FROM "Invitation" AS i WHERE o."eventKey" = 'invite:' || i.id::text;
CREATE INDEX "Outbox_invitationId_createdAt_idx" ON "Outbox"("invitationId", "createdAt");
ALTER TABLE "Outbox" ADD CONSTRAINT "Outbox_invitationId_fkey"
 FOREIGN KEY ("invitationId") REFERENCES "Invitation"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
