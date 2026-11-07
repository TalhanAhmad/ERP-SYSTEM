-- Additive cutover fields: existing local auth identities and domain records are preserved.
ALTER TABLE "Person" ADD COLUMN "supabaseUserId" UUID;
CREATE UNIQUE INDEX "Person_supabaseUserId_key" ON "Person"("supabaseUserId");
ALTER TABLE "Invitation" ADD COLUMN "provisioningStatus" TEXT NOT NULL DEFAULT 'PENDING', ADD COLUMN "provisioningAttemptId" UUID, ADD COLUMN "provisioningLeaseUntil" TIMESTAMPTZ;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_provisioning_status" CHECK ("provisioningStatus" IN ('PENDING','PROVISIONING','COMPLETE'));
