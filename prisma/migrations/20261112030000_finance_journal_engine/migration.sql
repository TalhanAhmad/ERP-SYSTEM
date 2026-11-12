BEGIN;
-- Empty ledger foundation; no real chart, period, balances or financial examples.
CREATE TABLE "FinanceJournalDraft" (
 id UUID PRIMARY KEY,reference TEXT NOT NULL UNIQUE CHECK(length(trim(reference)) BETWEEN 1 AND 80),
 description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 1000),
 evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),
 "postingDate" DATE NOT NULL CHECK("postingDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','POSTED','VOIDED')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FinanceJournalDraft_state_postingDate_id_idx" ON "FinanceJournalDraft"(state,"postingDate",id);
CREATE TABLE "FinanceJournalDraftLine" (
 id UUID PRIMARY KEY,"draftId" UUID NOT NULL REFERENCES "FinanceJournalDraft" ON DELETE RESTRICT,
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 200),"accountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,
 description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 500),debit NUMERIC(20,2) NOT NULL,credit NUMERIC(20,2) NOT NULL,
 "projectId" UUID REFERENCES "Project" ON DELETE RESTRICT,
 CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)),UNIQUE("draftId",sequence)
);
CREATE TABLE "FinanceJournalEntry" (
 id UUID PRIMARY KEY,reference TEXT NOT NULL UNIQUE,"sourceType" TEXT NOT NULL,"sourceId" UUID NOT NULL,"sourceAction" TEXT NOT NULL,
 "draftId" UUID UNIQUE REFERENCES "FinanceJournalDraft" ON DELETE RESTRICT,"postingDate" DATE NOT NULL,
 "periodId" UUID NOT NULL REFERENCES "FinancePeriod" ON DELETE RESTRICT,
 description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 1000),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),
 currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),"postedById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,
 "postedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"reversalOfId" UUID UNIQUE REFERENCES "FinanceJournalEntry" ON DELETE RESTRICT,
 CHECK(("sourceType"='JOURNAL_DRAFT' AND "sourceAction"='POST' AND "draftId"="sourceId" AND "draftId" IS NOT NULL AND "reversalOfId" IS NULL) OR
 ("sourceType"='JOURNAL_REVERSAL' AND "sourceAction"='REVERSE' AND "reversalOfId"="sourceId" AND "reversalOfId" IS NOT NULL AND "draftId" IS NULL)),
 UNIQUE("sourceType","sourceId","sourceAction")
);
CREATE INDEX "FinanceJournalEntry_postingDate_id_idx" ON "FinanceJournalEntry"("postingDate",id);
CREATE TABLE "FinanceJournalLine" (
 id UUID PRIMARY KEY,"journalId" UUID NOT NULL REFERENCES "FinanceJournalEntry" ON DELETE RESTRICT,
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 200),"accountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,
 description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 500),debit NUMERIC(20,2) NOT NULL,credit NUMERIC(20,2) NOT NULL,
 "projectId" UUID REFERENCES "Project" ON DELETE RESTRICT,
 CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)),UNIQUE("journalId",sequence)
);
CREATE INDEX "FinanceJournalLine_accountId_journalId_idx" ON "FinanceJournalLine"("accountId","journalId");
CREATE TABLE "FinanceLedgerReceipt" (
 id UUID PRIMARY KEY,"actorId" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,operation TEXT NOT NULL,key TEXT NOT NULL CHECK(length(key) BETWEEN 8 AND 128),
 "requestHash" TEXT NOT NULL,result JSONB NOT NULL,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("actorId",operation,key)
);
CREATE TRIGGER "FinanceLedgerReceipt_immutable" BEFORE UPDATE OR DELETE ON "FinanceLedgerReceipt" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
CREATE TRIGGER "FinanceJournalEntry_immutable" BEFORE UPDATE OR DELETE ON "FinanceJournalEntry" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
CREATE TRIGGER "FinanceJournalLine_immutable" BEFORE UPDATE OR DELETE ON "FinanceJournalLine" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
-- All ledger/config writers share the structural lock BEFORE row locks. This
-- intentionally serializes the initial core. Do not reverse this order later.
CREATE TRIGGER "FinanceJournalEntry_config_lock" BEFORE INSERT ON "FinanceJournalEntry" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceJournalLine_config_lock" BEFORE INSERT ON "FinanceJournalLine" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceJournalDraft_config_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceJournalDraft" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceJournalDraftLine_config_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceJournalDraftLine" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE FUNCTION encova_finance_draft_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_DRAFT_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF NEW.id<>OLD.id OR NEW."createdById"<>OLD."createdById" OR NEW."createdAt"<>OLD."createdAt" OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001'; END IF;
 IF NEW.state='POSTED' AND NOT EXISTS(SELECT 1 FROM public."FinanceJournalEntry" WHERE "draftId"=NEW.id) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FinanceJournalDraft_guard" BEFORE UPDATE OR DELETE ON "FinanceJournalDraft" FOR EACH ROW EXECUTE FUNCTION encova_finance_draft_guard();
CREATE FUNCTION encova_finance_draft_line_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; current_state TEXT;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW."draftId"<>OLD."draftId") THEN RAISE EXCEPTION 'FINANCE_DRAFT_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 target:=CASE WHEN TG_OP='DELETE' THEN OLD."draftId" ELSE NEW."draftId" END;
 SELECT state INTO current_state FROM public."FinanceJournalDraft" WHERE id=target FOR UPDATE;
 IF current_state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_DRAFT_IMMUTABLE' USING ERRCODE='P0001'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER "FinanceJournalDraftLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceJournalDraftLine" FOR EACH ROW EXECUTE FUNCTION encova_finance_draft_line_guard();
CREATE FUNCTION encova_finance_journal_header_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE period public."FinancePeriod"%ROWTYPE;
BEGIN
 SELECT * INTO period FROM public."FinancePeriod" WHERE id=NEW."periodId" FOR UPDATE;
 IF period.id IS NULL OR period.state<>'OPEN' OR NEW."postingDate" NOT BETWEEN period."startDate" AND period."endDate" THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 IF NEW."postingDate">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'FINANCE_FUTURE_DATE' USING ERRCODE='P0001'; END IF;
 IF NEW."reversalOfId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."FinanceJournalEntry" WHERE id=NEW."reversalOfId" AND "reversalOfId" IS NULL AND "postingDate"<=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001'; END IF;
 UPDATE public."FinancePeriod" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=period.id;
 RETURN NEW;
END $$;
CREATE TRIGGER "FinanceJournalEntry_guard" BEFORE INSERT ON "FinanceJournalEntry" FOR EACH ROW EXECUTE FUNCTION encova_finance_journal_header_guard();
CREATE FUNCTION encova_finance_journal_line_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE account public."FinanceAccount"%ROWTYPE;
BEGIN
 SELECT * INTO account FROM public."FinanceAccount" WHERE id=NEW."accountId" FOR UPDATE;
 IF account.id IS NULL OR NOT account.active OR NOT account."isPosting" OR account.currency<>'PKR' THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 IF account."controlType"<>'NONE' THEN RAISE EXCEPTION 'FINANCE_CONTROL_PROTECTED' USING ERRCODE='P0001'; END IF;
 IF NEW."projectId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Project" WHERE id=NEW."projectId" AND "archivedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_PROJECT_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 UPDATE public."FinanceAccount" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id IN (
  WITH RECURSIVE ancestors AS (SELECT id,"parentId" FROM public."FinanceAccount" WHERE id=NEW."accountId"
  UNION SELECT a.id,a."parentId" FROM public."FinanceAccount" a JOIN ancestors p ON a.id=p."parentId") SELECT id FROM ancestors
 );
 RETURN NEW;
END $$;
CREATE TRIGGER "FinanceJournalLine_guard" BEFORE INSERT ON "FinanceJournalLine" FOR EACH ROW EXECUTE FUNCTION encova_finance_journal_line_guard();
CREATE FUNCTION encova_finance_journal_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; entry public."FinanceJournalEntry"%ROWTYPE; line_count BIGINT; debits NUMERIC; credits NUMERIC;
BEGIN
 IF TG_TABLE_NAME='FinanceJournalEntry' THEN target:=NEW.id; ELSE target:=NEW."journalId"; END IF;
 SELECT * INTO entry FROM public."FinanceJournalEntry" WHERE id=target;
 SELECT count(*),coalesce(sum(debit),0),coalesce(sum(credit),0) INTO line_count,debits,credits FROM public."FinanceJournalLine" WHERE "journalId"=target;
 IF line_count NOT BETWEEN 2 AND 200 OR debits<>credits OR debits<=0 OR debits>999999999999999999.99 THEN RAISE EXCEPTION 'FINANCE_UNBALANCED' USING ERRCODE='P0001'; END IF;
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
CREATE CONSTRAINT TRIGGER "FinanceJournalEntry_balance" AFTER INSERT ON "FinanceJournalEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_journal_check();
CREATE CONSTRAINT TRIGGER "FinanceJournalLine_balance" AFTER INSERT ON "FinanceJournalLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_journal_check();

CREATE FUNCTION encova_finance_ledger_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
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
   INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_JOURNAL_VOID','FinanceJournalDraft',(item->>'id')::uuid,reason,'{}',request_id);
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
  INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_JOURNAL_'||action,'FinanceJournalDraft',draft.id,reason,jsonb_build_object('version',draft.version,'journalId',entry_id),request_id);
 END IF;
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,action,request_key,digest,result);
 RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';
 WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;
-- Restricted runtime: reads plus one narrow current-session command, no CRUD.
DO $$ DECLARE t TEXT; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceJournalDraft','FinanceJournalDraftLine','FinanceJournalEntry','FinanceJournalLine','FinanceLedgerReceipt'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon',t);END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated',t);END IF;
 END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('encova_finance_draft_guard','encova_finance_draft_line_guard','encova_finance_journal_header_guard','encova_finance_journal_line_guard','encova_finance_journal_check','encova_finance_ledger_command') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon',f.signature);END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated',f.signature);END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION encova_finance_ledger_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID) TO encova_app;END IF;
END $$;

COMMIT;
