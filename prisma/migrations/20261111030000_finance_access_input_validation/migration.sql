-- Add strict version/input validation without resetting tables or changing existing records.
CREATE OR REPLACE FUNCTION encova_finance_access_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,
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
 IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR (input->>'expectedVersion')::integer<1
  OR (action='REVOKE' AND (jsonb_typeof(input->'grantVersion') IS DISTINCT FROM 'number' OR (input->>'grantVersion')::integer<1)) THEN
  RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
 IF (input - (CASE WHEN action IN ('GRANT','TRANSFER') THEN ARRAY['expectedVersion','reason','targetId']
  WHEN action='REVOKE' THEN ARRAY['expectedVersion','reason','grantId','grantVersion'] ELSE ARRAY['expectedVersion','reason','transferId'] END)) <> '{}'::jsonb THEN
  RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001'; END IF;
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

