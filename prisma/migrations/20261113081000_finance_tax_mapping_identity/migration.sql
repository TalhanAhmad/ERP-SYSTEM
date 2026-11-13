BEGIN;
-- Input recoverable and output liability controls must be separate identities.
ALTER TABLE "FinanceTaxCode" ADD CONSTRAINT "FinanceTaxCode_distinct_controls" CHECK("inputAccountId"<>"outputAccountId");
COMMIT;
