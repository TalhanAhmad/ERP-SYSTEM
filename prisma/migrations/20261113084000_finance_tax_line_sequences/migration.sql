BEGIN;
ALTER TABLE "FinanceJournalLine" DROP CONSTRAINT "FinanceJournalLine_sequence_check";
ALTER TABLE "FinanceJournalLine" ADD CONSTRAINT "FinanceJournalLine_sequence_check" CHECK(sequence BETWEEN 1 AND 400);
CREATE OR REPLACE FUNCTION encova_finance_customer_deferred_credits(target UUID) RETURNS TABLE("invoiceLineId" UUID,amount NUMERIC) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT c."invoiceLineId",-coalesce(s."netAmount",c.amount) FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerCreditLine" c ON c."documentId"=d.id JOIN public."FinanceInvoiceLine" l ON l.id=c."invoiceLineId" LEFT JOIN public."FinanceCreditTaxSplit" s ON s."customerCreditLineId"=c.id WHERE d.id=target AND d.kind='CUSTOMER_CREDIT' AND l.recognition='DEFERRED' AND coalesce(s."netAmount",c.amount)>0
 UNION ALL SELECT e."invoiceLineId",-e.amount FROM public."FinanceCustomerDocument" d JOIN public."FinanceDeferredRevenueEvent" e ON e."customerDocumentId"=d."reversalOfId" WHERE d.id=target AND d.kind='REVERSAL';
$$;
COMMIT;
