BEGIN;
CREATE TABLE "FinancePeriodClose"(id UUID PRIMARY KEY,"periodId" UUID NOT NULL REFERENCES "FinancePeriod" ON DELETE RESTRICT,sequence INTEGER NOT NULL CHECK(sequence>0),state TEXT NOT NULL DEFAULT 'CLOSED' CHECK(state IN('CLOSED','REOPENED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"periodVersion" INTEGER NOT NULL CHECK("periodVersion">0),"startDate" DATE NOT NULL,"endDate" DATE NOT NULL,"basisHash" TEXT NOT NULL CHECK("basisHash"~'^[0-9a-f]{64}$'),checklist JSONB NOT NULL,reports JSONB NOT NULL CHECK(jsonb_typeof(reports)='object' AND octet_length(reports::text)<=16777216),"snapshotHash" TEXT NOT NULL CHECK("snapshotHash"=encode(sha256(convert_to(reports::text,'UTF8')),'hex')),"closedById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"closedGrantId" UUID NOT NULL,"closedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),"postingReviewEvidence" TEXT NOT NULL CHECK(length(trim("postingReviewEvidence")) BETWEEN 3 AND 1000),"adjustmentReviewEvidence" TEXT NOT NULL CHECK(length(trim("adjustmentReviewEvidence")) BETWEEN 3 AND 1000),"reopenedAt" TIMESTAMPTZ,"reopenedById" UUID REFERENCES "Person" ON DELETE RESTRICT,"reopenReason" TEXT,CHECK("startDate">=DATE '0001-01-01' AND "endDate" BETWEEN "startDate" AND DATE '9999-12-31'),CHECK((state='REOPENED')=("reopenedAt" IS NOT NULL AND "reopenedById" IS NOT NULL AND "reopenReason" IS NOT NULL)),UNIQUE("periodId",sequence));
CREATE UNIQUE INDEX "FinancePeriodClose_current" ON "FinancePeriodClose"("periodId") WHERE state='CLOSED';
CREATE INDEX "FinancePeriodClose_state_endDate_id_idx" ON "FinancePeriodClose"(state,"endDate",id);
CREATE TABLE "FinanceCloseIssue"(id UUID PRIMARY KEY,"periodId" UUID NOT NULL REFERENCES "FinancePeriod" ON DELETE RESTRICT,kind TEXT NOT NULL CHECK(kind IN('POSTING_FAILURE','PENDING_ADJUSTMENT')),description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 500),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),state TEXT NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','RESOLVED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"resolvedById" UUID REFERENCES "Person" ON DELETE RESTRICT,"resolvedAt" TIMESTAMPTZ,resolution TEXT,CHECK((state='RESOLVED')=("resolvedById" IS NOT NULL AND "resolvedAt" IS NOT NULL AND resolution IS NOT NULL)),CHECK(resolution IS NULL OR length(trim(resolution)) BETWEEN 3 AND 1000));
CREATE INDEX "FinanceCloseIssue_periodId_state_createdAt_id_idx" ON "FinanceCloseIssue"("periodId",state,"createdAt",id);
ALTER TABLE "FinanceReportExport" ADD COLUMN "periodCloseId" UUID REFERENCES "FinancePeriodClose" ON DELETE RESTRICT;
CREATE INDEX "FinanceReportExport_periodCloseId_idx" ON "FinanceReportExport"("periodCloseId");
CREATE FUNCTION encova_finance_close_lock() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN PERFORM pg_advisory_xact_lock(987661);PERFORM pg_advisory_xact_lock(629815);RETURN NULL;END $$;
CREATE TRIGGER "FinancePeriodClose_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinancePeriodClose" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_close_lock();
CREATE TRIGGER "FinanceCloseIssue_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceCloseIssue" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_close_lock();
-- The barrier includes earlier dates because they affect opening balances and cumulative issued statements.
CREATE FUNCTION encova_finance_close_assert_open(effective DATE) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF effective IS NULL OR EXISTS(SELECT 1 FROM public."FinancePeriod" p JOIN public."FinancePeriodClose" c ON c."periodId"=p.id AND c.state='CLOSED' WHERE p.state='CLOSED' AND p."endDate">=effective) THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001';END IF;
END $$;
CREATE FUNCTION encova_finance_close_effective_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE value JSONB;date_value DATE;BEGIN
 value:=to_jsonb(NEW);date_value:=coalesce((value->>'postingDate')::date,(value->>'effectiveDate')::date);PERFORM public.encova_finance_close_assert_open(date_value);RETURN NEW;
END $$;
-- Actual posting/events, including noncash/register-only movements and allocation release, share the barrier.
DO $$ DECLARE t TEXT;BEGIN FOREACH t IN ARRAY ARRAY['FinanceJournalEntry','FinanceReceivableEvent','FinanceDeferredRevenueEvent','FinancePayableEvent','FinanceClientBalanceEvent','FinanceSupplierBalanceEvent','FinanceInvoiceCreditEvent','FinanceBillCreditEvent','FinanceFundingEvent','FinanceLoanEvent','FinanceInvestmentEvent','FinanceInvestmentIncomeEvent','FinanceAssetEvent','FinanceBankMatchEvent'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.encova_finance_close_effective_guard()',t||'_period_close_barrier',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.encova_finance_config_lock()',t||'_period_close_lock',t);
 END LOOP;END $$;
CREATE FUNCTION encova_finance_close_drafts(cutoff DATE) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH all_drafts AS(
 SELECT 'JOURNAL'::text AS kind,id,reference,"postingDate",version FROM public."FinanceJournalDraft" WHERE state='DRAFT' AND "postingDate"<=cutoff
 UNION ALL SELECT 'INVOICE',id,number,"postingDate",version FROM public."FinanceInvoice" WHERE state='DRAFT' AND "postingDate"<=cutoff
 UNION ALL SELECT 'BILL',id,number,"postingDate",version FROM public."FinanceBill" WHERE state='DRAFT' AND "postingDate"<=cutoff
 UNION ALL SELECT 'CUSTOMER_DOCUMENT',id,number,"postingDate",version FROM public."FinanceCustomerDocument" WHERE state='DRAFT' AND "postingDate"<=cutoff
 UNION ALL SELECT 'SUPPLIER_DOCUMENT',id,number,"postingDate",version FROM public."FinanceSupplierDocument" WHERE state='DRAFT' AND "postingDate"<=cutoff
 UNION ALL SELECT 'MOVEMENT',id,number,"postingDate",version FROM public."FinanceMovement" WHERE state='DRAFT' AND "postingDate"<=cutoff
 UNION ALL SELECT 'ASSET_MOVEMENT',id,number,"postingDate",version FROM public."FinanceAssetMovement" WHERE state='DRAFT' AND "postingDate"<=cutoff
 UNION ALL SELECT 'COST_ALLOCATION',id,number,"postingDate",version FROM public."FinanceCostAllocation" WHERE state='DRAFT' AND "postingDate"<=cutoff)
 SELECT jsonb_build_object('total',count(*),'sourceHash',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(d) ORDER BY kind,id),'[]'::jsonb)::text,'UTF8')),'hex'),'items',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b."postingDate",b.kind,b.id),'[]'::jsonb) FROM(SELECT * FROM all_drafts ORDER BY "postingDate",kind,id LIMIT 25)b),'counts',(SELECT coalesce(jsonb_object_agg(kind,n),'{}'::jsonb) FROM(SELECT kind,count(*) AS n FROM all_drafts GROUP BY kind)c)) FROM all_drafts d
$$;
CREATE FUNCTION encova_finance_close_pack(actor UUID,target UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE p public."FinancePeriod"%ROWTYPE;r JSONB;drafts JSONB;issues JSONB;issue_count INTEGER;prior INTEGER;reports JSONB:='{}'::jsonb;normalized JSONB:='{}'::jsonb;kind TEXT;snap JSONB;ready BOOLEAN;basis TEXT;checklist JSONB;BEGIN
 SELECT * INTO p FROM public."FinancePeriod" WHERE id=target;IF p.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
 r:=public.encova_finance_export_readiness(p."startDate",p."endDate");drafts:=public.encova_finance_close_drafts(p."endDate");
 SELECT count(*) INTO prior FROM public."FinancePeriod" WHERE state='OPEN' AND "endDate"<p."startDate";
 SELECT count(*) INTO issue_count FROM public."FinanceCloseIssue" i JOIN public."FinancePeriod" ip ON ip.id=i."periodId" WHERE i.state='OPEN' AND ip."startDate"<=p."endDate";
 SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b."createdAt",b.id),'[]'::jsonb) INTO issues FROM(SELECT i.id,i."periodId",i.kind,i.description,i.evidence,i.version,i."createdAt" FROM public."FinanceCloseIssue" i JOIN public."FinancePeriod" ip ON ip.id=i."periodId" WHERE i.state='OPEN' AND ip."startDate"<=p."endDate" ORDER BY i."createdAt",i.id LIMIT 25)b;
 ready:=p.state='OPEN' AND(r->>'finalEligible')::boolean AND(drafts->>'total')::integer=0 AND prior=0 AND issue_count=0;
 checklist:=jsonb_build_object('ready',ready,'readiness',r,'pendingDrafts',drafts,'openReviewIssueCount',issue_count,'reviewIssues',issues,'priorOpenPeriods',prior,'manualReviewRequired',true,'manualReviewScope','Owner must review failed posting attempts and pending adjustments; recorded review issues and pending source drafts are checked automatically. Durable posting-worker monitoring is introduced separately in F42.');
 FOREACH kind IN ARRAY ARRAY['TRIAL_BALANCE','PROFIT_LOSS','BALANCE_SHEET'] LOOP
  snap:=public.encova_finance_export_capture(actor,kind,CASE WHEN kind='BALANCE_SHEET' THEN jsonb_build_object('asOf',p."endDate",'q','') ELSE jsonb_build_object('from',p."startDate",'to',p."endDate",'q','')||CASE WHEN kind='TRIAL_BALANCE' THEN jsonb_build_object('includeZero','NO') ELSE '{}'::jsonb END END,'REVIEW');
  -- Every saved statement uses the same period-close readiness, including legitimate prior closed periods.
  snap:=snap||jsonb_build_object('mode','FINAL','readiness',r);reports:=reports||jsonb_build_object(kind,snap);
  normalized:=normalized||jsonb_build_object(kind,jsonb_set(snap,'{report,metadata}',(snap#>'{report,metadata}')-ARRAY['generatedAt','databaseSnapshot']));
 END LOOP;
 basis:=encode(sha256(convert_to(jsonb_build_object('period',jsonb_build_object('id',p.id,'version',p.version,'state',p.state,'from',p."startDate",'to',p."endDate"),'checklist',checklist,'reports',normalized)::text,'UTF8')),'hex');
 RETURN jsonb_build_object('period',jsonb_build_object('id',p.id,'name',p.name,'version',p.version,'state',p.state,'startDate',p."startDate",'endDate',p."endDate"),'checklist',checklist,'reports',reports,'basisHash',basis);
END $$;
CREATE FUNCTION encova_finance_close_record_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE pack JSONB;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_CLOSE_RETAINED' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'CLOSED' OR NEW.version<>1 OR NOT public.encova_finance_export_access(NEW."closedById",NEW."closedGrantId") OR NOT EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=NEW."closedById") THEN RAISE EXCEPTION 'FINANCE_OWNER_REQUIRED' USING ERRCODE='P0001';END IF;
  pack:=public.encova_finance_close_pack(NEW."closedById",NEW."periodId");
  IF NOT(pack#>>'{checklist,ready}')::boolean OR NEW."basisHash"<>pack->>'basisHash' OR NEW."periodVersion"<>(pack#>>'{period,version}')::integer OR NEW."startDate"<>(pack#>>'{period,startDate}')::date OR NEW."endDate"<>(pack#>>'{period,endDate}')::date OR NEW.sequence<>coalesce((SELECT max(sequence) FROM public."FinancePeriodClose" WHERE "periodId"=NEW."periodId"),0)+1 THEN RAISE EXCEPTION 'FINANCE_CLOSE_STALE' USING ERRCODE='P0001';END IF;
  -- Captured values must independently match current canonical data; volatile presentation metadata is excluded only from comparison.
  IF EXISTS(SELECT 1 FROM jsonb_each(NEW.reports) n FULL JOIN jsonb_each(pack->'reports') p ON n.key=p.key WHERE n.key IS NULL OR p.key IS NULL OR jsonb_set(n.value,'{report,metadata}',(n.value#>'{report,metadata}')-ARRAY['generatedAt','databaseSnapshot']) IS DISTINCT FROM jsonb_set(p.value,'{report,metadata}',(p.value#>'{report,metadata}')-ARRAY['generatedAt','databaseSnapshot'])) OR NEW.checklist IS DISTINCT FROM(pack->'checklist')||jsonb_build_object('postingReviewEvidence',NEW."postingReviewEvidence",'adjustmentReviewEvidence',NEW."adjustmentReviewEvidence",'postingFailuresReviewed',true,'pendingAdjustmentsReviewed',true) THEN RAISE EXCEPTION 'FINANCE_CLOSE_STALE' USING ERRCODE='P0001';END IF;
 ELSE
  IF OLD.state<>'CLOSED' OR NEW.state<>'REOPENED' OR NEW.version<>OLD.version+1 OR(to_jsonb(NEW)-ARRAY['state','version','reopenedAt','reopenedById','reopenReason']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','reopenedAt','reopenedById','reopenReason']) OR length(trim(NEW."reopenReason")) NOT BETWEEN 3 AND 500 OR NOT public.encova_finance_export_access(NEW."reopenedById") OR NOT EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=NEW."reopenedById") THEN RAISE EXCEPTION 'FINANCE_CLOSE_RETAINED' USING ERRCODE='P0001';END IF;
  IF EXISTS(SELECT 1 FROM public."FinancePeriod" WHERE state='CLOSED' AND "endDate">OLD."endDate") THEN RAISE EXCEPTION 'FINANCE_CLOSE_REOPEN_ORDER' USING ERRCODE='P0001';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinancePeriodClose_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinancePeriodClose" FOR EACH ROW EXECUTE FUNCTION encova_finance_close_record_guard();
CREATE FUNCTION encova_finance_close_issue_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_CLOSE_RETAINED' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FinancePeriod" WHERE id=NEW."periodId" AND state='OPEN') THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN IF NEW.state<>'OPEN' OR NEW.version<>1 OR NOT public.encova_finance_export_access(NEW."createdById") OR NOT EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=NEW."createdById") THEN RAISE EXCEPTION 'FINANCE_OWNER_REQUIRED' USING ERRCODE='P0001';END IF;
 ELSE IF OLD.state<>'OPEN' OR NEW.state<>'RESOLVED' OR NEW.version<>OLD.version+1 OR(to_jsonb(NEW)-ARRAY['state','version','resolvedAt','resolvedById','resolution']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','resolvedAt','resolvedById','resolution']) OR NOT public.encova_finance_export_access(NEW."resolvedById") OR NOT EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=NEW."resolvedById") THEN RAISE EXCEPTION 'FINANCE_CLOSE_RETAINED' USING ERRCODE='P0001';END IF;END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceCloseIssue_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceCloseIssue" FOR EACH ROW EXECUTE FUNCTION encova_finance_close_issue_guard();
CREATE OR REPLACE FUNCTION encova_finance_period_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE cycle public."FinancePeriodClose"%ROWTYPE;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_PERIOD_RETAINED' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'OPEN' OR NEW."closedAt" IS NOT NULL OR NEW."closedById" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_PERIOD_STATE' USING ERRCODE='P0001';END IF;
  IF EXISTS(SELECT 1 FROM public."FinancePeriodClose" c JOIN public."FinancePeriod" p ON p.id=c."periodId" WHERE c.state='CLOSED' AND p.state='CLOSED' AND p."endDate">=NEW."startDate") THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  RETURN NEW;
 END IF;
 IF OLD."usedAt" IS NOT NULL AND(NEW."usedAt" IS DISTINCT FROM OLD."usedAt" OR NEW."startDate"<>OLD."startDate" OR NEW."endDate"<>OLD."endDate" OR NEW.state='VOID') THEN RAISE EXCEPTION 'FINANCE_PERIOD_USED' USING ERRCODE='P0001';END IF;
 IF OLD.state='OPEN' AND NEW.state='CLOSED' THEN
  SELECT * INTO cycle FROM public."FinancePeriodClose" WHERE "periodId"=OLD.id AND state='CLOSED';
  IF cycle.id IS NULL OR cycle."periodVersion"<>OLD.version OR NEW.version<>OLD.version+1 OR ROW(NEW."closedAt",NEW."closedById",NEW."startDate",NEW."endDate",NEW.name,NEW.id,NEW."createdAt") IS DISTINCT FROM ROW(cycle."closedAt",cycle."closedById",OLD."startDate",OLD."endDate",OLD.name,OLD.id,OLD."createdAt") THEN RAISE EXCEPTION 'FINANCE_PERIOD_STATE' USING ERRCODE='P0001';END IF;
 ELSIF OLD.state='CLOSED' AND NEW.state='OPEN' THEN
  SELECT * INTO cycle FROM public."FinancePeriodClose" WHERE "periodId"=OLD.id AND "closedAt"=OLD."closedAt" AND "closedById"=OLD."closedById" AND state='REOPENED' ORDER BY sequence DESC LIMIT 1;
  IF cycle.id IS NULL OR NEW.version<>OLD.version+1 OR NEW."closedAt" IS NOT NULL OR NEW."closedById" IS NOT NULL OR ROW(NEW."startDate",NEW."endDate",NEW.name,NEW.id,NEW."createdAt") IS DISTINCT FROM ROW(OLD."startDate",OLD."endDate",OLD.name,OLD.id,OLD."createdAt") THEN RAISE EXCEPTION 'FINANCE_PERIOD_STATE' USING ERRCODE='P0001';END IF;
 ELSE
  IF OLD.state<>'OPEN' OR(NEW.state<>OLD.state AND NOT(NEW.state='VOID' AND OLD."usedAt" IS NULL)) OR NEW."closedAt" IS DISTINCT FROM OLD."closedAt" OR NEW."closedById" IS DISTINCT FROM OLD."closedById" THEN RAISE EXCEPTION 'FINANCE_PERIOD_STATE' USING ERRCODE='P0001';END IF;
  IF NEW."startDate" IS DISTINCT FROM OLD."startDate" OR NEW."endDate" IS DISTINCT FROM OLD."endDate" THEN PERFORM public.encova_finance_close_assert_open(NEW."startDate");END IF;
 END IF;RETURN NEW;
END $$;
CREATE FUNCTION encova_finance_close_consistency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE p public."FinancePeriod"%ROWTYPE;target UUID;BEGIN
 IF TG_TABLE_NAME='FinancePeriod' THEN target:=NEW.id;ELSE target:=NEW."periodId";END IF;SELECT * INTO p FROM public."FinancePeriod" WHERE id=target;
 IF EXISTS(SELECT 1 FROM public."FinancePeriodClose" c WHERE c."periodId"=target AND c.state='CLOSED' AND(p.state<>'CLOSED' OR ROW(c."closedAt",c."closedById",c."startDate",c."endDate") IS DISTINCT FROM ROW(p."closedAt",p."closedById",p."startDate",p."endDate"))) THEN RAISE EXCEPTION 'FINANCE_CLOSE_STATE' USING ERRCODE='P0001';END IF;
 IF TG_TABLE_NAME='FinancePeriodClose' AND NEW.state='REOPENED' AND p.state='CLOSED' AND NOT EXISTS(SELECT 1 FROM public."FinancePeriodClose" WHERE "periodId"=target AND state='CLOSED' AND id<>NEW.id) THEN RAISE EXCEPTION 'FINANCE_CLOSE_STATE' USING ERRCODE='P0001';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FinancePeriod_close_consistent" AFTER INSERT OR UPDATE ON "FinancePeriod" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_close_consistency();
CREATE CONSTRAINT TRIGGER "FinancePeriodClose_consistent" AFTER INSERT OR UPDATE ON "FinancePeriodClose" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_close_consistency();
CREATE FUNCTION encova_finance_close_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE p public."FinancePeriod"%ROWTYPE;c public."FinancePeriodClose"%ROWTYPE;i public."FinanceCloseIssue"%ROWTYPE;j public."FinanceReportExport"%ROWTYPE;receipt public."FinanceLedgerReceipt"%ROWTYPE;pack JSONB;result JSONB;digest TEXT;grant_id UUID;owner BOOLEAN;why TEXT;fields TEXT[];BEGIN
 IF action IS NULL OR action NOT IN('CLOSE','REOPEN','EXPORT','ISSUE_CREATE','ISSUE_RESOLVE') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 OR jsonb_typeof(input->'periodId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR length(trim(input->>'reason')) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT public.encova_finance_export_access(actor) OR NOT public.encova_finance_session_ok(actor,provider,session_id) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(629815);owner:=EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=actor);IF action<>'EXPORT' AND NOT owner THEN RAISE EXCEPTION 'FINANCE_OWNER_REQUIRED' USING ERRCODE='P0001';END IF;
 SELECT id INTO grant_id FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL;why:=trim(input->>'reason');
 fields:=CASE action WHEN 'CLOSE' THEN ARRAY['periodId','expectedVersion','basisHash','postingFailuresReviewed','pendingAdjustmentsReviewed','postingReviewEvidence','adjustmentReviewEvidence','reason'] WHEN 'REOPEN' THEN ARRAY['periodId','closeId','expectedVersion','expectedCloseVersion','reason'] WHEN 'EXPORT' THEN ARRAY['periodId','closeId','reportType','reason'] WHEN 'ISSUE_CREATE' THEN ARRAY['periodId','kind','description','evidence','reason'] ELSE ARRAY['periodId','issueId','expectedVersion','resolution','reason'] END;
 IF input-fields<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');SELECT * INTO receipt FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation='PERIOD_'||action AND key=request_key;
 IF receipt.id IS NOT NULL THEN IF receipt."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN receipt.result;END IF;
 SELECT * INTO p FROM public."FinancePeriod" WHERE id=(input->>'periodId')::uuid FOR UPDATE;IF p.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
 IF action IN('CLOSE','REOPEN') THEN IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR p.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;END IF;
 IF action='CLOSE' THEN
  IF p.state<>'OPEN' THEN RAISE EXCEPTION 'FINANCE_CLOSE_STATE' USING ERRCODE='P0001';END IF;
  IF input->'postingFailuresReviewed' IS DISTINCT FROM 'true'::jsonb OR input->'pendingAdjustmentsReviewed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'basisHash') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'postingReviewEvidence') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'adjustmentReviewEvidence') IS DISTINCT FROM 'string' OR length(trim(input->>'postingReviewEvidence')) NOT BETWEEN 3 AND 1000 OR length(trim(input->>'adjustmentReviewEvidence')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  pack:=public.encova_finance_close_pack(actor,p.id);
  IF pack->>'basisHash'<>input->>'basisHash' THEN RAISE EXCEPTION 'FINANCE_CLOSE_STALE' USING ERRCODE='P0001';END IF;
  IF NOT(pack#>>'{checklist,ready}')::boolean THEN RAISE EXCEPTION 'FINANCE_CLOSE_INCOMPLETE' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinancePeriodClose"(id,"periodId",sequence,"periodVersion","startDate","endDate","basisHash",checklist,reports,"snapshotHash","closedById","closedGrantId",reason,"postingReviewEvidence","adjustmentReviewEvidence") VALUES(gen_random_uuid(),p.id,coalesce((SELECT max(sequence) FROM public."FinancePeriodClose" WHERE "periodId"=p.id),0)+1,p.version,p."startDate",p."endDate",pack->>'basisHash',(pack->'checklist')||jsonb_build_object('postingFailuresReviewed',true,'pendingAdjustmentsReviewed',true,'postingReviewEvidence',trim(input->>'postingReviewEvidence'),'adjustmentReviewEvidence',trim(input->>'adjustmentReviewEvidence')),pack->'reports',encode(sha256(convert_to((pack->'reports')::text,'UTF8')),'hex'),actor,grant_id,why,trim(input->>'postingReviewEvidence'),trim(input->>'adjustmentReviewEvidence')) RETURNING * INTO c;
  UPDATE public."FinancePeriod" SET state='CLOSED',"closedAt"=c."closedAt","closedById"=actor,version=version+1,"usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE id=p.id RETURNING * INTO p;
  result:=jsonb_build_object('id',c.id,'periodId',p.id,'version',p.version,'closeVersion',c.version,'state',p.state,'sequence',c.sequence);
 ELSIF action='REOPEN' THEN
  SELECT * INTO c FROM public."FinancePeriodClose" WHERE id=(input->>'closeId')::uuid AND "periodId"=p.id FOR UPDATE;
  IF p.state<>'CLOSED' OR c.id IS NULL OR c.state<>'CLOSED' THEN RAISE EXCEPTION 'FINANCE_CLOSE_STATE' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedCloseVersion') IS DISTINCT FROM 'number' OR c.version<>(input->>'expectedCloseVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF EXISTS(SELECT 1 FROM public."FinancePeriod" WHERE state='CLOSED' AND "endDate">p."endDate") THEN RAISE EXCEPTION 'FINANCE_CLOSE_REOPEN_ORDER' USING ERRCODE='P0001';END IF;
  UPDATE public."FinancePeriodClose" SET state='REOPENED',version=version+1,"reopenedAt"=CURRENT_TIMESTAMP,"reopenedById"=actor,"reopenReason"=why WHERE id=c.id RETURNING * INTO c;
  UPDATE public."FinancePeriod" SET state='OPEN',"closedAt"=NULL,"closedById"=NULL,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=p.id RETURNING * INTO p;
  UPDATE public."FinanceReportExport" SET state=CASE WHEN state='READY' THEN 'SUPERSEDED' ELSE 'CANCELLED' END,version=version+1,"leaseId"=NULL,"leaseUntil"=NULL,"supersededAt"=CASE WHEN state='READY' THEN CURRENT_TIMESTAMP ELSE "supersededAt" END,"supersedeReason"=CASE WHEN state='READY' THEN 'Period reopened: '||left(why,470) ELSE "supersedeReason" END,"errorCode"=CASE WHEN state='READY' THEN "errorCode" ELSE 'FINANCE_EXPORT_PERIOD_REOPENED' END,"updatedAt"=CURRENT_TIMESTAMP WHERE state IN('QUEUED','RUNNING','FAILED','READY') AND coalesce((snapshot#>>'{report,metadata,to}')::date,(filters->>'to')::date,(filters->>'asOf')::date,(((filters->>'month')||'-01')::date+interval '1 month'-interval '1 day')::date)>=p."startDate";
  result:=jsonb_build_object('id',c.id,'periodId',p.id,'version',p.version,'closeVersion',c.version,'state',p.state,'sequence',c.sequence);
 ELSIF action='EXPORT' THEN
  SELECT * INTO c FROM public."FinancePeriodClose" WHERE id=(input->>'closeId')::uuid AND "periodId"=p.id;
  IF p.state<>'CLOSED' OR c.id IS NULL OR c.state<>'CLOSED' THEN RAISE EXCEPTION 'FINANCE_CLOSE_STATE' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'reportType') IS DISTINCT FROM 'string' OR input->>'reportType' NOT IN('TRIAL_BALANCE','PROFIT_LOSS','BALANCE_SHEET') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinanceReportExport"(id,"requesterId","requesterGrantId","periodCloseId","reportType",filters,mode,reason,"expiresAt") VALUES(gen_random_uuid(),actor,grant_id,c.id,input->>'reportType',c.reports->(input->>'reportType')->'filters','FINAL',why,CURRENT_TIMESTAMP+interval '24 hours') RETURNING * INTO j;
  result:=jsonb_build_object('id',j.id,'version',j.version,'state',j.state,'periodId',p.id,'closeId',c.id);
 ELSIF action='ISSUE_CREATE' THEN
  IF p.state<>'OPEN' OR jsonb_typeof(input->'kind') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'description') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'evidence') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinanceCloseIssue"(id,"periodId",kind,description,evidence,"createdById") VALUES(gen_random_uuid(),p.id,input->>'kind',trim(input->>'description'),trim(input->>'evidence'),actor) RETURNING * INTO i;
  result:=jsonb_build_object('id',i.id,'version',i.version,'state',i.state,'periodId',p.id);
 ELSE
  SELECT * INTO i FROM public."FinanceCloseIssue" WHERE id=(input->>'issueId')::uuid AND "periodId"=p.id FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF p.state<>'OPEN' OR i.state<>'OPEN' THEN RAISE EXCEPTION 'FINANCE_CLOSE_STATE' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR i.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'resolution') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  UPDATE public."FinanceCloseIssue" SET state='RESOLVED',version=version+1,"resolvedById"=actor,"resolvedAt"=CURRENT_TIMESTAMP,resolution=trim(input->>'resolution') WHERE id=i.id RETURNING * INTO i;result:=jsonb_build_object('id',i.id,'version',i.version,'state',i.state,'periodId',p.id);
 END IF;
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,'PERIOD_'||action,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_PERIOD_'||action,CASE WHEN action LIKE 'ISSUE_%' THEN 'FinanceCloseIssue' WHEN action='EXPORT' THEN 'FinanceReportExport' ELSE 'FinancePeriodClose' END,(result->>'id')::uuid,why,result||jsonb_build_object('snapshotHash',c."snapshotHash",'nonposting',true),request_id);RETURN result;
 EXCEPTION WHEN data_exception OR check_violation OR not_null_violation OR foreign_key_violation THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END $$;
CREATE OR REPLACE FUNCTION encova_finance_export_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE c public."FinancePeriodClose"%ROWTYPE;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_EXPORT_RETAINED' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN IF NEW.state<>'QUEUED' OR NEW.version<>1 OR NEW.attempts<>0 OR NEW.snapshot IS NOT NULL OR NEW.csv IS NOT NULL OR NEW.pdf IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF NEW."periodCloseId" IS NOT NULL THEN
  SELECT * INTO c FROM public."FinancePeriodClose" WHERE id=NEW."periodCloseId";
  IF c.id IS NULL OR c.state<>'CLOSED' OR NEW.mode<>'FINAL' OR NOT(c.reports ? NEW."reportType") OR NEW.filters IS DISTINCT FROM(c.reports->NEW."reportType"->'filters') OR NOT EXISTS(SELECT 1 FROM public."FinancePeriod" WHERE id=c."periodId" AND state='CLOSED') THEN RAISE EXCEPTION 'FINANCE_CLOSE_STATE' USING ERRCODE='P0001';END IF;
 END IF;RETURN NEW;END IF;
 IF ROW(NEW.id,NEW."requesterId",NEW."requesterGrantId",NEW."periodCloseId",NEW."reportType",NEW.filters,NEW.mode,NEW.reason,NEW."createdAt",NEW."expiresAt") IS DISTINCT FROM ROW(OLD.id,OLD."requesterId",OLD."requesterGrantId",OLD."periodCloseId",OLD."reportType",OLD.filters,OLD.mode,OLD.reason,OLD."createdAt",OLD."expiresAt") OR NEW.version<>OLD.version+1 OR(OLD.snapshot IS NOT NULL AND NEW.snapshot IS DISTINCT FROM OLD.snapshot) OR(OLD."snapshotHash" IS NOT NULL AND NEW."snapshotHash" IS DISTINCT FROM OLD."snapshotHash") THEN RAISE EXCEPTION 'FINANCE_EXPORT_RETAINED' USING ERRCODE='P0001';END IF;
 IF NOT(OLD.state='RUNNING' AND NEW.state='RUNNING' AND NEW.attempts=OLD.attempts AND OLD.snapshot IS NULL AND NEW.snapshot IS NOT NULL AND ROW(NEW."leaseId",NEW."leaseUntil") IS NOT DISTINCT FROM ROW(OLD."leaseId",OLD."leaseUntil") OR OLD.state IN('QUEUED','FAILED','RUNNING') AND NEW.state='RUNNING' AND NEW.attempts=OLD.attempts+1 OR OLD.state='RUNNING' AND NEW.state IN('READY','FAILED','CANCELLED') AND NEW.attempts=OLD.attempts OR OLD.state IN('QUEUED','FAILED') AND NEW.state IN('QUEUED','CANCELLED') AND NEW.attempts=OLD.attempts OR OLD.state='READY' AND NEW.state='SUPERSEDED' AND NEW.attempts=OLD.attempts AND ROW(NEW.csv,NEW.pdf,NEW."csvHash",NEW."pdfHash") IS NOT DISTINCT FROM ROW(OLD.csv,OLD.pdf,OLD."csvHash",OLD."pdfHash")) THEN RAISE EXCEPTION 'FINANCE_EXPORT_RETAINED' USING ERRCODE='P0001';END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_export_claim(target UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE job public."FinanceReportExport"%ROWTYPE;c public."FinancePeriodClose"%ROWTYPE;snap JSONB;token UUID;code TEXT;BEGIN
 PERFORM pg_advisory_xact_lock(987661);SELECT * INTO job FROM public."FinanceReportExport" WHERE id=target;IF job.id IS NULL THEN RETURN NULL;END IF;
 PERFORM public.encova_finance_lock_person(job."requesterId");PERFORM pg_advisory_xact_lock(629815);SELECT * INTO job FROM public."FinanceReportExport" WHERE id=target FOR UPDATE;
 IF job.state NOT IN('QUEUED','FAILED','RUNNING') OR(job.state='RUNNING' AND job."leaseUntil">CURRENT_TIMESTAMP) THEN RETURN NULL;END IF;
 IF job.attempts>=3 THEN IF job.state='RUNNING' THEN UPDATE public."FinanceReportExport" SET state='FAILED',version=version+1,"leaseId"=NULL,"leaseUntil"=NULL,"errorCode"='FINANCE_EXPORT_ATTEMPTS',"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;END IF;RETURN NULL;END IF;
 IF NOT public.encova_finance_export_access(job."requesterId",job."requesterGrantId") OR job."expiresAt"<=CURRENT_TIMESTAMP THEN
  UPDATE public."FinanceReportExport" SET state='CANCELLED',version=version+1,"leaseId"=NULL,"leaseUntil"=NULL,"errorCode"=CASE WHEN job."expiresAt"<=CURRENT_TIMESTAMP THEN 'EXPORT_EXPIRED' ELSE 'ACCESS_REVOKED' END,"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;RETURN NULL;
 END IF;
 IF job."periodCloseId" IS NOT NULL THEN
  SELECT * INTO c FROM public."FinancePeriodClose" WHERE id=job."periodCloseId";
  IF c.id IS NULL OR c.state<>'CLOSED' OR NOT EXISTS(SELECT 1 FROM public."FinancePeriod" WHERE id=c."periodId" AND state='CLOSED') THEN UPDATE public."FinanceReportExport" SET state='CANCELLED',version=version+1,"leaseId"=NULL,"leaseUntil"=NULL,"errorCode"='FINANCE_EXPORT_PERIOD_REOPENED',"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;RETURN NULL;END IF;
 END IF;
 token:=gen_random_uuid();UPDATE public."FinanceReportExport" SET state='RUNNING',version=version+1,attempts=attempts+1,"leaseId"=token,"leaseUntil"=CURRENT_TIMESTAMP+interval '60 seconds',"errorCode"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE id=target RETURNING * INTO job;
 BEGIN
  IF job.snapshot IS NULL THEN IF job."periodCloseId" IS NULL THEN snap:=public.encova_finance_export_capture(job."requesterId",job."reportType",job.filters,job.mode);ELSE snap:=(c.reports->job."reportType")||jsonb_build_object('periodClose',jsonb_build_object('id',c.id,'sequence',c.sequence,'snapshotHash',c."snapshotHash",'closedAt',c."closedAt"));END IF;ELSE snap:=job.snapshot;END IF;
  IF octet_length(snap::text)>6291456 THEN RAISE EXCEPTION 'FINANCE_EXPORT_LIMIT' USING ERRCODE='P0001';END IF;
  IF job.mode='FINAL' AND (NOT(snap#>>'{readiness,finalEligible}')::boolean OR(job."periodCloseId" IS NULL AND EXISTS(SELECT 1 FROM public."FinancePeriod" WHERE state='CLOSED' AND daterange("startDate","endDate",'[]') && daterange((snap#>>'{report,metadata,from}')::date,(snap#>>'{report,metadata,to}')::date,'[]')))) THEN
   UPDATE public."FinanceReportExport" SET state='FAILED',version=version+1,"leaseId"=NULL,"leaseUntil"=NULL,"errorCode"='FINANCE_EXPORT_INCOMPLETE',"failureDetails"=CASE WHEN octet_length((snap->'readiness')::text)<=32768 THEN snap->'readiness' ELSE jsonb_build_object('finalEligible',false,'issue','Review company report controls and bank reconciliations; diagnostics exceed the bounded summary') END,"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;RETURN NULL;
  END IF;
  IF job.snapshot IS NULL THEN UPDATE public."FinanceReportExport" SET snapshot=snap,"snapshotHash"=encode(sha256(convert_to(snap::text,'UTF8')),'hex'),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=target RETURNING * INTO job;END IF;
 EXCEPTION WHEN OTHERS THEN
  code:=CASE WHEN SQLERRM IN('FINANCE_EXPORT_LIMIT','FINANCE_EXPORT_INCONSISTENT','FINANCE_INVALID_INPUT','FINANCE_NOT_FOUND') THEN SQLERRM ELSE 'FINANCE_EXPORT_PREPARATION' END;
  UPDATE public."FinanceReportExport" SET state='FAILED',version=version+1,"leaseId"=NULL,"leaseUntil"=NULL,"errorCode"=code,"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;RETURN NULL;
 END;
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),job."requesterId",'FINANCE_EXPORT_CAPTURE','FinanceReportExport',job.id,'Capture frozen authorized report',jsonb_build_object('snapshotHash',job."snapshotHash",'attempt',job.attempts,'mode',job.mode),gen_random_uuid());
 RETURN jsonb_build_object('id',job.id,'leaseId',token,'snapshotHash',job."snapshotHash",'snapshot',job.snapshot);
END $$;
CREATE OR REPLACE FUNCTION encova_finance_export_finish(target UUID,token UUID,snapshot_hash TEXT,csv_bytes BYTEA,pdf_bytes BYTEA,failure_code TEXT DEFAULT NULL) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE job public."FinanceReportExport"%ROWTYPE;allowed BOOLEAN;BEGIN
 PERFORM pg_advisory_xact_lock(987661);SELECT * INTO job FROM public."FinanceReportExport" WHERE id=target;IF job.id IS NULL THEN RETURN false;END IF;PERFORM public.encova_finance_lock_person(job."requesterId");PERFORM pg_advisory_xact_lock(629815);SELECT * INTO job FROM public."FinanceReportExport" WHERE id=target FOR UPDATE;
 IF job.state<>'RUNNING' OR job."leaseId" IS DISTINCT FROM token OR job."leaseUntil"<=CURRENT_TIMESTAMP OR job."snapshotHash" IS DISTINCT FROM snapshot_hash THEN RETURN false;END IF;
 allowed:=public.encova_finance_export_access(job."requesterId",job."requesterGrantId") AND job."expiresAt">CURRENT_TIMESTAMP AND(job."periodCloseId" IS NULL OR EXISTS(SELECT 1 FROM public."FinancePeriodClose" c JOIN public."FinancePeriod" p ON p.id=c."periodId" WHERE c.id=job."periodCloseId" AND c.state='CLOSED' AND p.state='CLOSED'));
 IF NOT allowed THEN UPDATE public."FinanceReportExport" SET state='CANCELLED',version=version+1,"leaseId"=NULL,"leaseUntil"=NULL,"errorCode"='ACCESS_REVOKED_OR_EXPIRED',"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;RETURN false;END IF;
 IF failure_code IS NOT NULL THEN
  UPDATE public."FinanceReportExport" SET state='FAILED',version=version+1,"leaseId"=NULL,"leaseUntil"=NULL,"errorCode"=CASE WHEN failure_code IN('FINANCE_EXPORT_LIMIT','FINANCE_EXPORT_RENDER') THEN failure_code ELSE 'FINANCE_EXPORT_RENDER' END,"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;RETURN false;
 END IF;
 IF job.mode='FINAL' AND job."periodCloseId" IS NULL AND EXISTS(SELECT 1 FROM public."FinancePeriod" WHERE state='CLOSED' AND daterange("startDate","endDate",'[]') && daterange((job.snapshot#>>'{report,metadata,from}')::date,(job.snapshot#>>'{report,metadata,to}')::date,'[]')) THEN UPDATE public."FinanceReportExport" SET state='FAILED',version=version+1,"leaseId"=NULL,"leaseUntil"=NULL,"errorCode"='FINANCE_EXPORT_CLOSED_PERIOD',"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;RETURN false;END IF;
 IF csv_bytes IS NULL OR pdf_bytes IS NULL OR octet_length(csv_bytes) NOT BETWEEN 1 AND 3145728 OR octet_length(pdf_bytes) NOT BETWEEN 1 AND 3145728 OR substring(pdf_bytes FROM 1 FOR 5)<>convert_to('%PDF-','UTF8') THEN RAISE EXCEPTION 'FINANCE_EXPORT_LIMIT' USING ERRCODE='P0001';END IF;
 UPDATE public."FinanceReportExport" SET state='READY',version=version+1,"leaseId"=NULL,"leaseUntil"=NULL,csv=csv_bytes,pdf=pdf_bytes,"csvHash"=encode(sha256(csv_bytes),'hex'),"pdfHash"=encode(sha256(pdf_bytes),'hex'),"errorCode"=NULL,"failureDetails"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),job."requesterId",'FINANCE_EXPORT_READY','FinanceReportExport',job.id,'Prepare private CSV and PDF artifacts',jsonb_build_object('snapshotHash',snapshot_hash,'csvHash',encode(sha256(csv_bytes),'hex'),'pdfHash',encode(sha256(pdf_bytes),'hex')),gen_random_uuid());RETURN true;
END $$;
CREATE FUNCTION encova_finance_close_read(actor UUID,action TEXT,input JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE p public."FinancePeriod"%ROWTYPE;c public."FinancePeriodClose"%ROWTYPE;pack JSONB;result JSONB;items JSONB;total INTEGER;page INTEGER;owner BOOLEAN;snapshot JSONB;BEGIN
 IF NOT public.encova_finance_export_access(actor) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF action IS NULL OR action NOT IN('PREVIEW','HISTORY','DETAIL','REPORT','ISSUES') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['periodId','closeId','reportType','page']<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 SELECT * INTO p FROM public."FinancePeriod" WHERE id=(input->>'periodId')::uuid;IF p.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
 owner:=EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=actor);page:=coalesce((input->>'page')::integer,1);IF page NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF action='PREVIEW' THEN
  pack:=public.encova_finance_close_pack(actor,p.id);
  RETURN(pack-'reports')||jsonb_build_object('canManage',owner,'reportRows',(SELECT jsonb_object_agg(key,value->'rowCount') FROM jsonb_each(pack->'reports')));
 ELSIF action='HISTORY' THEN
  SELECT count(*) INTO total FROM public."FinancePeriodClose" WHERE "periodId"=p.id;
  SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.sequence DESC),'[]'::jsonb) INTO items FROM(SELECT id,sequence,state,version,"closedAt","closedById","reopenedAt","reopenedById","snapshotHash",reason,"reopenReason" FROM public."FinancePeriodClose" WHERE "periodId"=p.id ORDER BY sequence DESC LIMIT 25 OFFSET(page-1)*25)b;
 ELSIF action='ISSUES' THEN
  SELECT count(*) INTO total FROM public."FinanceCloseIssue" WHERE "periodId"=p.id;
  SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b."createdAt" DESC,b.id DESC),'[]'::jsonb) INTO items FROM(SELECT * FROM public."FinanceCloseIssue" WHERE "periodId"=p.id ORDER BY "createdAt" DESC,id DESC LIMIT 25 OFFSET(page-1)*25)b;
 ELSE
  SELECT * INTO c FROM public."FinancePeriodClose" WHERE id=(input->>'closeId')::uuid AND "periodId"=p.id;IF c.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF action='DETAIL' THEN RETURN(to_jsonb(c)-ARRAY['reports','closedGrantId'])||jsonb_build_object('period',jsonb_build_object('id',p.id,'name',p.name,'state',p.state,'version',p.version),'canManage',owner,'reportRows',(SELECT jsonb_object_agg(key,value->'rowCount') FROM jsonb_each(c.reports)));END IF;
  IF input->>'reportType' NOT IN('TRIAL_BALANCE','PROFIT_LOSS','BALANCE_SHEET') OR input->>'reportType' IS NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  snapshot:=c.reports->(input->>'reportType');total:=(snapshot->>'rowCount')::integer;
  RETURN(snapshot-ARRAY['report'])||jsonb_build_object('periodCloseId',c.id,'closeState',c.state,'closeSnapshotHash',c."snapshotHash",'metadata',snapshot#>'{report,metadata}','summary',(snapshot->'report')-ARRAY['items','metadata','page','pages'],'items',(SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) FROM jsonb_array_elements(snapshot#>'{report,items}') WITH ORDINALITY WHERE ordinality BETWEEN(page-1)*25+1 AND page*25),'total',total,'page',page,'pages',greatest(1,ceil(total/25.0)::integer));
 END IF;
 RETURN jsonb_build_object('period',jsonb_build_object('id',p.id,'name',p.name,'state',p.state,'version',p.version),'items',items,'total',total,'page',page,'pages',greatest(1,ceil(total/25.0)::integer),'canManage',owner);
 EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END $$;
ALTER TABLE "FinancePeriodClose" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceCloseIssue" ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE f RECORD;r TEXT;t TEXT;BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'encova_finance_close_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  FOREACH r IN ARRAY ARRAY['anon','authenticated','encova_app'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['FinancePeriodClose','FinanceCloseIssue'] LOOP
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);END IF;END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION encova_finance_close_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID),encova_finance_close_read(UUID,TEXT,JSONB) TO encova_app;END IF;
END $$;
COMMIT;
