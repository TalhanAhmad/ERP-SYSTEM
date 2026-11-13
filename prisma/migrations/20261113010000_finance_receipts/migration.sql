BEGIN;
CREATE SEQUENCE public.finance_customer_number AS BIGINT MINVALUE 1 MAXVALUE 9999999999 START 1 NO CYCLE;
CREATE TABLE "FinanceCustomerDocument" (
 id UUID PRIMARY KEY,number TEXT NOT NULL UNIQUE DEFAULT('RCP-'||lpad(nextval('public.finance_customer_number'::regclass)::text,10,'0')) CHECK(number~'^RCP-[0-9]{10}$'),kind TEXT NOT NULL CHECK(kind='RECEIPT'),
 reference TEXT NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 80),"partyId" UUID NOT NULL REFERENCES "FinanceParty" ON DELETE RESTRICT,"cashAccountId" UUID REFERENCES "FinanceCashAccount" ON DELETE RESTRICT,"feeAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,"projectId" UUID REFERENCES "Project" ON DELETE RESTRICT,
 "documentDate" DATE NOT NULL CHECK("documentDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),"postingDate" DATE NOT NULL CHECK("postingDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' AND "postingDate">="documentDate"),
 description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 1000),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','POSTED','VOIDED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "cashAmount" NUMERIC(20,2) NOT NULL CHECK("cashAmount">0),"feeAmount" NUMERIC(20,2) NOT NULL CHECK("feeAmount">=0),"allocationAmount" NUMERIC(20,2) NOT NULL CHECK("allocationAmount">0),"totalAmount" NUMERIC(20,2) NOT NULL CHECK("totalAmount"="cashAmount"+"feeAmount" AND "totalAmount"="allocationAmount"),CHECK(("feeAmount">0)=("feeAccountId" IS NOT NULL)),CHECK("cashAccountId" IS NOT NULL),
 "partySnapshot" JSONB,"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FinanceCustomerDocument_kind_postingDate_id_idx" ON "FinanceCustomerDocument"(kind,"postingDate",id);
CREATE TABLE "FinanceCustomerAllocation"(id UUID PRIMARY KEY,"documentId" UUID NOT NULL REFERENCES "FinanceCustomerDocument" ON DELETE RESTRICT,"invoiceId" UUID NOT NULL REFERENCES "FinanceInvoice" ON DELETE RESTRICT,sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 100),amount NUMERIC(20,2) NOT NULL CHECK(amount>0),UNIQUE("documentId","invoiceId"),UNIQUE("documentId",sequence));
ALTER TABLE "FinanceJournalEntry" ADD COLUMN "customerDocumentId" UUID UNIQUE REFERENCES "FinanceCustomerDocument" ON DELETE RESTRICT;
ALTER TABLE "FinanceJournalEntry" DROP CONSTRAINT "FinanceJournalEntry_source_identity";
ALTER TABLE "FinanceJournalEntry" ADD CONSTRAINT "FinanceJournalEntry_source_identity" CHECK(
 ("sourceType"='JOURNAL_DRAFT' AND "sourceAction"='POST' AND "draftId"="sourceId" AND "draftId" IS NOT NULL AND "reversalOfId" IS NULL AND "invoiceId" IS NULL AND "customerDocumentId" IS NULL) OR
 ("sourceType"='JOURNAL_REVERSAL' AND "sourceAction"='REVERSE' AND "reversalOfId"="sourceId" AND "reversalOfId" IS NOT NULL AND "draftId" IS NULL AND "invoiceId" IS NULL AND "customerDocumentId" IS NULL) OR
 ("sourceType"='INVOICE' AND "sourceAction"='POST' AND "invoiceId"="sourceId" AND "invoiceId" IS NOT NULL AND "draftId" IS NULL AND "reversalOfId" IS NULL AND "customerDocumentId" IS NULL) OR
 ("sourceType"='CUSTOMER_DOCUMENT' AND "sourceAction"='POST' AND "customerDocumentId"="sourceId" AND "customerDocumentId" IS NOT NULL AND "invoiceId" IS NULL AND "draftId" IS NULL AND "reversalOfId" IS NULL));
ALTER TABLE "FinanceReceivableEvent" ADD COLUMN "customerDocumentId" UUID REFERENCES "FinanceCustomerDocument" ON DELETE RESTRICT;
ALTER TABLE "FinanceReceivableEvent" DROP CONSTRAINT "FinanceReceivableEvent_kind_check",DROP CONSTRAINT "FinanceReceivableEvent_amount_check";
ALTER TABLE "FinanceReceivableEvent" ADD CONSTRAINT "FinanceReceivableEvent_source_kind" CHECK((kind='INVOICE' AND amount>0 AND "customerDocumentId" IS NULL) OR(kind='RECEIPT' AND amount<0 AND "customerDocumentId" IS NOT NULL));
CREATE TRIGGER "FinanceCustomerDocument_config_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceCustomerDocument" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceCustomerAllocation_config_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceCustomerAllocation" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE FUNCTION encova_finance_customer_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN IF NEW.state<>'DRAFT' OR NEW.version<>1 OR NEW."partySnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;RETURN NEW;END IF;
 IF OLD.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF ROW(NEW.id,NEW.number,NEW.kind,NEW."createdById",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD.number,OLD.kind,OLD."createdById",OLD."createdAt") OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
 IF NEW.state<>'DRAFT' AND (to_jsonb(NEW)-ARRAY['state','version','updatedAt','partySnapshot']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','updatedAt','partySnapshot']) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW.state='POSTED' THEN IF NEW."partySnapshot" IS DISTINCT FROM public.encova_finance_party_snapshot(NEW."partyId") OR NOT EXISTS(SELECT 1 FROM public."FinanceJournalEntry" WHERE "customerDocumentId"=NEW.id) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF NEW."partySnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceCustomerDocument_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceCustomerDocument" FOR EACH ROW EXECUTE FUNCTION encova_finance_customer_guard();
CREATE FUNCTION encova_finance_customer_allocation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;s TEXT;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.id,NEW."documentId") IS DISTINCT FROM ROW(OLD.id,OLD."documentId") THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 target:=CASE WHEN TG_OP='DELETE' THEN OLD."documentId" ELSE NEW."documentId" END;
 SELECT state INTO s FROM public."FinanceCustomerDocument" WHERE id=target FOR UPDATE;
 IF s IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
CREATE TRIGGER "FinanceCustomerAllocation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceCustomerAllocation" FOR EACH ROW EXECUTE FUNCTION encova_finance_customer_allocation_guard();
-- Reserve capacity at the candidate date AND every later effective date.
CREATE FUNCTION encova_finance_ar_capacity(target UUID,cutoff DATE) RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(min((SELECT coalesce(sum(e.amount),0) FROM public."FinanceReceivableEvent" e WHERE e."invoiceId"=target AND e."effectiveDate"<=dates.d)),0) FROM(SELECT cutoff AS d UNION SELECT "effectiveDate" FROM public."FinanceReceivableEvent" WHERE "invoiceId"=target AND "effectiveDate">=cutoff)dates
$$;
CREATE FUNCTION encova_finance_customer_lines(target UUID) RETURNS TABLE(sequence INTEGER,"accountId" UUID,description TEXT,debit NUMERIC,credit NUMERIC,"projectId" UUID,"partyId" UUID,"invoiceLineId" UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT 1,c."glAccountId",d.description,d."cashAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d JOIN public."FinanceCashAccount" c ON c.id=d."cashAccountId" WHERE d.id=target
 UNION ALL SELECT 2,d."feeAccountId",d.description,d."feeAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d."feeAmount">0
 UNION ALL SELECT 10+a.sequence,i."receivableAccountId",d.description,0::numeric,a.amount,i."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerAllocation" a ON a."documentId"=d.id JOIN public."FinanceInvoice" i ON i.id=a."invoiceId" WHERE d.id=target
$$;
CREATE FUNCTION encova_finance_customer_validate(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;a record;
BEGIN
 SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=target;
 IF d.id IS NULL OR d.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=d."partyId" AND kind IN('CLIENT','BOTH')) THEN RAISE EXCEPTION 'FINANCE_INVOICE_PARTY' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" gl ON gl.id=c."glAccountId" WHERE c.id=d."cashAccountId" AND c.active AND gl.active AND gl."isPosting" AND NOT gl."isContra" AND gl."controlType"='CASH' AND gl.type='ASSET' AND gl.currency='PKR' AND c.currency='PKR') THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_MAPPING' USING ERRCODE='P0001';END IF;
 IF d."feeAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."feeAccountId" AND active AND "isPosting" AND NOT "isContra" AND "controlType"='NONE' AND type IN('DIRECT_COST','OPERATING_EXPENSE','OTHER_EXPENSE') AND currency='PKR') THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_MAPPING' USING ERRCODE='P0001';END IF;
 IF d."projectId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Project" WHERE id=d."projectId" AND "archivedAt" IS NULL) AND NOT EXISTS(SELECT 1 FROM public."FinanceCustomerAllocation" a JOIN public."FinanceInvoice" i ON i.id=a."invoiceId" WHERE a."documentId"=target AND i."projectId"=d."projectId") THEN RAISE EXCEPTION 'FINANCE_PROJECT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 FOR a IN SELECT x.*,i.state,i."partyId",i.currency,i."postingDate" FROM public."FinanceCustomerAllocation" x JOIN public."FinanceInvoice" i ON i.id=x."invoiceId" WHERE x."documentId"=target ORDER BY x."invoiceId" LOOP
  IF a.state<>'POSTED' OR a."partyId"<>d."partyId" OR a.currency<>d.currency OR a."postingDate">d."postingDate" OR a.amount>public.encova_finance_ar_capacity(a."invoiceId",d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 END LOOP;
END $$;
CREATE FUNCTION encova_finance_check_customer(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;e public."FinanceJournalEntry"%ROWTYPE;n BIGINT;amount NUMERIC;bad BOOLEAN;
BEGIN
 SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=target;
 IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 SELECT count(*),coalesce(sum(a.amount),0) INTO n,amount FROM public."FinanceCustomerAllocation" a WHERE a."documentId"=target;
 IF n NOT BETWEEN 1 AND 100 OR amount<>d."allocationAmount" THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_TOTALS' USING ERRCODE='P0001';END IF;
 SELECT * INTO e FROM public."FinanceJournalEntry" WHERE "customerDocumentId"=target;
 IF d.state<>'POSTED' THEN IF e.id IS NOT NULL OR EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" WHERE "customerDocumentId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;END IF;
 IF e.id IS NULL OR e."sourceType"<>'CUSTOMER_DOCUMENT' OR e."postingDate"<>d."postingDate" OR e.description<>d.description OR e.evidence<>d.evidence OR d."partySnapshot" IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id) EXCEPT(SELECT * FROM public.encova_finance_customer_lines(target))) OR EXISTS((SELECT * FROM public.encova_finance_customer_lines(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF (SELECT count(*) FROM public."FinanceReceivableEvent" WHERE "customerDocumentId"=target)<>n OR EXISTS(SELECT 1 FROM public."FinanceCustomerAllocation" a JOIN public."FinanceInvoice" i ON i.id=a."invoiceId" WHERE a."documentId"=target AND NOT EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" v WHERE v."customerDocumentId"=target AND v."invoiceId"=i.id AND v."partyId"=d."partyId" AND v."accountId"=i."receivableAccountId" AND v."journalId"=e.id AND v."effectiveDate"=d."postingDate" AND v.kind='RECEIPT' AND v.amount=-a.amount)) THEN RAISE EXCEPTION 'FINANCE_RECEIVABLE_MISMATCH' USING ERRCODE='P0001';END IF;
 SELECT EXISTS(SELECT 1 FROM(SELECT sum(v.amount) OVER(PARTITION BY v."invoiceId" ORDER BY v."effectiveDate" RANGE UNBOUNDED PRECEDING) AS balance FROM public."FinanceReceivableEvent" v WHERE v."invoiceId" IN(SELECT "invoiceId" FROM public."FinanceCustomerAllocation" WHERE "documentId"=target))b WHERE balance<0) INTO bad;
 IF bad THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
END $$;
CREATE FUNCTION encova_finance_customer_check_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;BEGIN
 IF TG_TABLE_NAME='FinanceCustomerDocument' THEN target:=NEW.id;
 ELSIF TG_TABLE_NAME='FinanceCustomerAllocation' THEN target:=CASE WHEN TG_OP='DELETE' THEN OLD."documentId" ELSE NEW."documentId" END;
 ELSE target:=NEW."customerDocumentId";END IF;
 IF target IS NOT NULL THEN PERFORM public.encova_finance_check_customer(target);END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FinanceCustomerDocument_valid" AFTER INSERT OR UPDATE ON "FinanceCustomerDocument" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_customer_check_trigger();
CREATE CONSTRAINT TRIGGER "FinanceCustomerAllocation_valid" AFTER INSERT OR UPDATE OR DELETE ON "FinanceCustomerAllocation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_customer_check_trigger();
CREATE CONSTRAINT TRIGGER "FinanceReceivableEvent_customer_valid" AFTER INSERT ON "FinanceReceivableEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_customer_check_trigger();
CREATE FUNCTION encova_finance_customer_effects(actor UUID,target UUID,entry_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;BEGIN
 SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=target;
 INSERT INTO public."FinanceReceivableEvent"(id,"invoiceId","partyId","accountId","journalId","effectiveDate",kind,amount,"customerDocumentId") SELECT gen_random_uuid(),i.id,d."partyId",i."receivableAccountId",entry_id,d."postingDate",'RECEIPT',-a.amount,d.id FROM public."FinanceCustomerAllocation" a JOIN public."FinanceInvoice" i ON i.id=a."invoiceId" WHERE a."documentId"=target;
 UPDATE public."FinanceCashAccount" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=d."cashAccountId";
 UPDATE public."FinanceParty" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=d."partyId";
 UPDATE public."FinanceCustomerDocument" SET state='POSTED',version=version+1,"partySnapshot"=public.encova_finance_party_snapshot("partyId"),"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;
END $$;

CREATE OR REPLACE FUNCTION encova_finance_check_invoice(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 IF (SELECT count(*) FROM public."FinanceReceivableEvent" WHERE "invoiceId"=target AND kind='INVOICE')<>1 OR NOT EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" WHERE "invoiceId"=target AND "journalId"=entry.id AND "partyId"=invoice."partyId" AND "accountId"=invoice."receivableAccountId" AND "effectiveDate"=invoice."postingDate" AND kind='INVOICE' AND amount=invoice."totalAmount") THEN RAISE EXCEPTION 'FINANCE_RECEIVABLE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF (SELECT count(*) FROM public."FinanceDeferredRevenueEvent" e JOIN public."FinanceInvoiceLine" l ON l.id=e."invoiceLineId" WHERE l."invoiceId"=target)<>(SELECT count(*) FROM public."FinanceInvoiceLine" WHERE "invoiceId"=target AND recognition='DEFERRED' AND "totalAmount">0) OR EXISTS(SELECT 1 FROM public."FinanceInvoiceLine" l WHERE l."invoiceId"=target AND l.recognition='DEFERRED' AND l."totalAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceDeferredRevenueEvent" e WHERE e."invoiceLineId"=l.id AND e."journalId"=entry.id AND e."effectiveDate"=invoice."postingDate" AND e.kind='BILLED' AND e.amount=l."totalAmount")) THEN RAISE EXCEPTION 'FINANCE_DEFERRED_MISMATCH' USING ERRCODE='P0001';END IF;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_journal_header_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE period public."FinancePeriod"%ROWTYPE;
BEGIN
 SELECT * INTO period FROM public."FinancePeriod" WHERE id=NEW."periodId" FOR UPDATE;
 IF period.id IS NULL OR period.state<>'OPEN' OR NEW."postingDate" NOT BETWEEN period."startDate" AND period."endDate" THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 IF NEW."postingDate">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'FINANCE_FUTURE_DATE' USING ERRCODE='P0001'; END IF;
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
DECLARE draft public."FinanceJournalDraft"%ROWTYPE; original public."FinanceJournalEntry"%ROWTYPE; invoice public."FinanceInvoice"%ROWTYPE;
 period_id UUID; entry_id UUID:=gen_random_uuid(); mappings UUID[]; customer public."FinanceCustomerDocument"%ROWTYPE;
BEGIN
 IF source_kind IS NULL OR source_kind NOT IN ('JOURNAL_DRAFT','JOURNAL_REVERSAL','INVOICE','CUSTOMER_DOCUMENT') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
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
CREATE FUNCTION encova_finance_customer_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,resource TEXT,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;item JSONB;n INTEGER:=0;allocations NUMERIC:=0;cash NUMERIC;fee NUMERIC;entry_id UUID;digest TEXT;operation_name TEXT;reason TEXT;result JSONB;
BEGIN
 IF resource IS DISTINCT FROM 'RECEIPT' OR action IS NULL OR action NOT IN('CREATE','UPDATE','POST','VOID') OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 reason:=trim(input->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF input-(CASE WHEN action='CREATE' THEN ARRAY['reference','partyId','cashAccountId','feeAccountId','projectId','documentDate','postingDate','description','evidence','currency','cashAmount','feeAmount','allocations','reason'] WHEN action='UPDATE' THEN ARRAY['id','expectedVersion','reference','partyId','cashAccountId','feeAccountId','projectId','documentDate','postingDate','description','evidence','currency','cashAmount','feeAmount','allocations','reason'] ELSE ARRAY['id','expectedVersion','reason'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF action<>'CREATE' AND(jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR(input->>'expectedVersion')::integer<1) THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 operation_name:=resource||'_'||action;digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');SELECT * INTO r FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation=operation_name AND key=request_key;
 IF FOUND THEN IF r."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN r.result;END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action<>'CREATE' THEN SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=(input->>'id')::uuid AND kind=resource FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF d.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF d.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 END IF;
 IF action IN('CREATE','UPDATE') THEN
  IF input->>'currency' IS DISTINCT FROM 'PKR' OR jsonb_typeof(input->'allocations') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'allocations') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'cashAmount') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'feeAmount') IS DISTINCT FROM 'string' OR input->>'cashAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR input->>'feeAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF input->>'documentDate' IS NULL OR input->>'postingDate' IS NULL OR input->>'documentDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR input->>'postingDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=(input->>'partyId')::uuid AND kind IN('CLIENT','BOTH')) THEN RAISE EXCEPTION 'FINANCE_INVOICE_PARTY' USING ERRCODE='P0001';END IF;
  cash:=(input->>'cashAmount')::numeric;fee:=(input->>'feeAmount')::numeric;
  FOR item IN SELECT value FROM jsonb_array_elements(input->'allocations') LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['invoiceId','amount']<>'{}'::jsonb OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'string' OR item->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR(item->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;allocations:=allocations+(item->>'amount')::numeric;
  END LOOP;
  IF cash<=0 OR cash+fee<>allocations OR allocations>999999999999999999.99 THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_TOTALS' USING ERRCODE='P0001';END IF;
  IF action='CREATE' THEN INSERT INTO public."FinanceCustomerDocument"(id,kind,reference,"partyId","cashAccountId","feeAccountId","projectId","documentDate","postingDate",description,evidence,currency,"cashAmount","feeAmount","allocationAmount","totalAmount","createdById") VALUES(gen_random_uuid(),resource,input->>'reference',(input->>'partyId')::uuid,(input->>'cashAccountId')::uuid,nullif(input->>'feeAccountId','')::uuid,nullif(input->>'projectId','')::uuid,(input->>'documentDate')::date,(input->>'postingDate')::date,input->>'description',input->>'evidence','PKR',cash,fee,allocations,cash+fee,actor) RETURNING * INTO d;
  ELSE UPDATE public."FinanceCustomerDocument" SET reference=input->>'reference',"partyId"=(input->>'partyId')::uuid,"cashAccountId"=(input->>'cashAccountId')::uuid,"feeAccountId"=nullif(input->>'feeAccountId','')::uuid,"projectId"=nullif(input->>'projectId','')::uuid,"documentDate"=(input->>'documentDate')::date,"postingDate"=(input->>'postingDate')::date,description=input->>'description',evidence=input->>'evidence',"cashAmount"=cash,"feeAmount"=fee,"allocationAmount"=allocations,"totalAmount"=cash+fee,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;DELETE FROM public."FinanceCustomerAllocation" WHERE "documentId"=d.id;END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(input->'allocations') LOOP n:=n+1;INSERT INTO public."FinanceCustomerAllocation"(id,"documentId","invoiceId",sequence,amount) VALUES(gen_random_uuid(),d.id,(item->>'invoiceId')::uuid,n,(item->>'amount')::numeric);END LOOP;
 ELSIF action='VOID' THEN UPDATE public."FinanceCustomerDocument" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
 ELSE entry_id:=public.encova_finance_emit_journal(actor,'CUSTOMER_DOCUMENT',d.id,d."postingDate",reason);SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=d.id;END IF;
 result:=jsonb_build_object('id',d.id,'version',d.version,'number',d.number,'journalId',entry_id);
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,operation_name,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_'||operation_name,'FinanceCustomerDocument',d.id,reason,jsonb_build_object('journalId',entry_id,'snapshot',to_jsonb(d)||jsonb_build_object('cashAmount',d."cashAmount"::text,'feeAmount',d."feeAmount"::text,'allocationAmount',d."allocationAmount"::text,'totalAmount',d."totalAmount"::text),'allocations',(SELECT jsonb_agg(to_jsonb(a)||jsonb_build_object('amount',a.amount::text) ORDER BY sequence) FROM public."FinanceCustomerAllocation" a WHERE a."documentId"=d.id)),request_id);RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';
 WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END $$;

DO $$ DECLARE t TEXT;f record;role_name TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceCustomerDocument','FinanceCustomerAllocation'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,role_name);END IF;END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM encova_app',t);EXECUTE format('GRANT SELECT ON TABLE public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_runtime ON public.%I TO encova_app USING(true)',t);END IF;
 END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND(proname LIKE 'encova_finance_customer_%' OR proname IN('encova_finance_check_customer','encova_finance_ar_capacity')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','encova_app'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name);END IF;END LOOP;
 END LOOP;
 REVOKE ALL ON SEQUENCE public.finance_customer_number FROM PUBLIC;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','encova_app'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON SEQUENCE public.finance_customer_number FROM %I',role_name);END IF;END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION encova_finance_customer_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,JSONB,TEXT,UUID) TO encova_app;END IF;
END $$;
COMMIT;
