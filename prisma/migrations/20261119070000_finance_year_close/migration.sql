BEGIN;
-- Explicit owner-reviewed fiscal ranges. No live calendar, mapping or balances are seeded.
CREATE TABLE "FinanceFiscalYear"(
 id UUID PRIMARY KEY,name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 "startDate" DATE NOT NULL,"endDate" DATE NOT NULL,"retainedAccountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,
 evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),state TEXT NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','CLOSED','VOID')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("startDate">=DATE '0001-01-01' AND "endDate" BETWEEN "startDate" AND DATE '9999-12-31'));
CREATE INDEX "FinanceFiscalYear_endDate_id_idx" ON "FinanceFiscalYear"("endDate",id);
CREATE TABLE "FinanceYearClose"(
 id UUID PRIMARY KEY,"fiscalYearId" UUID NOT NULL REFERENCES "FinanceFiscalYear" ON DELETE RESTRICT,sequence INTEGER NOT NULL CHECK(sequence>0),
 state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','CLOSED','REVERSED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"yearVersion" INTEGER NOT NULL,
 "basisHash" TEXT NOT NULL CHECK("basisHash"~'^[0-9a-f]{64}$'),checklist JSONB NOT NULL,lines JSONB NOT NULL CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines)<=400),
 "netProfit" NUMERIC(20,2) NOT NULL,"beforeReports" JSONB NOT NULL,"afterReports" JSONB,"snapshotHash" TEXT,
 "periodId" UUID NOT NULL REFERENCES "FinancePeriod" ON DELETE RESTRICT,"periodCloseId" UUID REFERENCES "FinancePeriodClose" ON DELETE RESTRICT,
 "journalId" UUID UNIQUE REFERENCES "FinanceJournalEntry" ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "reversalJournalId" UUID UNIQUE REFERENCES "FinanceJournalEntry" ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 "closedById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"closedGrantId" UUID NOT NULL,"closedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),"postingReviewEvidence" TEXT NOT NULL CHECK(length(trim("postingReviewEvidence")) BETWEEN 3 AND 1000),"adjustmentReviewEvidence" TEXT NOT NULL CHECK(length(trim("adjustmentReviewEvidence")) BETWEEN 3 AND 1000),
 "reversedAt" TIMESTAMPTZ,"reversedById" UUID REFERENCES "Person" ON DELETE RESTRICT,"reverseReason" TEXT,
 CHECK(octet_length("beforeReports"::text)<=16777216 AND octet_length("afterReports"::text)<=16777216),
 CHECK((jsonb_array_length(lines)=0)=("journalId" IS NULL)),
 CHECK((state='REVERSED')=("reversedAt" IS NOT NULL AND "reversedById" IS NOT NULL AND "reverseReason" IS NOT NULL)),
 UNIQUE("fiscalYearId",sequence));
CREATE UNIQUE INDEX "FinanceYearClose_current" ON "FinanceYearClose"("fiscalYearId") WHERE state IN('DRAFT','CLOSED');
CREATE TRIGGER "FinanceFiscalYear_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceFiscalYear" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_close_lock();
CREATE TRIGGER "FinanceYearClose_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceYearClose" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_close_lock();
CREATE FUNCTION encova_finance_year_mapping(target UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=target AND active AND "isPosting" AND NOT "isContra" AND NOT "isCashEquivalent" AND currency='PKR' AND type='EQUITY' AND "normalSide"='CREDIT' AND "reportGroup"='EQUITY' AND "controlType"='NONE')
$$;
CREATE FUNCTION encova_finance_year_lines(target UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH balances AS(SELECT a.id,a.code,coalesce(sum(l.debit-l.credit),0) AS balance FROM public."FinanceAccount" a JOIN public."FinanceJournalLine" l ON l."accountId"=a.id JOIN public."FinanceJournalEntry" e ON e.id=l."journalId" JOIN public."FinanceFiscalYear" y ON y.id=target WHERE a.type IN('INCOME','DIRECT_COST','OPERATING_EXPENSE','OTHER_INCOME','OTHER_EXPENSE') AND e."postingDate"<=y."endDate" GROUP BY a.id HAVING sum(l.debit-l.credit)<>0),
 legs AS(SELECT id AS "accountId",-balance AS signed,code FROM balances UNION ALL SELECT y."retainedAccountId",sum(balance),'~retained' FROM balances CROSS JOIN public."FinanceFiscalYear" y WHERE y.id=target GROUP BY y."retainedAccountId" HAVING sum(balance)<>0),
 numbered AS(SELECT row_number() OVER(ORDER BY legs.code,"accountId") AS sequence,"accountId",a.code,a.name AS "accountName",'Fiscal-year retained earnings transfer'::text AS description,greatest(signed,0)::numeric(20,2)::text AS debit,greatest(-signed,0)::numeric(20,2)::text AS credit FROM legs JOIN public."FinanceAccount" a ON a.id=legs."accountId")
 SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY sequence),'[]'::jsonb) FROM numbered n
$$;
CREATE FUNCTION encova_finance_year_reports(actor UUID,target UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 DECLARE y public."FinanceFiscalYear"%ROWTYPE;kind TEXT;result JSONB:='{}'::jsonb;snap JSONB;BEGIN
 SELECT * INTO y FROM public."FinanceFiscalYear" WHERE id=target;
 FOREACH kind IN ARRAY ARRAY['TRIAL_BALANCE','PROFIT_LOSS','BALANCE_SHEET'] LOOP
  snap:=public.encova_finance_export_capture(actor,kind,CASE WHEN kind='BALANCE_SHEET' THEN jsonb_build_object('asOf',y."endDate",'q','') ELSE jsonb_build_object('from',y."startDate",'to',y."endDate",'q','')||CASE WHEN kind='TRIAL_BALANCE' THEN jsonb_build_object('includeZero','NO') ELSE '{}'::jsonb END END,'REVIEW');
  result:=result||jsonb_build_object(kind,snap);
 END LOOP;IF octet_length(result::text)>16777216 THEN RAISE EXCEPTION 'FINANCE_EXPORT_LIMIT' USING ERRCODE='P0001';END IF;RETURN result;
END $$;
CREATE FUNCTION encova_finance_year_normalize(reports JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_object_agg(key,jsonb_set(value,'{report,metadata}',(value#>'{report,metadata}')-ARRAY['generatedAt','databaseSnapshot'])),'{}'::jsonb) FROM jsonb_each(reports)
$$;
CREATE FUNCTION encova_finance_year_pack(actor UUID,target UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 DECLARE y public."FinanceFiscalYear"%ROWTYPE;p public."FinancePeriod"%ROWTYPE;coverage BOOLEAN;prior INTEGER;opening INTEGER;invalid INTEGER;pack JSONB;reports JSONB;lines JSONB;checklist JSONB;profit NUMERIC;BEGIN
 SELECT * INTO y FROM public."FinanceFiscalYear" WHERE id=target;IF y.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
 SELECT * INTO p FROM public."FinancePeriod" WHERE state<>'VOID' AND "endDate"=y."endDate" AND "startDate">=y."startDate";
 SELECT coalesce(sum("endDate"-"startDate"+1),0)=y."endDate"-y."startDate"+1 AND min("startDate")=y."startDate" AND max("endDate")=y."endDate" INTO coverage FROM public."FinancePeriod" WHERE state<>'VOID' AND "startDate">=y."startDate" AND "endDate"<=y."endDate";
 coverage:=coalesce(coverage,false) AND NOT EXISTS(SELECT 1 FROM public."FinancePeriod" WHERE state<>'VOID' AND daterange("startDate","endDate",'[]') && daterange(y."startDate",y."endDate",'[]') AND("startDate"<y."startDate" OR "endDate">y."endDate"));
 SELECT count(*) INTO prior FROM public."FinancePeriod" x WHERE x.state<>'VOID' AND x."endDate"<y."endDate" AND(x.state<>'CLOSED' OR NOT EXISTS(SELECT 1 FROM public."FinancePeriodClose" WHERE "periodId"=x.id AND state='CLOSED'));
 SELECT count(*) INTO opening FROM(SELECT a.id FROM public."FinanceAccount" a JOIN public."FinanceJournalLine" l ON l."accountId"=a.id JOIN public."FinanceJournalEntry" e ON e.id=l."journalId" WHERE a.type IN('INCOME','DIRECT_COST','OPERATING_EXPENSE','OTHER_INCOME','OTHER_EXPENSE') AND e."postingDate"<y."startDate" GROUP BY a.id HAVING sum(l.debit-l.credit)<>0)b;
 IF p.id IS NOT NULL THEN pack:=public.encova_finance_close_pack(actor,p.id);END IF;
 lines:=public.encova_finance_year_lines(target);reports:=public.encova_finance_year_reports(actor,target);
 SELECT count(*) INTO invalid FROM jsonb_array_elements(lines) l JOIN public."FinanceAccount" a ON a.id=(l->>'accountId')::uuid WHERE NOT a.active OR NOT a."isPosting" OR a.currency<>'PKR';
 SELECT -coalesce(sum(l.debit-l.credit),0) INTO profit FROM public."FinanceJournalLine" l JOIN public."FinanceJournalEntry" e ON e.id=l."journalId" JOIN public."FinanceAccount" a ON a.id=l."accountId" WHERE e."postingDate"<=y."endDate" AND a.type IN('INCOME','DIRECT_COST','OPERATING_EXPENSE','OTHER_INCOME','OTHER_EXPENSE');
 checklist:=jsonb_build_object('ready',y.state='OPEN' AND coverage AND prior=0 AND opening=0 AND invalid=0 AND jsonb_array_length(lines)<=400 AND public.encova_finance_year_mapping(y."retainedAccountId") AND coalesce((pack#>>'{checklist,ready}')::boolean,false) AND NOT EXISTS(SELECT 1 FROM public."FinanceFiscalYear" WHERE state='OPEN' AND "endDate"<y."startDate"), 'completePeriodCoverage',coverage,'priorUnclosedPeriods',prior,'priorUnclosedIncomeAccounts',opening,'invalidClosingAccounts',invalid,'retainedMappingValid',public.encova_finance_year_mapping(y."retainedAccountId"),'lineCount',jsonb_array_length(lines),'finalPeriod',pack->'period','periodChecklist',pack->'checklist');
 RETURN jsonb_build_object('year',to_jsonb(y),'checklist',checklist,'lines',lines,'netProfit',profit::numeric(20,2)::text,'reports',reports,'basisHash',encode(sha256(convert_to(jsonb_build_object('year',to_jsonb(y)-'createdAt','checklist',checklist,'lines',lines,'reports',public.encova_finance_year_normalize(reports))::text,'UTF8')),'hex'));
END $$;
CREATE FUNCTION encova_finance_year_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_YEAR_RETAINED' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'OPEN' OR NEW.version<>1 OR NOT public.encova_finance_export_access(NEW."createdById") OR NOT EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=NEW."createdById") OR NOT public.encova_finance_year_mapping(NEW."retainedAccountId") THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF EXISTS(SELECT 1 FROM public."FinanceFiscalYear" WHERE state<>'VOID' AND daterange("startDate","endDate",'[]') && daterange(NEW."startDate",NEW."endDate",'[]')) THEN RAISE EXCEPTION 'FINANCE_YEAR_OVERLAP' USING ERRCODE='P0001';END IF;
 ELSE
  IF(to_jsonb(NEW)-ARRAY['state','version']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version']) OR NEW.version<>OLD.version+1 OR NOT(
   OLD.state='OPEN' AND NEW.state='CLOSED' AND EXISTS(SELECT 1 FROM public."FinanceYearClose" WHERE "fiscalYearId"=OLD.id AND state='CLOSED') OR
   OLD.state='CLOSED' AND NEW.state='OPEN' AND EXISTS(SELECT 1 FROM public."FinanceYearClose" WHERE "fiscalYearId"=OLD.id AND state='REVERSED') AND NOT EXISTS(SELECT 1 FROM public."FinanceYearClose" WHERE "fiscalYearId"=OLD.id AND state IN('DRAFT','CLOSED')) OR
   OLD.state='OPEN' AND NEW.state='VOID' AND NOT EXISTS(SELECT 1 FROM public."FinanceYearClose" WHERE "fiscalYearId"=OLD.id)) THEN RAISE EXCEPTION 'FINANCE_YEAR_STATE' USING ERRCODE='P0001';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceFiscalYear_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceFiscalYear" FOR EACH ROW EXECUTE FUNCTION encova_finance_year_guard();
CREATE FUNCTION encova_finance_year_cycle_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE pack JSONB;y public."FinanceFiscalYear"%ROWTYPE;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_YEAR_RETAINED' USING ERRCODE='P0001';END IF;
 SELECT * INTO y FROM public."FinanceFiscalYear" WHERE id=NEW."fiscalYearId";
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'DRAFT' OR NEW.version<>1 OR NEW."afterReports" IS NOT NULL OR NEW."periodCloseId" IS NOT NULL OR NEW."snapshotHash" IS NOT NULL OR NEW."reversalJournalId" IS NOT NULL OR NOT public.encova_finance_export_access(NEW."closedById",NEW."closedGrantId") OR NOT EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=NEW."closedById") THEN RAISE EXCEPTION 'FINANCE_YEAR_STATE' USING ERRCODE='P0001';END IF;
  pack:=public.encova_finance_year_pack(NEW."closedById",y.id);
  IF NOT(pack#>>'{checklist,ready}')::boolean OR NEW."basisHash" IS DISTINCT FROM pack->>'basisHash' OR NEW."yearVersion"<>y.version OR NEW.lines IS DISTINCT FROM pack->'lines' OR NEW.checklist IS DISTINCT FROM pack->'checklist' OR NEW."netProfit"<>(pack->>'netProfit')::numeric OR public.encova_finance_year_normalize(NEW."beforeReports") IS DISTINCT FROM public.encova_finance_year_normalize(pack->'reports') OR NEW."periodId" IS DISTINCT FROM(pack#>>'{checklist,finalPeriod,id}')::uuid OR NEW.sequence<>coalesce((SELECT max(sequence) FROM public."FinanceYearClose" WHERE "fiscalYearId"=y.id),0)+1 THEN RAISE EXCEPTION 'FINANCE_CLOSE_STALE' USING ERRCODE='P0001';END IF;
 ELSIF OLD.state='DRAFT' AND NEW.state='CLOSED' THEN
  IF NEW.version<>OLD.version OR(to_jsonb(NEW)-ARRAY['state','afterReports','snapshotHash','periodCloseId']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','afterReports','snapshotHash','periodCloseId']) OR NOT EXISTS(SELECT 1 FROM public."FinancePeriodClose" WHERE id=NEW."periodCloseId" AND "periodId"=NEW."periodId" AND state='CLOSED') OR public.encova_finance_year_normalize(NEW."afterReports") IS DISTINCT FROM public.encova_finance_year_normalize(public.encova_finance_year_reports(NEW."closedById",y.id)) OR NEW."snapshotHash" IS DISTINCT FROM encode(sha256(convert_to(jsonb_build_object('before',NEW."beforeReports",'after',NEW."afterReports")::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'FINANCE_YEAR_RETAINED' USING ERRCODE='P0001';END IF;
 ELSIF OLD.state='CLOSED' AND NEW.state='REVERSED' THEN
  IF NEW.version<>OLD.version+1 OR(to_jsonb(NEW)-ARRAY['state','version','reversalJournalId','reversedAt','reversedById','reverseReason']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','reversalJournalId','reversedAt','reversedById','reverseReason']) OR NEW."reversedAt" IS NULL OR length(trim(NEW."reverseReason")) NOT BETWEEN 3 AND 500 OR (OLD."journalId" IS NULL) IS DISTINCT FROM(NEW."reversalJournalId" IS NULL) OR NOT public.encova_finance_export_access(NEW."reversedById") OR NOT EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=NEW."reversedById") THEN RAISE EXCEPTION 'FINANCE_YEAR_RETAINED' USING ERRCODE='P0001';END IF;
  IF EXISTS(SELECT 1 FROM public."FinancePeriod" WHERE state='CLOSED' AND "endDate">y."endDate") OR EXISTS(SELECT 1 FROM public."FinanceFiscalYear" WHERE state='CLOSED' AND "endDate">y."endDate") THEN RAISE EXCEPTION 'FINANCE_CLOSE_REOPEN_ORDER' USING ERRCODE='P0001';END IF;
 ELSE RAISE EXCEPTION 'FINANCE_YEAR_RETAINED' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceYearClose_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceYearClose" FOR EACH ROW EXECUTE FUNCTION encova_finance_year_cycle_guard();
DO $$ DECLARE definition TEXT;BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public."FinanceJournalEntry"'::regclass AND conname='FinanceJournalEntry_source_identity';
 ALTER TABLE public."FinanceJournalEntry" DROP CONSTRAINT "FinanceJournalEntry_source_identity";
 EXECUTE 'ALTER TABLE public."FinanceJournalEntry" ADD CONSTRAINT "FinanceJournalEntry_source_identity" CHECK ('||substring(definition FROM 8 FOR length(definition)-8)||' OR ("sourceType"=''YEAR_CLOSE'' AND "sourceAction" IN(''POST'',''REVERSE'') AND "draftId" IS NULL AND "invoiceId" IS NULL AND "billId" IS NULL AND "customerDocumentId" IS NULL AND "supplierDocumentId" IS NULL AND "movementId" IS NULL AND "assetMovementId" IS NULL AND "costAllocationId" IS NULL))';
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
 IF NEW."sourceType"='YEAR_CLOSE' THEN
  IF NOT EXISTS(SELECT 1 FROM public."FinanceYearClose" c JOIN public."FinanceFiscalYear" y ON y.id=c."fiscalYearId" WHERE c.id=NEW."sourceId" AND c."periodId"=NEW."periodId" AND y."endDate"=NEW."postingDate" AND NEW.description='Fiscal-year retained earnings transfer' AND NEW.evidence=c.reason AND(
   NEW."sourceAction"='POST' AND c.state='DRAFT' AND c."journalId"=NEW.id AND NEW."reversalOfId" IS NULL AND NEW."postedById"=c."closedById" OR
   NEW."sourceAction"='REVERSE' AND c.state='REVERSED' AND c."reversalJournalId"=NEW.id AND NEW."reversalOfId"=c."journalId" AND NEW."postedById"=c."reversedById")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  UPDATE public."FinancePeriod" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=period.id;RETURN NEW;
 END IF;
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
 IF entry."sourceType"='YEAR_CLOSE' THEN
  IF NEW."projectId" IS NOT NULL OR NEW."partyId" IS NOT NULL OR NEW."invoiceLineId" IS NOT NULL OR NEW."billLineId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public."FinanceYearClose" c CROSS JOIN LATERAL jsonb_array_elements(c.lines) x WHERE c.id=entry."sourceId" AND (x->>'sequence')::integer=NEW.sequence AND (x->>'accountId')::uuid=NEW."accountId" AND x->>'description'=NEW.description AND (x->>CASE WHEN entry."sourceAction"='POST' THEN 'debit' ELSE 'credit' END)::numeric=NEW.debit AND (x->>CASE WHEN entry."sourceAction"='POST' THEN 'credit' ELSE 'debit' END)::numeric=NEW.credit) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_mark_accounts(ARRAY[NEW."accountId"]);RETURN NEW;
 END IF;
 IF entry."sourceType"='JOURNAL_DRAFT' AND EXISTS(SELECT 1 FROM public."FinanceFiscalYear" WHERE state<>'VOID' AND "retainedAccountId"=NEW."accountId") THEN RAISE EXCEPTION 'FINANCE_CONTROL_PROTECTED' USING ERRCODE='P0001';END IF;
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
 IF entry."sourceType"='YEAR_CLOSE' THEN
  PERFORM public.encova_finance_year_check(entry."sourceId");RETURN NULL;
 END IF;
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
CREATE FUNCTION encova_finance_year_check(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE c public."FinanceYearClose"%ROWTYPE;y public."FinanceFiscalYear"%ROWTYPE;e public."FinanceJournalEntry"%ROWTYPE;action TEXT;expected UUID;BEGIN
 SELECT * INTO c FROM public."FinanceYearClose" WHERE id=target;IF c.id IS NULL OR c.state='DRAFT' THEN RAISE EXCEPTION 'FINANCE_YEAR_STATE' USING ERRCODE='P0001';END IF;
 SELECT * INTO y FROM public."FinanceFiscalYear" WHERE id=c."fiscalYearId";
 IF c."afterReports" IS NULL OR c."periodCloseId" IS NULL OR c."snapshotHash" IS DISTINCT FROM encode(sha256(convert_to(jsonb_build_object('before',c."beforeReports",'after',c."afterReports")::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF c.state='CLOSED' AND(y.state<>'CLOSED' OR NOT EXISTS(SELECT 1 FROM public."FinancePeriodClose" pc JOIN public."FinancePeriod" p ON p.id=pc."periodId" WHERE pc.id=c."periodCloseId" AND pc.state='CLOSED' AND p.state='CLOSED') OR EXISTS(SELECT 1 FROM public."FinanceJournalLine" l JOIN public."FinanceJournalEntry" je ON je.id=l."journalId" JOIN public."FinanceAccount" a ON a.id=l."accountId" WHERE je."postingDate"<=y."endDate" AND a.type IN('INCOME','DIRECT_COST','OPERATING_EXPENSE','OTHER_INCOME','OTHER_EXPENSE') GROUP BY a.id HAVING sum(l.debit-l.credit)<>0)) THEN RAISE EXCEPTION 'FINANCE_YEAR_STATE' USING ERRCODE='P0001';END IF;
 FOREACH action IN ARRAY ARRAY['POST','REVERSE'] LOOP
  expected:=CASE WHEN action='POST' THEN c."journalId" ELSE c."reversalJournalId" END;
  IF expected IS NULL THEN
   IF EXISTS(SELECT 1 FROM public."FinanceJournalEntry" WHERE "sourceType"='YEAR_CLOSE' AND "sourceId"=c.id AND "sourceAction"=action) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;CONTINUE;
  END IF;
  SELECT * INTO e FROM public."FinanceJournalEntry" WHERE id=expected;
  IF e.id IS NULL OR e."sourceType"<>'YEAR_CLOSE' OR e."sourceId"<>c.id OR e."sourceAction"<>action OR e."postingDate"<>y."endDate" OR e."periodId"<>c."periodId" OR e."reversalOfId" IS DISTINCT FROM (CASE WHEN action='POST' THEN NULL::uuid ELSE c."journalId" END) OR (SELECT count(*) FROM public."FinanceJournalLine" WHERE "journalId"=e.id)<>jsonb_array_length(c.lines) OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(c.lines) x FULL JOIN public."FinanceJournalLine" l ON l."journalId"=e.id AND l.sequence=(x->>'sequence')::integer WHERE l."journalId"=e.id OR x IS NOT NULL GROUP BY x,l."accountId",l.description,l.debit,l.credit,l."partyId",l."projectId",l."billLineId",l."invoiceLineId",l.id HAVING l.id IS NULL OR x IS NULL OR l."accountId" IS DISTINCT FROM(x->>'accountId')::uuid OR l.description IS DISTINCT FROM x->>'description' OR l.debit IS DISTINCT FROM(x->>CASE WHEN action='POST' THEN 'debit' ELSE 'credit' END)::numeric OR l.credit IS DISTINCT FROM(x->>CASE WHEN action='POST' THEN 'credit' ELSE 'debit' END)::numeric OR l."partyId" IS NOT NULL OR l."projectId" IS NOT NULL OR l."billLineId" IS NOT NULL OR l."invoiceLineId" IS NOT NULL
  ) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 END LOOP;
END $$;
CREATE FUNCTION encova_finance_year_consistency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE c RECORD;y public."FinanceFiscalYear"%ROWTYPE;target UUID;BEGIN
 IF TG_TABLE_NAME='FinanceYearClose' THEN PERFORM public.encova_finance_year_check(NEW.id);
 ELSIF TG_TABLE_NAME='FinanceFiscalYear' THEN
  SELECT * INTO y FROM public."FinanceFiscalYear" WHERE id=NEW.id;
  IF(y.state='CLOSED') IS DISTINCT FROM EXISTS(SELECT 1 FROM public."FinanceYearClose" WHERE "fiscalYearId"=y.id AND state='CLOSED') THEN RAISE EXCEPTION 'FINANCE_YEAR_STATE' USING ERRCODE='P0001';END IF;
 ELSE FOR c IN SELECT id FROM public."FinanceYearClose" WHERE "periodId"=NEW.id AND state='CLOSED' LOOP PERFORM public.encova_finance_year_check(c.id);END LOOP;END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FinanceYearClose_valid" AFTER INSERT OR UPDATE ON "FinanceYearClose" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_year_consistency();
CREATE CONSTRAINT TRIGGER "FinanceFiscalYear_valid" AFTER INSERT OR UPDATE ON "FinanceFiscalYear" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_year_consistency();
CREATE CONSTRAINT TRIGGER "FinancePeriod_year_valid" AFTER INSERT OR UPDATE ON "FinancePeriod" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_year_consistency();
-- Retain the checked monthly implementation privately. Generic monthly reopening cannot bypass an annual close.
ALTER FUNCTION encova_finance_close_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID) RENAME TO encova_finance_close_period_internal;
CREATE FUNCTION encova_finance_close_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(987661);
 IF action='REOPEN' THEN
  PERFORM public.encova_finance_lock_person(actor);
  IF NOT public.encova_finance_export_access(actor) OR NOT public.encova_finance_session_ok(actor,provider,session_id) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
  PERFORM pg_advisory_xact_lock(629815);IF NOT EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=actor) THEN RAISE EXCEPTION 'FINANCE_OWNER_REQUIRED' USING ERRCODE='P0001';END IF;
 END IF;
 IF action='REOPEN' AND EXISTS(SELECT 1 FROM public."FinanceFiscalYear" y JOIN public."FinancePeriod" p ON p.id=(input->>'periodId')::uuid WHERE y.state='CLOSED' AND p."endDate"<=y."endDate") THEN RAISE EXCEPTION 'FINANCE_YEAR_REOPEN_REQUIRED' USING ERRCODE='P0001';END IF;
 RETURN public.encova_finance_close_period_internal(actor,provider,session_id,verified_at,action,input,request_key,request_id);
END $$;
CREATE FUNCTION encova_finance_year_emit(actor UUID,target UUID,action TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE c public."FinanceYearClose"%ROWTYPE;y public."FinanceFiscalYear"%ROWTYPE;entry_id UUID;BEGIN
 SELECT * INTO c FROM public."FinanceYearClose" WHERE id=target;SELECT * INTO y FROM public."FinanceFiscalYear" WHERE id=c."fiscalYearId";
 entry_id:=CASE WHEN action='POST' THEN c."journalId" ELSE c."reversalJournalId" END;IF entry_id IS NULL THEN RETURN;END IF;
 INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","postingDate","periodId",description,evidence,"postedById","reversalOfId") VALUES(entry_id,'YRC-'||entry_id::text,'YEAR_CLOSE',c.id,action,y."endDate",c."periodId",'Fiscal-year retained earnings transfer',c.reason,actor,CASE WHEN action='POST' THEN NULL ELSE c."journalId" END);
 INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit) SELECT gen_random_uuid(),entry_id,(x->>'sequence')::integer,(x->>'accountId')::uuid,x->>'description',(x->>CASE WHEN action='POST' THEN 'debit' ELSE 'credit' END)::numeric,(x->>CASE WHEN action='POST' THEN 'credit' ELSE 'debit' END)::numeric FROM jsonb_array_elements(c.lines) x ORDER BY(x->>'sequence')::integer;
END $$;
CREATE FUNCTION encova_finance_year_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
 DECLARE y public."FinanceFiscalYear"%ROWTYPE;c public."FinanceYearClose"%ROWTYPE;p public."FinancePeriod"%ROWTYPE;pc public."FinancePeriodClose"%ROWTYPE;receipt public."FinanceLedgerReceipt"%ROWTYPE;digest TEXT;why TEXT;fields TEXT[];pack JSONB;after_reports JSONB;period_pack JSONB;period_result JSONB;result JSONB;grant_id UUID;BEGIN
 IF action IS NULL OR action NOT IN('CREATE','VOID','CLOSE','REOPEN') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR length(trim(input->>'reason')) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT public.encova_finance_export_access(actor) OR NOT public.encova_finance_session_ok(actor,provider,session_id) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(629815);IF NOT EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=actor) THEN RAISE EXCEPTION 'FINANCE_OWNER_REQUIRED' USING ERRCODE='P0001';END IF;
 fields:=CASE action WHEN 'CREATE' THEN ARRAY['name','startDate','endDate','retainedAccountId','evidence','reason'] WHEN 'CLOSE' THEN ARRAY['yearId','expectedVersion','basisHash','postingFailuresReviewed','pendingAdjustmentsReviewed','postingReviewEvidence','adjustmentReviewEvidence','reason'] WHEN 'REOPEN' THEN ARRAY['yearId','closeId','expectedVersion','expectedCloseVersion','reason'] ELSE ARRAY['yearId','expectedVersion','reason'] END;
 IF input-fields<>'{}'::jsonb OR EXISTS(SELECT 1 FROM unnest(fields) f WHERE NOT input?f) THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 why:=trim(input->>'reason');digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');SELECT * INTO receipt FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation='YEAR_'||action AND key=request_key;
 IF receipt.id IS NOT NULL THEN IF receipt."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN receipt.result;END IF;
 SELECT id INTO grant_id FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL;
 IF action='CREATE' THEN
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['name','startDate','endDate','retainedAccountId','evidence']) f WHERE jsonb_typeof(input->f) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinanceFiscalYear"(id,name,"startDate","endDate","retainedAccountId",evidence,"createdById") VALUES(gen_random_uuid(),trim(input->>'name'),(input->>'startDate')::date,(input->>'endDate')::date,(input->>'retainedAccountId')::uuid,trim(input->>'evidence'),actor) RETURNING * INTO y;
 ELSE
  SELECT * INTO y FROM public."FinanceFiscalYear" WHERE id=(input->>'yearId')::uuid FOR UPDATE;IF y.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR y.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF action='VOID' THEN UPDATE public."FinanceFiscalYear" SET state='VOID',version=version+1 WHERE id=y.id RETURNING * INTO y;
  ELSIF action='CLOSE' THEN
   IF y.state<>'OPEN' THEN RAISE EXCEPTION 'FINANCE_YEAR_STATE' USING ERRCODE='P0001';END IF;
   IF input->'postingFailuresReviewed' IS DISTINCT FROM 'true'::jsonb OR input->'pendingAdjustmentsReviewed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'basisHash') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'postingReviewEvidence') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'adjustmentReviewEvidence') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   pack:=public.encova_finance_year_pack(actor,y.id);
   IF pack->>'basisHash' IS DISTINCT FROM input->>'basisHash' THEN RAISE EXCEPTION 'FINANCE_CLOSE_STALE' USING ERRCODE='P0001';END IF;
   IF NOT(pack#>>'{checklist,ready}')::boolean THEN RAISE EXCEPTION 'FINANCE_CLOSE_INCOMPLETE' USING ERRCODE='P0001';END IF;
   INSERT INTO public."FinanceYearClose"(id,"fiscalYearId",sequence,"yearVersion","basisHash",checklist,lines,"netProfit","beforeReports","periodId","journalId","closedById","closedGrantId",reason,"postingReviewEvidence","adjustmentReviewEvidence") VALUES(gen_random_uuid(),y.id,coalesce((SELECT max(sequence) FROM public."FinanceYearClose" WHERE "fiscalYearId"=y.id),0)+1,y.version,pack->>'basisHash',pack->'checklist',pack->'lines',(pack->>'netProfit')::numeric,pack->'reports',(pack#>>'{checklist,finalPeriod,id}')::uuid,CASE WHEN jsonb_array_length(pack->'lines')=0 THEN NULL ELSE gen_random_uuid() END,actor,grant_id,why,trim(input->>'postingReviewEvidence'),trim(input->>'adjustmentReviewEvidence')) RETURNING * INTO c;
   PERFORM public.encova_finance_year_emit(actor,c.id,'POST');
   period_pack:=public.encova_finance_close_pack(actor,c."periodId");
   period_result:=public.encova_finance_close_period_internal(actor,provider,session_id,verified_at,'CLOSE',jsonb_build_object('periodId',c."periodId",'expectedVersion',(period_pack#>>'{period,version}')::integer,'basisHash',period_pack->>'basisHash','postingFailuresReviewed',true,'pendingAdjustmentsReviewed',true,'postingReviewEvidence',c."postingReviewEvidence",'adjustmentReviewEvidence',c."adjustmentReviewEvidence",'reason',why),'annual-close:'||c.id::text,request_id);
   after_reports:=public.encova_finance_year_reports(actor,y.id);
   UPDATE public."FinanceYearClose" SET state='CLOSED',"periodCloseId"=(period_result->>'id')::uuid,"afterReports"=after_reports,"snapshotHash"=encode(sha256(convert_to(jsonb_build_object('before',c."beforeReports",'after',after_reports)::text,'UTF8')),'hex') WHERE id=c.id RETURNING * INTO c;
   UPDATE public."FinanceFiscalYear" SET state='CLOSED',version=version+1 WHERE id=y.id RETURNING * INTO y;
  ELSE
   SELECT * INTO c FROM public."FinanceYearClose" WHERE id=(input->>'closeId')::uuid AND "fiscalYearId"=y.id FOR UPDATE;
   IF y.state<>'CLOSED' OR c.id IS NULL OR c.state<>'CLOSED' THEN RAISE EXCEPTION 'FINANCE_YEAR_STATE' USING ERRCODE='P0001';END IF;
   IF jsonb_typeof(input->'expectedCloseVersion') IS DISTINCT FROM 'number' OR c.version<>(input->>'expectedCloseVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
   SELECT * INTO p FROM public."FinancePeriod" WHERE id=c."periodId" FOR UPDATE;SELECT * INTO pc FROM public."FinancePeriodClose" WHERE id=c."periodCloseId";
   UPDATE public."FinanceYearClose" SET state='REVERSED',version=version+1,"reversalJournalId"=CASE WHEN "journalId" IS NULL THEN NULL ELSE gen_random_uuid() END,"reversedAt"=CURRENT_TIMESTAMP,"reversedById"=actor,"reverseReason"=why WHERE id=c.id RETURNING * INTO c;
   UPDATE public."FinanceFiscalYear" SET state='OPEN',version=version+1 WHERE id=y.id RETURNING * INTO y;
   period_result:=public.encova_finance_close_period_internal(actor,provider,session_id,verified_at,'REOPEN',jsonb_build_object('periodId',p.id,'closeId',pc.id,'expectedVersion',p.version,'expectedCloseVersion',pc.version,'reason',why),'annual-reopen:'||c.id::text,request_id);
   PERFORM public.encova_finance_year_emit(actor,c.id,'REVERSE');
  END IF;
 END IF;
 result:=jsonb_build_object('id',y.id,'version',y.version,'state',y.state,'closeId',c.id,'closeVersion',c.version,'sequence',c.sequence,'journalId',c."journalId",'reversalJournalId',c."reversalJournalId");
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,'YEAR_'||action,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_YEAR_'||action,'FinanceFiscalYear',y.id,why,result,request_id);RETURN result;
 EXCEPTION WHEN data_exception OR check_violation OR not_null_violation OR foreign_key_violation THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END $$;
CREATE FUNCTION encova_finance_year_read(actor UUID,action TEXT,input JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE y public."FinanceFiscalYear"%ROWTYPE;c public."FinanceYearClose"%ROWTYPE;items JSONB;result JSONB;snapshot JSONB;page INTEGER;total INTEGER;owner BOOLEAN;BEGIN
 IF NOT public.encova_finance_export_access(actor) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF action IS NULL OR action NOT IN('LIST','PREVIEW','HISTORY','DETAIL','REPORT') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['yearId','closeId','reportType','stage','page']<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 page:=coalesce((input->>'page')::integer,1);IF page NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;owner:=EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=actor);
 IF action='LIST' THEN
  SELECT count(*) INTO total FROM public."FinanceFiscalYear";
  SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b."endDate" DESC,b.id),'[]'::jsonb) INTO items FROM(SELECT * FROM public."FinanceFiscalYear" ORDER BY "endDate" DESC,id LIMIT 25 OFFSET(page-1)*25)b;
 ELSE
  SELECT * INTO y FROM public."FinanceFiscalYear" WHERE id=(input->>'yearId')::uuid;IF y.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF action='PREVIEW' THEN RETURN(public.encova_finance_year_pack(actor,y.id)-'reports')||jsonb_build_object('canManage',owner);END IF;
  IF action='HISTORY' THEN
   SELECT count(*) INTO total FROM public."FinanceYearClose" WHERE "fiscalYearId"=y.id;
   SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.sequence DESC),'[]'::jsonb) INTO items FROM(SELECT id,sequence,state,version,"netProfit"::text AS "netProfit","snapshotHash","journalId","reversalJournalId","closedAt","closedById","reversedAt","reversedById",reason,"reverseReason" FROM public."FinanceYearClose" WHERE "fiscalYearId"=y.id ORDER BY sequence DESC LIMIT 25 OFFSET(page-1)*25)b;
  ELSE
   SELECT * INTO c FROM public."FinanceYearClose" WHERE id=(input->>'closeId')::uuid AND "fiscalYearId"=y.id;IF c.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
   IF action='DETAIL' THEN RETURN(to_jsonb(c)-ARRAY['beforeReports','afterReports','closedGrantId'])||jsonb_build_object('year',to_jsonb(y),'canManage',owner,'netProfit',c."netProfit"::text);END IF;
   IF input->>'reportType' IS NULL OR input->>'reportType' NOT IN('TRIAL_BALANCE','PROFIT_LOSS','BALANCE_SHEET') OR input->>'stage' IS NULL OR input->>'stage' NOT IN('BEFORE','AFTER') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   snapshot:=(CASE WHEN input->>'stage'='BEFORE' THEN c."beforeReports" ELSE c."afterReports" END)->(input->>'reportType');total:=(snapshot->>'rowCount')::integer;
   RETURN jsonb_build_object('yearCloseId',c.id,'closeState',c.state,'snapshotHash',c."snapshotHash",'metadata',snapshot#>'{report,metadata}','summary',(snapshot->'report')-ARRAY['items','metadata','page','pages'],'items',(SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) FROM jsonb_array_elements(snapshot#>'{report,items}') WITH ORDINALITY WHERE ordinality BETWEEN(page-1)*25+1 AND page*25),'total',total,'page',page,'pages',greatest(1,ceil(total/25.0)::integer));
  END IF;
 END IF;
 RETURN jsonb_build_object('year',to_jsonb(y),'items',items,'total',total,'page',page,'pages',greatest(1,ceil(total/25.0)::integer),'canManage',owner);
 EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END $$;
DO $$ DECLARE t TEXT;f RECORD;r TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceFiscalYear','FinanceYearClose'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);FOREACH r IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);IF r='encova_app' THEN EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);END IF;END IF;END LOOP;END LOOP;
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND(p.proname LIKE 'encova_finance_year_%' OR p.proname IN('encova_finance_close_command','encova_finance_close_period_internal')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);FOREACH r IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION encova_finance_year_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID),encova_finance_year_read(UUID,TEXT,JSONB),encova_finance_close_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID) TO encova_app;END IF;
END $$;
COMMIT;
