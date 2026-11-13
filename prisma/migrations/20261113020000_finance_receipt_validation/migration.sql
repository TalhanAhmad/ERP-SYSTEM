BEGIN;
-- Preserve applied migration 29; remove loop-record/SQL-alias name collision.
CREATE OR REPLACE FUNCTION encova_finance_customer_validate(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;allocation_row record;
BEGIN
 SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=target;
 IF d.id IS NULL OR d.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=d."partyId" AND kind IN('CLIENT','BOTH')) THEN RAISE EXCEPTION 'FINANCE_INVOICE_PARTY' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" gl ON gl.id=c."glAccountId" WHERE c.id=d."cashAccountId" AND c.active AND gl.active AND gl."isPosting" AND NOT gl."isContra" AND gl."controlType"='CASH' AND gl.type='ASSET' AND gl.currency='PKR' AND c.currency='PKR') THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_MAPPING' USING ERRCODE='P0001';END IF;
 IF d."feeAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."feeAccountId" AND active AND "isPosting" AND NOT "isContra" AND "controlType"='NONE' AND type IN('DIRECT_COST','OPERATING_EXPENSE','OTHER_EXPENSE') AND currency='PKR') THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_MAPPING' USING ERRCODE='P0001';END IF;
 IF d."projectId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Project" WHERE id=d."projectId" AND "archivedAt" IS NULL) AND NOT EXISTS(SELECT 1 FROM public."FinanceCustomerAllocation" a JOIN public."FinanceInvoice" i ON i.id=a."invoiceId" WHERE a."documentId"=target AND i."projectId"=d."projectId") THEN RAISE EXCEPTION 'FINANCE_PROJECT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 FOR allocation_row IN SELECT x.*,i.state,i."partyId",i.currency,i."postingDate" FROM public."FinanceCustomerAllocation" x JOIN public."FinanceInvoice" i ON i.id=x."invoiceId" WHERE x."documentId"=target ORDER BY x."invoiceId" LOOP
  IF allocation_row.state<>'POSTED' OR allocation_row."partyId"<>d."partyId" OR allocation_row.currency<>d.currency OR allocation_row."postingDate">d."postingDate" OR allocation_row.amount>public.encova_finance_ar_capacity(allocation_row."invoiceId",d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 END LOOP;
END $$;
COMMIT;
