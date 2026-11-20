BEGIN;
-- F42: immutable reviewed schedules, private leased draft preparation and evidenced deferred recognition.
CREATE TABLE "FinanceRecurringSchedule"(
 id UUID PRIMARY KEY,name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),kind TEXT NOT NULL CHECK(kind IN('BILL','JOURNAL','DEPRECIATION')),template JSONB NOT NULL CHECK(jsonb_typeof(template)='object' AND octet_length(template::text)<=16384),"startMonth" TEXT NOT NULL CHECK("startMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),"endMonth" TEXT CHECK("endMonth" IS NULL OR "endMonth">="startMonth" AND "endMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 28),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),active BOOLEAN NOT NULL DEFAULT true,version INTEGER NOT NULL DEFAULT 1,"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"grantId" UUID NOT NULL REFERENCES "FinanceGrant" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "FinanceRecurringRun"(
 id UUID PRIMARY KEY,"scheduleId" UUID NOT NULL REFERENCES "FinanceRecurringSchedule" ON DELETE RESTRICT,month TEXT NOT NULL,"postingDate" DATE NOT NULL,"requesterId" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"grantId" UUID NOT NULL REFERENCES "FinanceGrant" ON DELETE RESTRICT,state TEXT NOT NULL DEFAULT 'QUEUED' CHECK(state IN('QUEUED','RUNNING','READY','FAILED','CANCELLED')),version INTEGER NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 9),budget INTEGER NOT NULL DEFAULT 3 CHECK(budget IN(3,6,9)),"leaseId" UUID,"leaseUntil" TIMESTAMPTZ,"sourceId" UUID,"sourceType" TEXT CHECK("sourceType" IN('BILL','JOURNAL','ASSET_MOVEMENT')),"errorCode" TEXT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("scheduleId",month),CHECK((state='RUNNING')=("leaseId" IS NOT NULL AND "leaseUntil" IS NOT NULL)),CHECK((state='READY')=("sourceId" IS NOT NULL AND "sourceType" IS NOT NULL))
);
CREATE INDEX "FinanceRecurringRun_due" ON "FinanceRecurringRun"(state,"postingDate",id);
CREATE TABLE "FinanceRecurringAttempt"(
 id UUID PRIMARY KEY,"runId" UUID NOT NULL REFERENCES "FinanceRecurringRun" ON DELETE RESTRICT,attempt INTEGER NOT NULL,"leaseId" UUID NOT NULL UNIQUE,"startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"finishedAt" TIMESTAMPTZ,outcome TEXT NOT NULL DEFAULT 'RUNNING' CHECK(outcome IN('RUNNING','READY','FAILED','EXPIRED','CANCELLED')),"errorCode" TEXT,UNIQUE("runId",attempt),CHECK((outcome='RUNNING')=("finishedAt" IS NULL))
);
CREATE TABLE "FinanceRecognition"(
 id UUID PRIMARY KEY,"invoiceLineId" UUID NOT NULL REFERENCES "FinanceInvoiceLine" ON DELETE RESTRICT,"postingDate" DATE NOT NULL,amount NUMERIC(20,2) NOT NULL CHECK(amount>0),description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 500),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','POSTED','REVERSED','VOIDED')),version INTEGER NOT NULL DEFAULT 1,"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"postedById" UUID REFERENCES "Person" ON DELETE RESTRICT,"postedAt" TIMESTAMPTZ,"journalId" UUID UNIQUE REFERENCES "FinanceJournalEntry" DEFERRABLE INITIALLY DEFERRED,"reversalJournalId" UUID UNIQUE REFERENCES "FinanceJournalEntry" DEFERRABLE INITIALLY DEFERRED,"reversalDate" DATE,"reversedById" UUID REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK((state IN('POSTED','REVERSED'))=("journalId" IS NOT NULL AND "postedById" IS NOT NULL AND "postedAt" IS NOT NULL)),CHECK((state='REVERSED')=("reversalJournalId" IS NOT NULL AND "reversalDate" IS NOT NULL AND "reversedById" IS NOT NULL))
);
CREATE INDEX "FinanceRecognition_register" ON "FinanceRecognition"("postingDate",id);

CREATE OR REPLACE FUNCTION public.encova_finance_ledger_core(actor uuid, action text, input jsonb, request_key text, request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE draft public."FinanceJournalDraft"%ROWTYPE; original public."FinanceJournalEntry"%ROWTYPE; receipt public."FinanceLedgerReceipt"%ROWTYPE;
 period_id UUID; entry_id UUID; target UUID; line JSONB; position INTEGER:=0; result JSONB; digest TEXT; reason TEXT; item JSONB;
BEGIN
 IF action IS NULL OR action NOT IN ('CREATE','UPDATE','POST','VOID','REVERSE','BULK_VOID') OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;

 IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 reason:=trim(input->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 IF input - (CASE WHEN action='CREATE' THEN ARRAY['reference','description','evidence','postingDate','currency','lines','reason'] WHEN action='UPDATE' THEN ARRAY['id','expectedVersion','reference','description','evidence','postingDate','currency','lines','reason'] WHEN action='REVERSE' THEN ARRAY['id','expectedVersion','postingDate','reason'] WHEN action='BULK_VOID' THEN ARRAY['items','reason'] ELSE ARRAY['id','expectedVersion','reason'] END) <> '{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001'; END IF;
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
END $function$
;

CREATE OR REPLACE FUNCTION public.encova_finance_ledger_command(actor uuid, provider text, session_id text, verified_at timestamp with time zone, action text, input jsonb, request_key text, request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$ BEGIN
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT public.encova_finance_session_ok(actor,provider,session_id) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 RETURN public.encova_finance_ledger_core(actor,action,input,request_key,request_id);
END $function$;

CREATE OR REPLACE FUNCTION public.encova_finance_bill_core(actor uuid, action text, input jsonb, request_key text, request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE bill public."FinanceBill"%ROWTYPE; receipt public."FinanceLedgerReceipt"%ROWTYPE; entry_id UUID;
 reason TEXT; digest TEXT; operation_name TEXT; result JSONB; line JSONB; prepared JSONB:='[]';position INTEGER:=0;
 quantity_value NUMERIC;rate_value NUMERIC;rounded NUMERIC;discount_value NUMERIC;net_value NUMERIC;gross NUMERIC:=0;discounts NUMERIC:=0;net NUMERIC:=0;taxes NUMERIC:=0;totals NUMERIC:=0;quote RECORD;
 bill_date DATE;posting_date DATE;due_date DATE;
BEGIN
 IF action IS NULL OR action NOT IN ('CREATE','UPDATE','POST','VOID') OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;

 IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 reason:=trim(input->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF input-(CASE WHEN action='CREATE' THEN ARRAY['kind','referenceReliable','duplicateAcknowledged','cashAccountId','reference','partyId','payableAccountId','projectId','billDate','postingDate','dueDate','description','evidence','currency','lines','reason'] WHEN action='UPDATE' THEN ARRAY['id','expectedVersion','kind','referenceReliable','duplicateAcknowledged','cashAccountId','reference','partyId','payableAccountId','projectId','billDate','postingDate','dueDate','description','evidence','currency','lines','reason'] ELSE ARRAY['id','expectedVersion','reason'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF action<>'CREATE' AND (jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR (input->>'expectedVersion')::integer<1) THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 operation_name:='BILL_'||action;digest:=public.encova_finance_optional_tax_digest(input);
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
END $function$
;

CREATE OR REPLACE FUNCTION public.encova_finance_bill_command(actor uuid, provider text, session_id text, verified_at timestamp with time zone, action text, input jsonb, request_key text, request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$ BEGIN
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT public.encova_finance_session_ok(actor,provider,session_id) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 RETURN public.encova_finance_bill_core(actor,action,input,request_key,request_id);
END $function$;

CREATE OR REPLACE FUNCTION public.encova_finance_asset_movement_core(actor uuid, action text, input jsonb, request_key text, request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE d public."FinanceAssetMovement"%ROWTYPE;o public."FinanceAssetMovement"%ROWTYPE;a public."FinanceAsset"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;reason TEXT;digest TEXT;result JSONB;entry_id UUID;original UUID;original_number TEXT;original_version INTEGER;BEGIN
 IF action IS NULL OR action NOT IN('CREATE','GENERATE','UPDATE','REFRESH','REOPEN','POST','VOID','REVERSE') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;

 reason:=trim(input->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 OR input-(CASE WHEN action='CREATE' THEN ARRAY['assetId','kind','postingDate','description','evidence','approvalEvidence','amount','feeAmount','expenseAccountId','accumulatedAccountId','counterAccountId','cashAccountId','gainAccountId','lossAccountId','feeAccountId','newResidual','newLifeMonths','newFirstMonth','reason'] WHEN action='UPDATE' THEN ARRAY['id','expectedVersion','postingDate','description','evidence','approvalEvidence','amount','feeAmount','expenseAccountId','accumulatedAccountId','counterAccountId','cashAccountId','gainAccountId','lossAccountId','feeAccountId','newResidual','newLifeMonths','newFirstMonth','reason'] WHEN action='GENERATE' THEN ARRAY['assetId','month','postingDate','expenseAccountId','accumulatedAccountId','evidence','approvalEvidence','reason'] WHEN action='REVERSE' THEN ARRAY['id','expectedVersion','postingDate','reason'] ELSE ARRAY['id','expectedVersion','reason'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF input->>'newResidual' IS NOT NULL AND(jsonb_typeof(input->'newResidual')<>'string' OR input->>'newResidual' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 digest:=encode(sha256(convert_to(jsonb_strip_nulls(input)::text,'UTF8')),'hex');SELECT * INTO r FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation='ASSET_MOVEMENT_'||action AND key=request_key;
 IF FOUND THEN IF r."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN r.result;END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action IN('CREATE','GENERATE') THEN
  SELECT * INTO a FROM public."FinanceAsset" WHERE id=(input->>'assetId')::uuid FOR UPDATE;
  IF a.id IS NULL OR a.state<>'REGISTERED' THEN RAISE EXCEPTION 'FINANCE_ASSET_SOURCE' USING ERRCODE='P0001';END IF;
  IF input->>'postingDate' IS NULL OR input->>'postingDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF action='GENERATE' THEN
   SELECT * INTO d FROM public."FinanceAssetMovement" WHERE "assetId"=a.id AND kind='DEPRECIATION' AND month=input->>'month';
   IF NOT FOUND THEN INSERT INTO public."FinanceAssetMovement"(id,number,"assetId",kind,month,"postingDate",description,evidence,"approvalEvidence",amount,"expenseAccountId","accumulatedAccountId","basisHash","basisSnapshot","createdById") VALUES(gen_random_uuid(),'ASM-'||lpad(nextval('public.finance_asset_movement_number')::text,10,'0'),a.id,'DEPRECIATION',input->>'month',(input->>'postingDate')::date,'Monthly depreciation '||a.tag||' '||(input->>'month'),input->>'evidence',input->>'approvalEvidence',public.encova_finance_asset_charge(a.id,input->>'month'),(input->>'expenseAccountId')::uuid,(input->>'accumulatedAccountId')::uuid,public.encova_finance_asset_basis_hash(a.id),public.encova_finance_asset_capture(a.id),actor) RETURNING * INTO d;END IF;
  ELSE
   IF input->>'kind' IS NULL OR input->>'kind' NOT IN('IMPAIRMENT','ADJUSTMENT_INCREASE','ADJUSTMENT_DECREASE','DISPOSAL','POLICY_CHANGE') OR jsonb_typeof(input->'amount') IS DISTINCT FROM 'string' OR input->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR jsonb_typeof(input->'feeAmount') IS DISTINCT FROM 'string' OR input->>'feeAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   INSERT INTO public."FinanceAssetMovement"(id,number,"assetId",kind,"postingDate",description,evidence,"approvalEvidence",amount,"feeAmount","expenseAccountId","accumulatedAccountId","counterAccountId","cashAccountId","gainAccountId","lossAccountId","feeAccountId","newResidual","newLifeMonths","newFirstMonth","basisHash","basisSnapshot","createdById") VALUES(gen_random_uuid(),'ASM-'||lpad(nextval('public.finance_asset_movement_number')::text,10,'0'),a.id,input->>'kind',(input->>'postingDate')::date,input->>'description',input->>'evidence',input->>'approvalEvidence',(input->>'amount')::numeric,(input->>'feeAmount')::numeric,(input->>'expenseAccountId')::uuid,(input->>'accumulatedAccountId')::uuid,(input->>'counterAccountId')::uuid,(input->>'cashAccountId')::uuid,(input->>'gainAccountId')::uuid,(input->>'lossAccountId')::uuid,(input->>'feeAccountId')::uuid,(input->>'newResidual')::numeric,(input->>'newLifeMonths')::integer,input->>'newFirstMonth',public.encova_finance_asset_basis_hash(a.id),public.encova_finance_asset_capture(a.id),actor) RETURNING * INTO d;
  END IF;
 ELSE
  SELECT * INTO d FROM public."FinanceAssetMovement" WHERE id=(input->>'id')::uuid FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR d.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF action='REVERSE' THEN
   IF d.state<>'POSTED' OR d.kind='REVERSAL' OR EXISTS(SELECT 1 FROM public."FinanceAssetMovement" WHERE "reversalOfId"=d.id) THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001';END IF;
   o:=d;original:=d.id;original_number:=d.number;original_version:=d.version;
   INSERT INTO public."FinanceAssetMovement" SELECT x.* FROM jsonb_populate_record(NULL::public."FinanceAssetMovement",to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),'number','ASM-'||lpad(nextval('public.finance_asset_movement_number')::text,10,'0'),'kind','REVERSAL','reversalOfId',o.id,'postingDate',(input->>'postingDate')::date,'evidence',reason,'approvalEvidence',reason,'basisHash',public.encova_finance_asset_basis_hash(o."assetId"),'basisSnapshot',public.encova_finance_asset_capture(o."assetId"),'sourceSnapshot',NULL,'state','DRAFT','version',1,'createdById',actor,'createdAt',CURRENT_TIMESTAMP,'updatedAt',CURRENT_TIMESTAMP))x RETURNING * INTO d;
   entry_id:=public.encova_finance_emit_journal(actor,'ASSET_MOVEMENT',d.id,d."postingDate",reason);
  ELSIF action='UPDATE' THEN
   IF d.state<>'DRAFT' OR jsonb_typeof(input->'amount') IS DISTINCT FROM 'string' OR input->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR jsonb_typeof(input->'feeAmount') IS DISTINCT FROM 'string' OR input->>'feeAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   UPDATE public."FinanceAssetMovement" SET "postingDate"=(input->>'postingDate')::date,description=input->>'description',evidence=input->>'evidence',"approvalEvidence"=input->>'approvalEvidence',amount=CASE WHEN kind='DEPRECIATION' THEN public.encova_finance_asset_charge("assetId",month) ELSE(input->>'amount')::numeric END,"feeAmount"=(input->>'feeAmount')::numeric,"expenseAccountId"=(input->>'expenseAccountId')::uuid,"accumulatedAccountId"=(input->>'accumulatedAccountId')::uuid,"counterAccountId"=(input->>'counterAccountId')::uuid,"cashAccountId"=(input->>'cashAccountId')::uuid,"gainAccountId"=(input->>'gainAccountId')::uuid,"lossAccountId"=(input->>'lossAccountId')::uuid,"feeAccountId"=(input->>'feeAccountId')::uuid,"newResidual"=(input->>'newResidual')::numeric,"newLifeMonths"=(input->>'newLifeMonths')::integer,"newFirstMonth"=input->>'newFirstMonth',"basisHash"=public.encova_finance_asset_basis_hash("assetId"),"basisSnapshot"=public.encova_finance_asset_capture("assetId"),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
  ELSIF action IN('REFRESH','REOPEN') THEN
   IF(action='REFRESH' AND d.state<>'DRAFT') OR(action='REOPEN' AND d.state<>'VOIDED') THEN RAISE EXCEPTION 'FINANCE_ASSET_MOVEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
   UPDATE public."FinanceAssetMovement" SET state='DRAFT',amount=CASE WHEN kind='DEPRECIATION' THEN public.encova_finance_asset_charge("assetId",month) ELSE amount END,"basisHash"=public.encova_finance_asset_basis_hash("assetId"),"basisSnapshot"=public.encova_finance_asset_capture("assetId"),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
  ELSE
   IF d.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_ASSET_MOVEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
   IF action='VOID' THEN UPDATE public."FinanceAssetMovement" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;ELSE entry_id:=public.encova_finance_emit_journal(actor,'ASSET_MOVEMENT',d.id,d."postingDate",reason);END IF;
  END IF;
 END IF;
 SELECT * INTO d FROM public."FinanceAssetMovement" WHERE id=d.id;
 result:=CASE WHEN original IS NOT NULL THEN jsonb_build_object('id',original,'number',original_number,'version',original_version,'reversalId',d.id,'journalId',entry_id) ELSE jsonb_build_object('id',d.id,'number',d.number,'version',d.version,'journalId',entry_id) END;
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,'ASSET_MOVEMENT_'||action,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_ASSET_MOVEMENT_'||action,'FinanceAssetMovement',coalesce(original,d.id),reason,jsonb_build_object('source',to_jsonb(d)||jsonb_build_object('amount',d.amount::text,'feeAmount',d."feeAmount"::text,'newResidual',d."newResidual"::text),'journalId',entry_id),request_id);RETURN result;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $function$
;

CREATE OR REPLACE FUNCTION public.encova_finance_asset_movement_command(actor uuid, provider text, session_id text, verified_at timestamp with time zone, action text, input jsonb, request_key text, request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$ BEGIN
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT public.encova_finance_session_ok(actor,provider,session_id) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 RETURN public.encova_finance_asset_movement_core(actor,action,input,request_key,request_id);
END $function$;

CREATE FUNCTION encova_finance_automation_access(actor UUID,grant_id UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public."Person" p JOIN public."FinanceGrant" g ON g."userId"=p.id JOIN public."FinanceSettings" s ON s."ownerId"=p.id WHERE p.id=actor AND p.status='ACTIVE' AND p.role='SUPER_ADMIN' AND g.id=grant_id AND g."revokedAt" IS NULL)
$$;
CREATE FUNCTION encova_finance_automation_template(kind TEXT,input JSONB) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR length(trim(input->>'description')) NOT BETWEEN 3 AND 500 OR input->>'description' IS NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF kind='BILL' THEN
  IF input-ARRAY['description','partyId','payableAccountId','costAccountId','amount','dueDays','projectId']<>'{}'::jsonb OR NOT(input ?& ARRAY['partyId','payableAccountId','costAccountId','amount','dueDays']) OR jsonb_typeof(input->'dueDays') IS DISTINCT FROM 'number' OR (input->>'dueDays')::numeric<>trunc((input->>'dueDays')::numeric) OR (input->>'dueDays')::integer NOT BETWEEN 0 AND 90 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 ELSIF kind='JOURNAL' THEN
  IF input-ARRAY['description','debitAccountId','creditAccountId','amount','projectId']<>'{}'::jsonb OR NOT(input ?& ARRAY['debitAccountId','creditAccountId','amount']) OR input->>'debitAccountId'=input->>'creditAccountId' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 ELSIF kind='DEPRECIATION' THEN
  IF input-ARRAY['description','assetId','expenseAccountId','accumulatedAccountId']<>'{}'::jsonb OR NOT(input ?& ARRAY['assetId','expenseAccountId','accumulatedAccountId']) THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 ELSE RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF kind='BILL' AND (input->>'amount')::numeric>99999999999999.99 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF kind IN('BILL','JOURNAL') AND(jsonb_typeof(input->'amount') IS DISTINCT FROM 'string' OR input->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR (input->>'amount')::numeric<=0) THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
END $$;
CREATE FUNCTION encova_finance_automation_enqueue() RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE s public."FinanceRecurringSchedule"%ROWTYPE;candidate DATE;month_key TEXT;counted INTEGER:=0;BEGIN
 PERFORM pg_advisory_xact_lock(987661);PERFORM pg_advisory_xact_lock(629815);
 FOR s IN SELECT * FROM public."FinanceRecurringSchedule" WHERE active AND public.encova_finance_automation_access("createdById","grantId") ORDER BY "createdAt",id LOOP
  -- Bound every pass globally; subsequent passes resume by the permanent schedule/month key.
  FOR candidate IN SELECT d::date+(s.day-1) FROM generate_series((s."startMonth"||'-01')::date,least(coalesce((s."endMonth"||'-01')::date,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date),(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date),interval '1 month')d WHERE d::date+(s.day-1)<=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date AND NOT EXISTS(SELECT 1 FROM public."FinanceRecurringRun" r WHERE r."scheduleId"=s.id AND r.month=to_char(d,'YYYY-MM')) ORDER BY d LIMIT 3 LOOP
   month_key:=to_char(candidate,'YYYY-MM');
   INSERT INTO public."FinanceRecurringRun"(id,"scheduleId",month,"postingDate","requesterId","grantId") VALUES(gen_random_uuid(),s.id,month_key,candidate,s."createdById",s."grantId") ON CONFLICT("scheduleId",month) DO NOTHING;
   counted:=counted+1;IF counted>=3 THEN RETURN counted;END IF;
  END LOOP;
 END LOOP;RETURN counted;
END $$;
CREATE FUNCTION encova_finance_automation_candidates() RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT id FROM public."FinanceRecurringRun" WHERE state='QUEUED' OR(state='RUNNING' AND "leaseUntil"<=CURRENT_TIMESTAMP) ORDER BY "postingDate",id LIMIT 3 $$;
CREATE FUNCTION encova_finance_automation_claim(target UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r public."FinanceRecurringRun"%ROWTYPE;s public."FinanceRecurringSchedule"%ROWTYPE;token UUID;BEGIN
 PERFORM pg_advisory_xact_lock(987661);SELECT * INTO r FROM public."FinanceRecurringRun" WHERE id=target;IF r.id IS NULL THEN RETURN NULL;END IF;
 PERFORM public.encova_finance_lock_person(r."requesterId");PERFORM pg_advisory_xact_lock(629815);SELECT * INTO r FROM public."FinanceRecurringRun" WHERE id=target FOR UPDATE;SELECT * INTO s FROM public."FinanceRecurringSchedule" WHERE id=r."scheduleId";
 IF r.state NOT IN('QUEUED','RUNNING') OR(r.state='RUNNING' AND r."leaseUntil">CURRENT_TIMESTAMP) THEN RETURN NULL;END IF;
 IF r.state='RUNNING' THEN UPDATE public."FinanceRecurringAttempt" SET outcome='EXPIRED',"finishedAt"=CURRENT_TIMESTAMP,"errorCode"='LEASE_EXPIRED' WHERE "leaseId"=r."leaseId" AND outcome='RUNNING';END IF;
 IF NOT s.active OR NOT public.encova_finance_automation_access(r."requesterId",r."grantId") THEN UPDATE public."FinanceRecurringRun" SET state='CANCELLED',version=version+1,"leaseId"=NULL,"leaseUntil"=NULL,"errorCode"='ACCESS_OR_SCHEDULE_REVOKED',"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;RETURN NULL;END IF;
 IF r.attempts>=r.budget THEN UPDATE public."FinanceRecurringRun" SET state='FAILED',version=version+1,"leaseId"=NULL,"leaseUntil"=NULL,"errorCode"='ATTEMPTS_EXHAUSTED',"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;RETURN NULL;END IF;
 token:=gen_random_uuid();UPDATE public."FinanceRecurringRun" SET state='RUNNING',version=version+1,attempts=attempts+1,"leaseId"=token,"leaseUntil"=CURRENT_TIMESTAMP+interval '60 seconds',"errorCode"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE id=target RETURNING * INTO r;
 INSERT INTO public."FinanceRecurringAttempt"(id,"runId",attempt,"leaseId") VALUES(gen_random_uuid(),r.id,r.attempts,token);
 RETURN jsonb_build_object('id',r.id,'leaseId',token);
END $$;
CREATE FUNCTION encova_finance_automation_finish(target UUID,lease UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r public."FinanceRecurringRun"%ROWTYPE;s public."FinanceRecurringSchedule"%ROWTYPE;t JSONB;input JSONB;result JSONB;code TEXT;reference TEXT;BEGIN
 PERFORM pg_advisory_xact_lock(987661);SELECT * INTO r FROM public."FinanceRecurringRun" WHERE id=target;IF r.id IS NULL THEN RETURN;END IF;
 PERFORM public.encova_finance_lock_person(r."requesterId");PERFORM pg_advisory_xact_lock(629815);SELECT * INTO r FROM public."FinanceRecurringRun" WHERE id=target FOR UPDATE;SELECT * INTO s FROM public."FinanceRecurringSchedule" WHERE id=r."scheduleId";
 IF r.state<>'RUNNING' OR r."leaseId"<>lease OR r."leaseUntil"<=CURRENT_TIMESTAMP THEN RETURN;END IF;
 IF NOT s.active OR NOT public.encova_finance_automation_access(r."requesterId",r."grantId") THEN
  UPDATE public."FinanceRecurringAttempt" SET outcome='CANCELLED',"finishedAt"=CURRENT_TIMESTAMP,"errorCode"='ACCESS_OR_SCHEDULE_REVOKED' WHERE "leaseId"=lease;
  UPDATE public."FinanceRecurringRun" SET state='CANCELLED',version=version+1,"leaseId"=NULL,"leaseUntil"=NULL,"errorCode"='ACCESS_OR_SCHEDULE_REVOKED',"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;RETURN;
 END IF;
 BEGIN
  t:=s.template;PERFORM public.encova_finance_automation_template(s.kind,t);PERFORM public.encova_finance_close_assert_open(r."postingDate");reference:='REC-'||s.id::text||'-'||r.month;
  IF s.kind='BILL' THEN
   IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=(t->>'partyId')::uuid AND active AND kind IN('SUPPLIER','BOTH','EMPLOYEE')) OR NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=(t->>'payableAccountId')::uuid AND active AND "controlType"='PAYABLES') OR NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=(t->>'costAccountId')::uuid AND active AND "controlType"='NONE' AND type IN('DIRECT_COST','OPERATING_EXPENSE','OTHER_EXPENSE')) THEN RAISE EXCEPTION 'FINANCE_AUTOMATION_MAPPING' USING ERRCODE='P0001';END IF;
   input:=jsonb_build_object('kind','BILL','referenceReliable',true,'duplicateAcknowledged',false,'cashAccountId',NULL,'reference',reference,'partyId',t->>'partyId','payableAccountId',t->>'payableAccountId','projectId',t->'projectId','billDate',r."postingDate",'postingDate',r."postingDate",'dueDate',r."postingDate"+(t->>'dueDays')::integer,'description',t->>'description','evidence',s.evidence,'currency','PKR','reason','Prepare reviewed recurring bill draft','lines',jsonb_build_array(jsonb_build_object('description',t->>'description','quantity','1','unitRate',t->>'amount','discountAmount','0.00','taxCodeId',NULL,'treatment','EXPENSE','costAccountId',t->>'costAccountId','projectId',t->'projectId')));
   result:=public.encova_finance_bill_core(r."requesterId",'CREATE',input,'automation:'||r.id::text,r.id);
  ELSIF s.kind='JOURNAL' THEN
   IF (SELECT count(*) FROM public."FinanceAccount" WHERE id IN((t->>'debitAccountId')::uuid,(t->>'creditAccountId')::uuid) AND active AND "isPosting" AND currency='PKR' AND "controlType"='NONE' AND NOT "isCashEquivalent" AND NOT EXISTS(SELECT 1 FROM public."FinanceFiscalYear" WHERE state<>'VOID' AND "retainedAccountId"="FinanceAccount".id))<>2 THEN RAISE EXCEPTION 'FINANCE_AUTOMATION_MAPPING' USING ERRCODE='P0001';END IF;
   input:=jsonb_build_object('reference',reference,'description',t->>'description','evidence',s.evidence,'postingDate',r."postingDate",'currency','PKR','reason','Prepare reviewed accrual or prepaid recognition draft','lines',jsonb_build_array(jsonb_build_object('accountId',t->>'debitAccountId','description',t->>'description','debit',t->>'amount','credit','0.00','projectId',t->'projectId'),jsonb_build_object('accountId',t->>'creditAccountId','description',t->>'description','debit','0.00','credit',t->>'amount','projectId',t->'projectId')));
   result:=public.encova_finance_ledger_core(r."requesterId",'CREATE',input,'automation:'||r.id::text,r.id);
  ELSE
   input:=jsonb_build_object('assetId',t->>'assetId','month',r.month,'postingDate',r."postingDate",'expenseAccountId',t->>'expenseAccountId','accumulatedAccountId',t->>'accumulatedAccountId','evidence',s.evidence,'approvalEvidence',s.evidence,'reason','Prepare monthly depreciation draft for independent review');
   result:=public.encova_finance_asset_movement_core(r."requesterId",'GENERATE',input,'automation:'||r.id::text,r.id);
  END IF;
  -- Flush normal source constraints inside this savepoint. Invalid preparation becomes a visible failed job, never partial output.
  SET CONSTRAINTS ALL IMMEDIATE;SET CONSTRAINTS ALL DEFERRED;
  UPDATE public."FinanceRecurringRun" SET state='READY',version=version+1,"leaseId"=NULL,"leaseUntil"=NULL,"sourceId"=(result->>'id')::uuid,"sourceType"=CASE s.kind WHEN 'DEPRECIATION' THEN 'ASSET_MOVEMENT' ELSE s.kind END,"errorCode"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;
  UPDATE public."FinanceRecurringAttempt" SET outcome='READY',"finishedAt"=CURRENT_TIMESTAMP WHERE "leaseId"=lease;
  INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),r."requesterId",'FINANCE_RECURRING_DRAFT','FinanceRecurringRun',r.id,'Prepare recurring draft; no automatic posting',jsonb_build_object('sourceId',result->>'id','kind',s.kind,'month',r.month),r.id);
 EXCEPTION WHEN OTHERS THEN
  code:=CASE WHEN SQLERRM IN('FINANCE_AUTOMATION_MAPPING','FINANCE_PERIOD_UNAVAILABLE','FINANCE_OPENING_DATE','FINANCE_ASSET_POLICY','FINANCE_ASSET_SOURCE','FINANCE_DUPLICATE','FINANCE_ASSET_MONTH') THEN SQLERRM ELSE 'DRAFT_PREPARATION_FAILED' END;
  UPDATE public."FinanceRecurringRun" SET state='FAILED',version=version+1,"leaseId"=NULL,"leaseUntil"=NULL,"errorCode"=code,"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;
  UPDATE public."FinanceRecurringAttempt" SET outcome='FAILED',"finishedAt"=CURRENT_TIMESTAMP,"errorCode"=code WHERE "leaseId"=lease;
 END;
END $$;

CREATE FUNCTION encova_finance_recognition_lines(target UUID,reversed BOOLEAN DEFAULT false) RETURNS TABLE(sequence INTEGER,"accountId" UUID,description TEXT,debit NUMERIC,credit NUMERIC,"projectId" UUID,"partyId" UUID,"invoiceLineId" UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT 1,l."deferredAccountId",r.description,CASE WHEN reversed THEN 0 ELSE r.amount END,CASE WHEN reversed THEN r.amount ELSE 0 END,l."projectId",i."partyId",l.id FROM public."FinanceRecognition" r JOIN public."FinanceInvoiceLine" l ON l.id=r."invoiceLineId" JOIN public."FinanceInvoice" i ON i.id=l."invoiceId" WHERE r.id=target
 UNION ALL SELECT 2,l."revenueAccountId",r.description,CASE WHEN reversed THEN r.amount ELSE 0 END,CASE WHEN reversed THEN 0 ELSE r.amount END,l."projectId",i."partyId",l.id FROM public."FinanceRecognition" r JOIN public."FinanceInvoiceLine" l ON l.id=r."invoiceLineId" JOIN public."FinanceInvoice" i ON i.id=l."invoiceId" WHERE r.id=target
$$;
CREATE FUNCTION encova_finance_recognition_check(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r public."FinanceRecognition"%ROWTYPE;j public."FinanceJournalEntry"%ROWTYPE;reversed BOOLEAN;line RECORD;BEGIN
 SELECT * INTO r FROM public."FinanceRecognition" WHERE id=target;IF r.id IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF r.state IN('DRAFT','VOIDED') THEN IF EXISTS(SELECT 1 FROM public."FinanceJournalEntry" WHERE "sourceType"='RECOGNITION' AND "sourceId"=r.id) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;END IF;
 FOR j IN SELECT * FROM public."FinanceJournalEntry" WHERE "sourceType"='RECOGNITION' AND "sourceId"=r.id LOOP
  reversed:=j."sourceAction"='REVERSE';
  IF j.id IS DISTINCT FROM (CASE WHEN reversed THEN r."reversalJournalId" ELSE r."journalId" END) OR j."postingDate" IS DISTINCT FROM (CASE WHEN reversed THEN r."reversalDate" ELSE r."postingDate" END) OR j."postedById" IS DISTINCT FROM (CASE WHEN reversed THEN r."reversedById" ELSE r."postedById" END) OR j.description<>r.description OR j.evidence<>r.evidence OR j.currency<>'PKR' OR j."reversalOfId" IS DISTINCT FROM (CASE WHEN reversed THEN r."journalId" END) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  IF (SELECT count(*) FROM public."FinanceJournalLine" WHERE "journalId"=j.id)<>2 OR EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId" FROM public.encova_finance_recognition_lines(r.id,reversed)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId" FROM public."FinanceJournalLine" WHERE "journalId"=j.id)) OR EXISTS(SELECT 1 FROM public."FinanceJournalLine" WHERE "journalId"=j.id AND "billLineId" IS NOT NULL) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."FinanceDeferredRevenueEvent" WHERE "journalId"=j.id AND "invoiceLineId"=r."invoiceLineId" AND "effectiveDate"=j."postingDate" AND kind=CASE WHEN reversed THEN 'RECOGNITION_REVERSAL' ELSE 'RECOGNIZED' END AND amount=CASE WHEN reversed THEN r.amount ELSE -r.amount END AND "customerDocumentId" IS NULL) OR(SELECT count(*) FROM public."FinanceDeferredRevenueEvent" WHERE "journalId"=j.id)<>1 THEN RAISE EXCEPTION 'FINANCE_DEFERRED_MISMATCH' USING ERRCODE='P0001';END IF;
 END LOOP;
 IF (SELECT count(*) FROM public."FinanceJournalEntry" WHERE "sourceType"='RECOGNITION' AND "sourceId"=r.id)<>(CASE WHEN r.state='REVERSED' THEN 2 ELSE 1 END) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(amount) OVER(ORDER BY "effectiveDate",id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance FROM public."FinanceDeferredRevenueEvent" WHERE "invoiceLineId"=r."invoiceLineId")p WHERE balance<0) THEN
  -- Same-date event ordering is irrelevant; compare complete effective-date buckets.
  IF EXISTS(SELECT 1 FROM(SELECT sum(sum(amount)) OVER(ORDER BY "effectiveDate") AS balance FROM public."FinanceDeferredRevenueEvent" WHERE "invoiceLineId"=r."invoiceLineId" GROUP BY "effectiveDate")p WHERE balance<0) THEN RAISE EXCEPTION 'FINANCE_RECOGNITION_CAPACITY' USING ERRCODE='P0001';END IF;
 END IF;
END $$;
CREATE FUNCTION encova_finance_recognition_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' OR TG_OP='UPDATE' AND(ROW(NEW.id,NEW."invoiceLineId",NEW."postingDate",NEW.amount,NEW.description,NEW.evidence,NEW."createdById",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."invoiceLineId",OLD."postingDate",OLD.amount,OLD.description,OLD.evidence,OLD."createdById",OLD."createdAt") OR NOT(OLD.state='DRAFT' AND NEW.state IN('POSTED','VOIDED') OR OLD.state='POSTED' AND NEW.state='REVERSED') OR NEW.version<>OLD.version+1 OR OLD.state='POSTED' AND ROW(NEW."journalId",NEW."postedById",NEW."postedAt") IS DISTINCT FROM ROW(OLD."journalId",OLD."postedById",OLD."postedAt")) THEN RAISE EXCEPTION 'FINANCE_RECOGNITION_RETAINED' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE FUNCTION encova_finance_recognition_check_trigger() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM public.encova_finance_recognition_check(NEW.id);RETURN NULL;END $$;
CREATE TRIGGER "FinanceRecognition_config" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceRecognition" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceRecognition_guard" BEFORE UPDATE OR DELETE ON "FinanceRecognition" FOR EACH ROW EXECUTE FUNCTION encova_finance_recognition_guard();
CREATE CONSTRAINT TRIGGER "FinanceRecognition_valid" AFTER INSERT OR UPDATE ON "FinanceRecognition" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_recognition_check_trigger();
DO $$ DECLARE definition TEXT;BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public."FinanceJournalEntry"'::regclass AND conname='FinanceJournalEntry_source_identity';ALTER TABLE public."FinanceJournalEntry" DROP CONSTRAINT "FinanceJournalEntry_source_identity";EXECUTE 'ALTER TABLE public."FinanceJournalEntry" ADD CONSTRAINT "FinanceJournalEntry_source_identity" CHECK ('||substring(definition FROM 8 FOR length(definition)-8)||' OR ("sourceType"=''RECOGNITION'' AND "sourceAction" IN(''POST'',''REVERSE'') AND "draftId" IS NULL AND "costAllocationId" IS NULL))';
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public."FinanceDeferredRevenueEvent"'::regclass AND conname='FinanceDeferredRevenueEvent_source_kind';ALTER TABLE public."FinanceDeferredRevenueEvent" DROP CONSTRAINT "FinanceDeferredRevenueEvent_source_kind";EXECUTE 'ALTER TABLE public."FinanceDeferredRevenueEvent" ADD CONSTRAINT "FinanceDeferredRevenueEvent_source_kind" CHECK ('||substring(definition FROM 8 FOR length(definition)-8)||' OR (kind=''RECOGNIZED'' AND amount<0 AND "customerDocumentId" IS NULL) OR (kind=''RECOGNITION_REVERSAL'' AND amount>0 AND "customerDocumentId" IS NULL))';
END $$;
-- Extend existing guards in place, retaining all prior source-type branches, including F41.
DO $$ DECLARE definition TEXT;BEGIN
 SELECT pg_get_functiondef('public.encova_finance_journal_header_guard()'::regprocedure) INTO definition;
 definition:=replace(definition,E'BEGIN\n',E'BEGIN\n IF NEW."sourceType"=''RECOGNITION'' THEN\n  SELECT * INTO period FROM public."FinancePeriod" WHERE id=NEW."periodId" FOR UPDATE;IF period.id IS NULL OR period.state<>''OPEN'' OR NEW."postingDate" NOT BETWEEN period."startDate" AND period."endDate" OR NEW."postingDate">(CURRENT_TIMESTAMP AT TIME ZONE ''Asia/Karachi'')::date THEN RAISE EXCEPTION ''FINANCE_PERIOD_UNAVAILABLE'' USING ERRCODE=''P0001'';END IF;PERFORM public.encova_finance_close_assert_open(NEW."postingDate");\n  IF NEW."invoiceId" IS NOT NULL OR NEW."billId" IS NOT NULL OR NEW."customerDocumentId" IS NOT NULL OR NEW."supplierDocumentId" IS NOT NULL OR NEW."movementId" IS NOT NULL OR NEW."assetMovementId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public."FinanceRecognition" r WHERE r.id=NEW."sourceId" AND(NEW."sourceAction"=''POST'' AND r.state=''POSTED'' AND r."journalId"=NEW.id OR NEW."sourceAction"=''REVERSE'' AND r.state=''REVERSED'' AND r."reversalJournalId"=NEW.id)) THEN RAISE EXCEPTION ''FINANCE_SOURCE_MISMATCH'' USING ERRCODE=''P0001'';END IF;UPDATE public."FinancePeriod" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=period.id;RETURN NEW;\n END IF;\n');EXECUTE definition;
 SELECT pg_get_functiondef('public.encova_finance_journal_line_guard()'::regprocedure) INTO definition;
 definition:=replace(definition,' IF entry."sourceType"=''OPENING'' THEN',' IF entry."sourceType"=''RECOGNITION'' THEN IF NEW."billLineId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.encova_finance_recognition_lines(entry."sourceId",entry."sourceAction"=''REVERSE'')x WHERE ROW(x.sequence,x."accountId",x.description,x.debit,x.credit,x."projectId",x."partyId",x."invoiceLineId") IS NOT DISTINCT FROM ROW(NEW.sequence,NEW."accountId",NEW.description,NEW.debit,NEW.credit,NEW."projectId",NEW."partyId",NEW."invoiceLineId")) THEN RAISE EXCEPTION ''FINANCE_SOURCE_MISMATCH'' USING ERRCODE=''P0001'';END IF;PERFORM public.encova_finance_mark_accounts(ARRAY[NEW."accountId"]);RETURN NEW;END IF; IF entry."sourceType"=''OPENING'' THEN');EXECUTE definition;
 SELECT pg_get_functiondef('public.encova_finance_journal_check()'::regprocedure) INTO definition;
 definition:=replace(definition,' IF entry."sourceType"=''OPENING'' THEN',' IF entry."sourceType"=''RECOGNITION'' THEN PERFORM public.encova_finance_recognition_check(entry."sourceId");RETURN NULL;END IF; IF entry."sourceType"=''OPENING'' THEN');EXECUTE definition;
 SELECT pg_get_functiondef('public.encova_finance_invoice_check_trigger()'::regprocedure) INTO definition;
 definition:=replace(definition,E'BEGIN\n',E'BEGIN\n IF TG_TABLE_NAME=''FinanceDeferredRevenueEvent'' THEN IF NEW.kind IN(''RECOGNIZED'',''RECOGNITION_REVERSAL'') THEN PERFORM public.encova_finance_recognition_check((SELECT "sourceId" FROM public."FinanceJournalEntry" WHERE id=NEW."journalId" AND "sourceType"=''RECOGNITION''));RETURN NULL;END IF;END IF;\n');EXECUTE definition;
END $$;
CREATE FUNCTION encova_finance_recognition_emit(actor UUID,target UUID,reversed BOOLEAN,reverse_day DATE DEFAULT NULL) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r public."FinanceRecognition"%ROWTYPE;l public."FinanceInvoiceLine"%ROWTYPE;i public."FinanceInvoice"%ROWTYPE;entry UUID:=gen_random_uuid();period_id UUID;day DATE;BEGIN
 SELECT * INTO r FROM public."FinanceRecognition" WHERE id=target FOR UPDATE;SELECT * INTO l FROM public."FinanceInvoiceLine" WHERE id=r."invoiceLineId" FOR UPDATE;SELECT * INTO i FROM public."FinanceInvoice" WHERE id=l."invoiceId";
 day:=CASE WHEN reversed THEN reverse_day ELSE r."postingDate" END;PERFORM public.encova_finance_close_assert_open(day);
 IF i.state<>'POSTED' OR l.recognition<>'DEFERRED' OR day<i."postingDate" OR day>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date OR NOT reversed AND r.amount>public.encova_finance_deferred_capacity(l.id,day) THEN RAISE EXCEPTION 'FINANCE_RECOGNITION_CAPACITY' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=l."deferredAccountId" AND active AND "isPosting" AND "controlType"='DEFERRED_REVENUE' AND type='LIABILITY' AND NOT "isContra") OR NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=l."revenueAccountId" AND active AND "isPosting" AND "controlType"='NONE' AND type IN('INCOME','OTHER_INCOME') AND NOT "isContra") THEN RAISE EXCEPTION 'FINANCE_AUTOMATION_MAPPING' USING ERRCODE='P0001';END IF;
 SELECT id INTO period_id FROM public."FinancePeriod" WHERE state='OPEN' AND day BETWEEN "startDate" AND "endDate" FOR UPDATE;IF period_id IS NULL THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 -- Caller establishes the complete immutable state before entry insertion; deferred checks require the exact journal/event at transaction end.
 IF reversed THEN UPDATE public."FinanceRecognition" SET state='REVERSED',version=version+1,"reversalJournalId"=entry,"reversedById"=actor,"reversalDate"=day WHERE id=target RETURNING * INTO r;
 ELSE UPDATE public."FinanceRecognition" SET state='POSTED',version=version+1,"journalId"=entry,"postedById"=actor,"postedAt"=CURRENT_TIMESTAMP WHERE id=target RETURNING * INTO r;END IF;
 INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","reversalOfId","periodId","postingDate",description,evidence,currency,"postedById") VALUES(entry,'REC-'||entry::text,'RECOGNITION',r.id,CASE WHEN reversed THEN 'REVERSE' ELSE 'POST' END,CASE WHEN reversed THEN r."journalId" END,period_id,day,r.description,r.evidence,'PKR',actor);
 INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId") SELECT gen_random_uuid(),entry,x.* FROM public.encova_finance_recognition_lines(r.id,reversed)x;
 INSERT INTO public."FinanceDeferredRevenueEvent"(id,"invoiceLineId","journalId","effectiveDate",kind,amount) VALUES(gen_random_uuid(),l.id,entry,day,CASE WHEN reversed THEN 'RECOGNITION_REVERSAL' ELSE 'RECOGNIZED' END,CASE WHEN reversed THEN r.amount ELSE -r.amount END);
 PERFORM public.encova_finance_recognition_check(r.id);RETURN entry;
END $$;

CREATE TABLE "FinanceOpeningCreditReview"(
 id UUID PRIMARY KEY,"customerDocumentId" UUID REFERENCES "FinanceCustomerDocument" ON DELETE RESTRICT,"supplierDocumentId" UUID REFERENCES "FinanceSupplierDocument" ON DELETE RESTRICT,"offsetAccountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,"basisHash" TEXT NOT NULL CHECK("basisHash" ~ '^[a-f0-9]{64}$'),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK(("customerDocumentId" IS NOT NULL)<>("supplierDocumentId" IS NOT NULL)),UNIQUE("customerDocumentId","basisHash"),UNIQUE("supplierDocumentId","basisHash")
);
CREATE TRIGGER "FinanceOpeningCreditReview_immutable" BEFORE UPDATE OR DELETE ON "FinanceOpeningCreditReview" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
CREATE TRIGGER "FinanceOpeningCreditReview_config" BEFORE INSERT ON "FinanceOpeningCreditReview" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE FUNCTION encova_finance_opening_credit_basis(side TEXT,target UUID) RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE source JSONB;lines JSONB;split JSONB;BEGIN
 IF side='CUSTOMER' THEN
  SELECT to_jsonb(d)-ARRAY['state','version','createdAt','updatedAt','postedAt','postedById','partySnapshot'] INTO source FROM public."FinanceCustomerDocument" d WHERE id=target;
  SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.sequence),'[]') INTO lines FROM public."FinanceCustomerCreditLine" l WHERE l."documentId"=target;
  SELECT to_jsonb(s) INTO split FROM public."FinanceCustomerCreditSplit" s WHERE "documentId"=target;
 ELSE
  SELECT to_jsonb(d)-ARRAY['state','version','createdAt','updatedAt','postedAt','postedById','partySnapshot'] INTO source FROM public."FinanceSupplierDocument" d WHERE id=target;
  SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.sequence),'[]') INTO lines FROM public."FinanceSupplierCreditLine" l WHERE l."documentId"=target;
  SELECT to_jsonb(s) INTO split FROM public."FinanceSupplierCreditSplit" s WHERE "documentId"=target;
 END IF;
 RETURN encode(sha256(convert_to(jsonb_build_object('source',source,'lines',lines)::text,'UTF8')),'hex');
END $$;
CREATE FUNCTION encova_finance_opening_credit_offset(side TEXT,target UUID) RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT "offsetAccountId" FROM public."FinanceOpeningCreditReview" WHERE CASE side WHEN 'CUSTOMER' THEN "customerDocumentId" ELSE "supplierDocumentId" END=target AND "basisHash"=public.encova_finance_opening_credit_basis(side,target) $$;
-- A credit against an imported unpaid item is a reviewed opening-equity correction, not a current-period sale/cost or a reopening of clearing.
DO $$ DECLARE definition TEXT;BEGIN
 SELECT pg_get_functiondef('public.encova_finance_customer_lines(uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,'WHEN l.recognition=''EARNED'' THEN l."revenueAccountId"','WHEN l.recognition=''EARNED'' THEN coalesce(public.encova_finance_opening_credit_offset(''CUSTOMER'',d.id),l."revenueAccountId")');EXECUTE definition;
 SELECT pg_get_functiondef('public.encova_finance_supplier_lines(uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,'10+c.sequence,l."costAccountId",','10+c.sequence,coalesce(public.encova_finance_opening_credit_offset(''SUPPLIER'',d.id),l."costAccountId"),');EXECUTE definition;
 SELECT pg_get_functiondef('public.encova_finance_customer_validate(uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,' IF d.kind=''RECEIPT'' THEN',' IF d.kind=''CUSTOMER_CREDIT'' AND EXISTS(SELECT 1 FROM public."FinanceOpeningLine" WHERE id=d."creditInvoiceId" AND kind=''AR'') AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=public.encova_finance_opening_credit_offset(''CUSTOMER'',d.id) AND active AND "isPosting" AND "controlType"=''NONE'' AND type=''EQUITY'' AND NOT "isContra" AND NOT "isCashEquivalent") THEN RAISE EXCEPTION ''FINANCE_OPENING_CREDIT_REVIEW'' USING ERRCODE=''P0001'';END IF; IF d.kind=''RECEIPT'' THEN');EXECUTE definition;
 SELECT pg_get_functiondef('public.encova_finance_supplier_validate(uuid)'::regprocedure) INTO definition;
 definition:=replace(definition,' IF d.kind=''PAYMENT'' THEN',' IF d.kind=''SUPPLIER_CREDIT'' AND EXISTS(SELECT 1 FROM public."FinanceOpeningLine" WHERE id=d."creditBillId" AND kind=''AP'') AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=public.encova_finance_opening_credit_offset(''SUPPLIER'',d.id) AND active AND "isPosting" AND "controlType"=''NONE'' AND type=''EQUITY'' AND NOT "isContra" AND NOT "isCashEquivalent") THEN RAISE EXCEPTION ''FINANCE_OPENING_CREDIT_REVIEW'' USING ERRCODE=''P0001'';END IF; IF d.kind=''PAYMENT'' THEN');EXECUTE definition;
END $$;

CREATE FUNCTION encova_finance_automation_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE receipt public."FinanceLedgerReceipt"%ROWTYPE;s public."FinanceRecurringSchedule"%ROWTYPE;r public."FinanceRecurringRun"%ROWTYPE;n public."FinanceRecognition"%ROWTYPE;grant_id UUID;digest TEXT;result JSONB;entry UUID;reason TEXT;doc JSONB;review_id UUID;BEGIN
 IF action IS NULL OR action NOT IN('CREATE','PAUSE','RESUME','PREPARE','RETRY','RECOGNITION_CREATE','RECOGNITION_POST','RECOGNITION_VOID','RECOGNITION_REVERSE','OPENING_CREDIT_REVIEW') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 reason:=trim(input->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF input-(CASE action WHEN 'CREATE' THEN ARRAY['name','kind','template','startMonth','endMonth','day','evidence','reason'] WHEN 'PREPARE' THEN ARRAY['reason'] WHEN 'RECOGNITION_CREATE' THEN ARRAY['invoiceLineId','postingDate','amount','description','evidence','reason'] WHEN 'OPENING_CREDIT_REVIEW' THEN ARRAY['side','documentId','expectedVersion','offsetAccountId','evidence','reason'] WHEN 'RECOGNITION_REVERSE' THEN ARRAY['id','expectedVersion','postingDate','reason'] ELSE ARRAY['id','expectedVersion','reason'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 SELECT id INTO grant_id FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL;
 IF grant_id IS NULL OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT public.encova_finance_automation_access(actor,grant_id) THEN RAISE EXCEPTION 'FINANCE_OWNER_REQUIRED' USING ERRCODE='P0001';END IF;
 digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');SELECT * INTO receipt FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation='AUTOMATION_'||action AND key=request_key;
 IF FOUND THEN IF receipt."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN receipt.result;END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action='CREATE' THEN
  PERFORM public.encova_finance_automation_template(input->>'kind',input->'template');
  IF jsonb_typeof(input->'day') IS DISTINCT FROM 'number' OR (input->>'day')::numeric<>trunc((input->>'day')::numeric) OR input->>'startMonth' IS NULL OR length(input->>'startMonth')<>7 OR(input->>'startMonth'||'-01')::date<DATE '0001-01-01' OR input->>'name' IS NULL OR input->>'evidence' IS NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinanceRecurringSchedule"(id,name,kind,template,"startMonth","endMonth",day,evidence,"createdById","grantId") VALUES(gen_random_uuid(),trim(input->>'name'),input->>'kind',input->'template',input->>'startMonth',input->>'endMonth',(input->>'day')::integer,trim(input->>'evidence'),actor,grant_id) RETURNING * INTO s;
  result:=jsonb_build_object('id',s.id,'version',s.version,'state','ACTIVE');
 ELSIF action IN('PAUSE','RESUME') THEN
  SELECT * INTO s FROM public."FinanceRecurringSchedule" WHERE id=(input->>'id')::uuid FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR s.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF s.active=(action='RESUME') THEN RAISE EXCEPTION 'FINANCE_AUTOMATION_STATE' USING ERRCODE='P0001';END IF;
  UPDATE public."FinanceRecurringSchedule" SET active=(action='RESUME'),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=s.id RETURNING * INTO s;
  -- Resume keeps the original grant epoch. Revoked schedules cannot be resurrected through a later grant or ownership transfer.
  IF action='RESUME' AND NOT public.encova_finance_automation_access(s."createdById",s."grantId") THEN RAISE EXCEPTION 'FINANCE_AUTOMATION_REVOKED' USING ERRCODE='P0001';END IF;
  result:=jsonb_build_object('id',s.id,'version',s.version,'state',CASE WHEN s.active THEN 'ACTIVE' ELSE 'PAUSED' END);
 ELSIF action='PREPARE' THEN
  result:=jsonb_build_object('id',actor,'version',1,'queued',public.encova_finance_automation_enqueue());
 ELSIF action='RETRY' THEN
  SELECT * INTO r FROM public."FinanceRecurringRun" WHERE id=(input->>'id')::uuid FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR r.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF r.state<>'FAILED' OR r.attempts>=9 OR NOT public.encova_finance_automation_access(r."requesterId",r."grantId") OR NOT EXISTS(SELECT 1 FROM public."FinanceRecurringSchedule" WHERE id=r."scheduleId" AND active) THEN RAISE EXCEPTION 'FINANCE_AUTOMATION_STATE' USING ERRCODE='P0001';END IF;
  UPDATE public."FinanceRecurringRun" SET state='QUEUED',version=version+1,budget=least(9,greatest(budget,((attempts/3)+1)*3)),"errorCode"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE id=r.id RETURNING * INTO r;
  result:=jsonb_build_object('id',r.id,'version',r.version,'state',r.state);
 ELSIF action='OPENING_CREDIT_REVIEW' THEN
  IF input->>'side'='CUSTOMER' THEN
   SELECT to_jsonb(d) INTO doc FROM public."FinanceCustomerDocument" d WHERE d.id=(input->>'documentId')::uuid AND kind='CUSTOMER_CREDIT' AND EXISTS(SELECT 1 FROM public."FinanceOpeningLine" WHERE id=d."creditInvoiceId" AND kind='AR') FOR UPDATE;
  ELSIF input->>'side'='SUPPLIER' THEN
   SELECT to_jsonb(d) INTO doc FROM public."FinanceSupplierDocument" d WHERE d.id=(input->>'documentId')::uuid AND kind='SUPPLIER_CREDIT' AND EXISTS(SELECT 1 FROM public."FinanceOpeningLine" WHERE id=d."creditBillId" AND kind='AP') FOR UPDATE;
  ELSE RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF doc IS NULL OR doc->>'state'<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_AUTOMATION_STATE' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR doc->>'version' IS DISTINCT FROM input->>'expectedVersion' THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=(input->>'offsetAccountId')::uuid AND active AND "isPosting" AND "controlType"='NONE' AND type='EQUITY' AND NOT "isContra" AND NOT "isCashEquivalent") THEN RAISE EXCEPTION 'FINANCE_AUTOMATION_MAPPING' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinanceOpeningCreditReview"(id,"customerDocumentId","supplierDocumentId","offsetAccountId","basisHash",evidence,"createdById") VALUES(gen_random_uuid(),CASE WHEN input->>'side'='CUSTOMER' THEN (input->>'documentId')::uuid END,CASE WHEN input->>'side'='SUPPLIER' THEN (input->>'documentId')::uuid END,(input->>'offsetAccountId')::uuid,public.encova_finance_opening_credit_basis(input->>'side',(input->>'documentId')::uuid),trim(input->>'evidence'),actor) RETURNING id INTO review_id;
  result:=jsonb_build_object('id',(input->>'documentId')::uuid,'version',(input->>'expectedVersion')::integer,'reviewId',review_id);
 ELSIF action='RECOGNITION_CREATE' THEN
  IF jsonb_typeof(input->'amount') IS DISTINCT FROM 'string' OR input->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR NOT EXISTS(SELECT 1 FROM public."FinanceInvoiceLine" l JOIN public."FinanceInvoice" i ON i.id=l."invoiceId" WHERE l.id=(input->>'invoiceLineId')::uuid AND l.recognition='DEFERRED' AND i.state='POSTED' AND (input->>'postingDate')::date>=i."postingDate") THEN RAISE EXCEPTION 'FINANCE_RECOGNITION_CAPACITY' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinanceRecognition"(id,"invoiceLineId","postingDate",amount,description,evidence,"createdById") VALUES(gen_random_uuid(),(input->>'invoiceLineId')::uuid,(input->>'postingDate')::date,(input->>'amount')::numeric,trim(input->>'description'),trim(input->>'evidence'),actor) RETURNING * INTO n;
  result:=jsonb_build_object('id',n.id,'version',n.version,'state',n.state);
 ELSE
  SELECT * INTO n FROM public."FinanceRecognition" WHERE id=(input->>'id')::uuid FOR UPDATE;
  IF n.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR n.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF action='RECOGNITION_REVERSE' THEN
   IF n.state<>'POSTED' OR (input->>'postingDate')::date<n."postingDate" THEN RAISE EXCEPTION 'FINANCE_AUTOMATION_STATE' USING ERRCODE='P0001';END IF;
   entry:=public.encova_finance_recognition_emit(actor,n.id,true,(input->>'postingDate')::date);
  ELSE
   IF n.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_AUTOMATION_STATE' USING ERRCODE='P0001';END IF;
   IF action='RECOGNITION_VOID' THEN UPDATE public."FinanceRecognition" SET state='VOIDED',version=version+1 WHERE id=n.id;
   ELSE entry:=public.encova_finance_recognition_emit(actor,n.id,false,NULL);END IF;
  END IF;
  SELECT * INTO n FROM public."FinanceRecognition" WHERE id=n.id;result:=jsonb_build_object('id',n.id,'version',n.version,'state',n.state,'journalId',entry);
 END IF;
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,'AUTOMATION_'||action,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_AUTOMATION_'||action,CASE WHEN action LIKE 'RECOGNITION_%' THEN 'FinanceRecognition' WHEN action='RETRY' THEN 'FinanceRecurringRun' ELSE 'FinanceRecurringSchedule' END,(result->>'id')::uuid,reason,jsonb_build_object('result',result,'input',input),request_id);
 RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001'; WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;

CREATE FUNCTION encova_finance_automation_read(actor UUID,mode TEXT,input JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE items JSONB;total INTEGER;pages INTEGER;page INTEGER:=coalesce((input->>'page')::integer,1);can_manage BOOLEAN;s public."FinanceRecurringSchedule"%ROWTYPE;r public."FinanceRecurringRun"%ROWTYPE;n public."FinanceRecognition"%ROWTYPE;doc JSONB;is_opening BOOLEAN;review JSONB;BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."Person" p JOIN public."FinanceGrant" g ON g."userId"=p.id WHERE p.id=actor AND p.status='ACTIVE' AND p.role='SUPER_ADMIN' AND g."revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 can_manage:=EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=actor);
 IF input IS NULL OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['id','page','asOf','q','side']<>'{}'::jsonb OR page NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF mode IN('SCHEDULES','RUNS','RECOGNITIONS') THEN
  IF mode='SCHEDULES' THEN SELECT count(*) INTO total FROM public."FinanceRecurringSchedule";
  ELSIF mode='RUNS' THEN SELECT count(*) INTO total FROM public."FinanceRecurringRun";
  ELSE SELECT count(*) INTO total FROM public."FinanceRecognition";END IF;
  pages:=greatest(1,ceil(total/25.0)::integer);page:=least(page,pages);
  IF mode='SCHEDULES' THEN SELECT coalesce(jsonb_agg(to_jsonb(x)-'grantId' ORDER BY x."createdAt" DESC,x.id),'[]') INTO items FROM(SELECT * FROM public."FinanceRecurringSchedule" ORDER BY "createdAt" DESC,id LIMIT 25 OFFSET(page-1)*25)x;
  ELSIF mode='RUNS' THEN SELECT coalesce(jsonb_agg(to_jsonb(x)-'grantId'-'leaseId'-'leaseUntil' ORDER BY x."createdAt" DESC,x.id),'[]') INTO items FROM(SELECT run_row.*,cfg.name,cfg.kind FROM public."FinanceRecurringRun" run_row JOIN public."FinanceRecurringSchedule" cfg ON cfg.id=run_row."scheduleId" ORDER BY run_row."createdAt" DESC,run_row.id LIMIT 25 OFFSET(page-1)*25)x;
  ELSE SELECT coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('amount',x.amount::text) ORDER BY x."createdAt" DESC,x.id),'[]') INTO items FROM(SELECT * FROM public."FinanceRecognition" ORDER BY "createdAt" DESC,id LIMIT 25 OFFSET(page-1)*25)x;END IF;
  RETURN jsonb_build_object('items',items,'total',total,'page',page,'pages',pages,'canManage',can_manage);
 ELSIF mode='SCHEDULE' THEN
  SELECT * INTO s FROM public."FinanceRecurringSchedule" WHERE id=(input->>'id')::uuid;IF s.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  SELECT count(*) INTO total FROM public."FinanceRecurringRun" WHERE "scheduleId"=s.id;pages:=greatest(1,ceil(total/25.0)::integer);page:=least(page,pages);
  SELECT coalesce(jsonb_agg(to_jsonb(x)-'grantId'-'leaseId'-'leaseUntil' ORDER BY x.month DESC,x.id),'[]') INTO items FROM(SELECT * FROM public."FinanceRecurringRun" WHERE "scheduleId"=s.id ORDER BY month DESC,id LIMIT 25 OFFSET(page-1)*25)x;
  RETURN jsonb_build_object('schedule',to_jsonb(s)-'grantId','items',items,'total',total,'page',page,'pages',pages,'canManage',can_manage);
 ELSIF mode='RUN' THEN
  SELECT * INTO r FROM public."FinanceRecurringRun" WHERE id=(input->>'id')::uuid;IF r.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x)-'leaseId' ORDER BY x.attempt),'[]') INTO items FROM(SELECT * FROM public."FinanceRecurringAttempt" WHERE "runId"=r.id ORDER BY attempt LIMIT 9)x;
  RETURN jsonb_build_object('run',to_jsonb(r)-'grantId'-'leaseId'-'leaseUntil','attempts',items,'canManage',can_manage);
 ELSIF mode='RECOGNITION' THEN
  SELECT * INTO n FROM public."FinanceRecognition" WHERE id=(input->>'id')::uuid;IF n.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  RETURN jsonb_build_object('item',to_jsonb(n)||jsonb_build_object('amount',n.amount::text),'remainingDeferred',(public.encova_finance_deferred_capacity(n."invoiceLineId",n."postingDate"))::text,'canManage',can_manage);
 ELSIF mode='CREDIT_STATUS' THEN
  IF input->>'side'='CUSTOMER' THEN
   SELECT to_jsonb(d),EXISTS(SELECT 1 FROM public."FinanceOpeningLine" WHERE id=d."creditInvoiceId" AND kind='AR') INTO doc,is_opening FROM public."FinanceCustomerDocument" d WHERE id=(input->>'id')::uuid AND kind='CUSTOMER_CREDIT';
  ELSIF input->>'side'='SUPPLIER' THEN
   SELECT to_jsonb(d),EXISTS(SELECT 1 FROM public."FinanceOpeningLine" WHERE id=d."creditBillId" AND kind='AP') INTO doc,is_opening FROM public."FinanceSupplierDocument" d WHERE id=(input->>'id')::uuid AND kind='SUPPLIER_CREDIT';
  ELSE RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF doc IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  SELECT to_jsonb(v) INTO review FROM public."FinanceOpeningCreditReview" v WHERE CASE WHEN input->>'side'='CUSTOMER' THEN v."customerDocumentId" ELSE v."supplierDocumentId" END=(input->>'id')::uuid AND v."basisHash"=public.encova_finance_opening_credit_basis(input->>'side',(input->>'id')::uuid);
  RETURN jsonb_build_object('required',is_opening,'version',(doc->>'version')::integer,'state',doc->>'state','review',review,'canManage',can_manage);
 ELSIF mode='CREDIT_REVIEWS' THEN
  SELECT count(*) INTO total FROM public."FinanceOpeningCreditReview";pages:=greatest(1,ceil(total/25.0)::integer);page:=least(page,pages);
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."createdAt" DESC,x.id),'[]') INTO items FROM(SELECT * FROM public."FinanceOpeningCreditReview" ORDER BY "createdAt" DESC,id LIMIT 25 OFFSET(page-1)*25)x;
  RETURN jsonb_build_object('items',items,'total',total,'page',page,'pages',pages,'canManage',can_manage);
 ELSIF mode='EQUITY_OPTIONS' THEN
  IF length(coalesce(input->>'q',''))>100 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  SELECT count(*) INTO total FROM public."FinanceAccount" WHERE active AND "isPosting" AND type='EQUITY' AND "controlType"='NONE' AND NOT "isContra" AND NOT "isCashEquivalent" AND concat_ws(' ',code,name) ILIKE '%'||coalesce(input->>'q','')||'%';pages:=greatest(1,ceil(total/25.0)::integer);page:=least(page,pages);
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.tag,x.id),'[]') INTO items FROM(SELECT id,code AS tag,name AS description FROM public."FinanceAccount" WHERE active AND "isPosting" AND type='EQUITY' AND "controlType"='NONE' AND NOT "isContra" AND NOT "isCashEquivalent" AND concat_ws(' ',code,name) ILIKE '%'||coalesce(input->>'q','')||'%' ORDER BY code,id LIMIT 25 OFFSET(page-1)*25)x;
  RETURN jsonb_build_object('items',items,'total',total,'page',page,'pages',pages,'canManage',can_manage);
 ELSIF mode='ASSET_OPTIONS' THEN
  IF length(coalesce(input->>'q',''))>100 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  SELECT count(*) INTO total FROM public."FinanceAsset" WHERE state='REGISTERED' AND concat_ws(' ',tag,description) ILIKE '%'||coalesce(input->>'q','')||'%';pages:=greatest(1,ceil(total/25.0)::integer);page:=least(page,pages);
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.tag,x.id),'[]') INTO items FROM(SELECT id,tag,description FROM public."FinanceAsset" WHERE state='REGISTERED' AND concat_ws(' ',tag,description) ILIKE '%'||coalesce(input->>'q','')||'%' ORDER BY tag,id LIMIT 25 OFFSET(page-1)*25)x;
  RETURN jsonb_build_object('items',items,'total',total,'page',page,'pages',pages,'canManage',can_manage);
 ELSIF mode='DEFERRED_OPTIONS' THEN
  IF input->>'asOf' IS NULL OR length(coalesce(input->>'q',''))>100 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  WITH options AS MATERIALIZED(SELECT l.id,i.number,i.reference,l.description,l."deferredAccountId",l."revenueAccountId",public.encova_finance_deferred_capacity(l.id,(input->>'asOf')::date) AS balance FROM public."FinanceInvoiceLine" l JOIN public."FinanceInvoice" i ON i.id=l."invoiceId" WHERE i.state='POSTED' AND l.recognition='DEFERRED' AND i."postingDate"<=(input->>'asOf')::date AND concat_ws(' ',i.number,i.reference,l.description) ILIKE '%'||coalesce(input->>'q','')||'%'),ready AS(SELECT * FROM options WHERE balance>0),counts AS(SELECT count(*)::integer AS total,greatest(1,ceil(count(*)/25.0)::integer) AS pages FROM ready),paging AS(SELECT counts.*,least(page,counts.pages) AS page FROM counts),bounded AS(SELECT * FROM ready ORDER BY number,id LIMIT 25 OFFSET((SELECT paging.page FROM paging)-1)*25) SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(b)||jsonb_build_object('balance',b.balance::text) ORDER BY number,id) FROM bounded b),'[]'),'total',p.total,'page',p.page,'pages',p.pages,'canManage',can_manage) INTO items FROM paging p;RETURN items;
 END IF;RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;
CREATE FUNCTION encova_finance_automation_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_AUTOMATION_RETAINED' USING ERRCODE='P0001';END IF;
 IF TG_TABLE_NAME='FinanceRecurringSchedule' THEN
  IF TG_OP='UPDATE' AND(ROW(NEW.id,NEW.name,NEW.kind,NEW.template,NEW."startMonth",NEW."endMonth",NEW.day,NEW.evidence,NEW."createdById",NEW."grantId",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD.name,OLD.kind,OLD.template,OLD."startMonth",OLD."endMonth",OLD.day,OLD.evidence,OLD."createdById",OLD."grantId",OLD."createdAt") OR NEW.version<>OLD.version+1 OR NEW.active=OLD.active) THEN RAISE EXCEPTION 'FINANCE_AUTOMATION_RETAINED' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_automation_template(NEW.kind,NEW.template);
 ELSIF TG_TABLE_NAME='FinanceRecurringRun' AND TG_OP='UPDATE' THEN
  IF OLD.state IN('READY','CANCELLED') OR ROW(NEW.id,NEW."scheduleId",NEW.month,NEW."postingDate",NEW."requesterId",NEW."grantId",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."scheduleId",OLD.month,OLD."postingDate",OLD."requesterId",OLD."grantId",OLD."createdAt") OR NEW.version<>OLD.version+1 OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 OR NEW.budget<OLD.budget THEN RAISE EXCEPTION 'FINANCE_AUTOMATION_RETAINED' USING ERRCODE='P0001';END IF;
 ELSIF TG_TABLE_NAME='FinanceRecurringAttempt' AND TG_OP='UPDATE' THEN
  IF OLD.outcome<>'RUNNING' OR NEW.outcome='RUNNING' OR ROW(NEW.id,NEW."runId",NEW.attempt,NEW."leaseId",NEW."startedAt") IS DISTINCT FROM ROW(OLD.id,OLD."runId",OLD.attempt,OLD."leaseId",OLD."startedAt") THEN RAISE EXCEPTION 'FINANCE_AUTOMATION_RETAINED' USING ERRCODE='P0001';END IF;
 END IF;RETURN NEW;
END $$;
DO $$ DECLARE t TEXT;BEGIN FOREACH t IN ARRAY ARRAY['FinanceRecurringSchedule','FinanceRecurringRun','FinanceRecurringAttempt'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.encova_finance_config_lock()',t||'_config',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.encova_finance_automation_guard()',t||'_guard',t);
 END LOOP;
END $$;
DO $$ DECLARE t TEXT;r TEXT;f RECORD;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceRecurringSchedule','FinanceRecurringRun','FinanceRecurringAttempt','FinanceRecognition','FinanceOpeningCreditReview'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);IF r='encova_app' THEN EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);END IF;END IF;END LOOP;
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND(p.proname LIKE 'encova_finance_automation_%' OR p.proname LIKE 'encova_finance_recognition_%' OR p.proname LIKE 'encova_finance_opening_credit_%' OR p.proname IN('encova_finance_ledger_core','encova_finance_bill_core','encova_finance_asset_movement_core')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);FOREACH r IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION public.encova_finance_automation_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID),public.encova_finance_automation_read(UUID,TEXT,JSONB),public.encova_finance_automation_enqueue(),public.encova_finance_automation_candidates(),public.encova_finance_automation_claim(UUID),public.encova_finance_automation_finish(UUID,UUID) TO encova_app;END IF;
END $$;
COMMIT;
