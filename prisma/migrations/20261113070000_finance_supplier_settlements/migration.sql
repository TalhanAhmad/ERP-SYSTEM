BEGIN;
CREATE SEQUENCE public.finance_supplier_number AS BIGINT MINVALUE 1 MAXVALUE 9999999999 START 1 NO CYCLE;
CREATE TABLE "FinanceSupplierDocument" (
 id UUID PRIMARY KEY,number TEXT NOT NULL UNIQUE DEFAULT('PAY-'||lpad(nextval('public.finance_supplier_number'::regclass)::text,10,'0')) CHECK(number~'^PAY-[0-9]{10}$'),kind TEXT NOT NULL CHECK(kind='PAYMENT'),
 reference TEXT NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 80),"partyId" UUID NOT NULL REFERENCES "FinanceParty" ON DELETE RESTRICT,"cashAccountId" UUID REFERENCES "FinanceCashAccount" ON DELETE RESTRICT,"feeAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,"projectId" UUID REFERENCES "Project" ON DELETE RESTRICT,
 "documentDate" DATE NOT NULL CHECK("documentDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),"postingDate" DATE NOT NULL CHECK("postingDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' AND "postingDate">="documentDate"),
 description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 1000),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','POSTED','VOIDED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "cashAmount" NUMERIC(20,2) NOT NULL CHECK("cashAmount">0),"feeAmount" NUMERIC(20,2) NOT NULL CHECK("feeAmount">=0),"allocationAmount" NUMERIC(20,2) NOT NULL CHECK("allocationAmount">0),"totalAmount" NUMERIC(20,2) NOT NULL CHECK("totalAmount"="cashAmount"+"feeAmount" AND "totalAmount"="allocationAmount"),CHECK(("feeAmount">0)=("feeAccountId" IS NOT NULL)),CHECK("cashAccountId" IS NOT NULL),
 "partySnapshot" JSONB,"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FinanceSupplierDocument_kind_postingDate_id_idx" ON "FinanceSupplierDocument"(kind,"postingDate",id);
CREATE TABLE "FinanceSupplierAllocation"(id UUID PRIMARY KEY,"documentId" UUID NOT NULL REFERENCES "FinanceSupplierDocument" ON DELETE RESTRICT,"billId" UUID NOT NULL REFERENCES "FinanceBill" ON DELETE RESTRICT,sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 100),amount NUMERIC(20,2) NOT NULL CHECK(amount>0),UNIQUE("documentId","billId"),UNIQUE("documentId",sequence));
ALTER TABLE "FinanceSupplierDocument" ADD COLUMN "sourceDocumentId" UUID REFERENCES "FinanceSupplierDocument" ON DELETE RESTRICT,ADD COLUMN "advanceAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,ADD COLUMN "advanceAmount" NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK("advanceAmount">=0);
ALTER TABLE "FinanceSupplierDocument" DROP CONSTRAINT "FinanceSupplierDocument_number_check",DROP CONSTRAINT "FinanceSupplierDocument_kind_check",DROP CONSTRAINT "FinanceSupplierDocument_cashAmount_check",DROP CONSTRAINT "FinanceSupplierDocument_allocationAmount_check",DROP CONSTRAINT "FinanceSupplierDocument_check1",DROP CONSTRAINT "FinanceSupplierDocument_cashAccountId_check";
ALTER TABLE "FinanceSupplierDocument" ADD CONSTRAINT "FinanceSupplierDocument_kind_check" CHECK(kind IN('PAYMENT','ADVANCE_APPLICATION')),ADD CONSTRAINT "FinanceSupplierDocument_number_kind" CHECK((kind='PAYMENT' AND number~'^PAY-[0-9]{10}$') OR(kind='ADVANCE_APPLICATION' AND number~'^SAP-[0-9]{10}$')),ADD CONSTRAINT "FinanceSupplierDocument_amounts" CHECK("cashAmount">=0 AND "allocationAmount">=0 AND "totalAmount">0),ADD CONSTRAINT "FinanceSupplierDocument_commercial_source" CHECK(
 (kind='PAYMENT' AND "cashAmount">0 AND "cashAccountId" IS NOT NULL AND "sourceDocumentId" IS NULL AND "totalAmount"="cashAmount"+"feeAmount" AND "totalAmount"="allocationAmount"+"advanceAmount" AND ("advanceAmount">0)=("advanceAccountId" IS NOT NULL)) OR
 (kind='ADVANCE_APPLICATION' AND "cashAmount"=0 AND "feeAmount"=0 AND "cashAccountId" IS NULL AND "sourceDocumentId" IS NOT NULL AND "sourceDocumentId"<>id AND "advanceAccountId" IS NOT NULL AND "advanceAmount"=0 AND "allocationAmount">0 AND "totalAmount"="allocationAmount"));
CREATE TABLE "FinanceSupplierBalanceEvent"(id UUID PRIMARY KEY,"documentId" UUID NOT NULL UNIQUE REFERENCES "FinanceSupplierDocument" ON DELETE RESTRICT,"sourceDocumentId" UUID NOT NULL REFERENCES "FinanceSupplierDocument" ON DELETE RESTRICT,"partyId" UUID NOT NULL REFERENCES "FinanceParty" ON DELETE RESTRICT,"accountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,"journalId" UUID NOT NULL REFERENCES "FinanceJournalEntry" ON DELETE RESTRICT,"effectiveDate" DATE NOT NULL,kind TEXT NOT NULL,amount NUMERIC(20,2) NOT NULL,currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),CHECK((kind='RECEIVED' AND amount>0) OR(kind='APPLIED' AND amount<0)));
CREATE INDEX "FinanceSupplierBalanceEvent_sourceDocumentId_effectiveDate_id_idx" ON "FinanceSupplierBalanceEvent"("sourceDocumentId","effectiveDate",id);
ALTER TABLE "FinanceSupplierDocument" ADD COLUMN "creditBillId" UUID REFERENCES "FinanceBill" ON DELETE RESTRICT,ADD COLUMN "reversalOfId" UUID UNIQUE REFERENCES "FinanceSupplierDocument" ON DELETE RESTRICT,ADD COLUMN "unallocationOfId" UUID UNIQUE REFERENCES "FinanceSupplierDocument" ON DELETE RESTRICT;
ALTER TABLE "FinanceSupplierDocument" DROP CONSTRAINT "FinanceSupplierDocument_kind_check",DROP CONSTRAINT "FinanceSupplierDocument_number_kind",DROP CONSTRAINT "FinanceSupplierDocument_commercial_source";
ALTER TABLE "FinanceSupplierDocument" ADD CONSTRAINT "FinanceSupplierDocument_kind_check" CHECK(kind IN('PAYMENT','ADVANCE_APPLICATION','SUPPLIER_CREDIT','SUPPLIER_REFUND','UNALLOCATION','REVERSAL')),ADD CONSTRAINT "FinanceSupplierDocument_number_kind" CHECK(number~'^(PAY|SAP|SCN|SRF|UAL|REV)-[0-9]{10}$' AND split_part(number,'-',1)=CASE kind WHEN 'PAYMENT' THEN 'PAY' WHEN 'ADVANCE_APPLICATION' THEN 'SAP' WHEN 'SUPPLIER_CREDIT' THEN 'SCN' WHEN 'SUPPLIER_REFUND' THEN 'SRF' WHEN 'UNALLOCATION' THEN 'UAL' ELSE 'REV' END),ADD CONSTRAINT "FinanceSupplierDocument_commercial_source" CHECK(
 (kind='PAYMENT' AND "cashAmount">0 AND "cashAccountId" IS NOT NULL AND "sourceDocumentId" IS NULL AND "totalAmount"="cashAmount"+"feeAmount" AND "totalAmount"="allocationAmount"+"advanceAmount" AND ("advanceAmount">0)=("advanceAccountId" IS NOT NULL) AND "creditBillId" IS NULL AND "reversalOfId" IS NULL AND "unallocationOfId" IS NULL) OR
 (kind='ADVANCE_APPLICATION' AND "cashAmount"=0 AND "feeAmount"=0 AND "cashAccountId" IS NULL AND "sourceDocumentId" IS NOT NULL AND "sourceDocumentId"<>id AND "advanceAccountId" IS NOT NULL AND "advanceAmount"=0 AND "allocationAmount">0 AND "totalAmount"="allocationAmount" AND "creditBillId" IS NULL AND "reversalOfId" IS NULL AND "unallocationOfId" IS NULL) OR
 (kind='SUPPLIER_CREDIT' AND "cashAmount"=0 AND "feeAmount"=0 AND "cashAccountId" IS NULL AND "sourceDocumentId" IS NULL AND "creditBillId" IS NOT NULL AND "advanceAccountId" IS NOT NULL AND "advanceAmount"=0 AND "allocationAmount"=0 AND "reversalOfId" IS NULL AND "unallocationOfId" IS NULL) OR
 (kind='SUPPLIER_REFUND' AND "cashAmount">0 AND "totalAmount"="cashAmount" AND "feeAmount"=0 AND "cashAccountId" IS NOT NULL AND "sourceDocumentId" IS NOT NULL AND "sourceDocumentId"<>id AND "advanceAccountId" IS NOT NULL AND "advanceAmount"=0 AND "allocationAmount"=0 AND "creditBillId" IS NULL AND "reversalOfId" IS NULL AND "unallocationOfId" IS NULL) OR
 (kind='UNALLOCATION' AND "cashAmount"=0 AND "feeAmount"=0 AND "cashAccountId" IS NULL AND "sourceDocumentId"="unallocationOfId" AND "unallocationOfId" IS NOT NULL AND "unallocationOfId"<>id AND "advanceAccountId" IS NOT NULL AND "totalAmount"="allocationAmount" AND "totalAmount"="advanceAmount" AND "creditBillId" IS NULL AND "reversalOfId" IS NULL) OR
 (kind='REVERSAL' AND "reversalOfId" IS NOT NULL AND "reversalOfId"<>id AND "unallocationOfId" IS NULL));
CREATE TABLE "FinanceSupplierCreditLine"(id UUID PRIMARY KEY,"documentId" UUID NOT NULL REFERENCES "FinanceSupplierDocument" ON DELETE RESTRICT,"billLineId" UUID NOT NULL REFERENCES "FinanceBillLine" ON DELETE RESTRICT,sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 100),amount NUMERIC(20,2) NOT NULL CHECK(amount>0),UNIQUE("documentId","billLineId"),UNIQUE("documentId",sequence));
CREATE TABLE "FinanceSupplierCreditSplit"("documentId" UUID PRIMARY KEY REFERENCES "FinanceSupplierDocument" ON DELETE RESTRICT,"arAmount" NUMERIC(20,2) NOT NULL CHECK("arAmount">=0),"balanceAmount" NUMERIC(20,2) NOT NULL CHECK("balanceAmount">=0),CHECK("arAmount"+"balanceAmount">0));
CREATE TABLE "FinanceBillCreditEvent"(id UUID PRIMARY KEY,"billLineId" UUID NOT NULL REFERENCES "FinanceBillLine" ON DELETE RESTRICT,"supplierDocumentId" UUID NOT NULL REFERENCES "FinanceSupplierDocument" ON DELETE RESTRICT,"journalId" UUID NOT NULL REFERENCES "FinanceJournalEntry" ON DELETE RESTRICT,"effectiveDate" DATE NOT NULL,kind TEXT NOT NULL,amount NUMERIC(20,2) NOT NULL,currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),CHECK((kind='SUPPLIER_CREDIT' AND amount<0) OR(kind='REVERSAL' AND amount>0)),UNIQUE("supplierDocumentId","billLineId"));
CREATE INDEX "FinanceBillCreditEvent_billLineId_effectiveDate_id_idx" ON "FinanceBillCreditEvent"("billLineId","effectiveDate",id);
ALTER TABLE "FinancePayableEvent" ADD COLUMN "supplierDocumentId" UUID REFERENCES "FinanceSupplierDocument" ON DELETE RESTRICT;
ALTER TABLE "FinancePayableEvent" DROP CONSTRAINT "FinancePayableEvent_kind_check",DROP CONSTRAINT "FinancePayableEvent_amount_check";
ALTER TABLE "FinanceJournalEntry" ADD COLUMN "supplierDocumentId" UUID UNIQUE REFERENCES "FinanceSupplierDocument" ON DELETE RESTRICT;
DO $$ DECLARE old_check TEXT;BEGIN SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint WHERE conrelid='public."FinanceJournalEntry"'::regclass AND conname='FinanceJournalEntry_source_identity';ALTER TABLE "FinanceJournalEntry" DROP CONSTRAINT "FinanceJournalEntry_source_identity";EXECUTE 'ALTER TABLE public."FinanceJournalEntry" ADD CONSTRAINT "FinanceJournalEntry_source_identity" CHECK(('||substr(old_check,8,length(old_check)-8)||' AND "supplierDocumentId" IS NULL) OR("sourceType"=''SUPPLIER_DOCUMENT'' AND "sourceAction"=''POST'' AND "supplierDocumentId"="sourceId" AND "supplierDocumentId" IS NOT NULL AND "billId" IS NULL AND "invoiceId" IS NULL AND "customerDocumentId" IS NULL AND "draftId" IS NULL AND "reversalOfId" IS NULL))';END $$;
ALTER TABLE "FinancePayableEvent" ADD CONSTRAINT "FinancePayableEvent_source_kind" CHECK((kind='BILL' AND amount>0 AND "supplierDocumentId" IS NULL) OR(kind IN('PAYMENT','ADVANCE_APPLICATION','SUPPLIER_CREDIT') AND amount<0 AND "supplierDocumentId" IS NOT NULL) OR(kind='UNALLOCATION' AND amount>0 AND "supplierDocumentId" IS NOT NULL) OR(kind='REVERSAL' AND amount<>0 AND "supplierDocumentId" IS NOT NULL));
ALTER TABLE "FinanceSupplierBalanceEvent" DROP CONSTRAINT "FinanceSupplierBalanceEvent_check";
ALTER TABLE "FinanceSupplierBalanceEvent" ADD CONSTRAINT "FinanceSupplierBalanceEvent_source_kind" CHECK((kind IN('RECEIVED','CREDITED','RELEASED') AND amount>0) OR(kind IN('APPLIED','REFUNDED') AND amount<0) OR(kind='REVERSAL' AND amount<>0));
CREATE OR REPLACE FUNCTION encova_finance_supplier_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN IF NEW.state<>'DRAFT' OR NEW.version<>1 OR NEW."partySnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;RETURN NEW;END IF;
 IF OLD.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF ROW(NEW.id,NEW.number,NEW.kind,NEW."createdById",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD.number,OLD.kind,OLD."createdById",OLD."createdAt") OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
 IF NEW.state<>'DRAFT' AND (to_jsonb(NEW)-ARRAY['state','version','updatedAt','partySnapshot']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','updatedAt','partySnapshot']) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW.state='POSTED' THEN IF NEW."partySnapshot" IS DISTINCT FROM public.encova_finance_party_snapshot(NEW."partyId") OR NOT EXISTS(SELECT 1 FROM public."FinanceJournalEntry" WHERE "supplierDocumentId"=NEW.id) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF NEW."partySnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_supplier_allocation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;s TEXT;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.id,NEW."documentId") IS DISTINCT FROM ROW(OLD.id,OLD."documentId") THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 target:=CASE WHEN TG_OP='DELETE' THEN OLD."documentId" ELSE NEW."documentId" END;
 SELECT state INTO s FROM public."FinanceSupplierDocument" WHERE id=target FOR UPDATE;
 IF s IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_ap_capacity(target UUID,cutoff DATE) RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(min((SELECT coalesce(sum(e.amount),0) FROM public."FinancePayableEvent" e WHERE e."billId"=target AND e."effectiveDate"<=dates.d)),0) FROM(SELECT cutoff AS d UNION SELECT "effectiveDate" FROM public."FinancePayableEvent" WHERE "billId"=target AND "effectiveDate">=cutoff)dates
$$;
CREATE OR REPLACE FUNCTION encova_finance_supplier_capacity(target UUID,cutoff DATE) RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(min((SELECT coalesce(sum(e.amount),0) FROM public."FinanceSupplierBalanceEvent" e WHERE e."sourceDocumentId"=target AND e."effectiveDate"<=dates.d)),0) FROM(SELECT cutoff AS d UNION SELECT "effectiveDate" FROM public."FinanceSupplierBalanceEvent" WHERE "sourceDocumentId"=target AND "effectiveDate">=cutoff)dates
$$;
CREATE OR REPLACE FUNCTION encova_finance_supplier_credit_capacity(target UUID,cutoff DATE) RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(min(l."totalAmount"+(SELECT coalesce(sum(e.amount),0) FROM public."FinanceBillCreditEvent" e WHERE e."billLineId"=target AND e."effectiveDate"<=dates.d)),0) FROM public."FinanceBillLine" l CROSS JOIN(SELECT cutoff AS d UNION SELECT "effectiveDate" FROM public."FinanceBillCreditEvent" WHERE "billLineId"=target AND "effectiveDate">=cutoff)dates WHERE l.id=target
$$;
CREATE OR REPLACE FUNCTION encova_finance_supplier_ar(target UUID) RETURNS TABLE("billId" UUID,amount NUMERIC) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT a."billId",CASE WHEN d.kind='UNALLOCATION' THEN a.amount ELSE -a.amount END FROM public."FinanceSupplierDocument" d JOIN public."FinanceSupplierAllocation" a ON a."documentId"=d.id WHERE d.id=target AND d.kind IN('PAYMENT','ADVANCE_APPLICATION','UNALLOCATION')
 UNION ALL SELECT d."creditBillId",-s."arAmount" FROM public."FinanceSupplierDocument" d JOIN public."FinanceSupplierCreditSplit" s ON s."documentId"=d.id WHERE d.id=target AND d.kind='SUPPLIER_CREDIT' AND s."arAmount">0
 UNION ALL SELECT v."billId",-v.amount FROM public."FinanceSupplierDocument" d JOIN public."FinancePayableEvent" v ON v."supplierDocumentId"=d."reversalOfId" WHERE d.id=target AND d.kind='REVERSAL'
$$;
CREATE OR REPLACE FUNCTION encova_finance_supplier_fund(target UUID) RETURNS TABLE("sourceDocumentId" UUID,"accountId" UUID,amount NUMERIC,kind TEXT) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT d.id,d."advanceAccountId",d."advanceAmount",'RECEIVED'::text FROM public."FinanceSupplierDocument" d WHERE d.id=target AND d.kind='PAYMENT' AND d."advanceAmount">0
 UNION ALL SELECT d."sourceDocumentId",d."advanceAccountId",-d."totalAmount",'APPLIED'::text FROM public."FinanceSupplierDocument" d WHERE d.id=target AND d.kind='ADVANCE_APPLICATION'
 UNION ALL SELECT d.id,d."advanceAccountId",s."balanceAmount",'CREDITED'::text FROM public."FinanceSupplierDocument" d JOIN public."FinanceSupplierCreditSplit" s ON s."documentId"=d.id WHERE d.id=target AND d.kind='SUPPLIER_CREDIT' AND s."balanceAmount">0
 UNION ALL SELECT d."sourceDocumentId",d."advanceAccountId",-d."cashAmount",'REFUNDED'::text FROM public."FinanceSupplierDocument" d WHERE d.id=target AND d.kind='SUPPLIER_REFUND'
 UNION ALL SELECT d.id,d."advanceAccountId",d."totalAmount",'RELEASED'::text FROM public."FinanceSupplierDocument" d WHERE d.id=target AND d.kind='UNALLOCATION'
 UNION ALL SELECT b."sourceDocumentId",b."accountId",-b.amount,'REVERSAL'::text FROM public."FinanceSupplierDocument" d JOIN public."FinanceSupplierBalanceEvent" b ON b."documentId"=d."reversalOfId" WHERE d.id=target AND d.kind='REVERSAL'
$$;
CREATE OR REPLACE FUNCTION encova_finance_supplier_credits(target UUID) RETURNS TABLE("billLineId" UUID,amount NUMERIC) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT c."billLineId",-c.amount FROM public."FinanceSupplierDocument" d JOIN public."FinanceSupplierCreditLine" c ON c."documentId"=d.id WHERE d.id=target AND d.kind='SUPPLIER_CREDIT'
 UNION ALL SELECT e."billLineId",-e.amount FROM public."FinanceSupplierDocument" d JOIN public."FinanceBillCreditEvent" e ON e."supplierDocumentId"=d."reversalOfId" WHERE d.id=target AND d.kind='REVERSAL'
$$;
CREATE OR REPLACE FUNCTION encova_finance_supplier_lines(target UUID) RETURNS TABLE(sequence INTEGER,"accountId" UUID,description TEXT,debit NUMERIC,credit NUMERIC,"projectId" UUID,"partyId" UUID,"billLineId" UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT 1,c."glAccountId",d.description,0::numeric,d."cashAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d JOIN public."FinanceCashAccount" c ON c.id=d."cashAccountId" WHERE d.id=target AND d.kind='PAYMENT'
 UNION ALL SELECT 2,d."feeAccountId",d.description,0::numeric,d."feeAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d WHERE d.id=target AND d.kind='PAYMENT' AND d."feeAmount">0
 UNION ALL SELECT 10+a.sequence,i."payableAccountId",d.description,a.amount,0::numeric,i."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d JOIN public."FinanceSupplierAllocation" a ON a."documentId"=d.id JOIN public."FinanceBill" i ON i.id=a."billId" WHERE d.id=target AND d.kind IN('PAYMENT','ADVANCE_APPLICATION')
 UNION ALL SELECT 150,d."advanceAccountId",d.description,d."advanceAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d WHERE d.id=target AND d.kind='PAYMENT' AND d."advanceAmount">0
 UNION ALL SELECT 1,d."advanceAccountId",d.description,0::numeric,d."totalAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d WHERE d.id=target AND d.kind IN('ADVANCE_APPLICATION','SUPPLIER_REFUND')
 UNION ALL SELECT 2,c."glAccountId",d.description,d."cashAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d JOIN public."FinanceCashAccount" c ON c.id=d."cashAccountId" WHERE d.id=target AND d.kind='SUPPLIER_REFUND'
 UNION ALL SELECT 10+c.sequence,l."costAccountId",l.description,0::numeric,c.amount,l."projectId",d."partyId",l.id FROM public."FinanceSupplierDocument" d JOIN public."FinanceSupplierCreditLine" c ON c."documentId"=d.id JOIN public."FinanceBillLine" l ON l.id=c."billLineId" WHERE d.id=target AND d.kind='SUPPLIER_CREDIT'
 UNION ALL SELECT 1,i."payableAccountId",d.description,s."arAmount",0::numeric,i."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d JOIN public."FinanceSupplierCreditSplit" s ON s."documentId"=d.id JOIN public."FinanceBill" i ON i.id=d."creditBillId" WHERE d.id=target AND d.kind='SUPPLIER_CREDIT' AND s."arAmount">0
 UNION ALL SELECT 2,d."advanceAccountId",d.description,s."balanceAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d JOIN public."FinanceSupplierCreditSplit" s ON s."documentId"=d.id WHERE d.id=target AND d.kind='SUPPLIER_CREDIT' AND s."balanceAmount">0
 UNION ALL SELECT 10+a.sequence,i."payableAccountId",d.description,0::numeric,a.amount,i."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d JOIN public."FinanceSupplierAllocation" a ON a."documentId"=d.id JOIN public."FinanceBill" i ON i.id=a."billId" WHERE d.id=target AND d.kind='UNALLOCATION'
 UNION ALL SELECT 1,d."advanceAccountId",d.description,d."totalAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d WHERE d.id=target AND d.kind='UNALLOCATION'
 UNION ALL SELECT l.sequence,l."accountId",l.description,l.credit,l.debit,l."projectId",l."partyId",l."billLineId" FROM public."FinanceSupplierDocument" d JOIN public."FinanceJournalEntry" e ON e."supplierDocumentId"=d."reversalOfId" JOIN public."FinanceJournalLine" l ON l."journalId"=e.id WHERE d.id=target AND d.kind='REVERSAL'

$$;
CREATE OR REPLACE FUNCTION encova_finance_supplier_validate(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceSupplierDocument"%ROWTYPE;origin public."FinanceSupplierDocument"%ROWTYPE;inv public."FinanceBill"%ROWTYPE;allocation_row record;line_row record;event_row record;ar NUMERIC;
BEGIN
 SELECT * INTO d FROM public."FinanceSupplierDocument" WHERE id=target;
 IF d.id IS NULL OR d.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=d."partyId" AND kind IN('SUPPLIER','BOTH','EMPLOYEE')) THEN RAISE EXCEPTION 'FINANCE_BILL_PARTY' USING ERRCODE='P0001';END IF;
 IF d."advanceAccountId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."advanceAccountId" AND active AND "isPosting" AND NOT "isContra" AND "controlType"='SUPPLIER_ADVANCE' AND type='ASSET' AND currency='PKR') THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_MAPPING' USING ERRCODE='P0001';END IF;
 IF d.kind IN('PAYMENT','SUPPLIER_REFUND') THEN
  IF NOT EXISTS(SELECT 1 FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" gl ON gl.id=c."glAccountId" WHERE c.id=d."cashAccountId" AND c.active AND gl.active AND gl."isPosting" AND NOT gl."isContra" AND gl."controlType"='CASH' AND gl.type='ASSET' AND gl.currency='PKR' AND c.currency='PKR') THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_MAPPING' USING ERRCODE='P0001';END IF;
 END IF;
 IF d.kind='PAYMENT' THEN
  IF d."feeAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."feeAccountId" AND active AND "isPosting" AND NOT "isContra" AND "controlType"='NONE' AND type IN('DIRECT_COST','OPERATING_EXPENSE','OTHER_EXPENSE') AND currency='PKR') THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_MAPPING' USING ERRCODE='P0001';END IF;
  IF d."advanceAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=d."partyId" AND active) THEN RAISE EXCEPTION 'FINANCE_BILL_PARTY' USING ERRCODE='P0001';END IF;
 ELSIF d.kind IN('ADVANCE_APPLICATION','SUPPLIER_REFUND') THEN
  SELECT * INTO origin FROM public."FinanceSupplierDocument" WHERE id=d."sourceDocumentId";
  IF origin.id IS NULL OR origin.kind NOT IN('PAYMENT','SUPPLIER_CREDIT','UNALLOCATION') OR origin.state<>'POSTED' OR EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE "reversalOfId"=origin.id) OR origin."partyId"<>d."partyId" OR origin."advanceAccountId" IS DISTINCT FROM d."advanceAccountId" OR origin."postingDate">d."documentDate" OR d."totalAmount">public.encova_finance_supplier_capacity(origin.id,d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ADVANCE_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='SUPPLIER_CREDIT' THEN
  SELECT * INTO inv FROM public."FinanceBill" WHERE id=d."creditBillId";
  IF inv.id IS NULL OR inv.state<>'POSTED' OR inv."partyId"<>d."partyId" OR inv.currency<>d.currency OR inv."postingDate">d."documentDate" THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  FOR line_row IN SELECT c.amount,l.* FROM public."FinanceSupplierCreditLine" c JOIN public."FinanceBillLine" l ON l.id=c."billLineId" WHERE c."documentId"=target LOOP
   IF line_row."billId"<>inv.id OR line_row.amount>public.encova_finance_supplier_credit_capacity(line_row.id,d."postingDate") THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  END LOOP;
  SELECT least(d."totalAmount",coalesce(sum(amount),0)) INTO ar FROM public."FinancePayableEvent" WHERE "billId"=inv.id AND "effectiveDate"<=d."postingDate";
  IF ar<0 OR ar>public.encova_finance_ap_capacity(inv.id,d."postingDate") THEN RAISE EXCEPTION 'FINANCE_SETTLEMENT_ORDER' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinanceSupplierCreditSplit"("documentId","arAmount","balanceAmount") VALUES(d.id,ar,d."totalAmount"-ar);
 ELSIF d.kind='UNALLOCATION' THEN
  SELECT * INTO origin FROM public."FinanceSupplierDocument" WHERE id=d."unallocationOfId";
  IF origin.id IS NULL OR origin.kind<>'PAYMENT' OR origin.state<>'POSTED' OR origin."partyId"<>d."partyId" OR origin."postingDate">d."postingDate" OR origin."allocationAmount"<=0 OR EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE "reversalOfId"=origin.id) THEN RAISE EXCEPTION 'FINANCE_SETTLEMENT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='REVERSAL' THEN
  SELECT * INTO origin FROM public."FinanceSupplierDocument" WHERE id=d."reversalOfId";
  IF origin.id IS NULL OR origin.kind='REVERSAL' OR origin.state<>'POSTED' OR origin."postingDate">d."postingDate" OR EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE "reversalOfId"=origin.id AND id<>target) OR EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" u WHERE u."unallocationOfId"=origin.id AND NOT EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" undo WHERE undo."reversalOfId"=u.id)) THEN RAISE EXCEPTION 'FINANCE_SETTLEMENT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  FOR event_row IN SELECT b.* FROM public."FinanceSupplierBalanceEvent" b WHERE b."documentId"=origin.id AND b.amount>0 LOOP
   IF event_row.amount>public.encova_finance_supplier_capacity(event_row."sourceDocumentId",d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ADVANCE_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  END LOOP;
  FOR event_row IN SELECT v.* FROM public."FinancePayableEvent" v WHERE v."supplierDocumentId"=origin.id AND v.amount>0 LOOP
   IF event_row.amount>public.encova_finance_ap_capacity(event_row."billId",d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  END LOOP;
 END IF;
 IF d.kind IN('PAYMENT','ADVANCE_APPLICATION') THEN
  FOR allocation_row IN SELECT x.*,i.state,i."partyId",i.currency,i."postingDate" FROM public."FinanceSupplierAllocation" x JOIN public."FinanceBill" i ON i.id=x."billId" WHERE x."documentId"=target ORDER BY x."billId" LOOP
   IF allocation_row.state<>'POSTED' OR allocation_row."partyId"<>d."partyId" OR allocation_row.currency<>d.currency OR allocation_row."postingDate">d."postingDate" OR allocation_row.amount>public.encova_finance_ap_capacity(allocation_row."billId",d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  END LOOP;
 END IF;
 IF d."projectId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Project" WHERE id=d."projectId" AND "archivedAt" IS NULL) AND NOT EXISTS(SELECT 1 FROM public."FinanceSupplierAllocation" x JOIN public."FinanceBill" i ON i.id=x."billId" WHERE x."documentId"=target AND i."projectId"=d."projectId") AND NOT EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE id=coalesce(d."sourceDocumentId",d."reversalOfId") AND "projectId"=d."projectId") AND NOT EXISTS(SELECT 1 FROM public."FinanceBill" WHERE id=d."creditBillId" AND "projectId"=d."projectId") THEN RAISE EXCEPTION 'FINANCE_PROJECT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_check_supplier(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceSupplierDocument"%ROWTYPE;origin public."FinanceSupplierDocument"%ROWTYPE;e public."FinanceJournalEntry"%ROWTYPE;s public."FinanceSupplierCreditSplit"%ROWTYPE;n_alloc BIGINT;n_credit BIGINT;alloc_sum NUMERIC;credit_sum NUMERIC;expected_ar NUMERIC;
BEGIN
 SELECT * INTO d FROM public."FinanceSupplierDocument" WHERE id=target;
 IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 SELECT count(*),coalesce(sum(x.amount),0) INTO n_alloc,alloc_sum FROM public."FinanceSupplierAllocation" x WHERE x."documentId"=target;
 SELECT count(*),coalesce(sum(x.amount),0) INTO n_credit,credit_sum FROM public."FinanceSupplierCreditLine" x WHERE x."documentId"=target;
 IF (d.kind IN('PAYMENT','ADVANCE_APPLICATION','UNALLOCATION') AND (n_alloc NOT BETWEEN 0 AND 100 OR (d.kind<>'PAYMENT' AND n_alloc=0) OR alloc_sum<>d."allocationAmount" OR n_credit<>0)) OR (d.kind='SUPPLIER_CREDIT' AND (n_alloc<>0 OR n_credit NOT BETWEEN 1 AND 100 OR credit_sum<>d."totalAmount" OR EXISTS(SELECT 1 FROM public."FinanceSupplierCreditLine" c JOIN public."FinanceBillLine" l ON l.id=c."billLineId" WHERE c."documentId"=target AND l."billId"<>d."creditBillId"))) OR (d.kind IN('SUPPLIER_REFUND','REVERSAL') AND (n_alloc<>0 OR n_credit<>0)) THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_TOTALS' USING ERRCODE='P0001';END IF;
 SELECT * INTO e FROM public."FinanceJournalEntry" WHERE "supplierDocumentId"=target;
 IF d.state<>'POSTED' THEN
  IF e.id IS NOT NULL OR EXISTS(SELECT 1 FROM public."FinancePayableEvent" WHERE "supplierDocumentId"=target) OR EXISTS(SELECT 1 FROM public."FinanceSupplierBalanceEvent" WHERE "documentId"=target) OR EXISTS(SELECT 1 FROM public."FinanceBillCreditEvent" WHERE "supplierDocumentId"=target) OR EXISTS(SELECT 1 FROM public."FinanceSupplierCreditSplit" WHERE "documentId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;
 END IF;
 IF e.id IS NULL OR e."sourceType"<>'SUPPLIER_DOCUMENT' OR e."postingDate"<>d."postingDate" OR e.description<>d.description OR e.evidence<>d.evidence OR d."partySnapshot" IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF d.kind='REVERSAL' THEN
  SELECT * INTO origin FROM public."FinanceSupplierDocument" WHERE id=d."reversalOfId";
  IF origin.id IS NULL OR origin.state<>'POSTED' OR origin.kind='REVERSAL' OR origin."postingDate">d."postingDate" OR ROW(d."partyId",d."projectId",d."cashAccountId",d."feeAccountId",d."advanceAccountId",d."sourceDocumentId",d."creditBillId",d."cashAmount",d."feeAmount",d."allocationAmount",d."advanceAmount",d."totalAmount") IS DISTINCT FROM ROW(origin."partyId",origin."projectId",origin."cashAccountId",origin."feeAccountId",origin."advanceAccountId",origin."sourceDocumentId",origin."creditBillId",origin."cashAmount",origin."feeAmount",origin."allocationAmount",origin."advanceAmount",origin."totalAmount") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='UNALLOCATION' THEN
  SELECT * INTO origin FROM public."FinanceSupplierDocument" WHERE id=d."unallocationOfId";
  IF origin.kind IS DISTINCT FROM 'PAYMENT' OR origin.state<>'POSTED' OR origin."partyId"<>d."partyId" OR origin."projectId" IS DISTINCT FROM d."projectId" OR origin."postingDate">d."postingDate" OR origin."allocationAmount"<>d."totalAmount" OR EXISTS((SELECT sequence,"billId",amount FROM public."FinanceSupplierAllocation" WHERE "documentId"=target) EXCEPT(SELECT sequence,"billId",amount FROM public."FinanceSupplierAllocation" WHERE "documentId"=origin.id)) OR EXISTS((SELECT sequence,"billId",amount FROM public."FinanceSupplierAllocation" WHERE "documentId"=origin.id) EXCEPT(SELECT sequence,"billId",amount FROM public."FinanceSupplierAllocation" WHERE "documentId"=target)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 END IF;
 IF d.kind='SUPPLIER_CREDIT' THEN
  SELECT * INTO s FROM public."FinanceSupplierCreditSplit" WHERE "documentId"=target;
  SELECT least(d."totalAmount",coalesce(sum(v.amount),0)) INTO expected_ar FROM public."FinancePayableEvent" v WHERE v."billId"=d."creditBillId" AND v."effectiveDate"<=d."postingDate" AND v."supplierDocumentId" IS DISTINCT FROM target;
  IF s."documentId" IS NULL OR s."arAmount"+s."balanceAmount"<>d."totalAmount" OR s."arAmount"<>expected_ar THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 ELSIF EXISTS(SELECT 1 FROM public."FinanceSupplierCreditSplit" WHERE "documentId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","billLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id) EXCEPT(SELECT * FROM public.encova_finance_supplier_lines(target))) OR EXISTS((SELECT * FROM public.encova_finance_supplier_lines(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","billLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "billId",amount FROM public."FinancePayableEvent" WHERE "supplierDocumentId"=target) EXCEPT(SELECT * FROM public.encova_finance_supplier_ar(target))) OR EXISTS((SELECT * FROM public.encova_finance_supplier_ar(target)) EXCEPT(SELECT "billId",amount FROM public."FinancePayableEvent" WHERE "supplierDocumentId"=target)) OR EXISTS(SELECT 1 FROM public."FinancePayableEvent" v JOIN public."FinanceBill" i ON i.id=v."billId" WHERE v."supplierDocumentId"=target AND(v."partyId"<>d."partyId" OR v."accountId"<>i."payableAccountId" OR v."journalId"<>e.id OR v."effectiveDate"<>d."postingDate" OR v.kind<>d.kind)) THEN RAISE EXCEPTION 'FINANCE_PAYABLE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "sourceDocumentId","accountId",amount,kind FROM public."FinanceSupplierBalanceEvent" WHERE "documentId"=target) EXCEPT(SELECT * FROM public.encova_finance_supplier_fund(target))) OR EXISTS((SELECT * FROM public.encova_finance_supplier_fund(target)) EXCEPT(SELECT "sourceDocumentId","accountId",amount,kind FROM public."FinanceSupplierBalanceEvent" WHERE "documentId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceSupplierBalanceEvent" b WHERE b."documentId"=target AND(b."partyId"<>d."partyId" OR b."journalId"<>e.id OR b."effectiveDate"<>d."postingDate")) THEN RAISE EXCEPTION 'FINANCE_CLIENT_BALANCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "billLineId",amount FROM public."FinanceBillCreditEvent" WHERE "supplierDocumentId"=target) EXCEPT(SELECT * FROM public.encova_finance_supplier_credits(target))) OR EXISTS((SELECT * FROM public.encova_finance_supplier_credits(target)) EXCEPT(SELECT "billLineId",amount FROM public."FinanceBillCreditEvent" WHERE "supplierDocumentId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceBillCreditEvent" c WHERE c."supplierDocumentId"=target AND(c."journalId"<>e.id OR c."effectiveDate"<>d."postingDate" OR c.kind<>d.kind)) THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(v.amount) OVER(PARTITION BY v."billId" ORDER BY v."effectiveDate" RANGE UNBOUNDED PRECEDING) AS balance FROM public."FinancePayableEvent" v WHERE v."billId" IN(SELECT "billId" FROM public.encova_finance_supplier_ar(target)))balances WHERE balance<0) THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(b.amount) OVER(PARTITION BY b."sourceDocumentId" ORDER BY b."effectiveDate" RANGE UNBOUNDED PRECEDING) AS balance FROM public."FinanceSupplierBalanceEvent" b WHERE b."sourceDocumentId" IN(SELECT "sourceDocumentId" FROM public.encova_finance_supplier_fund(target)))balances WHERE balance<0) THEN RAISE EXCEPTION 'FINANCE_ADVANCE_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT l."totalAmount"+sum(c.amount) OVER(PARTITION BY c."billLineId" ORDER BY c."effectiveDate" RANGE UNBOUNDED PRECEDING) AS capacity FROM public."FinanceBillCreditEvent" c JOIN public."FinanceBillLine" l ON l.id=c."billLineId" WHERE c."billLineId" IN(SELECT "billLineId" FROM public.encova_finance_supplier_credits(target)))balances WHERE capacity<0) THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_supplier_check_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;BEGIN
 IF TG_TABLE_NAME='FinanceSupplierDocument' THEN target:=NEW.id;
 ELSIF TG_OP='DELETE' THEN target:=OLD."documentId";
 ELSIF TG_TABLE_NAME IN('FinanceSupplierAllocation','FinanceSupplierCreditLine','FinanceSupplierCreditSplit','FinanceSupplierBalanceEvent') THEN target:=NEW."documentId";
 ELSE target:=NEW."supplierDocumentId";END IF;
 IF target IS NOT NULL THEN PERFORM public.encova_finance_check_supplier(target);END IF;RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_supplier_effects(actor UUID,target UUID,entry_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceSupplierDocument"%ROWTYPE;BEGIN
 SELECT * INTO d FROM public."FinanceSupplierDocument" WHERE id=target;
 INSERT INTO public."FinancePayableEvent"(id,"billId","partyId","accountId","journalId","effectiveDate",kind,amount,"supplierDocumentId") SELECT gen_random_uuid(),x."billId",d."partyId",i."payableAccountId",entry_id,d."postingDate",d.kind,x.amount,d.id FROM public.encova_finance_supplier_ar(target) x JOIN public."FinanceBill" i ON i.id=x."billId";
 INSERT INTO public."FinanceSupplierBalanceEvent"(id,"documentId","sourceDocumentId","partyId","accountId","journalId","effectiveDate",kind,amount) SELECT gen_random_uuid(),d.id,x."sourceDocumentId",d."partyId",x."accountId",entry_id,d."postingDate",x.kind,x.amount FROM public.encova_finance_supplier_fund(target) x;
 INSERT INTO public."FinanceBillCreditEvent"(id,"billLineId","supplierDocumentId","journalId","effectiveDate",kind,amount) SELECT gen_random_uuid(),x."billLineId",d.id,entry_id,d."postingDate",d.kind,x.amount FROM public.encova_finance_supplier_credits(target) x;
 IF d."advanceAccountId" IS NOT NULL THEN PERFORM public.encova_finance_mark_accounts(ARRAY[d."advanceAccountId"]);END IF;
 UPDATE public."FinanceParty" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=d."partyId";
 UPDATE public."FinanceSupplierDocument" SET state='POSTED',version=version+1,"partySnapshot"=public.encova_finance_party_snapshot("partyId"),"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_supplier_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,resource TEXT,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceSupplierDocument"%ROWTYPE;origin public."FinanceSupplierDocument"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;inv public."FinanceBill"%ROWTYPE;item JSONB;allowed TEXT[];n INTEGER:=0;alloc_sum NUMERIC:=0;credit_sum NUMERIC:=0;cash NUMERIC:=0;fee NUMERIC:=0;adv NUMERIC:=0;total NUMERIC;advance_account UUID;cash_account UUID;fee_account UUID;source_doc UUID;credit_bill UUID;project UUID;entry_id UUID;origin_id UUID;origin_version INTEGER;origin_number TEXT;digest TEXT;operation_name TEXT;reason TEXT;result JSONB;prefix TEXT;audit_id UUID;
BEGIN
 IF resource IS NULL OR resource NOT IN('PAYMENT','ADVANCE_APPLICATION','SUPPLIER_CREDIT','SUPPLIER_REFUND','UNALLOCATION') OR action IS NULL OR action NOT IN('CREATE','UPDATE','POST','VOID','REVERSE','UNALLOCATE') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR(resource='UNALLOCATION' AND action<>'REVERSE') OR(action='UNALLOCATE' AND resource<>'PAYMENT') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 reason:=trim(input->>'reason');IF jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF action IN('CREATE','UPDATE') THEN
  allowed:=ARRAY['reference','partyId','projectId','documentDate','postingDate','description','evidence','currency','reason'];
  allowed:=allowed||(CASE resource WHEN 'PAYMENT' THEN ARRAY['cashAccountId','feeAccountId','advanceAccountId','cashAmount','feeAmount','allocations'] WHEN 'ADVANCE_APPLICATION' THEN ARRAY['sourceDocumentId','allocations'] WHEN 'SUPPLIER_CREDIT' THEN ARRAY['billId','advanceAccountId','creditLines'] ELSE ARRAY['sourceDocumentId','cashAccountId','cashAmount'] END);
  IF action='UPDATE' THEN allowed:=allowed||ARRAY['id','expectedVersion'];END IF;
 ELSE allowed:=ARRAY['id','expectedVersion','reason'];IF action IN('REVERSE','UNALLOCATE') THEN allowed:=allowed||ARRAY['postingDate'];END IF;IF action='UNALLOCATE' THEN allowed:=allowed||ARRAY['advanceAccountId'];END IF;END IF;
 IF input-allowed<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF action<>'CREATE' AND(jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR(input->>'expectedVersion')::integer<1) THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 operation_name:='SUPPLIER_'||resource||'_'||action;digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');SELECT * INTO r FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation=operation_name AND key=request_key;
 IF FOUND THEN IF r."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN r.result;END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action<>'CREATE' THEN
  SELECT * INTO d FROM public."FinanceSupplierDocument" WHERE id=(input->>'id')::uuid AND kind=resource FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF d.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF (action IN('REVERSE','UNALLOCATE') AND d.state<>'POSTED') OR(action NOT IN('REVERSE','UNALLOCATE') AND d.state<>'DRAFT') THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 END IF;
 IF action IN('REVERSE','UNALLOCATE') THEN
  IF jsonb_typeof(input->'postingDate') IS DISTINCT FROM 'string' OR input->>'postingDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE "reversalOfId"=d.id) THEN RAISE EXCEPTION 'FINANCE_SETTLEMENT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  origin:=d;origin_id:=d.id;origin_version:=d.version;origin_number:=d.number;
  IF action='REVERSE' THEN
   INSERT INTO public."FinanceSupplierDocument"(id,number,kind,reference,"partyId","cashAccountId","feeAccountId","advanceAccountId","sourceDocumentId","creditBillId","projectId","documentDate","postingDate",description,evidence,currency,"cashAmount","feeAmount","allocationAmount","advanceAmount","totalAmount","createdById","reversalOfId") VALUES(gen_random_uuid(),'REV-'||lpad(nextval('public.finance_supplier_number'::regclass)::text,10,'0'),'REVERSAL',origin.reference,origin."partyId",origin."cashAccountId",origin."feeAccountId",origin."advanceAccountId",origin."sourceDocumentId",origin."creditBillId",origin."projectId",(input->>'postingDate')::date,(input->>'postingDate')::date,origin.description,reason,'PKR',origin."cashAmount",origin."feeAmount",origin."allocationAmount",origin."advanceAmount",origin."totalAmount",actor,origin.id) RETURNING * INTO d;
  ELSE
   IF origin."allocationAmount"<=0 OR EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE "unallocationOfId"=origin.id) THEN RAISE EXCEPTION 'FINANCE_SETTLEMENT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
   INSERT INTO public."FinanceSupplierDocument"(id,number,kind,reference,"partyId","cashAccountId","feeAccountId","advanceAccountId","sourceDocumentId","projectId","documentDate","postingDate",description,evidence,currency,"cashAmount","feeAmount","allocationAmount","advanceAmount","totalAmount","createdById","unallocationOfId") VALUES(gen_random_uuid(),'UAL-'||lpad(nextval('public.finance_supplier_number'::regclass)::text,10,'0'),'UNALLOCATION',origin.reference,origin."partyId",NULL,NULL,(input->>'advanceAccountId')::uuid,origin.id,origin."projectId",(input->>'postingDate')::date,(input->>'postingDate')::date,origin.description,reason,'PKR',0,0,origin."allocationAmount",origin."allocationAmount",origin."allocationAmount",actor,origin.id) RETURNING * INTO d;
   INSERT INTO public."FinanceSupplierAllocation"(id,"documentId","billId",sequence,amount) SELECT gen_random_uuid(),d.id,"billId",sequence,amount FROM public."FinanceSupplierAllocation" WHERE "documentId"=origin.id;
  END IF;
  entry_id:=public.encova_finance_emit_journal(actor,'SUPPLIER_DOCUMENT',d.id,d."postingDate",reason);SELECT * INTO d FROM public."FinanceSupplierDocument" WHERE id=d.id;
 ELSIF action IN('CREATE','UPDATE') THEN
  IF input->>'currency' IS DISTINCT FROM 'PKR' OR jsonb_typeof(input->'reference') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'description') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'evidence') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'documentDate') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'postingDate') IS DISTINCT FROM 'string' OR input->>'documentDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR input->>'postingDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=(input->>'partyId')::uuid AND kind IN('SUPPLIER','BOTH','EMPLOYEE')) THEN RAISE EXCEPTION 'FINANCE_BILL_PARTY' USING ERRCODE='P0001';END IF;
  project:=nullif(input->>'projectId','')::uuid;
  IF resource IN('PAYMENT','SUPPLIER_REFUND') THEN
   IF jsonb_typeof(input->'cashAmount') IS DISTINCT FROM 'string' OR input->>'cashAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR(input->>'cashAmount')::numeric<=0 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;cash:=(input->>'cashAmount')::numeric;cash_account:=(input->>'cashAccountId')::uuid;
  END IF;
  IF resource='PAYMENT' THEN
   IF jsonb_typeof(input->'feeAmount') IS DISTINCT FROM 'string' OR input->>'feeAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;fee:=(input->>'feeAmount')::numeric;fee_account:=nullif(input->>'feeAccountId','')::uuid;advance_account:=nullif(input->>'advanceAccountId','')::uuid;
  ELSIF resource IN('ADVANCE_APPLICATION','SUPPLIER_REFUND') THEN
   source_doc:=(input->>'sourceDocumentId')::uuid;SELECT * INTO origin FROM public."FinanceSupplierDocument" WHERE id=source_doc;advance_account:=origin."advanceAccountId";
  ELSE credit_bill:=(input->>'billId')::uuid;advance_account:=(input->>'advanceAccountId')::uuid;SELECT * INTO inv FROM public."FinanceBill" WHERE id=credit_bill;project:=coalesce(project,inv."projectId");END IF;
  IF resource IN('PAYMENT','ADVANCE_APPLICATION') THEN
   IF jsonb_typeof(input->'allocations') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'allocations') NOT BETWEEN 0 AND 100 OR(resource='ADVANCE_APPLICATION' AND jsonb_array_length(input->'allocations')=0) THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(input->'allocations') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['billId','amount']<>'{}'::jsonb OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'string' OR item->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR(item->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;alloc_sum:=alloc_sum+(item->>'amount')::numeric;
   END LOOP;
  ELSIF resource='SUPPLIER_CREDIT' THEN
   IF jsonb_typeof(input->'creditLines') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'creditLines') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(input->'creditLines') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['billLineId','amount']<>'{}'::jsonb OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'string' OR item->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR(item->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;credit_sum:=credit_sum+(item->>'amount')::numeric;
   END LOOP;
  END IF;
  total:=CASE resource WHEN 'PAYMENT' THEN cash+fee WHEN 'ADVANCE_APPLICATION' THEN alloc_sum WHEN 'SUPPLIER_CREDIT' THEN credit_sum ELSE cash END;adv:=CASE WHEN resource='PAYMENT' THEN total-alloc_sum ELSE 0 END;
  IF total<=0 OR total>999999999999999999.99 OR alloc_sum>999999999999999999.99 OR adv<0 THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_TOTALS' USING ERRCODE='P0001';END IF;
  IF action='CREATE' THEN
   prefix:=CASE resource WHEN 'PAYMENT' THEN 'PAY-' WHEN 'ADVANCE_APPLICATION' THEN 'SAP-' WHEN 'SUPPLIER_CREDIT' THEN 'SCN-' ELSE 'SRF-' END;
   INSERT INTO public."FinanceSupplierDocument"(id,number,kind,reference,"partyId","cashAccountId","feeAccountId","advanceAccountId","sourceDocumentId","creditBillId","projectId","documentDate","postingDate",description,evidence,currency,"cashAmount","feeAmount","allocationAmount","advanceAmount","totalAmount","createdById") VALUES(gen_random_uuid(),prefix||lpad(nextval('public.finance_supplier_number'::regclass)::text,10,'0'),resource,input->>'reference',(input->>'partyId')::uuid,cash_account,fee_account,advance_account,source_doc,credit_bill,project,(input->>'documentDate')::date,(input->>'postingDate')::date,input->>'description',input->>'evidence','PKR',cash,fee,alloc_sum,adv,total,actor) RETURNING * INTO d;
  ELSE
   UPDATE public."FinanceSupplierDocument" SET reference=input->>'reference',"partyId"=(input->>'partyId')::uuid,"cashAccountId"=cash_account,"feeAccountId"=fee_account,"advanceAccountId"=advance_account,"sourceDocumentId"=source_doc,"creditBillId"=credit_bill,"projectId"=project,"documentDate"=(input->>'documentDate')::date,"postingDate"=(input->>'postingDate')::date,description=input->>'description',evidence=input->>'evidence',"cashAmount"=cash,"feeAmount"=fee,"allocationAmount"=alloc_sum,"advanceAmount"=adv,"totalAmount"=total,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
   DELETE FROM public."FinanceSupplierAllocation" WHERE "documentId"=d.id;DELETE FROM public."FinanceSupplierCreditLine" WHERE "documentId"=d.id;
  END IF;
  IF resource IN('PAYMENT','ADVANCE_APPLICATION') THEN
   FOR item IN SELECT value FROM jsonb_array_elements(input->'allocations') LOOP n:=n+1;INSERT INTO public."FinanceSupplierAllocation"(id,"documentId","billId",sequence,amount) VALUES(gen_random_uuid(),d.id,(item->>'billId')::uuid,n,(item->>'amount')::numeric);END LOOP;
  ELSIF resource='SUPPLIER_CREDIT' THEN
   FOR item IN SELECT value FROM jsonb_array_elements(input->'creditLines') LOOP n:=n+1;INSERT INTO public."FinanceSupplierCreditLine"(id,"documentId","billLineId",sequence,amount) VALUES(gen_random_uuid(),d.id,(item->>'billLineId')::uuid,n,(item->>'amount')::numeric);END LOOP;
  END IF;
 ELSIF action='VOID' THEN UPDATE public."FinanceSupplierDocument" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
 ELSE entry_id:=public.encova_finance_emit_journal(actor,'SUPPLIER_DOCUMENT',d.id,d."postingDate",reason);SELECT * INTO d FROM public."FinanceSupplierDocument" WHERE id=d.id;END IF;
 IF action='REVERSE' THEN result:=jsonb_build_object('id',origin_id,'version',origin_version,'number',origin_number,'journalId',entry_id,'reversalId',d.id);audit_id:=origin_id;
 ELSE result:=jsonb_build_object('id',d.id,'version',d.version,'number',d.number,'journalId',entry_id);audit_id:=d.id;END IF;
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,operation_name,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_'||operation_name,'FinanceSupplierDocument',audit_id,reason,jsonb_build_object('journalId',entry_id,'snapshot',to_jsonb(d)||jsonb_build_object('cashAmount',d."cashAmount"::text,'feeAmount',d."feeAmount"::text,'allocationAmount',d."allocationAmount"::text,'advanceAmount',d."advanceAmount"::text,'totalAmount',d."totalAmount"::text),'allocations',(SELECT jsonb_agg(to_jsonb(a)||jsonb_build_object('amount',a.amount::text) ORDER BY sequence) FROM public."FinanceSupplierAllocation" a WHERE a."documentId"=d.id),'creditLines',(SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('amount',c.amount::text) ORDER BY sequence) FROM public."FinanceSupplierCreditLine" c WHERE c."documentId"=d.id),'creditSplit',(SELECT jsonb_build_object('arAmount',s."arAmount"::text,'balanceAmount',s."balanceAmount"::text) FROM public."FinanceSupplierCreditSplit" s WHERE s."documentId"=d.id)),request_id);
 IF action='UNALLOCATE' THEN INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_RECEIPT_UNALLOCATE','FinanceSupplierDocument',origin_id,reason,jsonb_build_object('unallocationId',d.id,'journalId',entry_id,'postingDate',d."postingDate"),request_id);END IF;RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';
 WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END $$;
CREATE TRIGGER "FinanceSupplierDocument_config_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceSupplierDocument" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceSupplierAllocation_config_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceSupplierAllocation" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceSupplierDocument_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceSupplierDocument" FOR EACH ROW EXECUTE FUNCTION encova_finance_supplier_guard();
CREATE TRIGGER "FinanceSupplierAllocation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceSupplierAllocation" FOR EACH ROW EXECUTE FUNCTION encova_finance_supplier_allocation_guard();
CREATE CONSTRAINT TRIGGER "FinanceSupplierDocument_valid" AFTER INSERT OR UPDATE ON "FinanceSupplierDocument" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_supplier_check_trigger();
CREATE CONSTRAINT TRIGGER "FinanceSupplierAllocation_valid" AFTER INSERT OR UPDATE OR DELETE ON "FinanceSupplierAllocation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_supplier_check_trigger();
CREATE TRIGGER "FinanceSupplierBalanceEvent_config_lock" BEFORE INSERT ON "FinanceSupplierBalanceEvent" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceSupplierBalanceEvent_immutable" BEFORE UPDATE OR DELETE ON "FinanceSupplierBalanceEvent" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
CREATE CONSTRAINT TRIGGER "FinanceSupplierBalanceEvent_valid" AFTER INSERT ON "FinanceSupplierBalanceEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_supplier_check_trigger();
CREATE TRIGGER "FinanceSupplierCreditLine_config_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceSupplierCreditLine" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceSupplierCreditLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceSupplierCreditLine" FOR EACH ROW EXECUTE FUNCTION encova_finance_supplier_allocation_guard();
CREATE TRIGGER "FinanceSupplierCreditSplit_config_lock" BEFORE INSERT ON "FinanceSupplierCreditSplit" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceSupplierCreditSplit_immutable" BEFORE UPDATE OR DELETE ON "FinanceSupplierCreditSplit" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
CREATE TRIGGER "FinanceBillCreditEvent_config_lock" BEFORE INSERT ON "FinanceBillCreditEvent" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceBillCreditEvent_immutable" BEFORE UPDATE OR DELETE ON "FinanceBillCreditEvent" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
CREATE TRIGGER "FinanceSupplierCreditSplit_guard" BEFORE INSERT ON "FinanceSupplierCreditSplit" FOR EACH ROW EXECUTE FUNCTION encova_finance_credit_split_guard();
CREATE CONSTRAINT TRIGGER "FinanceSupplierCreditLine_valid" AFTER INSERT OR UPDATE OR DELETE ON "FinanceSupplierCreditLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_supplier_check_trigger();
CREATE CONSTRAINT TRIGGER "FinanceSupplierCreditSplit_valid" AFTER INSERT ON "FinanceSupplierCreditSplit" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_supplier_check_trigger();
CREATE CONSTRAINT TRIGGER "FinanceBillCreditEvent_valid" AFTER INSERT ON "FinanceBillCreditEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_supplier_check_trigger();
CREATE CONSTRAINT TRIGGER "FinancePayableEvent_supplier_valid" AFTER INSERT ON "FinancePayableEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_supplier_check_trigger();
ALTER TABLE "FinanceSupplierDocument" ADD CONSTRAINT "FinanceSupplierDocument_no_fee" CHECK("feeAmount"=0 AND "feeAccountId" IS NULL);
CREATE OR REPLACE FUNCTION encova_finance_journal_header_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE period public."FinancePeriod"%ROWTYPE;
BEGIN
 SELECT * INTO period FROM public."FinancePeriod" WHERE id=NEW."periodId" FOR UPDATE;
 IF period.id IS NULL OR period.state<>'OPEN' OR NEW."postingDate" NOT BETWEEN period."startDate" AND period."endDate" THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 IF NEW."postingDate">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'FINANCE_FUTURE_DATE' USING ERRCODE='P0001'; END IF;
 IF NEW."sourceType"='SUPPLIER_DOCUMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE id=NEW."supplierDocumentId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='SUPPLIER_DOCUMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE id=NEW."supplierDocumentId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='BILL' AND NOT EXISTS(SELECT 1 FROM public."FinanceBill" WHERE id=NEW."billId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='INVOICE' AND NOT EXISTS(SELECT 1 FROM public."FinanceInvoice" WHERE id=NEW."invoiceId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='CUSTOMER_DOCUMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" WHERE id=NEW."customerDocumentId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."reversalOfId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."FinanceJournalEntry" WHERE id=NEW."reversalOfId" AND "sourceType"='JOURNAL_DRAFT' AND "reversalOfId" IS NULL AND "postingDate"<=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001'; END IF;
 UPDATE public."FinancePeriod" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=period.id;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_journal_line_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE account public."FinanceAccount"%ROWTYPE; entry public."FinanceJournalEntry"%ROWTYPE; invoice public."FinanceInvoice"%ROWTYPE; line public."FinanceInvoiceLine"%ROWTYPE;
BEGIN
 SELECT * INTO account FROM public."FinanceAccount" WHERE id=NEW."accountId" FOR UPDATE;
 IF account.id IS NULL OR NOT account.active OR NOT account."isPosting" OR account.currency<>'PKR' THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 SELECT * INTO entry FROM public."FinanceJournalEntry" WHERE id=NEW."journalId";
 IF entry."sourceType"='SUPPLIER_DOCUMENT' THEN
  IF NEW."invoiceLineId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.encova_finance_supplier_lines(entry."supplierDocumentId") x WHERE ROW(x.sequence,x."accountId",x.description,x.debit,x.credit,x."projectId",x."partyId",x."billLineId") IS NOT DISTINCT FROM ROW(NEW.sequence,NEW."accountId",NEW.description,NEW.debit,NEW.credit,NEW."projectId",NEW."partyId",NEW."billLineId")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_mark_accounts(ARRAY[NEW."accountId"]);RETURN NEW;
 END IF;
 IF entry."sourceType"='SUPPLIER_DOCUMENT' THEN
  IF NEW."invoiceLineId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.encova_finance_supplier_lines(entry."supplierDocumentId") x WHERE ROW(x.sequence,x."accountId",x.description,x.debit,x.credit,x."projectId",x."partyId",x."billLineId") IS NOT DISTINCT FROM ROW(NEW.sequence,NEW."accountId",NEW.description,NEW.debit,NEW.credit,NEW."projectId",NEW."partyId",NEW."billLineId")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_mark_accounts(ARRAY[NEW."accountId"]);RETURN NEW;
 END IF;
 IF entry."sourceType"='BILL' THEN
  IF NEW."invoiceLineId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.encova_finance_bill_lines(entry."billId") x WHERE ROW(x.sequence,x."accountId",x.description,x.debit,x.credit,x."projectId",x."partyId",x."billLineId") IS NOT DISTINCT FROM ROW(NEW.sequence,NEW."accountId",NEW.description,NEW.debit,NEW.credit,NEW."projectId",NEW."partyId",NEW."billLineId")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_mark_accounts(ARRAY[NEW."accountId"]);RETURN NEW;
 END IF;
 IF NEW."billLineId" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF entry."sourceType"='CUSTOMER_DOCUMENT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.encova_finance_customer_lines(entry."customerDocumentId") x WHERE ROW(x.sequence,x."accountId",x.description,x.debit,x.credit,x."projectId",x."partyId",x."invoiceLineId") IS NOT DISTINCT FROM ROW(NEW.sequence,NEW."accountId",NEW.description,NEW.debit,NEW.credit,NEW."projectId",NEW."partyId",NEW."invoiceLineId")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_mark_accounts(ARRAY[NEW."accountId"]);RETURN NEW;
 END IF;
 IF entry."sourceType"='INVOICE' THEN
  SELECT * INTO invoice FROM public."FinanceInvoice" WHERE id=entry."invoiceId";
  IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=invoice."partyId" AND active AND kind IN ('CLIENT','BOTH')) THEN RAISE EXCEPTION 'FINANCE_INVOICE_PARTY' USING ERRCODE='P0001';END IF;
  IF NEW."partyId" IS DISTINCT FROM invoice."partyId" THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  IF NEW.sequence=1 THEN
   IF NEW."invoiceLineId" IS NOT NULL OR NEW."accountId"<>invoice."receivableAccountId" OR account."controlType"<>'RECEIVABLES' OR account.type<>'ASSET' OR account."isContra" OR NEW.debit<>invoice."totalAmount" OR NEW.credit<>0 OR NEW.description<>invoice.description OR NEW."projectId" IS DISTINCT FROM invoice."projectId" THEN RAISE EXCEPTION 'FINANCE_INVOICE_MAPPING' USING ERRCODE='P0001';END IF;
  ELSE
   SELECT * INTO line FROM public."FinanceInvoiceLine" WHERE id=NEW."invoiceLineId" AND "invoiceId"=invoice.id;
   IF line.id IS NULL OR NEW.sequence<>line.sequence+1 OR NEW.debit<>0 OR NEW.credit<>line."totalAmount" OR NEW.description<>line.description OR NEW."projectId" IS DISTINCT FROM line."projectId" OR
    (line.recognition='EARNED' AND (NEW."accountId"<>line."revenueAccountId" OR account."controlType"<>'NONE' OR account.type NOT IN ('INCOME','OTHER_INCOME') OR account."isContra")) OR
    (line.recognition='DEFERRED' AND (NEW."accountId"<>line."deferredAccountId" OR account."controlType"<>'DEFERRED_REVENUE' OR account.type<>'LIABILITY' OR account."isContra")) THEN RAISE EXCEPTION 'FINANCE_INVOICE_MAPPING' USING ERRCODE='P0001';END IF;
  END IF;
 ELSE
  IF account."controlType"<>'NONE' THEN RAISE EXCEPTION 'FINANCE_CONTROL_PROTECTED' USING ERRCODE='P0001'; END IF;
  IF NEW."partyId" IS NOT NULL OR NEW."invoiceLineId" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 END IF;
 IF NEW."projectId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Project" WHERE id=NEW."projectId" AND "archivedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_PROJECT_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 PERFORM public.encova_finance_mark_accounts(ARRAY[NEW."accountId"]);
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_journal_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; entry public."FinanceJournalEntry"%ROWTYPE; line_count BIGINT; debits NUMERIC; credits NUMERIC;
BEGIN
 IF TG_TABLE_NAME='FinanceJournalEntry' THEN target:=NEW.id; ELSE target:=NEW."journalId"; END IF;
 SELECT * INTO entry FROM public."FinanceJournalEntry" WHERE id=target;
 SELECT count(*),coalesce(sum(debit),0),coalesce(sum(credit),0) INTO line_count,debits,credits FROM public."FinanceJournalLine" WHERE "journalId"=target;
 IF line_count NOT BETWEEN 2 AND 200 OR debits<>credits OR debits<=0 OR debits>999999999999999999.99 THEN RAISE EXCEPTION 'FINANCE_UNBALANCED' USING ERRCODE='P0001'; END IF;
 IF entry."sourceType"='SUPPLIER_DOCUMENT' THEN PERFORM public.encova_finance_check_supplier(entry."supplierDocumentId");RETURN NULL;END IF;
 IF entry."sourceType"='SUPPLIER_DOCUMENT' THEN PERFORM public.encova_finance_check_supplier(entry."supplierDocumentId");RETURN NULL;END IF;
 IF entry."sourceType"='BILL' THEN PERFORM public.encova_finance_check_bill(entry."billId");RETURN NULL;END IF;
 IF entry."sourceType"='CUSTOMER_DOCUMENT' THEN PERFORM public.encova_finance_check_customer(entry."customerDocumentId");RETURN NULL;END IF;
 IF entry."sourceType"='INVOICE' THEN PERFORM public.encova_finance_check_invoice(entry."invoiceId");RETURN NULL;END IF;
 IF entry."draftId" IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public."FinanceJournalDraft" d WHERE d.id=entry."draftId" AND d.state='POSTED' AND d."postingDate"=entry."postingDate" AND d.description=entry.description AND d.evidence=entry.evidence AND d.currency=entry.currency) OR
   EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId" FROM public."FinanceJournalDraftLine" WHERE "draftId"=entry."draftId") EXCEPT (SELECT sequence,"accountId",description,debit,credit,"projectId" FROM public."FinanceJournalLine" WHERE "journalId"=target)) OR
   EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId" FROM public."FinanceJournalLine" WHERE "journalId"=target) EXCEPT (SELECT sequence,"accountId",description,debit,credit,"projectId" FROM public."FinanceJournalDraftLine" WHERE "draftId"=entry."draftId")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001'; END IF;
 ELSE
  IF EXISTS((SELECT sequence,"accountId",description,credit AS debit,debit AS credit,"projectId" FROM public."FinanceJournalLine" WHERE "journalId"=entry."reversalOfId") EXCEPT (SELECT sequence,"accountId",description,debit,credit,"projectId" FROM public."FinanceJournalLine" WHERE "journalId"=target)) OR
   EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId" FROM public."FinanceJournalLine" WHERE "journalId"=target) EXCEPT (SELECT sequence,"accountId",description,credit AS debit,debit AS credit,"projectId" FROM public."FinanceJournalLine" WHERE "journalId"=entry."reversalOfId")) THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_emit_journal(actor UUID,source_kind TEXT,source_id UUID,posting_date DATE,reason TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE supplier public."FinanceSupplierDocument"%ROWTYPE; bill public."FinanceBill"%ROWTYPE; draft public."FinanceJournalDraft"%ROWTYPE; original public."FinanceJournalEntry"%ROWTYPE; invoice public."FinanceInvoice"%ROWTYPE;
 period_id UUID; entry_id UUID:=gen_random_uuid(); mappings UUID[]; customer public."FinanceCustomerDocument"%ROWTYPE;
BEGIN
 IF source_kind IS NULL OR source_kind NOT IN ('JOURNAL_DRAFT','JOURNAL_REVERSAL','INVOICE','CUSTOMER_DOCUMENT','BILL','SUPPLIER_DOCUMENT') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF source_kind='SUPPLIER_DOCUMENT' THEN
  SELECT * INTO supplier FROM public."FinanceSupplierDocument" WHERE id=source_id FOR UPDATE;
  IF supplier.id IS NULL OR supplier."postingDate"<>posting_date THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_supplier_validate(source_id);
 ELSIF source_kind='BILL' THEN
  SELECT * INTO bill FROM public."FinanceBill" WHERE id=source_id FOR UPDATE;
  IF bill.id IS NULL OR bill."postingDate"<>posting_date THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_bill_validate(source_id);
 ELSIF source_kind='INVOICE' THEN
  SELECT * INTO invoice FROM public."FinanceInvoice" WHERE id=source_id FOR UPDATE;
  IF invoice.id IS NULL OR invoice.state<>'DRAFT' OR invoice."postingDate"<>posting_date THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  IF invoice."totalAmount"<=0 THEN RAISE EXCEPTION 'FINANCE_INVOICE_EMPTY' USING ERRCODE='P0001';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=invoice."partyId" AND active AND kind IN ('CLIENT','BOTH')) THEN RAISE EXCEPTION 'FINANCE_INVOICE_PARTY' USING ERRCODE='P0001';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=invoice."receivableAccountId" AND active AND "isPosting" AND NOT "isContra" AND currency='PKR' AND "controlType"='RECEIVABLES' AND type='ASSET') OR EXISTS(
   SELECT 1 FROM public."FinanceInvoiceLine" l JOIN public."FinanceAccount" a ON a.id=l."revenueAccountId" WHERE l."invoiceId"=source_id AND (NOT a.active OR NOT a."isPosting" OR a."isContra" OR a.currency<>'PKR' OR a.type NOT IN ('INCOME','OTHER_INCOME') OR a."controlType"<>'NONE')) OR EXISTS(
   SELECT 1 FROM public."FinanceInvoiceLine" l JOIN public."FinanceAccount" a ON a.id=l."deferredAccountId" WHERE l."invoiceId"=source_id AND l.recognition='DEFERRED' AND (NOT a.active OR NOT a."isPosting" OR a."isContra" OR a.currency<>'PKR' OR a.type<>'LIABILITY' OR a."controlType"<>'DEFERRED_REVENUE')) THEN RAISE EXCEPTION 'FINANCE_INVOICE_MAPPING' USING ERRCODE='P0001';END IF;
  IF (invoice."projectId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Project" WHERE id=invoice."projectId" AND "archivedAt" IS NULL)) OR EXISTS(SELECT 1 FROM public."FinanceInvoiceLine" l JOIN public."Project" p ON p.id=l."projectId" WHERE l."invoiceId"=source_id AND p."archivedAt" IS NOT NULL) THEN RAISE EXCEPTION 'FINANCE_PROJECT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 ELSIF source_kind='CUSTOMER_DOCUMENT' THEN
  SELECT * INTO customer FROM public."FinanceCustomerDocument" WHERE id=source_id FOR UPDATE;
  IF customer.id IS NULL OR customer."postingDate"<>posting_date THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_customer_validate(source_id);
 ELSE
  SELECT * INTO draft FROM public."FinanceJournalDraft" WHERE id=source_id FOR UPDATE;
  IF draft.id IS NULL OR (source_kind='JOURNAL_DRAFT' AND (draft.state<>'DRAFT' OR draft."postingDate"<>posting_date)) OR (source_kind='JOURNAL_REVERSAL' AND draft.state<>'POSTED') THEN RAISE EXCEPTION 'FINANCE_DRAFT_IMMUTABLE' USING ERRCODE='P0001';END IF;
  IF source_kind='JOURNAL_REVERSAL' THEN
   SELECT * INTO original FROM public."FinanceJournalEntry" WHERE "draftId"=source_id AND "sourceType"='JOURNAL_DRAFT' FOR UPDATE;
   IF original.id IS NULL OR EXISTS(SELECT 1 FROM public."FinanceJournalEntry" WHERE "reversalOfId"=original.id) OR posting_date<original."postingDate" THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001';END IF;
  END IF;
 END IF;
 SELECT id INTO period_id FROM public."FinancePeriod" WHERE state='OPEN' AND posting_date BETWEEN "startDate" AND "endDate" FOR UPDATE;
 IF period_id IS NULL THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF source_kind='JOURNAL_DRAFT' THEN
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","draftId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'JOURNAL_DRAFT',draft.id,'POST',draft.id,posting_date,period_id,draft.description,draft.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId") SELECT gen_random_uuid(),entry_id,sequence,"accountId",description,debit,credit,"projectId" FROM public."FinanceJournalDraftLine" WHERE "draftId"=draft.id ORDER BY "accountId",sequence;
  UPDATE public."FinanceJournalDraft" SET state='POSTED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=draft.id;
 ELSIF source_kind='JOURNAL_REVERSAL' THEN
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","postingDate","periodId",description,evidence,"postedById","reversalOfId") VALUES(entry_id,'JRN-'||entry_id::text,'JOURNAL_REVERSAL',original.id,'REVERSE',posting_date,period_id,original.description,reason,actor,original.id);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId") SELECT gen_random_uuid(),entry_id,sequence,"accountId",description,credit,debit,"projectId" FROM public."FinanceJournalLine" WHERE "journalId"=original.id ORDER BY "accountId",sequence;
 ELSIF source_kind='SUPPLIER_DOCUMENT' THEN
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","supplierDocumentId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'SUPPLIER_DOCUMENT',supplier.id,'POST',supplier.id,posting_date,period_id,supplier.description,supplier.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId","billLineId") SELECT gen_random_uuid(),entry_id,x.* FROM public.encova_finance_supplier_lines(supplier.id) x ORDER BY x."accountId",x.sequence;
  PERFORM public.encova_finance_supplier_effects(actor,supplier.id,entry_id);
 ELSIF source_kind='SUPPLIER_DOCUMENT' THEN
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","supplierDocumentId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'SUPPLIER_DOCUMENT',supplier.id,'POST',supplier.id,posting_date,period_id,supplier.description,supplier.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId","billLineId") SELECT gen_random_uuid(),entry_id,x.* FROM public.encova_finance_supplier_lines(supplier.id) x ORDER BY x."accountId",x.sequence;
  PERFORM public.encova_finance_supplier_effects(actor,supplier.id,entry_id);
 ELSIF source_kind='BILL' THEN
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","billId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'BILL',bill.id,'POST',bill.id,posting_date,period_id,bill.description,bill.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId","billLineId") SELECT gen_random_uuid(),entry_id,x.* FROM public.encova_finance_bill_lines(bill.id) x ORDER BY x."accountId",x.sequence;
  PERFORM public.encova_finance_bill_effects(bill.id,entry_id);
 ELSIF source_kind='CUSTOMER_DOCUMENT' THEN
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","customerDocumentId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'CUSTOMER_DOCUMENT',customer.id,'POST',customer.id,posting_date,period_id,customer.description,customer.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId") SELECT gen_random_uuid(),entry_id,x.* FROM public.encova_finance_customer_lines(customer.id) x ORDER BY x."accountId",x.sequence;
  PERFORM public.encova_finance_customer_effects(actor,customer.id,entry_id);
 ELSE
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","invoiceId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'INVOICE',invoice.id,'POST',invoice.id,posting_date,period_id,invoice.description,invoice.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId") VALUES(gen_random_uuid(),entry_id,1,invoice."receivableAccountId",invoice.description,invoice."totalAmount",0,invoice."projectId",invoice."partyId");
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId") SELECT gen_random_uuid(),entry_id,sequence+1,CASE WHEN recognition='EARNED' THEN "revenueAccountId" ELSE "deferredAccountId" END,description,0,"totalAmount","projectId",invoice."partyId",id FROM public."FinanceInvoiceLine" WHERE "invoiceId"=invoice.id AND "totalAmount">0 ORDER BY CASE WHEN recognition='EARNED' THEN "revenueAccountId" ELSE "deferredAccountId" END,sequence;
  INSERT INTO public."FinanceReceivableEvent"(id,"invoiceId","partyId","accountId","journalId","effectiveDate",kind,amount) VALUES(gen_random_uuid(),invoice.id,invoice."partyId",invoice."receivableAccountId",entry_id,posting_date,'INVOICE',invoice."totalAmount");
  INSERT INTO public."FinanceDeferredRevenueEvent"(id,"invoiceLineId","journalId","effectiveDate",kind,amount) SELECT gen_random_uuid(),id,entry_id,posting_date,'BILLED',"totalAmount" FROM public."FinanceInvoiceLine" WHERE "invoiceId"=invoice.id AND recognition='DEFERRED' AND "totalAmount">0;
  SELECT array_agg(id) INTO mappings FROM public."FinanceAccount" WHERE id=invoice."receivableAccountId" OR id IN(SELECT "revenueAccountId" FROM public."FinanceInvoiceLine" WHERE "invoiceId"=invoice.id) OR id IN(SELECT "deferredAccountId" FROM public."FinanceInvoiceLine" WHERE "invoiceId"=invoice.id);
  PERFORM public.encova_finance_mark_accounts(mappings);
  UPDATE public."FinanceParty" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=invoice."partyId";
  UPDATE public."FinanceInvoice" SET state='POSTED',version=version+1,"partySnapshot"=public.encova_finance_party_snapshot("partyId"),"updatedAt"=CURRENT_TIMESTAMP WHERE id=invoice.id;
 END IF;
 RETURN entry_id;
END $$;
DO $$ DECLARE t TEXT;f record;role_name TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceSupplierDocument','FinanceSupplierAllocation','FinanceSupplierBalanceEvent','FinanceSupplierCreditLine','FinanceSupplierCreditSplit','FinanceBillCreditEvent'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,role_name);END IF;END LOOP;
 END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND(proname LIKE 'encova_finance_supplier_%' OR proname IN('encova_finance_check_supplier','encova_finance_ap_capacity')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','encova_app'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name);END IF;END LOOP;
 END LOOP;
 REVOKE ALL ON SEQUENCE public.finance_supplier_number FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION encova_finance_supplier_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,JSONB,TEXT,UUID) TO encova_app;END IF;
END $$;
COMMIT;
