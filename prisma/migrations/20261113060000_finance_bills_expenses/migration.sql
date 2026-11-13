BEGIN;
CREATE SEQUENCE finance_bill_number AS BIGINT MINVALUE 1 MAXVALUE 9999999999 NO CYCLE;
CREATE TABLE "FinanceBill"(id UUID PRIMARY KEY,number TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN('BILL','EXPENSE')),reference TEXT NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 80),"referenceReliable" BOOLEAN NOT NULL DEFAULT true,"duplicateAcknowledged" BOOLEAN NOT NULL DEFAULT false,"partyId" UUID NOT NULL REFERENCES "FinanceParty" ON DELETE RESTRICT,"payableAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,"cashAccountId" UUID REFERENCES "FinanceCashAccount" ON DELETE RESTRICT,"projectId" UUID REFERENCES "Project" ON DELETE RESTRICT,"billDate" DATE NOT NULL CHECK("billDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),"postingDate" DATE NOT NULL CHECK("postingDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' AND "postingDate">="billDate"),"dueDate" DATE NOT NULL CHECK("dueDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' AND "dueDate">="billDate"),description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 1000),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','POSTED','VOIDED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"lineAmount" NUMERIC(20,2) NOT NULL CHECK("lineAmount">=0),"discountAmount" NUMERIC(20,2) NOT NULL CHECK("discountAmount">=0 AND "discountAmount"<="lineAmount"),"netAmount" NUMERIC(20,2) NOT NULL CHECK("netAmount"="lineAmount"-"discountAmount"),"taxAmount" NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK("taxAmount"=0),"totalAmount" NUMERIC(20,2) NOT NULL CHECK("totalAmount"="netAmount"+"taxAmount"),"partySnapshot" JSONB,"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK((kind='BILL' AND "payableAccountId" IS NOT NULL AND "cashAccountId" IS NULL AND number~'^BIL-[0-9]{10}$') OR(kind='EXPENSE' AND "payableAccountId" IS NULL AND "cashAccountId" IS NOT NULL AND number~'^EXP-[0-9]{10}$')));
CREATE INDEX "FinanceBill_partyId_postingDate_id_idx" ON "FinanceBill"("partyId","postingDate",id);
CREATE UNIQUE INDEX "FinanceBill_reliable_reference" ON "FinanceBill"("partyId",lower(trim(reference))) WHERE state='POSTED' AND "referenceReliable";
CREATE TABLE "FinanceBillLine"(id UUID PRIMARY KEY,"billId" UUID NOT NULL REFERENCES "FinanceBill" ON DELETE RESTRICT,sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 100),description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 500),quantity NUMERIC(20,6) NOT NULL CHECK(quantity>0),"unitRate" NUMERIC(20,6) NOT NULL CHECK("unitRate">=0),"lineAmount" NUMERIC(20,2) NOT NULL CHECK("lineAmount"=round(quantity*"unitRate",2)),"discountAmount" NUMERIC(20,2) NOT NULL CHECK("discountAmount">=0 AND "discountAmount"<="lineAmount"),"netAmount" NUMERIC(20,2) NOT NULL CHECK("netAmount"="lineAmount"-"discountAmount"),"taxAmount" NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK("taxAmount"=0),"totalAmount" NUMERIC(20,2) NOT NULL CHECK("totalAmount"="netAmount"+"taxAmount"),treatment TEXT NOT NULL CHECK(treatment IN('EXPENSE','PREPAYMENT','ASSET')),"costAccountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,"projectId" UUID REFERENCES "Project" ON DELETE RESTRICT,UNIQUE("billId",sequence));
CREATE TABLE "FinancePayableEvent"(id UUID PRIMARY KEY,"billId" UUID NOT NULL REFERENCES "FinanceBill" ON DELETE RESTRICT,"partyId" UUID NOT NULL REFERENCES "FinanceParty" ON DELETE RESTRICT,"accountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,"journalId" UUID NOT NULL REFERENCES "FinanceJournalEntry" ON DELETE RESTRICT,"effectiveDate" DATE NOT NULL,kind TEXT NOT NULL CHECK(kind='BILL'),amount NUMERIC(20,2) NOT NULL CHECK(amount>0),currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),UNIQUE("billId","journalId"));
CREATE INDEX "FinancePayableEvent_billId_effectiveDate_id_idx" ON "FinancePayableEvent"("billId","effectiveDate",id);
ALTER TABLE "FinanceJournalEntry" ADD COLUMN "billId" UUID UNIQUE REFERENCES "FinanceBill" ON DELETE RESTRICT;
ALTER TABLE "FinanceJournalLine" ADD COLUMN "billLineId" UUID REFERENCES "FinanceBillLine" ON DELETE RESTRICT;
DO $$ DECLARE old_check TEXT;BEGIN SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint WHERE conrelid='public."FinanceJournalEntry"'::regclass AND conname='FinanceJournalEntry_source_identity';ALTER TABLE "FinanceJournalEntry" DROP CONSTRAINT "FinanceJournalEntry_source_identity";EXECUTE 'ALTER TABLE public."FinanceJournalEntry" ADD CONSTRAINT "FinanceJournalEntry_source_identity" CHECK(('||substr(old_check,8,length(old_check)-8)||' AND "billId" IS NULL) OR("sourceType"=''BILL'' AND "sourceAction"=''POST'' AND "billId"="sourceId" AND "billId" IS NOT NULL AND "invoiceId" IS NULL AND "customerDocumentId" IS NULL AND "draftId" IS NULL AND "reversalOfId" IS NULL))';END $$;
CREATE TRIGGER "FinanceBill_config" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceBill" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceBillLine_config" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceBillLine" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinancePayableEvent_config" BEFORE INSERT ON "FinancePayableEvent" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinancePayableEvent_immutable" BEFORE UPDATE OR DELETE ON "FinancePayableEvent" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
CREATE FUNCTION encova_finance_bill_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' OR(TG_OP='UPDATE' AND OLD.state<>'DRAFT') THEN RAISE EXCEPTION 'FINANCE_BILL_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN IF NEW.state<>'DRAFT' OR NEW.version<>1 OR NEW."partySnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;RETURN NEW;END IF;
 IF ROW(NEW.id,NEW.number,NEW.kind,NEW."createdById",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD.number,OLD.kind,OLD."createdById",OLD."createdAt") OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
 IF NEW.state<>'DRAFT' AND(to_jsonb(NEW)-ARRAY['state','version','partySnapshot','updatedAt']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','partySnapshot','updatedAt']) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW.state='POSTED' THEN IF NEW."partySnapshot" IS DISTINCT FROM public.encova_finance_party_snapshot(NEW."partyId") OR NOT EXISTS(SELECT 1 FROM public."FinanceJournalEntry" WHERE "billId"=NEW.id) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;ELSIF NEW."partySnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN NEW;END $$;
CREATE TRIGGER "FinanceBill_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceBill" FOR EACH ROW EXECUTE FUNCTION encova_finance_bill_guard();
CREATE FUNCTION encova_finance_bill_line_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE target UUID;s TEXT;BEGIN
 target:=CASE WHEN TG_OP='DELETE' THEN OLD."billId" ELSE NEW."billId" END;SELECT state INTO s FROM public."FinanceBill" WHERE id=target FOR UPDATE;
 IF s IS DISTINCT FROM 'DRAFT' OR(TG_OP='UPDATE' AND ROW(NEW.id,NEW."billId") IS DISTINCT FROM ROW(OLD.id,OLD."billId")) THEN RAISE EXCEPTION 'FINANCE_BILL_IMMUTABLE' USING ERRCODE='P0001';END IF;IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END $$;
CREATE TRIGGER "FinanceBillLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceBillLine" FOR EACH ROW EXECUTE FUNCTION encova_finance_bill_line_guard();
CREATE FUNCTION encova_finance_bill_lines(target UUID) RETURNS TABLE(sequence INTEGER,"accountId" UUID,description TEXT,debit NUMERIC,credit NUMERIC,"projectId" UUID,"partyId" UUID,"billLineId" UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT 1,CASE WHEN d.kind='BILL' THEN d."payableAccountId" ELSE c."glAccountId" END,d.description,0::numeric,d."totalAmount",d."projectId",d."partyId",NULL::uuid FROM public."FinanceBill" d LEFT JOIN public."FinanceCashAccount" c ON c.id=d."cashAccountId" WHERE d.id=target
 UNION ALL SELECT l.sequence+1,l."costAccountId",l.description,l."totalAmount",0::numeric,l."projectId",d."partyId",l.id FROM public."FinanceBill" d JOIN public."FinanceBillLine" l ON l."billId"=d.id WHERE d.id=target AND l."totalAmount">0
$$;
CREATE FUNCTION encova_finance_bill_validate(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE d public."FinanceBill"%ROWTYPE;BEGIN
 SELECT * INTO d FROM public."FinanceBill" WHERE id=target;
 IF d.state IS DISTINCT FROM 'DRAFT' OR d."totalAmount"<=0 THEN RAISE EXCEPTION 'FINANCE_BILL_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=d."partyId" AND active AND kind IN('SUPPLIER','BOTH','EMPLOYEE')) THEN RAISE EXCEPTION 'FINANCE_BILL_PARTY' USING ERRCODE='P0001';END IF;
 IF(d.kind='BILL' AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."payableAccountId" AND active AND "isPosting" AND NOT "isContra" AND currency='PKR' AND type='LIABILITY' AND "controlType"='PAYABLES')) OR(d.kind='EXPENSE' AND NOT EXISTS(SELECT 1 FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" a ON a.id=c."glAccountId" WHERE c.id=d."cashAccountId" AND c.active AND a.active AND a."isPosting" AND NOT a."isContra" AND a.currency='PKR' AND a."controlType"='CASH')) THEN RAISE EXCEPTION 'FINANCE_BILL_MAPPING' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM public."FinanceBillLine" l JOIN public."FinanceAccount" a ON a.id=l."costAccountId" WHERE l."billId"=target AND(NOT a.active OR NOT a."isPosting" OR a."isContra" OR a.currency<>'PKR' OR NOT((l.treatment='EXPENSE' AND a.type IN('DIRECT_COST','OPERATING_EXPENSE','OTHER_EXPENSE') AND a."controlType"='NONE') OR(l.treatment='PREPAYMENT' AND a.type='ASSET' AND a."controlType"='NONE') OR(l.treatment='ASSET' AND a.type='ASSET' AND a."controlType"='FIXED_ASSET')))) THEN RAISE EXCEPTION 'FINANCE_BILL_MAPPING' USING ERRCODE='P0001';END IF;
 IF(d."projectId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Project" WHERE id=d."projectId" AND "archivedAt" IS NULL)) OR EXISTS(SELECT 1 FROM public."FinanceBillLine" l JOIN public."Project" p ON p.id=l."projectId" WHERE l."billId"=target AND p."archivedAt" IS NOT NULL) THEN RAISE EXCEPTION 'FINANCE_PROJECT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM public."FinanceBill" x WHERE x.id<>d.id AND x.state='POSTED' AND x."partyId"=d."partyId" AND lower(trim(x.reference))=lower(trim(d.reference)) AND(x."referenceReliable" OR d."referenceReliable")) THEN RAISE EXCEPTION 'FINANCE_DUPLICATE_REFERENCE' USING ERRCODE='P0001';END IF;
 IF NOT d."duplicateAcknowledged" AND EXISTS(SELECT 1 FROM public."FinanceBill" x WHERE x.id<>d.id AND x.state='POSTED' AND x."partyId"=d."partyId" AND x."totalAmount"=d."totalAmount" AND x."billDate"=d."billDate") THEN RAISE EXCEPTION 'FINANCE_DUPLICATE_REVIEW' USING ERRCODE='P0001';END IF;
END $$;
CREATE FUNCTION encova_finance_check_bill(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE d public."FinanceBill"%ROWTYPE;e public."FinanceJournalEntry"%ROWTYPE;n BIGINT;gross NUMERIC;discounts NUMERIC;net NUMERIC;total NUMERIC;BEGIN
 SELECT * INTO d FROM public."FinanceBill" WHERE id=target;SELECT count(*),coalesce(sum(l."lineAmount"),0),coalesce(sum(l."discountAmount"),0),coalesce(sum(l."netAmount"),0),coalesce(sum(l."totalAmount"),0) INTO n,gross,discounts,net,total FROM public."FinanceBillLine" l WHERE l."billId"=target;
 IF d.id IS NULL OR n NOT BETWEEN 1 AND 100 OR ROW(d."lineAmount",d."discountAmount",d."netAmount",d."totalAmount") IS DISTINCT FROM ROW(gross,discounts,net,total) THEN RAISE EXCEPTION 'FINANCE_BILL_TOTALS' USING ERRCODE='P0001';END IF;
 SELECT * INTO e FROM public."FinanceJournalEntry" WHERE "billId"=target;
 IF d.state<>'POSTED' THEN IF e.id IS NOT NULL OR EXISTS(SELECT 1 FROM public."FinancePayableEvent" WHERE "billId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;END IF;
 IF e.id IS NULL OR e."postingDate"<>d."postingDate" OR e.description<>d.description OR e.evidence<>d.evidence OR d."partySnapshot" IS NULL OR EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","billLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id) EXCEPT(SELECT * FROM public.encova_finance_bill_lines(target))) OR EXISTS((SELECT * FROM public.encova_finance_bill_lines(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","billLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF(d.kind='BILL' AND((SELECT count(*) FROM public."FinancePayableEvent" WHERE "billId"=target AND kind='BILL')<>1 OR NOT EXISTS(SELECT 1 FROM public."FinancePayableEvent" WHERE "billId"=target AND "journalId"=e.id AND "partyId"=d."partyId" AND "accountId"=d."payableAccountId" AND "effectiveDate"=d."postingDate" AND kind='BILL' AND amount=d."totalAmount"))) OR(d.kind='EXPENSE' AND EXISTS(SELECT 1 FROM public."FinancePayableEvent" WHERE "billId"=target)) THEN RAISE EXCEPTION 'FINANCE_PAYABLE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM public."FinanceBill" x WHERE x.id<>d.id AND x.state='POSTED' AND x."partyId"=d."partyId" AND lower(trim(x.reference))=lower(trim(d.reference)) AND(x."referenceReliable" OR d."referenceReliable")) THEN RAISE EXCEPTION 'FINANCE_DUPLICATE_REFERENCE' USING ERRCODE='P0001';END IF;
END $$;
CREATE FUNCTION encova_finance_bill_check_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE target UUID;BEGIN
 IF TG_TABLE_NAME='FinanceBill' THEN target:=NEW.id;ELSIF TG_OP='DELETE' THEN target:=OLD."billId";ELSE target:=NEW."billId";END IF;PERFORM public.encova_finance_check_bill(target);RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER "FinanceBill_valid" AFTER INSERT OR UPDATE ON "FinanceBill" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_bill_check_trigger();
CREATE CONSTRAINT TRIGGER "FinanceBillLine_valid" AFTER INSERT OR UPDATE OR DELETE ON "FinanceBillLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_bill_check_trigger();
CREATE CONSTRAINT TRIGGER "FinancePayableEvent_valid" AFTER INSERT ON "FinancePayableEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_bill_check_trigger();
CREATE OR REPLACE FUNCTION encova_finance_bill_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE bill public."FinanceBill"%ROWTYPE; receipt public."FinanceLedgerReceipt"%ROWTYPE; entry_id UUID;
 reason TEXT; digest TEXT; operation_name TEXT; result JSONB; line JSONB; prepared JSONB:='[]';position INTEGER:=0;
 quantity_value NUMERIC;rate_value NUMERIC;rounded NUMERIC;discount_value NUMERIC;net_value NUMERIC;gross NUMERIC:=0;discounts NUMERIC:=0;net NUMERIC:=0;
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
   IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR line-ARRAY['description','quantity','unitRate','discountAmount','treatment','costAccountId','projectId']<>'{}'::jsonb OR jsonb_typeof(line->'quantity') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'unitRate') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'discountAmount') IS DISTINCT FROM 'string' OR line->>'quantity' !~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,6})?$' OR line->>'unitRate' !~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,6})?$' OR line->>'discountAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   quantity_value:=(line->>'quantity')::numeric;rate_value:=(line->>'unitRate')::numeric;rounded:=round(quantity_value*rate_value,2);discount_value:=(line->>'discountAmount')::numeric;net_value:=rounded-discount_value;
   IF quantity_value<=0 OR rounded>999999999999999999.99 OR discount_value>rounded THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   gross:=gross+rounded;discounts:=discounts+discount_value;net:=net+net_value;
   IF gross>999999999999999999.99 OR discounts>999999999999999999.99 OR net>999999999999999999.99 THEN RAISE EXCEPTION 'FINANCE_BILL_TOTALS' USING ERRCODE='P0001';END IF;
   position:=position+1;
   prepared:=prepared||jsonb_build_array(line||jsonb_build_object('sequence',position,'lineAmount',rounded::text,'netAmount',net_value::text));
  END LOOP;
  IF action='CREATE' THEN
   INSERT INTO public."FinanceBill"(id,number,kind,"referenceReliable","duplicateAcknowledged","cashAccountId",reference,"partyId","payableAccountId","projectId","billDate","postingDate","dueDate",description,evidence,currency,"lineAmount","discountAmount","netAmount","taxAmount","totalAmount","createdById") VALUES(gen_random_uuid(),CASE WHEN input->>'kind'='BILL' THEN 'BIL-' ELSE 'EXP-' END||lpad(nextval('public.finance_bill_number')::text,10,'0'),input->>'kind',(input->>'referenceReliable')::boolean,(input->>'duplicateAcknowledged')::boolean,nullif(input->>'cashAccountId','')::uuid,input->>'reference',(input->>'partyId')::uuid,(input->>'payableAccountId')::uuid,nullif(input->>'projectId','')::uuid,bill_date,posting_date,due_date,input->>'description',input->>'evidence','PKR',gross,discounts,net,0,net,actor) RETURNING * INTO bill;
  ELSE
   UPDATE public."FinanceBill" SET kind=input->>'kind',"referenceReliable"=(input->>'referenceReliable')::boolean,"duplicateAcknowledged"=(input->>'duplicateAcknowledged')::boolean,"cashAccountId"=nullif(input->>'cashAccountId','')::uuid,reference=input->>'reference',"partyId"=(input->>'partyId')::uuid,"payableAccountId"=(input->>'payableAccountId')::uuid,"projectId"=nullif(input->>'projectId','')::uuid,"billDate"=bill_date,"postingDate"=posting_date,"dueDate"=due_date,description=input->>'description',evidence=input->>'evidence',"lineAmount"=gross,"discountAmount"=discounts,"netAmount"=net,"taxAmount"=0,"totalAmount"=net,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=bill.id RETURNING * INTO bill;
   DELETE FROM public."FinanceBillLine" WHERE "billId"=bill.id;
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(prepared) LOOP
   INSERT INTO public."FinanceBillLine"(id,"billId",sequence,description,quantity,"unitRate","lineAmount","discountAmount","netAmount","taxAmount","totalAmount",treatment,"costAccountId","projectId") VALUES(gen_random_uuid(),bill.id,(line->>'sequence')::integer,line->>'description',(line->>'quantity')::numeric,(line->>'unitRate')::numeric,(line->>'lineAmount')::numeric,(line->>'discountAmount')::numeric,(line->>'netAmount')::numeric,0,(line->>'netAmount')::numeric,line->>'treatment',(line->>'costAccountId')::uuid,coalesce(nullif(line->>'projectId','')::uuid,bill."projectId"));
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
CREATE FUNCTION encova_finance_bill_effects(target UUID,entry_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE d public."FinanceBill"%ROWTYPE;BEGIN
 SELECT * INTO d FROM public."FinanceBill" WHERE id=target;
 IF d.kind='BILL' THEN INSERT INTO public."FinancePayableEvent"(id,"billId","partyId","accountId","journalId","effectiveDate",kind,amount) VALUES(gen_random_uuid(),d.id,d."partyId",d."payableAccountId",entry_id,d."postingDate",'BILL',d."totalAmount");END IF;
 UPDATE public."FinanceParty" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=d."partyId";
 UPDATE public."FinanceBill" SET state='POSTED',version=version+1,"partySnapshot"=public.encova_finance_party_snapshot("partyId"),"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_journal_header_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE period public."FinancePeriod"%ROWTYPE;
BEGIN
 SELECT * INTO period FROM public."FinancePeriod" WHERE id=NEW."periodId" FOR UPDATE;
 IF period.id IS NULL OR period.state<>'OPEN' OR NEW."postingDate" NOT BETWEEN period."startDate" AND period."endDate" THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 IF NEW."postingDate">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'FINANCE_FUTURE_DATE' USING ERRCODE='P0001'; END IF;
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
DECLARE bill public."FinanceBill"%ROWTYPE; draft public."FinanceJournalDraft"%ROWTYPE; original public."FinanceJournalEntry"%ROWTYPE; invoice public."FinanceInvoice"%ROWTYPE;
 period_id UUID; entry_id UUID:=gen_random_uuid(); mappings UUID[]; customer public."FinanceCustomerDocument"%ROWTYPE;
BEGIN
 IF source_kind IS NULL OR source_kind NOT IN ('JOURNAL_DRAFT','JOURNAL_REVERSAL','INVOICE','CUSTOMER_DOCUMENT','BILL') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF source_kind='BILL' THEN
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
DO $$ DECLARE t TEXT;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceBill','FinanceBillLine','FinancePayableEvent'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon',t);END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated',t);END IF;
 END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('encova_finance_bill_guard','encova_finance_bill_line_guard','encova_finance_bill_lines','encova_finance_bill_validate','encova_finance_check_bill','encova_finance_bill_check_trigger','encova_finance_bill_effects','encova_finance_bill_command') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon',f.signature);END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated',f.signature);END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM encova_app',f.signature);END IF;
 END LOOP;
 REVOKE ALL ON SEQUENCE public.finance_bill_number FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN REVOKE ALL ON SEQUENCE public.finance_bill_number FROM encova_app;GRANT EXECUTE ON FUNCTION encova_finance_bill_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID) TO encova_app;END IF;
END $$;
COMMIT;
