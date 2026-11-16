BEGIN;
CREATE SEQUENCE finance_cost_allocation_number AS BIGINT MINVALUE 1 MAXVALUE 9999999999 NO CYCLE;
CREATE TABLE "FinanceCostAllocation"(
 id UUID PRIMARY KEY,number TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN('RECLASSIFICATION','REVERSAL')),"sourceLineId" UUID NOT NULL REFERENCES "FinanceJournalLine" ON DELETE RESTRICT,"postingDate" DATE NOT NULL CHECK("postingDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 1000),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),amount NUMERIC(20,2) NOT NULL CHECK(amount>0),"basisHash" TEXT NOT NULL CHECK("basisHash"~'^[0-9a-f]{64}$'),"basisSnapshot" JSONB NOT NULL CHECK(jsonb_typeof("basisSnapshot")='object'),"sourceSnapshot" JSONB,state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','POSTED','VOIDED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"reversalOfId" UUID UNIQUE REFERENCES "FinanceCostAllocation" ON DELETE RESTRICT,"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK((kind='REVERSAL')=("reversalOfId" IS NOT NULL))
);
CREATE INDEX "FinanceCostAllocation_sourceLineId_postingDate_id_idx" ON "FinanceCostAllocation"("sourceLineId","postingDate",id);
CREATE INDEX "FinanceCostAllocation_state_postingDate_id_idx" ON "FinanceCostAllocation"(state,"postingDate",id);
CREATE TABLE "FinanceCostAllocationLine"(
 id UUID PRIMARY KEY,"allocationId" UUID NOT NULL REFERENCES "FinanceCostAllocation" ON DELETE RESTRICT,sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 100),"projectId" UUID REFERENCES "Project" ON DELETE RESTRICT,amount NUMERIC(20,2) NOT NULL CHECK(amount>=0),UNIQUE("allocationId",sequence)
);
CREATE UNIQUE INDEX "FinanceCostAllocationLine_dimension_key" ON "FinanceCostAllocationLine"("allocationId",coalesce("projectId"::text,'company'));
ALTER TABLE "FinanceJournalEntry" ADD COLUMN "costAllocationId" UUID UNIQUE REFERENCES "FinanceCostAllocation" ON DELETE RESTRICT;
DO $$ DECLARE def TEXT;BEGIN SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint WHERE conrelid='public."FinanceJournalEntry"'::regclass AND conname='FinanceJournalEntry_source_identity';ALTER TABLE "FinanceJournalEntry" DROP CONSTRAINT "FinanceJournalEntry_source_identity";EXECUTE 'ALTER TABLE public."FinanceJournalEntry" ADD CONSTRAINT "FinanceJournalEntry_source_identity" CHECK(('||substr(def,8,length(def)-8)||' AND "costAllocationId" IS NULL) OR("sourceType"=''COST_ALLOCATION'' AND "sourceAction"=''POST'' AND "costAllocationId"="sourceId" AND "costAllocationId" IS NOT NULL AND "draftId" IS NULL AND "movementId" IS NULL AND "assetMovementId" IS NULL AND "invoiceId" IS NULL AND "billId" IS NULL AND "customerDocumentId" IS NULL AND "supplierDocumentId" IS NULL AND "reversalOfId" IS NULL))';END $$;
CREATE FUNCTION encova_finance_cost_components(target UUID) RETURNS TABLE(id UUID,"journalId" UUID,"effectiveDate" DATE,delta NUMERIC) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH original AS(SELECT l.*,e."sourceType",e."movementId",e."assetMovementId",e."customerDocumentId",e."supplierDocumentId" FROM public."FinanceJournalLine" l JOIN public."FinanceJournalEntry" e ON e.id=l."journalId" JOIN public."FinanceAccount" a ON a.id=l."accountId" LEFT JOIN public."FinanceMovement" om ON om.id=e."movementId" LEFT JOIN public."FinanceAssetMovement" oa ON oa.id=e."assetMovementId" LEFT JOIN public."FinanceCustomerDocument" oc ON oc.id=e."customerDocumentId" LEFT JOIN public."FinanceSupplierDocument" os ON os.id=e."supplierDocumentId" WHERE l.id=target AND l.debit>0 AND l.credit=0 AND a."controlType"='NONE' AND a.type IN('DIRECT_COST','OPERATING_EXPENSE','OTHER_EXPENSE') AND NOT a."isContra" AND (l."billLineId" IS NULL OR e."sourceType"='BILL') AND coalesce(om.kind,'')<>'REVERSAL' AND coalesce(oa.kind,'')<>'REVERSAL' AND coalesce(oc.kind,'')<>'REVERSAL' AND coalesce(os.kind,'')<>'REVERSAL' AND e."sourceType" IN('JOURNAL_DRAFT','BILL','MOVEMENT','ASSET_MOVEMENT','CUSTOMER_DOCUMENT','SUPPLIER_DOCUMENT'))
 SELECT l.id,e.id,e."postingDate",l.debit-l.credit FROM original o JOIN public."FinanceJournalLine" l ON l."accountId"=o."accountId" JOIN public."FinanceJournalEntry" e ON e.id=l."journalId"
 LEFT JOIN public."FinanceMovement" movement ON movement.id=e."movementId" LEFT JOIN public."FinanceAssetMovement" asset ON asset.id=e."assetMovementId" LEFT JOIN public."FinanceCustomerDocument" customer ON customer.id=e."customerDocumentId" LEFT JOIN public."FinanceSupplierDocument" supplier ON supplier.id=e."supplierDocumentId"
 WHERE(o."sourceType"='BILL' AND o."billLineId" IS NOT NULL AND l."billLineId"=o."billLineId") OR(o."sourceType"<>'BILL' AND l.sequence=o.sequence AND(e.id=o."journalId" OR e."reversalOfId"=o."journalId" OR(o."movementId" IS NOT NULL AND movement."reversalOfId"=o."movementId") OR(o."assetMovementId" IS NOT NULL AND asset."reversalOfId"=o."assetMovementId") OR(o."customerDocumentId" IS NOT NULL AND customer."reversalOfId"=o."customerDocumentId") OR(o."supplierDocumentId" IS NOT NULL AND supplier."reversalOfId"=o."supplierDocumentId")))
$$;
CREATE FUNCTION encova_finance_cost_capture(target UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('line',to_jsonb(l)||jsonb_build_object('debit',l.debit::text,'credit',l.credit::text),'journal',jsonb_build_object('id',e.id,'reference',e.reference,'postingDate',e."postingDate",'sourceType',e."sourceType",'sourceId',e."sourceId"),'net',round(c.net,2)::text,'latestDate',c.latest,'eventCount',c.n,'eventDigest',c.digest) FROM public."FinanceJournalLine" l JOIN public."FinanceJournalEntry" e ON e.id=l."journalId" CROSS JOIN LATERAL(SELECT sum(x.delta) AS net,max(x."effectiveDate") AS latest,count(*) AS n,encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('id',x.id,'journalId',x."journalId",'date',x."effectiveDate",'delta',x.delta::text) ORDER BY x.id),'[]'::jsonb)::text,'UTF8')),'hex') AS digest FROM public.encova_finance_cost_components(target)x)c WHERE l.id=target AND c.n>0
$$;
CREATE FUNCTION encova_finance_cost_basis(target UUID) RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT encode(sha256(convert_to(public.encova_finance_cost_capture(target)::text,'UTF8')),'hex') $$;
CREATE FUNCTION encova_finance_cost_capacity(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE point RECORD;BEGIN
 FOR point IN WITH events AS(SELECT x."effectiveDate" AS date,x.delta AS cost,0::numeric AS allocated,0 AS active FROM public.encova_finance_cost_components(target)x UNION ALL SELECT a."postingDate",0::numeric,CASE WHEN a.kind='REVERSAL' THEN -a.amount ELSE a.amount END,CASE WHEN a.kind='REVERSAL' THEN -1 ELSE 1 END FROM public."FinanceCostAllocation" a WHERE a."sourceLineId"=target AND a.state='POSTED'),daily AS(SELECT date,sum(cost) AS cost,sum(allocated) AS allocated,sum(active) AS active FROM events GROUP BY date),running AS(SELECT date,sum(cost) OVER(ORDER BY date) AS cost,sum(allocated) OVER(ORDER BY date) AS allocated,sum(active) OVER(ORDER BY date) AS active FROM daily) SELECT * FROM running LOOP
  IF point.allocated<0 OR point.allocated>greatest(point.cost,0) OR point.active NOT BETWEEN 0 AND 1 THEN RAISE EXCEPTION 'FINANCE_COST_CAPACITY' USING ERRCODE='P0001';END IF;
 END LOOP;
END $$;
CREATE FUNCTION encova_finance_cost_lines(target UUID) RETURNS TABLE(sequence INTEGER,"accountId" UUID,description TEXT,debit NUMERIC,credit NUMERIC,"projectId" UUID,"partyId" UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT t.sequence,s."accountId",a.description,t.amount,0::numeric,t."projectId",s."partyId" FROM public."FinanceCostAllocation" a JOIN public."FinanceCostAllocationLine" t ON t."allocationId"=a.id JOIN public."FinanceJournalLine" s ON s.id=a."sourceLineId" WHERE a.id=target AND a.kind='RECLASSIFICATION' AND t.amount>0
 UNION ALL SELECT 201,s."accountId",a.description,0::numeric,a.amount,s."projectId",s."partyId" FROM public."FinanceCostAllocation" a JOIN public."FinanceJournalLine" s ON s.id=a."sourceLineId" WHERE a.id=target AND a.kind='RECLASSIFICATION'
 UNION ALL SELECT l.sequence,l."accountId",l.description,l.credit,l.debit,l."projectId",l."partyId" FROM public."FinanceCostAllocation" a JOIN public."FinanceJournalEntry" e ON e."costAllocationId"=a."reversalOfId" JOIN public."FinanceJournalLine" l ON l."journalId"=e.id WHERE a.id=target AND a.kind='REVERSAL'
$$;
CREATE FUNCTION encova_finance_cost_snapshot(target UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT(to_jsonb(a)-ARRAY['sourceSnapshot','state','version','updatedAt','createdAt'])||jsonb_build_object('amount',a.amount::text,'targets',(SELECT jsonb_agg(to_jsonb(t)||jsonb_build_object('amount',t.amount::text) ORDER BY t.sequence) FROM public."FinanceCostAllocationLine" t WHERE t."allocationId"=a.id)) FROM public."FinanceCostAllocation" a WHERE a.id=target $$;
CREATE FUNCTION encova_finance_cost_validate(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE a public."FinanceCostAllocation"%ROWTYPE;o public."FinanceCostAllocation"%ROWTYPE;s public."FinanceJournalLine"%ROWTYPE;snapshot JSONB;n INTEGER;total NUMERIC;BEGIN
 SELECT * INTO a FROM public."FinanceCostAllocation" WHERE id=target FOR UPDATE;SELECT * INTO s FROM public."FinanceJournalLine" WHERE id=a."sourceLineId";
 IF a.id IS NULL OR a.state<>'DRAFT' OR s.id IS NULL THEN RAISE EXCEPTION 'FINANCE_COST_SOURCE' USING ERRCODE='P0001';END IF;
 snapshot:=public.encova_finance_cost_capture(a."sourceLineId");
 IF snapshot IS NULL OR a."postingDate"<(snapshot->>'latestDate')::date OR EXISTS(SELECT 1 FROM public."FinanceCostAllocation" WHERE "sourceLineId"=a."sourceLineId" AND state='POSTED' AND "postingDate">a."postingDate") THEN RAISE EXCEPTION 'FINANCE_COST_DATE_ORDER' USING ERRCODE='P0001';END IF;
 IF a.kind='REVERSAL' THEN
  SELECT * INTO o FROM public."FinanceCostAllocation" WHERE id=a."reversalOfId";
  IF o.id IS NULL OR o.kind<>'RECLASSIFICATION' OR o.state<>'POSTED' OR o."sourceLineId"<>a."sourceLineId" OR o.amount<>a.amount OR a."postingDate"<o."postingDate" OR EXISTS(SELECT 1 FROM public."FinanceCostAllocation" WHERE "reversalOfId"=o.id AND id<>a.id) THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001';END IF;RETURN;
 END IF;
 IF a."basisHash" IS DISTINCT FROM public.encova_finance_cost_basis(a."sourceLineId") OR a."basisSnapshot" IS DISTINCT FROM snapshot OR a.amount IS DISTINCT FROM(snapshot->>'net')::numeric THEN RAISE EXCEPTION 'FINANCE_COST_STALE_BASIS' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM public."FinanceCostAllocation" d WHERE d."sourceLineId"=a."sourceLineId" AND d.kind='RECLASSIFICATION' AND d.state='POSTED' AND NOT EXISTS(SELECT 1 FROM public."FinanceCostAllocation" r WHERE r."reversalOfId"=d.id AND r.state='POSTED')) THEN RAISE EXCEPTION 'FINANCE_COST_ALREADY_ALLOCATED' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=s."accountId" AND active AND "isPosting" AND NOT "isContra" AND "controlType"='NONE' AND type IN('DIRECT_COST','OPERATING_EXPENSE','OTHER_EXPENSE')) THEN RAISE EXCEPTION 'FINANCE_COST_MAPPING' USING ERRCODE='P0001';END IF;
 SELECT count(*),coalesce(sum(amount),0) INTO n,total FROM public."FinanceCostAllocationLine" WHERE "allocationId"=a.id;
 IF n NOT BETWEEN 1 AND 100 OR total<>a.amount THEN RAISE EXCEPTION 'FINANCE_COST_SPLIT' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FinanceCostAllocationLine" WHERE "allocationId"=a.id AND amount>0 AND "projectId" IS DISTINCT FROM s."projectId") THEN RAISE EXCEPTION 'FINANCE_COST_NO_CHANGE' USING ERRCODE='P0001';END IF;
END $$;
CREATE FUNCTION encova_finance_cost_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' OR(TG_OP='UPDATE' AND OLD.state<>'DRAFT') THEN RAISE EXCEPTION 'FINANCE_COST_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN IF NEW.state<>'DRAFT' OR NEW.version<>1 OR NEW."sourceSnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;RETURN NEW;END IF;
 IF ROW(NEW.id,NEW.number,NEW.kind,NEW."sourceLineId",NEW."reversalOfId",NEW."createdById",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD.number,OLD.kind,OLD."sourceLineId",OLD."reversalOfId",OLD."createdById",OLD."createdAt") OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
 IF NEW.state='POSTED' THEN IF(to_jsonb(NEW)-ARRAY['state','version','updatedAt','sourceSnapshot']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','updatedAt','sourceSnapshot']) OR NEW."sourceSnapshot" IS DISTINCT FROM public.encova_finance_cost_snapshot(NEW.id) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;ELSIF NEW."sourceSnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceCostAllocation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceCostAllocation" FOR EACH ROW EXECUTE FUNCTION encova_finance_cost_guard();
CREATE TRIGGER "FinanceCostAllocation_config" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceCostAllocation" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE FUNCTION encova_finance_cost_line_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE target UUID;state TEXT;BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'FINANCE_COST_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='DELETE' THEN target:=OLD."allocationId";ELSE target:=NEW."allocationId";END IF;
 SELECT d.state INTO state FROM public."FinanceCostAllocation" d WHERE d.id=target FOR UPDATE;
 IF state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'FINANCE_COST_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceCostAllocationLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceCostAllocationLine" FOR EACH ROW EXECUTE FUNCTION encova_finance_cost_line_guard();
CREATE TRIGGER "FinanceCostAllocationLine_config" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceCostAllocationLine" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE FUNCTION encova_finance_check_cost(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE a public."FinanceCostAllocation"%ROWTYPE;o public."FinanceCostAllocation"%ROWTYPE;e public."FinanceJournalEntry"%ROWTYPE;n INTEGER;total NUMERIC;BEGIN
 SELECT * INTO a FROM public."FinanceCostAllocation" WHERE id=target;SELECT * INTO e FROM public."FinanceJournalEntry" WHERE "costAllocationId"=target;SELECT count(*),coalesce(sum(amount),0) INTO n,total FROM public."FinanceCostAllocationLine" WHERE "allocationId"=target;
 IF a.id IS NULL OR n NOT BETWEEN 1 AND 100 OR total<>a.amount OR a.amount IS DISTINCT FROM(a."basisSnapshot"->>'net')::numeric THEN RAISE EXCEPTION 'FINANCE_COST_SPLIT' USING ERRCODE='P0001';END IF;
 IF a.state<>'POSTED' THEN IF e.id IS NOT NULL OR a."sourceSnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;END IF;
 IF e.id IS NULL OR e."sourceType"<>'COST_ALLOCATION' OR e."postingDate"<>a."postingDate" OR e.description<>a.description OR e.evidence<>a.evidence OR a."sourceSnapshot" IS DISTINCT FROM public.encova_finance_cost_snapshot(target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id) EXCEPT(SELECT * FROM public.encova_finance_cost_lines(target))) OR EXISTS((SELECT * FROM public.encova_finance_cost_lines(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF a.kind='REVERSAL' THEN
  SELECT * INTO o FROM public."FinanceCostAllocation" WHERE id=a."reversalOfId";
  IF o.id IS NULL OR o.state<>'POSTED' OR o.kind<>'RECLASSIFICATION' OR a."sourceLineId"<>o."sourceLineId" OR a.amount<>o.amount OR a."basisHash"<>o."basisHash" OR a."basisSnapshot"<>o."basisSnapshot" OR a.description<>o.description OR a."postingDate"<o."postingDate" OR EXISTS((SELECT sequence,"projectId",amount FROM public."FinanceCostAllocationLine" WHERE "allocationId"=a.id) EXCEPT(SELECT sequence,"projectId",amount FROM public."FinanceCostAllocationLine" WHERE "allocationId"=o.id)) OR EXISTS((SELECT sequence,"projectId",amount FROM public."FinanceCostAllocationLine" WHERE "allocationId"=o.id) EXCEPT(SELECT sequence,"projectId",amount FROM public."FinanceCostAllocationLine" WHERE "allocationId"=a.id)) THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001';END IF;
 END IF;
 PERFORM public.encova_finance_cost_capacity(a."sourceLineId");
END $$;
CREATE FUNCTION encova_finance_cost_deferred() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE target UUID;BEGIN
 IF TG_TABLE_NAME='FinanceCostAllocation' THEN target:=NEW.id;ELSIF TG_OP='DELETE' THEN target:=OLD."allocationId";ELSE target:=NEW."allocationId";END IF;PERFORM public.encova_finance_check_cost(target);RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FinanceCostAllocation_valid" AFTER INSERT OR UPDATE ON "FinanceCostAllocation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_cost_deferred();
CREATE CONSTRAINT TRIGGER "FinanceCostAllocationLine_valid" AFTER INSERT OR UPDATE OR DELETE ON "FinanceCostAllocationLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_cost_deferred();
CREATE FUNCTION encova_finance_cost_ledger_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE e public."FinanceJournalEntry"%ROWTYPE;target UUID;BEGIN
 SELECT * INTO e FROM public."FinanceJournalEntry" WHERE id=NEW."journalId";
 IF e."costAllocationId" IS NOT NULL THEN SELECT "sourceLineId" INTO target FROM public."FinanceCostAllocation" WHERE id=e."costAllocationId";PERFORM public.encova_finance_cost_capacity(target);RETURN NULL;END IF;
 FOR target IN SELECT DISTINCT a."sourceLineId" FROM public."FinanceCostAllocation" a JOIN public."FinanceJournalLine" s ON s.id=a."sourceLineId" JOIN public."FinanceJournalEntry" original ON original.id=s."journalId" WHERE a.state='POSTED' AND s."accountId"=NEW."accountId" AND((s."billLineId" IS NOT NULL AND s."billLineId"=NEW."billLineId") OR(s."billLineId" IS NULL AND s.sequence=NEW.sequence AND(e.id=original.id OR e."reversalOfId"=original.id OR(original."movementId" IS NOT NULL AND EXISTS(SELECT 1 FROM public."FinanceMovement" d WHERE d.id=e."movementId" AND d."reversalOfId"=original."movementId")) OR(original."assetMovementId" IS NOT NULL AND EXISTS(SELECT 1 FROM public."FinanceAssetMovement" d WHERE d.id=e."assetMovementId" AND d."reversalOfId"=original."assetMovementId")) OR(original."customerDocumentId" IS NOT NULL AND EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" d WHERE d.id=e."customerDocumentId" AND d."reversalOfId"=original."customerDocumentId")) OR(original."supplierDocumentId" IS NOT NULL AND EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" d WHERE d.id=e."supplierDocumentId" AND d."reversalOfId"=original."supplierDocumentId"))))) LOOP
  PERFORM public.encova_finance_cost_capacity(target);
 END LOOP;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FinanceJournalLine_cost_capacity" AFTER INSERT ON "FinanceJournalLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_cost_ledger_capacity();

CREATE FUNCTION encova_finance_cost_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public."FinanceCostAllocation"%ROWTYPE;o public."FinanceCostAllocation"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;line JSONB;captured JSONB;digest TEXT;reason TEXT;n INTEGER:=0;total NUMERIC:=0;entry_id UUID;original UUID;original_number TEXT;original_version INTEGER;result JSONB;
BEGIN
 IF action IS NULL OR action NOT IN('CREATE','UPDATE','POST','VOID','REVERSE') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 reason:=trim(input->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 OR input-(CASE WHEN action='CREATE' THEN ARRAY['sourceLineId','postingDate','description','evidence','basisHash','targets','reason'] WHEN action='UPDATE' THEN ARRAY['id','expectedVersion','postingDate','description','evidence','basisHash','targets','reason'] WHEN action='REVERSE' THEN ARRAY['id','expectedVersion','postingDate','reason'] ELSE ARRAY['id','expectedVersion','reason'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 digest:=encode(sha256(convert_to(jsonb_strip_nulls(input)::text,'UTF8')),'hex');SELECT * INTO r FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation='COST_'||action AND key=request_key;
 IF FOUND THEN IF r."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN r.result;END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action<>'CREATE' THEN
  SELECT * INTO a FROM public."FinanceCostAllocation" WHERE id=(input->>'id')::uuid FOR UPDATE;IF a.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR a.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
 END IF;
 IF action IN('CREATE','UPDATE') THEN
  IF action='UPDATE' AND a.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_COST_IMMUTABLE' USING ERRCODE='P0001';END IF;
  captured:=public.encova_finance_cost_capture(CASE WHEN action='CREATE' THEN(input->>'sourceLineId')::uuid ELSE a."sourceLineId" END);
  IF captured IS NULL OR(captured->>'net')::numeric<=0 THEN RAISE EXCEPTION 'FINANCE_COST_SOURCE' USING ERRCODE='P0001';END IF;
  IF input->>'basisHash' IS DISTINCT FROM public.encova_finance_cost_basis((captured#>>'{line,id}')::uuid) THEN RAISE EXCEPTION 'FINANCE_COST_STALE_BASIS' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'targets') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'targets') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'FINANCE_COST_SPLIT' USING ERRCODE='P0001';END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(input->'targets') LOOP
   IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR line-ARRAY['projectId','amount']<>'{}'::jsonb OR jsonb_typeof(line->'amount') IS DISTINCT FROM 'string' OR line->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR NOT(line?'projectId') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   total:=total+(line->>'amount')::numeric;
  END LOOP;
  IF total<>(captured->>'net')::numeric THEN RAISE EXCEPTION 'FINANCE_COST_SPLIT' USING ERRCODE='P0001';END IF;
  IF action='CREATE' THEN
   INSERT INTO public."FinanceCostAllocation"(id,number,kind,"sourceLineId","postingDate",description,evidence,amount,"basisHash","basisSnapshot","createdById") VALUES(gen_random_uuid(),'CAL-'||lpad(nextval('public.finance_cost_allocation_number')::text,10,'0'),'RECLASSIFICATION',(input->>'sourceLineId')::uuid,(input->>'postingDate')::date,input->>'description',input->>'evidence',total,input->>'basisHash',captured,actor) RETURNING * INTO a;
  ELSE
   UPDATE public."FinanceCostAllocation" SET "postingDate"=(input->>'postingDate')::date,description=input->>'description',evidence=input->>'evidence',amount=total,"basisHash"=input->>'basisHash',"basisSnapshot"=captured,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=a.id RETURNING * INTO a;
   DELETE FROM public."FinanceCostAllocationLine" WHERE "allocationId"=a.id;
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(input->'targets') LOOP n:=n+1;INSERT INTO public."FinanceCostAllocationLine"(id,"allocationId",sequence,"projectId",amount) VALUES(gen_random_uuid(),a.id,n,(line->>'projectId')::uuid,(line->>'amount')::numeric);END LOOP;
 ELSIF action='REVERSE' THEN
  IF a.kind<>'RECLASSIFICATION' OR a.state<>'POSTED' OR EXISTS(SELECT 1 FROM public."FinanceCostAllocation" WHERE "reversalOfId"=a.id) THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001';END IF;
  o:=a;original:=a.id;original_number:=a.number;original_version:=a.version;
  INSERT INTO public."FinanceCostAllocation" SELECT x.* FROM jsonb_populate_record(NULL::public."FinanceCostAllocation",to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),'number','CAL-'||lpad(nextval('public.finance_cost_allocation_number')::text,10,'0'),'kind','REVERSAL','postingDate',(input->>'postingDate')::date,'evidence',reason,'reversalOfId',o.id,'sourceSnapshot',NULL,'state','DRAFT','version',1,'createdById',actor,'createdAt',CURRENT_TIMESTAMP,'updatedAt',CURRENT_TIMESTAMP))x RETURNING * INTO a;
  INSERT INTO public."FinanceCostAllocationLine"(id,"allocationId",sequence,"projectId",amount) SELECT gen_random_uuid(),a.id,sequence,"projectId",amount FROM public."FinanceCostAllocationLine" WHERE "allocationId"=o.id ORDER BY sequence;
  entry_id:=public.encova_finance_emit_journal(actor,'COST_ALLOCATION',a.id,a."postingDate",reason);
 ELSIF action='VOID' THEN
  IF a.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_COST_IMMUTABLE' USING ERRCODE='P0001';END IF;
  UPDATE public."FinanceCostAllocation" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=a.id RETURNING * INTO a;
 ELSE entry_id:=public.encova_finance_emit_journal(actor,'COST_ALLOCATION',a.id,a."postingDate",reason);
 END IF;
 SELECT * INTO a FROM public."FinanceCostAllocation" WHERE id=a.id;
 result:=CASE WHEN original IS NULL THEN jsonb_build_object('id',a.id,'number',a.number,'version',a.version,'journalId',entry_id) ELSE jsonb_build_object('id',original,'number',original_number,'version',original_version,'journalId',entry_id,'reversalId',a.id) END;
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,'COST_'||action,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_COST_'||action,'FinanceCostAllocation',coalesce(original,a.id),reason,jsonb_build_object('source',public.encova_finance_cost_snapshot(a.id),'journalId',entry_id),request_id);RETURN result;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;
CREATE FUNCTION encova_finance_cost_read(actor UUID,input JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE mode TEXT;query TEXT;page INTEGER;total BIGINT;pages INTEGER;items JSONB;result JSONB;BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['mode','q','page','sourceLineId']<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 mode:=input->>'mode';query:=coalesce(input->>'q','');page:=coalesce((input->>'page')::integer,1);
 IF mode NOT IN('SOURCES','SOURCE') OR mode IS NULL OR length(query)>100 OR page NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF mode='SOURCE' THEN
  result:=public.encova_finance_cost_capture((input->>'sourceLineId')::uuid);IF result IS NULL THEN RAISE EXCEPTION 'FINANCE_COST_SOURCE' USING ERRCODE='P0001';END IF;
  RETURN jsonb_build_object('item',result,'basisHash',public.encova_finance_cost_basis((input->>'sourceLineId')::uuid));
 END IF;
 WITH candidates AS(SELECT l.id FROM public."FinanceJournalLine" l JOIN public."FinanceJournalEntry" e ON e.id=l."journalId" JOIN public."FinanceAccount" a ON a.id=l."accountId" CROSS JOIN LATERAL public.encova_finance_cost_capture(l.id)c WHERE l.debit>0 AND l.credit=0 AND a.active AND a."isPosting" AND NOT a."isContra" AND a."controlType"='NONE' AND a.type IN('DIRECT_COST','OPERATING_EXPENSE','OTHER_EXPENSE') AND c IS NOT NULL AND(c->>'net')::numeric>0 AND position(lower(query) IN lower(e.reference||' '||l.description||' '||a.code||' '||a.name))>0 AND NOT EXISTS(SELECT 1 FROM public."FinanceCostAllocation" d WHERE d."sourceLineId"=l.id AND d.kind='RECLASSIFICATION' AND d.state='POSTED' AND NOT EXISTS(SELECT 1 FROM public."FinanceCostAllocation" r WHERE r."reversalOfId"=d.id AND r.state='POSTED'))) SELECT count(*) INTO total FROM candidates;
 pages:=greatest(1,ceil(total/25.0)::integer);page:=least(page,pages);
 WITH candidates AS(SELECT l.id,e.reference AS code,l.description||' · '||a.code||' · net PKR '||(c->>'net') AS name,e."postingDate",e."postedAt",e.id AS "journalId",l.sequence FROM public."FinanceJournalLine" l JOIN public."FinanceJournalEntry" e ON e.id=l."journalId" JOIN public."FinanceAccount" a ON a.id=l."accountId" CROSS JOIN LATERAL public.encova_finance_cost_capture(l.id)c WHERE l.debit>0 AND l.credit=0 AND a.active AND a."isPosting" AND NOT a."isContra" AND a."controlType"='NONE' AND a.type IN('DIRECT_COST','OPERATING_EXPENSE','OTHER_EXPENSE') AND c IS NOT NULL AND(c->>'net')::numeric>0 AND position(lower(query) IN lower(e.reference||' '||l.description||' '||a.code||' '||a.name))>0 AND NOT EXISTS(SELECT 1 FROM public."FinanceCostAllocation" d WHERE d."sourceLineId"=l.id AND d.kind='RECLASSIFICATION' AND d.state='POSTED' AND NOT EXISTS(SELECT 1 FROM public."FinanceCostAllocation" r WHERE r."reversalOfId"=d.id AND r.state='POSTED')) ORDER BY e."postingDate" DESC,e."postedAt" DESC,e.id DESC,l.sequence,l.id LIMIT 25 OFFSET(page-1)*25) SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name) ORDER BY "postingDate" DESC,"postedAt" DESC,"journalId" DESC,sequence,id),'[]'::jsonb) INTO items FROM candidates;
 RETURN jsonb_build_object('items',items,'total',total,'page',page,'pages',pages);
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;

CREATE OR REPLACE FUNCTION encova_finance_emit_journal(actor UUID,source_kind TEXT,source_id UUID,posting_date DATE,reason TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cost public."FinanceCostAllocation"%ROWTYPE;asset_movement public."FinanceAssetMovement"%ROWTYPE; movement public."FinanceMovement"%ROWTYPE; supplier public."FinanceSupplierDocument"%ROWTYPE; bill public."FinanceBill"%ROWTYPE; draft public."FinanceJournalDraft"%ROWTYPE; original public."FinanceJournalEntry"%ROWTYPE; invoice public."FinanceInvoice"%ROWTYPE;
 period_id UUID; entry_id UUID:=gen_random_uuid(); mappings UUID[]; customer public."FinanceCustomerDocument"%ROWTYPE;
BEGIN
 IF source_kind IS NULL OR source_kind NOT IN ('JOURNAL_DRAFT','JOURNAL_REVERSAL','INVOICE','CUSTOMER_DOCUMENT','BILL','SUPPLIER_DOCUMENT','MOVEMENT','ASSET_MOVEMENT','COST_ALLOCATION') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF source_kind='COST_ALLOCATION' THEN
  SELECT * INTO cost FROM public."FinanceCostAllocation" WHERE id=source_id FOR UPDATE;
  IF cost.id IS NULL OR cost."postingDate"<>posting_date THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;PERFORM public.encova_finance_cost_validate(source_id);
 ELSIF source_kind='ASSET_MOVEMENT' THEN
  SELECT * INTO asset_movement FROM public."FinanceAssetMovement" WHERE id=source_id FOR UPDATE;
  IF asset_movement.id IS NULL OR asset_movement."postingDate"<>posting_date THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;PERFORM public.encova_finance_asset_movement_validate(source_id);
 ELSIF source_kind='MOVEMENT' THEN
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
 IF posting_date>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'FINANCE_FUTURE_DATE' USING ERRCODE='P0001';END IF;
 IF source_kind='JOURNAL_DRAFT' THEN
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","draftId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'JOURNAL_DRAFT',draft.id,'POST',draft.id,posting_date,period_id,draft.description,draft.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId") SELECT gen_random_uuid(),entry_id,sequence,"accountId",description,debit,credit,"projectId" FROM public."FinanceJournalDraftLine" WHERE "draftId"=draft.id ORDER BY "accountId",sequence;
  UPDATE public."FinanceJournalDraft" SET state='POSTED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=draft.id;
 ELSIF source_kind='JOURNAL_REVERSAL' THEN
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","postingDate","periodId",description,evidence,"postedById","reversalOfId") VALUES(entry_id,'JRN-'||entry_id::text,'JOURNAL_REVERSAL',original.id,'REVERSE',posting_date,period_id,original.description,reason,actor,original.id);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId") SELECT gen_random_uuid(),entry_id,sequence,"accountId",description,credit,debit,"projectId" FROM public."FinanceJournalLine" WHERE "journalId"=original.id ORDER BY "accountId",sequence;
 ELSIF source_kind='COST_ALLOCATION' THEN
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","costAllocationId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'COST_ALLOCATION',cost.id,'POST',cost.id,posting_date,period_id,cost.description,cost.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId") SELECT gen_random_uuid(),entry_id,x.* FROM public.encova_finance_cost_lines(cost.id)x ORDER BY x."accountId",x.sequence;
  UPDATE public."FinanceCostAllocation" SET state='POSTED',"sourceSnapshot"=public.encova_finance_cost_snapshot(cost.id),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=cost.id;
 ELSIF source_kind='ASSET_MOVEMENT' THEN
  IF EXISTS(SELECT 1 FROM public.encova_finance_asset_movement_lines(asset_movement.id)) THEN
   INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","assetMovementId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'ASSET_MOVEMENT',asset_movement.id,'POST',asset_movement.id,posting_date,period_id,asset_movement.description,asset_movement.evidence,actor);
   INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId") SELECT gen_random_uuid(),entry_id,x.* FROM public.encova_finance_asset_movement_lines(asset_movement.id)x ORDER BY x."accountId",x.sequence;
  ELSE entry_id:=NULL;UPDATE public."FinancePeriod" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=period_id;END IF;
  PERFORM public.encova_finance_asset_movement_effects(actor,asset_movement.id,entry_id);
 ELSIF source_kind='MOVEMENT' THEN
  IF public.encova_finance_investment_register_only(movement.id) THEN entry_id:=NULL;UPDATE public."FinancePeriod" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=period_id;ELSE
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","movementId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'MOVEMENT',movement.id,'POST',movement.id,posting_date,period_id,movement.description,movement.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId") SELECT gen_random_uuid(),entry_id,x.* FROM public.encova_finance_movement_lines(movement.id) x ORDER BY x."accountId",x.sequence;
  END IF;
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
CREATE OR REPLACE FUNCTION encova_finance_journal_header_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE period public."FinancePeriod"%ROWTYPE;
BEGIN
 SELECT * INTO period FROM public."FinancePeriod" WHERE id=NEW."periodId" FOR UPDATE;
 IF period.id IS NULL OR period.state<>'OPEN' OR NEW."postingDate" NOT BETWEEN period."startDate" AND period."endDate" THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 IF NEW."postingDate">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'FINANCE_FUTURE_DATE' USING ERRCODE='P0001'; END IF;
 IF NEW."sourceType"='SUPPLIER_DOCUMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE id=NEW."supplierDocumentId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='SUPPLIER_DOCUMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE id=NEW."supplierDocumentId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='COST_ALLOCATION' AND NOT EXISTS(SELECT 1 FROM public."FinanceCostAllocation" WHERE id=NEW."costAllocationId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='ASSET_MOVEMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceAssetMovement" WHERE id=NEW."assetMovementId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
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
 IF entry."sourceType"='COST_ALLOCATION' THEN
  IF NEW."invoiceLineId" IS NOT NULL OR NEW."billLineId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.encova_finance_cost_lines(entry."costAllocationId")x WHERE ROW(x.sequence,x."accountId",x.description,x.debit,x.credit,x."projectId",x."partyId") IS NOT DISTINCT FROM ROW(NEW.sequence,NEW."accountId",NEW.description,NEW.debit,NEW.credit,NEW."projectId",NEW."partyId")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;PERFORM public.encova_finance_mark_accounts(ARRAY[NEW."accountId"]);RETURN NEW;
 END IF;
 IF entry."sourceType"='ASSET_MOVEMENT' THEN
  IF NEW."invoiceLineId" IS NOT NULL OR NEW."billLineId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.encova_finance_asset_movement_lines(entry."assetMovementId")x WHERE ROW(x.sequence,x."accountId",x.description,x.debit,x.credit,x."projectId",x."partyId") IS NOT DISTINCT FROM ROW(NEW.sequence,NEW."accountId",NEW.description,NEW.debit,NEW.credit,NEW."projectId",NEW."partyId")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;PERFORM public.encova_finance_mark_accounts(ARRAY[NEW."accountId"]);RETURN NEW;
 END IF;
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
 IF entry."sourceType"='COST_ALLOCATION' THEN PERFORM public.encova_finance_check_cost(entry."costAllocationId");RETURN NULL;END IF;
 IF entry."sourceType"='ASSET_MOVEMENT' THEN PERFORM public.encova_finance_check_asset_movement(entry."assetMovementId");RETURN NULL;END IF;
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
DO $$ DECLARE t TEXT;f RECORD;role_name TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceCostAllocation','FinanceCostAllocationLine'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,role_name);END IF;END LOOP;END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND(proname LIKE 'encova_finance_cost_%' OR proname='encova_finance_check_cost') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);FOREACH role_name IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name);END IF;END LOOP;END LOOP;
 REVOKE ALL ON SEQUENCE public.finance_cost_allocation_number FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION public.encova_finance_cost_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID),public.encova_finance_cost_read(UUID,JSONB) TO encova_app;END IF;
END $$;
COMMIT;
