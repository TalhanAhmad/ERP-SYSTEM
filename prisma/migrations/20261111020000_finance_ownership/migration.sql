-- No owner or real grant is seeded. Only the controlled operator command can bootstrap.
ALTER TABLE "FinanceGrant" ADD CONSTRAINT "FinanceGrant_id_userId_key" UNIQUE (id,"userId");
CREATE TABLE "FinanceSettings" (
 id UUID PRIMARY KEY CHECK(id='00000000-0000-0000-0000-000000000001'::uuid),
 "ownerId" UUID NOT NULL UNIQUE REFERENCES "Person"(id) ON DELETE RESTRICT,
 "ownerGrantId" UUID NOT NULL UNIQUE REFERENCES "FinanceGrant"(id) ON DELETE RESTRICT,
 currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("ownerGrantId","ownerId") REFERENCES "FinanceGrant"(id,"userId") ON DELETE RESTRICT
);
CREATE TABLE "FinanceOwnershipTransfer" (
 id UUID PRIMARY KEY,
 "currentOwnerId" UUID NOT NULL REFERENCES "Person"(id) ON DELETE RESTRICT,
 "targetOwnerId" UUID NOT NULL REFERENCES "Person"(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','CANCELED','EXPIRED')),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "expiresAt" TIMESTAMPTZ NOT NULL,
 "acceptedAt" TIMESTAMPTZ,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("targetOwnerId"<>"currentOwnerId"),
 CHECK((status='ACCEPTED')=("acceptedAt" IS NOT NULL)),
 CHECK("expiresAt">"createdAt")
);
CREATE UNIQUE INDEX "FinanceOwnershipTransfer_one_pending" ON "FinanceOwnershipTransfer"((status)) WHERE status='PENDING';
CREATE INDEX "FinanceOwnershipTransfer_targetOwnerId_status_idx" ON "FinanceOwnershipTransfer"("targetOwnerId",status);
CREATE TABLE "FinanceAccessReceipt" (
 id UUID PRIMARY KEY,
 "actorId" UUID NOT NULL REFERENCES "Person"(id) ON DELETE RESTRICT,
 operation TEXT NOT NULL, key TEXT NOT NULL CHECK(length(key) BETWEEN 8 AND 128),
 "requestHash" TEXT NOT NULL, result JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "FinanceAccessReceipt_actorId_operation_key_key" UNIQUE("actorId",operation,key)
);

CREATE FUNCTION encova_finance_lock_person(person_id UUID) RETURNS void LANGUAGE plpgsql
 SET search_path=pg_catalog AS $$ BEGIN
 PERFORM id FROM public."Person" WHERE id=person_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(629813,hashtext(person_id::text));
END $$;

CREATE FUNCTION encova_finance_session_ok(actor UUID,provider TEXT,session_id TEXT) RETURNS BOOLEAN
 LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN provider='supabase' THEN EXISTS(
  SELECT 1 FROM public."AppSession" WHERE id::text=session_id AND "userId"=actor
 ) WHEN provider='better-auth' THEN EXISTS(
  SELECT 1 FROM public.session s JOIN public."Person" p ON p."authUserId"=s."userId"
  WHERE p.id=actor AND s.id=session_id AND s."expiresAt">CURRENT_TIMESTAMP
 ) ELSE false END
$$;

-- This protects every SQL/ORM path, regardless of the feature flag.
CREATE FUNCTION encova_finance_person_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_OWNER_PROTECTED' USING ERRCODE='P0001'; END IF;
  IF NEW.role<>'SUPER_ADMIN' OR NEW.status<>'ACTIVE' THEN RAISE EXCEPTION 'FINANCE_OWNER_PROTECTED' USING ERRCODE='P0001'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=OLD.id AND "revokedAt" IS NULL) THEN
  IF NEW."supabaseUserId" IS DISTINCT FROM OLD."supabaseUserId" OR NEW."authUserId" IS DISTINCT FROM OLD."authUserId"
   OR (NEW.email IS DISTINCT FROM OLD.email AND current_setting('encova.finance_self_email',true) IS DISTINCT FROM OLD.id::text) THEN
   RAISE EXCEPTION 'FINANCE_IDENTITY_PROTECTED' USING ERRCODE='P0001';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER "Finance_person_guard" BEFORE UPDATE OR DELETE ON "Person" FOR EACH ROW EXECUTE FUNCTION encova_finance_person_guard();

CREATE FUNCTION encova_finance_owner_grant_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerGrantId"=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_OWNER_PROTECTED' USING ERRCODE='P0001'; END IF;
  IF NEW."revokedAt" IS NOT NULL OR NEW."userId"<>OLD."userId" THEN RAISE EXCEPTION 'FINANCE_OWNER_PROTECTED' USING ERRCODE='P0001'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER "Finance_owner_grant_guard" BEFORE UPDATE OR DELETE ON "FinanceGrant" FOR EACH ROW EXECUTE FUNCTION encova_finance_owner_grant_guard();

CREATE FUNCTION encova_finance_settings_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_OWNER_PROTECTED' USING ERRCODE='P0001'; END IF;
 PERFORM id FROM public."Person" WHERE id=NEW."ownerId" AND role='SUPER_ADMIN' AND status='ACTIVE' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_TARGET_INELIGIBLE' USING ERRCODE='P0001'; END IF;
 PERFORM id FROM public."FinanceGrant" WHERE id=NEW."ownerGrantId" AND "userId"=NEW."ownerId" AND "revokedAt" IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FINANCE_OWNER_PROTECTED' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Finance_settings_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceSettings" FOR EACH ROW EXECUTE FUNCTION encova_finance_settings_guard();
CREATE TRIGGER "FinanceAccessReceipt_immutable" BEFORE UPDATE OR DELETE ON "FinanceAccessReceipt" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();

-- Restricted runtime entry point. The server verifies fresh password/TOTP first;
-- this function independently enforces current session/role/grant/owner/versions.
CREATE FUNCTION encova_finance_access_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,
 action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE settings public."FinanceSettings"%ROWTYPE; grant_row public."FinanceGrant"%ROWTYPE;
 transfer public."FinanceOwnershipTransfer"%ROWTYPE; receipt public."FinanceAccessReceipt"%ROWTYPE;
 target UUID; new_id UUID; reason TEXT; result JSONB; digest TEXT;
BEGIN
 IF action NOT IN ('GRANT','REVOKE','TRANSFER','ACCEPT','CANCEL') THEN RAISE EXCEPTION 'FINANCE_INVALID_ACTION' USING ERRCODE='P0001'; END IF;
 IF verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' OR verified_at IS NULL THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001'; END IF;
 IF length(request_key) NOT BETWEEN 8 AND 128 OR request_key IS NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 reason:=trim(input->>'reason');
 IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(987661);
 PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE')
  OR NOT public.encova_finance_session_ok(actor,provider,session_id)
  OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN
  RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001'; END IF;
 SELECT * INTO settings FROM public."FinanceSettings" FOR UPDATE;
 IF settings.id IS NULL THEN RAISE EXCEPTION 'FINANCE_SETUP_REQUIRED' USING ERRCODE='P0001'; END IF;
 IF action<>'ACCEPT' AND settings."ownerId"<>actor THEN RAISE EXCEPTION 'FINANCE_OWNER_REQUIRED' USING ERRCODE='P0001'; END IF;
 digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM public."FinanceAccessReceipt" WHERE "actorId"=actor AND operation=action AND key=request_key;
 IF FOUND THEN
  IF receipt."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  RETURN receipt.result;
 END IF;
 IF action IN ('GRANT','REVOKE','TRANSFER') AND settings.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001'; END IF;
 IF action IN ('GRANT','TRANSFER') THEN
  target:=(input->>'targetId')::uuid;
  IF target IS NULL OR target=actor THEN RAISE EXCEPTION 'FINANCE_TARGET_INELIGIBLE' USING ERRCODE='P0001'; END IF;
  PERFORM public.encova_finance_lock_person(target);
  IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=target AND role='SUPER_ADMIN' AND status='ACTIVE') THEN RAISE EXCEPTION 'FINANCE_TARGET_INELIGIBLE' USING ERRCODE='P0001'; END IF;
  SELECT * INTO grant_row FROM public."FinanceGrant" WHERE "userId"=target AND "revokedAt" IS NULL;
  IF action='GRANT' THEN
   IF grant_row.id IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_ALREADY_GRANTED' USING ERRCODE='P0001'; END IF;
   new_id:=gen_random_uuid();
   INSERT INTO public."FinanceGrant"(id,"userId","grantedById",reason) VALUES(new_id,target,actor,reason);
  ELSE
   IF grant_row.id IS NULL THEN RAISE EXCEPTION 'FINANCE_TARGET_INELIGIBLE' USING ERRCODE='P0001'; END IF;
   UPDATE public."FinanceOwnershipTransfer" SET status='EXPIRED',version=version+1 WHERE status='PENDING' AND "expiresAt"<=CURRENT_TIMESTAMP;
   IF EXISTS(SELECT 1 FROM public."FinanceOwnershipTransfer" WHERE status='PENDING') THEN RAISE EXCEPTION 'FINANCE_TRANSFER_PENDING' USING ERRCODE='P0001'; END IF;
   new_id:=gen_random_uuid();
   INSERT INTO public."FinanceOwnershipTransfer"(id,"currentOwnerId","targetOwnerId",reason,"expiresAt") VALUES(new_id,actor,target,reason,CURRENT_TIMESTAMP+interval '24 hours');
  END IF;
 ELSIF action='REVOKE' THEN
  SELECT * INTO grant_row FROM public."FinanceGrant" WHERE id=(input->>'grantId')::uuid;
  IF grant_row.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  target:=grant_row."userId"; new_id:=grant_row.id;
  PERFORM public.encova_finance_lock_person(target);
  IF target=settings."ownerId" THEN RAISE EXCEPTION 'FINANCE_OWNER_PROTECTED' USING ERRCODE='P0001'; END IF;
  IF grant_row.version<>(input->>'grantVersion')::integer OR grant_row."revokedAt" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001'; END IF;
  UPDATE public."FinanceGrant" SET "revokedAt"=CURRENT_TIMESTAMP,"revokedById"=actor,version=version+1 WHERE id=grant_row.id;
  UPDATE public."FinanceOwnershipTransfer" SET status='CANCELED',version=version+1 WHERE status='PENDING' AND "targetOwnerId"=target;
 ELSE
  SELECT * INTO transfer FROM public."FinanceOwnershipTransfer" WHERE id=(input->>'transferId')::uuid FOR UPDATE;
  IF transfer.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF action='ACCEPT' AND transfer."targetOwnerId"<>actor THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001'; END IF;
  IF transfer.status<>'PENDING' OR transfer.version<>(input->>'expectedVersion')::integer
   OR transfer."expiresAt"<=CURRENT_TIMESTAMP OR transfer."currentOwnerId"<>settings."ownerId" THEN RAISE EXCEPTION 'FINANCE_TRANSFER_INVALID' USING ERRCODE='P0001'; END IF;
  new_id:=transfer.id; target:=transfer."targetOwnerId";
  IF action='CANCEL' THEN
   UPDATE public."FinanceOwnershipTransfer" SET status='CANCELED',version=version+1 WHERE id=transfer.id;
  ELSE
   PERFORM public.encova_finance_lock_person(settings."ownerId");
   SELECT * INTO grant_row FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL;
   UPDATE public."FinanceSettings" SET "ownerId"=actor,"ownerGrantId"=grant_row.id WHERE id=settings.id;
   UPDATE public."FinanceOwnershipTransfer" SET status='ACCEPTED',"acceptedAt"=CURRENT_TIMESTAMP,version=version+1 WHERE id=transfer.id;
  END IF;
 END IF;
 UPDATE public."FinanceSettings" SET version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=settings.id RETURNING version INTO settings.version;
 result:=jsonb_build_object('id',new_id,'version',settings.version);
 INSERT INTO public."FinanceAccessReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,action,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId")
 VALUES(gen_random_uuid(),actor,'FINANCE_'||action,'FinanceAccess',new_id,reason,jsonb_build_object('targetId',target),request_id);
 RETURN result;
END $$;

-- Operator-only, never granted to encova_app or reachable by a public route.
CREATE FUNCTION encova_finance_setup_owner(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,
 expected_username TEXT,reason TEXT,request_id UUID,recovery_evidence TEXT DEFAULT NULL) RETURNS JSONB
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE settings public."FinanceSettings"%ROWTYPE; owner_grant UUID;
BEGIN
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds'
  OR length(trim(reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(987661);
 PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND username=expected_username AND role='SUPER_ADMIN' AND status='ACTIVE')
  OR NOT public.encova_finance_session_ok(actor,provider,session_id) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001'; END IF;
 SELECT * INTO settings FROM public."FinanceSettings" FOR UPDATE;
 IF settings.id IS NOT NULL THEN
  IF recovery_evidence IS NULL THEN RAISE EXCEPTION 'FINANCE_OWNER_EXISTS' USING ERRCODE='P0001'; END IF;
  IF length(trim(recovery_evidence)) NOT BETWEEN 10 AND 500 OR settings."ownerId"=actor THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
  PERFORM public.encova_finance_lock_person(settings."ownerId");
 ELSIF recovery_evidence IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SETUP_REQUIRED' USING ERRCODE='P0001'; END IF;
 SELECT id INTO owner_grant FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL;
 IF owner_grant IS NULL THEN
  owner_grant:=gen_random_uuid();
  INSERT INTO public."FinanceGrant"(id,"userId","grantedById",reason) VALUES(owner_grant,actor,actor,reason);
 END IF;
 IF settings.id IS NULL THEN
  INSERT INTO public."FinanceSettings"(id,"ownerId","ownerGrantId") VALUES('00000000-0000-0000-0000-000000000001',actor,owner_grant);
 ELSE
  UPDATE public."FinanceSettings" SET "ownerId"=actor,"ownerGrantId"=owner_grant,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=settings.id;
  UPDATE public."FinanceGrant" SET "revokedAt"=CURRENT_TIMESTAMP,"revokedById"=actor,version=version+1 WHERE id=settings."ownerGrantId";
  DELETE FROM public."AppSession" WHERE "userId"=settings."ownerId";
  DELETE FROM public.session WHERE "userId"=(SELECT "authUserId" FROM public."Person" WHERE id=settings."ownerId");
  UPDATE public."FinanceOwnershipTransfer" SET status='CANCELED',version=version+1 WHERE status='PENDING';
 END IF;
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(
  gen_random_uuid(),actor,CASE WHEN recovery_evidence IS NULL THEN 'FINANCE_OWNER_BOOTSTRAPPED' ELSE 'FINANCE_OWNER_RECOVERED' END,
  'FinanceSettings','00000000-0000-0000-0000-000000000001',reason,jsonb_build_object('operatorEvidence',recovery_evidence,'previousOwnerId',settings."ownerId"),request_id);
 RETURN jsonb_build_object('ownerId',actor);
END $$;

DO $$ DECLARE t TEXT; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceSettings','FinanceOwnershipTransfer','FinanceAccessReceipt'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN
   EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);
   EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);
  END IF;
 END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (
  'encova_finance_lock_person','encova_finance_session_ok','encova_finance_person_guard','encova_finance_owner_grant_guard',
  'encova_finance_settings_guard','encova_finance_access_command','encova_finance_setup_owner') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon',f.signature); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated',f.signature); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM encova_app',f.signature); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN
  GRANT EXECUTE ON FUNCTION encova_finance_access_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID) TO encova_app;
 END IF;
END $$;
