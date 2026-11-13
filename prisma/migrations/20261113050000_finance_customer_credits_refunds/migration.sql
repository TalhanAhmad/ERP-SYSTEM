BEGIN;
ALTER TABLE "FinanceCustomerDocument" ADD COLUMN "creditInvoiceId" UUID REFERENCES "FinanceInvoice" ON DELETE RESTRICT,ADD COLUMN "reversalOfId" UUID UNIQUE REFERENCES "FinanceCustomerDocument" ON DELETE RESTRICT,ADD COLUMN "unallocationOfId" UUID UNIQUE REFERENCES "FinanceCustomerDocument" ON DELETE RESTRICT;
ALTER TABLE "FinanceCustomerDocument" DROP CONSTRAINT "FinanceCustomerDocument_kind_check",DROP CONSTRAINT "FinanceCustomerDocument_number_kind",DROP CONSTRAINT "FinanceCustomerDocument_commercial_source";
ALTER TABLE "FinanceCustomerDocument" ADD CONSTRAINT "FinanceCustomerDocument_kind_check" CHECK(kind IN('RECEIPT','ADVANCE_APPLICATION','CUSTOMER_CREDIT','CUSTOMER_REFUND','UNALLOCATION','REVERSAL')),ADD CONSTRAINT "FinanceCustomerDocument_number_kind" CHECK(number~'^(RCP|AAP|CN|RFN|UAL|REV)-[0-9]{10}$' AND split_part(number,'-',1)=CASE kind WHEN 'RECEIPT' THEN 'RCP' WHEN 'ADVANCE_APPLICATION' THEN 'AAP' WHEN 'CUSTOMER_CREDIT' THEN 'CN' WHEN 'CUSTOMER_REFUND' THEN 'RFN' WHEN 'UNALLOCATION' THEN 'UAL' ELSE 'REV' END),ADD CONSTRAINT "FinanceCustomerDocument_commercial_source" CHECK(
 (kind='RECEIPT' AND "cashAmount">0 AND "cashAccountId" IS NOT NULL AND "sourceDocumentId" IS NULL AND "totalAmount"="cashAmount"+"feeAmount" AND "totalAmount"="allocationAmount"+"advanceAmount" AND ("advanceAmount">0)=("advanceAccountId" IS NOT NULL) AND "creditInvoiceId" IS NULL AND "reversalOfId" IS NULL AND "unallocationOfId" IS NULL) OR
 (kind='ADVANCE_APPLICATION' AND "cashAmount"=0 AND "feeAmount"=0 AND "cashAccountId" IS NULL AND "sourceDocumentId" IS NOT NULL AND "sourceDocumentId"<>id AND "advanceAccountId" IS NOT NULL AND "advanceAmount"=0 AND "allocationAmount">0 AND "totalAmount"="allocationAmount" AND "creditInvoiceId" IS NULL AND "reversalOfId" IS NULL AND "unallocationOfId" IS NULL) OR
 (kind='CUSTOMER_CREDIT' AND "cashAmount"=0 AND "feeAmount"=0 AND "cashAccountId" IS NULL AND "sourceDocumentId" IS NULL AND "creditInvoiceId" IS NOT NULL AND "advanceAccountId" IS NOT NULL AND "advanceAmount"=0 AND "allocationAmount"=0 AND "reversalOfId" IS NULL AND "unallocationOfId" IS NULL) OR
 (kind='CUSTOMER_REFUND' AND "cashAmount">0 AND "totalAmount"="cashAmount" AND "feeAmount"=0 AND "cashAccountId" IS NOT NULL AND "sourceDocumentId" IS NOT NULL AND "sourceDocumentId"<>id AND "advanceAccountId" IS NOT NULL AND "advanceAmount"=0 AND "allocationAmount"=0 AND "creditInvoiceId" IS NULL AND "reversalOfId" IS NULL AND "unallocationOfId" IS NULL) OR
 (kind='UNALLOCATION' AND "cashAmount"=0 AND "feeAmount"=0 AND "cashAccountId" IS NULL AND "sourceDocumentId"="unallocationOfId" AND "unallocationOfId" IS NOT NULL AND "unallocationOfId"<>id AND "advanceAccountId" IS NOT NULL AND "totalAmount"="allocationAmount" AND "totalAmount"="advanceAmount" AND "creditInvoiceId" IS NULL AND "reversalOfId" IS NULL) OR
 (kind='REVERSAL' AND "reversalOfId" IS NOT NULL AND "reversalOfId"<>id AND "unallocationOfId" IS NULL));
CREATE TABLE "FinanceCustomerCreditLine"(id UUID PRIMARY KEY,"documentId" UUID NOT NULL REFERENCES "FinanceCustomerDocument" ON DELETE RESTRICT,"invoiceLineId" UUID NOT NULL REFERENCES "FinanceInvoiceLine" ON DELETE RESTRICT,sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 100),amount NUMERIC(20,2) NOT NULL CHECK(amount>0),UNIQUE("documentId","invoiceLineId"),UNIQUE("documentId",sequence));
CREATE TABLE "FinanceCustomerCreditSplit"("documentId" UUID PRIMARY KEY REFERENCES "FinanceCustomerDocument" ON DELETE RESTRICT,"arAmount" NUMERIC(20,2) NOT NULL CHECK("arAmount">=0),"balanceAmount" NUMERIC(20,2) NOT NULL CHECK("balanceAmount">=0),CHECK("arAmount"+"balanceAmount">0));
CREATE TABLE "FinanceInvoiceCreditEvent"(id UUID PRIMARY KEY,"invoiceLineId" UUID NOT NULL REFERENCES "FinanceInvoiceLine" ON DELETE RESTRICT,"customerDocumentId" UUID NOT NULL REFERENCES "FinanceCustomerDocument" ON DELETE RESTRICT,"journalId" UUID NOT NULL REFERENCES "FinanceJournalEntry" ON DELETE RESTRICT,"effectiveDate" DATE NOT NULL,kind TEXT NOT NULL,amount NUMERIC(20,2) NOT NULL,currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),CHECK((kind='CUSTOMER_CREDIT' AND amount<0) OR(kind='REVERSAL' AND amount>0)),UNIQUE("customerDocumentId","invoiceLineId"));
CREATE INDEX "FinanceInvoiceCreditEvent_invoiceLineId_effectiveDate_id_idx" ON "FinanceInvoiceCreditEvent"("invoiceLineId","effectiveDate",id);
ALTER TABLE "FinanceDeferredRevenueEvent" ADD COLUMN "customerDocumentId" UUID REFERENCES "FinanceCustomerDocument" ON DELETE RESTRICT;
ALTER TABLE "FinanceDeferredRevenueEvent" DROP CONSTRAINT "FinanceDeferredRevenueEvent_kind_check",DROP CONSTRAINT "FinanceDeferredRevenueEvent_amount_check";
ALTER TABLE "FinanceDeferredRevenueEvent" ADD CONSTRAINT "FinanceDeferredRevenueEvent_source_kind" CHECK((kind='BILLED' AND amount>0 AND "customerDocumentId" IS NULL) OR(kind='CUSTOMER_CREDIT' AND amount<0 AND "customerDocumentId" IS NOT NULL) OR(kind='REVERSAL' AND amount>0 AND "customerDocumentId" IS NOT NULL));
ALTER TABLE "FinanceReceivableEvent" DROP CONSTRAINT "FinanceReceivableEvent_source_kind";
ALTER TABLE "FinanceReceivableEvent" ADD CONSTRAINT "FinanceReceivableEvent_source_kind" CHECK((kind='INVOICE' AND amount>0 AND "customerDocumentId" IS NULL) OR(kind IN('RECEIPT','ADVANCE_APPLICATION','CUSTOMER_CREDIT') AND amount<0 AND "customerDocumentId" IS NOT NULL) OR(kind='UNALLOCATION' AND amount>0 AND "customerDocumentId" IS NOT NULL) OR(kind='REVERSAL' AND amount<>0 AND "customerDocumentId" IS NOT NULL));
ALTER TABLE "FinanceClientBalanceEvent" DROP CONSTRAINT "FinanceClientBalanceEvent_check";
ALTER TABLE "FinanceClientBalanceEvent" ADD CONSTRAINT "FinanceClientBalanceEvent_source_kind" CHECK((kind IN('RECEIVED','CREDITED','RELEASED') AND amount>0) OR(kind IN('APPLIED','REFUNDED') AND amount<0) OR(kind='REVERSAL' AND amount<>0));
CREATE TRIGGER "FinanceCustomerCreditLine_config_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceCustomerCreditLine" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceCustomerCreditLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceCustomerCreditLine" FOR EACH ROW EXECUTE FUNCTION encova_finance_customer_allocation_guard();
CREATE TRIGGER "FinanceCustomerCreditSplit_config_lock" BEFORE INSERT ON "FinanceCustomerCreditSplit" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceCustomerCreditSplit_immutable" BEFORE UPDATE OR DELETE ON "FinanceCustomerCreditSplit" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
CREATE TRIGGER "FinanceInvoiceCreditEvent_config_lock" BEFORE INSERT ON "FinanceInvoiceCreditEvent" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceInvoiceCreditEvent_immutable" BEFORE UPDATE OR DELETE ON "FinanceInvoiceCreditEvent" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
CREATE FUNCTION encova_finance_credit_capacity(target UUID,cutoff DATE) RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(min(l."totalAmount"+(SELECT coalesce(sum(e.amount),0) FROM public."FinanceInvoiceCreditEvent" e WHERE e."invoiceLineId"=target AND e."effectiveDate"<=dates.d)),0) FROM public."FinanceInvoiceLine" l CROSS JOIN(SELECT cutoff AS d UNION SELECT "effectiveDate" FROM public."FinanceInvoiceCreditEvent" WHERE "invoiceLineId"=target AND "effectiveDate">=cutoff)dates WHERE l.id=target
$$;
CREATE FUNCTION encova_finance_deferred_capacity(target UUID,cutoff DATE) RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(min((SELECT coalesce(sum(e.amount),0) FROM public."FinanceDeferredRevenueEvent" e WHERE e."invoiceLineId"=target AND e."effectiveDate"<=dates.d)),0) FROM(SELECT cutoff AS d UNION SELECT "effectiveDate" FROM public."FinanceDeferredRevenueEvent" WHERE "invoiceLineId"=target AND "effectiveDate">=cutoff)dates
$$;
-- Typed expected effects are used both by the one emitter and commit-time guards.
CREATE FUNCTION encova_finance_customer_ar(target UUID) RETURNS TABLE("invoiceId" UUID,amount NUMERIC) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT a."invoiceId",CASE WHEN d.kind='UNALLOCATION' THEN a.amount ELSE -a.amount END FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerAllocation" a ON a."documentId"=d.id WHERE d.id=target AND d.kind IN('RECEIPT','ADVANCE_APPLICATION','UNALLOCATION')
 UNION ALL SELECT d."creditInvoiceId",-s."arAmount" FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerCreditSplit" s ON s."documentId"=d.id WHERE d.id=target AND d.kind='CUSTOMER_CREDIT' AND s."arAmount">0
 UNION ALL SELECT v."invoiceId",-v.amount FROM public."FinanceCustomerDocument" d JOIN public."FinanceReceivableEvent" v ON v."customerDocumentId"=d."reversalOfId" WHERE d.id=target AND d.kind='REVERSAL'
$$;
CREATE FUNCTION encova_finance_customer_fund(target UUID) RETURNS TABLE("sourceDocumentId" UUID,"accountId" UUID,amount NUMERIC,kind TEXT) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT d.id,d."advanceAccountId",d."advanceAmount",'RECEIVED'::text FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d.kind='RECEIPT' AND d."advanceAmount">0
 UNION ALL SELECT d."sourceDocumentId",d."advanceAccountId",-d."totalAmount",'APPLIED'::text FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d.kind='ADVANCE_APPLICATION'
 UNION ALL SELECT d.id,d."advanceAccountId",s."balanceAmount",'CREDITED'::text FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerCreditSplit" s ON s."documentId"=d.id WHERE d.id=target AND d.kind='CUSTOMER_CREDIT' AND s."balanceAmount">0
 UNION ALL SELECT d."sourceDocumentId",d."advanceAccountId",-d."cashAmount",'REFUNDED'::text FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d.kind='CUSTOMER_REFUND'
 UNION ALL SELECT d.id,d."advanceAccountId",d."totalAmount",'RELEASED'::text FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d.kind='UNALLOCATION'
 UNION ALL SELECT b."sourceDocumentId",b."accountId",-b.amount,'REVERSAL'::text FROM public."FinanceCustomerDocument" d JOIN public."FinanceClientBalanceEvent" b ON b."documentId"=d."reversalOfId" WHERE d.id=target AND d.kind='REVERSAL'
$$;
CREATE FUNCTION encova_finance_customer_credits(target UUID) RETURNS TABLE("invoiceLineId" UUID,amount NUMERIC) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT c."invoiceLineId",-c.amount FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerCreditLine" c ON c."documentId"=d.id WHERE d.id=target AND d.kind='CUSTOMER_CREDIT'
 UNION ALL SELECT e."invoiceLineId",-e.amount FROM public."FinanceCustomerDocument" d JOIN public."FinanceInvoiceCreditEvent" e ON e."customerDocumentId"=d."reversalOfId" WHERE d.id=target AND d.kind='REVERSAL'
$$;

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
 IF (SELECT count(*) FROM public."FinanceDeferredRevenueEvent" e JOIN public."FinanceInvoiceLine" l ON l.id=e."invoiceLineId" WHERE l."invoiceId"=target AND e.kind='BILLED')<>(SELECT count(*) FROM public."FinanceInvoiceLine" WHERE "invoiceId"=target AND recognition='DEFERRED' AND "totalAmount">0) OR EXISTS(SELECT 1 FROM public."FinanceInvoiceLine" l WHERE l."invoiceId"=target AND l.recognition='DEFERRED' AND l."totalAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceDeferredRevenueEvent" e WHERE e."invoiceLineId"=l.id AND e."journalId"=entry.id AND e."effectiveDate"=invoice."postingDate" AND e.kind='BILLED' AND e.amount=l."totalAmount")) THEN RAISE EXCEPTION 'FINANCE_DEFERRED_MISMATCH' USING ERRCODE='P0001';END IF;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_customer_lines(target UUID) RETURNS TABLE(sequence INTEGER,"accountId" UUID,description TEXT,debit NUMERIC,credit NUMERIC,"projectId" UUID,"partyId" UUID,"invoiceLineId" UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT 1,c."glAccountId",d.description,d."cashAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d JOIN public."FinanceCashAccount" c ON c.id=d."cashAccountId" WHERE d.id=target AND d.kind='RECEIPT'
 UNION ALL SELECT 2,d."feeAccountId",d.description,d."feeAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d.kind='RECEIPT' AND d."feeAmount">0
 UNION ALL SELECT 10+a.sequence,i."receivableAccountId",d.description,0::numeric,a.amount,i."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerAllocation" a ON a."documentId"=d.id JOIN public."FinanceInvoice" i ON i.id=a."invoiceId" WHERE d.id=target AND d.kind IN('RECEIPT','ADVANCE_APPLICATION')
 UNION ALL SELECT 150,d."advanceAccountId",d.description,0::numeric,d."advanceAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d.kind='RECEIPT' AND d."advanceAmount">0
 UNION ALL SELECT 1,d."advanceAccountId",d.description,d."totalAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d.kind IN('ADVANCE_APPLICATION','CUSTOMER_REFUND')
 UNION ALL SELECT 2,c."glAccountId",d.description,0::numeric,d."cashAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d JOIN public."FinanceCashAccount" c ON c.id=d."cashAccountId" WHERE d.id=target AND d.kind='CUSTOMER_REFUND'
 UNION ALL SELECT 10+c.sequence,CASE WHEN l.recognition='EARNED' THEN l."revenueAccountId" ELSE l."deferredAccountId" END,l.description,c.amount,0::numeric,l."projectId",d."partyId",l.id FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerCreditLine" c ON c."documentId"=d.id JOIN public."FinanceInvoiceLine" l ON l.id=c."invoiceLineId" WHERE d.id=target AND d.kind='CUSTOMER_CREDIT'
 UNION ALL SELECT 1,i."receivableAccountId",d.description,0::numeric,s."arAmount",i."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerCreditSplit" s ON s."documentId"=d.id JOIN public."FinanceInvoice" i ON i.id=d."creditInvoiceId" WHERE d.id=target AND d.kind='CUSTOMER_CREDIT' AND s."arAmount">0
 UNION ALL SELECT 2,d."advanceAccountId",d.description,0::numeric,s."balanceAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerCreditSplit" s ON s."documentId"=d.id WHERE d.id=target AND d.kind='CUSTOMER_CREDIT' AND s."balanceAmount">0
 UNION ALL SELECT 10+a.sequence,i."receivableAccountId",d.description,a.amount,0::numeric,i."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerAllocation" a ON a."documentId"=d.id JOIN public."FinanceInvoice" i ON i.id=a."invoiceId" WHERE d.id=target AND d.kind='UNALLOCATION'
 UNION ALL SELECT 1,d."advanceAccountId",d.description,0::numeric,d."totalAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d.kind='UNALLOCATION'
 UNION ALL SELECT l.sequence,l."accountId",l.description,l.credit,l.debit,l."projectId",l."partyId",l."invoiceLineId" FROM public."FinanceCustomerDocument" d JOIN public."FinanceJournalEntry" e ON e."customerDocumentId"=d."reversalOfId" JOIN public."FinanceJournalLine" l ON l."journalId"=e.id WHERE d.id=target AND d.kind='REVERSAL'
$$;
CREATE OR REPLACE FUNCTION encova_finance_customer_validate(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;origin public."FinanceCustomerDocument"%ROWTYPE;inv public."FinanceInvoice"%ROWTYPE;allocation_row record;line_row record;event_row record;ar NUMERIC;
BEGIN
 SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=target;
 IF d.id IS NULL OR d.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=d."partyId" AND kind IN('CLIENT','BOTH')) THEN RAISE EXCEPTION 'FINANCE_INVOICE_PARTY' USING ERRCODE='P0001';END IF;
 IF d."advanceAccountId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."advanceAccountId" AND active AND "isPosting" AND NOT "isContra" AND "controlType"='CLIENT_ADVANCE' AND type='LIABILITY' AND currency='PKR') THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_MAPPING' USING ERRCODE='P0001';END IF;
 IF d.kind IN('RECEIPT','CUSTOMER_REFUND') THEN
  IF NOT EXISTS(SELECT 1 FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" gl ON gl.id=c."glAccountId" WHERE c.id=d."cashAccountId" AND c.active AND gl.active AND gl."isPosting" AND NOT gl."isContra" AND gl."controlType"='CASH' AND gl.type='ASSET' AND gl.currency='PKR' AND c.currency='PKR') THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_MAPPING' USING ERRCODE='P0001';END IF;
 END IF;
 IF d.kind='RECEIPT' THEN
  IF d."feeAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."feeAccountId" AND active AND "isPosting" AND NOT "isContra" AND "controlType"='NONE' AND type IN('DIRECT_COST','OPERATING_EXPENSE','OTHER_EXPENSE') AND currency='PKR') THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_MAPPING' USING ERRCODE='P0001';END IF;
  IF d."advanceAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=d."partyId" AND active) THEN RAISE EXCEPTION 'FINANCE_INVOICE_PARTY' USING ERRCODE='P0001';END IF;
 ELSIF d.kind IN('ADVANCE_APPLICATION','CUSTOMER_REFUND') THEN
  SELECT * INTO origin FROM public."FinanceCustomerDocument" WHERE id=d."sourceDocumentId";
  IF origin.id IS NULL OR origin.kind NOT IN('RECEIPT','CUSTOMER_CREDIT','UNALLOCATION') OR origin.state<>'POSTED' OR EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" WHERE "reversalOfId"=origin.id) OR origin."partyId"<>d."partyId" OR origin."advanceAccountId" IS DISTINCT FROM d."advanceAccountId" OR origin."postingDate">d."documentDate" OR d."totalAmount">public.encova_finance_client_capacity(origin.id,d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ADVANCE_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='CUSTOMER_CREDIT' THEN
  SELECT * INTO inv FROM public."FinanceInvoice" WHERE id=d."creditInvoiceId";
  IF inv.id IS NULL OR inv.state<>'POSTED' OR inv."partyId"<>d."partyId" OR inv.currency<>d.currency OR inv."postingDate">d."documentDate" THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  FOR line_row IN SELECT c.amount,l.* FROM public."FinanceCustomerCreditLine" c JOIN public."FinanceInvoiceLine" l ON l.id=c."invoiceLineId" WHERE c."documentId"=target LOOP
   IF line_row."invoiceId"<>inv.id OR line_row.amount>public.encova_finance_credit_capacity(line_row.id,d."postingDate") OR (line_row.recognition='DEFERRED' AND line_row.amount>public.encova_finance_deferred_capacity(line_row.id,d."postingDate")) THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  END LOOP;
  SELECT least(d."totalAmount",coalesce(sum(amount),0)) INTO ar FROM public."FinanceReceivableEvent" WHERE "invoiceId"=inv.id AND "effectiveDate"<=d."postingDate";
  IF ar<0 OR ar>public.encova_finance_ar_capacity(inv.id,d."postingDate") THEN RAISE EXCEPTION 'FINANCE_SETTLEMENT_ORDER' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinanceCustomerCreditSplit"("documentId","arAmount","balanceAmount") VALUES(d.id,ar,d."totalAmount"-ar);
 ELSIF d.kind='UNALLOCATION' THEN
  SELECT * INTO origin FROM public."FinanceCustomerDocument" WHERE id=d."unallocationOfId";
  IF origin.id IS NULL OR origin.kind<>'RECEIPT' OR origin.state<>'POSTED' OR origin."partyId"<>d."partyId" OR origin."postingDate">d."postingDate" OR origin."allocationAmount"<=0 OR EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" WHERE "reversalOfId"=origin.id) THEN RAISE EXCEPTION 'FINANCE_SETTLEMENT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='REVERSAL' THEN
  SELECT * INTO origin FROM public."FinanceCustomerDocument" WHERE id=d."reversalOfId";
  IF origin.id IS NULL OR origin.kind='REVERSAL' OR origin.state<>'POSTED' OR origin."postingDate">d."postingDate" OR EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" WHERE "reversalOfId"=origin.id AND id<>target) OR EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" u WHERE u."unallocationOfId"=origin.id AND NOT EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" undo WHERE undo."reversalOfId"=u.id)) THEN RAISE EXCEPTION 'FINANCE_SETTLEMENT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  FOR event_row IN SELECT b.* FROM public."FinanceClientBalanceEvent" b WHERE b."documentId"=origin.id AND b.amount>0 LOOP
   IF event_row.amount>public.encova_finance_client_capacity(event_row."sourceDocumentId",d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ADVANCE_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  END LOOP;
  FOR event_row IN SELECT v.* FROM public."FinanceReceivableEvent" v WHERE v."customerDocumentId"=origin.id AND v.amount>0 LOOP
   IF event_row.amount>public.encova_finance_ar_capacity(event_row."invoiceId",d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  END LOOP;
 END IF;
 IF d.kind IN('RECEIPT','ADVANCE_APPLICATION') THEN
  FOR allocation_row IN SELECT x.*,i.state,i."partyId",i.currency,i."postingDate" FROM public."FinanceCustomerAllocation" x JOIN public."FinanceInvoice" i ON i.id=x."invoiceId" WHERE x."documentId"=target ORDER BY x."invoiceId" LOOP
   IF allocation_row.state<>'POSTED' OR allocation_row."partyId"<>d."partyId" OR allocation_row.currency<>d.currency OR allocation_row."postingDate">d."postingDate" OR allocation_row.amount>public.encova_finance_ar_capacity(allocation_row."invoiceId",d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  END LOOP;
 END IF;
 IF d."projectId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Project" WHERE id=d."projectId" AND "archivedAt" IS NULL) AND NOT EXISTS(SELECT 1 FROM public."FinanceCustomerAllocation" x JOIN public."FinanceInvoice" i ON i.id=x."invoiceId" WHERE x."documentId"=target AND i."projectId"=d."projectId") AND NOT EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" WHERE id=coalesce(d."sourceDocumentId",d."reversalOfId") AND "projectId"=d."projectId") AND NOT EXISTS(SELECT 1 FROM public."FinanceInvoice" WHERE id=d."creditInvoiceId" AND "projectId"=d."projectId") THEN RAISE EXCEPTION 'FINANCE_PROJECT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_customer_effects(actor UUID,target UUID,entry_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;BEGIN
 SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=target;
 INSERT INTO public."FinanceReceivableEvent"(id,"invoiceId","partyId","accountId","journalId","effectiveDate",kind,amount,"customerDocumentId") SELECT gen_random_uuid(),x."invoiceId",d."partyId",i."receivableAccountId",entry_id,d."postingDate",d.kind,x.amount,d.id FROM public.encova_finance_customer_ar(target) x JOIN public."FinanceInvoice" i ON i.id=x."invoiceId";
 INSERT INTO public."FinanceClientBalanceEvent"(id,"documentId","sourceDocumentId","partyId","accountId","journalId","effectiveDate",kind,amount) SELECT gen_random_uuid(),d.id,x."sourceDocumentId",d."partyId",x."accountId",entry_id,d."postingDate",x.kind,x.amount FROM public.encova_finance_customer_fund(target) x;
 INSERT INTO public."FinanceInvoiceCreditEvent"(id,"invoiceLineId","customerDocumentId","journalId","effectiveDate",kind,amount) SELECT gen_random_uuid(),x."invoiceLineId",d.id,entry_id,d."postingDate",d.kind,x.amount FROM public.encova_finance_customer_credits(target) x;
 INSERT INTO public."FinanceDeferredRevenueEvent"(id,"invoiceLineId","journalId","effectiveDate",kind,amount,"customerDocumentId") SELECT gen_random_uuid(),x."invoiceLineId",entry_id,d."postingDate",d.kind,x.amount,d.id FROM public.encova_finance_customer_credits(target) x JOIN public."FinanceInvoiceLine" l ON l.id=x."invoiceLineId" WHERE l.recognition='DEFERRED';
 IF d."advanceAccountId" IS NOT NULL THEN PERFORM public.encova_finance_mark_accounts(ARRAY[d."advanceAccountId"]);END IF;
 UPDATE public."FinanceParty" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=d."partyId";
 UPDATE public."FinanceCustomerDocument" SET state='POSTED',version=version+1,"partySnapshot"=public.encova_finance_party_snapshot("partyId"),"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;
END $$;

CREATE OR REPLACE FUNCTION encova_finance_check_customer(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;origin public."FinanceCustomerDocument"%ROWTYPE;e public."FinanceJournalEntry"%ROWTYPE;s public."FinanceCustomerCreditSplit"%ROWTYPE;n_alloc BIGINT;n_credit BIGINT;alloc_sum NUMERIC;credit_sum NUMERIC;expected_ar NUMERIC;
BEGIN
 SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=target;
 IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 SELECT count(*),coalesce(sum(x.amount),0) INTO n_alloc,alloc_sum FROM public."FinanceCustomerAllocation" x WHERE x."documentId"=target;
 SELECT count(*),coalesce(sum(x.amount),0) INTO n_credit,credit_sum FROM public."FinanceCustomerCreditLine" x WHERE x."documentId"=target;
 IF (d.kind IN('RECEIPT','ADVANCE_APPLICATION','UNALLOCATION') AND (n_alloc NOT BETWEEN 0 AND 100 OR (d.kind<>'RECEIPT' AND n_alloc=0) OR alloc_sum<>d."allocationAmount" OR n_credit<>0)) OR (d.kind='CUSTOMER_CREDIT' AND (n_alloc<>0 OR n_credit NOT BETWEEN 1 AND 100 OR credit_sum<>d."totalAmount" OR EXISTS(SELECT 1 FROM public."FinanceCustomerCreditLine" c JOIN public."FinanceInvoiceLine" l ON l.id=c."invoiceLineId" WHERE c."documentId"=target AND l."invoiceId"<>d."creditInvoiceId"))) OR (d.kind IN('CUSTOMER_REFUND','REVERSAL') AND (n_alloc<>0 OR n_credit<>0)) THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_TOTALS' USING ERRCODE='P0001';END IF;
 SELECT * INTO e FROM public."FinanceJournalEntry" WHERE "customerDocumentId"=target;
 IF d.state<>'POSTED' THEN
  IF e.id IS NOT NULL OR EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" WHERE "customerDocumentId"=target) OR EXISTS(SELECT 1 FROM public."FinanceClientBalanceEvent" WHERE "documentId"=target) OR EXISTS(SELECT 1 FROM public."FinanceInvoiceCreditEvent" WHERE "customerDocumentId"=target) OR EXISTS(SELECT 1 FROM public."FinanceDeferredRevenueEvent" WHERE "customerDocumentId"=target) OR EXISTS(SELECT 1 FROM public."FinanceCustomerCreditSplit" WHERE "documentId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;
 END IF;
 IF e.id IS NULL OR e."sourceType"<>'CUSTOMER_DOCUMENT' OR e."postingDate"<>d."postingDate" OR e.description<>d.description OR e.evidence<>d.evidence OR d."partySnapshot" IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF d.kind='REVERSAL' THEN
  SELECT * INTO origin FROM public."FinanceCustomerDocument" WHERE id=d."reversalOfId";
  IF origin.id IS NULL OR origin.state<>'POSTED' OR origin.kind='REVERSAL' OR origin."postingDate">d."postingDate" OR ROW(d."partyId",d."projectId",d."cashAccountId",d."feeAccountId",d."advanceAccountId",d."sourceDocumentId",d."creditInvoiceId",d."cashAmount",d."feeAmount",d."allocationAmount",d."advanceAmount",d."totalAmount") IS DISTINCT FROM ROW(origin."partyId",origin."projectId",origin."cashAccountId",origin."feeAccountId",origin."advanceAccountId",origin."sourceDocumentId",origin."creditInvoiceId",origin."cashAmount",origin."feeAmount",origin."allocationAmount",origin."advanceAmount",origin."totalAmount") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='UNALLOCATION' THEN
  SELECT * INTO origin FROM public."FinanceCustomerDocument" WHERE id=d."unallocationOfId";
  IF origin.kind IS DISTINCT FROM 'RECEIPT' OR origin.state<>'POSTED' OR origin."partyId"<>d."partyId" OR origin."projectId" IS DISTINCT FROM d."projectId" OR origin."postingDate">d."postingDate" OR origin."allocationAmount"<>d."totalAmount" OR EXISTS((SELECT sequence,"invoiceId",amount FROM public."FinanceCustomerAllocation" WHERE "documentId"=target) EXCEPT(SELECT sequence,"invoiceId",amount FROM public."FinanceCustomerAllocation" WHERE "documentId"=origin.id)) OR EXISTS((SELECT sequence,"invoiceId",amount FROM public."FinanceCustomerAllocation" WHERE "documentId"=origin.id) EXCEPT(SELECT sequence,"invoiceId",amount FROM public."FinanceCustomerAllocation" WHERE "documentId"=target)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 END IF;
 IF d.kind='CUSTOMER_CREDIT' THEN
  SELECT * INTO s FROM public."FinanceCustomerCreditSplit" WHERE "documentId"=target;
  SELECT least(d."totalAmount",coalesce(sum(v.amount),0)) INTO expected_ar FROM public."FinanceReceivableEvent" v WHERE v."invoiceId"=d."creditInvoiceId" AND v."effectiveDate"<=d."postingDate" AND v."customerDocumentId" IS DISTINCT FROM target;
  IF s."documentId" IS NULL OR s."arAmount"+s."balanceAmount"<>d."totalAmount" OR s."arAmount"<>expected_ar THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 ELSIF EXISTS(SELECT 1 FROM public."FinanceCustomerCreditSplit" WHERE "documentId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id) EXCEPT(SELECT * FROM public.encova_finance_customer_lines(target))) OR EXISTS((SELECT * FROM public.encova_finance_customer_lines(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "invoiceId",amount FROM public."FinanceReceivableEvent" WHERE "customerDocumentId"=target) EXCEPT(SELECT * FROM public.encova_finance_customer_ar(target))) OR EXISTS((SELECT * FROM public.encova_finance_customer_ar(target)) EXCEPT(SELECT "invoiceId",amount FROM public."FinanceReceivableEvent" WHERE "customerDocumentId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" v JOIN public."FinanceInvoice" i ON i.id=v."invoiceId" WHERE v."customerDocumentId"=target AND(v."partyId"<>d."partyId" OR v."accountId"<>i."receivableAccountId" OR v."journalId"<>e.id OR v."effectiveDate"<>d."postingDate" OR v.kind<>d.kind)) THEN RAISE EXCEPTION 'FINANCE_RECEIVABLE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "sourceDocumentId","accountId",amount,kind FROM public."FinanceClientBalanceEvent" WHERE "documentId"=target) EXCEPT(SELECT * FROM public.encova_finance_customer_fund(target))) OR EXISTS((SELECT * FROM public.encova_finance_customer_fund(target)) EXCEPT(SELECT "sourceDocumentId","accountId",amount,kind FROM public."FinanceClientBalanceEvent" WHERE "documentId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceClientBalanceEvent" b WHERE b."documentId"=target AND(b."partyId"<>d."partyId" OR b."journalId"<>e.id OR b."effectiveDate"<>d."postingDate")) THEN RAISE EXCEPTION 'FINANCE_CLIENT_BALANCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "invoiceLineId",amount FROM public."FinanceInvoiceCreditEvent" WHERE "customerDocumentId"=target) EXCEPT(SELECT * FROM public.encova_finance_customer_credits(target))) OR EXISTS((SELECT * FROM public.encova_finance_customer_credits(target)) EXCEPT(SELECT "invoiceLineId",amount FROM public."FinanceInvoiceCreditEvent" WHERE "customerDocumentId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceInvoiceCreditEvent" c WHERE c."customerDocumentId"=target AND(c."journalId"<>e.id OR c."effectiveDate"<>d."postingDate" OR c.kind<>d.kind)) THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "invoiceLineId",amount FROM public."FinanceDeferredRevenueEvent" WHERE "customerDocumentId"=target) EXCEPT(SELECT x.* FROM public.encova_finance_customer_credits(target) x JOIN public."FinanceInvoiceLine" l ON l.id=x."invoiceLineId" WHERE l.recognition='DEFERRED')) OR EXISTS((SELECT x.* FROM public.encova_finance_customer_credits(target) x JOIN public."FinanceInvoiceLine" l ON l.id=x."invoiceLineId" WHERE l.recognition='DEFERRED') EXCEPT(SELECT "invoiceLineId",amount FROM public."FinanceDeferredRevenueEvent" WHERE "customerDocumentId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceDeferredRevenueEvent" v WHERE v."customerDocumentId"=target AND(v."journalId"<>e.id OR v."effectiveDate"<>d."postingDate" OR v.kind<>d.kind)) THEN RAISE EXCEPTION 'FINANCE_DEFERRED_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(v.amount) OVER(PARTITION BY v."invoiceId" ORDER BY v."effectiveDate" RANGE UNBOUNDED PRECEDING) AS balance FROM public."FinanceReceivableEvent" v WHERE v."invoiceId" IN(SELECT "invoiceId" FROM public.encova_finance_customer_ar(target)))balances WHERE balance<0) THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(b.amount) OVER(PARTITION BY b."sourceDocumentId" ORDER BY b."effectiveDate" RANGE UNBOUNDED PRECEDING) AS balance FROM public."FinanceClientBalanceEvent" b WHERE b."sourceDocumentId" IN(SELECT "sourceDocumentId" FROM public.encova_finance_customer_fund(target)))balances WHERE balance<0) THEN RAISE EXCEPTION 'FINANCE_ADVANCE_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT l."totalAmount"+sum(c.amount) OVER(PARTITION BY c."invoiceLineId" ORDER BY c."effectiveDate" RANGE UNBOUNDED PRECEDING) AS capacity FROM public."FinanceInvoiceCreditEvent" c JOIN public."FinanceInvoiceLine" l ON l.id=c."invoiceLineId" WHERE c."invoiceLineId" IN(SELECT "invoiceLineId" FROM public.encova_finance_customer_credits(target)))balances WHERE capacity<0) THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(v.amount) OVER(PARTITION BY v."invoiceLineId" ORDER BY v."effectiveDate" RANGE UNBOUNDED PRECEDING) AS capacity FROM public."FinanceDeferredRevenueEvent" v WHERE v."invoiceLineId" IN(SELECT "invoiceLineId" FROM public.encova_finance_customer_credits(target)))balances WHERE capacity<0) THEN RAISE EXCEPTION 'FINANCE_DEFERRED_MISMATCH' USING ERRCODE='P0001';END IF;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_customer_check_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;BEGIN
 IF TG_TABLE_NAME='FinanceCustomerDocument' THEN target:=NEW.id;
 ELSIF TG_OP='DELETE' THEN target:=OLD."documentId";
 ELSIF TG_TABLE_NAME IN('FinanceCustomerAllocation','FinanceCustomerCreditLine','FinanceCustomerCreditSplit','FinanceClientBalanceEvent') THEN target:=NEW."documentId";
 ELSE target:=NEW."customerDocumentId";END IF;
 IF target IS NOT NULL THEN PERFORM public.encova_finance_check_customer(target);END IF;RETURN NULL;
END $$;
CREATE FUNCTION encova_finance_credit_split_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" WHERE id=NEW."documentId" AND kind='CUSTOMER_CREDIT' AND state='DRAFT') THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_IMMUTABLE' USING ERRCODE='P0001';END IF;RETURN NEW;END $$;
CREATE TRIGGER "FinanceCustomerCreditSplit_guard" BEFORE INSERT ON "FinanceCustomerCreditSplit" FOR EACH ROW EXECUTE FUNCTION encova_finance_credit_split_guard();
CREATE CONSTRAINT TRIGGER "FinanceCustomerCreditLine_valid" AFTER INSERT OR UPDATE OR DELETE ON "FinanceCustomerCreditLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_customer_check_trigger();
CREATE CONSTRAINT TRIGGER "FinanceCustomerCreditSplit_valid" AFTER INSERT ON "FinanceCustomerCreditSplit" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_customer_check_trigger();
CREATE CONSTRAINT TRIGGER "FinanceInvoiceCreditEvent_valid" AFTER INSERT ON "FinanceInvoiceCreditEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_customer_check_trigger();
CREATE CONSTRAINT TRIGGER "FinanceDeferredRevenueEvent_customer_valid" AFTER INSERT ON "FinanceDeferredRevenueEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_customer_check_trigger();

CREATE OR REPLACE FUNCTION encova_finance_customer_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,resource TEXT,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;origin public."FinanceCustomerDocument"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;inv public."FinanceInvoice"%ROWTYPE;item JSONB;allowed TEXT[];n INTEGER:=0;alloc_sum NUMERIC:=0;credit_sum NUMERIC:=0;cash NUMERIC:=0;fee NUMERIC:=0;adv NUMERIC:=0;total NUMERIC;advance_account UUID;cash_account UUID;fee_account UUID;source_doc UUID;credit_invoice UUID;project UUID;entry_id UUID;origin_id UUID;origin_version INTEGER;origin_number TEXT;digest TEXT;operation_name TEXT;reason TEXT;result JSONB;prefix TEXT;audit_id UUID;
BEGIN
 IF resource IS NULL OR resource NOT IN('RECEIPT','ADVANCE_APPLICATION','CUSTOMER_CREDIT','CUSTOMER_REFUND','UNALLOCATION') OR action IS NULL OR action NOT IN('CREATE','UPDATE','POST','VOID','REVERSE','UNALLOCATE') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR(resource='UNALLOCATION' AND action<>'REVERSE') OR(action='UNALLOCATE' AND resource<>'RECEIPT') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 reason:=trim(input->>'reason');IF jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF action IN('CREATE','UPDATE') THEN
  allowed:=ARRAY['reference','partyId','projectId','documentDate','postingDate','description','evidence','currency','reason'];
  allowed:=allowed||(CASE resource WHEN 'RECEIPT' THEN ARRAY['cashAccountId','feeAccountId','advanceAccountId','cashAmount','feeAmount','allocations'] WHEN 'ADVANCE_APPLICATION' THEN ARRAY['sourceDocumentId','allocations'] WHEN 'CUSTOMER_CREDIT' THEN ARRAY['invoiceId','advanceAccountId','creditLines'] ELSE ARRAY['sourceDocumentId','cashAccountId','cashAmount'] END);
  IF action='UPDATE' THEN allowed:=allowed||ARRAY['id','expectedVersion'];END IF;
 ELSE allowed:=ARRAY['id','expectedVersion','reason'];IF action IN('REVERSE','UNALLOCATE') THEN allowed:=allowed||ARRAY['postingDate'];END IF;IF action='UNALLOCATE' THEN allowed:=allowed||ARRAY['advanceAccountId'];END IF;END IF;
 IF input-allowed<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF action<>'CREATE' AND(jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR(input->>'expectedVersion')::integer<1) THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 operation_name:=resource||'_'||action;digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');SELECT * INTO r FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation=operation_name AND key=request_key;
 IF FOUND THEN IF r."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN r.result;END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action<>'CREATE' THEN
  SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=(input->>'id')::uuid AND kind=resource FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF d.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF (action IN('REVERSE','UNALLOCATE') AND d.state<>'POSTED') OR(action NOT IN('REVERSE','UNALLOCATE') AND d.state<>'DRAFT') THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 END IF;
 IF action IN('REVERSE','UNALLOCATE') THEN
  IF jsonb_typeof(input->'postingDate') IS DISTINCT FROM 'string' OR input->>'postingDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" WHERE "reversalOfId"=d.id) THEN RAISE EXCEPTION 'FINANCE_SETTLEMENT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  origin:=d;origin_id:=d.id;origin_version:=d.version;origin_number:=d.number;
  IF action='REVERSE' THEN
   INSERT INTO public."FinanceCustomerDocument"(id,number,kind,reference,"partyId","cashAccountId","feeAccountId","advanceAccountId","sourceDocumentId","creditInvoiceId","projectId","documentDate","postingDate",description,evidence,currency,"cashAmount","feeAmount","allocationAmount","advanceAmount","totalAmount","createdById","reversalOfId") VALUES(gen_random_uuid(),'REV-'||lpad(nextval('public.finance_customer_number'::regclass)::text,10,'0'),'REVERSAL',origin.reference,origin."partyId",origin."cashAccountId",origin."feeAccountId",origin."advanceAccountId",origin."sourceDocumentId",origin."creditInvoiceId",origin."projectId",(input->>'postingDate')::date,(input->>'postingDate')::date,origin.description,reason,'PKR',origin."cashAmount",origin."feeAmount",origin."allocationAmount",origin."advanceAmount",origin."totalAmount",actor,origin.id) RETURNING * INTO d;
  ELSE
   IF origin."allocationAmount"<=0 OR EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" WHERE "unallocationOfId"=origin.id) THEN RAISE EXCEPTION 'FINANCE_SETTLEMENT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
   INSERT INTO public."FinanceCustomerDocument"(id,number,kind,reference,"partyId","cashAccountId","feeAccountId","advanceAccountId","sourceDocumentId","projectId","documentDate","postingDate",description,evidence,currency,"cashAmount","feeAmount","allocationAmount","advanceAmount","totalAmount","createdById","unallocationOfId") VALUES(gen_random_uuid(),'UAL-'||lpad(nextval('public.finance_customer_number'::regclass)::text,10,'0'),'UNALLOCATION',origin.reference,origin."partyId",NULL,NULL,(input->>'advanceAccountId')::uuid,origin.id,origin."projectId",(input->>'postingDate')::date,(input->>'postingDate')::date,origin.description,reason,'PKR',0,0,origin."allocationAmount",origin."allocationAmount",origin."allocationAmount",actor,origin.id) RETURNING * INTO d;
   INSERT INTO public."FinanceCustomerAllocation"(id,"documentId","invoiceId",sequence,amount) SELECT gen_random_uuid(),d.id,"invoiceId",sequence,amount FROM public."FinanceCustomerAllocation" WHERE "documentId"=origin.id;
  END IF;
  entry_id:=public.encova_finance_emit_journal(actor,'CUSTOMER_DOCUMENT',d.id,d."postingDate",reason);SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=d.id;
 ELSIF action IN('CREATE','UPDATE') THEN
  IF input->>'currency' IS DISTINCT FROM 'PKR' OR jsonb_typeof(input->'reference') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'description') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'evidence') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'documentDate') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'postingDate') IS DISTINCT FROM 'string' OR input->>'documentDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR input->>'postingDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=(input->>'partyId')::uuid AND kind IN('CLIENT','BOTH')) THEN RAISE EXCEPTION 'FINANCE_INVOICE_PARTY' USING ERRCODE='P0001';END IF;
  project:=nullif(input->>'projectId','')::uuid;
  IF resource IN('RECEIPT','CUSTOMER_REFUND') THEN
   IF jsonb_typeof(input->'cashAmount') IS DISTINCT FROM 'string' OR input->>'cashAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR(input->>'cashAmount')::numeric<=0 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;cash:=(input->>'cashAmount')::numeric;cash_account:=(input->>'cashAccountId')::uuid;
  END IF;
  IF resource='RECEIPT' THEN
   IF jsonb_typeof(input->'feeAmount') IS DISTINCT FROM 'string' OR input->>'feeAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;fee:=(input->>'feeAmount')::numeric;fee_account:=nullif(input->>'feeAccountId','')::uuid;advance_account:=nullif(input->>'advanceAccountId','')::uuid;
  ELSIF resource IN('ADVANCE_APPLICATION','CUSTOMER_REFUND') THEN
   source_doc:=(input->>'sourceDocumentId')::uuid;SELECT * INTO origin FROM public."FinanceCustomerDocument" WHERE id=source_doc;advance_account:=origin."advanceAccountId";
  ELSE credit_invoice:=(input->>'invoiceId')::uuid;advance_account:=(input->>'advanceAccountId')::uuid;SELECT * INTO inv FROM public."FinanceInvoice" WHERE id=credit_invoice;project:=coalesce(project,inv."projectId");END IF;
  IF resource IN('RECEIPT','ADVANCE_APPLICATION') THEN
   IF jsonb_typeof(input->'allocations') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'allocations') NOT BETWEEN 0 AND 100 OR(resource='ADVANCE_APPLICATION' AND jsonb_array_length(input->'allocations')=0) THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(input->'allocations') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['invoiceId','amount']<>'{}'::jsonb OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'string' OR item->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR(item->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;alloc_sum:=alloc_sum+(item->>'amount')::numeric;
   END LOOP;
  ELSIF resource='CUSTOMER_CREDIT' THEN
   IF jsonb_typeof(input->'creditLines') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'creditLines') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(input->'creditLines') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['invoiceLineId','amount']<>'{}'::jsonb OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'string' OR item->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR(item->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;credit_sum:=credit_sum+(item->>'amount')::numeric;
   END LOOP;
  END IF;
  total:=CASE resource WHEN 'RECEIPT' THEN cash+fee WHEN 'ADVANCE_APPLICATION' THEN alloc_sum WHEN 'CUSTOMER_CREDIT' THEN credit_sum ELSE cash END;adv:=CASE WHEN resource='RECEIPT' THEN total-alloc_sum ELSE 0 END;
  IF total<=0 OR total>999999999999999999.99 OR alloc_sum>999999999999999999.99 OR adv<0 THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_TOTALS' USING ERRCODE='P0001';END IF;
  IF action='CREATE' THEN
   prefix:=CASE resource WHEN 'RECEIPT' THEN 'RCP-' WHEN 'ADVANCE_APPLICATION' THEN 'AAP-' WHEN 'CUSTOMER_CREDIT' THEN 'CN-' ELSE 'RFN-' END;
   INSERT INTO public."FinanceCustomerDocument"(id,number,kind,reference,"partyId","cashAccountId","feeAccountId","advanceAccountId","sourceDocumentId","creditInvoiceId","projectId","documentDate","postingDate",description,evidence,currency,"cashAmount","feeAmount","allocationAmount","advanceAmount","totalAmount","createdById") VALUES(gen_random_uuid(),prefix||lpad(nextval('public.finance_customer_number'::regclass)::text,10,'0'),resource,input->>'reference',(input->>'partyId')::uuid,cash_account,fee_account,advance_account,source_doc,credit_invoice,project,(input->>'documentDate')::date,(input->>'postingDate')::date,input->>'description',input->>'evidence','PKR',cash,fee,alloc_sum,adv,total,actor) RETURNING * INTO d;
  ELSE
   UPDATE public."FinanceCustomerDocument" SET reference=input->>'reference',"partyId"=(input->>'partyId')::uuid,"cashAccountId"=cash_account,"feeAccountId"=fee_account,"advanceAccountId"=advance_account,"sourceDocumentId"=source_doc,"creditInvoiceId"=credit_invoice,"projectId"=project,"documentDate"=(input->>'documentDate')::date,"postingDate"=(input->>'postingDate')::date,description=input->>'description',evidence=input->>'evidence',"cashAmount"=cash,"feeAmount"=fee,"allocationAmount"=alloc_sum,"advanceAmount"=adv,"totalAmount"=total,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
   DELETE FROM public."FinanceCustomerAllocation" WHERE "documentId"=d.id;DELETE FROM public."FinanceCustomerCreditLine" WHERE "documentId"=d.id;
  END IF;
  IF resource IN('RECEIPT','ADVANCE_APPLICATION') THEN
   FOR item IN SELECT value FROM jsonb_array_elements(input->'allocations') LOOP n:=n+1;INSERT INTO public."FinanceCustomerAllocation"(id,"documentId","invoiceId",sequence,amount) VALUES(gen_random_uuid(),d.id,(item->>'invoiceId')::uuid,n,(item->>'amount')::numeric);END LOOP;
  ELSIF resource='CUSTOMER_CREDIT' THEN
   FOR item IN SELECT value FROM jsonb_array_elements(input->'creditLines') LOOP n:=n+1;INSERT INTO public."FinanceCustomerCreditLine"(id,"documentId","invoiceLineId",sequence,amount) VALUES(gen_random_uuid(),d.id,(item->>'invoiceLineId')::uuid,n,(item->>'amount')::numeric);END LOOP;
  END IF;
 ELSIF action='VOID' THEN UPDATE public."FinanceCustomerDocument" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
 ELSE entry_id:=public.encova_finance_emit_journal(actor,'CUSTOMER_DOCUMENT',d.id,d."postingDate",reason);SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=d.id;END IF;
 IF action='REVERSE' THEN result:=jsonb_build_object('id',origin_id,'version',origin_version,'number',origin_number,'journalId',entry_id,'reversalId',d.id);audit_id:=origin_id;
 ELSE result:=jsonb_build_object('id',d.id,'version',d.version,'number',d.number,'journalId',entry_id);audit_id:=d.id;END IF;
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,operation_name,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_'||operation_name,'FinanceCustomerDocument',audit_id,reason,jsonb_build_object('journalId',entry_id,'snapshot',to_jsonb(d)||jsonb_build_object('cashAmount',d."cashAmount"::text,'feeAmount',d."feeAmount"::text,'allocationAmount',d."allocationAmount"::text,'advanceAmount',d."advanceAmount"::text,'totalAmount',d."totalAmount"::text),'allocations',(SELECT jsonb_agg(to_jsonb(a)||jsonb_build_object('amount',a.amount::text) ORDER BY sequence) FROM public."FinanceCustomerAllocation" a WHERE a."documentId"=d.id),'creditLines',(SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('amount',c.amount::text) ORDER BY sequence) FROM public."FinanceCustomerCreditLine" c WHERE c."documentId"=d.id),'creditSplit',(SELECT jsonb_build_object('arAmount',s."arAmount"::text,'balanceAmount',s."balanceAmount"::text) FROM public."FinanceCustomerCreditSplit" s WHERE s."documentId"=d.id)),request_id);
 IF action='UNALLOCATE' THEN INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_RECEIPT_UNALLOCATE','FinanceCustomerDocument',origin_id,reason,jsonb_build_object('unallocationId',d.id,'journalId',entry_id,'postingDate',d."postingDate"),request_id);END IF;RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';
 WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END $$;

DO $$ DECLARE t TEXT;f record;r TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceCustomerCreditLine','FinanceCustomerCreditSplit','FinanceInvoiceCreditEvent'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r);END IF;END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('GRANT SELECT ON TABLE public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_runtime ON public.%I TO encova_app USING(true)',t);END IF;
 END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND(proname LIKE 'encova_finance_customer_%' OR proname IN('encova_finance_credit_capacity','encova_finance_deferred_capacity','encova_finance_credit_split_guard')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated','encova_app'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION encova_finance_customer_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,JSONB,TEXT,UUID) TO encova_app;END IF;
END $$;
COMMIT;
