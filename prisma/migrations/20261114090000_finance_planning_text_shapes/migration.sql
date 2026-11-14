BEGIN;
CREATE OR REPLACE FUNCTION encova_finance_planning_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public."FinanceBudget"%ROWTYPE;p public."FinanceBudget"%ROWTYPE;f public."FinanceForecast"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;reason TEXT;digest TEXT;line JSONB;total NUMERIC:=0;n INTEGER:=0;revision_number INTEGER;old_snapshot JSONB;new_snapshot JSONB;result JSONB;allowed TEXT[];
BEGIN
 IF action IS NULL OR action NOT IN('BUDGET_CREATE','BUDGET_UPDATE','BUDGET_APPROVE','BUDGET_VOID','FORECAST_CREATE','FORECAST_UPDATE','FORECAST_CANCEL','FORECAST_REOPEN') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 allowed:=CASE WHEN action='BUDGET_CREATE' THEN ARRAY['month','projectId','previousId','previousVersion','description','evidence','lines','reason'] WHEN action='BUDGET_UPDATE' THEN ARRAY['id','expectedVersion','description','evidence','lines','reason'] WHEN action='BUDGET_APPROVE' THEN ARRAY['id','expectedVersion','approvalEvidence','reason'] WHEN action IN('FORECAST_CREATE','FORECAST_UPDATE') THEN ARRAY['kind','expectedDate','amount','projectId','partyId','likelihood','likelihoodNote','description','evidence','reason']||(CASE WHEN action='FORECAST_UPDATE' THEN ARRAY['id','expectedVersion'] ELSE ARRAY[]::TEXT[] END) ELSE ARRAY['id','expectedVersion','reason'] END;
 reason:=trim(input->>'reason');IF jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR length(reason) NOT BETWEEN 3 AND 500 OR input-allowed<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 digest:=encode(sha256(convert_to(jsonb_strip_nulls(input)::text,'UTF8')),'hex');SELECT * INTO r FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation='PLAN_'||action AND key=request_key;
 IF FOUND THEN IF r."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN r.result;END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action LIKE 'BUDGET_%' AND action<>'BUDGET_CREATE' THEN
  SELECT * INTO b FROM public."FinanceBudget" WHERE id=(input->>'id')::uuid FOR UPDATE;IF b.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR b.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  old_snapshot:=public.encova_finance_budget_snapshot(b.id)||jsonb_build_object('state',b.state,'version',b.version,'approvalEvidence',b."approvalEvidence");
  IF b.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_PLAN_IMMUTABLE' USING ERRCODE='P0001';END IF;
 ELSIF action LIKE 'FORECAST_%' AND action<>'FORECAST_CREATE' THEN
  SELECT * INTO f FROM public."FinanceForecast" WHERE id=(input->>'id')::uuid FOR UPDATE;IF f.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR f.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  old_snapshot:=to_jsonb(f)||jsonb_build_object('amount',f.amount::text);
 END IF;
 IF action IN('BUDGET_CREATE','BUDGET_UPDATE') THEN
  IF jsonb_typeof(input->'description') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'evidence') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'lines') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(input->'lines') LOOP
   IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR line-ARRAY['accountId','amount']<>'{}'::jsonb OR jsonb_typeof(line->'amount') IS DISTINCT FROM 'string' OR line->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   total:=total+(line->>'amount')::numeric;
  END LOOP;
  IF total>999999999999999999.99 THEN RAISE EXCEPTION 'FINANCE_BUDGET_TOTAL' USING ERRCODE='P0001';END IF;
  IF action='BUDGET_CREATE' THEN
   IF jsonb_typeof(input->'month') IS DISTINCT FROM 'string' OR input->>'month' !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR NOT(input?'projectId') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   SELECT * INTO p FROM public."FinanceBudget" WHERE month=(input->>'month'||'-01')::date AND "projectId" IS NOT DISTINCT FROM(input->>'projectId')::uuid AND state='APPROVED' FOR UPDATE;
   IF p.id IS NOT NULL THEN
    IF p.id IS DISTINCT FROM(input->>'previousId')::uuid OR jsonb_typeof(input->'previousVersion') IS DISTINCT FROM 'number' OR p.version<>(input->>'previousVersion')::integer THEN RAISE EXCEPTION 'FINANCE_BUDGET_REVISION' USING ERRCODE='P0001';END IF;
   ELSIF input->>'previousId' IS NOT NULL OR input->>'previousVersion' IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_BUDGET_REVISION' USING ERRCODE='P0001';END IF;
   SELECT coalesce(max(revision),0)+1 INTO revision_number FROM public."FinanceBudget" WHERE month=(input->>'month'||'-01')::date AND "projectId" IS NOT DISTINCT FROM(input->>'projectId')::uuid;
   INSERT INTO public."FinanceBudget"(id,number,month,"projectId",revision,"previousId",description,evidence,"createdById") VALUES(gen_random_uuid(),'BGT-'||lpad(nextval('public.finance_budget_number')::text,10,'0'),(input->>'month'||'-01')::date,(input->>'projectId')::uuid,revision_number,p.id,input->>'description',input->>'evidence',actor) RETURNING * INTO b;
  ELSE
   UPDATE public."FinanceBudget" SET description=input->>'description',evidence=input->>'evidence',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=b.id RETURNING * INTO b;
   DELETE FROM public."FinanceBudgetLine" WHERE "budgetId"=b.id;
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(input->'lines') LOOP n:=n+1;INSERT INTO public."FinanceBudgetLine"(id,"budgetId",sequence,"accountId",amount) VALUES(gen_random_uuid(),b.id,n,(line->>'accountId')::uuid,(line->>'amount')::numeric);END LOOP;
 ELSIF action='BUDGET_APPROVE' THEN
  IF jsonb_typeof(input->'approvalEvidence') IS DISTINCT FROM 'string' OR length(trim(input->>'approvalEvidence')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF EXISTS(SELECT 1 FROM public."FinanceBudgetLine" l JOIN public."FinanceAccount" a ON a.id=l."accountId" WHERE l."budgetId"=b.id AND(NOT a.active OR NOT a."isPosting" OR a."isContra" OR a."controlType"<>'NONE' OR a.currency<>'PKR' OR a.type NOT IN('DIRECT_COST','OPERATING_EXPENSE','OTHER_EXPENSE'))) THEN RAISE EXCEPTION 'FINANCE_BUDGET_MAPPING' USING ERRCODE='P0001';END IF;
  IF b."previousId" IS NOT NULL THEN
   SELECT * INTO p FROM public."FinanceBudget" WHERE id=b."previousId" FOR UPDATE;
   IF p.state<>'APPROVED' THEN RAISE EXCEPTION 'FINANCE_BUDGET_REVISION' USING ERRCODE='P0001';END IF;
   UPDATE public."FinanceBudget" SET state='SUPERSEDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=p.id;
   INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_BUDGET_SUPERSEDED','FinanceBudget',p.id,reason,jsonb_build_object('replacementId',b.id,'retainedApprovedSnapshot',p.snapshot),request_id);
  ELSIF EXISTS(SELECT 1 FROM public."FinanceBudget" WHERE month=b.month AND "projectId" IS NOT DISTINCT FROM b."projectId" AND state='APPROVED') THEN RAISE EXCEPTION 'FINANCE_BUDGET_REVISION' USING ERRCODE='P0001';END IF;
  UPDATE public."FinanceBudget" SET state='APPROVED',"approvalEvidence"=input->>'approvalEvidence',"approvedById"=actor,"approvedAt"=CURRENT_TIMESTAMP,snapshot=public.encova_finance_budget_snapshot(b.id),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=b.id RETURNING * INTO b;
 ELSIF action='BUDGET_VOID' THEN UPDATE public."FinanceBudget" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=b.id RETURNING * INTO b;
 ELSIF action IN('FORECAST_CREATE','FORECAST_UPDATE') THEN
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['kind','expectedDate','amount','likelihood','likelihoodNote','description','evidence'])k WHERE jsonb_typeof(input->k) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF action='FORECAST_UPDATE' AND f.state<>'ACTIVE' THEN RAISE EXCEPTION 'FINANCE_PLAN_IMMUTABLE' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'amount') IS DISTINCT FROM 'string' OR input->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR NOT(input?'projectId') OR NOT(input?'partyId') OR jsonb_typeof(input->'expectedDate') IS DISTINCT FROM 'string' OR input->>'expectedDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF input->>'partyId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=(input->>'partyId')::uuid AND active) THEN RAISE EXCEPTION 'FINANCE_PARTY_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  IF action='FORECAST_CREATE' THEN
   INSERT INTO public."FinanceForecast"(id,number,kind,"expectedDate",amount,"projectId","partyId",likelihood,"likelihoodNote",description,evidence,"createdById") VALUES(gen_random_uuid(),'FCT-'||lpad(nextval('public.finance_forecast_number')::text,10,'0'),input->>'kind',(input->>'expectedDate')::date,(input->>'amount')::numeric,(input->>'projectId')::uuid,(input->>'partyId')::uuid,input->>'likelihood',input->>'likelihoodNote',input->>'description',input->>'evidence',actor) RETURNING * INTO f;
  ELSE
   UPDATE public."FinanceForecast" SET kind=input->>'kind',"expectedDate"=(input->>'expectedDate')::date,amount=(input->>'amount')::numeric,"projectId"=(input->>'projectId')::uuid,"partyId"=(input->>'partyId')::uuid,likelihood=input->>'likelihood',"likelihoodNote"=input->>'likelihoodNote',description=input->>'description',evidence=input->>'evidence',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=f.id RETURNING * INTO f;
  END IF;
 ELSE
  IF(action='FORECAST_CANCEL' AND f.state<>'ACTIVE') OR(action='FORECAST_REOPEN' AND f.state<>'CANCELLED') THEN RAISE EXCEPTION 'FINANCE_PLAN_IMMUTABLE' USING ERRCODE='P0001';END IF;
  UPDATE public."FinanceForecast" SET state=CASE WHEN action='FORECAST_CANCEL' THEN 'CANCELLED' ELSE 'ACTIVE' END,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=f.id RETURNING * INTO f;
 END IF;
 IF b.id IS NOT NULL THEN new_snapshot:=public.encova_finance_budget_snapshot(b.id)||jsonb_build_object('state',b.state,'version',b.version,'approvalEvidence',b."approvalEvidence");result:=jsonb_build_object('id',b.id,'number',b.number,'version',b.version);ELSE new_snapshot:=to_jsonb(f)||jsonb_build_object('amount',f.amount::text);result:=jsonb_build_object('id',f.id,'number',f.number,'version',f.version);END IF;
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,'PLAN_'||action,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_'||action,CASE WHEN b.id IS NULL THEN 'FinanceForecast' ELSE 'FinanceBudget' END,coalesce(b.id,f.id),reason,jsonb_build_object('before',old_snapshot,'after',new_snapshot),request_id);RETURN result;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;
COMMIT;
