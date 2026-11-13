BEGIN;
ALTER TABLE "FinanceCustomerDocument" ADD COLUMN "sourceDocumentId" UUID REFERENCES "FinanceCustomerDocument" ON DELETE RESTRICT,ADD COLUMN "advanceAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,ADD COLUMN "advanceAmount" NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK("advanceAmount">=0);
ALTER TABLE "FinanceCustomerDocument" DROP CONSTRAINT "FinanceCustomerDocument_number_check",DROP CONSTRAINT "FinanceCustomerDocument_kind_check",DROP CONSTRAINT "FinanceCustomerDocument_cashAmount_check",DROP CONSTRAINT "FinanceCustomerDocument_allocationAmount_check",DROP CONSTRAINT "FinanceCustomerDocument_check1",DROP CONSTRAINT "FinanceCustomerDocument_cashAccountId_check";
ALTER TABLE "FinanceCustomerDocument" ADD CONSTRAINT "FinanceCustomerDocument_kind_check" CHECK(kind IN('RECEIPT','ADVANCE_APPLICATION')),ADD CONSTRAINT "FinanceCustomerDocument_number_kind" CHECK((kind='RECEIPT' AND number~'^RCP-[0-9]{10}$') OR(kind='ADVANCE_APPLICATION' AND number~'^AAP-[0-9]{10}$')),ADD CONSTRAINT "FinanceCustomerDocument_amounts" CHECK("cashAmount">=0 AND "allocationAmount">=0 AND "totalAmount">0),ADD CONSTRAINT "FinanceCustomerDocument_commercial_source" CHECK(
 (kind='RECEIPT' AND "cashAmount">0 AND "cashAccountId" IS NOT NULL AND "sourceDocumentId" IS NULL AND "totalAmount"="cashAmount"+"feeAmount" AND "totalAmount"="allocationAmount"+"advanceAmount" AND ("advanceAmount">0)=("advanceAccountId" IS NOT NULL)) OR
 (kind='ADVANCE_APPLICATION' AND "cashAmount"=0 AND "feeAmount"=0 AND "cashAccountId" IS NULL AND "sourceDocumentId" IS NOT NULL AND "sourceDocumentId"<>id AND "advanceAccountId" IS NOT NULL AND "advanceAmount"=0 AND "allocationAmount">0 AND "totalAmount"="allocationAmount"));
CREATE TABLE "FinanceClientBalanceEvent"(id UUID PRIMARY KEY,"documentId" UUID NOT NULL UNIQUE REFERENCES "FinanceCustomerDocument" ON DELETE RESTRICT,"sourceDocumentId" UUID NOT NULL REFERENCES "FinanceCustomerDocument" ON DELETE RESTRICT,"partyId" UUID NOT NULL REFERENCES "FinanceParty" ON DELETE RESTRICT,"accountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,"journalId" UUID NOT NULL REFERENCES "FinanceJournalEntry" ON DELETE RESTRICT,"effectiveDate" DATE NOT NULL,kind TEXT NOT NULL,amount NUMERIC(20,2) NOT NULL,currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),CHECK((kind='RECEIVED' AND amount>0) OR(kind='APPLIED' AND amount<0)));
CREATE INDEX "FinanceClientBalanceEvent_sourceDocumentId_effectiveDate_id_idx" ON "FinanceClientBalanceEvent"("sourceDocumentId","effectiveDate",id);
CREATE TRIGGER "FinanceClientBalanceEvent_config_lock" BEFORE INSERT ON "FinanceClientBalanceEvent" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceClientBalanceEvent_immutable" BEFORE UPDATE OR DELETE ON "FinanceClientBalanceEvent" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
ALTER TABLE "FinanceReceivableEvent" DROP CONSTRAINT "FinanceReceivableEvent_source_kind";
ALTER TABLE "FinanceReceivableEvent" ADD CONSTRAINT "FinanceReceivableEvent_source_kind" CHECK((kind='INVOICE' AND amount>0 AND "customerDocumentId" IS NULL) OR(kind IN('RECEIPT','ADVANCE_APPLICATION') AND amount<0 AND "customerDocumentId" IS NOT NULL));
CREATE FUNCTION encova_finance_client_capacity(target UUID,cutoff DATE) RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(min((SELECT coalesce(sum(e.amount),0) FROM public."FinanceClientBalanceEvent" e WHERE e."sourceDocumentId"=target AND e."effectiveDate"<=dates.d)),0) FROM(SELECT cutoff AS d UNION SELECT "effectiveDate" FROM public."FinanceClientBalanceEvent" WHERE "sourceDocumentId"=target AND "effectiveDate">=cutoff)dates
$$;
CREATE OR REPLACE FUNCTION encova_finance_customer_lines(target UUID) RETURNS TABLE(sequence INTEGER,"accountId" UUID,description TEXT,debit NUMERIC,credit NUMERIC,"projectId" UUID,"partyId" UUID,"invoiceLineId" UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT 1,c."glAccountId",d.description,d."cashAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d JOIN public."FinanceCashAccount" c ON c.id=d."cashAccountId" WHERE d.id=target AND d.kind='RECEIPT'
 UNION ALL SELECT 2,d."feeAccountId",d.description,d."feeAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d.kind='RECEIPT' AND d."feeAmount">0
 UNION ALL SELECT 10+a.sequence,i."receivableAccountId",d.description,0::numeric,a.amount,i."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerAllocation" a ON a."documentId"=d.id JOIN public."FinanceInvoice" i ON i.id=a."invoiceId" WHERE d.id=target
 UNION ALL SELECT 150,d."advanceAccountId",d.description,0::numeric,d."advanceAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d.kind='RECEIPT' AND d."advanceAmount">0
 UNION ALL SELECT 1,d."advanceAccountId",d.description,d."totalAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d.kind='ADVANCE_APPLICATION'
$$;

CREATE OR REPLACE FUNCTION encova_finance_customer_validate(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;allocation_row record; source_doc public."FinanceCustomerDocument"%ROWTYPE;
BEGIN
 SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=target;
 IF d.id IS NULL OR d.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=d."partyId" AND kind IN('CLIENT','BOTH')) THEN RAISE EXCEPTION 'FINANCE_INVOICE_PARTY' USING ERRCODE='P0001';END IF;
 IF d.kind='RECEIPT' THEN
 IF NOT EXISTS(SELECT 1 FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" gl ON gl.id=c."glAccountId" WHERE c.id=d."cashAccountId" AND c.active AND gl.active AND gl."isPosting" AND NOT gl."isContra" AND gl."controlType"='CASH' AND gl.type='ASSET' AND gl.currency='PKR' AND c.currency='PKR') THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_MAPPING' USING ERRCODE='P0001';END IF;
 IF d."feeAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."feeAccountId" AND active AND "isPosting" AND NOT "isContra" AND "controlType"='NONE' AND type IN('DIRECT_COST','OPERATING_EXPENSE','OTHER_EXPENSE') AND currency='PKR') THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_MAPPING' USING ERRCODE='P0001';END IF;
  IF d."advanceAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=d."partyId" AND active) THEN RAISE EXCEPTION 'FINANCE_INVOICE_PARTY' USING ERRCODE='P0001';END IF;
 ELSE
  SELECT * INTO source_doc FROM public."FinanceCustomerDocument" WHERE id=d."sourceDocumentId";
  IF source_doc.id IS NULL OR source_doc.kind<>'RECEIPT' OR source_doc.state<>'POSTED' OR source_doc."partyId"<>d."partyId" OR source_doc."advanceAccountId" IS DISTINCT FROM d."advanceAccountId" OR source_doc."postingDate">d."documentDate" OR d."totalAmount">public.encova_finance_client_capacity(source_doc.id,d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ADVANCE_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 END IF;
 IF d."advanceAccountId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."advanceAccountId" AND active AND "isPosting" AND NOT "isContra" AND "controlType"='CLIENT_ADVANCE' AND type='LIABILITY' AND currency='PKR') THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_MAPPING' USING ERRCODE='P0001';END IF;
 IF d."projectId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Project" WHERE id=d."projectId" AND "archivedAt" IS NULL) AND NOT EXISTS(SELECT 1 FROM public."FinanceCustomerAllocation" a JOIN public."FinanceInvoice" i ON i.id=a."invoiceId" WHERE a."documentId"=target AND i."projectId"=d."projectId") THEN RAISE EXCEPTION 'FINANCE_PROJECT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 FOR allocation_row IN SELECT x.*,i.state,i."partyId",i.currency,i."postingDate" FROM public."FinanceCustomerAllocation" x JOIN public."FinanceInvoice" i ON i.id=x."invoiceId" WHERE x."documentId"=target ORDER BY x."invoiceId" LOOP
  IF allocation_row.state<>'POSTED' OR allocation_row."partyId"<>d."partyId" OR allocation_row.currency<>d.currency OR allocation_row."postingDate">d."postingDate" OR allocation_row.amount>public.encova_finance_ar_capacity(allocation_row."invoiceId",d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_check_customer(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;e public."FinanceJournalEntry"%ROWTYPE;n BIGINT;amount NUMERIC;bad BOOLEAN;
BEGIN
 SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=target;
 IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 SELECT count(*),coalesce(sum(a.amount),0) INTO n,amount FROM public."FinanceCustomerAllocation" a WHERE a."documentId"=target;
 IF n NOT BETWEEN 0 AND 100 OR (d.kind='ADVANCE_APPLICATION' AND n=0) OR amount<>d."allocationAmount" THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_TOTALS' USING ERRCODE='P0001';END IF;
 SELECT * INTO e FROM public."FinanceJournalEntry" WHERE "customerDocumentId"=target;
 IF d.state<>'POSTED' THEN IF e.id IS NOT NULL OR EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" WHERE "customerDocumentId"=target) OR EXISTS(SELECT 1 FROM public."FinanceClientBalanceEvent" WHERE "documentId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;END IF;
 IF e.id IS NULL OR e."sourceType"<>'CUSTOMER_DOCUMENT' OR e."postingDate"<>d."postingDate" OR e.description<>d.description OR e.evidence<>d.evidence OR d."partySnapshot" IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id) EXCEPT(SELECT * FROM public.encova_finance_customer_lines(target))) OR EXISTS((SELECT * FROM public.encova_finance_customer_lines(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF (SELECT count(*) FROM public."FinanceReceivableEvent" WHERE "customerDocumentId"=target)<>n OR EXISTS(SELECT 1 FROM public."FinanceCustomerAllocation" a JOIN public."FinanceInvoice" i ON i.id=a."invoiceId" WHERE a."documentId"=target AND NOT EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" v WHERE v."customerDocumentId"=target AND v."invoiceId"=i.id AND v."partyId"=d."partyId" AND v."accountId"=i."receivableAccountId" AND v."journalId"=e.id AND v."effectiveDate"=d."postingDate" AND v.kind=d.kind AND v.amount=-a.amount)) THEN RAISE EXCEPTION 'FINANCE_RECEIVABLE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF (SELECT count(*) FROM public."FinanceClientBalanceEvent" WHERE "documentId"=target)<>(CASE WHEN d.kind='ADVANCE_APPLICATION' OR d."advanceAmount">0 THEN 1 ELSE 0 END) OR ((d.kind='ADVANCE_APPLICATION' OR d."advanceAmount">0) AND NOT EXISTS(SELECT 1 FROM public."FinanceClientBalanceEvent" b WHERE b."documentId"=target AND b."sourceDocumentId"=CASE WHEN d.kind='RECEIPT' THEN d.id ELSE d."sourceDocumentId" END AND b."partyId"=d."partyId" AND b."accountId"=d."advanceAccountId" AND b."journalId"=e.id AND b."effectiveDate"=d."postingDate" AND b.kind=CASE WHEN d.kind='RECEIPT' THEN 'RECEIVED' ELSE 'APPLIED' END AND b.amount=CASE WHEN d.kind='RECEIPT' THEN d."advanceAmount" ELSE -d."totalAmount" END)) THEN RAISE EXCEPTION 'FINANCE_CLIENT_BALANCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(b.amount) OVER(PARTITION BY b."sourceDocumentId" ORDER BY b."effectiveDate" RANGE UNBOUNDED PRECEDING) AS balance FROM public."FinanceClientBalanceEvent" b WHERE b."sourceDocumentId"=CASE WHEN d.kind='RECEIPT' THEN d.id ELSE d."sourceDocumentId" END)balances WHERE balance<0) THEN RAISE EXCEPTION 'FINANCE_ADVANCE_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 SELECT EXISTS(SELECT 1 FROM(SELECT sum(v.amount) OVER(PARTITION BY v."invoiceId" ORDER BY v."effectiveDate" RANGE UNBOUNDED PRECEDING) AS balance FROM public."FinanceReceivableEvent" v WHERE v."invoiceId" IN(SELECT "invoiceId" FROM public."FinanceCustomerAllocation" WHERE "documentId"=target))b WHERE balance<0) INTO bad;
 IF bad THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_customer_check_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;BEGIN
 IF TG_TABLE_NAME='FinanceCustomerDocument' THEN target:=NEW.id;
 ELSIF TG_TABLE_NAME='FinanceClientBalanceEvent' THEN target:=NEW."documentId";
 ELSIF TG_TABLE_NAME='FinanceCustomerAllocation' THEN target:=CASE WHEN TG_OP='DELETE' THEN OLD."documentId" ELSE NEW."documentId" END;
 ELSE target:=NEW."customerDocumentId";END IF;
 IF target IS NOT NULL THEN PERFORM public.encova_finance_check_customer(target);END IF;RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_customer_effects(actor UUID,target UUID,entry_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;BEGIN
 SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=target;
 INSERT INTO public."FinanceReceivableEvent"(id,"invoiceId","partyId","accountId","journalId","effectiveDate",kind,amount,"customerDocumentId") SELECT gen_random_uuid(),i.id,d."partyId",i."receivableAccountId",entry_id,d."postingDate",d.kind,-a.amount,d.id FROM public."FinanceCustomerAllocation" a JOIN public."FinanceInvoice" i ON i.id=a."invoiceId" WHERE a."documentId"=target;
 IF d.kind='RECEIPT' AND d."advanceAmount">0 THEN
  INSERT INTO public."FinanceClientBalanceEvent"(id,"documentId","sourceDocumentId","partyId","accountId","journalId","effectiveDate",kind,amount) VALUES(gen_random_uuid(),d.id,d.id,d."partyId",d."advanceAccountId",entry_id,d."postingDate",'RECEIVED',d."advanceAmount");
 ELSIF d.kind='ADVANCE_APPLICATION' THEN
  INSERT INTO public."FinanceClientBalanceEvent"(id,"documentId","sourceDocumentId","partyId","accountId","journalId","effectiveDate",kind,amount) VALUES(gen_random_uuid(),d.id,d."sourceDocumentId",d."partyId",d."advanceAccountId",entry_id,d."postingDate",'APPLIED',-d."totalAmount");
 END IF;
 UPDATE public."FinanceParty" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=d."partyId";
 UPDATE public."FinanceCustomerDocument" SET state='POSTED',version=version+1,"partySnapshot"=public.encova_finance_party_snapshot("partyId"),"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_customer_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,resource TEXT,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;item JSONB;n INTEGER:=0;allocations NUMERIC:=0;cash NUMERIC;fee NUMERIC;entry_id UUID;digest TEXT;operation_name TEXT;reason TEXT;result JSONB; source_doc public."FinanceCustomerDocument"%ROWTYPE; adv NUMERIC;advance_account UUID;total NUMERIC;
BEGIN
 IF (resource IS NULL OR resource NOT IN('RECEIPT','ADVANCE_APPLICATION')) OR action IS NULL OR action NOT IN('CREATE','UPDATE','POST','VOID') OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 reason:=trim(input->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF input-(CASE WHEN action='CREATE' THEN ARRAY['reference','partyId','cashAccountId','feeAccountId','advanceAccountId','sourceDocumentId','projectId','documentDate','postingDate','description','evidence','currency','cashAmount','feeAmount','allocations','reason'] WHEN action='UPDATE' THEN ARRAY['id','expectedVersion','reference','partyId','cashAccountId','feeAccountId','advanceAccountId','sourceDocumentId','projectId','documentDate','postingDate','description','evidence','currency','cashAmount','feeAmount','allocations','reason'] ELSE ARRAY['id','expectedVersion','reason'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
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
  IF resource='ADVANCE_APPLICATION' THEN
   IF input-ARRAY['id','expectedVersion','reference','partyId','sourceDocumentId','projectId','documentDate','postingDate','description','evidence','currency','allocations','reason']<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   SELECT * INTO source_doc FROM public."FinanceCustomerDocument" WHERE id=(input->>'sourceDocumentId')::uuid;
   input:=input||jsonb_build_object('cashAmount','0.00','feeAmount','0.00');
  ELSIF input ? 'sourceDocumentId' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF input->>'currency' IS DISTINCT FROM 'PKR' OR jsonb_typeof(input->'allocations') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'allocations') NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'cashAmount') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'feeAmount') IS DISTINCT FROM 'string' OR input->>'cashAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR input->>'feeAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF input->>'documentDate' IS NULL OR input->>'postingDate' IS NULL OR input->>'documentDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR input->>'postingDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=(input->>'partyId')::uuid AND kind IN('CLIENT','BOTH')) THEN RAISE EXCEPTION 'FINANCE_INVOICE_PARTY' USING ERRCODE='P0001';END IF;
  cash:=(input->>'cashAmount')::numeric;fee:=(input->>'feeAmount')::numeric;
  FOR item IN SELECT value FROM jsonb_array_elements(input->'allocations') LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['invoiceId','amount']<>'{}'::jsonb OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'string' OR item->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR(item->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;allocations:=allocations+(item->>'amount')::numeric;
  END LOOP;
  total:=CASE WHEN resource='RECEIPT' THEN cash+fee ELSE allocations END;adv:=CASE WHEN resource='RECEIPT' THEN total-allocations ELSE 0 END;advance_account:=CASE WHEN resource='RECEIPT' THEN nullif(input->>'advanceAccountId','')::uuid ELSE source_doc."advanceAccountId" END;
  IF (resource='RECEIPT' AND cash<=0) OR total<=0 OR adv<0 OR total>999999999999999999.99 OR allocations>999999999999999999.99 THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_TOTALS' USING ERRCODE='P0001';END IF;
  IF action='CREATE' THEN INSERT INTO public."FinanceCustomerDocument"(id,kind,reference,"partyId","cashAccountId","feeAccountId","projectId","documentDate","postingDate",description,evidence,currency,"cashAmount","feeAmount","allocationAmount","totalAmount","advanceAmount","advanceAccountId","sourceDocumentId","createdById",number) VALUES(gen_random_uuid(),resource,input->>'reference',(input->>'partyId')::uuid,(input->>'cashAccountId')::uuid,nullif(input->>'feeAccountId','')::uuid,nullif(input->>'projectId','')::uuid,(input->>'documentDate')::date,(input->>'postingDate')::date,input->>'description',input->>'evidence','PKR',cash,fee,allocations,total,adv,advance_account,CASE WHEN resource='ADVANCE_APPLICATION' THEN (input->>'sourceDocumentId')::uuid ELSE NULL END,actor,(CASE WHEN resource='RECEIPT' THEN 'RCP-' ELSE 'AAP-' END)||lpad(nextval('public.finance_customer_number'::regclass)::text,10,'0')) RETURNING * INTO d;
  ELSE UPDATE public."FinanceCustomerDocument" SET reference=input->>'reference',"partyId"=(input->>'partyId')::uuid,"cashAccountId"=(input->>'cashAccountId')::uuid,"feeAccountId"=nullif(input->>'feeAccountId','')::uuid,"projectId"=nullif(input->>'projectId','')::uuid,"documentDate"=(input->>'documentDate')::date,"postingDate"=(input->>'postingDate')::date,description=input->>'description',evidence=input->>'evidence',"cashAmount"=cash,"feeAmount"=fee,"allocationAmount"=allocations,"totalAmount"=total,"advanceAmount"=adv,"advanceAccountId"=advance_account,"sourceDocumentId"=CASE WHEN resource='ADVANCE_APPLICATION' THEN (input->>'sourceDocumentId')::uuid ELSE NULL END,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;DELETE FROM public."FinanceCustomerAllocation" WHERE "documentId"=d.id;END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(input->'allocations') LOOP n:=n+1;INSERT INTO public."FinanceCustomerAllocation"(id,"documentId","invoiceId",sequence,amount) VALUES(gen_random_uuid(),d.id,(item->>'invoiceId')::uuid,n,(item->>'amount')::numeric);END LOOP;
 ELSIF action='VOID' THEN UPDATE public."FinanceCustomerDocument" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
 ELSE entry_id:=public.encova_finance_emit_journal(actor,'CUSTOMER_DOCUMENT',d.id,d."postingDate",reason);SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=d.id;END IF;
 result:=jsonb_build_object('id',d.id,'version',d.version,'number',d.number,'journalId',entry_id);
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,operation_name,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_'||operation_name,'FinanceCustomerDocument',d.id,reason,jsonb_build_object('journalId',entry_id,'snapshot',to_jsonb(d)||jsonb_build_object('cashAmount',d."cashAmount"::text,'feeAmount',d."feeAmount"::text,'allocationAmount',d."allocationAmount"::text,'totalAmount',d."totalAmount"::text,'advanceAmount',d."advanceAmount"::text),'allocations',(SELECT jsonb_agg(to_jsonb(a)||jsonb_build_object('amount',a.amount::text) ORDER BY sequence) FROM public."FinanceCustomerAllocation" a WHERE a."documentId"=d.id)),request_id);RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';
 WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END $$;
CREATE CONSTRAINT TRIGGER "FinanceClientBalanceEvent_valid" AFTER INSERT ON "FinanceClientBalanceEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_customer_check_trigger();
ALTER TABLE "FinanceClientBalanceEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "FinanceClientBalanceEvent" FROM PUBLIC;
REVOKE ALL ON FUNCTION encova_finance_client_capacity(UUID,DATE) FROM PUBLIC;
DO $$ DECLARE r TEXT;BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public."FinanceClientBalanceEvent" FROM %I',r);EXECUTE format('REVOKE ALL ON FUNCTION public.encova_finance_client_capacity(UUID,DATE) FROM %I',r);END IF;END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT SELECT ON TABLE "FinanceClientBalanceEvent" TO encova_app;CREATE POLICY encova_runtime ON "FinanceClientBalanceEvent" TO encova_app USING(true);REVOKE ALL ON FUNCTION encova_finance_client_capacity(UUID,DATE) FROM encova_app;END IF;
END $$;
COMMIT;
