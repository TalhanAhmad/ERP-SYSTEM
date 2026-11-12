BEGIN;
-- Keep exact amounts as decimal strings even in immutable revision snapshots.
CREATE OR REPLACE FUNCTION encova_finance_ledger_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE draft public."FinanceJournalDraft"%ROWTYPE; original public."FinanceJournalEntry"%ROWTYPE; receipt public."FinanceLedgerReceipt"%ROWTYPE;
 period_id UUID; entry_id UUID; target UUID; line JSONB; position INTEGER:=0; result JSONB; digest TEXT; reason TEXT; item JSONB;
BEGIN
 IF action IS NULL OR action NOT IN ('CREATE','UPDATE','POST','VOID','REVERSE','BULK_VOID') OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001'; END IF;
 IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 reason:=trim(input->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 IF input - (CASE WHEN action='CREATE' THEN ARRAY['reference','description','evidence','postingDate','currency','lines','reason'] WHEN action='UPDATE' THEN ARRAY['id','expectedVersion','reference','description','evidence','postingDate','currency','lines','reason'] WHEN action='REVERSE' THEN ARRAY['id','expectedVersion','postingDate','reason'] WHEN action='BULK_VOID' THEN ARRAY['items','reason'] ELSE ARRAY['id','expectedVersion','reason'] END) <> '{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001'; END IF;
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
   IF draft.id IS NULL OR draft.state<>'DRAFT' OR draft.version<>(item->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001'; END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(input->'items') ORDER BY value->>'id' LOOP
   UPDATE public."FinanceJournalDraft" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=(item->>'id')::uuid;
   INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_JOURNAL_VOID','FinanceJournalDraft',(item->>'id')::uuid,reason,jsonb_build_object('snapshot',(SELECT to_jsonb(d) FROM public."FinanceJournalDraft" d WHERE d.id=(item->>'id')::uuid),'lines',(SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('debit',l.debit::text,'credit',l.credit::text) ORDER BY sequence) FROM public."FinanceJournalDraftLine" l WHERE l."draftId"=(item->>'id')::uuid)),request_id);
  END LOOP;
  result:=jsonb_build_object('ids',input->'items','id',(input->'items'->0->>'id')::uuid);
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
    SELECT id INTO period_id FROM public."FinancePeriod" WHERE state='OPEN' AND draft."postingDate" BETWEEN "startDate" AND "endDate" FOR UPDATE;
    IF period_id IS NULL THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
    entry_id:=gen_random_uuid();
    INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","draftId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'JOURNAL_DRAFT',draft.id,'POST',draft.id,draft."postingDate",period_id,draft.description,draft.evidence,actor);
    INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId") SELECT gen_random_uuid(),entry_id,sequence,"accountId",description,debit,credit,"projectId" FROM public."FinanceJournalDraftLine" WHERE "draftId"=draft.id ORDER BY "accountId",sequence;
    UPDATE public."FinanceJournalDraft" SET state='POSTED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=draft.id RETURNING * INTO draft;
   ELSE
    SELECT * INTO original FROM public."FinanceJournalEntry" WHERE "draftId"=draft.id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public."FinanceJournalEntry" WHERE "reversalOfId"=original.id) OR input->>'postingDate' IS NULL OR input->>'postingDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001'; END IF;
    SELECT id INTO period_id FROM public."FinancePeriod" WHERE state='OPEN' AND (input->>'postingDate')::date BETWEEN "startDate" AND "endDate" FOR UPDATE;
    IF period_id IS NULL THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
    entry_id:=gen_random_uuid();
    INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","postingDate","periodId",description,evidence,"postedById","reversalOfId") VALUES(entry_id,'JRN-'||entry_id::text,'JOURNAL_REVERSAL',original.id,'REVERSE',(input->>'postingDate')::date,period_id,original.description,reason,actor,original.id);
    INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId") SELECT gen_random_uuid(),entry_id,sequence,"accountId",description,credit,debit,"projectId" FROM public."FinanceJournalLine" WHERE "journalId"=original.id ORDER BY "accountId",sequence;
   END IF;
  END IF;
  result:=jsonb_build_object('id',draft.id,'version',draft.version,'journalId',entry_id);
  INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_JOURNAL_'||action,'FinanceJournalDraft',draft.id,reason,jsonb_build_object('version',draft.version,'journalId',entry_id,'snapshot',to_jsonb(draft),'lines',(SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('debit',l.debit::text,'credit',l.credit::text) ORDER BY sequence) FROM public."FinanceJournalDraftLine" l WHERE l."draftId"=draft.id)),request_id);
 END IF;
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,action,request_key,digest,result);
 RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';
 WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;


COMMIT;
