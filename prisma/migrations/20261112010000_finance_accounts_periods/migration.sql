-- Configuration only: no chart, fiscal year, opening balance or financial example is seeded.
CREATE TABLE "FinanceAccount" (
 id UUID PRIMARY KEY, code TEXT NOT NULL UNIQUE CHECK(code ~ '^[A-Z0-9][A-Z0-9._-]{1,19}$'),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 type TEXT NOT NULL CHECK(type IN ('ASSET','LIABILITY','EQUITY','INCOME','DIRECT_COST','OPERATING_EXPENSE','OTHER_INCOME','OTHER_EXPENSE')),
 "normalSide" TEXT NOT NULL CHECK("normalSide" IN ('DEBIT','CREDIT')),
 "reportGroup" TEXT NOT NULL,
 "controlType" TEXT NOT NULL DEFAULT 'NONE' CHECK("controlType" IN ('NONE','CASH','RECEIVABLES','PAYABLES','CLIENT_ADVANCE','SUPPLIER_ADVANCE','FIXED_ASSET','ACCUMULATED_DEPRECIATION','INVESTMENT','LOAN_RECEIVABLE','LOAN_PAYABLE')),
 currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),
 "parentId" UUID REFERENCES "FinanceAccount"(id) ON DELETE RESTRICT CHECK("parentId" IS NULL OR "parentId"<>id),
 "isPosting" BOOLEAN NOT NULL DEFAULT true, "isContra" BOOLEAN NOT NULL DEFAULT false,
 "isCashEquivalent" BOOLEAN NOT NULL DEFAULT false, active BOOLEAN NOT NULL DEFAULT true,
 "usedAt" TIMESTAMPTZ, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FinanceAccount_report_type" CHECK(
  (type='ASSET' AND "reportGroup" IN ('CURRENT_ASSETS','NONCURRENT_ASSETS')) OR
  (type='LIABILITY' AND "reportGroup" IN ('CURRENT_LIABILITIES','NONCURRENT_LIABILITIES')) OR
  (type='EQUITY' AND "reportGroup"='EQUITY') OR (type='INCOME' AND "reportGroup"='REVENUE') OR
  (type='DIRECT_COST' AND "reportGroup"='DIRECT_COSTS') OR (type='OPERATING_EXPENSE' AND "reportGroup"='OPERATING_EXPENSES') OR
  (type='OTHER_INCOME' AND "reportGroup"='OTHER_INCOME') OR (type='OTHER_EXPENSE' AND "reportGroup"='OTHER_EXPENSES')),
 CONSTRAINT "FinanceAccount_normal_side" CHECK(("normalSide"='DEBIT') = ((type IN ('ASSET','DIRECT_COST','OPERATING_EXPENSE','OTHER_EXPENSE')) <> "isContra")),
 CONSTRAINT "FinanceAccount_group_flags" CHECK("isPosting" OR ("controlType"='NONE' AND NOT "isContra" AND NOT "isCashEquivalent")),
 CONSTRAINT "FinanceAccount_control_type" CHECK("controlType"='NONE' OR
  (type='ASSET' AND "controlType" IN ('CASH','RECEIVABLES','SUPPLIER_ADVANCE','FIXED_ASSET','ACCUMULATED_DEPRECIATION','INVESTMENT','LOAN_RECEIVABLE')) OR
  (type='LIABILITY' AND "controlType" IN ('PAYABLES','CLIENT_ADVANCE','LOAN_PAYABLE'))),
 CONSTRAINT "FinanceAccount_control_contra" CHECK("controlType"='NONE' OR "isContra"=("controlType"='ACCUMULATED_DEPRECIATION')),
 CONSTRAINT "FinanceAccount_cash_equivalent" CHECK(NOT "isCashEquivalent" OR ("isPosting" AND "controlType"='CASH' AND NOT "isContra"))
);
CREATE INDEX "FinanceAccount_active_type_code_idx" ON "FinanceAccount"(active,type,code);
CREATE INDEX "FinanceAccount_parentId_idx" ON "FinanceAccount"("parentId");
CREATE TABLE "FinancePeriod" (
 id UUID PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 "startDate" DATE NOT NULL CHECK("startDate">=DATE '0001-01-01'),
 "endDate" DATE NOT NULL CHECK("endDate"<=DATE '9999-12-31' AND "endDate">="startDate"),
 state TEXT NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','CLOSED','VOID')),
 "usedAt" TIMESTAMPTZ, "closedAt" TIMESTAMPTZ,
 "closedById" UUID REFERENCES "Person"(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((state='CLOSED')=("closedAt" IS NOT NULL AND "closedById" IS NOT NULL)),
 CHECK(("closedAt" IS NULL)=("closedById" IS NULL)),
 CHECK(state<>'VOID' OR "usedAt" IS NULL),
 CONSTRAINT "FinancePeriod_no_overlap" EXCLUDE USING gist (daterange("startDate","endDate",'[]') WITH &&) WHERE (state<>'VOID')
);
CREATE INDEX "FinancePeriod_state_startDate_id_idx" ON "FinancePeriod"(state,"startDate",id);
CREATE TABLE "FinanceSetupReceipt" (
 id UUID PRIMARY KEY,"actorId" UUID NOT NULL REFERENCES "Person"(id) ON DELETE RESTRICT,
 operation TEXT NOT NULL,key TEXT NOT NULL CHECK(length(key) BETWEEN 8 AND 128),
 "requestHash" TEXT NOT NULL,result JSONB NOT NULL,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FinanceSetupReceipt_actorId_operation_key_key" UNIQUE("actorId",operation,key)
);
CREATE TRIGGER "FinanceSetupReceipt_immutable" BEFORE UPDATE OR DELETE ON "FinanceSetupReceipt" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();

-- Serialize structural configuration BEFORE row locks, including direct SQL.
-- Future posting marks only usedAt and must not acquire this configuration lock.
CREATE FUNCTION encova_finance_config_lock() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN PERFORM pg_advisory_xact_lock(629815); RETURN NULL; END $$;
CREATE TRIGGER "FinanceAccount_config_lock" BEFORE INSERT OR UPDATE OF code,name,type,"normalSide","reportGroup","controlType",currency,"parentId","isPosting","isContra","isCashEquivalent",active OR DELETE ON "FinanceAccount" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinancePeriod_config_lock" BEFORE INSERT OR UPDATE OF name,"startDate","endDate",state,"closedAt","closedById" OR DELETE ON "FinancePeriod" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();

CREATE FUNCTION encova_finance_account_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE parent public."FinanceAccount"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_RETAINED' USING ERRCODE='P0001'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD."usedAt" IS NOT NULL AND (NEW."usedAt" IS DISTINCT FROM OLD."usedAt" OR
   ROW(NEW.code,NEW.type,NEW."normalSide",NEW."reportGroup",NEW."controlType",NEW.currency,NEW."parentId",NEW."isPosting",NEW."isContra",NEW."isCashEquivalent") IS DISTINCT FROM
   ROW(OLD.code,OLD.type,OLD."normalSide",OLD."reportGroup",OLD."controlType",OLD.currency,OLD."parentId",OLD."isPosting",OLD."isContra",OLD."isCashEquivalent")) THEN
   RAISE EXCEPTION 'FINANCE_ACCOUNT_USED' USING ERRCODE='P0001'; END IF;
 END IF;
 IF NEW."parentId" IS NOT NULL THEN
  SELECT * INTO parent FROM public."FinanceAccount" WHERE id=NEW."parentId";
  IF parent.id IS NULL OR parent."isPosting" OR parent.type<>NEW.type OR parent."reportGroup"<>NEW."reportGroup" OR (NEW.active AND NOT parent.active) THEN
   RAISE EXCEPTION 'FINANCE_ACCOUNT_PARENT' USING ERRCODE='P0001'; END IF;
  IF EXISTS(WITH RECURSIVE ancestors AS (
   SELECT id,"parentId" FROM public."FinanceAccount" WHERE id=NEW."parentId"
   UNION SELECT a.id,a."parentId" FROM public."FinanceAccount" a JOIN ancestors x ON a.id=x."parentId"
  ) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_CYCLE' USING ERRCODE='P0001'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE "parentId"=NEW.id AND
  (NEW."isPosting" OR type<>NEW.type OR "reportGroup"<>NEW."reportGroup" OR (active AND NOT NEW.active))) THEN
  RAISE EXCEPTION 'FINANCE_ACCOUNT_CHILDREN' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FinanceAccount_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceAccount" FOR EACH ROW EXECUTE FUNCTION encova_finance_account_guard();
CREATE FUNCTION encova_finance_period_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_PERIOD_RETAINED' USING ERRCODE='P0001'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD."usedAt" IS NOT NULL AND (NEW."usedAt" IS DISTINCT FROM OLD."usedAt" OR NEW."startDate"<>OLD."startDate" OR NEW."endDate"<>OLD."endDate" OR NEW.state='VOID') THEN
   RAISE EXCEPTION 'FINANCE_PERIOD_USED' USING ERRCODE='P0001'; END IF;
  IF OLD.state<>'OPEN' OR (NEW.state<>OLD.state AND NOT(NEW.state='VOID' AND OLD."usedAt" IS NULL))
   OR NEW."closedAt" IS DISTINCT FROM OLD."closedAt" OR NEW."closedById" IS DISTINCT FROM OLD."closedById" THEN
   RAISE EXCEPTION 'FINANCE_PERIOD_STATE' USING ERRCODE='P0001'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FinancePeriod_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinancePeriod" FOR EACH ROW EXECUTE FUNCTION encova_finance_period_guard();

CREATE FUNCTION encova_finance_setup_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,
 action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE settings public."FinanceSettings"%ROWTYPE; receipt public."FinanceSetupReceipt"%ROWTYPE;
 account public."FinanceAccount"%ROWTYPE; period public."FinancePeriod"%ROWTYPE;
 before_value JSONB; after_value JSONB; result JSONB; target UUID; reason TEXT; digest TEXT; start_date DATE; end_date DATE;
BEGIN
 IF action NOT IN ('ACCOUNT_CREATE','ACCOUNT_UPDATE','ACCOUNT_ARCHIVE','ACCOUNT_REACTIVATE','PERIOD_CREATE','PERIOD_UPDATE','PERIOD_VOID') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001'; END IF;
 IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 reason:=trim(input->>'reason');
 IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 IF action NOT IN ('ACCOUNT_CREATE','PERIOD_CREATE') AND (jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR (input->>'expectedVersion')::integer<1) THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 IF (input - (CASE
  WHEN action='ACCOUNT_CREATE' THEN ARRAY['code','name','type','normalSide','reportGroup','controlType','currency','parentId','isPosting','isContra','isCashEquivalent','reason']
  WHEN action='ACCOUNT_UPDATE' THEN ARRAY['id','expectedVersion','code','name','type','normalSide','reportGroup','controlType','currency','parentId','isPosting','isContra','isCashEquivalent','reason']
  WHEN action='PERIOD_CREATE' THEN ARRAY['name','startDate','endDate','reason']
  WHEN action='PERIOD_UPDATE' THEN ARRAY['id','expectedVersion','name','startDate','endDate','reason']
  ELSE ARRAY['id','expectedVersion','reason'] END)) <> '{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(987661);
 PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE')
  OR NOT public.encova_finance_session_ok(actor,provider,session_id)
  OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001'; END IF;
 SELECT * INTO settings FROM public."FinanceSettings" FOR UPDATE;
 IF settings.id IS NULL THEN RAISE EXCEPTION 'FINANCE_SETUP_REQUIRED' USING ERRCODE='P0001'; END IF;
 IF settings."ownerId"<>actor THEN RAISE EXCEPTION 'FINANCE_OWNER_REQUIRED' USING ERRCODE='P0001'; END IF;
 digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM public."FinanceSetupReceipt" WHERE "actorId"=actor AND operation=action AND key=request_key;
 IF FOUND THEN
  IF receipt."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  RETURN receipt.result;
 END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action LIKE 'ACCOUNT_%' THEN
  IF action<>'ACCOUNT_CREATE' THEN
   SELECT * INTO account FROM public."FinanceAccount" WHERE id=(input->>'id')::uuid FOR UPDATE;
   IF account.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001'; END IF;
   IF account.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001'; END IF;
   before_value:=to_jsonb(account);
  END IF;
  IF action IN ('ACCOUNT_CREATE','ACCOUNT_UPDATE') THEN
   IF input->>'currency' IS DISTINCT FROM 'PKR' OR jsonb_typeof(input->'isPosting') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(input->'isContra') IS DISTINCT FROM 'boolean' OR jsonb_typeof(input->'isCashEquivalent') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
   IF action='ACCOUNT_CREATE' THEN
    INSERT INTO public."FinanceAccount"(id,code,name,type,"normalSide","reportGroup","controlType",currency,"parentId","isPosting","isContra","isCashEquivalent")
    VALUES(gen_random_uuid(),input->>'code',input->>'name',input->>'type',input->>'normalSide',input->>'reportGroup',input->>'controlType','PKR',nullif(input->>'parentId','')::uuid,(input->>'isPosting')::boolean,(input->>'isContra')::boolean,(input->>'isCashEquivalent')::boolean) RETURNING * INTO account;
   ELSE
    UPDATE public."FinanceAccount" SET code=input->>'code',name=input->>'name',type=input->>'type',"normalSide"=input->>'normalSide',"reportGroup"=input->>'reportGroup',"controlType"=input->>'controlType',currency='PKR',"parentId"=nullif(input->>'parentId','')::uuid,
    "isPosting"=(input->>'isPosting')::boolean,"isContra"=(input->>'isContra')::boolean,"isCashEquivalent"=(input->>'isCashEquivalent')::boolean,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=account.id RETURNING * INTO account;
   END IF;
  ELSE
   IF (action='ACCOUNT_ARCHIVE' AND NOT account.active) OR (action='ACCOUNT_REACTIVATE' AND account.active) THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_STATE' USING ERRCODE='P0001'; END IF;
   UPDATE public."FinanceAccount" SET active=(action='ACCOUNT_REACTIVATE'),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=account.id RETURNING * INTO account;
  END IF;
  after_value:=to_jsonb(account);target:=account.id;result:=jsonb_build_object('id',target,'version',account.version);
 ELSE
  IF action<>'PERIOD_CREATE' THEN
   SELECT * INTO period FROM public."FinancePeriod" WHERE id=(input->>'id')::uuid FOR UPDATE;
   IF period.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001'; END IF;
   IF period.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001'; END IF;
   IF period.state<>'OPEN' THEN RAISE EXCEPTION 'FINANCE_PERIOD_STATE' USING ERRCODE='P0001'; END IF;
   before_value:=to_jsonb(period);
  END IF;
  IF action IN ('PERIOD_CREATE','PERIOD_UPDATE') THEN
   IF input->>'startDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR input->>'endDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR input->>'startDate' IS NULL OR input->>'endDate' IS NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
   start_date:=(input->>'startDate')::date;end_date:=(input->>'endDate')::date;
   IF end_date<start_date THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
   IF action='PERIOD_CREATE' THEN INSERT INTO public."FinancePeriod"(id,name,"startDate","endDate") VALUES(gen_random_uuid(),input->>'name',start_date,end_date) RETURNING * INTO period;
   ELSE UPDATE public."FinancePeriod" SET name=input->>'name',"startDate"=start_date,"endDate"=end_date,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=period.id RETURNING * INTO period; END IF;
  ELSE
   UPDATE public."FinancePeriod" SET state='VOID',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=period.id RETURNING * INTO period;
  END IF;
  after_value:=to_jsonb(period);target:=period.id;result:=jsonb_build_object('id',target,'version',period.version);
 END IF;
 INSERT INTO public."FinanceSetupReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,action,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_'||action,CASE WHEN action LIKE 'ACCOUNT_%' THEN 'FinanceAccount' ELSE 'FinancePeriod' END,target,reason,jsonb_build_object('before',before_value,'after',after_value),request_id);
 RETURN result;
EXCEPTION
 WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_CODE_EXISTS' USING ERRCODE='P0001';
 WHEN exclusion_violation THEN RAISE EXCEPTION 'FINANCE_PERIOD_OVERLAP' USING ERRCODE='P0001';
 WHEN check_violation OR not_null_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;

DO $$ DECLARE t TEXT; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceAccount','FinancePeriod','FinanceSetupReceipt'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN
   EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);
   EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);
  END IF;
 END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('encova_finance_config_lock','encova_finance_account_guard','encova_finance_period_guard','encova_finance_setup_command') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon',f.signature); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated',f.signature); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM encova_app',f.signature); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION encova_finance_setup_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID) TO encova_app; END IF;
END $$;
