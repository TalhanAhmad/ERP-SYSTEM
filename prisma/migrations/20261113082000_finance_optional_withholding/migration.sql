BEGIN;
CREATE OR REPLACE FUNCTION encova_finance_customer_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,resource TEXT,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE wht_amount NUMERIC:=0;wht_code UUID;wht_snapshot JSONB;wht_account UUID;wht_quote RECORD; d public."FinanceCustomerDocument"%ROWTYPE;origin public."FinanceCustomerDocument"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;inv public."FinanceInvoice"%ROWTYPE;item JSONB;allowed TEXT[];n INTEGER:=0;alloc_sum NUMERIC:=0;credit_sum NUMERIC:=0;cash NUMERIC:=0;fee NUMERIC:=0;adv NUMERIC:=0;total NUMERIC;advance_account UUID;cash_account UUID;fee_account UUID;source_doc UUID;credit_invoice UUID;project UUID;entry_id UUID;origin_id UUID;origin_version INTEGER;origin_number TEXT;digest TEXT;operation_name TEXT;reason TEXT;result JSONB;prefix TEXT;audit_id UUID;
BEGIN
 IF resource='RECEIPT' AND action IN('CREATE','UPDATE') AND jsonb_typeof(input)='object' THEN input:=jsonb_build_object('withholdingAmount','0.00','withholdingCodeId',NULL)||input;END IF;
 IF resource IS NULL OR resource NOT IN('RECEIPT','ADVANCE_APPLICATION','CUSTOMER_CREDIT','CUSTOMER_REFUND','UNALLOCATION') OR action IS NULL OR action NOT IN('CREATE','UPDATE','POST','VOID','REVERSE','UNALLOCATE') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR(resource='UNALLOCATION' AND action<>'REVERSE') OR(action='UNALLOCATE' AND resource<>'RECEIPT') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 reason:=trim(input->>'reason');IF jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF action IN('CREATE','UPDATE') THEN
  allowed:=ARRAY['reference','partyId','projectId','documentDate','postingDate','description','evidence','currency','reason'];
  allowed:=allowed||(CASE resource WHEN 'RECEIPT' THEN ARRAY['cashAccountId','feeAccountId','advanceAccountId','cashAmount','feeAmount','allocations','withholdingAmount','withholdingCodeId'] WHEN 'ADVANCE_APPLICATION' THEN ARRAY['sourceDocumentId','allocations'] WHEN 'CUSTOMER_CREDIT' THEN ARRAY['invoiceId','advanceAccountId','creditLines'] ELSE ARRAY['sourceDocumentId','cashAccountId','cashAmount'] END);
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
   INSERT INTO public."FinanceCustomerDocument"(id,number,kind,reference,"partyId","cashAccountId","feeAccountId","advanceAccountId","sourceDocumentId","creditInvoiceId","projectId","documentDate","postingDate",description,evidence,currency,"cashAmount","feeAmount","allocationAmount","advanceAmount","totalAmount","createdById","withholdingAmount","withholdingCodeId","withholdingSnapshot","withholdingAccountId","reversalOfId") VALUES(gen_random_uuid(),'REV-'||lpad(nextval('public.finance_customer_number'::regclass)::text,10,'0'),'REVERSAL',origin.reference,origin."partyId",origin."cashAccountId",origin."feeAccountId",origin."advanceAccountId",origin."sourceDocumentId",origin."creditInvoiceId",origin."projectId",(input->>'postingDate')::date,(input->>'postingDate')::date,origin.description,reason,'PKR',origin."cashAmount",origin."feeAmount",origin."allocationAmount",origin."advanceAmount",origin."totalAmount",actor,origin."withholdingAmount",origin."withholdingCodeId",origin."withholdingSnapshot",origin."withholdingAccountId",origin.id) RETURNING * INTO d;
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
   IF jsonb_typeof(input->'cashAmount') IS DISTINCT FROM 'string' OR input->>'cashAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR(input->>'cashAmount')::numeric<0 OR((input->>'cashAmount')::numeric=0 AND resource<>'RECEIPT') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;cash:=(input->>'cashAmount')::numeric;cash_account:=(input->>'cashAccountId')::uuid;
  END IF;
  IF resource='RECEIPT' THEN
   IF jsonb_typeof(input->'withholdingAmount') IS DISTINCT FROM 'string' OR input->>'withholdingAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   wht_amount:=(input->>'withholdingAmount')::numeric;wht_code:=nullif(input->>'withholdingCodeId','')::uuid;
   IF(wht_amount>0) IS DISTINCT FROM(wht_code IS NOT NULL) THEN RAISE EXCEPTION 'FINANCE_TAX_POLICY' USING ERRCODE='P0001';END IF;
   PERFORM public.encova_finance_tax_mapping(wht_code,'CUSTOMER_WITHHOLDING',(input->>'postingDate')::date);
   SELECT * INTO wht_quote FROM public.encova_finance_tax_quote(wht_code,'CUSTOMER_WITHHOLDING',(input->>'postingDate')::date,0,0);wht_snapshot:=wht_quote.snapshot;wht_account:=wht_quote.account;
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
  total:=CASE resource WHEN 'RECEIPT' THEN cash+fee+wht_amount WHEN 'ADVANCE_APPLICATION' THEN alloc_sum WHEN 'CUSTOMER_CREDIT' THEN credit_sum ELSE cash END;adv:=CASE WHEN resource='RECEIPT' THEN total-alloc_sum ELSE 0 END;
  IF total<=0 OR total>999999999999999999.99 OR alloc_sum>999999999999999999.99 OR adv<0 THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_TOTALS' USING ERRCODE='P0001';END IF;
  IF action='CREATE' THEN
   prefix:=CASE resource WHEN 'RECEIPT' THEN 'RCP-' WHEN 'ADVANCE_APPLICATION' THEN 'AAP-' WHEN 'CUSTOMER_CREDIT' THEN 'CN-' ELSE 'RFN-' END;
   INSERT INTO public."FinanceCustomerDocument"(id,number,kind,reference,"partyId","cashAccountId","feeAccountId","advanceAccountId","sourceDocumentId","creditInvoiceId","projectId","documentDate","postingDate",description,evidence,currency,"cashAmount","feeAmount","allocationAmount","advanceAmount","totalAmount","createdById","withholdingAmount","withholdingCodeId","withholdingSnapshot","withholdingAccountId") VALUES(gen_random_uuid(),prefix||lpad(nextval('public.finance_customer_number'::regclass)::text,10,'0'),resource,input->>'reference',(input->>'partyId')::uuid,cash_account,fee_account,advance_account,source_doc,credit_invoice,project,(input->>'documentDate')::date,(input->>'postingDate')::date,input->>'description',input->>'evidence','PKR',cash,fee,alloc_sum,adv,total,actor,wht_amount,wht_code,wht_snapshot,wht_account) RETURNING * INTO d;
  ELSE
   UPDATE public."FinanceCustomerDocument" SET reference=input->>'reference',"partyId"=(input->>'partyId')::uuid,"cashAccountId"=cash_account,"feeAccountId"=fee_account,"advanceAccountId"=advance_account,"sourceDocumentId"=source_doc,"creditInvoiceId"=credit_invoice,"projectId"=project,"documentDate"=(input->>'documentDate')::date,"postingDate"=(input->>'postingDate')::date,description=input->>'description',evidence=input->>'evidence',"cashAmount"=cash,"feeAmount"=fee,"allocationAmount"=alloc_sum,"advanceAmount"=adv,"totalAmount"=total,"withholdingAmount"=wht_amount,"withholdingCodeId"=wht_code,"withholdingSnapshot"=wht_snapshot,"withholdingAccountId"=wht_account,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
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
CREATE OR REPLACE FUNCTION encova_finance_supplier_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,resource TEXT,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE wht_amount NUMERIC:=0;wht_code UUID;wht_snapshot JSONB;wht_account UUID;wht_quote RECORD; d public."FinanceSupplierDocument"%ROWTYPE;origin public."FinanceSupplierDocument"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;inv public."FinanceBill"%ROWTYPE;item JSONB;allowed TEXT[];n INTEGER:=0;alloc_sum NUMERIC:=0;credit_sum NUMERIC:=0;cash NUMERIC:=0;fee NUMERIC:=0;adv NUMERIC:=0;total NUMERIC;advance_account UUID;cash_account UUID;fee_account UUID;source_doc UUID;credit_bill UUID;project UUID;entry_id UUID;origin_id UUID;origin_version INTEGER;origin_number TEXT;digest TEXT;operation_name TEXT;reason TEXT;result JSONB;prefix TEXT;audit_id UUID;
BEGIN
 IF resource='PAYMENT' AND action IN('CREATE','UPDATE') AND jsonb_typeof(input)='object' THEN input:=jsonb_build_object('withholdingAmount','0.00','withholdingCodeId',NULL)||input;END IF;
 IF resource IS NULL OR resource NOT IN('PAYMENT','ADVANCE_APPLICATION','SUPPLIER_CREDIT','SUPPLIER_REFUND','UNALLOCATION') OR action IS NULL OR action NOT IN('CREATE','UPDATE','POST','VOID','REVERSE','UNALLOCATE') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR(resource='UNALLOCATION' AND action<>'REVERSE') OR(action='UNALLOCATE' AND resource<>'PAYMENT') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 reason:=trim(input->>'reason');IF jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF action IN('CREATE','UPDATE') THEN
  allowed:=ARRAY['reference','partyId','projectId','documentDate','postingDate','description','evidence','currency','reason'];
  allowed:=allowed||(CASE resource WHEN 'PAYMENT' THEN ARRAY['cashAccountId','feeAccountId','advanceAccountId','cashAmount','feeAmount','allocations','withholdingAmount','withholdingCodeId'] WHEN 'ADVANCE_APPLICATION' THEN ARRAY['sourceDocumentId','allocations'] WHEN 'SUPPLIER_CREDIT' THEN ARRAY['billId','advanceAccountId','creditLines'] ELSE ARRAY['sourceDocumentId','cashAccountId','cashAmount'] END);
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
   INSERT INTO public."FinanceSupplierDocument"(id,number,kind,reference,"partyId","cashAccountId","feeAccountId","advanceAccountId","sourceDocumentId","creditBillId","projectId","documentDate","postingDate",description,evidence,currency,"cashAmount","feeAmount","allocationAmount","advanceAmount","totalAmount","createdById","withholdingAmount","withholdingCodeId","withholdingSnapshot","withholdingAccountId","reversalOfId") VALUES(gen_random_uuid(),'REV-'||lpad(nextval('public.finance_supplier_number'::regclass)::text,10,'0'),'REVERSAL',origin.reference,origin."partyId",origin."cashAccountId",origin."feeAccountId",origin."advanceAccountId",origin."sourceDocumentId",origin."creditBillId",origin."projectId",(input->>'postingDate')::date,(input->>'postingDate')::date,origin.description,reason,'PKR',origin."cashAmount",origin."feeAmount",origin."allocationAmount",origin."advanceAmount",origin."totalAmount",actor,origin."withholdingAmount",origin."withholdingCodeId",origin."withholdingSnapshot",origin."withholdingAccountId",origin.id) RETURNING * INTO d;
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
   IF jsonb_typeof(input->'cashAmount') IS DISTINCT FROM 'string' OR input->>'cashAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR(input->>'cashAmount')::numeric<0 OR((input->>'cashAmount')::numeric=0 AND resource<>'PAYMENT') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;cash:=(input->>'cashAmount')::numeric;cash_account:=(input->>'cashAccountId')::uuid;
  END IF;
  IF resource='PAYMENT' THEN
   IF jsonb_typeof(input->'withholdingAmount') IS DISTINCT FROM 'string' OR input->>'withholdingAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   wht_amount:=(input->>'withholdingAmount')::numeric;wht_code:=nullif(input->>'withholdingCodeId','')::uuid;
   IF(wht_amount>0) IS DISTINCT FROM(wht_code IS NOT NULL) THEN RAISE EXCEPTION 'FINANCE_TAX_POLICY' USING ERRCODE='P0001';END IF;
   PERFORM public.encova_finance_tax_mapping(wht_code,'SUPPLIER_WITHHOLDING',(input->>'postingDate')::date);
   SELECT * INTO wht_quote FROM public.encova_finance_tax_quote(wht_code,'SUPPLIER_WITHHOLDING',(input->>'postingDate')::date,0,0);wht_snapshot:=wht_quote.snapshot;wht_account:=wht_quote.account;
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
  total:=CASE resource WHEN 'PAYMENT' THEN cash+fee+wht_amount WHEN 'ADVANCE_APPLICATION' THEN alloc_sum WHEN 'SUPPLIER_CREDIT' THEN credit_sum ELSE cash END;adv:=CASE WHEN resource='PAYMENT' THEN total-alloc_sum ELSE 0 END;
  IF total<=0 OR total>999999999999999999.99 OR alloc_sum>999999999999999999.99 OR adv<0 THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_TOTALS' USING ERRCODE='P0001';END IF;
  IF action='CREATE' THEN
   prefix:=CASE resource WHEN 'PAYMENT' THEN 'PAY-' WHEN 'ADVANCE_APPLICATION' THEN 'SAP-' WHEN 'SUPPLIER_CREDIT' THEN 'SCN-' ELSE 'SRF-' END;
   INSERT INTO public."FinanceSupplierDocument"(id,number,kind,reference,"partyId","cashAccountId","feeAccountId","advanceAccountId","sourceDocumentId","creditBillId","projectId","documentDate","postingDate",description,evidence,currency,"cashAmount","feeAmount","allocationAmount","advanceAmount","totalAmount","createdById","withholdingAmount","withholdingCodeId","withholdingSnapshot","withholdingAccountId") VALUES(gen_random_uuid(),prefix||lpad(nextval('public.finance_supplier_number'::regclass)::text,10,'0'),resource,input->>'reference',(input->>'partyId')::uuid,cash_account,fee_account,advance_account,source_doc,credit_bill,project,(input->>'documentDate')::date,(input->>'postingDate')::date,input->>'description',input->>'evidence','PKR',cash,fee,alloc_sum,adv,total,actor,wht_amount,wht_code,wht_snapshot,wht_account) RETURNING * INTO d;
  ELSE
   UPDATE public."FinanceSupplierDocument" SET reference=input->>'reference',"partyId"=(input->>'partyId')::uuid,"cashAccountId"=cash_account,"feeAccountId"=fee_account,"advanceAccountId"=advance_account,"sourceDocumentId"=source_doc,"creditBillId"=credit_bill,"projectId"=project,"documentDate"=(input->>'documentDate')::date,"postingDate"=(input->>'postingDate')::date,description=input->>'description',evidence=input->>'evidence',"cashAmount"=cash,"feeAmount"=fee,"allocationAmount"=alloc_sum,"advanceAmount"=adv,"totalAmount"=total,"withholdingAmount"=wht_amount,"withholdingCodeId"=wht_code,"withholdingSnapshot"=wht_snapshot,"withholdingAccountId"=wht_account,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
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
COMMIT;
