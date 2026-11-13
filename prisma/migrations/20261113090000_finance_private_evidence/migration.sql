BEGIN;
CREATE TABLE "FinanceFile"(id UUID PRIMARY KEY,"invoiceId" UUID REFERENCES "FinanceInvoice" ON DELETE RESTRICT,"billId" UUID REFERENCES "FinanceBill" ON DELETE RESTRICT,"customerDocumentId" UUID REFERENCES "FinanceCustomerDocument" ON DELETE RESTRICT,"supplierDocumentId" UUID REFERENCES "FinanceSupplierDocument" ON DELETE RESTRICT,"journalDraftId" UUID REFERENCES "FinanceJournalDraft" ON DELETE RESTRICT,"fileName" TEXT NOT NULL CHECK(length(trim("fileName")) BETWEEN 1 AND 120 AND "fileName"!~'[[:cntrl:]/\\]'),"mimeType" TEXT NOT NULL CHECK("mimeType" IN('application/pdf','image/png','image/jpeg')),"byteSize" INTEGER NOT NULL CHECK("byteSize" BETWEEN 1 AND 10485760),sha256 TEXT NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),"objectKey" TEXT NOT NULL UNIQUE CHECK("objectKey"='evidence/'||id::text),state TEXT NOT NULL DEFAULT 'RESERVED' CHECK(state IN('RESERVED','QUARANTINED','CLEAN','REJECTED','REMOVED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"uploaderId" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"intentActorId" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"blobDeletedAt" TIMESTAMPTZ,"intentHash" TEXT NOT NULL CHECK("intentHash"~'^[a-f0-9]{64}$'),"intentProvider" TEXT NOT NULL CHECK("intentProvider" IN('better-auth','supabase')),"intentSessionId" TEXT NOT NULL,"intentVerifiedAt" TIMESTAMPTZ NOT NULL,"scanResult" JSONB,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK(num_nonnulls("invoiceId","billId","customerDocumentId","supplierDocumentId","journalDraftId")=1),CHECK(state NOT IN('CLEAN','REJECTED') OR "scanResult" IS NOT NULL),CHECK("blobDeletedAt" IS NULL OR state='REMOVED'));
CREATE INDEX "FinanceFile_state_createdAt_id_idx" ON "FinanceFile"(state,"createdAt",id);
CREATE TRIGGER "FinanceFile_config" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceFile" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
CREATE FUNCTION encova_finance_file_source(source_kind TEXT,source_id UUID) RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE s TEXT;BEGIN
 CASE source_kind WHEN 'INVOICE' THEN SELECT state INTO s FROM public."FinanceInvoice" WHERE id=source_id;WHEN 'BILL' THEN SELECT state INTO s FROM public."FinanceBill" WHERE id=source_id;WHEN 'CUSTOMER_DOCUMENT' THEN SELECT state INTO s FROM public."FinanceCustomerDocument" WHERE id=source_id;WHEN 'SUPPLIER_DOCUMENT' THEN SELECT state INTO s FROM public."FinanceSupplierDocument" WHERE id=source_id;WHEN 'JOURNAL_DRAFT' THEN SELECT state INTO s FROM public."FinanceJournalDraft" WHERE id=source_id;ELSE RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END CASE;
 IF s IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;RETURN s;END $$;
CREATE FUNCTION encova_finance_file_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE n BIGINT;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'RESERVED' OR NEW.version<>1 OR NEW."scanResult" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  SELECT count(*) INTO n FROM public."FinanceFile" WHERE state<>'REMOVED' AND ROW("invoiceId","billId","customerDocumentId","supplierDocumentId","journalDraftId") IS NOT DISTINCT FROM ROW(NEW."invoiceId",NEW."billId",NEW."customerDocumentId",NEW."supplierDocumentId",NEW."journalDraftId");
  IF n>=10 THEN RAISE EXCEPTION 'FINANCE_FILE_LIMIT' USING ERRCODE='P0001';END IF;
 ELSE
  IF(to_jsonb(NEW)-ARRAY['state','version','intentHash','intentProvider','intentSessionId','intentVerifiedAt','scanResult','updatedAt','intentActorId','blobDeletedAt']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','intentHash','intentProvider','intentSessionId','intentVerifiedAt','scanResult','updatedAt','intentActorId','blobDeletedAt']) OR NEW.version<>OLD.version+1 OR(OLD.state IN('CLEAN','REJECTED') AND NEW.state<>'REMOVED') OR(OLD.state='REMOVED' AND NEW.state<>'REMOVED') OR NOT((OLD.state=NEW.state AND NEW.state IN('RESERVED','QUARANTINED')) OR(OLD.state='RESERVED' AND NEW.state='QUARANTINED') OR(OLD.state='QUARANTINED' AND NEW.state IN('CLEAN','REJECTED')) OR NEW.state='REMOVED') THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER "FinanceFile_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceFile" FOR EACH ROW EXECUTE FUNCTION encova_finance_file_guard();
CREATE FUNCTION encova_finance_file_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceFile"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;source_kind TEXT;source_id UUID;source_state TEXT;reason TEXT;digest TEXT;result JSONB;new_id UUID:=gen_random_uuid();
BEGIN
 IF action IS NULL OR action NOT IN('RESERVE','COMPLETE','SCAN','REMOVE','AUTHORIZE','BLOB_REMOVED') OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
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
 ALTER TABLE public."FinanceFile" ENABLE ROW LEVEL SECURITY;REVOKE ALL ON public."FinanceFile" FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT SELECT ON public."FinanceFile" TO encova_app;CREATE POLICY encova_server_read ON public."FinanceFile" FOR SELECT TO encova_app USING(true);END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON public."FinanceFile" FROM %I',role_name);END IF;END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'encova_finance_file_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','encova_app'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name);END IF;END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION encova_finance_file_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID) TO encova_app;END IF;
 IF to_regclass('storage.buckets') IS NOT NULL THEN INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('encova-finance-evidence','encova-finance-evidence',false,10485760,ARRAY['application/pdf','image/png','image/jpeg']) ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=10485760,allowed_mime_types=EXCLUDED.allowed_mime_types;END IF;
END $$;
DO $$ BEGIN IF to_regclass('storage.objects') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='encova_finance_evidence_private') THEN EXECUTE 'CREATE POLICY encova_finance_evidence_private ON storage.objects AS RESTRICTIVE FOR ALL TO PUBLIC USING(bucket_id<>''encova-finance-evidence'') WITH CHECK(bucket_id<>''encova-finance-evidence'')';END IF;END $$;
COMMIT;
