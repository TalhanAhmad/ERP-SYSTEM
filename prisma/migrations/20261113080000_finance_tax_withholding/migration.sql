BEGIN;
ALTER TABLE "FinanceAccount" DROP CONSTRAINT "FinanceAccount_controlType_check",DROP CONSTRAINT "FinanceAccount_control_type";
ALTER TABLE "FinanceAccount" ADD CONSTRAINT "FinanceAccount_controlType_check" CHECK("controlType" IN('NONE','CASH','RECEIVABLES','PAYABLES','CLIENT_ADVANCE','SUPPLIER_ADVANCE','FIXED_ASSET','ACCUMULATED_DEPRECIATION','INVESTMENT','LOAN_RECEIVABLE','LOAN_PAYABLE','DEFERRED_REVENUE','TAX_INPUT','TAX_OUTPUT','WITHHOLDING_RECEIVABLE','WITHHOLDING_PAYABLE')),ADD CONSTRAINT "FinanceAccount_control_type" CHECK("controlType"='NONE' OR(type='ASSET' AND "controlType" IN('CASH','RECEIVABLES','SUPPLIER_ADVANCE','FIXED_ASSET','ACCUMULATED_DEPRECIATION','INVESTMENT','LOAN_RECEIVABLE','TAX_INPUT','WITHHOLDING_RECEIVABLE')) OR(type='LIABILITY' AND "controlType" IN('PAYABLES','CLIENT_ADVANCE','LOAN_PAYABLE','DEFERRED_REVENUE','TAX_OUTPUT','WITHHOLDING_PAYABLE')));
CREATE TABLE "FinanceTaxCode"(id UUID PRIMARY KEY,code TEXT NOT NULL CHECK(code~'^[A-Z0-9][A-Z0-9._-]{0,39}$'),name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),kind TEXT NOT NULL CHECK(kind IN('INDIRECT','WITHHOLDING')),"effectiveFrom" DATE NOT NULL,"effectiveTo" DATE,rate NUMERIC(12,6) NOT NULL CHECK(rate BETWEEN 0 AND 1000),mode TEXT NOT NULL CHECK(mode IN('EXCLUSIVE','INCLUSIVE')),rounding TEXT NOT NULL CHECK(rounding IN('HALF_UP','DOWN')),"inputAccountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,"outputAccountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,"policyEvidence" TEXT NOT NULL CHECK(length(trim("policyEvidence")) BETWEEN 3 AND 1000),"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,active BOOLEAN NOT NULL DEFAULT true,CHECK("effectiveFrom" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' AND("effectiveTo" IS NULL OR "effectiveTo" BETWEEN "effectiveFrom" AND DATE '9999-12-31')),CHECK(kind<>'WITHHOLDING' OR mode='EXCLUSIVE'),UNIQUE(code,"effectiveFrom"));
CREATE FUNCTION encova_finance_tax_code_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public."FinanceTaxCode" WHERE code=NEW.code AND daterange("effectiveFrom","effectiveTo",'[]') && daterange(NEW."effectiveFrom",NEW."effectiveTo",'[]')) THEN RAISE EXCEPTION 'FINANCE_DUPLICATE_TAX_CODE' USING ERRCODE='P0001';END IF;
 IF TG_OP='DELETE' OR(TG_OP='UPDATE' AND(to_jsonb(NEW)-'active') IS DISTINCT FROM(to_jsonb(OLD)-'active')) THEN RAISE EXCEPTION 'FINANCE_TAX_IMMUTABLE' USING ERRCODE='P0001';END IF;RETURN NEW;END $$;
CREATE TRIGGER "FinanceTaxCode_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceTaxCode" FOR EACH ROW EXECUTE FUNCTION encova_finance_tax_code_guard();
CREATE TRIGGER "FinanceTaxCode_config" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceTaxCode" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE FUNCTION encova_finance_tax_quote(tax_id UUID,scope TEXT,posting_date DATE,gross NUMERIC,discount NUMERIC) RETURNS TABLE(net NUMERIC,tax NUMERIC,total NUMERIC,snapshot JSONB,account UUID) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE c public."FinanceTaxCode"%ROWTYPE;raw NUMERIC;BEGIN
 net:=gross-discount;tax:=0;total:=net;snapshot:=NULL;account:=NULL;
 IF scope IS NULL OR scope NOT IN('SALE','PURCHASE','CUSTOMER_WITHHOLDING','SUPPLIER_WITHHOLDING') OR net<0 THEN RAISE EXCEPTION 'FINANCE_TAX_POLICY' USING ERRCODE='P0001';END IF;
 IF tax_id IS NOT NULL THEN
  SELECT * INTO c FROM public."FinanceTaxCode" WHERE id=tax_id;
  IF c.id IS NULL OR posting_date<c."effectiveFrom" OR(c."effectiveTo" IS NOT NULL AND posting_date>c."effectiveTo") OR(c.kind='WITHHOLDING') IS DISTINCT FROM(scope IN('CUSTOMER_WITHHOLDING','SUPPLIER_WITHHOLDING')) THEN RAISE EXCEPTION 'FINANCE_TAX_POLICY' USING ERRCODE='P0001';END IF;
  snapshot:=jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'kind',c.kind,'rate',c.rate::text,'mode',c.mode,'rounding',c.rounding,'effectiveFrom',c."effectiveFrom",'effectiveTo',c."effectiveTo",'policyEvidence',c."policyEvidence",'inputAccountId',c."inputAccountId",'outputAccountId',c."outputAccountId");account:=CASE WHEN scope IN('PURCHASE','CUSTOMER_WITHHOLDING') THEN c."inputAccountId" ELSE c."outputAccountId" END;
  IF c.kind='INDIRECT' THEN raw:=CASE WHEN c.mode='EXCLUSIVE' THEN net*c.rate/100 ELSE net*c.rate/(100+c.rate) END;tax:=CASE WHEN c.rounding='DOWN' THEN trunc(raw,2) ELSE round(raw,2) END;IF c.mode='INCLUSIVE' THEN net:=net-tax;ELSE total:=net+tax;END IF;END IF;
 END IF;
 RETURN NEXT;
END $$;
CREATE FUNCTION encova_finance_tax_mapping(tax_id UUID,scope TEXT,posting_date DATE) RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE c public."FinanceTaxCode"%ROWTYPE;BEGIN
 IF tax_id IS NULL THEN RETURN;END IF;SELECT * INTO c FROM public."FinanceTaxCode" WHERE id=tax_id;
 PERFORM * FROM public.encova_finance_tax_quote(tax_id,scope,posting_date,0,0);
 IF c.id IS NULL OR NOT c.active OR EXISTS(SELECT 1 FROM public."FinanceAccount" a WHERE a.id IN(c."inputAccountId",c."outputAccountId") AND(NOT a.active OR NOT a."isPosting" OR a."isContra" OR a.currency<>'PKR' OR a."controlType"<>CASE WHEN a.id=c."inputAccountId" THEN CASE WHEN c.kind='INDIRECT' THEN 'TAX_INPUT' ELSE 'WITHHOLDING_RECEIVABLE' END ELSE CASE WHEN c.kind='INDIRECT' THEN 'TAX_OUTPUT' ELSE 'WITHHOLDING_PAYABLE' END END)) THEN RAISE EXCEPTION 'FINANCE_TAX_MAPPING' USING ERRCODE='P0001';END IF;
END $$;
CREATE TABLE "FinanceCreditTaxSplit"(id UUID PRIMARY KEY,"customerCreditLineId" UUID UNIQUE REFERENCES "FinanceCustomerCreditLine" ON DELETE RESTRICT,"supplierCreditLineId" UUID UNIQUE REFERENCES "FinanceSupplierCreditLine" ON DELETE RESTRICT,"netAmount" NUMERIC(20,2) NOT NULL CHECK("netAmount">=0),"taxAmount" NUMERIC(20,2) NOT NULL CHECK("taxAmount">=0),"taxAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,CHECK(("customerCreditLineId" IS NULL)<>("supplierCreditLineId" IS NULL)),CHECK("taxAmount"=0 OR "taxAccountId" IS NOT NULL));
CREATE TRIGGER "FinanceCreditTaxSplit_config" BEFORE INSERT ON "FinanceCreditTaxSplit" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceCreditTaxSplit_immutable" BEFORE UPDATE OR DELETE ON "FinanceCreditTaxSplit" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
CREATE FUNCTION encova_finance_tax_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public."FinanceTaxCode"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;digest TEXT;operation_name TEXT;reason TEXT;result JSONB;
BEGIN
 IF action IS NULL OR action NOT IN('CREATE','RETIRE') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 reason:=trim(input->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 OR input-(CASE WHEN action='CREATE' THEN ARRAY['code','name','kind','effectiveFrom','effectiveTo','rate','mode','rounding','inputAccountId','outputAccountId','policyEvidence','reason'] ELSE ARRAY['id','reason'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) OR NOT EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=actor) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 operation_name:='TAX_'||action;digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');SELECT * INTO r FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation=operation_name AND key=request_key;
 IF FOUND THEN IF r."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN r.result;END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action='CREATE' THEN
  IF jsonb_typeof(input->'rate') IS DISTINCT FROM 'string' OR input->>'rate' !~ '^(0|[1-9][0-9]{0,3})([.][0-9]{1,6})?$' OR input->>'effectiveFrom' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR(input->>'effectiveTo' IS NOT NULL AND input->>'effectiveTo' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinanceTaxCode"(id,code,name,kind,"effectiveFrom","effectiveTo",rate,mode,rounding,"inputAccountId","outputAccountId","policyEvidence","createdById") VALUES(gen_random_uuid(),input->>'code',input->>'name',input->>'kind',(input->>'effectiveFrom')::date,(input->>'effectiveTo')::date,(input->>'rate')::numeric,input->>'mode',input->>'rounding',(input->>'inputAccountId')::uuid,(input->>'outputAccountId')::uuid,input->>'policyEvidence',actor) RETURNING * INTO c;
  PERFORM public.encova_finance_tax_mapping(c.id,CASE WHEN c.kind='INDIRECT' THEN 'SALE' ELSE 'CUSTOMER_WITHHOLDING' END,c."effectiveFrom");
 ELSE UPDATE public."FinanceTaxCode" SET active=false WHERE id=(input->>'id')::uuid RETURNING * INTO c;IF c.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;END IF;
 result:=jsonb_build_object('id',c.id,'code',c.code,'active',c.active);
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,operation_name,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_'||operation_name,'FinanceTaxCode',c.id,reason,to_jsonb(c)||jsonb_build_object('rate',c.rate::text),request_id);RETURN result;
EXCEPTION WHEN unique_violation OR exclusion_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE_TAX_CODE' USING ERRCODE='P0001';
 WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;

ALTER TABLE "FinanceInvoice" DROP CONSTRAINT "FinanceInvoice_taxAmount_check",DROP CONSTRAINT "FinanceInvoice_check3";
ALTER TABLE "FinanceInvoice" ADD CONSTRAINT "FinanceInvoice_tax_nonnegative" CHECK("taxAmount">=0 AND "netAmount">=0);
ALTER TABLE "FinanceInvoiceLine" ADD COLUMN "taxCodeId" UUID REFERENCES "FinanceTaxCode" ON DELETE RESTRICT,ADD COLUMN "taxSnapshot" JSONB,ADD COLUMN "taxAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT;
ALTER TABLE "FinanceInvoiceLine" DROP CONSTRAINT "FinanceInvoiceLine_taxAmount_check",DROP CONSTRAINT "FinanceInvoiceLine_check2";
ALTER TABLE "FinanceInvoiceLine" ADD CONSTRAINT "FinanceInvoiceLine_tax_nonnegative" CHECK("taxAmount">=0 AND "netAmount">=0);
CREATE OR REPLACE FUNCTION encova_finance_invoice_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE invoice public."FinanceInvoice"%ROWTYPE; receipt public."FinanceLedgerReceipt"%ROWTYPE; entry_id UUID;
 reason TEXT; digest TEXT; operation_name TEXT; result JSONB; line JSONB; prepared JSONB:='[]';position INTEGER:=0;
 quantity_value NUMERIC;rate_value NUMERIC;rounded NUMERIC;discount_value NUMERIC;net_value NUMERIC;gross NUMERIC:=0;discounts NUMERIC:=0;net NUMERIC:=0;taxes NUMERIC:=0;totals NUMERIC:=0;quote RECORD;
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
   IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR line-ARRAY['description','quantity','unitRate','discountAmount','taxCodeId','recognition','revenueAccountId','deferredAccountId','projectId']<>'{}'::jsonb OR jsonb_typeof(line->'quantity') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'unitRate') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'discountAmount') IS DISTINCT FROM 'string' OR line->>'quantity' !~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,6})?$' OR line->>'unitRate' !~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,6})?$' OR line->>'discountAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   quantity_value:=(line->>'quantity')::numeric;rate_value:=(line->>'unitRate')::numeric;rounded:=round(quantity_value*rate_value,2);discount_value:=(line->>'discountAmount')::numeric;net_value:=rounded-discount_value;
   IF quantity_value<=0 OR rounded>999999999999999999.99 OR discount_value>rounded THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   PERFORM public.encova_finance_tax_mapping(nullif(line->>'taxCodeId','')::uuid,'SALE',posting_date);
   SELECT * INTO quote FROM public.encova_finance_tax_quote(nullif(line->>'taxCodeId','')::uuid,'SALE',posting_date,rounded,discount_value);net_value:=quote.net;
   gross:=gross+rounded;discounts:=discounts+discount_value;net:=net+net_value;taxes:=taxes+quote.tax;totals:=totals+quote.total;
   IF gross>999999999999999999.99 OR discounts>999999999999999999.99 OR net>999999999999999999.99 THEN RAISE EXCEPTION 'FINANCE_INVOICE_TOTALS' USING ERRCODE='P0001';END IF;
   position:=position+1;
   prepared:=prepared||jsonb_build_array(line||jsonb_build_object('sequence',position,'lineAmount',rounded::text,'netAmount',net_value::text,'taxAmount',quote.tax::text,'totalAmount',quote.total::text,'taxSnapshot',quote.snapshot,'taxAccountId',quote.account));
  END LOOP;
  IF action='CREATE' THEN
   INSERT INTO public."FinanceInvoice"(id,reference,"partyId","receivableAccountId","projectId","invoiceDate","postingDate","dueDate",description,evidence,currency,"lineAmount","discountAmount","netAmount","taxAmount","totalAmount","createdById") VALUES(gen_random_uuid(),input->>'reference',(input->>'partyId')::uuid,(input->>'receivableAccountId')::uuid,nullif(input->>'projectId','')::uuid,invoice_date,posting_date,due_date,input->>'description',input->>'evidence','PKR',gross,discounts,net,taxes,totals,actor) RETURNING * INTO invoice;
  ELSE
   UPDATE public."FinanceInvoice" SET reference=input->>'reference',"partyId"=(input->>'partyId')::uuid,"receivableAccountId"=(input->>'receivableAccountId')::uuid,"projectId"=nullif(input->>'projectId','')::uuid,"invoiceDate"=invoice_date,"postingDate"=posting_date,"dueDate"=due_date,description=input->>'description',evidence=input->>'evidence',"lineAmount"=gross,"discountAmount"=discounts,"netAmount"=net,"taxAmount"=taxes,"totalAmount"=totals,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=invoice.id RETURNING * INTO invoice;
   DELETE FROM public."FinanceInvoiceLine" WHERE "invoiceId"=invoice.id;
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(prepared) LOOP
   INSERT INTO public."FinanceInvoiceLine"(id,"invoiceId",sequence,description,quantity,"unitRate","lineAmount","discountAmount","netAmount","taxAmount","totalAmount","taxCodeId","taxSnapshot","taxAccountId",recognition,"revenueAccountId","deferredAccountId","projectId") VALUES(gen_random_uuid(),invoice.id,(line->>'sequence')::integer,line->>'description',(line->>'quantity')::numeric,(line->>'unitRate')::numeric,(line->>'lineAmount')::numeric,(line->>'discountAmount')::numeric,(line->>'netAmount')::numeric,(line->>'taxAmount')::numeric,(line->>'totalAmount')::numeric,nullif(line->>'taxCodeId','')::uuid,nullif(line->'taxSnapshot','null'::jsonb),nullif(line->>'taxAccountId','')::uuid,line->>'recognition',(line->>'revenueAccountId')::uuid,nullif(line->>'deferredAccountId','')::uuid,coalesce(nullif(line->>'projectId','')::uuid,invoice."projectId"));
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
CREATE FUNCTION encova_finance_invoice_tax_line_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE posting_date DATE;q RECORD;BEGIN
 SELECT "postingDate" INTO posting_date FROM public."FinanceInvoice" WHERE id=NEW."invoiceId";
 SELECT * INTO q FROM public.encova_finance_tax_quote(NEW."taxCodeId",'SALE',posting_date,NEW."lineAmount",NEW."discountAmount");
 IF ROW(NEW."netAmount",NEW."taxAmount",NEW."totalAmount",NEW."taxSnapshot",NEW."taxAccountId") IS DISTINCT FROM ROW(q.net,q.tax,q.total,q.snapshot,q.account) THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;RETURN NEW;END $$;
CREATE TRIGGER "FinanceInvoiceLine_tax_guard" BEFORE INSERT OR UPDATE ON "FinanceInvoiceLine" FOR EACH ROW EXECUTE FUNCTION encova_finance_invoice_tax_line_guard();
CREATE FUNCTION encova_finance_invoice_tax_validate(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE l record;d DATE;BEGIN
 SELECT "postingDate" INTO d FROM public."FinanceInvoice" WHERE id=target;
 FOR l IN SELECT "taxCodeId","lineAmount","discountAmount","netAmount","taxAmount","totalAmount","taxSnapshot","taxAccountId" FROM public."FinanceInvoiceLine" WHERE "invoiceId"=target LOOP
  PERFORM public.encova_finance_tax_mapping(l."taxCodeId",'SALE',d);
  IF NOT EXISTS(SELECT 1 FROM public.encova_finance_tax_quote(l."taxCodeId",'SALE',d,l."lineAmount",l."discountAmount") q WHERE ROW(q.net,q.tax,q.total,q.snapshot,q.account) IS NOT DISTINCT FROM ROW(l."netAmount",l."taxAmount",l."totalAmount",l."taxSnapshot",l."taxAccountId")) THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;
 END LOOP;END $$;
ALTER TABLE "FinanceBill" DROP CONSTRAINT "FinanceBill_taxAmount_check",DROP CONSTRAINT "FinanceBill_check3";
ALTER TABLE "FinanceBill" ADD CONSTRAINT "FinanceBill_tax_nonnegative" CHECK("taxAmount">=0 AND "netAmount">=0);
ALTER TABLE "FinanceBillLine" ADD COLUMN "taxCodeId" UUID REFERENCES "FinanceTaxCode" ON DELETE RESTRICT,ADD COLUMN "taxSnapshot" JSONB,ADD COLUMN "taxAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT;
ALTER TABLE "FinanceBillLine" DROP CONSTRAINT "FinanceBillLine_taxAmount_check",DROP CONSTRAINT "FinanceBillLine_check2";
ALTER TABLE "FinanceBillLine" ADD CONSTRAINT "FinanceBillLine_tax_nonnegative" CHECK("taxAmount">=0 AND "netAmount">=0);
CREATE OR REPLACE FUNCTION encova_finance_bill_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE bill public."FinanceBill"%ROWTYPE; receipt public."FinanceLedgerReceipt"%ROWTYPE; entry_id UUID;
 reason TEXT; digest TEXT; operation_name TEXT; result JSONB; line JSONB; prepared JSONB:='[]';position INTEGER:=0;
 quantity_value NUMERIC;rate_value NUMERIC;rounded NUMERIC;discount_value NUMERIC;net_value NUMERIC;gross NUMERIC:=0;discounts NUMERIC:=0;net NUMERIC:=0;taxes NUMERIC:=0;totals NUMERIC:=0;quote RECORD;
 bill_date DATE;posting_date DATE;due_date DATE;
BEGIN
 IF action IS NULL OR action NOT IN ('CREATE','UPDATE','POST','VOID') OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 reason:=trim(input->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF input-(CASE WHEN action='CREATE' THEN ARRAY['kind','referenceReliable','duplicateAcknowledged','cashAccountId','reference','partyId','payableAccountId','projectId','billDate','postingDate','dueDate','description','evidence','currency','lines','reason'] WHEN action='UPDATE' THEN ARRAY['id','expectedVersion','kind','referenceReliable','duplicateAcknowledged','cashAccountId','reference','partyId','payableAccountId','projectId','billDate','postingDate','dueDate','description','evidence','currency','lines','reason'] ELSE ARRAY['id','expectedVersion','reason'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF action<>'CREATE' AND (jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR (input->>'expectedVersion')::integer<1) THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 operation_name:='BILL_'||action;digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation=operation_name AND key=request_key;
 IF FOUND THEN IF receipt."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN receipt.result;END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action<>'CREATE' THEN
  SELECT * INTO bill FROM public."FinanceBill" WHERE id=(input->>'id')::uuid FOR UPDATE;
  IF bill.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF bill.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF bill.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_BILL_IMMUTABLE' USING ERRCODE='P0001';END IF;
 END IF;
 IF action IN ('CREATE','UPDATE') THEN
  IF input->>'currency' IS DISTINCT FROM 'PKR' OR jsonb_typeof(input->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'lines') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'billDate') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'postingDate') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'dueDate') IS DISTINCT FROM 'string' OR input->>'billDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR input->>'postingDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR input->>'dueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  bill_date:=(input->>'billDate')::date;posting_date:=(input->>'postingDate')::date;due_date:=(input->>'dueDate')::date;
  IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=(input->>'partyId')::uuid AND active AND kind IN ('SUPPLIER','BOTH','EMPLOYEE')) THEN RAISE EXCEPTION 'FINANCE_BILL_PARTY' USING ERRCODE='P0001';END IF;
  IF input->>'kind' NOT IN('BILL','EXPENSE') OR jsonb_typeof(input->'referenceReliable') IS DISTINCT FROM 'boolean' OR jsonb_typeof(input->'duplicateAcknowledged') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(input->'lines') LOOP
   IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR line-ARRAY['description','quantity','unitRate','discountAmount','taxCodeId','treatment','costAccountId','projectId']<>'{}'::jsonb OR jsonb_typeof(line->'quantity') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'unitRate') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'discountAmount') IS DISTINCT FROM 'string' OR line->>'quantity' !~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,6})?$' OR line->>'unitRate' !~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,6})?$' OR line->>'discountAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   quantity_value:=(line->>'quantity')::numeric;rate_value:=(line->>'unitRate')::numeric;rounded:=round(quantity_value*rate_value,2);discount_value:=(line->>'discountAmount')::numeric;net_value:=rounded-discount_value;
   IF quantity_value<=0 OR rounded>999999999999999999.99 OR discount_value>rounded THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   PERFORM public.encova_finance_tax_mapping(nullif(line->>'taxCodeId','')::uuid,'PURCHASE',posting_date);
   SELECT * INTO quote FROM public.encova_finance_tax_quote(nullif(line->>'taxCodeId','')::uuid,'PURCHASE',posting_date,rounded,discount_value);net_value:=quote.net;
   gross:=gross+rounded;discounts:=discounts+discount_value;net:=net+net_value;taxes:=taxes+quote.tax;totals:=totals+quote.total;
   IF gross>999999999999999999.99 OR discounts>999999999999999999.99 OR net>999999999999999999.99 THEN RAISE EXCEPTION 'FINANCE_BILL_TOTALS' USING ERRCODE='P0001';END IF;
   position:=position+1;
   prepared:=prepared||jsonb_build_array(line||jsonb_build_object('sequence',position,'lineAmount',rounded::text,'netAmount',net_value::text,'taxAmount',quote.tax::text,'totalAmount',quote.total::text,'taxSnapshot',quote.snapshot,'taxAccountId',quote.account));
  END LOOP;
  IF action='CREATE' THEN
   INSERT INTO public."FinanceBill"(id,number,kind,"referenceReliable","duplicateAcknowledged","cashAccountId",reference,"partyId","payableAccountId","projectId","billDate","postingDate","dueDate",description,evidence,currency,"lineAmount","discountAmount","netAmount","taxAmount","totalAmount","createdById") VALUES(gen_random_uuid(),CASE WHEN input->>'kind'='BILL' THEN 'BIL-' ELSE 'EXP-' END||lpad(nextval('public.finance_bill_number')::text,10,'0'),input->>'kind',(input->>'referenceReliable')::boolean,(input->>'duplicateAcknowledged')::boolean,nullif(input->>'cashAccountId','')::uuid,input->>'reference',(input->>'partyId')::uuid,(input->>'payableAccountId')::uuid,nullif(input->>'projectId','')::uuid,bill_date,posting_date,due_date,input->>'description',input->>'evidence','PKR',gross,discounts,net,taxes,totals,actor) RETURNING * INTO bill;
  ELSE
   UPDATE public."FinanceBill" SET kind=input->>'kind',"referenceReliable"=(input->>'referenceReliable')::boolean,"duplicateAcknowledged"=(input->>'duplicateAcknowledged')::boolean,"cashAccountId"=nullif(input->>'cashAccountId','')::uuid,reference=input->>'reference',"partyId"=(input->>'partyId')::uuid,"payableAccountId"=(input->>'payableAccountId')::uuid,"projectId"=nullif(input->>'projectId','')::uuid,"billDate"=bill_date,"postingDate"=posting_date,"dueDate"=due_date,description=input->>'description',evidence=input->>'evidence',"lineAmount"=gross,"discountAmount"=discounts,"netAmount"=net,"taxAmount"=taxes,"totalAmount"=totals,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=bill.id RETURNING * INTO bill;
   DELETE FROM public."FinanceBillLine" WHERE "billId"=bill.id;
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(prepared) LOOP
   INSERT INTO public."FinanceBillLine"(id,"billId",sequence,description,quantity,"unitRate","lineAmount","discountAmount","netAmount","taxAmount","totalAmount","taxCodeId","taxSnapshot","taxAccountId",treatment,"costAccountId","projectId") VALUES(gen_random_uuid(),bill.id,(line->>'sequence')::integer,line->>'description',(line->>'quantity')::numeric,(line->>'unitRate')::numeric,(line->>'lineAmount')::numeric,(line->>'discountAmount')::numeric,(line->>'netAmount')::numeric,(line->>'taxAmount')::numeric,(line->>'totalAmount')::numeric,nullif(line->>'taxCodeId','')::uuid,nullif(line->'taxSnapshot','null'::jsonb),nullif(line->>'taxAccountId','')::uuid,line->>'treatment',(line->>'costAccountId')::uuid,coalesce(nullif(line->>'projectId','')::uuid,bill."projectId"));
  END LOOP;
 ELSIF action='VOID' THEN
  UPDATE public."FinanceBill" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=bill.id RETURNING * INTO bill;
 ELSE
  entry_id:=public.encova_finance_emit_journal(actor,'BILL',bill.id,bill."postingDate",reason);
  SELECT * INTO bill FROM public."FinanceBill" WHERE id=bill.id;
 END IF;
 result:=jsonb_build_object('id',bill.id,'version',bill.version,'number',bill.number,'journalId',entry_id);
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,operation_name,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_'||operation_name,'FinanceBill',bill.id,reason,jsonb_build_object('journalId',entry_id,'snapshot',to_jsonb(bill)||jsonb_build_object('lineAmount',bill."lineAmount"::text,'discountAmount',bill."discountAmount"::text,'netAmount',bill."netAmount"::text,'taxAmount',bill."taxAmount"::text,'totalAmount',bill."totalAmount"::text),'lines',(SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('quantity',l.quantity::text,'unitRate',l."unitRate"::text,'lineAmount',l."lineAmount"::text,'discountAmount',l."discountAmount"::text,'netAmount',l."netAmount"::text,'taxAmount',l."taxAmount"::text,'totalAmount',l."totalAmount"::text) ORDER BY sequence) FROM public."FinanceBillLine" l WHERE l."billId"=bill.id)),request_id);
 RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';
 WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;
CREATE FUNCTION encova_finance_bill_tax_line_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE posting_date DATE;q RECORD;BEGIN
 SELECT "postingDate" INTO posting_date FROM public."FinanceBill" WHERE id=NEW."billId";
 SELECT * INTO q FROM public.encova_finance_tax_quote(NEW."taxCodeId",'PURCHASE',posting_date,NEW."lineAmount",NEW."discountAmount");
 IF ROW(NEW."netAmount",NEW."taxAmount",NEW."totalAmount",NEW."taxSnapshot",NEW."taxAccountId") IS DISTINCT FROM ROW(q.net,q.tax,q.total,q.snapshot,q.account) THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;RETURN NEW;END $$;
CREATE TRIGGER "FinanceBillLine_tax_guard" BEFORE INSERT OR UPDATE ON "FinanceBillLine" FOR EACH ROW EXECUTE FUNCTION encova_finance_bill_tax_line_guard();
CREATE FUNCTION encova_finance_bill_tax_validate(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE l record;d DATE;BEGIN
 SELECT "postingDate" INTO d FROM public."FinanceBill" WHERE id=target;
 FOR l IN SELECT "taxCodeId","lineAmount","discountAmount","netAmount","taxAmount","totalAmount","taxSnapshot","taxAccountId" FROM public."FinanceBillLine" WHERE "billId"=target LOOP
  PERFORM public.encova_finance_tax_mapping(l."taxCodeId",'PURCHASE',d);
  IF NOT EXISTS(SELECT 1 FROM public.encova_finance_tax_quote(l."taxCodeId",'PURCHASE',d,l."lineAmount",l."discountAmount") q WHERE ROW(q.net,q.tax,q.total,q.snapshot,q.account) IS NOT DISTINCT FROM ROW(l."netAmount",l."taxAmount",l."totalAmount",l."taxSnapshot",l."taxAccountId")) THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;
 END LOOP;END $$;
CREATE FUNCTION encova_finance_invoice_lines(target UUID) RETURNS TABLE(sequence INTEGER,"accountId" UUID,description TEXT,debit NUMERIC,credit NUMERIC,"projectId" UUID,"partyId" UUID,"invoiceLineId" UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT 1,d."receivableAccountId",d.description,d."totalAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceInvoice" d WHERE d.id=target
 UNION ALL SELECT l.sequence+1,CASE WHEN l.recognition='EARNED' THEN l."revenueAccountId" ELSE l."deferredAccountId" END,l.description,0::numeric,l."netAmount",l."projectId",d."partyId",l.id FROM public."FinanceInvoiceLine" l JOIN public."FinanceInvoice" d ON d.id=l."invoiceId" WHERE d.id=target AND l."netAmount">0
 UNION ALL SELECT 200+l.sequence,l."taxAccountId",l.description,0::numeric,l."taxAmount",l."projectId",d."partyId",l.id FROM public."FinanceInvoiceLine" l JOIN public."FinanceInvoice" d ON d.id=l."invoiceId" WHERE d.id=target AND l."taxAmount">0;
$$;
CREATE OR REPLACE FUNCTION encova_finance_bill_lines(target UUID) RETURNS TABLE(sequence INTEGER,"accountId" UUID,description TEXT,debit NUMERIC,credit NUMERIC,"projectId" UUID,"partyId" UUID,"billLineId" UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT 1,CASE WHEN d.kind='BILL' THEN d."payableAccountId" ELSE c."glAccountId" END,d.description,0::numeric,d."totalAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceBill" d LEFT JOIN public."FinanceCashAccount" c ON c.id=d."cashAccountId" WHERE d.id=target
 UNION ALL SELECT l.sequence+1,l."costAccountId",l.description,l."netAmount",0::numeric,l."projectId",d."partyId",l.id FROM public."FinanceBill" d JOIN public."FinanceBillLine" l ON l."billId"=d.id WHERE d.id=target AND l."netAmount">0
 UNION ALL SELECT 200+l.sequence,l."taxAccountId",l.description,l."taxAmount",0::numeric,l."projectId",d."partyId",l.id FROM public."FinanceBillLine" l JOIN public."FinanceBill" d ON d.id=l."billId" WHERE d.id=target AND l."taxAmount">0
$$;
CREATE OR REPLACE FUNCTION encova_finance_check_invoice(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE invoice public."FinanceInvoice"%ROWTYPE; entry public."FinanceJournalEntry"%ROWTYPE; count_lines BIGINT; gross NUMERIC; discounts NUMERIC; nets NUMERIC; totals NUMERIC;
BEGIN
 SELECT * INTO invoice FROM public."FinanceInvoice" WHERE id=target;
 IF (SELECT "taxAmount" FROM public."FinanceInvoice" WHERE id=target) IS DISTINCT FROM(SELECT coalesce(sum("taxAmount"),0) FROM public."FinanceInvoiceLine" WHERE "invoiceId"=target) THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;
 IF invoice.id IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 SELECT count(*),coalesce(sum("lineAmount"),0),coalesce(sum("discountAmount"),0),coalesce(sum("netAmount"),0),coalesce(sum("totalAmount"),0) INTO count_lines,gross,discounts,nets,totals FROM public."FinanceInvoiceLine" WHERE "invoiceId"=target;
 IF count_lines NOT BETWEEN 1 AND 100 OR gross>999999999999999999.99 OR discounts>999999999999999999.99 OR nets>999999999999999999.99 OR totals>999999999999999999.99 OR ROW(invoice."lineAmount",invoice."discountAmount",invoice."netAmount",invoice."totalAmount") IS DISTINCT FROM ROW(gross,discounts,nets,totals) THEN RAISE EXCEPTION 'FINANCE_INVOICE_TOTALS' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM public."FinanceInvoiceLine" WHERE "invoiceId"=target AND "projectId" IS NULL AND invoice."projectId" IS NOT NULL) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 SELECT * INTO entry FROM public."FinanceJournalEntry" WHERE "invoiceId"=target;
 IF invoice.state<>'POSTED' THEN
  IF entry.id IS NOT NULL OR invoice."partySnapshot" IS NOT NULL OR EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" WHERE "invoiceId"=target) OR EXISTS(SELECT 1 FROM public."FinanceDeferredRevenueEvent" e JOIN public."FinanceInvoiceLine" l ON l.id=e."invoiceLineId" WHERE l."invoiceId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;
 END IF;
 IF invoice."totalAmount"<=0 OR invoice."partySnapshot" IS NULL OR entry.id IS NULL OR entry."sourceType"<>'INVOICE' OR entry."postingDate"<>invoice."postingDate" OR entry.description<>invoice.description OR entry.evidence<>invoice.evidence THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId" FROM public."FinanceJournalLine" WHERE "journalId"=entry.id) EXCEPT(SELECT * FROM public.encova_finance_invoice_lines(target))) OR EXISTS((SELECT * FROM public.encova_finance_invoice_lines(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId" FROM public."FinanceJournalLine" WHERE "journalId"=entry.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF (SELECT count(*) FROM public."FinanceReceivableEvent" WHERE "invoiceId"=target AND kind='INVOICE')<>1 OR NOT EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" WHERE "invoiceId"=target AND "journalId"=entry.id AND "partyId"=invoice."partyId" AND "accountId"=invoice."receivableAccountId" AND "effectiveDate"=invoice."postingDate" AND kind='INVOICE' AND amount=invoice."totalAmount") THEN RAISE EXCEPTION 'FINANCE_RECEIVABLE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF (SELECT count(*) FROM public."FinanceDeferredRevenueEvent" e JOIN public."FinanceInvoiceLine" l ON l.id=e."invoiceLineId" WHERE l."invoiceId"=target AND e.kind='BILLED')<>(SELECT count(*) FROM public."FinanceInvoiceLine" WHERE "invoiceId"=target AND recognition='DEFERRED' AND "netAmount">0) OR EXISTS(SELECT 1 FROM public."FinanceInvoiceLine" l WHERE l."invoiceId"=target AND l.recognition='DEFERRED' AND l."netAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceDeferredRevenueEvent" e WHERE e."invoiceLineId"=l.id AND e."journalId"=entry.id AND e."effectiveDate"=invoice."postingDate" AND e.kind='BILLED' AND e.amount=l."netAmount")) THEN RAISE EXCEPTION 'FINANCE_DEFERRED_MISMATCH' USING ERRCODE='P0001';END IF;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_check_bill(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE d public."FinanceBill"%ROWTYPE;e public."FinanceJournalEntry"%ROWTYPE;n BIGINT;gross NUMERIC;discounts NUMERIC;net NUMERIC;total NUMERIC;BEGIN
 SELECT * INTO d FROM public."FinanceBill" WHERE id=target;SELECT count(*),coalesce(sum(l."lineAmount"),0),coalesce(sum(l."discountAmount"),0),coalesce(sum(l."netAmount"),0),coalesce(sum(l."totalAmount"),0) INTO n,gross,discounts,net,total FROM public."FinanceBillLine" l WHERE l."billId"=target;
 IF (SELECT "taxAmount" FROM public."FinanceBill" WHERE id=target) IS DISTINCT FROM(SELECT coalesce(sum("taxAmount"),0) FROM public."FinanceBillLine" WHERE "billId"=target) THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;
 IF d.id IS NULL OR n NOT BETWEEN 1 AND 100 OR ROW(d."lineAmount",d."discountAmount",d."netAmount",d."totalAmount") IS DISTINCT FROM ROW(gross,discounts,net,total) THEN RAISE EXCEPTION 'FINANCE_BILL_TOTALS' USING ERRCODE='P0001';END IF;
 SELECT * INTO e FROM public."FinanceJournalEntry" WHERE "billId"=target;
 IF d.state<>'POSTED' THEN IF e.id IS NOT NULL OR EXISTS(SELECT 1 FROM public."FinancePayableEvent" WHERE "billId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;END IF;
 IF e.id IS NULL OR e."postingDate"<>d."postingDate" OR e.description<>d.description OR e.evidence<>d.evidence OR d."partySnapshot" IS NULL OR EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","billLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id) EXCEPT(SELECT * FROM public.encova_finance_bill_lines(target))) OR EXISTS((SELECT * FROM public.encova_finance_bill_lines(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","billLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF(d.kind='BILL' AND((SELECT count(*) FROM public."FinancePayableEvent" WHERE "billId"=target AND kind='BILL')<>1 OR NOT EXISTS(SELECT 1 FROM public."FinancePayableEvent" WHERE "billId"=target AND "journalId"=e.id AND "partyId"=d."partyId" AND "accountId"=d."payableAccountId" AND "effectiveDate"=d."postingDate" AND kind='BILL' AND amount=d."totalAmount"))) OR(d.kind='EXPENSE' AND EXISTS(SELECT 1 FROM public."FinancePayableEvent" WHERE "billId"=target)) THEN RAISE EXCEPTION 'FINANCE_PAYABLE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM public."FinanceBill" x WHERE x.id<>d.id AND x.state='POSTED' AND x."partyId"=d."partyId" AND lower(trim(x.reference))=lower(trim(d.reference)) AND(x."referenceReliable" OR d."referenceReliable")) THEN RAISE EXCEPTION 'FINANCE_DUPLICATE_REFERENCE' USING ERRCODE='P0001';END IF;
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
  PERFORM public.encova_finance_bill_validate(source_id);PERFORM public.encova_finance_bill_tax_validate(source_id);
 ELSIF source_kind='INVOICE' THEN
  SELECT * INTO invoice FROM public."FinanceInvoice" WHERE id=source_id FOR UPDATE;
  IF invoice.id IS NULL OR invoice.state<>'DRAFT' OR invoice."postingDate"<>posting_date THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_invoice_tax_validate(source_id);
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
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId") SELECT gen_random_uuid(),entry_id,x.* FROM public.encova_finance_invoice_lines(invoice.id) x ORDER BY x."accountId",x.sequence;
  INSERT INTO public."FinanceReceivableEvent"(id,"invoiceId","partyId","accountId","journalId","effectiveDate",kind,amount) VALUES(gen_random_uuid(),invoice.id,invoice."partyId",invoice."receivableAccountId",entry_id,posting_date,'INVOICE',invoice."totalAmount");
  INSERT INTO public."FinanceDeferredRevenueEvent"(id,"invoiceLineId","journalId","effectiveDate",kind,amount) SELECT gen_random_uuid(),id,entry_id,posting_date,'BILLED',"netAmount" FROM public."FinanceInvoiceLine" WHERE "invoiceId"=invoice.id AND recognition='DEFERRED' AND "netAmount">0;
  SELECT array_agg(id) INTO mappings FROM public."FinanceAccount" WHERE id=invoice."receivableAccountId" OR id IN(SELECT "revenueAccountId" FROM public."FinanceInvoiceLine" WHERE "invoiceId"=invoice.id) OR id IN(SELECT "deferredAccountId" FROM public."FinanceInvoiceLine" WHERE "invoiceId"=invoice.id);
  PERFORM public.encova_finance_mark_accounts(mappings);
  UPDATE public."FinanceParty" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=invoice."partyId";
  UPDATE public."FinanceInvoice" SET state='POSTED',version=version+1,"partySnapshot"=public.encova_finance_party_snapshot("partyId"),"updatedAt"=CURRENT_TIMESTAMP WHERE id=invoice.id;
 END IF;
 RETURN entry_id;
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
  IF NEW."billLineId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.encova_finance_invoice_lines(entry."invoiceId") x WHERE ROW(x.sequence,x."accountId",x.description,x.debit,x.credit,x."projectId",x."partyId",x."invoiceLineId") IS NOT DISTINCT FROM ROW(NEW.sequence,NEW."accountId",NEW.description,NEW.debit,NEW.credit,NEW."projectId",NEW."partyId",NEW."invoiceLineId")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_mark_accounts(ARRAY[NEW."accountId"]);RETURN NEW;
 END IF;
 IF account."controlType"<>'NONE' THEN RAISE EXCEPTION 'FINANCE_CONTROL_PROTECTED' USING ERRCODE='P0001'; END IF;
  IF NEW."partyId" IS NOT NULL OR NEW."invoiceLineId" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
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
 IF line_count NOT BETWEEN 2 AND 400 OR debits<>credits OR debits<=0 OR debits>999999999999999999.99 THEN RAISE EXCEPTION 'FINANCE_UNBALANCED' USING ERRCODE='P0001'; END IF;
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
ALTER TABLE "FinanceCustomerDocument" ADD COLUMN "withholdingAmount" NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK("withholdingAmount">=0),ADD COLUMN "withholdingCodeId" UUID REFERENCES "FinanceTaxCode" ON DELETE RESTRICT,ADD COLUMN "withholdingSnapshot" JSONB,ADD COLUMN "withholdingAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT;
ALTER TABLE "FinanceCustomerDocument" ADD CONSTRAINT "FinanceCustomerDocument_withholding_shape" CHECK(("withholdingAmount">0)=("withholdingCodeId" IS NOT NULL) AND("withholdingAmount">0)=("withholdingAccountId" IS NOT NULL) AND("withholdingAmount">0)=("withholdingSnapshot" IS NOT NULL) AND(kind IN('RECEIPT','REVERSAL') OR "withholdingAmount"=0));
DO $$ DECLARE expression TEXT;BEGIN SELECT pg_get_constraintdef(oid) INTO expression FROM pg_constraint WHERE conrelid='public."FinanceCustomerDocument"'::regclass AND conname='FinanceCustomerDocument_commercial_source';expression:=replace(expression,'("cashAmount" + "feeAmount")','("cashAmount" + "feeAmount" + "withholdingAmount")');expression:=replace(expression,'("cashAmount" > (0)::numeric)','("cashAmount" >= (0)::numeric)');ALTER TABLE "FinanceCustomerDocument" DROP CONSTRAINT "FinanceCustomerDocument_commercial_source";EXECUTE 'ALTER TABLE public."FinanceCustomerDocument" ADD CONSTRAINT "FinanceCustomerDocument_commercial_source" '||expression;END $$;
CREATE FUNCTION encova_finance_customer_withholding_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE q RECORD;o public."FinanceCustomerDocument"%ROWTYPE;BEGIN
 IF NEW.kind='REVERSAL' THEN
  SELECT * INTO o FROM public."FinanceCustomerDocument" WHERE id=NEW."reversalOfId";
  IF ROW(NEW."withholdingAmount",NEW."withholdingCodeId",NEW."withholdingSnapshot",NEW."withholdingAccountId") IS DISTINCT FROM ROW(o."withholdingAmount",o."withholdingCodeId",o."withholdingSnapshot",o."withholdingAccountId") THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSE
  SELECT * INTO q FROM public.encova_finance_tax_quote(NEW."withholdingCodeId",'CUSTOMER_WITHHOLDING',NEW."postingDate",0,0);
  IF ROW(NEW."withholdingSnapshot",NEW."withholdingAccountId") IS DISTINCT FROM ROW(q.snapshot,q.account) THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;
  IF NEW.state='POSTED' THEN PERFORM public.encova_finance_tax_mapping(NEW."withholdingCodeId",'CUSTOMER_WITHHOLDING',NEW."postingDate");END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER "FinanceCustomerDocument_withholding_guard" BEFORE INSERT OR UPDATE ON "FinanceCustomerDocument" FOR EACH ROW EXECUTE FUNCTION encova_finance_customer_withholding_guard();
CREATE OR REPLACE FUNCTION encova_finance_customer_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,resource TEXT,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE wht_amount NUMERIC:=0;wht_code UUID;wht_snapshot JSONB;wht_account UUID;wht_quote RECORD; d public."FinanceCustomerDocument"%ROWTYPE;origin public."FinanceCustomerDocument"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;inv public."FinanceInvoice"%ROWTYPE;item JSONB;allowed TEXT[];n INTEGER:=0;alloc_sum NUMERIC:=0;credit_sum NUMERIC:=0;cash NUMERIC:=0;fee NUMERIC:=0;adv NUMERIC:=0;total NUMERIC;advance_account UUID;cash_account UUID;fee_account UUID;source_doc UUID;credit_invoice UUID;project UUID;entry_id UUID;origin_id UUID;origin_version INTEGER;origin_number TEXT;digest TEXT;operation_name TEXT;reason TEXT;result JSONB;prefix TEXT;audit_id UUID;
BEGIN
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
   INSERT INTO public."FinanceCustomerDocument"(id,number,kind,reference,"partyId","cashAccountId","feeAccountId","advanceAccountId","sourceDocumentId","projectId","documentDate","postingDate",description,evidence,currency,"cashAmount","feeAmount","allocationAmount","advanceAmount","totalAmount","createdById","unallocationOfId") VALUES(gen_random_uuid(),'UAL-'||lpad(nextval('public.finance_customer_number'::regclass)::text,10,'0'),'UNALLOCATION',origin.reference,origin."partyId",NULL,NULL,(input->>'advanceAccountId')::uuid,origin.id,origin."projectId",(input->>'postingDate')::date,(input->>'postingDate')::date,origin.description,reason,'PKR',0,0,origin."allocationAmount",origin."allocationAmount",origin."allocationAmount",actor,origin."withholdingAmount",origin."withholdingCodeId",origin."withholdingSnapshot",origin."withholdingAccountId",origin.id) RETURNING * INTO d;
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
ALTER TABLE "FinanceSupplierDocument" ADD COLUMN "withholdingAmount" NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK("withholdingAmount">=0),ADD COLUMN "withholdingCodeId" UUID REFERENCES "FinanceTaxCode" ON DELETE RESTRICT,ADD COLUMN "withholdingSnapshot" JSONB,ADD COLUMN "withholdingAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT;
ALTER TABLE "FinanceSupplierDocument" ADD CONSTRAINT "FinanceSupplierDocument_withholding_shape" CHECK(("withholdingAmount">0)=("withholdingCodeId" IS NOT NULL) AND("withholdingAmount">0)=("withholdingAccountId" IS NOT NULL) AND("withholdingAmount">0)=("withholdingSnapshot" IS NOT NULL) AND(kind IN('PAYMENT','REVERSAL') OR "withholdingAmount"=0));
DO $$ DECLARE expression TEXT;BEGIN SELECT pg_get_constraintdef(oid) INTO expression FROM pg_constraint WHERE conrelid='public."FinanceSupplierDocument"'::regclass AND conname='FinanceSupplierDocument_commercial_source';expression:=replace(expression,'("cashAmount" + "feeAmount")','("cashAmount" + "feeAmount" + "withholdingAmount")');expression:=replace(expression,'("cashAmount" > (0)::numeric)','("cashAmount" >= (0)::numeric)');ALTER TABLE "FinanceSupplierDocument" DROP CONSTRAINT "FinanceSupplierDocument_commercial_source";EXECUTE 'ALTER TABLE public."FinanceSupplierDocument" ADD CONSTRAINT "FinanceSupplierDocument_commercial_source" '||expression;END $$;
CREATE FUNCTION encova_finance_supplier_withholding_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE q RECORD;o public."FinanceSupplierDocument"%ROWTYPE;BEGIN
 IF NEW.kind='REVERSAL' THEN
  SELECT * INTO o FROM public."FinanceSupplierDocument" WHERE id=NEW."reversalOfId";
  IF ROW(NEW."withholdingAmount",NEW."withholdingCodeId",NEW."withholdingSnapshot",NEW."withholdingAccountId") IS DISTINCT FROM ROW(o."withholdingAmount",o."withholdingCodeId",o."withholdingSnapshot",o."withholdingAccountId") THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSE
  SELECT * INTO q FROM public.encova_finance_tax_quote(NEW."withholdingCodeId",'SUPPLIER_WITHHOLDING',NEW."postingDate",0,0);
  IF ROW(NEW."withholdingSnapshot",NEW."withholdingAccountId") IS DISTINCT FROM ROW(q.snapshot,q.account) THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;
  IF NEW.state='POSTED' THEN PERFORM public.encova_finance_tax_mapping(NEW."withholdingCodeId",'SUPPLIER_WITHHOLDING',NEW."postingDate");END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER "FinanceSupplierDocument_withholding_guard" BEFORE INSERT OR UPDATE ON "FinanceSupplierDocument" FOR EACH ROW EXECUTE FUNCTION encova_finance_supplier_withholding_guard();
CREATE OR REPLACE FUNCTION encova_finance_supplier_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,resource TEXT,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE wht_amount NUMERIC:=0;wht_code UUID;wht_snapshot JSONB;wht_account UUID;wht_quote RECORD; d public."FinanceSupplierDocument"%ROWTYPE;origin public."FinanceSupplierDocument"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;inv public."FinanceBill"%ROWTYPE;item JSONB;allowed TEXT[];n INTEGER:=0;alloc_sum NUMERIC:=0;credit_sum NUMERIC:=0;cash NUMERIC:=0;fee NUMERIC:=0;adv NUMERIC:=0;total NUMERIC;advance_account UUID;cash_account UUID;fee_account UUID;source_doc UUID;credit_bill UUID;project UUID;entry_id UUID;origin_id UUID;origin_version INTEGER;origin_number TEXT;digest TEXT;operation_name TEXT;reason TEXT;result JSONB;prefix TEXT;audit_id UUID;
BEGIN
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
   INSERT INTO public."FinanceSupplierDocument"(id,number,kind,reference,"partyId","cashAccountId","feeAccountId","advanceAccountId","sourceDocumentId","projectId","documentDate","postingDate",description,evidence,currency,"cashAmount","feeAmount","allocationAmount","advanceAmount","totalAmount","createdById","unallocationOfId") VALUES(gen_random_uuid(),'UAL-'||lpad(nextval('public.finance_supplier_number'::regclass)::text,10,'0'),'UNALLOCATION',origin.reference,origin."partyId",NULL,NULL,(input->>'advanceAccountId')::uuid,origin.id,origin."projectId",(input->>'postingDate')::date,(input->>'postingDate')::date,origin.description,reason,'PKR',0,0,origin."allocationAmount",origin."allocationAmount",origin."allocationAmount",actor,origin."withholdingAmount",origin."withholdingCodeId",origin."withholdingSnapshot",origin."withholdingAccountId",origin.id) RETURNING * INTO d;
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
CREATE FUNCTION encova_finance_customer_credit_tax_quote(credit_line UUID) RETURNS TABLE(net NUMERIC,tax NUMERIC,account UUID) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE x RECORD;prior_gross NUMERIC;prior_tax NUMERIC;raw NUMERIC;target_tax NUMERIC;BEGIN
 SELECT c.amount AS credit_amount,l.*,d.id AS document_id,d.kind AS document_kind,d.state AS document_state,d."postingDate" AS posting_date INTO x FROM public."FinanceCustomerCreditLine" c JOIN public."FinanceInvoiceLine" l ON l.id=c."invoiceLineId" JOIN public."FinanceCustomerDocument" d ON d.id=c."documentId" WHERE c.id=credit_line;
 IF x.document_state IS DISTINCT FROM 'DRAFT' OR x.document_kind IS DISTINCT FROM 'CUSTOMER_CREDIT' THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;
 tax:=0;net:=x.credit_amount;account:=x."taxAccountId";
 IF x."taxAmount">0 THEN
  IF EXISTS(SELECT 1 FROM public."FinanceInvoiceCreditEvent" WHERE "invoiceLineId"=x.id AND "effectiveDate">x.posting_date) THEN RAISE EXCEPTION 'FINANCE_CREDIT_TAX_ORDER' USING ERRCODE='P0001';END IF;
  SELECT -coalesce(sum(amount),0) INTO prior_gross FROM public."FinanceInvoiceCreditEvent" WHERE "invoiceLineId"=x.id AND "effectiveDate"<=x.posting_date;
  SELECT coalesce(sum(j.debit-j.credit),0) INTO prior_tax FROM public."FinanceJournalLine" j JOIN public."FinanceJournalEntry" e ON e.id=j."journalId" WHERE j."invoiceLineId"=x.id AND j."accountId"=x."taxAccountId" AND e."sourceType"='CUSTOMER_DOCUMENT' AND e."postingDate"<=x.posting_date;
  raw:=x."taxAmount"*(prior_gross+x.credit_amount)/x."totalAmount";
  target_tax:=CASE WHEN prior_gross+x.credit_amount=x."totalAmount" THEN x."taxAmount" WHEN x."taxSnapshot"->>'rounding'='DOWN' THEN trunc(raw,2) ELSE round(raw,2) END;
  tax:=target_tax-prior_tax;net:=x.credit_amount-tax;
  IF tax<0 OR net<0 OR tax>x."taxAmount" THEN RAISE EXCEPTION 'FINANCE_CREDIT_TAX_ORDER' USING ERRCODE='P0001';END IF;
 END IF;RETURN NEXT;END $$;
CREATE FUNCTION encova_finance_supplier_credit_tax_quote(credit_line UUID) RETURNS TABLE(net NUMERIC,tax NUMERIC,account UUID) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE x RECORD;prior_gross NUMERIC;prior_tax NUMERIC;raw NUMERIC;target_tax NUMERIC;BEGIN
 SELECT c.amount AS credit_amount,l.*,d.id AS document_id,d.kind AS document_kind,d.state AS document_state,d."postingDate" AS posting_date INTO x FROM public."FinanceSupplierCreditLine" c JOIN public."FinanceBillLine" l ON l.id=c."billLineId" JOIN public."FinanceSupplierDocument" d ON d.id=c."documentId" WHERE c.id=credit_line;
 IF x.document_state IS DISTINCT FROM 'DRAFT' OR x.document_kind IS DISTINCT FROM 'SUPPLIER_CREDIT' THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;
 tax:=0;net:=x.credit_amount;account:=x."taxAccountId";
 IF x."taxAmount">0 THEN
  IF EXISTS(SELECT 1 FROM public."FinanceBillCreditEvent" WHERE "billLineId"=x.id AND "effectiveDate">x.posting_date) THEN RAISE EXCEPTION 'FINANCE_CREDIT_TAX_ORDER' USING ERRCODE='P0001';END IF;
  SELECT -coalesce(sum(amount),0) INTO prior_gross FROM public."FinanceBillCreditEvent" WHERE "billLineId"=x.id AND "effectiveDate"<=x.posting_date;
  SELECT coalesce(sum(j.credit-j.debit),0) INTO prior_tax FROM public."FinanceJournalLine" j JOIN public."FinanceJournalEntry" e ON e.id=j."journalId" WHERE j."billLineId"=x.id AND j."accountId"=x."taxAccountId" AND e."sourceType"='SUPPLIER_DOCUMENT' AND e."postingDate"<=x.posting_date;
  raw:=x."taxAmount"*(prior_gross+x.credit_amount)/x."totalAmount";
  target_tax:=CASE WHEN prior_gross+x.credit_amount=x."totalAmount" THEN x."taxAmount" WHEN x."taxSnapshot"->>'rounding'='DOWN' THEN trunc(raw,2) ELSE round(raw,2) END;
  tax:=target_tax-prior_tax;net:=x.credit_amount-tax;
  IF tax<0 OR net<0 OR tax>x."taxAmount" THEN RAISE EXCEPTION 'FINANCE_CREDIT_TAX_ORDER' USING ERRCODE='P0001';END IF;
 END IF;RETURN NEXT;END $$;
CREATE FUNCTION encova_finance_credit_tax_split_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE q RECORD;BEGIN
 IF NEW."customerCreditLineId" IS NOT NULL THEN SELECT * INTO q FROM public.encova_finance_customer_credit_tax_quote(NEW."customerCreditLineId");ELSE SELECT * INTO q FROM public.encova_finance_supplier_credit_tax_quote(NEW."supplierCreditLineId");END IF;
 IF ROW(NEW."netAmount",NEW."taxAmount",NEW."taxAccountId") IS DISTINCT FROM ROW(q.net,q.tax,q.account) THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;RETURN NEW;END $$;
CREATE TRIGGER "FinanceCreditTaxSplit_guard" BEFORE INSERT ON "FinanceCreditTaxSplit" FOR EACH ROW EXECUTE FUNCTION encova_finance_credit_tax_split_guard();
CREATE FUNCTION encova_finance_customer_deferred_credits(target UUID) RETURNS TABLE("invoiceLineId" UUID,amount NUMERIC) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT c."invoiceLineId",-coalesce(s."netAmount",c.amount) FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerCreditLine" c ON c."documentId"=d.id JOIN public."FinanceInvoiceLine" l ON l.id=c."invoiceLineId" LEFT JOIN public."FinanceCreditTaxSplit" s ON s."customerCreditLineId"=c.id WHERE d.id=target AND d.kind='CUSTOMER_CREDIT' AND l.recognition='DEFERRED'
 UNION ALL SELECT e."invoiceLineId",-e.amount FROM public."FinanceCustomerDocument" d JOIN public."FinanceDeferredRevenueEvent" e ON e."customerDocumentId"=d."reversalOfId" WHERE d.id=target AND d.kind='REVERSAL';
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
  INSERT INTO public."FinanceCreditTaxSplit"(id,"customerCreditLineId","netAmount","taxAmount","taxAccountId") SELECT gen_random_uuid(),c.id,q.net,q.tax,q.account FROM public."FinanceCustomerCreditLine" c CROSS JOIN LATERAL public.encova_finance_customer_credit_tax_quote(c.id) q WHERE c."documentId"=target;
  SELECT * INTO inv FROM public."FinanceInvoice" WHERE id=d."creditInvoiceId";
  IF inv.id IS NULL OR inv.state<>'POSTED' OR inv."partyId"<>d."partyId" OR inv.currency<>d.currency OR inv."postingDate">d."documentDate" THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  FOR line_row IN SELECT c.amount,l.* FROM public."FinanceCustomerCreditLine" c JOIN public."FinanceInvoiceLine" l ON l.id=c."invoiceLineId" WHERE c."documentId"=target LOOP
   IF line_row."invoiceId"<>inv.id OR line_row.amount>public.encova_finance_credit_capacity(line_row.id,d."postingDate") OR (line_row.recognition='DEFERRED' AND (SELECT s."netAmount" FROM public."FinanceCreditTaxSplit" s JOIN public."FinanceCustomerCreditLine" c ON c.id=s."customerCreditLineId" WHERE c."documentId"=target AND c."invoiceLineId"=line_row.id)>public.encova_finance_deferred_capacity(line_row.id,d."postingDate")) THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
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
CREATE OR REPLACE FUNCTION encova_finance_customer_lines(target UUID) RETURNS TABLE(sequence INTEGER,"accountId" UUID,description TEXT,debit NUMERIC,credit NUMERIC,"projectId" UUID,"partyId" UUID,"invoiceLineId" UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT 1,c."glAccountId",d.description,d."cashAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d JOIN public."FinanceCashAccount" c ON c.id=d."cashAccountId" WHERE d.id=target AND d.kind='RECEIPT' AND d."cashAmount">0
 UNION ALL SELECT 2,d."feeAccountId",d.description,d."feeAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d.kind='RECEIPT' AND d."feeAmount">0
 UNION ALL SELECT 10+a.sequence,i."receivableAccountId",d.description,0::numeric,a.amount,i."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerAllocation" a ON a."documentId"=d.id JOIN public."FinanceInvoice" i ON i.id=a."invoiceId" WHERE d.id=target AND d.kind IN('RECEIPT','ADVANCE_APPLICATION')
 UNION ALL SELECT 150,d."advanceAccountId",d.description,0::numeric,d."advanceAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d.kind='RECEIPT' AND d."advanceAmount">0
 UNION ALL SELECT 1,d."advanceAccountId",d.description,d."totalAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d.kind IN('ADVANCE_APPLICATION','CUSTOMER_REFUND')
 UNION ALL SELECT 2,c."glAccountId",d.description,0::numeric,d."cashAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d JOIN public."FinanceCashAccount" c ON c.id=d."cashAccountId" WHERE d.id=target AND d.kind='CUSTOMER_REFUND'
 UNION ALL SELECT 10+c.sequence,CASE WHEN l.recognition='EARNED' THEN l."revenueAccountId" ELSE l."deferredAccountId" END,l.description,coalesce(t."netAmount",c.amount),0::numeric,l."projectId",d."partyId",l.id FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerCreditLine" c ON c."documentId"=d.id JOIN public."FinanceInvoiceLine" l ON l.id=c."invoiceLineId" LEFT JOIN public."FinanceCreditTaxSplit" t ON t."customerCreditLineId"=c.id WHERE d.id=target AND d.kind='CUSTOMER_CREDIT' AND coalesce(t."netAmount",c.amount)>0
 UNION ALL SELECT 1,i."receivableAccountId",d.description,0::numeric,s."arAmount",i."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerCreditSplit" s ON s."documentId"=d.id JOIN public."FinanceInvoice" i ON i.id=d."creditInvoiceId" WHERE d.id=target AND d.kind='CUSTOMER_CREDIT' AND s."arAmount">0
 UNION ALL SELECT 2,d."advanceAccountId",d.description,0::numeric,s."balanceAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerCreditSplit" s ON s."documentId"=d.id WHERE d.id=target AND d.kind='CUSTOMER_CREDIT' AND s."balanceAmount">0
 UNION ALL SELECT 10+a.sequence,i."receivableAccountId",d.description,a.amount,0::numeric,i."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerAllocation" a ON a."documentId"=d.id JOIN public."FinanceInvoice" i ON i.id=a."invoiceId" WHERE d.id=target AND d.kind='UNALLOCATION'
 UNION ALL SELECT 1,d."advanceAccountId",d.description,0::numeric,d."totalAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d.kind='UNALLOCATION'
 UNION ALL SELECT l.sequence,l."accountId",l.description,l.credit,l.debit,l."projectId",l."partyId",l."invoiceLineId" FROM public."FinanceCustomerDocument" d JOIN public."FinanceJournalEntry" e ON e."customerDocumentId"=d."reversalOfId" JOIN public."FinanceJournalLine" l ON l."journalId"=e.id WHERE d.id=target AND d.kind='REVERSAL'
 UNION ALL SELECT 3,d."withholdingAccountId",d.description,d."withholdingAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceCustomerDocument" d WHERE d.id=target AND d.kind='RECEIPT' AND d."withholdingAmount">0
 UNION ALL SELECT 200+c.sequence,t."taxAccountId",l.description,t."taxAmount",0::numeric,l."projectId",d."partyId",l.id FROM public."FinanceCustomerDocument" d JOIN public."FinanceCustomerCreditLine" c ON c."documentId"=d.id JOIN public."FinanceInvoiceLine" l ON l.id=c."invoiceLineId" JOIN public."FinanceCreditTaxSplit" t ON t."customerCreditLineId"=c.id WHERE d.id=target AND d.kind='CUSTOMER_CREDIT' AND t."taxAmount">0
$$;
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
  IF origin.id IS NULL OR origin.state<>'POSTED' OR origin.kind='REVERSAL' OR origin."postingDate">d."postingDate" OR ROW(d."partyId",d."projectId",d."cashAccountId",d."feeAccountId",d."advanceAccountId",d."sourceDocumentId",d."creditInvoiceId",d."cashAmount",d."feeAmount",d."allocationAmount",d."advanceAmount",d."totalAmount",d."withholdingAmount",d."withholdingCodeId",d."withholdingSnapshot",d."withholdingAccountId") IS DISTINCT FROM ROW(origin."partyId",origin."projectId",origin."cashAccountId",origin."feeAccountId",origin."advanceAccountId",origin."sourceDocumentId",origin."creditInvoiceId",origin."cashAmount",origin."feeAmount",origin."allocationAmount",origin."advanceAmount",origin."totalAmount",origin."withholdingAmount",origin."withholdingCodeId",origin."withholdingSnapshot",origin."withholdingAccountId") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='UNALLOCATION' THEN
  SELECT * INTO origin FROM public."FinanceCustomerDocument" WHERE id=d."unallocationOfId";
  IF origin.kind IS DISTINCT FROM 'RECEIPT' OR origin.state<>'POSTED' OR origin."partyId"<>d."partyId" OR origin."projectId" IS DISTINCT FROM d."projectId" OR origin."postingDate">d."postingDate" OR origin."allocationAmount"<>d."totalAmount" OR EXISTS((SELECT sequence,"invoiceId",amount FROM public."FinanceCustomerAllocation" WHERE "documentId"=target) EXCEPT(SELECT sequence,"invoiceId",amount FROM public."FinanceCustomerAllocation" WHERE "documentId"=origin.id)) OR EXISTS((SELECT sequence,"invoiceId",amount FROM public."FinanceCustomerAllocation" WHERE "documentId"=origin.id) EXCEPT(SELECT sequence,"invoiceId",amount FROM public."FinanceCustomerAllocation" WHERE "documentId"=target)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 END IF;
 IF d.kind='CUSTOMER_CREDIT' THEN
  IF EXISTS(SELECT 1 FROM public."FinanceCustomerCreditLine" c JOIN public."FinanceInvoiceLine" l ON l.id=c."invoiceLineId" LEFT JOIN public."FinanceCreditTaxSplit" t ON t."customerCreditLineId"=c.id WHERE c."documentId"=target AND((l."taxAmount">0 AND t.id IS NULL) OR(t.id IS NOT NULL AND(t."netAmount"+t."taxAmount"<>c.amount OR t."taxAccountId" IS DISTINCT FROM l."taxAccountId")))) THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;
  SELECT * INTO s FROM public."FinanceCustomerCreditSplit" WHERE "documentId"=target;
  SELECT least(d."totalAmount",coalesce(sum(v.amount),0)) INTO expected_ar FROM public."FinanceReceivableEvent" v WHERE v."invoiceId"=d."creditInvoiceId" AND v."effectiveDate"<=d."postingDate" AND v."customerDocumentId" IS DISTINCT FROM target;
  IF s."documentId" IS NULL OR s."arAmount"+s."balanceAmount"<>d."totalAmount" OR s."arAmount"<>expected_ar THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 ELSIF EXISTS(SELECT 1 FROM public."FinanceCustomerCreditSplit" WHERE "documentId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id) EXCEPT(SELECT * FROM public.encova_finance_customer_lines(target))) OR EXISTS((SELECT * FROM public.encova_finance_customer_lines(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "invoiceId",amount FROM public."FinanceReceivableEvent" WHERE "customerDocumentId"=target) EXCEPT(SELECT * FROM public.encova_finance_customer_ar(target))) OR EXISTS((SELECT * FROM public.encova_finance_customer_ar(target)) EXCEPT(SELECT "invoiceId",amount FROM public."FinanceReceivableEvent" WHERE "customerDocumentId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" v JOIN public."FinanceInvoice" i ON i.id=v."invoiceId" WHERE v."customerDocumentId"=target AND(v."partyId"<>d."partyId" OR v."accountId"<>i."receivableAccountId" OR v."journalId"<>e.id OR v."effectiveDate"<>d."postingDate" OR v.kind<>d.kind)) THEN RAISE EXCEPTION 'FINANCE_RECEIVABLE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "sourceDocumentId","accountId",amount,kind FROM public."FinanceClientBalanceEvent" WHERE "documentId"=target) EXCEPT(SELECT * FROM public.encova_finance_customer_fund(target))) OR EXISTS((SELECT * FROM public.encova_finance_customer_fund(target)) EXCEPT(SELECT "sourceDocumentId","accountId",amount,kind FROM public."FinanceClientBalanceEvent" WHERE "documentId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceClientBalanceEvent" b WHERE b."documentId"=target AND(b."partyId"<>d."partyId" OR b."journalId"<>e.id OR b."effectiveDate"<>d."postingDate")) THEN RAISE EXCEPTION 'FINANCE_CLIENT_BALANCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "invoiceLineId",amount FROM public."FinanceInvoiceCreditEvent" WHERE "customerDocumentId"=target) EXCEPT(SELECT * FROM public.encova_finance_customer_credits(target))) OR EXISTS((SELECT * FROM public.encova_finance_customer_credits(target)) EXCEPT(SELECT "invoiceLineId",amount FROM public."FinanceInvoiceCreditEvent" WHERE "customerDocumentId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceInvoiceCreditEvent" c WHERE c."customerDocumentId"=target AND(c."journalId"<>e.id OR c."effectiveDate"<>d."postingDate" OR c.kind<>d.kind)) THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "invoiceLineId",amount FROM public."FinanceDeferredRevenueEvent" WHERE "customerDocumentId"=target) EXCEPT(SELECT x.* FROM public.encova_finance_customer_deferred_credits(target) x JOIN public."FinanceInvoiceLine" l ON l.id=x."invoiceLineId" WHERE l.recognition='DEFERRED')) OR EXISTS((SELECT x.* FROM public.encova_finance_customer_deferred_credits(target) x JOIN public."FinanceInvoiceLine" l ON l.id=x."invoiceLineId" WHERE l.recognition='DEFERRED') EXCEPT(SELECT "invoiceLineId",amount FROM public."FinanceDeferredRevenueEvent" WHERE "customerDocumentId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceDeferredRevenueEvent" v WHERE v."customerDocumentId"=target AND(v."journalId"<>e.id OR v."effectiveDate"<>d."postingDate" OR v.kind<>d.kind)) THEN RAISE EXCEPTION 'FINANCE_DEFERRED_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(v.amount) OVER(PARTITION BY v."invoiceId" ORDER BY v."effectiveDate" RANGE UNBOUNDED PRECEDING) AS balance FROM public."FinanceReceivableEvent" v WHERE v."invoiceId" IN(SELECT "invoiceId" FROM public.encova_finance_customer_ar(target)))balances WHERE balance<0) THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(b.amount) OVER(PARTITION BY b."sourceDocumentId" ORDER BY b."effectiveDate" RANGE UNBOUNDED PRECEDING) AS balance FROM public."FinanceClientBalanceEvent" b WHERE b."sourceDocumentId" IN(SELECT "sourceDocumentId" FROM public.encova_finance_customer_fund(target)))balances WHERE balance<0) THEN RAISE EXCEPTION 'FINANCE_ADVANCE_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT l."totalAmount"+sum(c.amount) OVER(PARTITION BY c."invoiceLineId" ORDER BY c."effectiveDate" RANGE UNBOUNDED PRECEDING) AS capacity FROM public."FinanceInvoiceCreditEvent" c JOIN public."FinanceInvoiceLine" l ON l.id=c."invoiceLineId" WHERE c."invoiceLineId" IN(SELECT "invoiceLineId" FROM public.encova_finance_customer_credits(target)))balances WHERE capacity<0) THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(v.amount) OVER(PARTITION BY v."invoiceLineId" ORDER BY v."effectiveDate" RANGE UNBOUNDED PRECEDING) AS capacity FROM public."FinanceDeferredRevenueEvent" v WHERE v."invoiceLineId" IN(SELECT "invoiceLineId" FROM public.encova_finance_customer_deferred_credits(target)))balances WHERE capacity<0) THEN RAISE EXCEPTION 'FINANCE_DEFERRED_MISMATCH' USING ERRCODE='P0001';END IF;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_customer_effects(actor UUID,target UUID,entry_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;BEGIN
 SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=target;
 INSERT INTO public."FinanceReceivableEvent"(id,"invoiceId","partyId","accountId","journalId","effectiveDate",kind,amount,"customerDocumentId") SELECT gen_random_uuid(),x."invoiceId",d."partyId",i."receivableAccountId",entry_id,d."postingDate",d.kind,x.amount,d.id FROM public.encova_finance_customer_ar(target) x JOIN public."FinanceInvoice" i ON i.id=x."invoiceId";
 INSERT INTO public."FinanceClientBalanceEvent"(id,"documentId","sourceDocumentId","partyId","accountId","journalId","effectiveDate",kind,amount) SELECT gen_random_uuid(),d.id,x."sourceDocumentId",d."partyId",x."accountId",entry_id,d."postingDate",x.kind,x.amount FROM public.encova_finance_customer_fund(target) x;
 INSERT INTO public."FinanceInvoiceCreditEvent"(id,"invoiceLineId","customerDocumentId","journalId","effectiveDate",kind,amount) SELECT gen_random_uuid(),x."invoiceLineId",d.id,entry_id,d."postingDate",d.kind,x.amount FROM public.encova_finance_customer_credits(target) x;
 INSERT INTO public."FinanceDeferredRevenueEvent"(id,"invoiceLineId","journalId","effectiveDate",kind,amount,"customerDocumentId") SELECT gen_random_uuid(),x."invoiceLineId",entry_id,d."postingDate",d.kind,x.amount,d.id FROM public.encova_finance_customer_deferred_credits(target) x JOIN public."FinanceInvoiceLine" l ON l.id=x."invoiceLineId" WHERE l.recognition='DEFERRED' AND x.amount<>0;
 IF d."advanceAccountId" IS NOT NULL THEN PERFORM public.encova_finance_mark_accounts(ARRAY[d."advanceAccountId"]);END IF;
 UPDATE public."FinanceParty" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=d."partyId";
 UPDATE public."FinanceCustomerDocument" SET state='POSTED',version=version+1,"partySnapshot"=public.encova_finance_party_snapshot("partyId"),"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;
END $$;
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
  INSERT INTO public."FinanceCreditTaxSplit"(id,"supplierCreditLineId","netAmount","taxAmount","taxAccountId") SELECT gen_random_uuid(),c.id,q.net,q.tax,q.account FROM public."FinanceSupplierCreditLine" c CROSS JOIN LATERAL public.encova_finance_supplier_credit_tax_quote(c.id) q WHERE c."documentId"=target;
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
CREATE OR REPLACE FUNCTION encova_finance_supplier_lines(target UUID) RETURNS TABLE(sequence INTEGER,"accountId" UUID,description TEXT,debit NUMERIC,credit NUMERIC,"projectId" UUID,"partyId" UUID,"billLineId" UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT 1,c."glAccountId",d.description,0::numeric,d."cashAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d JOIN public."FinanceCashAccount" c ON c.id=d."cashAccountId" WHERE d.id=target AND d.kind='PAYMENT' AND d."cashAmount">0
 UNION ALL SELECT 2,d."feeAccountId",d.description,0::numeric,d."feeAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d WHERE d.id=target AND d.kind='PAYMENT' AND d."feeAmount">0
 UNION ALL SELECT 10+a.sequence,i."payableAccountId",d.description,a.amount,0::numeric,i."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d JOIN public."FinanceSupplierAllocation" a ON a."documentId"=d.id JOIN public."FinanceBill" i ON i.id=a."billId" WHERE d.id=target AND d.kind IN('PAYMENT','ADVANCE_APPLICATION')
 UNION ALL SELECT 150,d."advanceAccountId",d.description,d."advanceAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d WHERE d.id=target AND d.kind='PAYMENT' AND d."advanceAmount">0
 UNION ALL SELECT 1,d."advanceAccountId",d.description,0::numeric,d."totalAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d WHERE d.id=target AND d.kind IN('ADVANCE_APPLICATION','SUPPLIER_REFUND')
 UNION ALL SELECT 2,c."glAccountId",d.description,d."cashAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d JOIN public."FinanceCashAccount" c ON c.id=d."cashAccountId" WHERE d.id=target AND d.kind='SUPPLIER_REFUND'
 UNION ALL SELECT 10+c.sequence,l."costAccountId",l.description,0::numeric,coalesce(t."netAmount",c.amount),l."projectId",d."partyId",l.id FROM public."FinanceSupplierDocument" d JOIN public."FinanceSupplierCreditLine" c ON c."documentId"=d.id JOIN public."FinanceBillLine" l ON l.id=c."billLineId" LEFT JOIN public."FinanceCreditTaxSplit" t ON t."supplierCreditLineId"=c.id WHERE d.id=target AND d.kind='SUPPLIER_CREDIT' AND coalesce(t."netAmount",c.amount)>0
 UNION ALL SELECT 1,i."payableAccountId",d.description,s."arAmount",0::numeric,i."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d JOIN public."FinanceSupplierCreditSplit" s ON s."documentId"=d.id JOIN public."FinanceBill" i ON i.id=d."creditBillId" WHERE d.id=target AND d.kind='SUPPLIER_CREDIT' AND s."arAmount">0
 UNION ALL SELECT 2,d."advanceAccountId",d.description,s."balanceAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d JOIN public."FinanceSupplierCreditSplit" s ON s."documentId"=d.id WHERE d.id=target AND d.kind='SUPPLIER_CREDIT' AND s."balanceAmount">0
 UNION ALL SELECT 10+a.sequence,i."payableAccountId",d.description,0::numeric,a.amount,i."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d JOIN public."FinanceSupplierAllocation" a ON a."documentId"=d.id JOIN public."FinanceBill" i ON i.id=a."billId" WHERE d.id=target AND d.kind='UNALLOCATION'
 UNION ALL SELECT 1,d."advanceAccountId",d.description,d."totalAmount",0::numeric,d."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d WHERE d.id=target AND d.kind='UNALLOCATION'
 UNION ALL SELECT l.sequence,l."accountId",l.description,l.credit,l.debit,l."projectId",l."partyId",l."billLineId" FROM public."FinanceSupplierDocument" d JOIN public."FinanceJournalEntry" e ON e."supplierDocumentId"=d."reversalOfId" JOIN public."FinanceJournalLine" l ON l."journalId"=e.id WHERE d.id=target AND d.kind='REVERSAL'

 UNION ALL SELECT 3,d."withholdingAccountId",d.description,0::numeric,d."withholdingAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceSupplierDocument" d WHERE d.id=target AND d.kind='PAYMENT' AND d."withholdingAmount">0
 UNION ALL SELECT 200+c.sequence,t."taxAccountId",l.description,0::numeric,t."taxAmount",l."projectId",d."partyId",l.id FROM public."FinanceSupplierDocument" d JOIN public."FinanceSupplierCreditLine" c ON c."documentId"=d.id JOIN public."FinanceBillLine" l ON l.id=c."billLineId" JOIN public."FinanceCreditTaxSplit" t ON t."supplierCreditLineId"=c.id WHERE d.id=target AND d.kind='SUPPLIER_CREDIT' AND t."taxAmount">0
$$;
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
  IF origin.id IS NULL OR origin.state<>'POSTED' OR origin.kind='REVERSAL' OR origin."postingDate">d."postingDate" OR ROW(d."partyId",d."projectId",d."cashAccountId",d."feeAccountId",d."advanceAccountId",d."sourceDocumentId",d."creditBillId",d."cashAmount",d."feeAmount",d."allocationAmount",d."advanceAmount",d."totalAmount",d."withholdingAmount",d."withholdingCodeId",d."withholdingSnapshot",d."withholdingAccountId") IS DISTINCT FROM ROW(origin."partyId",origin."projectId",origin."cashAccountId",origin."feeAccountId",origin."advanceAccountId",origin."sourceDocumentId",origin."creditBillId",origin."cashAmount",origin."feeAmount",origin."allocationAmount",origin."advanceAmount",origin."totalAmount",origin."withholdingAmount",origin."withholdingCodeId",origin."withholdingSnapshot",origin."withholdingAccountId") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='UNALLOCATION' THEN
  SELECT * INTO origin FROM public."FinanceSupplierDocument" WHERE id=d."unallocationOfId";
  IF origin.kind IS DISTINCT FROM 'PAYMENT' OR origin.state<>'POSTED' OR origin."partyId"<>d."partyId" OR origin."projectId" IS DISTINCT FROM d."projectId" OR origin."postingDate">d."postingDate" OR origin."allocationAmount"<>d."totalAmount" OR EXISTS((SELECT sequence,"billId",amount FROM public."FinanceSupplierAllocation" WHERE "documentId"=target) EXCEPT(SELECT sequence,"billId",amount FROM public."FinanceSupplierAllocation" WHERE "documentId"=origin.id)) OR EXISTS((SELECT sequence,"billId",amount FROM public."FinanceSupplierAllocation" WHERE "documentId"=origin.id) EXCEPT(SELECT sequence,"billId",amount FROM public."FinanceSupplierAllocation" WHERE "documentId"=target)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 END IF;
 IF d.kind='SUPPLIER_CREDIT' THEN
  IF EXISTS(SELECT 1 FROM public."FinanceSupplierCreditLine" c JOIN public."FinanceBillLine" l ON l.id=c."billLineId" LEFT JOIN public."FinanceCreditTaxSplit" t ON t."supplierCreditLineId"=c.id WHERE c."documentId"=target AND((l."taxAmount">0 AND t.id IS NULL) OR(t.id IS NOT NULL AND(t."netAmount"+t."taxAmount"<>c.amount OR t."taxAccountId" IS DISTINCT FROM l."taxAccountId")))) THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;
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
CREATE FUNCTION encova_finance_credit_tax_check_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE target UUID;BEGIN
 IF NEW."customerCreditLineId" IS NOT NULL THEN SELECT "documentId" INTO target FROM public."FinanceCustomerCreditLine" WHERE id=NEW."customerCreditLineId";PERFORM public.encova_finance_check_customer(target);
 ELSE SELECT "documentId" INTO target FROM public."FinanceSupplierCreditLine" WHERE id=NEW."supplierCreditLineId";PERFORM public.encova_finance_check_supplier(target);END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER "FinanceCreditTaxSplit_valid" AFTER INSERT ON "FinanceCreditTaxSplit" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_credit_tax_check_trigger();
DO $$ DECLARE t TEXT;f RECORD;role_name TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceTaxCode','FinanceCreditTaxSplit'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,role_name);END IF;END LOOP;
 END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND(proname LIKE 'encova_finance_tax_%' OR proname LIKE 'encova_finance_%_tax_%' OR proname LIKE 'encova_finance_%_withholding_guard' OR proname IN('encova_finance_invoice_lines','encova_finance_customer_deferred_credits')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','encova_app'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name);END IF;END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION encova_finance_tax_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID) TO encova_app;END IF;
END $$;
COMMIT;
