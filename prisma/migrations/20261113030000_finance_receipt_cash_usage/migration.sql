BEGIN;
-- Cash mappings already freeze through their GL usedAt marker.
CREATE OR REPLACE FUNCTION encova_finance_customer_effects(actor UUID,target UUID,entry_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;BEGIN
 SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=target;
 INSERT INTO public."FinanceReceivableEvent"(id,"invoiceId","partyId","accountId","journalId","effectiveDate",kind,amount,"customerDocumentId") SELECT gen_random_uuid(),i.id,d."partyId",i."receivableAccountId",entry_id,d."postingDate",'RECEIPT',-a.amount,d.id FROM public."FinanceCustomerAllocation" a JOIN public."FinanceInvoice" i ON i.id=a."invoiceId" WHERE a."documentId"=target;
 UPDATE public."FinanceParty" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=d."partyId";
 UPDATE public."FinanceCustomerDocument" SET state='POSTED',version=version+1,"partySnapshot"=public.encova_finance_party_snapshot("partyId"),"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;
END $$;
COMMIT;
