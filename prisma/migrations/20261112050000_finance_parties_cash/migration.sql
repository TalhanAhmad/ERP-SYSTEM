BEGIN;
CREATE TABLE "FinanceParty" (
 id UUID PRIMARY KEY,name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),"legalName" TEXT NOT NULL CHECK(length(trim("legalName")) BETWEEN 1 AND 160),
 kind TEXT NOT NULL CHECK(kind IN ('CLIENT','SUPPLIER','BOTH','EMPLOYEE','OTHER')),
 "contactEmail" TEXT CHECK("contactEmail" IS NULL OR length("contactEmail") BETWEEN 3 AND 254),phone TEXT CHECK(phone IS NULL OR length(phone) BETWEEN 1 AND 40),
 address TEXT CHECK(address IS NULL OR length(address) BETWEEN 1 AND 1000),"userId" UUID REFERENCES "Person" ON DELETE RESTRICT,
 active BOOLEAN NOT NULL DEFAULT true,"usedAt" TIMESTAMPTZ,version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FinanceParty_active_kind_name_id_idx" ON "FinanceParty"(active,kind,name,id);
CREATE TABLE "FinanceCashAccount" (
 id UUID PRIMARY KEY,name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),kind TEXT NOT NULL CHECK(kind IN ('BANK','CASH')),
 "glAccountId" UUID NOT NULL UNIQUE REFERENCES "FinanceAccount" ON DELETE RESTRICT,currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),
 "maskedReference" TEXT CHECK("maskedReference" IS NULL OR "maskedReference" ~ '^[0-9]{4}$'),active BOOLEAN NOT NULL DEFAULT true,version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FinanceCashAccount_active_name_id_idx" ON "FinanceCashAccount"(active,name,id);
CREATE TRIGGER "FinanceParty_config_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceParty" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE TRIGGER "FinanceCashAccount_config_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceCashAccount" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE FUNCTION encova_finance_party_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_MASTER_RETAINED' USING ERRCODE='P0001';END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id OR NEW."createdAt"<>OLD."createdAt" OR (OLD."usedAt" IS NOT NULL AND (NEW."usedAt" IS DISTINCT FROM OLD."usedAt" OR NEW.kind<>OLD.kind OR NEW."userId" IS DISTINCT FROM OLD."userId")) THEN RAISE EXCEPTION 'FINANCE_MASTER_USED' USING ERRCODE='P0001';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceParty_guard" BEFORE UPDATE OR DELETE ON "FinanceParty" FOR EACH ROW EXECUTE FUNCTION encova_finance_party_guard();
CREATE FUNCTION encova_finance_cash_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE account public."FinanceAccount"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_MASTER_RETAINED' USING ERRCODE='P0001';END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW."createdAt"<>OLD."createdAt" OR (EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=OLD."glAccountId" AND "usedAt" IS NOT NULL) AND ROW(NEW."glAccountId",NEW.kind,NEW."maskedReference") IS DISTINCT FROM ROW(OLD."glAccountId",OLD.kind,OLD."maskedReference"))) THEN RAISE EXCEPTION 'FINANCE_MASTER_USED' USING ERRCODE='P0001';END IF;
 SELECT * INTO account FROM public."FinanceAccount" WHERE id=NEW."glAccountId";
 IF account.id IS NULL OR NOT account."isPosting" OR account."isContra" OR account."controlType"<>'CASH' OR account.currency<>'PKR' OR (NEW.active AND NOT account.active) THEN RAISE EXCEPTION 'FINANCE_CASH_MAPPING' USING ERRCODE='P0001';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FinanceCashAccount_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceCashAccount" FOR EACH ROW EXECUTE FUNCTION encova_finance_cash_guard();
CREATE FUNCTION encova_finance_cash_mapping_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public."FinanceCashAccount" WHERE "glAccountId"=OLD.id AND
  (NOT NEW."isPosting" OR NEW."isContra" OR NEW."controlType"<>'CASH' OR NEW.currency<>'PKR' OR (active AND NOT NEW.active))) THEN RAISE EXCEPTION 'FINANCE_CASH_MAPPING' USING ERRCODE='P0001';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FinanceAccount_cash_mapping_guard" BEFORE UPDATE ON "FinanceAccount" FOR EACH ROW EXECUTE FUNCTION encova_finance_cash_mapping_guard();
CREATE FUNCTION encova_finance_master_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE settings public."FinanceSettings"%ROWTYPE; receipt public."FinanceSetupReceipt"%ROWTYPE;
 party public."FinanceParty"%ROWTYPE; cash public."FinanceCashAccount"%ROWTYPE; before_value JSONB;after_value JSONB;result JSONB;target UUID;reason TEXT;digest TEXT;entity TEXT;
BEGIN
 IF action IS NULL OR action NOT IN ('PARTY_CREATE','PARTY_UPDATE','PARTY_ARCHIVE','PARTY_REACTIVATE','CASH_CREATE','CASH_UPDATE','CASH_ARCHIVE','CASH_REACTIVATE') OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 reason:=trim(input->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF input-(CASE WHEN action='PARTY_CREATE' THEN ARRAY['name','legalName','kind','contactEmail','phone','address','userId','reason'] WHEN action='PARTY_UPDATE' THEN ARRAY['id','expectedVersion','name','legalName','kind','contactEmail','phone','address','userId','reason'] WHEN action='CASH_CREATE' THEN ARRAY['name','kind','glAccountId','currency','maskedReference','reason'] WHEN action='CASH_UPDATE' THEN ARRAY['id','expectedVersion','name','kind','glAccountId','currency','maskedReference','reason'] ELSE ARRAY['id','expectedVersion','reason'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF action NOT LIKE '%_CREATE' AND (jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR (input->>'expectedVersion')::integer<1) THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 SELECT * INTO settings FROM public."FinanceSettings" FOR UPDATE;
 IF settings.id IS NULL OR settings."ownerId"<>actor THEN RAISE EXCEPTION 'FINANCE_OWNER_REQUIRED' USING ERRCODE='P0001';END IF;
 digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');SELECT * INTO receipt FROM public."FinanceSetupReceipt" WHERE "actorId"=actor AND operation=action AND key=request_key;
 IF FOUND THEN IF receipt."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN receipt.result;END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action LIKE 'PARTY_%' THEN
  entity:='FinanceParty';
  IF action<>'PARTY_CREATE' THEN SELECT * INTO party FROM public."FinanceParty" WHERE id=(input->>'id')::uuid FOR UPDATE;IF party.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;IF party.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;before_value:=to_jsonb(party);END IF;
  IF action IN ('PARTY_CREATE','PARTY_UPDATE') THEN
   IF action='PARTY_CREATE' THEN INSERT INTO public."FinanceParty"(id,name,"legalName",kind,"contactEmail",phone,address,"userId") VALUES(gen_random_uuid(),input->>'name',input->>'legalName',input->>'kind',input->>'contactEmail',input->>'phone',input->>'address',nullif(input->>'userId','')::uuid) RETURNING * INTO party;
   ELSE UPDATE public."FinanceParty" SET name=input->>'name',"legalName"=input->>'legalName',kind=input->>'kind',"contactEmail"=input->>'contactEmail',phone=input->>'phone',address=input->>'address',"userId"=nullif(input->>'userId','')::uuid,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=party.id RETURNING * INTO party;END IF;
  ELSE
   IF party.active=(action='PARTY_REACTIVATE') THEN RAISE EXCEPTION 'FINANCE_MASTER_STATE' USING ERRCODE='P0001';END IF;
   UPDATE public."FinanceParty" SET active=(action='PARTY_REACTIVATE'),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=party.id RETURNING * INTO party;
  END IF;
  target:=party.id;after_value:=to_jsonb(party);result:=jsonb_build_object('id',target,'version',party.version);
 ELSE
  entity:='FinanceCashAccount';
  IF action<>'CASH_CREATE' THEN SELECT * INTO cash FROM public."FinanceCashAccount" WHERE id=(input->>'id')::uuid FOR UPDATE;IF cash.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;IF cash.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;before_value:=to_jsonb(cash);END IF;
  IF action IN ('CASH_CREATE','CASH_UPDATE') THEN
   IF input->>'currency' IS DISTINCT FROM 'PKR' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   IF action='CASH_CREATE' THEN INSERT INTO public."FinanceCashAccount"(id,name,kind,"glAccountId",currency,"maskedReference") VALUES(gen_random_uuid(),input->>'name',input->>'kind',(input->>'glAccountId')::uuid,'PKR',input->>'maskedReference') RETURNING * INTO cash;
   ELSE UPDATE public."FinanceCashAccount" SET name=input->>'name',kind=input->>'kind',"glAccountId"=(input->>'glAccountId')::uuid,currency='PKR',"maskedReference"=input->>'maskedReference',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=cash.id RETURNING * INTO cash;END IF;
  ELSE
   IF cash.active=(action='CASH_REACTIVATE') THEN RAISE EXCEPTION 'FINANCE_MASTER_STATE' USING ERRCODE='P0001';END IF;
   UPDATE public."FinanceCashAccount" SET active=(action='CASH_REACTIVATE'),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=cash.id RETURNING * INTO cash;
  END IF;
  target:=cash.id;after_value:=to_jsonb(cash);result:=jsonb_build_object('id',target,'version',cash.version);
 END IF;
 INSERT INTO public."FinanceSetupReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,action,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_'||action,entity,target,reason,jsonb_build_object('before',before_value,'after',after_value),request_id);
 RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_CASH_DUPLICATE' USING ERRCODE='P0001';
 WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;
DO $$ DECLARE t TEXT;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceParty','FinanceCashAccount'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon',t);END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated',t);END IF;
 END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('encova_finance_party_guard','encova_finance_cash_guard','encova_finance_cash_mapping_guard','encova_finance_master_command') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon',f.signature);END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated',f.signature);END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION encova_finance_master_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID) TO encova_app;END IF;
END $$;
COMMIT;
