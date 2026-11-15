BEGIN;
CREATE SEQUENCE finance_reconciliation_number AS BIGINT MINVALUE 1 MAXVALUE 9999999999 NO CYCLE;
CREATE TABLE "FinanceReconciliation"(id UUID PRIMARY KEY,number TEXT NOT NULL UNIQUE,"companyName" TEXT NOT NULL,"cashAccountId" UUID NOT NULL REFERENCES "FinanceCashAccount" ON DELETE RESTRICT,"glAccountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,"statementBatchId" UUID REFERENCES "FinanceStatementBatch" ON DELETE RESTRICT,"startDate" DATE NOT NULL,"cutoffDate" DATE NOT NULL,"openingBalance" NUMERIC(20,2) NOT NULL,"closingBalance" NUMERIC(20,2) NOT NULL,evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),"basisHash" TEXT NOT NULL CHECK("basisHash"~'^[0-9a-f]{64}$'),"sourceProof" JSONB NOT NULL,"finalSnapshot" JSONB,state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','FINALIZED','VOIDED','REOPENED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"replacesId" UUID UNIQUE REFERENCES "FinanceReconciliation" ON DELETE RESTRICT,"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"finalizedById" UUID REFERENCES "Person" ON DELETE RESTRICT,"finalizedAt" TIMESTAMPTZ,"reopenedById" UUID REFERENCES "Person" ON DELETE RESTRICT,"reopenedAt" TIMESTAMPTZ,"reopenReason" TEXT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK("startDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' AND "cutoffDate" BETWEEN "startDate" AND DATE '9999-12-31'));
CREATE UNIQUE INDEX "FinanceReconciliation_active_cutoff" ON "FinanceReconciliation"("cashAccountId","cutoffDate") WHERE state IN('DRAFT','FINALIZED');
CREATE INDEX "FinanceReconciliation_bank_state_cutoff_id_idx" ON "FinanceReconciliation"("glAccountId",state,"cutoffDate",id);
CREATE TABLE "FinanceReconciliationNote"(id UUID PRIMARY KEY,"reconciliationId" UUID NOT NULL REFERENCES "FinanceReconciliation" ON DELETE RESTRICT,"rowKey" TEXT NOT NULL CHECK("rowKey"~'^(CASH|STATEMENT):[0-9a-f-]{36}$'),kind TEXT NOT NULL CHECK(kind IN('DOCUMENT','EXCLUDE_DUPLICATE')),note TEXT NOT NULL CHECK(length(trim(note)) BETWEEN 3 AND 500),"peerStatementLineId" UUID REFERENCES "FinanceStatementLine" ON DELETE RESTRICT,"updatedById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("reconciliationId","rowKey"),CHECK((kind='EXCLUDE_DUPLICATE')=("peerStatementLineId" IS NOT NULL)));
CREATE FUNCTION encova_finance_reconciliation_position(side TEXT,target UUID,cutoff DATE) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE source JSONB;allocated NUMERIC;BEGIN
 source:=public.encova_finance_bank_match_source(side,target);IF source IS NULL THEN RAISE EXCEPTION 'FINANCE_RECON_SOURCE' USING ERRCODE='P0001';END IF;
 SELECT coalesce(sum(e.delta),0) INTO allocated FROM public."FinanceBankMatchAllocation" a JOIN public."FinanceBankMatchEvent" e ON e."allocationId"=a.id WHERE e."effectiveDate"<=cutoff AND((side='CASH' AND a."journalLineId"=target) OR(side='STATEMENT' AND a."statementLineId"=target));
 RETURN jsonb_build_object('key',side||':'||target::text,'source',source,'allocated',round(allocated,2)::text,'remaining',round((source->>'amount')::numeric-allocated,2)::text);
END $$;
CREATE FUNCTION encova_finance_reconciliation_prepare(bank_id UUID,batch_id UUID,start_date DATE,cutoff DATE,opening NUMERIC,closing NUMERIC) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE bank public."FinanceCashAccount"%ROWTYPE;batch public."FinanceStatementBatch"%ROWTYPE;gl_balance NUMERIC;deposits NUMERIC;payments NUMERIC;bank_in NUMERIC;bank_out NUMERIC;ledger_digest TEXT;match_digest TEXT;cash_rows JSONB;bank_rows JSONB;proof JSONB;BEGIN
 SELECT c.* INTO bank FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" a ON a.id=c."glAccountId" WHERE c.id=bank_id AND c.currency='PKR' AND a.currency='PKR' AND a."controlType"='CASH';IF bank.id IS NULL THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF start_date IS NULL OR cutoff IS NULL OR start_date<DATE '0001-01-01' OR cutoff>DATE '9999-12-31' OR cutoff<start_date OR cutoff>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'FINANCE_RECON_DATE' USING ERRCODE='P0001';END IF;
 IF batch_id IS NOT NULL THEN
  SELECT * INTO batch FROM public."FinanceStatementBatch" WHERE id=batch_id AND state='IMPORTED' AND "cashAccountId"=bank.id AND "glAccountId"=bank."glAccountId";IF batch.id IS NULL OR batch."endDate"<>cutoff OR batch."startDate"<>start_date OR batch."openingBalance"<>opening OR batch."closingBalance"<>closing THEN RAISE EXCEPTION 'FINANCE_RECON_SOURCE' USING ERRCODE='P0001';END IF;
 ELSE
  IF opening IS NULL OR closing IS NULL OR opening<>closing OR EXISTS(SELECT 1 FROM public."FinanceStatementLine" l JOIN public."FinanceStatementBatch" b ON b.id=l."batchId" WHERE b."cashAccountId"=bank.id AND b.state='IMPORTED' AND l."valueDate" BETWEEN start_date AND cutoff) THEN RAISE EXCEPTION 'FINANCE_RECON_ZERO_ACTIVITY' USING ERRCODE='P0001';END IF;
 END IF;
 SELECT coalesce(sum(l.debit-l.credit),0),encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('id',l.id,'entry',e.id,'date',e."postingDate",'debit',l.debit::text,'credit',l.credit::text) ORDER BY e."postingDate",e.id,l.sequence),'[]'::jsonb)::text,'UTF8')),'hex') INTO gl_balance,ledger_digest FROM public."FinanceJournalLine" l JOIN public."FinanceJournalEntry" e ON e.id=l."journalId" WHERE l."accountId"=bank."glAccountId" AND e."postingDate"<=cutoff;
 SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('id',ev.id,'delta',ev.delta::text,'date',ev."effectiveDate") ORDER BY ev.id),'[]'::jsonb)::text,'UTF8')),'hex') INTO match_digest FROM public."FinanceBankMatchEvent" ev JOIN public."FinanceBankMatchAllocation" a ON a.id=ev."allocationId" JOIN public."FinanceJournalLine" l ON l.id=a."journalLineId" WHERE l."accountId"=bank."glAccountId" AND ev."effectiveDate"<=cutoff;
 WITH positions AS(SELECT public.encova_finance_reconciliation_position('CASH',l.id,cutoff) AS item,e."postingDate" AS day,l.id FROM public."FinanceJournalLine" l JOIN public."FinanceJournalEntry" e ON e.id=l."journalId" WHERE l."accountId"=bank."glAccountId" AND e."postingDate"<=cutoff AND e."sourceType" NOT IN('YEAR_CLOSE','OPENING')),bounded AS(SELECT * FROM positions WHERE(item->>'remaining')::numeric>0 ORDER BY day,id LIMIT 5001)
 SELECT coalesce(jsonb_agg(item ORDER BY day,id),'[]'::jsonb),coalesce(sum((item->>'remaining')::numeric) FILTER(WHERE item#>>'{source,direction}'='RECEIPT'),0),coalesce(sum((item->>'remaining')::numeric) FILTER(WHERE item#>>'{source,direction}'='PAYMENT'),0) INTO cash_rows,deposits,payments FROM bounded;
 WITH positions AS(SELECT public.encova_finance_reconciliation_position('STATEMENT',l.id,cutoff) AS item,l.sequence FROM public."FinanceStatementLine" l WHERE l."batchId"=batch_id),bounded AS(SELECT * FROM positions WHERE(item->>'remaining')::numeric>0 ORDER BY sequence LIMIT 5001)
 SELECT coalesce(jsonb_agg(item ORDER BY sequence),'[]'::jsonb),coalesce(sum((item->>'remaining')::numeric) FILTER(WHERE item#>>'{source,direction}'='RECEIPT'),0),coalesce(sum((item->>'remaining')::numeric) FILTER(WHERE item#>>'{source,direction}'='PAYMENT'),0) INTO bank_rows,bank_in,bank_out FROM bounded;
 IF jsonb_array_length(cash_rows)>5000 OR jsonb_array_length(bank_rows)>5000 THEN RAISE EXCEPTION 'FINANCE_RECON_LIMIT' USING ERRCODE='P0001';END IF;
 proof:=jsonb_build_object('cashAccountId',bank.id,'glAccountId',bank."glAccountId",'statementBatchId',batch_id,'statementNumber',batch.number,'statementSha256',batch.sha256,'startDate',start_date,'cutoffDate',cutoff,'currency','PKR','basis','POSTED_ACCRUAL_WITH_BANK_VALUE_DATES','openingStatementBalance',round(opening,2)::text,'closingStatementBalance',round(closing,2)::text,'glBankBalance',round(gl_balance,2)::text,'outstandingDeposits',round(deposits,2)::text,'outstandingPayments',round(payments,2)::text,'unresolvedBankReceipts',round(bank_in,2)::text,'unresolvedBankPayments',round(bank_out,2)::text,'explainedDifference',round(closing+deposits-payments-gl_balance,2)::text,'ledgerDigest',ledger_digest,'matchDigest',match_digest,'rows',cash_rows||bank_rows);
 RETURN proof||jsonb_build_object('basisHash',encode(sha256(convert_to(proof::text,'UTF8')),'hex'));
END $$;
CREATE FUNCTION encova_finance_reconciliation_snapshot(target UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',r.id,'number',r.number,'company',r."companyName",'currency','PKR','accountingBasis','POSTED_ACCRUAL_WITH_BANK_VALUE_DATES','generatedAt',CURRENT_TIMESTAMP,'cutoffDate',r."cutoffDate",'evidence',r.evidence,'source',r."sourceProof",'notes',coalesce((SELECT jsonb_agg(jsonb_build_object('key',n."rowKey",'kind',n.kind,'note',n.note,'peerStatementLineId',n."peerStatementLineId",'actorId',n."updatedById") ORDER BY n."rowKey") FROM public."FinanceReconciliationNote" n WHERE n."reconciliationId"=r.id),'[]'::jsonb)) FROM public."FinanceReconciliation" r WHERE r.id=target
$$;
CREATE FUNCTION encova_finance_reconciliation_note_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r public."FinanceReconciliation"%ROWTYPE;row JSONB;peer JSONB;BEGIN
 SELECT * INTO r FROM public."FinanceReconciliation" WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD."reconciliationId" ELSE NEW."reconciliationId" END;
 IF r.state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_RECON_IMMUTABLE' USING ERRCODE='P0001';END IF;IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.id,NEW."reconciliationId",NEW."rowKey",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."reconciliationId",OLD."rowKey",OLD."createdAt") THEN RAISE EXCEPTION 'FINANCE_RECON_IMMUTABLE' USING ERRCODE='P0001';END IF;
 SELECT value INTO row FROM jsonb_array_elements(r."sourceProof"->'rows') WHERE value->>'key'=NEW."rowKey";
 IF row IS NULL THEN RAISE EXCEPTION 'FINANCE_RECON_SOURCE' USING ERRCODE='P0001';END IF;
 IF NEW.kind='EXCLUDE_DUPLICATE' THEN
  peer:=public.encova_finance_reconciliation_position('STATEMENT',NEW."peerStatementLineId",r."cutoffDate");
  IF row#>>'{source,kind}'<>'STATEMENT' OR NEW."peerStatementLineId"=(row#>>'{source,id}')::uuid OR peer#>>'{source,batchId}'=row#>>'{source,batchId}' OR peer#>>'{source,cashAccountId}'<>r."cashAccountId"::text OR peer#>>'{source,glAccountId}'<>r."glAccountId"::text OR peer#>>'{source,fingerprint}' IS DISTINCT FROM row#>>'{source,fingerprint}' OR(peer->>'remaining')::numeric<>0 OR(peer#>>'{source,date}')::date>r."cutoffDate" OR NOT EXISTS(SELECT 1 FROM public."FinanceStatementBatch" b WHERE b.id=(peer#>>'{source,batchId}')::uuid AND b.state='IMPORTED') THEN RAISE EXCEPTION 'FINANCE_RECON_DUPLICATE' USING ERRCODE='P0001';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceReconciliationNote_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceReconciliationNote" FOR EACH ROW EXECUTE FUNCTION encova_finance_reconciliation_note_guard();
CREATE FUNCTION encova_finance_reconciliation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE prior public."FinanceReconciliation"%ROWTYPE;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_RECON_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'DRAFT' OR NEW.version<>1 OR NEW."finalSnapshot" IS NOT NULL OR NEW."finalizedAt" IS NOT NULL OR NEW."finalizedById" IS NOT NULL OR NEW."reopenedAt" IS NOT NULL OR NEW."reopenedById" IS NOT NULL OR NEW."reopenReason" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_RECON_SOURCE' USING ERRCODE='P0001';END IF;
  IF NEW."sourceProof" IS DISTINCT FROM public.encova_finance_reconciliation_prepare(NEW."cashAccountId",NEW."statementBatchId",NEW."startDate",NEW."cutoffDate",NEW."openingBalance",NEW."closingBalance") THEN RAISE EXCEPTION 'FINANCE_RECON_SOURCE' USING ERRCODE='P0001';END IF;
  SELECT m.* INTO prior FROM public."FinanceReconciliation" m WHERE m."cashAccountId"=NEW."cashAccountId" AND m."cutoffDate"=NEW."cutoffDate" AND NOT EXISTS(SELECT 1 FROM public."FinanceReconciliation" child WHERE child."replacesId"=m.id) ORDER BY m."createdAt" DESC,m.id DESC LIMIT 1;
  IF prior.id IS NOT NULL AND(prior.state NOT IN('VOIDED','REOPENED') OR NEW."replacesId" IS DISTINCT FROM prior.id) OR(prior.id IS NULL AND NEW."replacesId" IS NOT NULL) THEN RAISE EXCEPTION 'FINANCE_RECON_REPLACEMENT' USING ERRCODE='P0001';END IF;
 ELSE
  IF NEW.version<>OLD.version+1 OR ROW(NEW.id,NEW.number,NEW."companyName",NEW."cashAccountId",NEW."glAccountId",NEW."statementBatchId",NEW."startDate",NEW."cutoffDate",NEW."openingBalance",NEW."closingBalance",NEW.evidence,NEW."replacesId",NEW."createdById",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD.number,OLD."companyName",OLD."cashAccountId",OLD."glAccountId",OLD."statementBatchId",OLD."startDate",OLD."cutoffDate",OLD."openingBalance",OLD."closingBalance",OLD.evidence,OLD."replacesId",OLD."createdById",OLD."createdAt") THEN RAISE EXCEPTION 'FINANCE_RECON_IMMUTABLE' USING ERRCODE='P0001';END IF;
  IF OLD.state IN('VOIDED','REOPENED') OR(OLD.state='FINALIZED' AND(NEW.state<>'REOPENED' OR NEW."sourceProof" IS DISTINCT FROM OLD."sourceProof" OR NEW."finalSnapshot" IS DISTINCT FROM OLD."finalSnapshot" OR NEW."finalizedAt" IS DISTINCT FROM OLD."finalizedAt" OR NEW."finalizedById" IS DISTINCT FROM OLD."finalizedById")) OR(OLD.state='DRAFT' AND NEW.state NOT IN('DRAFT','FINALIZED','VOIDED')) THEN RAISE EXCEPTION 'FINANCE_RECON_IMMUTABLE' USING ERRCODE='P0001';END IF;
 END IF;
 IF NEW."basisHash" IS DISTINCT FROM NEW."sourceProof"->>'basisHash' OR NEW."sourceProof"->>'glAccountId' IS DISTINCT FROM NEW."glAccountId"::text THEN RAISE EXCEPTION 'FINANCE_RECON_SOURCE' USING ERRCODE='P0001';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FinanceReconciliation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceReconciliation" FOR EACH ROW EXECUTE FUNCTION encova_finance_reconciliation_guard();
CREATE FUNCTION encova_finance_reconciliation_validate(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r public."FinanceReconciliation"%ROWTYPE;item JSONB;n public."FinanceReconciliationNote"%ROWTYPE;peer JSONB;BEGIN
 SELECT * INTO r FROM public."FinanceReconciliation" WHERE id=target;
 IF r."sourceProof" IS DISTINCT FROM public.encova_finance_reconciliation_prepare(r."cashAccountId",r."statementBatchId",r."startDate",r."cutoffDate",r."openingBalance",r."closingBalance") THEN RAISE EXCEPTION 'FINANCE_RECON_STALE' USING ERRCODE='P0001';END IF;
 IF(r."sourceProof"->>'explainedDifference')::numeric<>0 THEN RAISE EXCEPTION 'FINANCE_RECON_DIFFERENCE' USING ERRCODE='P0001';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(r."sourceProof"->'rows') LOOP
  SELECT * INTO n FROM public."FinanceReconciliationNote" WHERE "reconciliationId"=r.id AND "rowKey"=item->>'key';
  IF item#>>'{source,kind}'='CASH' THEN IF n.id IS NULL OR n.kind<>'DOCUMENT' THEN RAISE EXCEPTION 'FINANCE_RECON_DOCUMENTATION' USING ERRCODE='P0001';END IF;
  ELSE
   IF n.id IS NULL OR n.kind<>'EXCLUDE_DUPLICATE' THEN RAISE EXCEPTION 'FINANCE_RECON_UNRESOLVED' USING ERRCODE='P0001';END IF;
   peer:=public.encova_finance_reconciliation_position('STATEMENT',n."peerStatementLineId",r."cutoffDate");
   IF peer#>>'{source,fingerprint}' IS DISTINCT FROM item#>>'{source,fingerprint}' OR(peer->>'remaining')::numeric<>0 OR(peer#>>'{source,date}')::date>r."cutoffDate" OR NOT EXISTS(SELECT 1 FROM public."FinanceStatementBatch" b WHERE b.id=(peer#>>'{source,batchId}')::uuid AND b.state='IMPORTED') THEN RAISE EXCEPTION 'FINANCE_RECON_DUPLICATE' USING ERRCODE='P0001';END IF;
  END IF;
 END LOOP;
END $$;
CREATE FUNCTION encova_finance_reconciliation_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r public."FinanceReconciliation"%ROWTYPE;BEGIN
 SELECT * INTO r FROM public."FinanceReconciliation" WHERE id=NEW.id;
 IF r.state='FINALIZED' THEN
  PERFORM public.encova_finance_reconciliation_validate(r.id);
  IF r."finalizedById" IS NULL OR r."finalizedAt" IS NULL OR r."finalSnapshot" IS DISTINCT FROM public.encova_finance_reconciliation_snapshot(r.id) THEN RAISE EXCEPTION 'FINANCE_RECON_SOURCE' USING ERRCODE='P0001';END IF;
 ELSIF r.state='REOPENED' THEN IF r."finalSnapshot" IS NULL OR r."reopenedAt" IS NULL OR r."reopenedById" IS NULL OR length(trim(r."reopenReason")) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_RECON_SOURCE' USING ERRCODE='P0001';END IF;
 ELSIF r."finalSnapshot" IS NOT NULL OR r."finalizedAt" IS NOT NULL OR r."finalizedById" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_RECON_SOURCE' USING ERRCODE='P0001';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FinanceReconciliation_valid" AFTER INSERT OR UPDATE ON "FinanceReconciliation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_reconciliation_check();
CREATE FUNCTION encova_finance_reconciliation_cash_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE posted DATE;BEGIN
 SELECT "postingDate" INTO posted FROM public."FinanceJournalEntry" WHERE id=NEW."journalId";
 IF EXISTS(SELECT 1 FROM public."FinanceReconciliation" r WHERE r."glAccountId"=NEW."accountId" AND r.state='FINALIZED' AND posted<=r."cutoffDate") THEN RAISE EXCEPTION 'FINANCE_RECON_CLOSED' USING ERRCODE='P0001';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FinanceJournalLine_reconciliation_valid" AFTER INSERT ON "FinanceJournalLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_reconciliation_cash_guard();
CREATE FUNCTION encova_finance_reconciliation_match_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM public."FinanceBankMatchAllocation" a JOIN public."FinanceBankMatch" m ON m.id=a."matchId" JOIN public."FinanceReconciliation" r ON r."glAccountId"=m."glAccountId" WHERE a.id=NEW."allocationId" AND r.state='FINALIZED' AND NEW."effectiveDate"<=r."cutoffDate") THEN RAISE EXCEPTION 'FINANCE_RECON_CLOSED' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceBankMatchEvent_reconciliation_valid" BEFORE INSERT ON "FinanceBankMatchEvent" FOR EACH ROW EXECUTE FUNCTION encova_finance_reconciliation_match_guard();
CREATE FUNCTION encova_finance_reconciliation_statement_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF OLD.state='IMPORTED' AND NEW.state='VOIDED' AND EXISTS(SELECT 1 FROM public."FinanceReconciliation" r WHERE r.state='FINALIZED' AND(r."statementBatchId"=OLD.id OR EXISTS(SELECT 1 FROM public."FinanceReconciliationNote" n JOIN public."FinanceStatementLine" l ON l.id=n."peerStatementLineId" WHERE n."reconciliationId"=r.id AND l."batchId"=OLD.id))) THEN RAISE EXCEPTION 'FINANCE_RECON_CLOSED' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceStatementBatch_reconciliation_valid" BEFORE UPDATE ON "FinanceStatementBatch" FOR EACH ROW EXECUTE FUNCTION encova_finance_reconciliation_statement_guard();
CREATE FUNCTION encova_finance_reconciliation_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public."FinanceReconciliation"%ROWTYPE;prior public."FinanceReconciliation"%ROWTYPE;batch public."FinanceStatementBatch"%ROWTYPE;receipt public."FinanceLedgerReceipt"%ROWTYPE;proof JSONB;old_snapshot JSONB;item JSONB;allowed TEXT[];why TEXT;digest TEXT;result JSONB;start_date DATE;cutoff DATE;opening NUMERIC;closing NUMERIC;bank_id UUID;batch_id UUID;period_id UUID;BEGIN
 IF action IS NULL OR action NOT IN('CREATE','NOTES','REFRESH','FINALIZE','VOID','REOPEN') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 allowed:=CASE WHEN action='CREATE' THEN CASE WHEN input->>'mode'='STATEMENT' THEN ARRAY['mode','cashAccountId','statementBatchId','evidence','replacesId','expectedPriorVersion','reason'] ELSE ARRAY['mode','cashAccountId','startDate','cutoffDate','openingBalance','closingBalance','evidence','replacesId','expectedPriorVersion','reason'] END WHEN action='NOTES' THEN ARRAY['id','expectedVersion','notes','reason'] ELSE ARRAY['id','expectedVersion','reason'] END;
 why:=trim(input->>'reason');IF jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR length(why) NOT BETWEEN 3 AND 500 OR input-allowed<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');SELECT * INTO receipt FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation='RECON_'||action AND key=request_key;
 PERFORM pg_advisory_xact_lock(629815);IF receipt.id IS NOT NULL THEN IF receipt."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN receipt.result;END IF;
 IF action='CREATE' THEN
  IF input->>'mode' IS NULL OR input->>'mode' NOT IN('STATEMENT','ZERO_ACTIVITY') OR jsonb_typeof(input->'evidence') IS DISTINCT FROM 'string' OR length(trim(input->>'evidence')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  bank_id:=(input->>'cashAccountId')::uuid;
  IF input->>'mode'='STATEMENT' THEN
   SELECT * INTO batch FROM public."FinanceStatementBatch" WHERE id=(input->>'statementBatchId')::uuid AND "cashAccountId"=bank_id AND state='IMPORTED';IF batch.id IS NULL THEN RAISE EXCEPTION 'FINANCE_RECON_SOURCE' USING ERRCODE='P0001';END IF;
   batch_id:=batch.id;start_date:=batch."startDate";cutoff:=batch."endDate";opening:=batch."openingBalance";closing:=batch."closingBalance";
  ELSE
   IF EXISTS(SELECT 1 FROM unnest(ARRAY['startDate','cutoffDate','openingBalance','closingBalance'])k WHERE jsonb_typeof(input->k) IS DISTINCT FROM 'string') OR input->>'startDate'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR input->>'cutoffDate'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR input->>'openingBalance'!~'^-?(0|[1-9][0-9]{0,17})[.][0-9]{2}$' OR input->>'closingBalance'!~'^-?(0|[1-9][0-9]{0,17})[.][0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   start_date:=(input->>'startDate')::date;cutoff:=(input->>'cutoffDate')::date;opening:=(input->>'openingBalance')::numeric;closing:=(input->>'closingBalance')::numeric;
  END IF;
  proof:=public.encova_finance_reconciliation_prepare(bank_id,batch_id,start_date,cutoff,opening,closing);
  IF NOT EXISTS(SELECT 1 FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" a ON a.id=c."glAccountId" WHERE c.id=bank_id AND c.active AND a.active AND a."isPosting") THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  SELECT m.* INTO prior FROM public."FinanceReconciliation" m WHERE m."cashAccountId"=bank_id AND m."cutoffDate"=cutoff AND NOT EXISTS(SELECT 1 FROM public."FinanceReconciliation" child WHERE child."replacesId"=m.id) ORDER BY m."createdAt" DESC,m.id DESC LIMIT 1 FOR UPDATE;
  IF prior.id IS NOT NULL AND(prior.state NOT IN('VOIDED','REOPENED') OR prior.id IS DISTINCT FROM(input->>'replacesId')::uuid OR jsonb_typeof(input->'expectedPriorVersion') IS DISTINCT FROM 'number' OR prior.version<>(input->>'expectedPriorVersion')::integer) OR(prior.id IS NULL AND(input->>'replacesId' IS NOT NULL OR input->>'expectedPriorVersion' IS NOT NULL)) THEN RAISE EXCEPTION 'FINANCE_RECON_REPLACEMENT' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinanceReconciliation"(id,number,"companyName","cashAccountId","glAccountId","statementBatchId","startDate","cutoffDate","openingBalance","closingBalance",evidence,"basisHash","sourceProof","replacesId","createdById") VALUES(gen_random_uuid(),'REC-'||lpad(nextval('public.finance_reconciliation_number')::text,10,'0'),coalesce((SELECT "companyName" FROM public."CompanySettings" ORDER BY id LIMIT 1),'Encova Solutions'),bank_id,(proof->>'glAccountId')::uuid,batch_id,start_date,cutoff,opening,closing,trim(input->>'evidence'),proof->>'basisHash',proof,prior.id,actor) RETURNING * INTO r;
 ELSE
  SELECT * INTO r FROM public."FinanceReconciliation" WHERE id=(input->>'id')::uuid FOR UPDATE;IF r.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR r.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  old_snapshot:=coalesce(r."finalSnapshot",public.encova_finance_reconciliation_snapshot(r.id));
  IF action='REOPEN' THEN
   IF r.state<>'FINALIZED' THEN RAISE EXCEPTION 'FINANCE_RECON_IMMUTABLE' USING ERRCODE='P0001';END IF;
   IF NOT EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=actor) THEN RAISE EXCEPTION 'FINANCE_OWNER_REQUIRED' USING ERRCODE='P0001';END IF;
   IF EXISTS(SELECT 1 FROM public."FinanceReconciliation" WHERE "cashAccountId"=r."cashAccountId" AND state='FINALIZED' AND "cutoffDate">r."cutoffDate") THEN RAISE EXCEPTION 'FINANCE_RECON_REOPEN_ORDER' USING ERRCODE='P0001';END IF;
   UPDATE public."FinanceReconciliation" SET state='REOPENED',version=version+1,"reopenedById"=actor,"reopenedAt"=CURRENT_TIMESTAMP,"reopenReason"=why,"updatedAt"=CURRENT_TIMESTAMP WHERE id=r.id RETURNING * INTO r;
  ELSE
   IF r.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_RECON_IMMUTABLE' USING ERRCODE='P0001';END IF;
   IF action='NOTES' THEN
    IF jsonb_typeof(input->'notes') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'notes') NOT BETWEEN 1 AND 100 OR(SELECT count(DISTINCT value->>'rowKey') FROM jsonb_array_elements(input->'notes'))<>jsonb_array_length(input->'notes') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(input->'notes') LOOP
     IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['rowKey','kind','note','peerStatementLineId']<>'{}'::jsonb OR EXISTS(SELECT 1 FROM unnest(ARRAY['rowKey','kind','note'])k WHERE jsonb_typeof(item->k) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
     INSERT INTO public."FinanceReconciliationNote"(id,"reconciliationId","rowKey",kind,note,"peerStatementLineId","updatedById") VALUES(gen_random_uuid(),r.id,item->>'rowKey',item->>'kind',trim(item->>'note'),(item->>'peerStatementLineId')::uuid,actor) ON CONFLICT("reconciliationId","rowKey") DO UPDATE SET kind=EXCLUDED.kind,note=EXCLUDED.note,"peerStatementLineId"=EXCLUDED."peerStatementLineId","updatedById"=actor,"updatedAt"=CURRENT_TIMESTAMP;
    END LOOP;
    UPDATE public."FinanceReconciliation" SET version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=r.id RETURNING * INTO r;
   ELSIF action='REFRESH' THEN
    proof:=public.encova_finance_reconciliation_prepare(r."cashAccountId",r."statementBatchId",r."startDate",r."cutoffDate",r."openingBalance",r."closingBalance");DELETE FROM public."FinanceReconciliationNote" WHERE "reconciliationId"=r.id;
    UPDATE public."FinanceReconciliation" SET "sourceProof"=proof,"basisHash"=proof->>'basisHash',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=r.id RETURNING * INTO r;
   ELSIF action='VOID' THEN
    UPDATE public."FinanceReconciliation" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=r.id RETURNING * INTO r;
   ELSE
    PERFORM public.encova_finance_reconciliation_validate(r.id);
    IF NOT EXISTS(SELECT 1 FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" a ON a.id=c."glAccountId" WHERE c.id=r."cashAccountId" AND c."glAccountId"=r."glAccountId" AND c.active AND a.active AND a."isPosting") THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
    SELECT id INTO period_id FROM public."FinancePeriod" WHERE state='OPEN' AND r."cutoffDate" BETWEEN "startDate" AND "endDate" FOR UPDATE;IF period_id IS NULL THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001';END IF;
    UPDATE public."FinancePeriod" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=period_id;
    UPDATE public."FinanceReconciliation" SET state='FINALIZED',version=version+1,"finalizedById"=actor,"finalizedAt"=CURRENT_TIMESTAMP,"finalSnapshot"=public.encova_finance_reconciliation_snapshot(r.id),"updatedAt"=CURRENT_TIMESTAMP WHERE id=r.id RETURNING * INTO r;
   END IF;
  END IF;
 END IF;
 result:=jsonb_build_object('id',r.id,'number',r.number,'version',r.version,'state',r.state);
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,'RECON_'||action,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_RECON_'||action,'FinanceReconciliation',r.id,why,jsonb_build_object('before',old_snapshot,'after',public.encova_finance_reconciliation_snapshot(r.id),'state',r.state,'version',r.version),request_id);RETURN result;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';WHEN data_exception OR check_violation OR not_null_violation OR foreign_key_violation THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END $$;
CREATE FUNCTION encova_finance_reconciliation_review(actor UUID,target UUID,requested_page INTEGER) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r public."FinanceReconciliation"%ROWTYPE;total INTEGER;page INTEGER;pages INTEGER;undocumented INTEGER;unresolved INTEGER;items JSONB;stale BOOLEAN:=false;unavailable BOOLEAN:=false;BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF requested_page IS NULL OR requested_page NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 SELECT * INTO r FROM public."FinanceReconciliation" WHERE id=target;IF r.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
 total:=jsonb_array_length(r."sourceProof"->'rows');pages:=greatest(1,ceil(total/25.0)::integer);page:=least(requested_page,pages);
 IF r.state='DRAFT' THEN BEGIN stale:=r."basisHash" IS DISTINCT FROM public.encova_finance_reconciliation_prepare(r."cashAccountId",r."statementBatchId",r."startDate",r."cutoffDate",r."openingBalance",r."closingBalance")->>'basisHash';EXCEPTION WHEN SQLSTATE 'P0001' THEN stale:=true;unavailable:=true;END;END IF;
 SELECT count(*) FILTER(WHERE x#>>'{source,kind}'='CASH' AND(n.id IS NULL OR n.kind<>'DOCUMENT')),count(*) FILTER(WHERE x#>>'{source,kind}'='STATEMENT' AND(n.id IS NULL OR n.kind<>'EXCLUDE_DUPLICATE')) INTO undocumented,unresolved FROM jsonb_array_elements(r."sourceProof"->'rows')x LEFT JOIN public."FinanceReconciliationNote" n ON n."reconciliationId"=r.id AND n."rowKey"=x->>'key';
 SELECT coalesce(jsonb_agg(b.item||jsonb_build_object('review',CASE WHEN n.id IS NULL THEN NULL ELSE jsonb_build_object('kind',n.kind,'note',n.note,'peerStatementLineId',n."peerStatementLineId",'updatedAt',n."updatedAt") END) ORDER BY b.seq),'[]'::jsonb) INTO items FROM(SELECT value AS item,ordinality AS seq FROM jsonb_array_elements(r."sourceProof"->'rows') WITH ORDINALITY ORDER BY ordinality LIMIT 25 OFFSET(page-1)*25)b LEFT JOIN public."FinanceReconciliationNote" n ON n."reconciliationId"=r.id AND n."rowKey"=b.item->>'key';
 RETURN jsonb_build_object('totals',r."sourceProof"-ARRAY['rows','ledgerDigest','matchDigest'],'items',items,'total',total,'page',page,'pages',pages,'undocumentedCount',undocumented,'unresolvedCount',unresolved,'basisStale',stale,'sourceUnavailable',unavailable,'generatedAt',CASE WHEN r."finalSnapshot" IS NULL THEN to_jsonb(r."createdAt") ELSE r."finalSnapshot"->'generatedAt' END);
END $$;
CREATE FUNCTION encova_finance_reconciliation_peers(actor UUID,target UUID,row_key TEXT,search TEXT,requested_page INTEGER) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE r public."FinanceReconciliation"%ROWTYPE;item JSONB;items JSONB;total INTEGER;page INTEGER;pages INTEGER;BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF requested_page IS NULL OR requested_page NOT BETWEEN 1 AND 10000 OR search IS NULL OR length(search)>100 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 SELECT * INTO r FROM public."FinanceReconciliation" WHERE id=target;IF r.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
 SELECT value INTO item FROM jsonb_array_elements(r."sourceProof"->'rows') WHERE value->>'key'=row_key AND value#>>'{source,kind}'='STATEMENT';IF item IS NULL THEN RAISE EXCEPTION 'FINANCE_RECON_SOURCE' USING ERRCODE='P0001';END IF;
 SELECT count(*) INTO total FROM public."FinanceStatementLine" l JOIN public."FinanceStatementBatch" b ON b.id=l."batchId" WHERE b.id<>r."statementBatchId" AND b.state='IMPORTED' AND b."cashAccountId"=r."cashAccountId" AND b."glAccountId"=r."glAccountId" AND l.fingerprint=item#>>'{source,fingerprint}' AND l."valueDate"<=r."cutoffDate" AND concat_ws(' ',b.number,l.description,l."bankReference") ILIKE '%'||search||'%' AND l.amount=(SELECT coalesce(sum(e.delta),0) FROM public."FinanceBankMatchAllocation" a JOIN public."FinanceBankMatchEvent" e ON e."allocationId"=a.id WHERE a."statementLineId"=l.id AND e."effectiveDate"<=r."cutoffDate");
 pages:=greatest(1,ceil(total/25.0)::integer);page:=least(requested_page,pages);
 SELECT coalesce(jsonb_agg(to_jsonb(bounded) ORDER BY bounded."valueDate",bounded.id),'[]'::jsonb) INTO items FROM(SELECT l.id,b.id AS "batchId",b.number,l."valueDate",l.description,l."bankReference",l.amount::text AS amount FROM public."FinanceStatementLine" l JOIN public."FinanceStatementBatch" b ON b.id=l."batchId" WHERE b.id<>r."statementBatchId" AND b.state='IMPORTED' AND b."cashAccountId"=r."cashAccountId" AND b."glAccountId"=r."glAccountId" AND l.fingerprint=item#>>'{source,fingerprint}' AND l."valueDate"<=r."cutoffDate" AND concat_ws(' ',b.number,l.description,l."bankReference") ILIKE '%'||search||'%' AND l.amount=(SELECT coalesce(sum(e.delta),0) FROM public."FinanceBankMatchAllocation" a JOIN public."FinanceBankMatchEvent" e ON e."allocationId"=a.id WHERE a."statementLineId"=l.id AND e."effectiveDate"<=r."cutoffDate") ORDER BY l."valueDate",l.id LIMIT 25 OFFSET(page-1)*25)bounded;
 RETURN jsonb_build_object('items',items,'total',total,'page',page,'pages',pages);
END $$;
DO $$ DECLARE t TEXT;f RECORD;role_name TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceReconciliation','FinanceReconciliationNote'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,role_name);END IF;END LOOP;END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'encova_finance_reconciliation_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);FOREACH role_name IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name);END IF;END LOOP;END LOOP;
 REVOKE ALL ON SEQUENCE public.finance_reconciliation_number FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION public.encova_finance_reconciliation_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID),public.encova_finance_reconciliation_review(UUID,UUID,INTEGER),public.encova_finance_reconciliation_peers(UUID,UUID,TEXT,TEXT,INTEGER) TO encova_app;END IF;
END $$;
COMMIT;
