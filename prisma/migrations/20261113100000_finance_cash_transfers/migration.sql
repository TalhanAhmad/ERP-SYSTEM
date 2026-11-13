BEGIN;
CREATE SEQUENCE finance_movement_number AS BIGINT MINVALUE 1 MAXVALUE 9999999999 NO CYCLE;
CREATE TABLE "FinanceMovement"(id UUID PRIMARY KEY,number TEXT NOT NULL UNIQUE CHECK(number~'^MVT-[0-9]{10}$'),kind TEXT NOT NULL CHECK(kind IN('TRANSFER','REVERSAL')),reference TEXT NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 80),"documentDate" DATE NOT NULL CHECK("documentDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),"postingDate" DATE NOT NULL CHECK("postingDate" BETWEEN "documentDate" AND DATE '9999-12-31'),description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 1000),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),"approvalEvidence" TEXT,"currency" TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),amount NUMERIC(20,2) NOT NULL CHECK(amount>0),"fromCashId" UUID REFERENCES "FinanceCashAccount" ON DELETE RESTRICT,"toCashId" UUID REFERENCES "FinanceCashAccount" ON DELETE RESTRICT,"partyId" UUID REFERENCES "FinanceParty" ON DELETE RESTRICT,"controlAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,"counterAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,"projectId" UUID REFERENCES "Project" ON DELETE RESTRICT,state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','POSTED','VOIDED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"reversalOfId" UUID UNIQUE REFERENCES "FinanceMovement" ON DELETE RESTRICT,"sourceSnapshot" JSONB,"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "FinanceMovement_source_shape" CHECK((kind='TRANSFER' AND "fromCashId" IS NOT NULL AND "toCashId" IS NOT NULL AND "fromCashId"<>"toCashId" AND "partyId" IS NULL AND "controlAccountId" IS NULL AND "counterAccountId" IS NULL AND "projectId" IS NULL AND "approvalEvidence" IS NULL AND "reversalOfId" IS NULL) OR(kind='REVERSAL' AND "reversalOfId" IS NOT NULL AND "reversalOfId"<>id)));
CREATE INDEX "FinanceMovement_kind_postingDate_id_idx" ON "FinanceMovement"(kind,"postingDate",id);
CREATE TRIGGER "FinanceMovement_config" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceMovement" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
ALTER TABLE "FinanceJournalEntry" ADD COLUMN "movementId" UUID UNIQUE REFERENCES "FinanceMovement" ON DELETE RESTRICT;
DO $$ DECLARE old_check TEXT;BEGIN SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint WHERE conrelid='public."FinanceJournalEntry"'::regclass AND conname='FinanceJournalEntry_source_identity';ALTER TABLE "FinanceJournalEntry" DROP CONSTRAINT "FinanceJournalEntry_source_identity";EXECUTE 'ALTER TABLE public."FinanceJournalEntry" ADD CONSTRAINT "FinanceJournalEntry_source_identity" CHECK(('||substr(old_check,8,length(old_check)-8)||' AND "movementId" IS NULL) OR("sourceType"=''MOVEMENT'' AND "sourceAction"=''POST'' AND "movementId"="sourceId" AND "movementId" IS NOT NULL AND "billId" IS NULL AND "invoiceId" IS NULL AND "customerDocumentId" IS NULL AND "supplierDocumentId" IS NULL AND "draftId" IS NULL AND "reversalOfId" IS NULL))';END $$;
CREATE FUNCTION encova_finance_movement_snapshot(target UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN d.kind='REVERSAL' THEN o."sourceSnapshot" ELSE jsonb_build_object('fromCash',(SELECT jsonb_build_object('id',id,'name',name,'glAccountId',"glAccountId") FROM public."FinanceCashAccount" WHERE id=d."fromCashId"),'toCash',(SELECT jsonb_build_object('id',id,'name',name,'glAccountId',"glAccountId") FROM public."FinanceCashAccount" WHERE id=d."toCashId"),'party',CASE WHEN d."partyId" IS NOT NULL THEN public.encova_finance_party_snapshot(d."partyId") END) END FROM public."FinanceMovement" d LEFT JOIN public."FinanceMovement" o ON o.id=d."reversalOfId" WHERE d.id=target;
$$;
CREATE FUNCTION encova_finance_movement_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' OR(TG_OP='UPDATE' AND OLD.state<>'DRAFT') THEN RAISE EXCEPTION 'FINANCE_MOVEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN IF NEW.state<>'DRAFT' OR NEW.version<>1 OR NEW."sourceSnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;RETURN NEW;END IF;
 IF ROW(NEW.id,NEW.number,NEW.kind,NEW."createdById",NEW."createdAt",NEW."reversalOfId") IS DISTINCT FROM ROW(OLD.id,OLD.number,OLD.kind,OLD."createdById",OLD."createdAt",OLD."reversalOfId") OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
 IF NEW.state<>'DRAFT' AND(to_jsonb(NEW)-ARRAY['state','version','sourceSnapshot','updatedAt']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','sourceSnapshot','updatedAt']) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW.state='POSTED' THEN IF NEW."sourceSnapshot" IS DISTINCT FROM public.encova_finance_movement_snapshot(NEW.id) OR NOT EXISTS(SELECT 1 FROM public."FinanceJournalEntry" WHERE "movementId"=NEW.id) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;ELSIF NEW."sourceSnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN NEW;END $$;
CREATE TRIGGER "FinanceMovement_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceMovement" FOR EACH ROW EXECUTE FUNCTION encova_finance_movement_guard();
CREATE FUNCTION encova_finance_movement_lines(target UUID) RETURNS TABLE(sequence INTEGER,"accountId" UUID,description TEXT,debit NUMERIC,credit NUMERIC,"projectId" UUID,"partyId" UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT 1,c."glAccountId",d.description,d.amount,0::numeric,d."projectId",d."partyId" FROM public."FinanceMovement" d JOIN public."FinanceCashAccount" c ON c.id=d."toCashId" WHERE d.id=target AND d.kind='TRANSFER'
 UNION ALL SELECT 2,c."glAccountId",d.description,0::numeric,d.amount,d."projectId",d."partyId" FROM public."FinanceMovement" d JOIN public."FinanceCashAccount" c ON c.id=d."fromCashId" WHERE d.id=target AND d.kind='TRANSFER'
 UNION ALL SELECT l.sequence,l."accountId",l.description,l.credit,l.debit,l."projectId",l."partyId" FROM public."FinanceMovement" d JOIN public."FinanceJournalEntry" e ON e."movementId"=d."reversalOfId" JOIN public."FinanceJournalLine" l ON l."journalId"=e.id WHERE d.id=target AND d.kind='REVERSAL';
$$;
CREATE FUNCTION encova_finance_movement_validate(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE d public."FinanceMovement"%ROWTYPE;o public."FinanceMovement"%ROWTYPE;BEGIN
 SELECT * INTO d FROM public."FinanceMovement" WHERE id=target;
 IF d.id IS NULL OR d.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_MOVEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF d.kind='TRANSFER' THEN
  IF(SELECT count(*) FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" a ON a.id=c."glAccountId" WHERE c.id IN(d."fromCashId",d."toCashId") AND c.active AND c.currency='PKR' AND a.active AND a.currency='PKR' AND a."isPosting" AND NOT a."isContra" AND a.type='ASSET' AND a."controlType"='CASH')<>2 OR(SELECT count(DISTINCT "glAccountId") FROM public."FinanceCashAccount" WHERE id IN(d."fromCashId",d."toCashId"))<>2 THEN RAISE EXCEPTION 'FINANCE_MOVEMENT_MAPPING' USING ERRCODE='P0001';END IF;
 ELSE
  SELECT * INTO o FROM public."FinanceMovement" WHERE id=d."reversalOfId";
  IF o.id IS NULL OR o.state<>'POSTED' OR o.kind='REVERSAL' OR d."postingDate"<o."postingDate" OR EXISTS(SELECT 1 FROM public."FinanceMovement" WHERE "reversalOfId"=o.id AND id<>d.id) THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001';END IF;
 END IF;END $$;
CREATE FUNCTION encova_finance_check_movement(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE d public."FinanceMovement"%ROWTYPE;e public."FinanceJournalEntry"%ROWTYPE;o public."FinanceMovement"%ROWTYPE;BEGIN
 SELECT * INTO d FROM public."FinanceMovement" WHERE id=target;SELECT * INTO e FROM public."FinanceJournalEntry" WHERE "movementId"=target;
 IF d.state<>'POSTED' THEN IF e.id IS NOT NULL OR d."sourceSnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;END IF;
 IF d.id IS NULL OR e.id IS NULL OR e."sourceType"<>'MOVEMENT' OR e."postingDate"<>d."postingDate" OR e.description<>d.description OR e.evidence<>d.evidence OR d."sourceSnapshot" IS NULL OR EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id) EXCEPT(SELECT * FROM public.encova_finance_movement_lines(target))) OR EXISTS((SELECT * FROM public.encova_finance_movement_lines(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF d.kind='REVERSAL' THEN SELECT * INTO o FROM public."FinanceMovement" WHERE id=d."reversalOfId";IF o.state IS DISTINCT FROM 'POSTED' OR o.kind='REVERSAL' OR d."postingDate"<o."postingDate" OR(to_jsonb(d)-ARRAY['id','number','kind','reversalOfId','documentDate','postingDate','state','version','sourceSnapshot','createdById','createdAt','updatedAt','evidence']) IS DISTINCT FROM(to_jsonb(o)-ARRAY['id','number','kind','reversalOfId','documentDate','postingDate','state','version','sourceSnapshot','createdById','createdAt','updatedAt','evidence']) THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001';END IF;END IF;
END $$;
CREATE FUNCTION encova_finance_movement_check_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM public.encova_finance_check_movement(NEW.id);RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER "FinanceMovement_valid" AFTER INSERT OR UPDATE ON "FinanceMovement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_movement_check_trigger();
CREATE FUNCTION encova_finance_movement_effects(actor UUID,target UUID,entry_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 UPDATE public."FinanceParty" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=(SELECT "partyId" FROM public."FinanceMovement" WHERE id=target);
 UPDATE public."FinanceMovement" SET state='POSTED',version=version+1,"sourceSnapshot"=public.encova_finance_movement_snapshot(id),"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;
END $$;
CREATE FUNCTION encova_finance_movement_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceMovement"%ROWTYPE;o public."FinanceMovement"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;reason TEXT;digest TEXT;operation_name TEXT;result JSONB;entry_id UUID;original_id UUID;original_version INTEGER;original_number TEXT;BEGIN
 IF action IS NULL OR action NOT IN('CREATE','UPDATE','POST','VOID','REVERSE') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 reason:=trim(input->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 OR input-(CASE WHEN action='CREATE' THEN ARRAY['kind','reference','documentDate','postingDate','description','evidence','approvalEvidence','currency','amount','fromCashId','toCashId','partyId','controlAccountId','counterAccountId','projectId','reason'] WHEN action='UPDATE' THEN ARRAY['id','expectedVersion','kind','reference','documentDate','postingDate','description','evidence','approvalEvidence','currency','amount','fromCashId','toCashId','partyId','controlAccountId','counterAccountId','projectId','reason'] WHEN action='REVERSE' THEN ARRAY['id','expectedVersion','postingDate','reason'] ELSE ARRAY['id','expectedVersion','reason'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 operation_name:='MOVEMENT_'||action;digest:=encode(sha256(convert_to(jsonb_strip_nulls(input)::text,'UTF8')),'hex');SELECT * INTO r FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation=operation_name AND key=request_key;
 IF FOUND THEN IF r."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN r.result;END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action<>'CREATE' THEN
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR(input->>'expectedVersion')::integer<1 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  SELECT * INTO d FROM public."FinanceMovement" WHERE id=(input->>'id')::uuid FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF d.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF(action='REVERSE' AND d.state<>'POSTED') OR(action<>'REVERSE' AND d.state<>'DRAFT') THEN RAISE EXCEPTION 'FINANCE_MOVEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
 END IF;
 IF action IN('CREATE','UPDATE') THEN
  IF input->>'kind' IS DISTINCT FROM 'TRANSFER' OR input->>'currency' IS DISTINCT FROM 'PKR' OR jsonb_typeof(input->'amount') IS DISTINCT FROM 'string' OR input->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR(input->>'amount')::numeric<=0 OR input->>'documentDate' IS NULL OR input->>'documentDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR input->>'postingDate' IS NULL OR input->>'postingDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF input->>'partyId' IS NOT NULL OR input->>'controlAccountId' IS NOT NULL OR input->>'counterAccountId' IS NOT NULL OR input->>'projectId' IS NOT NULL OR input->>'approvalEvidence' IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF action='CREATE' THEN INSERT INTO public."FinanceMovement"(id,number,kind,reference,"documentDate","postingDate",description,evidence,"approvalEvidence",currency,amount,"fromCashId","toCashId","partyId","controlAccountId","counterAccountId","projectId","createdById") VALUES(gen_random_uuid(),'MVT-'||lpad(nextval('public.finance_movement_number')::text,10,'0'),input->>'kind',input->>'reference',(input->>'documentDate')::date,(input->>'postingDate')::date,input->>'description',input->>'evidence',input->>'approvalEvidence','PKR',(input->>'amount')::numeric,(input->>'fromCashId')::uuid,(input->>'toCashId')::uuid,(input->>'partyId')::uuid,(input->>'controlAccountId')::uuid,(input->>'counterAccountId')::uuid,(input->>'projectId')::uuid,actor) RETURNING * INTO d;
  ELSE UPDATE public."FinanceMovement" SET reference=input->>'reference',"documentDate"=(input->>'documentDate')::date,"postingDate"=(input->>'postingDate')::date,description=input->>'description',evidence=input->>'evidence',amount=(input->>'amount')::numeric,"fromCashId"=(input->>'fromCashId')::uuid,"toCashId"=(input->>'toCashId')::uuid,"updatedAt"=CURRENT_TIMESTAMP,version=version+1 WHERE id=d.id RETURNING * INTO d;END IF;
 ELSIF action='VOID' THEN UPDATE public."FinanceMovement" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
 ELSIF action='REVERSE' THEN
  IF d.kind='REVERSAL' OR input->>'postingDate' IS NULL OR input->>'postingDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR EXISTS(SELECT 1 FROM public."FinanceMovement" WHERE "reversalOfId"=d.id) THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001';END IF;
  o:=d;original_id:=d.id;original_number:=d.number;original_version:=d.version;
  INSERT INTO public."FinanceMovement" SELECT x.* FROM jsonb_populate_record(NULL::public."FinanceMovement",to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),'number','MVT-'||lpad(nextval('public.finance_movement_number')::text,10,'0'),'kind','REVERSAL','reversalOfId',o.id,'documentDate',(input->>'postingDate')::date,'postingDate',(input->>'postingDate')::date,'state','DRAFT','version',1,'sourceSnapshot',NULL,'createdById',actor,'createdAt',CURRENT_TIMESTAMP,'updatedAt',CURRENT_TIMESTAMP,'evidence',reason)) x RETURNING * INTO d;
  entry_id:=public.encova_finance_emit_journal(actor,'MOVEMENT',d.id,d."postingDate",reason);SELECT * INTO d FROM public."FinanceMovement" WHERE id=d.id;
 ELSE entry_id:=public.encova_finance_emit_journal(actor,'MOVEMENT',d.id,d."postingDate",reason);SELECT * INTO d FROM public."FinanceMovement" WHERE id=d.id;END IF;
 result:=CASE WHEN action='REVERSE' THEN jsonb_build_object('id',original_id,'version',original_version,'number',original_number,'journalId',entry_id,'reversalId',d.id) ELSE jsonb_build_object('id',d.id,'version',d.version,'number',d.number,'journalId',entry_id) END;
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,operation_name,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_'||operation_name,'FinanceMovement',coalesce(original_id,d.id),reason,jsonb_build_object('journalId',entry_id,'snapshot',to_jsonb(d)||jsonb_build_object('amount',d.amount::text)),request_id);RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';
 WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;

CREATE OR REPLACE FUNCTION encova_finance_journal_header_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE period public."FinancePeriod"%ROWTYPE;
BEGIN
 SELECT * INTO period FROM public."FinancePeriod" WHERE id=NEW."periodId" FOR UPDATE;
 IF period.id IS NULL OR period.state<>'OPEN' OR NEW."postingDate" NOT BETWEEN period."startDate" AND period."endDate" THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 IF NEW."postingDate">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'FINANCE_FUTURE_DATE' USING ERRCODE='P0001'; END IF;
 IF NEW."sourceType"='SUPPLIER_DOCUMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE id=NEW."supplierDocumentId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='SUPPLIER_DOCUMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE id=NEW."supplierDocumentId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='MOVEMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceMovement" WHERE id=NEW."movementId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
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
 IF entry."sourceType"='MOVEMENT' THEN
  IF NEW."invoiceLineId" IS NOT NULL OR NEW."billLineId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.encova_finance_movement_lines(entry."movementId") x WHERE ROW(x.sequence,x."accountId",x.description,x.debit,x.credit,x."projectId",x."partyId") IS NOT DISTINCT FROM ROW(NEW.sequence,NEW."accountId",NEW.description,NEW.debit,NEW.credit,NEW."projectId",NEW."partyId")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_mark_accounts(ARRAY[NEW."accountId"]);RETURN NEW;
 END IF;
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
 IF entry."sourceType"='MOVEMENT' THEN PERFORM public.encova_finance_check_movement(entry."movementId");RETURN NULL;END IF;
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
CREATE OR REPLACE FUNCTION encova_finance_emit_journal(actor UUID,source_kind TEXT,source_id UUID,posting_date DATE,reason TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE movement public."FinanceMovement"%ROWTYPE; supplier public."FinanceSupplierDocument"%ROWTYPE; bill public."FinanceBill"%ROWTYPE; draft public."FinanceJournalDraft"%ROWTYPE; original public."FinanceJournalEntry"%ROWTYPE; invoice public."FinanceInvoice"%ROWTYPE;
 period_id UUID; entry_id UUID:=gen_random_uuid(); mappings UUID[]; customer public."FinanceCustomerDocument"%ROWTYPE;
BEGIN
 IF source_kind IS NULL OR source_kind NOT IN ('JOURNAL_DRAFT','JOURNAL_REVERSAL','INVOICE','CUSTOMER_DOCUMENT','BILL','SUPPLIER_DOCUMENT','MOVEMENT') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF source_kind='MOVEMENT' THEN
  SELECT * INTO movement FROM public."FinanceMovement" WHERE id=source_id FOR UPDATE;
  IF movement.id IS NULL OR movement."postingDate"<>posting_date THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_movement_validate(source_id);
 ELSIF source_kind='SUPPLIER_DOCUMENT' THEN
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
 ELSIF source_kind='MOVEMENT' THEN
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","movementId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'MOVEMENT',movement.id,'POST',movement.id,posting_date,period_id,movement.description,movement.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId") SELECT gen_random_uuid(),entry_id,x.* FROM public.encova_finance_movement_lines(movement.id) x ORDER BY x."accountId",x.sequence;
  PERFORM public.encova_finance_movement_effects(actor,movement.id,entry_id);
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
ALTER TABLE "FinanceFile" ADD COLUMN "movementId" UUID REFERENCES "FinanceMovement" ON DELETE RESTRICT;
DO $$ DECLARE c RECORD;BEGIN SELECT conname INTO c FROM pg_constraint WHERE conrelid='public."FinanceFile"'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%num_nonnulls%';EXECUTE format('ALTER TABLE public."FinanceFile" DROP CONSTRAINT %I',c.conname);ALTER TABLE public."FinanceFile" ADD CONSTRAINT "FinanceFile_one_source" CHECK(num_nonnulls("invoiceId","billId","customerDocumentId","supplierDocumentId","journalDraftId","movementId")=1);END $$;
CREATE OR REPLACE FUNCTION encova_finance_file_source(source_kind TEXT,source_id UUID) RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE s TEXT;BEGIN
 CASE source_kind WHEN 'INVOICE' THEN SELECT state INTO s FROM public."FinanceInvoice" WHERE id=source_id;WHEN 'BILL' THEN SELECT state INTO s FROM public."FinanceBill" WHERE id=source_id;WHEN 'CUSTOMER_DOCUMENT' THEN SELECT state INTO s FROM public."FinanceCustomerDocument" WHERE id=source_id;WHEN 'SUPPLIER_DOCUMENT' THEN SELECT state INTO s FROM public."FinanceSupplierDocument" WHERE id=source_id;WHEN 'MOVEMENT' THEN SELECT state INTO s FROM public."FinanceMovement" WHERE id=source_id;WHEN 'JOURNAL_DRAFT' THEN SELECT state INTO s FROM public."FinanceJournalDraft" WHERE id=source_id;ELSE RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END CASE;
 IF s IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;RETURN s;END $$;
CREATE OR REPLACE FUNCTION encova_finance_file_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE n BIGINT;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'RESERVED' OR NEW.version<>1 OR NEW."scanResult" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  SELECT count(*) INTO n FROM public."FinanceFile" WHERE state<>'REMOVED' AND ROW("invoiceId","billId","customerDocumentId","supplierDocumentId","journalDraftId","movementId") IS NOT DISTINCT FROM ROW(NEW."invoiceId",NEW."billId",NEW."customerDocumentId",NEW."supplierDocumentId",NEW."journalDraftId",NEW."movementId");
  IF n>=10 THEN RAISE EXCEPTION 'FINANCE_FILE_LIMIT' USING ERRCODE='P0001';END IF;
 ELSE
  IF NEW.state='REMOVED' AND OLD.state<>'REMOVED' THEN
   IF public.encova_finance_file_source(CASE WHEN OLD."invoiceId" IS NOT NULL THEN 'INVOICE' WHEN OLD."billId" IS NOT NULL THEN 'BILL' WHEN OLD."customerDocumentId" IS NOT NULL THEN 'CUSTOMER_DOCUMENT' WHEN OLD."supplierDocumentId" IS NOT NULL THEN 'SUPPLIER_DOCUMENT' WHEN OLD."movementId" IS NOT NULL THEN 'MOVEMENT' ELSE 'JOURNAL_DRAFT' END,coalesce(OLD."invoiceId",OLD."billId",OLD."customerDocumentId",OLD."supplierDocumentId",OLD."journalDraftId",OLD."movementId"))<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;
  END IF;
  IF NEW.state IN('CLEAN','REJECTED') AND OLD.state='QUARANTINED' THEN
   IF NOT public.encova_finance_file_scan_signature(OLD.id,NEW."scanResult",OLD."intentHash") OR(NEW.state='CLEAN') IS DISTINCT FROM(NEW."scanResult"->>'status'='CLEAN') THEN RAISE EXCEPTION 'FINANCE_FILE_SIGNATURE' USING ERRCODE='P0001';END IF;
  END IF;
  IF(to_jsonb(NEW)-ARRAY['state','version','intentHash','intentProvider','intentSessionId','intentVerifiedAt','scanResult','updatedAt','intentActorId','blobDeletedAt']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','intentHash','intentProvider','intentSessionId','intentVerifiedAt','scanResult','updatedAt','intentActorId','blobDeletedAt']) OR NEW.version<>OLD.version+1 OR(OLD.state IN('CLEAN','REJECTED') AND NEW.state<>'REMOVED') OR(OLD.state='REMOVED' AND NEW.state<>'REMOVED') OR NOT((OLD.state=NEW.state AND NEW.state IN('RESERVED','QUARANTINED')) OR(OLD.state='RESERVED' AND NEW.state='QUARANTINED') OR(OLD.state='QUARANTINED' AND NEW.state IN('CLEAN','REJECTED')) OR NEW.state='REMOVED') THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;
 END IF;RETURN NEW;END $$;
CREATE OR REPLACE FUNCTION encova_finance_file_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceFile"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;source_kind TEXT;source_id UUID;source_state TEXT;reason TEXT;digest TEXT;result JSONB;new_id UUID:=gen_random_uuid();
BEGIN
 IF action IS NULL OR action NOT IN('RESERVE','COMPLETE','SCAN','REMOVE','AUTHORIZE','BLOB_REMOVED','VALIDATE') OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action IN('RESERVE','REMOVE','AUTHORIZE','BLOB_REMOVED') THEN
  IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' OR NOT public.encova_finance_session_ok(actor,provider,session_id) THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
  IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 OR length(trim(input->>'reason')) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  reason:=trim(input->>'reason');digest:=encode(sha256(convert_to((input-'intentHash')::text,'UTF8')),'hex');
  SELECT * INTO r FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation='FILE_'||action AND key=request_key;
  IF FOUND THEN IF r."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;IF action NOT IN('RESERVE','AUTHORIZE') THEN RETURN r.result;END IF;SELECT * INTO d FROM public."FinanceFile" WHERE id=(r.result->>'id')::uuid FOR UPDATE;
   IF d.state IN('RESERVED','QUARANTINED') THEN UPDATE public."FinanceFile" SET "intentActorId"=actor,"intentHash"=input->>'intentHash',"intentProvider"=provider,"intentSessionId"=session_id,"intentVerifiedAt"=verified_at,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id;END IF;RETURN r.result;
  END IF;
 ELSE
  SELECT * INTO d FROM public."FinanceFile" WHERE id=(input->>'id')::uuid FOR UPDATE;
  IF d.id IS NULL OR d."intentActorId"<>actor OR d."intentHash" IS DISTINCT FROM input->>'intentHash' OR d."intentVerifiedAt"<CURRENT_TIMESTAMP-interval '5 minutes' OR NOT public.encova_finance_session_ok(actor,d."intentProvider",d."intentSessionId") THEN RAISE EXCEPTION 'FINANCE_FILE_INTENT' USING ERRCODE='P0001';END IF;
 END IF;
 IF action='VALIDATE' THEN RETURN jsonb_build_object('id',d.id);END IF;
 IF action='RESERVE' THEN
  IF input-ARRAY['sourceType','sourceId','fileName','mimeType','byteSize','sha256','reason','intentHash']<>'{}'::jsonb OR jsonb_typeof(input->'byteSize') IS DISTINCT FROM 'number' OR input->>'byteSize' !~ '^[1-9][0-9]{0,7}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  source_kind:=input->>'sourceType';source_id:=(input->>'sourceId')::uuid;source_state:=public.encova_finance_file_source(source_kind,source_id);
  IF source_state='VOIDED' THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinanceFile"(id,"invoiceId","billId","customerDocumentId","supplierDocumentId","journalDraftId","movementId","fileName","mimeType","byteSize",sha256,"objectKey","uploaderId","intentActorId","intentHash","intentProvider","intentSessionId","intentVerifiedAt") VALUES(new_id,CASE WHEN source_kind='INVOICE' THEN source_id END,CASE WHEN source_kind='BILL' THEN source_id END,CASE WHEN source_kind='CUSTOMER_DOCUMENT' THEN source_id END,CASE WHEN source_kind='SUPPLIER_DOCUMENT' THEN source_id END,CASE WHEN source_kind='JOURNAL_DRAFT' THEN source_id END,CASE WHEN source_kind='MOVEMENT' THEN source_id END,input->>'fileName',input->>'mimeType',(input->>'byteSize')::integer,input->>'sha256','evidence/'||new_id::text,actor,actor,input->>'intentHash',provider,session_id,verified_at) RETURNING * INTO d;
 ELSIF action='AUTHORIZE' THEN
  IF input-ARRAY['id','reason','intentHash']<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  SELECT * INTO d FROM public."FinanceFile" WHERE id=(input->>'id')::uuid FOR UPDATE;IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF d.state NOT IN('RESERVED','QUARANTINED') THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;
  UPDATE public."FinanceFile" SET "intentActorId"=actor,"intentHash"=input->>'intentHash',"intentProvider"=provider,"intentSessionId"=session_id,"intentVerifiedAt"=verified_at,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
 ELSIF action='BLOB_REMOVED' THEN
  IF input-ARRAY['id','reason']<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  UPDATE public."FinanceFile" SET "blobDeletedAt"=coalesce("blobDeletedAt",CURRENT_TIMESTAMP),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=(input->>'id')::uuid AND state='REMOVED' RETURNING * INTO d;
  IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
 ELSIF action='COMPLETE' THEN
  IF input-ARRAY['id','intentHash']<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF d.state='RESERVED' THEN UPDATE public."FinanceFile" SET state='QUARANTINED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;ELSIF d.state NOT IN('QUARANTINED','CLEAN','REJECTED') THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;reason:='Verified reserved bytes, size and content type';
 ELSIF action='SCAN' THEN
  IF input-ARRAY['id','intentHash','scanResult']<>'{}'::jsonb OR input->'scanResult'->>'status' IS NULL OR input->'scanResult'->>'status' NOT IN('CLEAN','INFECTED') OR input->'scanResult'->>'sha256' IS DISTINCT FROM d.sha256 OR input->'scanResult'->>'engine' IS NULL OR length(trim(input->'scanResult'->>'engine')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF NOT public.encova_finance_file_scan_signature(d.id,input->'scanResult',input->>'intentHash') THEN RAISE EXCEPTION 'FINANCE_FILE_SIGNATURE' USING ERRCODE='P0001';END IF;
  IF d.state='QUARANTINED' THEN UPDATE public."FinanceFile" SET state=CASE WHEN input->'scanResult'->>'status'='CLEAN' THEN 'CLEAN' ELSE 'REJECTED' END,"scanResult"=input->'scanResult',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;ELSIF d.state NOT IN('CLEAN','REJECTED') THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;reason:='Scanner result bound to verified file digest';
 ELSE
  IF input-ARRAY['id','reason']<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  SELECT * INTO d FROM public."FinanceFile" WHERE id=(input->>'id')::uuid FOR UPDATE;IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  source_kind:=CASE WHEN d."invoiceId" IS NOT NULL THEN 'INVOICE' WHEN d."billId" IS NOT NULL THEN 'BILL' WHEN d."customerDocumentId" IS NOT NULL THEN 'CUSTOMER_DOCUMENT' WHEN d."supplierDocumentId" IS NOT NULL THEN 'SUPPLIER_DOCUMENT' WHEN d."movementId" IS NOT NULL THEN 'MOVEMENT' ELSE 'JOURNAL_DRAFT' END;source_id:=coalesce(d."invoiceId",d."billId",d."customerDocumentId",d."supplierDocumentId",d."journalDraftId",d."movementId");source_state:=public.encova_finance_file_source(source_kind,source_id);
  IF source_state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;
  UPDATE public."FinanceFile" SET state='REMOVED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
 END IF;
 result:=jsonb_build_object('id',d.id);
 IF action IN('RESERVE','REMOVE','AUTHORIZE','BLOB_REMOVED') THEN INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,'FILE_'||action,request_key,digest,result);END IF;
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_FILE_'||action,'FinanceFile',d.id,reason,jsonb_build_object('fileName',d."fileName",'mimeType',d."mimeType",'byteSize',d."byteSize",'sha256',d.sha256,'state',d.state,'scanResult',d."scanResult"),request_id);RETURN result;
EXCEPTION WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;
DO $$ DECLARE f RECORD;role_name TEXT;BEGIN
 ALTER TABLE "FinanceMovement" ENABLE ROW LEVEL SECURITY;REVOKE ALL ON "FinanceMovement" FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT SELECT ON "FinanceMovement" TO encova_app;CREATE POLICY encova_server_read ON "FinanceMovement" FOR SELECT TO encova_app USING(true);END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON public."FinanceMovement" FROM %I',role_name);END IF;END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND(proname LIKE 'encova_finance_movement_%' OR proname='encova_finance_check_movement') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','encova_app'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name);END IF;END LOOP;
 END LOOP;
 REVOKE ALL ON SEQUENCE public.finance_movement_number FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION encova_finance_movement_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID) TO encova_app;END IF;
END $$;
COMMIT;
