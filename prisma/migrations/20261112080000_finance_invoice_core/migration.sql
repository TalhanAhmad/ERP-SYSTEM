BEGIN;
-- No company chart, fiscal year, invoice, grant or opening balance is seeded.
ALTER TABLE "FinanceAccount" DROP CONSTRAINT "FinanceAccount_controlType_check", DROP CONSTRAINT "FinanceAccount_control_type";
ALTER TABLE "FinanceAccount" ADD CONSTRAINT "FinanceAccount_controlType_check" CHECK("controlType" IN ('NONE','CASH','RECEIVABLES','PAYABLES','CLIENT_ADVANCE','SUPPLIER_ADVANCE','FIXED_ASSET','ACCUMULATED_DEPRECIATION','INVESTMENT','LOAN_RECEIVABLE','LOAN_PAYABLE','DEFERRED_REVENUE')),
 ADD CONSTRAINT "FinanceAccount_control_type" CHECK("controlType"='NONE' OR (type='ASSET' AND "controlType" IN ('CASH','RECEIVABLES','SUPPLIER_ADVANCE','FIXED_ASSET','ACCUMULATED_DEPRECIATION','INVESTMENT','LOAN_RECEIVABLE')) OR (type='LIABILITY' AND "controlType" IN ('PAYABLES','CLIENT_ADVANCE','LOAN_PAYABLE','DEFERRED_REVENUE')));
CREATE SEQUENCE public.finance_invoice_number AS BIGINT MINVALUE 1 MAXVALUE 9999999999 START 1 NO CYCLE;
CREATE TABLE "FinanceInvoice" (
 id UUID PRIMARY KEY,number TEXT NOT NULL UNIQUE DEFAULT ('INV-'||lpad(nextval('public.finance_invoice_number'::regclass)::text,10,'0')) CHECK(number ~ '^INV-[0-9]{10}$'),
 reference TEXT CHECK(reference IS NULL OR length(trim(reference)) BETWEEN 1 AND 80),
 "partyId" UUID NOT NULL REFERENCES "FinanceParty" ON DELETE RESTRICT,"receivableAccountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,
 "projectId" UUID REFERENCES "Project" ON DELETE RESTRICT,
 "invoiceDate" DATE NOT NULL CHECK("invoiceDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 "postingDate" DATE NOT NULL CHECK("postingDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' AND "postingDate">="invoiceDate"),
 "dueDate" DATE NOT NULL CHECK("dueDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' AND "dueDate">="invoiceDate"),
 description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 1000),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),
 currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','POSTED','VOIDED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "lineAmount" NUMERIC(20,2) NOT NULL CHECK("lineAmount">=0),"discountAmount" NUMERIC(20,2) NOT NULL CHECK("discountAmount">=0 AND "discountAmount"<="lineAmount"),
 "netAmount" NUMERIC(20,2) NOT NULL CHECK("netAmount"="lineAmount"-"discountAmount"),"taxAmount" NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK("taxAmount"=0),"totalAmount" NUMERIC(20,2) NOT NULL CHECK("totalAmount"="netAmount"+"taxAmount"),
 "partySnapshot" JSONB,"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FinanceInvoice_partyId_dueDate_state_idx" ON "FinanceInvoice"("partyId","dueDate",state);
CREATE INDEX "FinanceInvoice_state_postingDate_id_idx" ON "FinanceInvoice"(state,"postingDate",id);
CREATE TABLE "FinanceInvoiceLine" (
 id UUID PRIMARY KEY,"invoiceId" UUID NOT NULL REFERENCES "FinanceInvoice" ON DELETE RESTRICT,sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 100),
 description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 500),quantity NUMERIC(20,6) NOT NULL CHECK(quantity>0),"unitRate" NUMERIC(20,6) NOT NULL CHECK("unitRate">=0),
 "lineAmount" NUMERIC(20,2) NOT NULL CHECK("lineAmount"=round(quantity*"unitRate",2)),"discountAmount" NUMERIC(20,2) NOT NULL CHECK("discountAmount">=0 AND "discountAmount"<="lineAmount"),
 "netAmount" NUMERIC(20,2) NOT NULL CHECK("netAmount"="lineAmount"-"discountAmount"),"taxAmount" NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK("taxAmount"=0),"totalAmount" NUMERIC(20,2) NOT NULL CHECK("totalAmount"="netAmount"+"taxAmount"),
 recognition TEXT NOT NULL CHECK(recognition IN ('EARNED','DEFERRED')),"revenueAccountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,
 "deferredAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,"projectId" UUID REFERENCES "Project" ON DELETE RESTRICT,
 CHECK((recognition='DEFERRED')=("deferredAccountId" IS NOT NULL)),UNIQUE("invoiceId",sequence)
);
ALTER TABLE "FinanceJournalEntry" ADD COLUMN "invoiceId" UUID UNIQUE REFERENCES "FinanceInvoice" ON DELETE RESTRICT;
ALTER TABLE "FinanceJournalEntry" DROP CONSTRAINT "FinanceJournalEntry_check";
ALTER TABLE "FinanceJournalEntry" ADD CONSTRAINT "FinanceJournalEntry_source_identity" CHECK(
 ("sourceType"='JOURNAL_DRAFT' AND "sourceAction"='POST' AND "draftId"="sourceId" AND "draftId" IS NOT NULL AND "reversalOfId" IS NULL AND "invoiceId" IS NULL) OR
 ("sourceType"='JOURNAL_REVERSAL' AND "sourceAction"='REVERSE' AND "reversalOfId"="sourceId" AND "reversalOfId" IS NOT NULL AND "draftId" IS NULL AND "invoiceId" IS NULL) OR
 ("sourceType"='INVOICE' AND "sourceAction"='POST' AND "invoiceId"="sourceId" AND "invoiceId" IS NOT NULL AND "draftId" IS NULL AND "reversalOfId" IS NULL));
ALTER TABLE "FinanceJournalLine" ADD COLUMN "partyId" UUID REFERENCES "FinanceParty" ON DELETE RESTRICT,ADD COLUMN "invoiceLineId" UUID REFERENCES "FinanceInvoiceLine" ON DELETE RESTRICT;
CREATE TABLE "FinanceReceivableEvent" (
 id UUID PRIMARY KEY,"invoiceId" UUID NOT NULL REFERENCES "FinanceInvoice" ON DELETE RESTRICT,"partyId" UUID NOT NULL REFERENCES "FinanceParty" ON DELETE RESTRICT,
 "accountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,"journalId" UUID NOT NULL REFERENCES "FinanceJournalEntry" ON DELETE RESTRICT,
 "effectiveDate" DATE NOT NULL,kind TEXT NOT NULL CHECK(kind='INVOICE'),amount NUMERIC(20,2) NOT NULL CHECK(amount>0),currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),UNIQUE("invoiceId","journalId")
);
CREATE INDEX "FinanceReceivableEvent_partyId_effectiveDate_id_idx" ON "FinanceReceivableEvent"("partyId","effectiveDate",id);
CREATE TABLE "FinanceDeferredRevenueEvent" (
 id UUID PRIMARY KEY,"invoiceLineId" UUID NOT NULL REFERENCES "FinanceInvoiceLine" ON DELETE RESTRICT,"journalId" UUID NOT NULL REFERENCES "FinanceJournalEntry" ON DELETE RESTRICT,
 "effectiveDate" DATE NOT NULL,kind TEXT NOT NULL CHECK(kind='BILLED'),amount NUMERIC(20,2) NOT NULL CHECK(amount>0),currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),UNIQUE("invoiceLineId","journalId")
);
CREATE INDEX "FinanceDeferredRevenueEvent_effectiveDate_id_idx" ON "FinanceDeferredRevenueEvent"("effectiveDate",id);
CREATE TRIGGER "FinanceInvoice_config_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceInvoice" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceInvoiceLine_config_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceInvoiceLine" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceReceivableEvent_config_lock" BEFORE INSERT ON "FinanceReceivableEvent" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceDeferredRevenueEvent_config_lock" BEFORE INSERT ON "FinanceDeferredRevenueEvent" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceReceivableEvent_immutable" BEFORE UPDATE OR DELETE ON "FinanceReceivableEvent" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
CREATE TRIGGER "FinanceDeferredRevenueEvent_immutable" BEFORE UPDATE OR DELETE ON "FinanceDeferredRevenueEvent" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
CREATE FUNCTION encova_finance_party_snapshot(party_id UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('schemaVersion',1,'name',name,'legalName',"legalName",'kind',kind,'contactEmail',"contactEmail",'phone',phone,'address',address) FROM public."FinanceParty" WHERE id=party_id
$$;
CREATE FUNCTION encova_finance_invoice_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_INVOICE_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'DRAFT' OR NEW.version<>1 OR NEW."partySnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;RETURN NEW;
 END IF;
 IF OLD.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVOICE_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF ROW(NEW.id,NEW.number,NEW."createdById",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD.number,OLD."createdById",OLD."createdAt") OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
 IF NEW.state<>'DRAFT' AND (to_jsonb(NEW)-ARRAY['state','version','updatedAt','partySnapshot']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','updatedAt','partySnapshot']) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW.state='POSTED' THEN
  IF NEW."totalAmount"<=0 OR NEW."partySnapshot" IS DISTINCT FROM public.encova_finance_party_snapshot(NEW."partyId") OR NOT EXISTS(SELECT 1 FROM public."FinanceJournalEntry" WHERE "invoiceId"=NEW.id) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF NEW."partySnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FinanceInvoice_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceInvoice" FOR EACH ROW EXECUTE FUNCTION encova_finance_invoice_guard();
CREATE FUNCTION encova_finance_invoice_line_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; current_state TEXT;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.id,NEW."invoiceId") IS DISTINCT FROM ROW(OLD.id,OLD."invoiceId") THEN RAISE EXCEPTION 'FINANCE_INVOICE_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='DELETE' THEN target:=OLD."invoiceId";ELSE target:=NEW."invoiceId";END IF;
 SELECT state INTO current_state FROM public."FinanceInvoice" WHERE id=target FOR UPDATE;
 IF current_state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVOICE_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceInvoiceLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceInvoiceLine" FOR EACH ROW EXECUTE FUNCTION encova_finance_invoice_line_guard();
-- Reused by all source adapters; no cached or editable account balances.
CREATE FUNCTION encova_finance_mark_accounts(account_ids UUID[]) RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE public."FinanceAccount" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id IN (
 WITH RECURSIVE ancestors AS (SELECT id,"parentId" FROM public."FinanceAccount" WHERE id=ANY(account_ids)
 UNION SELECT a.id,a."parentId" FROM public."FinanceAccount" a JOIN ancestors p ON a.id=p."parentId") SELECT id FROM ancestors)
$$;
CREATE FUNCTION encova_finance_check_invoice(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE invoice public."FinanceInvoice"%ROWTYPE; entry public."FinanceJournalEntry"%ROWTYPE; count_lines BIGINT; gross NUMERIC; discounts NUMERIC; nets NUMERIC; totals NUMERIC;
BEGIN
 SELECT * INTO invoice FROM public."FinanceInvoice" WHERE id=target;
 IF invoice.id IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 SELECT count(*),coalesce(sum("lineAmount"),0),coalesce(sum("discountAmount"),0),coalesce(sum("netAmount"),0),coalesce(sum("totalAmount"),0) INTO count_lines,gross,discounts,nets,totals FROM public."FinanceInvoiceLine" WHERE "invoiceId"=target;
 IF count_lines NOT BETWEEN 1 AND 100 OR gross>999999999999999999.99 OR discounts>999999999999999999.99 OR nets>999999999999999999.99 OR totals>999999999999999999.99 OR ROW(invoice."lineAmount",invoice."discountAmount",invoice."netAmount",invoice."totalAmount") IS DISTINCT FROM ROW(gross,discounts,nets,totals) THEN RAISE EXCEPTION 'FINANCE_INVOICE_TOTALS' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM public."FinanceInvoiceLine" WHERE "invoiceId"=target AND "projectId" IS NULL AND invoice."projectId" IS NOT NULL) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 SELECT * INTO entry FROM public."FinanceJournalEntry" WHERE "invoiceId"=target;
 IF invoice.state<>'POSTED' THEN
  IF entry.id IS NOT NULL OR invoice."partySnapshot" IS NOT NULL OR EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" WHERE "invoiceId"=target) OR EXISTS(SELECT 1 FROM public."FinanceDeferredRevenueEvent" e JOIN public."FinanceInvoiceLine" l ON l.id=e."invoiceLineId" WHERE l."invoiceId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;
 END IF;
 IF invoice."totalAmount"<=0 OR invoice."partySnapshot" IS NULL OR entry.id IS NULL OR entry."sourceType"<>'INVOICE' OR entry."postingDate"<>invoice."postingDate" OR entry.description<>invoice.description OR entry.evidence<>invoice.evidence THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF (SELECT count(*) FROM public."FinanceJournalLine" WHERE "journalId"=entry.id) <> 1+(SELECT count(*) FROM public."FinanceInvoiceLine" WHERE "invoiceId"=target AND "totalAmount">0) OR NOT EXISTS(SELECT 1 FROM public."FinanceJournalLine" WHERE "journalId"=entry.id AND sequence=1 AND "accountId"=invoice."receivableAccountId" AND debit=invoice."totalAmount" AND credit=0 AND "partyId"=invoice."partyId" AND "invoiceLineId" IS NULL AND description=invoice.description AND "projectId" IS NOT DISTINCT FROM invoice."projectId") OR EXISTS(
  SELECT 1 FROM public."FinanceInvoiceLine" l WHERE l."invoiceId"=target AND l."totalAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceJournalLine" j WHERE j."journalId"=entry.id AND j.sequence=l.sequence+1 AND j."invoiceLineId"=l.id AND j."accountId"=CASE WHEN l.recognition='EARNED' THEN l."revenueAccountId" ELSE l."deferredAccountId" END AND j.debit=0 AND j.credit=l."totalAmount" AND j.description=l.description AND j."partyId"=invoice."partyId" AND j."projectId" IS NOT DISTINCT FROM l."projectId")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF (SELECT count(*) FROM public."FinanceReceivableEvent" WHERE "invoiceId"=target)<>1 OR NOT EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" WHERE "invoiceId"=target AND "journalId"=entry.id AND "partyId"=invoice."partyId" AND "accountId"=invoice."receivableAccountId" AND "effectiveDate"=invoice."postingDate" AND kind='INVOICE' AND amount=invoice."totalAmount") THEN RAISE EXCEPTION 'FINANCE_RECEIVABLE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF (SELECT count(*) FROM public."FinanceDeferredRevenueEvent" e JOIN public."FinanceInvoiceLine" l ON l.id=e."invoiceLineId" WHERE l."invoiceId"=target)<>(SELECT count(*) FROM public."FinanceInvoiceLine" WHERE "invoiceId"=target AND recognition='DEFERRED' AND "totalAmount">0) OR EXISTS(SELECT 1 FROM public."FinanceInvoiceLine" l WHERE l."invoiceId"=target AND l.recognition='DEFERRED' AND l."totalAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceDeferredRevenueEvent" e WHERE e."invoiceLineId"=l.id AND e."journalId"=entry.id AND e."effectiveDate"=invoice."postingDate" AND e.kind='BILLED' AND e.amount=l."totalAmount")) THEN RAISE EXCEPTION 'FINANCE_DEFERRED_MISMATCH' USING ERRCODE='P0001';END IF;
END $$;
CREATE FUNCTION encova_finance_invoice_check_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;
BEGIN
 IF TG_TABLE_NAME='FinanceInvoice' THEN target:=NEW.id;
 ELSIF TG_TABLE_NAME='FinanceDeferredRevenueEvent' THEN SELECT "invoiceId" INTO target FROM public."FinanceInvoiceLine" WHERE id=NEW."invoiceLineId";
 ELSIF TG_OP='DELETE' THEN target:=OLD."invoiceId";ELSE target:=NEW."invoiceId";END IF;
 PERFORM public.encova_finance_check_invoice(target);RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FinanceInvoice_valid" AFTER INSERT OR UPDATE ON "FinanceInvoice" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_invoice_check_trigger();
CREATE CONSTRAINT TRIGGER "FinanceInvoiceLine_valid" AFTER INSERT OR UPDATE OR DELETE ON "FinanceInvoiceLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_invoice_check_trigger();
CREATE CONSTRAINT TRIGGER "FinanceReceivableEvent_valid" AFTER INSERT ON "FinanceReceivableEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_invoice_check_trigger();
CREATE CONSTRAINT TRIGGER "FinanceDeferredRevenueEvent_valid" AFTER INSERT ON "FinanceDeferredRevenueEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_invoice_check_trigger();
CREATE OR REPLACE FUNCTION encova_finance_journal_header_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE period public."FinancePeriod"%ROWTYPE;
BEGIN
 SELECT * INTO period FROM public."FinancePeriod" WHERE id=NEW."periodId" FOR UPDATE;
 IF period.id IS NULL OR period.state<>'OPEN' OR NEW."postingDate" NOT BETWEEN period."startDate" AND period."endDate" THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 IF NEW."postingDate">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'FINANCE_FUTURE_DATE' USING ERRCODE='P0001'; END IF;
 IF NEW."sourceType"='INVOICE' AND NOT EXISTS(SELECT 1 FROM public."FinanceInvoice" WHERE id=NEW."invoiceId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
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
-- The single private emitter reads typed sources. Only session/reauth-checked
-- adapters may call it. No runtime EXECUTE is granted on this function.
CREATE FUNCTION encova_finance_emit_journal(actor UUID,source_kind TEXT,source_id UUID,posting_date DATE,reason TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE draft public."FinanceJournalDraft"%ROWTYPE; original public."FinanceJournalEntry"%ROWTYPE; invoice public."FinanceInvoice"%ROWTYPE;
 period_id UUID; entry_id UUID:=gen_random_uuid(); mappings UUID[];
BEGIN
 IF source_kind IS NULL OR source_kind NOT IN ('JOURNAL_DRAFT','JOURNAL_REVERSAL','INVOICE') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF source_kind='INVOICE' THEN
  SELECT * INTO invoice FROM public."FinanceInvoice" WHERE id=source_id FOR UPDATE;
  IF invoice.id IS NULL OR invoice.state<>'DRAFT' OR invoice."postingDate"<>posting_date THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  IF invoice."totalAmount"<=0 THEN RAISE EXCEPTION 'FINANCE_INVOICE_EMPTY' USING ERRCODE='P0001';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=invoice."partyId" AND active AND kind IN ('CLIENT','BOTH')) THEN RAISE EXCEPTION 'FINANCE_INVOICE_PARTY' USING ERRCODE='P0001';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=invoice."receivableAccountId" AND active AND "isPosting" AND NOT "isContra" AND currency='PKR' AND "controlType"='RECEIVABLES' AND type='ASSET') OR EXISTS(
   SELECT 1 FROM public."FinanceInvoiceLine" l JOIN public."FinanceAccount" a ON a.id=l."revenueAccountId" WHERE l."invoiceId"=source_id AND (NOT a.active OR NOT a."isPosting" OR a."isContra" OR a.currency<>'PKR' OR a.type NOT IN ('INCOME','OTHER_INCOME') OR a."controlType"<>'NONE')) OR EXISTS(
   SELECT 1 FROM public."FinanceInvoiceLine" l JOIN public."FinanceAccount" a ON a.id=l."deferredAccountId" WHERE l."invoiceId"=source_id AND l.recognition='DEFERRED' AND (NOT a.active OR NOT a."isPosting" OR a."isContra" OR a.currency<>'PKR' OR a.type<>'LIABILITY' OR a."controlType"<>'DEFERRED_REVENUE')) THEN RAISE EXCEPTION 'FINANCE_INVOICE_MAPPING' USING ERRCODE='P0001';END IF;
  IF (invoice."projectId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Project" WHERE id=invoice."projectId" AND "archivedAt" IS NULL)) OR EXISTS(SELECT 1 FROM public."FinanceInvoiceLine" l JOIN public."Project" p ON p.id=l."projectId" WHERE l."invoiceId"=source_id AND p."archivedAt" IS NOT NULL) THEN RAISE EXCEPTION 'FINANCE_PROJECT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
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

CREATE OR REPLACE FUNCTION encova_finance_ledger_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE draft public."FinanceJournalDraft"%ROWTYPE; original public."FinanceJournalEntry"%ROWTYPE; receipt public."FinanceLedgerReceipt"%ROWTYPE;
 period_id UUID; entry_id UUID; target UUID; line JSONB; position INTEGER:=0; result JSONB; digest TEXT; reason TEXT; item JSONB;
BEGIN
 IF action IS NULL OR action NOT IN ('CREATE','UPDATE','POST','VOID','REVERSE','BULK_VOID') OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001'; END IF;
 IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 reason:=trim(input->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 IF input - (CASE WHEN action='CREATE' THEN ARRAY['reference','description','evidence','postingDate','currency','lines','reason'] WHEN action='UPDATE' THEN ARRAY['id','expectedVersion','reference','description','evidence','postingDate','currency','lines','reason'] WHEN action='REVERSE' THEN ARRAY['id','expectedVersion','postingDate','reason'] WHEN action='BULK_VOID' THEN ARRAY['items','reason'] ELSE ARRAY['id','expectedVersion','reason'] END) <> '{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001'; END IF;
 digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation=action AND key=request_key;
 IF FOUND THEN IF receipt."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;RETURN receipt.result;END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action='BULK_VOID' THEN
  IF jsonb_typeof(input->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'items') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(input->'items'))<>jsonb_array_length(input->'items') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(input->'items') ORDER BY value->>'id' LOOP
   IF item-ARRAY['id','expectedVersion']<>'{}'::jsonb OR jsonb_typeof(item->'expectedVersion') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
   SELECT * INTO draft FROM public."FinanceJournalDraft" WHERE id=(item->>'id')::uuid FOR UPDATE;
   IF draft.id IS NULL OR draft.state<>'DRAFT' OR draft.version<>(item->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_BATCH_CONFLICT:%',item->>'id' USING ERRCODE='P0001'; END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(input->'items') ORDER BY value->>'id' LOOP
   UPDATE public."FinanceJournalDraft" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=(item->>'id')::uuid;
   INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_JOURNAL_VOID','FinanceJournalDraft',(item->>'id')::uuid,reason,jsonb_build_object('snapshot',(SELECT to_jsonb(d) FROM public."FinanceJournalDraft" d WHERE d.id=(item->>'id')::uuid),'lines',(SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('debit',l.debit::text,'credit',l.credit::text) ORDER BY sequence) FROM public."FinanceJournalDraftLine" l WHERE l."draftId"=(item->>'id')::uuid)),request_id);
  END LOOP;
  result:=jsonb_build_object('id',(input->'items'->0->>'id')::uuid,'version',(input->'items'->0->>'expectedVersion')::integer+1,'journalId',NULL,'items',(SELECT jsonb_agg(jsonb_build_object('id',value->>'id','version',(value->>'expectedVersion')::integer+1) ORDER BY value->>'id') FROM jsonb_array_elements(input->'items')));
 ELSE
  IF action<>'CREATE' THEN
   IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
   SELECT * INTO draft FROM public."FinanceJournalDraft" WHERE id=(input->>'id')::uuid FOR UPDATE;
   IF draft.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001'; END IF;
   IF draft.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001'; END IF;
   IF (action='REVERSE' AND draft.state<>'POSTED') OR (action<>'REVERSE' AND draft.state<>'DRAFT') THEN RAISE EXCEPTION 'FINANCE_DRAFT_IMMUTABLE' USING ERRCODE='P0001'; END IF;
  END IF;
  IF action IN ('CREATE','UPDATE') THEN
   IF jsonb_typeof(input->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'lines') NOT BETWEEN 1 AND 200 OR input->>'currency' IS DISTINCT FROM 'PKR' OR input->>'postingDate' IS NULL OR input->>'postingDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
   IF action='CREATE' THEN
    INSERT INTO public."FinanceJournalDraft"(id,reference,description,evidence,"postingDate",currency,"createdById") VALUES(gen_random_uuid(),input->>'reference',input->>'description',input->>'evidence',(input->>'postingDate')::date,'PKR',actor) RETURNING * INTO draft;
   ELSE
    UPDATE public."FinanceJournalDraft" SET reference=input->>'reference',description=input->>'description',evidence=input->>'evidence',"postingDate"=(input->>'postingDate')::date,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=draft.id RETURNING * INTO draft;
    DELETE FROM public."FinanceJournalDraftLine" WHERE "draftId"=draft.id;
   END IF;
   FOR line IN SELECT value FROM jsonb_array_elements(input->'lines') LOOP
    IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR line-ARRAY['accountId','description','debit','credit','projectId']<>'{}'::jsonb OR jsonb_typeof(line->'debit') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'credit') IS DISTINCT FROM 'string' OR line->>'debit' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR line->>'credit' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
    position:=position+1;
    INSERT INTO public."FinanceJournalDraftLine"(id,"draftId",sequence,"accountId",description,debit,credit,"projectId") VALUES(gen_random_uuid(),draft.id,position,(line->>'accountId')::uuid,line->>'description',(line->>'debit')::numeric,(line->>'credit')::numeric,nullif(line->>'projectId','')::uuid);
   END LOOP;
  ELSIF action='VOID' THEN
   UPDATE public."FinanceJournalDraft" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=draft.id RETURNING * INTO draft;
  ELSE
   IF action='POST' THEN
    entry_id:=public.encova_finance_emit_journal(actor,'JOURNAL_DRAFT',draft.id,draft."postingDate",reason);
   ELSE
    IF input->>'postingDate' IS NULL OR input->>'postingDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
    entry_id:=public.encova_finance_emit_journal(actor,'JOURNAL_REVERSAL',draft.id,(input->>'postingDate')::date,reason);
   END IF;
   SELECT * INTO draft FROM public."FinanceJournalDraft" WHERE id=draft.id;
  END IF;
  result:=jsonb_build_object('id',draft.id,'version',draft.version,'journalId',entry_id);
  INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_JOURNAL_'||action,'FinanceJournalDraft',draft.id,reason,jsonb_build_object('version',draft.version,'journalId',entry_id,'snapshot',to_jsonb(draft),'lines',(SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('debit',l.debit::text,'credit',l.credit::text) ORDER BY sequence) FROM public."FinanceJournalDraftLine" l WHERE l."draftId"=draft.id)),request_id);
 END IF;
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,action,request_key,digest,result);
 RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';
 WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;




CREATE FUNCTION encova_finance_invoice_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE invoice public."FinanceInvoice"%ROWTYPE; receipt public."FinanceLedgerReceipt"%ROWTYPE; entry_id UUID;
 reason TEXT; digest TEXT; operation_name TEXT; result JSONB; line JSONB; prepared JSONB:='[]';position INTEGER:=0;
 quantity_value NUMERIC;rate_value NUMERIC;rounded NUMERIC;discount_value NUMERIC;net_value NUMERIC;gross NUMERIC:=0;discounts NUMERIC:=0;net NUMERIC:=0;
 invoice_date DATE;posting_date DATE;due_date DATE;
BEGIN
 IF action IS NULL OR action NOT IN ('CREATE','UPDATE','POST','VOID') OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 reason:=trim(input->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF input-(CASE WHEN action='CREATE' THEN ARRAY['reference','partyId','receivableAccountId','projectId','invoiceDate','postingDate','dueDate','description','evidence','currency','lines','reason'] WHEN action='UPDATE' THEN ARRAY['id','expectedVersion','reference','partyId','receivableAccountId','projectId','invoiceDate','postingDate','dueDate','description','evidence','currency','lines','reason'] ELSE ARRAY['id','expectedVersion','reason'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF action<>'CREATE' AND (jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR (input->>'expectedVersion')::integer<1) THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 operation_name:='INVOICE_'||action;digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation=operation_name AND key=request_key;
 IF FOUND THEN IF receipt."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN receipt.result;END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action<>'CREATE' THEN
  SELECT * INTO invoice FROM public."FinanceInvoice" WHERE id=(input->>'id')::uuid FOR UPDATE;
  IF invoice.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF invoice.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF invoice.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_INVOICE_IMMUTABLE' USING ERRCODE='P0001';END IF;
 END IF;
 IF action IN ('CREATE','UPDATE') THEN
  IF input->>'currency' IS DISTINCT FROM 'PKR' OR jsonb_typeof(input->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'lines') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'invoiceDate') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'postingDate') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'dueDate') IS DISTINCT FROM 'string' OR input->>'invoiceDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR input->>'postingDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR input->>'dueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  invoice_date:=(input->>'invoiceDate')::date;posting_date:=(input->>'postingDate')::date;due_date:=(input->>'dueDate')::date;
  IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=(input->>'partyId')::uuid AND active AND kind IN ('CLIENT','BOTH')) THEN RAISE EXCEPTION 'FINANCE_INVOICE_PARTY' USING ERRCODE='P0001';END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(input->'lines') LOOP
   IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR line-ARRAY['description','quantity','unitRate','discountAmount','recognition','revenueAccountId','deferredAccountId','projectId']<>'{}'::jsonb OR jsonb_typeof(line->'quantity') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'unitRate') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'discountAmount') IS DISTINCT FROM 'string' OR line->>'quantity' !~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,6})?$' OR line->>'unitRate' !~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,6})?$' OR line->>'discountAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   quantity_value:=(line->>'quantity')::numeric;rate_value:=(line->>'unitRate')::numeric;rounded:=round(quantity_value*rate_value,2);discount_value:=(line->>'discountAmount')::numeric;net_value:=rounded-discount_value;
   IF quantity_value<=0 OR rounded>999999999999999999.99 OR discount_value>rounded THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   gross:=gross+rounded;discounts:=discounts+discount_value;net:=net+net_value;
   IF gross>999999999999999999.99 OR discounts>999999999999999999.99 OR net>999999999999999999.99 THEN RAISE EXCEPTION 'FINANCE_INVOICE_TOTALS' USING ERRCODE='P0001';END IF;
   position:=position+1;
   prepared:=prepared||jsonb_build_array(line||jsonb_build_object('sequence',position,'lineAmount',rounded::text,'netAmount',net_value::text));
  END LOOP;
  IF action='CREATE' THEN
   INSERT INTO public."FinanceInvoice"(id,reference,"partyId","receivableAccountId","projectId","invoiceDate","postingDate","dueDate",description,evidence,currency,"lineAmount","discountAmount","netAmount","taxAmount","totalAmount","createdById") VALUES(gen_random_uuid(),input->>'reference',(input->>'partyId')::uuid,(input->>'receivableAccountId')::uuid,nullif(input->>'projectId','')::uuid,invoice_date,posting_date,due_date,input->>'description',input->>'evidence','PKR',gross,discounts,net,0,net,actor) RETURNING * INTO invoice;
  ELSE
   UPDATE public."FinanceInvoice" SET reference=input->>'reference',"partyId"=(input->>'partyId')::uuid,"receivableAccountId"=(input->>'receivableAccountId')::uuid,"projectId"=nullif(input->>'projectId','')::uuid,"invoiceDate"=invoice_date,"postingDate"=posting_date,"dueDate"=due_date,description=input->>'description',evidence=input->>'evidence',"lineAmount"=gross,"discountAmount"=discounts,"netAmount"=net,"taxAmount"=0,"totalAmount"=net,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=invoice.id RETURNING * INTO invoice;
   DELETE FROM public."FinanceInvoiceLine" WHERE "invoiceId"=invoice.id;
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(prepared) LOOP
   INSERT INTO public."FinanceInvoiceLine"(id,"invoiceId",sequence,description,quantity,"unitRate","lineAmount","discountAmount","netAmount","taxAmount","totalAmount",recognition,"revenueAccountId","deferredAccountId","projectId") VALUES(gen_random_uuid(),invoice.id,(line->>'sequence')::integer,line->>'description',(line->>'quantity')::numeric,(line->>'unitRate')::numeric,(line->>'lineAmount')::numeric,(line->>'discountAmount')::numeric,(line->>'netAmount')::numeric,0,(line->>'netAmount')::numeric,line->>'recognition',(line->>'revenueAccountId')::uuid,nullif(line->>'deferredAccountId','')::uuid,coalesce(nullif(line->>'projectId','')::uuid,invoice."projectId"));
  END LOOP;
 ELSIF action='VOID' THEN
  UPDATE public."FinanceInvoice" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=invoice.id RETURNING * INTO invoice;
 ELSE
  entry_id:=public.encova_finance_emit_journal(actor,'INVOICE',invoice.id,invoice."postingDate",reason);
  SELECT * INTO invoice FROM public."FinanceInvoice" WHERE id=invoice.id;
 END IF;
 result:=jsonb_build_object('id',invoice.id,'version',invoice.version,'number',invoice.number,'journalId',entry_id);
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,operation_name,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_'||operation_name,'FinanceInvoice',invoice.id,reason,jsonb_build_object('journalId',entry_id,'snapshot',to_jsonb(invoice)||jsonb_build_object('lineAmount',invoice."lineAmount"::text,'discountAmount',invoice."discountAmount"::text,'netAmount',invoice."netAmount"::text,'taxAmount',invoice."taxAmount"::text,'totalAmount',invoice."totalAmount"::text),'lines',(SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('quantity',l.quantity::text,'unitRate',l."unitRate"::text,'lineAmount',l."lineAmount"::text,'discountAmount',l."discountAmount"::text,'netAmount',l."netAmount"::text,'taxAmount',l."taxAmount"::text,'totalAmount',l."totalAmount"::text) ORDER BY sequence) FROM public."FinanceInvoiceLine" l WHERE l."invoiceId"=invoice.id)),request_id);
 RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';
 WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;
DO $$ DECLARE t TEXT;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceInvoice','FinanceInvoiceLine','FinanceReceivableEvent','FinanceDeferredRevenueEvent'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon',t);END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated',t);END IF;
 END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('encova_finance_party_snapshot','encova_finance_invoice_guard','encova_finance_invoice_line_guard','encova_finance_mark_accounts','encova_finance_check_invoice','encova_finance_invoice_check_trigger','encova_finance_emit_journal','encova_finance_invoice_command') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon',f.signature);END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated',f.signature);END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM encova_app',f.signature);END IF;
 END LOOP;
 REVOKE ALL ON SEQUENCE public.finance_invoice_number FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON SEQUENCE public.finance_invoice_number FROM anon;END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON SEQUENCE public.finance_invoice_number FROM authenticated;END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN
  REVOKE ALL ON SEQUENCE public.finance_invoice_number FROM encova_app;
  GRANT EXECUTE ON FUNCTION encova_finance_invoice_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID) TO encova_app;
 END IF;
END $$;
COMMIT;
