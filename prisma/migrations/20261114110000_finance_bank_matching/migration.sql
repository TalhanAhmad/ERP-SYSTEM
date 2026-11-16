BEGIN;
CREATE SEQUENCE finance_bank_match_number AS BIGINT MINVALUE 1 MAXVALUE 9999999999 NO CYCLE;
CREATE TABLE "FinanceBankMatch"(id UUID PRIMARY KEY,number TEXT NOT NULL UNIQUE,"cashAccountId" UUID NOT NULL REFERENCES "FinanceCashAccount" ON DELETE RESTRICT,"glAccountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 1000),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),"earliestDate" DATE NOT NULL CHECK("earliestDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),"latestDate" DATE NOT NULL CHECK("latestDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','MATCHED','UNMATCHED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"sourceSnapshot" JSONB NOT NULL,"unmatchedAt" TIMESTAMPTZ,"unmatchedById" UUID REFERENCES "Person" ON DELETE RESTRICT,"unmatchReason" TEXT,"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK("earliestDate"<="latestDate"),CHECK((state='UNMATCHED')=("unmatchedAt" IS NOT NULL AND "unmatchedById" IS NOT NULL AND length(trim("unmatchReason")) BETWEEN 3 AND 500)));
CREATE INDEX "FinanceBankMatch_cashAccountId_state_latestDate_id_idx" ON "FinanceBankMatch"("cashAccountId",state,"latestDate",id);
CREATE TABLE "FinanceBankMatchAllocation"(id UUID PRIMARY KEY,"matchId" UUID NOT NULL REFERENCES "FinanceBankMatch" ON DELETE RESTRICT,sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 100),"statementLineId" UUID NOT NULL REFERENCES "FinanceStatementLine" ON DELETE RESTRICT,"journalLineId" UUID NOT NULL REFERENCES "FinanceJournalLine" ON DELETE RESTRICT,amount NUMERIC(20,2) NOT NULL CHECK(amount>0),"effectiveDate" DATE NOT NULL CHECK("effectiveDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),"sourceSnapshot" JSONB NOT NULL,UNIQUE("matchId",sequence),UNIQUE("matchId","statementLineId","journalLineId"));
CREATE INDEX "FinanceBankMatchAllocation_statementLineId_matchId_id_idx" ON "FinanceBankMatchAllocation"("statementLineId","matchId",id);
CREATE INDEX "FinanceBankMatchAllocation_journalLineId_matchId_id_idx" ON "FinanceBankMatchAllocation"("journalLineId","matchId",id);
CREATE TABLE "FinanceBankMatchEvent"(id UUID PRIMARY KEY,"allocationId" UUID NOT NULL REFERENCES "FinanceBankMatchAllocation" ON DELETE RESTRICT,kind TEXT NOT NULL CHECK(kind IN('MATCH','UNMATCH')),delta NUMERIC(20,2) NOT NULL,"effectiveDate" DATE NOT NULL CHECK("effectiveDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK((kind='MATCH' AND delta>0) OR(kind='UNMATCH' AND delta<0)),UNIQUE("allocationId",kind));
CREATE INDEX "FinanceBankMatchEvent_effectiveDate_allocationId_id_idx" ON "FinanceBankMatchEvent"("effectiveDate","allocationId",id);
CREATE FUNCTION encova_finance_bank_match_source(kind TEXT,target UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE result JSONB;BEGIN
 IF kind='STATEMENT' THEN
  SELECT jsonb_build_object('kind','STATEMENT','id',l.id,'batchId',b.id,'number',b.number,'cashAccountId',b."cashAccountId",'glAccountId',b."glAccountId",'sequence',l.sequence,'sourceRow',l."sourceRow",'date',l."valueDate",'direction',l.direction,'amount',l.amount::text,'description',l.description,'bankReference',l."bankReference",'fingerprint',l.fingerprint,'fileSha256',b.sha256) INTO result FROM public."FinanceStatementLine" l JOIN public."FinanceStatementBatch" b ON b.id=l."batchId" WHERE l.id=target;
 ELSIF kind='CASH' THEN
  SELECT jsonb_build_object('kind','CASH','id',l.id,'journalId',e.id,'reference',e.reference,'sourceType',e."sourceType",'sourceId',e."sourceId",'accountId',l."accountId",'sequence',l.sequence,'date',e."postingDate",'debit',l.debit::text,'credit',l.credit::text,'amount',(CASE WHEN l.debit>0 THEN l.debit ELSE l.credit END)::text,'direction',CASE WHEN l.debit>0 THEN 'RECEIPT' ELSE 'PAYMENT' END,'description',l.description,'projectId',l."projectId",'partyId',l."partyId") INTO result FROM public."FinanceJournalLine" l JOIN public."FinanceJournalEntry" e ON e.id=l."journalId" JOIN public."FinanceAccount" a ON a.id=l."accountId" WHERE l.id=target AND a."controlType"='CASH' AND e.currency='PKR' AND e."sourceType" NOT IN('YEAR_CLOSE','OPENING');
 ELSE RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 RETURN result;
END $$;
CREATE FUNCTION encova_finance_bank_match_position(source_kind TEXT,target UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE source JSONB;allocated NUMERIC;digest TEXT;BEGIN
 source:=public.encova_finance_bank_match_source(source_kind,target);IF source IS NULL THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_SOURCE' USING ERRCODE='P0001';END IF;
 SELECT coalesce(sum(e.delta),0),encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('id',e.id,'delta',e.delta::text,'date',e."effectiveDate") ORDER BY e.id),'[]'::jsonb)::text,'UTF8')),'hex') INTO allocated,digest FROM public."FinanceBankMatchEvent" e JOIN public."FinanceBankMatchAllocation" a ON a.id=e."allocationId" WHERE(source_kind='STATEMENT' AND a."statementLineId"=target) OR(source_kind='CASH' AND a."journalLineId"=target);
 RETURN jsonb_build_object('source',source,'allocated',round(allocated,2)::text,'remaining',round((source->>'amount')::numeric-allocated,2)::text,'eventDigest',digest);
END $$;
CREATE FUNCTION encova_finance_bank_match_prepare(bank_id UUID,input JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE bank public."FinanceCashAccount"%ROWTYPE;r JSONB;stmt JSONB;cash JSONB;rows JSONB:='[]'::jsonb;proposal JSONB;n INTEGER:=0;amount NUMERIC;effective DATE;first_date DATE;last_date DATE;receipts NUMERIC:=0;payments NUMERIC:=0;BEGIN
 SELECT c.* INTO bank FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" a ON a.id=c."glAccountId" WHERE c.id=bank_id AND c.active AND c.currency='PKR' AND a.active AND a.currency='PKR' AND a."isPosting" AND a."controlType"='CASH';
 IF bank.id IS NULL THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'array' OR jsonb_array_length(input) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(input) LOOP
  n:=n+1;IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['statementLineId','journalLineId','amount']<>'{}'::jsonb OR jsonb_typeof(r->'amount') IS DISTINCT FROM 'string' OR r->>'amount'!~'^(0|[1-9][0-9]{0,17})[.][0-9]{2}$' OR(r->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  stmt:=public.encova_finance_bank_match_position('STATEMENT',(r->>'statementLineId')::uuid);cash:=public.encova_finance_bank_match_position('CASH',(r->>'journalLineId')::uuid);amount:=(r->>'amount')::numeric;
  IF stmt#>>'{source,cashAccountId}' IS DISTINCT FROM bank.id::text OR stmt#>>'{source,glAccountId}' IS DISTINCT FROM bank."glAccountId"::text OR cash#>>'{source,accountId}' IS DISTINCT FROM bank."glAccountId"::text OR stmt#>>'{source,direction}' IS DISTINCT FROM cash#>>'{source,direction}' OR NOT EXISTS(SELECT 1 FROM public."FinanceStatementBatch" s WHERE s.id=(stmt#>>'{source,batchId}')::uuid AND s.state='IMPORTED') THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_SOURCE' USING ERRCODE='P0001';END IF;
  effective:=greatest((stmt#>>'{source,date}')::date,(cash#>>'{source,date}')::date);
  IF effective>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'FINANCE_FUTURE_DATE' USING ERRCODE='P0001';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."FinancePeriod" p WHERE p.state='OPEN' AND effective BETWEEN p."startDate" AND p."endDate") THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  first_date:=least(first_date,effective);last_date:=greatest(last_date,effective);
  IF stmt#>>'{source,direction}'='RECEIPT' THEN receipts:=receipts+amount;ELSE payments:=payments+amount;END IF;
  rows:=rows||jsonb_build_array(jsonb_build_object('sequence',n,'statementLineId',r->>'statementLineId','journalLineId',r->>'journalLineId','amount',round(amount,2)::text,'effectiveDate',effective,'statement',stmt,'cash',cash));
 END LOOP;
 IF(SELECT count(DISTINCT(value->>'statementLineId',value->>'journalLineId')) FROM jsonb_array_elements(rows))<>n THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_DUPLICATE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(rows)x GROUP BY x->>'statementLineId' HAVING sum((x->>'amount')::numeric)>min((x#>>'{statement,remaining}')::numeric)) OR EXISTS(SELECT 1 FROM jsonb_array_elements(rows)x GROUP BY x->>'journalLineId' HAVING sum((x->>'amount')::numeric)>min((x#>>'{cash,remaining}')::numeric)) THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_CAPACITY' USING ERRCODE='P0001';END IF;
 proposal:=jsonb_build_object('cashAccountId',bank.id,'glAccountId',bank."glAccountId",'currency','PKR','allocations',rows,'earliestDate',first_date,'latestDate',last_date,'receipts',round(receipts,2)::text,'payments',round(payments,2)::text);
 RETURN proposal||jsonb_build_object('basisHash',encode(sha256(convert_to(proposal::text,'UTF8')),'hex'));
END $$;
CREATE FUNCTION encova_finance_bank_match_snapshot(target UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',m.id,'number',m.number,'cashAccountId',m."cashAccountId",'glAccountId',m."glAccountId",'description',m.description,'evidence',m.evidence,'earliestDate',m."earliestDate",'latestDate',m."latestDate",'allocations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'sequence',a.sequence,'statementLineId',a."statementLineId",'journalLineId',a."journalLineId",'amount',a.amount::text,'effectiveDate',a."effectiveDate",'source',a."sourceSnapshot") ORDER BY a.sequence) FROM public."FinanceBankMatchAllocation" a WHERE a."matchId"=m.id),'[]'::jsonb)) FROM public."FinanceBankMatch" m WHERE m.id=target
$$;
CREATE FUNCTION encova_finance_bank_match_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 OR NEW.state<>'DRAFT' OR NEW."unmatchedAt" IS NOT NULL OR NEW."unmatchedById" IS NOT NULL OR NEW."unmatchReason" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;RETURN NEW;END IF;
 IF ROW(NEW.id,NEW.number,NEW."createdById",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD.number,OLD."createdById",OLD."createdAt") OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
 IF OLD.state='UNMATCHED' OR(OLD.state='DRAFT' AND NEW.state<>'MATCHED') OR(OLD.state='MATCHED' AND NEW.state<>'UNMATCHED') OR(to_jsonb(NEW)-ARRAY['state','sourceSnapshot','version','updatedAt','unmatchedAt','unmatchedById','unmatchReason']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','sourceSnapshot','version','updatedAt','unmatchedAt','unmatchedById','unmatchReason']) OR(OLD.state='MATCHED' AND NEW."sourceSnapshot" IS DISTINCT FROM OLD."sourceSnapshot") THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_IMMUTABLE' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceBankMatch_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceBankMatch" FOR EACH ROW EXECUTE FUNCTION encova_finance_bank_match_guard();
CREATE FUNCTION encova_finance_bank_match_allocation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE m public."FinanceBankMatch"%ROWTYPE;stmt JSONB;cash JSONB;BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_IMMUTABLE' USING ERRCODE='P0001';END IF;
 SELECT * INTO m FROM public."FinanceBankMatch" WHERE id=NEW."matchId";stmt:=public.encova_finance_bank_match_source('STATEMENT',NEW."statementLineId");cash:=public.encova_finance_bank_match_source('CASH',NEW."journalLineId");
 IF m.id IS NULL OR m.state<>'DRAFT' OR stmt IS NULL OR cash IS NULL OR stmt->>'cashAccountId' IS DISTINCT FROM m."cashAccountId"::text OR stmt->>'glAccountId' IS DISTINCT FROM m."glAccountId"::text OR cash->>'accountId' IS DISTINCT FROM m."glAccountId"::text OR stmt->>'direction' IS DISTINCT FROM cash->>'direction' OR NEW."effectiveDate"<>greatest((stmt->>'date')::date,(cash->>'date')::date) OR NEW."sourceSnapshot" IS DISTINCT FROM jsonb_build_object('statement',stmt,'cash',cash) THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_SOURCE' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceBankMatchAllocation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceBankMatchAllocation" FOR EACH ROW EXECUTE FUNCTION encova_finance_bank_match_allocation_guard();
CREATE FUNCTION encova_finance_bank_match_event_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE a public."FinanceBankMatchAllocation"%ROWTYPE;m public."FinanceBankMatch"%ROWTYPE;BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_IMMUTABLE' USING ERRCODE='P0001';END IF;
 SELECT * INTO a FROM public."FinanceBankMatchAllocation" WHERE id=NEW."allocationId";SELECT * INTO m FROM public."FinanceBankMatch" WHERE id=a."matchId";
 IF a.id IS NULL OR NEW."effectiveDate"<>a."effectiveDate" OR(NEW.kind='MATCH' AND(m.state<>'DRAFT' OR NEW.delta<>a.amount OR NEW."createdById"<>m."createdById")) OR(NEW.kind='UNMATCH' AND(m.state<>'MATCHED' OR NEW.delta<>-a.amount)) THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_SOURCE' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceBankMatchEvent_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceBankMatchEvent" FOR EACH ROW EXECUTE FUNCTION encova_finance_bank_match_event_guard();
CREATE FUNCTION encova_finance_bank_match_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE m public."FinanceBankMatch"%ROWTYPE;a public."FinanceBankMatchAllocation"%ROWTYPE;n INTEGER;earliest DATE;latest DATE;position JSONB;events RECORD;BEGIN
 SELECT * INTO m FROM public."FinanceBankMatch" WHERE id=NEW.id;SELECT count(*),min("effectiveDate"),max("effectiveDate") INTO n,earliest,latest FROM public."FinanceBankMatchAllocation" WHERE "matchId"=m.id;
 IF(m.state='MATCHED' AND(m."unmatchedAt" IS NOT NULL OR m."unmatchedById" IS NOT NULL OR m."unmatchReason" IS NOT NULL)) OR(m.state='UNMATCHED' AND(m."unmatchedAt" IS NULL OR m."unmatchedById" IS NULL OR m."unmatchReason" IS NULL)) THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_SOURCE' USING ERRCODE='P0001';END IF;
 IF m.state='DRAFT' OR n NOT BETWEEN 1 AND 100 OR earliest IS DISTINCT FROM m."earliestDate" OR latest IS DISTINCT FROM m."latestDate" OR m."sourceSnapshot" IS DISTINCT FROM public.encova_finance_bank_match_snapshot(m.id) THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_SOURCE' USING ERRCODE='P0001';END IF;
 FOR a IN SELECT * FROM public."FinanceBankMatchAllocation" WHERE "matchId"=m.id LOOP
  IF a."sourceSnapshot" IS DISTINCT FROM jsonb_build_object('statement',public.encova_finance_bank_match_source('STATEMENT',a."statementLineId"),'cash',public.encova_finance_bank_match_source('CASH',a."journalLineId")) THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_SOURCE' USING ERRCODE='P0001';END IF;
  SELECT count(*) AS n,count(*) FILTER(WHERE kind='MATCH' AND delta=a.amount AND "effectiveDate"=a."effectiveDate" AND "createdById"=m."createdById") AS positive,count(*) FILTER(WHERE kind='UNMATCH' AND delta=-a.amount AND "effectiveDate"=a."effectiveDate" AND "createdById"=m."unmatchedById" AND reason=m."unmatchReason") AS negative INTO events FROM public."FinanceBankMatchEvent" WHERE "allocationId"=a.id;
  IF events.positive<>1 OR events.n<>(CASE WHEN m.state='MATCHED' THEN 1 ELSE 2 END) OR events.negative<>(CASE WHEN m.state='MATCHED' THEN 0 ELSE 1 END) THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_SOURCE' USING ERRCODE='P0001';END IF;
  position:=public.encova_finance_bank_match_position('STATEMENT',a."statementLineId");IF(position->>'allocated')::numeric<0 OR(position->>'remaining')::numeric<0 THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_CAPACITY' USING ERRCODE='P0001';END IF;
  position:=public.encova_finance_bank_match_position('CASH',a."journalLineId");IF(position->>'allocated')::numeric<0 OR(position->>'remaining')::numeric<0 THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_CAPACITY' USING ERRCODE='P0001';END IF;
 END LOOP;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FinanceBankMatch_valid" AFTER INSERT OR UPDATE ON "FinanceBankMatch" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_bank_match_check();
CREATE FUNCTION encova_finance_bank_match_cash_reversal_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE original UUID;original_line UUID;BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=NEW."accountId" AND "controlType"='CASH') THEN RETURN NULL;END IF;
 SELECT coalesce(entry."reversalOfId",original_movement.id,original_customer.id,original_supplier.id,original_asset.id) INTO original FROM public."FinanceJournalEntry" entry
 LEFT JOIN public."FinanceMovement" movement ON movement.id=entry."movementId" LEFT JOIN public."FinanceJournalEntry" original_movement ON original_movement."movementId"=movement."reversalOfId"
 LEFT JOIN public."FinanceCustomerDocument" customer ON customer.id=entry."customerDocumentId" LEFT JOIN public."FinanceJournalEntry" original_customer ON original_customer."customerDocumentId"=customer."reversalOfId"
 LEFT JOIN public."FinanceSupplierDocument" supplier ON supplier.id=entry."supplierDocumentId" LEFT JOIN public."FinanceJournalEntry" original_supplier ON original_supplier."supplierDocumentId"=supplier."reversalOfId"
 LEFT JOIN public."FinanceAssetMovement" asset ON asset.id=entry."assetMovementId" LEFT JOIN public."FinanceJournalEntry" original_asset ON original_asset."assetMovementId"=asset."reversalOfId" WHERE entry.id=NEW."journalId";
 IF original IS NULL THEN RETURN NULL;END IF;
 SELECT id INTO original_line FROM public."FinanceJournalLine" WHERE "journalId"=original AND "accountId"=NEW."accountId" AND sequence=NEW.sequence;
 IF original_line IS NOT NULL AND EXISTS(SELECT 1 FROM public."FinanceBankMatchAllocation" a JOIN public."FinanceBankMatchEvent" e ON e."allocationId"=a.id WHERE a."journalLineId"=original_line GROUP BY a."journalLineId" HAVING sum(e.delta)>0) THEN RAISE EXCEPTION 'FINANCE_MATCHED_CASH' USING ERRCODE='P0001';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FinanceJournalLine_bank_match_reversal_valid" AFTER INSERT ON "FinanceJournalLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_bank_match_cash_reversal_guard();
CREATE FUNCTION encova_finance_bank_match_statement_void_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF OLD.state='IMPORTED' AND NEW.state='VOIDED' AND EXISTS(SELECT 1 FROM public."FinanceStatementLine" l JOIN public."FinanceBankMatchAllocation" a ON a."statementLineId"=l.id JOIN public."FinanceBankMatchEvent" e ON e."allocationId"=a.id WHERE l."batchId"=OLD.id GROUP BY l.id HAVING sum(e.delta)>0) THEN RAISE EXCEPTION 'FINANCE_MATCHED_STATEMENT' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceStatementBatch_bank_match_void_valid" BEFORE UPDATE ON "FinanceStatementBatch" FOR EACH ROW EXECUTE FUNCTION encova_finance_bank_match_statement_void_guard();
CREATE FUNCTION encova_finance_bank_match_event_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE allocation public."FinanceBankMatchAllocation"%ROWTYPE;matched public."FinanceBankMatch"%ROWTYPE;BEGIN
 SELECT * INTO allocation FROM public."FinanceBankMatchAllocation" WHERE id=NEW."allocationId";SELECT * INTO matched FROM public."FinanceBankMatch" WHERE id=allocation."matchId";
 IF matched.state='DRAFT' OR(NEW.kind='UNMATCH' AND(matched.state<>'UNMATCHED' OR NEW."createdById" IS DISTINCT FROM matched."unmatchedById" OR NEW.reason IS DISTINCT FROM matched."unmatchReason")) THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_SOURCE' USING ERRCODE='P0001';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FinanceBankMatchEvent_valid" AFTER INSERT ON "FinanceBankMatchEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_bank_match_event_check();
CREATE FUNCTION encova_finance_bank_match_preview(actor UUID,input JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['cashAccountId','allocations']<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 RETURN public.encova_finance_bank_match_prepare((input->>'cashAccountId')::uuid,input->'allocations');
 EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END $$;
CREATE FUNCTION encova_finance_bank_match_options(actor UUID,input JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE bank public."FinanceCashAccount"%ROWTYPE;kind TEXT;items JSONB;total INTEGER;page INTEGER;pages INTEGER;BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['kind','cashAccountId','q','page','from','to']<>'{}'::jsonb OR input->>'kind' NOT IN('STATEMENT','CASH') OR length(input->>'q')>100 OR(input->>'page')::integer NOT BETWEEN 1 AND 10000 OR(input->>'from')::date>(input->>'to')::date THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 SELECT c.* INTO bank FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" a ON a.id=c."glAccountId" WHERE c.id=(input->>'cashAccountId')::uuid AND c.active AND c.currency='PKR' AND a.active AND a.currency='PKR' AND a."isPosting" AND a."controlType"='CASH';IF bank.id IS NULL THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 kind:=input->>'kind';
 WITH candidates AS(
 SELECT l.id,l."valueDate" AS day FROM public."FinanceStatementLine" l JOIN public."FinanceStatementBatch" b ON b.id=l."batchId" WHERE kind='STATEMENT' AND b.state='IMPORTED' AND b."cashAccountId"=bank.id AND b."glAccountId"=bank."glAccountId" AND concat_ws(' ',b.number,l.description,l."bankReference") ILIKE '%'||(input->>'q')||'%'
 UNION ALL SELECT l.id,e."postingDate" FROM public."FinanceJournalLine" l JOIN public."FinanceJournalEntry" e ON e.id=l."journalId" WHERE kind='CASH' AND l."accountId"=bank."glAccountId" AND e.currency='PKR' AND e."sourceType" NOT IN('YEAR_CLOSE','OPENING') AND concat_ws(' ',e.reference,l.description) ILIKE '%'||(input->>'q')||'%'
 ), eligible AS(SELECT c.*,public.encova_finance_bank_match_position(kind,c.id) AS position FROM candidates c WHERE day BETWEEN(input->>'from')::date AND least((input->>'to')::date,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date))
 SELECT count(*) INTO total FROM eligible WHERE(position->>'remaining')::numeric>0;
 pages:=greatest(1,ceil(total/25.0)::integer);page:=least((input->>'page')::integer,pages);
 WITH candidates AS(
 SELECT l.id,l."valueDate" AS day FROM public."FinanceStatementLine" l JOIN public."FinanceStatementBatch" b ON b.id=l."batchId" WHERE kind='STATEMENT' AND b.state='IMPORTED' AND b."cashAccountId"=bank.id AND b."glAccountId"=bank."glAccountId" AND concat_ws(' ',b.number,l.description,l."bankReference") ILIKE '%'||(input->>'q')||'%'
 UNION ALL SELECT l.id,e."postingDate" FROM public."FinanceJournalLine" l JOIN public."FinanceJournalEntry" e ON e.id=l."journalId" WHERE kind='CASH' AND l."accountId"=bank."glAccountId" AND e.currency='PKR' AND e."sourceType" NOT IN('YEAR_CLOSE','OPENING') AND concat_ws(' ',e.reference,l.description) ILIKE '%'||(input->>'q')||'%'
 ),eligible AS(SELECT c.*,public.encova_finance_bank_match_position(kind,c.id) AS position FROM candidates c WHERE day BETWEEN(input->>'from')::date AND least((input->>'to')::date,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date)),bounded AS(SELECT * FROM eligible WHERE(position->>'remaining')::numeric>0 ORDER BY day DESC,id LIMIT 25 OFFSET(page-1)*25)
 SELECT coalesce(jsonb_agg(position ORDER BY day DESC,id),'[]'::jsonb) INTO items FROM bounded;
 RETURN jsonb_build_object('items',items,'total',total,'page',page,'pages',pages);
 EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END $$;
CREATE FUNCTION encova_finance_bank_match_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public."FinanceBankMatch"%ROWTYPE;a public."FinanceBankMatchAllocation"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;preview JSONB;edge JSONB;digest TEXT;result JSONB;why TEXT;allowed TEXT[];BEGIN
 IF action IS NULL OR action NOT IN('MATCH','UNMATCH') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 allowed:=CASE WHEN action='MATCH' THEN ARRAY['cashAccountId','allocations','description','evidence','basisHash','reason'] ELSE ARRAY['id','expectedVersion','reason'] END;
 why:=trim(input->>'reason');IF jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR length(why) NOT BETWEEN 3 AND 500 OR input-allowed<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');SELECT * INTO r FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation='BANK_MATCH_'||action AND key=request_key;
 PERFORM pg_advisory_xact_lock(629815);
 IF r.id IS NOT NULL THEN IF r."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN r.result;END IF;
 IF action='MATCH' THEN
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['description','evidence','basisHash']) k WHERE jsonb_typeof(input->k) IS DISTINCT FROM 'string') OR length(trim(input->>'description')) NOT BETWEEN 3 AND 1000 OR length(trim(input->>'evidence')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  preview:=public.encova_finance_bank_match_prepare((input->>'cashAccountId')::uuid,input->'allocations');IF input->>'basisHash' IS DISTINCT FROM preview->>'basisHash' THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_STALE' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinanceBankMatch"(id,number,"cashAccountId","glAccountId",description,evidence,"earliestDate","latestDate","createdById","sourceSnapshot") VALUES(gen_random_uuid(),'BM-'||lpad(nextval('public.finance_bank_match_number')::text,10,'0'),(preview->>'cashAccountId')::uuid,(preview->>'glAccountId')::uuid,trim(input->>'description'),trim(input->>'evidence'),(preview->>'earliestDate')::date,(preview->>'latestDate')::date,actor,'{}'::jsonb) RETURNING * INTO m;
  FOR edge IN SELECT value FROM jsonb_array_elements(preview->'allocations') LOOP
   INSERT INTO public."FinanceBankMatchAllocation"(id,"matchId",sequence,"statementLineId","journalLineId",amount,"effectiveDate","sourceSnapshot") VALUES(gen_random_uuid(),m.id,(edge->>'sequence')::integer,(edge->>'statementLineId')::uuid,(edge->>'journalLineId')::uuid,(edge->>'amount')::numeric,(edge->>'effectiveDate')::date,jsonb_build_object('statement',edge#>'{statement,source}','cash',edge#>'{cash,source}')) RETURNING * INTO a;
   INSERT INTO public."FinanceBankMatchEvent"(id,"allocationId",kind,delta,"effectiveDate","createdById",reason) VALUES(gen_random_uuid(),a.id,'MATCH',a.amount,a."effectiveDate",actor,why);
  END LOOP;
  UPDATE public."FinanceBankMatch" SET state='MATCHED',version=version+1,"sourceSnapshot"=public.encova_finance_bank_match_snapshot(m.id),"updatedAt"=CURRENT_TIMESTAMP WHERE id=m.id RETURNING * INTO m;
 ELSE
  SELECT * INTO m FROM public."FinanceBankMatch" WHERE id=(input->>'id')::uuid FOR UPDATE;IF m.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR m.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF m.state<>'MATCHED' THEN RAISE EXCEPTION 'FINANCE_BANK_MATCH_IMMUTABLE' USING ERRCODE='P0001';END IF;
  FOR a IN SELECT * FROM public."FinanceBankMatchAllocation" WHERE "matchId"=m.id ORDER BY sequence LOOP
   IF NOT EXISTS(SELECT 1 FROM public."FinancePeriod" p WHERE p.state='OPEN' AND a."effectiveDate" BETWEEN p."startDate" AND p."endDate") THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001';END IF;
   INSERT INTO public."FinanceBankMatchEvent"(id,"allocationId",kind,delta,"effectiveDate","createdById",reason) VALUES(gen_random_uuid(),a.id,'UNMATCH',-a.amount,a."effectiveDate",actor,why);
  END LOOP;
  UPDATE public."FinanceBankMatch" SET state='UNMATCHED',version=version+1,"unmatchedAt"=CURRENT_TIMESTAMP,"unmatchedById"=actor,"unmatchReason"=why,"updatedAt"=CURRENT_TIMESTAMP WHERE id=m.id RETURNING * INTO m;
 END IF;
 result:=jsonb_build_object('id',m.id,'number',m.number,'version',m.version,'state',m.state);
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,'BANK_MATCH_'||action,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_BANK_'||action,'FinanceBankMatch',m.id,why,jsonb_build_object('source',m."sourceSnapshot",'state',m.state,'version',m.version),request_id);RETURN result;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';WHEN data_exception OR check_violation OR not_null_violation OR foreign_key_violation THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END $$;
DO $$ DECLARE t TEXT;f RECORD;role_name TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceBankMatch','FinanceBankMatchAllocation','FinanceBankMatchEvent'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,role_name);END IF;END LOOP;END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'encova_finance_bank_match_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);FOREACH role_name IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name);END IF;END LOOP;END LOOP;
 REVOKE ALL ON SEQUENCE public.finance_bank_match_number FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION public.encova_finance_bank_match_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID),public.encova_finance_bank_match_options(UUID,JSONB),public.encova_finance_bank_match_preview(UUID,JSONB) TO encova_app;END IF;
END $$;
COMMIT;
