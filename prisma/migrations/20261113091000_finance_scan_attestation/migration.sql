BEGIN;
CREATE TABLE "FinanceScanAuthority"(id UUID PRIMARY KEY,name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),secret BYTEA NOT NULL CHECK(length(secret) BETWEEN 32 AND 128),active BOOLEAN NOT NULL DEFAULT true,"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
ALTER TABLE "FinanceScanAuthority" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "FinanceScanAuthority" FROM PUBLIC;
CREATE FUNCTION encova_finance_file_hmac(secret BYTEA,message TEXT) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE k BYTEA:=secret;i INTEGER;inner_pad BYTEA;outer_pad BYTEA;BEGIN
 IF length(k)>64 THEN k:=sha256(k);END IF;k:=k||decode(repeat('00',64-length(k)),'hex');inner_pad:=k;outer_pad:=k;
 FOR i IN 0..63 LOOP inner_pad:=set_byte(inner_pad,i,get_byte(k,i)#54);outer_pad:=set_byte(outer_pad,i,get_byte(k,i)#92);END LOOP;
 RETURN encode(sha256(outer_pad||sha256(inner_pad||convert_to(message,'UTF8'))),'hex');END $$;
CREATE FUNCTION encova_finance_file_scan_signature(target UUID,result JSONB,challenge TEXT) RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE d public."FinanceFile"%ROWTYPE;k BYTEA;message TEXT;BEGIN
 SELECT * INTO d FROM public."FinanceFile" WHERE id=target;
 SELECT secret INTO k FROM public."FinanceScanAuthority" WHERE id=(result->>'keyId')::uuid AND active;
 IF k IS NULL OR result->>'signature' IS NULL OR result->>'signature'!~'^[a-f0-9]{64}$' OR result->>'status' NOT IN('CLEAN','INFECTED') OR result->>'sha256' IS DISTINCT FROM d.sha256 OR result->>'engine' IS NULL OR length(result->>'engine') NOT BETWEEN 1 AND 200 THEN RETURN false;END IF;
 message:=d.id::text||':'||d.sha256||':'||d."byteSize"::text||':'||(result->>'status')||':'||octet_length(convert_to(result->>'engine','UTF8'))::text||':'||(result->>'engine')||':'||challenge;
 RETURN public.encova_finance_file_hmac(k,message)=result->>'signature';END $$;

CREATE OR REPLACE FUNCTION encova_finance_file_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceFile"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;source_kind TEXT;source_id UUID;source_state TEXT;reason TEXT;digest TEXT;result JSONB;new_id UUID:=gen_random_uuid();
BEGIN
 IF action IS NULL OR action NOT IN('RESERVE','COMPLETE','SCAN','REMOVE','AUTHORIZE','BLOB_REMOVED','VALIDATE') OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action IN('RESERVE','REMOVE','AUTHORIZE','BLOB_REMOVED') THEN
  IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' OR NOT public.encova_finance_session_ok(actor,provider,session_id) THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
  IF request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 OR length(trim(input->>'reason')) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  reason:=trim(input->>'reason');digest:=encode(sha256(convert_to((input-'intentHash')::text,'UTF8')),'hex');
  SELECT * INTO r FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation='FILE_'||action AND key=request_key;
  IF FOUND THEN IF r."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;IF action NOT IN('RESERVE','AUTHORIZE') THEN RETURN r.result;END IF;SELECT * INTO d FROM public."FinanceFile" WHERE id=(r.result->>'id')::uuid FOR UPDATE;
   IF d.state IN('RESERVED','QUARANTINED') THEN UPDATE public."FinanceFile" SET "intentActorId"=actor,"intentHash"=input->>'intentHash',"intentProvider"=provider,"intentSessionId"=session_id,"intentVerifiedAt"=verified_at,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id;END IF;RETURN r.result;
  END IF;
 ELSE
  SELECT * INTO d FROM public."FinanceFile" WHERE id=(input->>'id')::uuid FOR UPDATE;
  IF d.id IS NULL OR d."intentActorId"<>actor OR d."intentHash" IS DISTINCT FROM input->>'intentHash' OR d."intentVerifiedAt"<CURRENT_TIMESTAMP-interval '5 minutes' OR NOT public.encova_finance_session_ok(actor,d."intentProvider",d."intentSessionId") THEN RAISE EXCEPTION 'FINANCE_FILE_INTENT' USING ERRCODE='P0001';END IF;
 END IF;
 IF action='VALIDATE' THEN RETURN jsonb_build_object('id',d.id);END IF;
 IF action='RESERVE' THEN
  IF input-ARRAY['sourceType','sourceId','fileName','mimeType','byteSize','sha256','reason','intentHash']<>'{}'::jsonb OR jsonb_typeof(input->'byteSize') IS DISTINCT FROM 'number' OR input->>'byteSize' !~ '^[1-9][0-9]{0,7}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  source_kind:=input->>'sourceType';source_id:=(input->>'sourceId')::uuid;source_state:=public.encova_finance_file_source(source_kind,source_id);
  IF source_state='VOIDED' THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinanceFile"(id,"invoiceId","billId","customerDocumentId","supplierDocumentId","journalDraftId","fileName","mimeType","byteSize",sha256,"objectKey","uploaderId","intentActorId","intentHash","intentProvider","intentSessionId","intentVerifiedAt") VALUES(new_id,CASE WHEN source_kind='INVOICE' THEN source_id END,CASE WHEN source_kind='BILL' THEN source_id END,CASE WHEN source_kind='CUSTOMER_DOCUMENT' THEN source_id END,CASE WHEN source_kind='SUPPLIER_DOCUMENT' THEN source_id END,CASE WHEN source_kind='JOURNAL_DRAFT' THEN source_id END,input->>'fileName',input->>'mimeType',(input->>'byteSize')::integer,input->>'sha256','evidence/'||new_id::text,actor,actor,input->>'intentHash',provider,session_id,verified_at) RETURNING * INTO d;
 ELSIF action='AUTHORIZE' THEN
  IF input-ARRAY['id','reason','intentHash']<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  SELECT * INTO d FROM public."FinanceFile" WHERE id=(input->>'id')::uuid FOR UPDATE;IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF d.state NOT IN('RESERVED','QUARANTINED') THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;
  UPDATE public."FinanceFile" SET "intentActorId"=actor,"intentHash"=input->>'intentHash',"intentProvider"=provider,"intentSessionId"=session_id,"intentVerifiedAt"=verified_at,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
 ELSIF action='BLOB_REMOVED' THEN
  IF input-ARRAY['id','reason']<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  UPDATE public."FinanceFile" SET "blobDeletedAt"=coalesce("blobDeletedAt",CURRENT_TIMESTAMP),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=(input->>'id')::uuid AND state='REMOVED' RETURNING * INTO d;
  IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
 ELSIF action='COMPLETE' THEN
  IF input-ARRAY['id','intentHash']<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF d.state='RESERVED' THEN UPDATE public."FinanceFile" SET state='QUARANTINED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;ELSIF d.state NOT IN('QUARANTINED','CLEAN','REJECTED') THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;reason:='Verified reserved bytes, size and content type';
 ELSIF action='SCAN' THEN
  IF input-ARRAY['id','intentHash','scanResult']<>'{}'::jsonb OR input->'scanResult'->>'status' IS NULL OR input->'scanResult'->>'status' NOT IN('CLEAN','INFECTED') OR input->'scanResult'->>'sha256' IS DISTINCT FROM d.sha256 OR input->'scanResult'->>'engine' IS NULL OR length(trim(input->'scanResult'->>'engine')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF NOT public.encova_finance_file_scan_signature(d.id,input->'scanResult',input->>'intentHash') THEN RAISE EXCEPTION 'FINANCE_FILE_SIGNATURE' USING ERRCODE='P0001';END IF;
  IF d.state='QUARANTINED' THEN UPDATE public."FinanceFile" SET state=CASE WHEN input->'scanResult'->>'status'='CLEAN' THEN 'CLEAN' ELSE 'REJECTED' END,"scanResult"=input->'scanResult',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;ELSIF d.state NOT IN('CLEAN','REJECTED') THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;reason:='Scanner result bound to verified file digest';
 ELSE
  IF input-ARRAY['id','reason']<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  SELECT * INTO d FROM public."FinanceFile" WHERE id=(input->>'id')::uuid FOR UPDATE;IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  source_kind:=CASE WHEN d."invoiceId" IS NOT NULL THEN 'INVOICE' WHEN d."billId" IS NOT NULL THEN 'BILL' WHEN d."customerDocumentId" IS NOT NULL THEN 'CUSTOMER_DOCUMENT' WHEN d."supplierDocumentId" IS NOT NULL THEN 'SUPPLIER_DOCUMENT' ELSE 'JOURNAL_DRAFT' END;source_id:=coalesce(d."invoiceId",d."billId",d."customerDocumentId",d."supplierDocumentId",d."journalDraftId");source_state:=public.encova_finance_file_source(source_kind,source_id);
  IF source_state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;
  UPDATE public."FinanceFile" SET state='REMOVED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
 END IF;
 result:=jsonb_build_object('id',d.id);
 IF action IN('RESERVE','REMOVE','AUTHORIZE','BLOB_REMOVED') THEN INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,'FILE_'||action,request_key,digest,result);END IF;
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_FILE_'||action,'FinanceFile',d.id,reason,jsonb_build_object('fileName',d."fileName",'mimeType',d."mimeType",'byteSize',d."byteSize",'sha256',d.sha256,'state',d.state,'scanResult',d."scanResult"),request_id);RETURN result;
EXCEPTION WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;
DO $$ DECLARE f RECORD;role_name TEXT;BEGIN
 FOREACH role_name IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON public."FinanceScanAuthority" FROM %I',role_name);END IF;END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('encova_finance_file_hmac','encova_finance_file_scan_signature') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','encova_app'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name);END IF;END LOOP;
 END LOOP;
END $$;
COMMIT;
