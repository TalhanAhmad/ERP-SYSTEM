BEGIN;
CREATE SEQUENCE finance_statement_number AS BIGINT MINVALUE 1 MAXVALUE 9999999999 NO CYCLE;
CREATE TABLE "FinanceStatementUpload"(
 id UUID PRIMARY KEY,"cashAccountId" UUID NOT NULL REFERENCES "FinanceCashAccount" ON DELETE RESTRICT,"glAccountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,"fileName" TEXT NOT NULL CHECK(length(trim("fileName")) BETWEEN 5 AND 180 AND "fileName"~*'[.]csv$' AND position('/' IN "fileName")=0 AND position(chr(92) IN "fileName")=0 AND "fileName"!~'[[:cntrl:]]'),"byteSize" INTEGER NOT NULL CHECK("byteSize" BETWEEN 1 AND 5000000),sha256 TEXT NOT NULL CHECK(sha256~'^[0-9a-f]{64}$'),"replacesId" UUID,"resultBatchId" UUID,state TEXT NOT NULL DEFAULT 'UPLOADING' CHECK(state IN('UPLOADING','IMPORTED','CANCELLED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"intentHash" TEXT NOT NULL CHECK("intentHash"~'^[0-9a-f]{64}$'),"intentVerifiedAt" TIMESTAMPTZ NOT NULL,"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK((state='IMPORTED')=("resultBatchId" IS NOT NULL))
);
CREATE UNIQUE INDEX "FinanceStatementUpload_pending_key" ON "FinanceStatementUpload"("createdById","cashAccountId",sha256,"replacesId") NULLS NOT DISTINCT WHERE state='UPLOADING';
CREATE INDEX "FinanceStatementUpload_createdById_state_createdAt_id_idx" ON "FinanceStatementUpload"("createdById",state,"createdAt",id);
CREATE TABLE "FinanceStatementChunk"("uploadId" UUID NOT NULL REFERENCES "FinanceStatementUpload" ON DELETE RESTRICT,index INTEGER NOT NULL CHECK(index BETWEEN 0 AND 2),bytes BYTEA NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 2097152),sha256 TEXT NOT NULL CHECK(sha256~'^[0-9a-f]{64}$'),"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY("uploadId",index));
CREATE TABLE "FinanceStatementBatch"(
 id UUID PRIMARY KEY,number TEXT NOT NULL UNIQUE,"uploadId" UUID NOT NULL UNIQUE REFERENCES "FinanceStatementUpload" ON DELETE RESTRICT,"cashAccountId" UUID NOT NULL REFERENCES "FinanceCashAccount" ON DELETE RESTRICT,"glAccountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,sha256 TEXT NOT NULL CHECK(sha256~'^[0-9a-f]{64}$'),"importKey" TEXT NOT NULL CHECK(length("importKey") BETWEEN 8 AND 128),"parserVersion" TEXT NOT NULL CHECK("parserVersion"='ENCOVA_CSV_V1'),mapping JSONB NOT NULL CHECK(jsonb_typeof(mapping)='object'),"startDate" DATE NOT NULL CHECK("startDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),"endDate" DATE NOT NULL CHECK("endDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),"openingBalance" NUMERIC(20,2) NOT NULL,"closingBalance" NUMERIC(20,2) NOT NULL,receipts NUMERIC(24,2) NOT NULL CHECK(receipts>=0),payments NUMERIC(24,2) NOT NULL CHECK(payments>=0),"rowCount" INTEGER NOT NULL CHECK("rowCount" BETWEEN 1 AND 5000),"rowDigest" TEXT NOT NULL CHECK("rowDigest"~'^[0-9a-f]{64}$'),"sourceSnapshot" JSONB NOT NULL,"duplicateReview" TEXT NOT NULL,"duplicateSnapshot" JSONB NOT NULL CHECK(jsonb_typeof("duplicateSnapshot")='array'),"replacesId" UUID UNIQUE REFERENCES "FinanceStatementBatch" ON DELETE RESTRICT,state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','IMPORTED','VOIDED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK("startDate"<="endDate"),CHECK("closingBalance"="openingBalance"+receipts-payments),CHECK("replacesId" IS DISTINCT FROM id),CHECK(jsonb_array_length("duplicateSnapshot")=0 OR length(trim("duplicateReview")) BETWEEN 3 AND 1000)
);
CREATE UNIQUE INDEX "FinanceStatementBatch_active_file_key" ON "FinanceStatementBatch"("cashAccountId",sha256) WHERE state IN('DRAFT','IMPORTED');
CREATE INDEX "FinanceStatementBatch_cashAccountId_startDate_endDate_id_idx" ON "FinanceStatementBatch"("cashAccountId","startDate","endDate",id);
ALTER TABLE "FinanceStatementUpload" ADD CONSTRAINT "FinanceStatementUpload_replacesId_fkey" FOREIGN KEY("replacesId") REFERENCES "FinanceStatementBatch" ON DELETE RESTRICT,ADD CONSTRAINT "FinanceStatementUpload_resultBatchId_fkey" FOREIGN KEY("resultBatchId") REFERENCES "FinanceStatementBatch" ON DELETE RESTRICT;
CREATE TABLE "FinanceStatementLine"(id UUID PRIMARY KEY,"batchId" UUID NOT NULL REFERENCES "FinanceStatementBatch" ON DELETE RESTRICT,sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 5000),"sourceRow" INTEGER NOT NULL CHECK("sourceRow" BETWEEN 2 AND 5026),"valueDate" DATE NOT NULL CHECK("valueDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),direction TEXT NOT NULL CHECK(direction IN('RECEIPT','PAYMENT')),amount NUMERIC(20,2) NOT NULL CHECK(amount>0),description TEXT NOT NULL CHECK(length(description)<=1000),"bankReference" TEXT NOT NULL CHECK(length("bankReference")<=200),fingerprint TEXT NOT NULL CHECK(fingerprint~'^[0-9a-f]{64}$'),UNIQUE("batchId",sequence));
CREATE INDEX "FinanceStatementLine_fingerprint_batchId_id_idx" ON "FinanceStatementLine"(fingerprint,"batchId",id);
CREATE INDEX "FinanceStatementLine_valueDate_batchId_id_idx" ON "FinanceStatementLine"("valueDate","batchId",id);
CREATE FUNCTION encova_finance_statement_fingerprint(account UUID,date DATE,direction TEXT,amount NUMERIC,description TEXT,reference TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(account,date,direction,round(amount,2)::text,lower(regexp_replace(trim(reference),'[[:space:]]+',' ','g')),lower(regexp_replace(trim(description),'[[:space:]]+',' ','g')))::text,'UTF8')),'hex')
$$;
CREATE FUNCTION encova_finance_statement_mapping(input JSONB) RETURNS VOID LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE k TEXT;v JSONB;indices INTEGER[]:=ARRAY[]::INTEGER[];allowed TEXT[];BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input->>'mode' IS NULL OR input->>'mode' NOT IN('SIGNED','DEBIT_CREDIT') OR input->>'dateFormat' IS NULL OR input->>'dateFormat' NOT IN('ISO','DMY','MDY') OR jsonb_typeof(input->'skipRows') IS DISTINCT FROM 'number' OR(input->>'skipRows')::integer NOT BETWEEN 0 AND 25 THEN RAISE EXCEPTION 'FINANCE_STATEMENT_MAPPING' USING ERRCODE='P0001';END IF;
 allowed:=ARRAY['mode','skipRows','dateColumn','dateFormat','descriptionColumn','referenceColumn']||(CASE WHEN input->>'mode'='SIGNED' THEN ARRAY['amountColumn','positiveMeans'] ELSE ARRAY['debitColumn','creditColumn'] END);
 IF input-allowed<>'{}'::jsonb OR(input->>'mode'='SIGNED' AND(input->>'positiveMeans' IS NULL OR input->>'positiveMeans' NOT IN('RECEIPT','PAYMENT'))) THEN RAISE EXCEPTION 'FINANCE_STATEMENT_MAPPING' USING ERRCODE='P0001';END IF;
 FOREACH k IN ARRAY ARRAY['dateColumn','descriptionColumn','referenceColumn']||(CASE WHEN input->>'mode'='SIGNED' THEN ARRAY['amountColumn'] ELSE ARRAY['debitColumn','creditColumn'] END) LOOP
  v:=input->k;IF k IN('descriptionColumn','referenceColumn') AND v='null'::jsonb THEN CONTINUE;END IF;
  IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR(v::text)::integer NOT BETWEEN 0 AND 49 THEN RAISE EXCEPTION 'FINANCE_STATEMENT_MAPPING' USING ERRCODE='P0001';END IF;indices:=array_append(indices,(v::text)::integer);
 END LOOP;
 IF cardinality(indices)<>(SELECT count(DISTINCT x) FROM unnest(indices)x) THEN RAISE EXCEPTION 'FINANCE_STATEMENT_MAPPING' USING ERRCODE='P0001';END IF;
END $$;
CREATE FUNCTION encova_finance_statement_rows(upload_id UUID,input JSONB,mapping JSONB) RETURNS TABLE(sequence INTEGER,"sourceRow" INTEGER,"valueDate" DATE,direction TEXT,amount NUMERIC,description TEXT,"bankReference" TEXT,fingerprint TEXT) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE u public."FinanceStatementUpload"%ROWTYPE;r JSONB;n INTEGER:=0;BEGIN
 PERFORM public.encova_finance_statement_mapping(mapping);
 SELECT * INTO u FROM public."FinanceStatementUpload" WHERE id=upload_id;IF u.id IS NULL OR jsonb_typeof(input) IS DISTINCT FROM 'array' OR jsonb_array_length(input) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'FINANCE_STATEMENT_ROWS' USING ERRCODE='P0001';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(input) LOOP
  n:=n+1;IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['sequence','sourceRow','valueDate','direction','amount','description','bankReference']<>'{}'::jsonb OR jsonb_typeof(r->'sequence') IS DISTINCT FROM 'number' OR(r->>'sequence')::integer<>n OR jsonb_typeof(r->'sourceRow') IS DISTINCT FROM 'number' OR(r->>'sourceRow')::integer<>n+(mapping->>'skipRows')::integer+1 OR EXISTS(SELECT 1 FROM unnest(ARRAY['valueDate','direction','amount','description','bankReference'])k WHERE jsonb_typeof(r->k) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'FINANCE_STATEMENT_ROWS' USING ERRCODE='P0001';END IF;
  IF r->>'valueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR r->>'direction' NOT IN('RECEIPT','PAYMENT') OR r->>'amount' !~ '^(0|[1-9][0-9]{0,17})[.][0-9]{2}$' OR(r->>'amount')::numeric<=0 OR length(r->>'description')>1000 OR length(r->>'bankReference')>200 OR(r->>'description')~'[[:cntrl:]]' OR(r->>'bankReference')~'[[:cntrl:]]' THEN RAISE EXCEPTION 'FINANCE_STATEMENT_ROWS' USING ERRCODE='P0001';END IF;
  sequence:=n;"sourceRow":=(r->>'sourceRow')::integer;"valueDate":=(r->>'valueDate')::date;IF "valueDate" NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' THEN RAISE EXCEPTION 'FINANCE_STATEMENT_RANGE' USING ERRCODE='P0001';END IF;
  direction:=r->>'direction';amount:=(r->>'amount')::numeric;description:=regexp_replace(trim(r->>'description'),'[[:space:]]+',' ','g');"bankReference":=regexp_replace(trim(r->>'bankReference'),'[[:space:]]+',' ','g');fingerprint:=public.encova_finance_statement_fingerprint(u."cashAccountId","valueDate",direction,amount,description,"bankReference");RETURN NEXT;
 END LOOP;
END $$;
CREATE FUNCTION encova_finance_statement_file_check(target UUID) RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE u public."FinanceStatementUpload"%ROWTYPE;n INTEGER;size BIGINT;hash TEXT;valid BOOLEAN;BEGIN
 SELECT * INTO u FROM public."FinanceStatementUpload" WHERE id=target;IF u.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
 SELECT count(*),sum(octet_length(c.bytes)),encode(sha256(string_agg(c.bytes,''::bytea ORDER BY c.index)),'hex'),bool_and(c.index<ceil(u."byteSize"/2097152.0)::integer AND octet_length(c.bytes)=least(2097152,u."byteSize"-c.index*2097152) AND c.sha256=encode(sha256(c.bytes),'hex')) INTO n,size,hash,valid FROM public."FinanceStatementChunk" c WHERE c."uploadId"=target;
 IF n<>ceil(u."byteSize"/2097152.0)::integer OR size IS DISTINCT FROM u."byteSize" OR hash IS DISTINCT FROM u.sha256 OR valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'FINANCE_STATEMENT_FILE' USING ERRCODE='P0001';END IF;
END $$;
CREATE FUNCTION encova_finance_statement_duplicates(upload_id UUID,input JSONB,mapping JSONB) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH rows AS MATERIALIZED(SELECT * FROM public.encova_finance_statement_rows(upload_id,input,mapping)),groups AS(SELECT fingerprint,count(*) AS n,array_agg("sourceRow" ORDER BY "sourceRow") AS peers FROM rows GROUP BY fingerprint),evidence AS(
 SELECT g.*,old.n AS "existingCount",old.digest AS "existingDigest",coalesce(samples.items,'[]'::jsonb) AS samples FROM groups g
 CROSS JOIN LATERAL(SELECT count(*) AS n,encode(sha256(convert_to(coalesce(string_agg(l.id::text,',' ORDER BY l.id),''),'UTF8')),'hex') AS digest FROM public."FinanceStatementLine" l JOIN public."FinanceStatementBatch" b ON b.id=l."batchId" WHERE l.fingerprint=g.fingerprint AND b.state='IMPORTED')old
 CROSS JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('id',x.id,'batchId',x."batchId") ORDER BY x.id) AS items FROM(SELECT l.id,l."batchId" FROM public."FinanceStatementLine" l JOIN public."FinanceStatementBatch" b ON b.id=l."batchId" WHERE l.fingerprint=g.fingerprint AND b.state='IMPORTED' ORDER BY l.id LIMIT 3)x)samples WHERE g.n>1 OR old.n>0)
 SELECT coalesce(jsonb_agg(jsonb_build_object('sourceRow',r."sourceRow",'fingerprint',r.fingerprint,'withinSourceCount',e.n,'samplePeerRows',to_jsonb(e.peers[1:3]),'existingCount',e."existingCount",'existingDigest',e."existingDigest",'sampleLines',e.samples) ORDER BY r."sourceRow"),'[]'::jsonb) FROM rows r JOIN evidence e ON e.fingerprint=r.fingerprint
$$;
CREATE FUNCTION encova_finance_statement_evaluate(target UUID,metadata JSONB,input JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE u public."FinanceStatementUpload"%ROWTYPE;stats RECORD;duplicates JSONB;business JSONB;difference NUMERIC;start_date DATE;end_date DATE;opening NUMERIC;closing NUMERIC;BEGIN
 SELECT * INTO u FROM public."FinanceStatementUpload" WHERE id=target;PERFORM public.encova_finance_statement_file_check(target);
 IF jsonb_typeof(metadata) IS DISTINCT FROM 'object' OR metadata-ARRAY['mapping','startDate','endDate','openingBalance','closingBalance','currency']<>'{}'::jsonb OR metadata->>'currency' IS DISTINCT FROM 'PKR' OR EXISTS(SELECT 1 FROM unnest(ARRAY['startDate','endDate','openingBalance','closingBalance'])k WHERE jsonb_typeof(metadata->k) IS DISTINCT FROM 'string') OR metadata->>'startDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR metadata->>'endDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR metadata->>'openingBalance' !~ '^-?(0|[1-9][0-9]{0,17})[.][0-9]{2}$' OR metadata->>'closingBalance' !~ '^-?(0|[1-9][0-9]{0,17})[.][0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 start_date:=(metadata->>'startDate')::date;end_date:=(metadata->>'endDate')::date;opening:=(metadata->>'openingBalance')::numeric;closing:=(metadata->>'closingBalance')::numeric;
 IF start_date>end_date OR start_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' OR end_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' THEN RAISE EXCEPTION 'FINANCE_STATEMENT_RANGE' USING ERRCODE='P0001';END IF;
 SELECT count(*) AS n,coalesce(sum(x.amount) FILTER(WHERE x.direction='RECEIPT'),0) AS receipts,coalesce(sum(x.amount) FILTER(WHERE x.direction='PAYMENT'),0) AS payments,min(x."valueDate") AS first_date,max(x."valueDate") AS last_date,encode(sha256(convert_to(jsonb_agg(jsonb_build_object('sequence',x.sequence,'sourceRow',x."sourceRow",'valueDate',x."valueDate",'direction',x.direction,'amount',round(x.amount,2)::text,'description',x.description,'bankReference',x."bankReference",'fingerprint',x.fingerprint) ORDER BY x.sequence)::text,'UTF8')),'hex') AS digest INTO stats FROM public.encova_finance_statement_rows(target,input,metadata->'mapping')x;
 IF stats.first_date<start_date OR stats.last_date>end_date THEN RAISE EXCEPTION 'FINANCE_STATEMENT_RANGE' USING ERRCODE='P0001';END IF;
 duplicates:=public.encova_finance_statement_duplicates(target,input,metadata->'mapping');difference:=closing-(opening+stats.receipts-stats.payments);
 business:=jsonb_build_object('uploadId',u.id,'uploadVersion',u.version,'fileSha256',u.sha256,'byteSize',u."byteSize",'cashAccountId',u."cashAccountId",'glAccountId',u."glAccountId",'replacesId',u."replacesId",'parserVersion','ENCOVA_CSV_V1','metadata',metadata,'rowCount',stats.n,'rowDigest',stats.digest,'duplicates',duplicates);
 RETURN jsonb_build_object('rowCount',stats.n,'receipts',round(stats.receipts,2)::text,'payments',round(stats.payments,2)::text,'rowDigest',stats.digest,'minValueDate',stats.first_date,'maxValueDate',stats.last_date,'duplicates',duplicates,'difference',round(difference,2)::text,'balanced',difference=0,'uploadVersion',u.version,'basisHash',encode(sha256(convert_to(business::text,'UTF8')),'hex'));
END $$;
CREATE FUNCTION encova_finance_statement_snapshot(target UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',b.id,'number',b.number,'uploadId',b."uploadId",'fileName',u."fileName",'byteSize',u."byteSize",'fileSha256',b.sha256,'cashAccountId',b."cashAccountId",'glAccountId',b."glAccountId",'currency','PKR','importKey',b."importKey",'parserVersion',b."parserVersion",'mapping',b.mapping,'startDate',b."startDate",'endDate',b."endDate",'openingBalance',b."openingBalance"::text,'closingBalance',b."closingBalance"::text,'receipts',b.receipts::text,'payments',b.payments::text,'rowCount',b."rowCount",'rowDigest',b."rowDigest",'duplicates',b."duplicateSnapshot",'duplicateReview',b."duplicateReview",'replacesId',b."replacesId") FROM public."FinanceStatementBatch" b JOIN public."FinanceStatementUpload" u ON u.id=b."uploadId" WHERE b.id=target
$$;
CREATE FUNCTION encova_finance_statement_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_STATEMENT_RETAINED' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 OR NEW.state<>(CASE WHEN TG_TABLE_NAME='FinanceStatementUpload' THEN 'UPLOADING' ELSE 'DRAFT' END) THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;RETURN NEW;END IF;
 IF ROW(NEW.id,NEW."createdById",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."createdById",OLD."createdAt") OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
 IF TG_TABLE_NAME='FinanceStatementUpload' THEN
  IF OLD.state<>'UPLOADING' OR(to_jsonb(NEW)-ARRAY['intentHash','intentVerifiedAt','state','resultBatchId','version','updatedAt']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['intentHash','intentVerifiedAt','state','resultBatchId','version','updatedAt']) THEN RAISE EXCEPTION 'FINANCE_STATEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
 ELSE
  IF OLD.state='VOIDED' OR(OLD.state='DRAFT' AND NEW.state<>'IMPORTED') OR(OLD.state='IMPORTED' AND NEW.state<>'VOIDED') OR(to_jsonb(NEW)-ARRAY['state','sourceSnapshot','version','updatedAt']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','sourceSnapshot','version','updatedAt']) OR(OLD.state='IMPORTED' AND NEW."sourceSnapshot" IS DISTINCT FROM OLD."sourceSnapshot") THEN RAISE EXCEPTION 'FINANCE_STATEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceStatementUpload_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceStatementUpload" FOR EACH ROW EXECUTE FUNCTION encova_finance_statement_guard();
CREATE TRIGGER "FinanceStatementBatch_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceStatementBatch" FOR EACH ROW EXECUTE FUNCTION encova_finance_statement_guard();
CREATE FUNCTION encova_finance_statement_chunk_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE u public."FinanceStatementUpload"%ROWTYPE;BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'FINANCE_STATEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
 SELECT * INTO u FROM public."FinanceStatementUpload" WHERE id=NEW."uploadId" FOR UPDATE;
 IF u.id IS NULL OR u.state<>'UPLOADING' OR NEW.index>=ceil(u."byteSize"/2097152.0)::integer OR octet_length(NEW.bytes)<>least(2097152,u."byteSize"-NEW.index*2097152) OR NEW.sha256<>encode(sha256(NEW.bytes),'hex') THEN RAISE EXCEPTION 'FINANCE_STATEMENT_FILE' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceStatementChunk_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceStatementChunk" FOR EACH ROW EXECUTE FUNCTION encova_finance_statement_chunk_guard();
CREATE FUNCTION encova_finance_statement_line_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE b public."FinanceStatementBatch"%ROWTYPE;BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'FINANCE_STATEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
 SELECT * INTO b FROM public."FinanceStatementBatch" WHERE id=NEW."batchId";
 IF b.id IS NULL OR b.state<>'DRAFT' OR NEW."valueDate" NOT BETWEEN b."startDate" AND b."endDate" OR NEW."sourceRow"<>NEW.sequence+(b.mapping->>'skipRows')::integer+1 OR NEW.fingerprint<>public.encova_finance_statement_fingerprint(b."cashAccountId",NEW."valueDate",NEW.direction,NEW.amount,NEW.description,NEW."bankReference") THEN RAISE EXCEPTION 'FINANCE_STATEMENT_SOURCE' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceStatementLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceStatementLine" FOR EACH ROW EXECUTE FUNCTION encova_finance_statement_line_guard();
CREATE FUNCTION encova_finance_statement_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE b public."FinanceStatementBatch"%ROWTYPE;u public."FinanceStatementUpload"%ROWTYPE;stats RECORD;BEGIN
 IF TG_TABLE_NAME='FinanceStatementUpload' THEN
  SELECT * INTO u FROM public."FinanceStatementUpload" WHERE id=NEW.id;
  IF u.state='IMPORTED' AND NOT EXISTS(SELECT 1 FROM public."FinanceStatementBatch" WHERE id=u."resultBatchId" AND "cashAccountId"=u."cashAccountId" AND sha256=u.sha256 AND state IN('IMPORTED','VOIDED')) THEN RAISE EXCEPTION 'FINANCE_STATEMENT_SOURCE' USING ERRCODE='P0001';END IF;RETURN NULL;
 END IF;
 SELECT * INTO b FROM public."FinanceStatementBatch" WHERE id=NEW.id;SELECT * INTO u FROM public."FinanceStatementUpload" WHERE id=b."uploadId";
 IF b.state='DRAFT' OR ROW(b."cashAccountId",b."glAccountId",b.sha256,b."replacesId") IS DISTINCT FROM ROW(u."cashAccountId",u."glAccountId",u.sha256,u."replacesId") OR u.state<>'IMPORTED' OR u."resultBatchId" IS DISTINCT FROM b.id OR b."sourceSnapshot" IS DISTINCT FROM public.encova_finance_statement_snapshot(b.id) THEN RAISE EXCEPTION 'FINANCE_STATEMENT_SOURCE' USING ERRCODE='P0001';END IF;
 PERFORM public.encova_finance_statement_file_check(u.id);PERFORM public.encova_finance_statement_mapping(b.mapping);
 SELECT count(*) AS n,max(l.sequence) AS last_sequence,coalesce(sum(l.amount) FILTER(WHERE l.direction='RECEIPT'),0) AS receipts,coalesce(sum(l.amount) FILTER(WHERE l.direction='PAYMENT'),0) AS payments,encode(sha256(convert_to(jsonb_agg(jsonb_build_object('sequence',l.sequence,'sourceRow',l."sourceRow",'valueDate',l."valueDate",'direction',l.direction,'amount',l.amount::text,'description',l.description,'bankReference',l."bankReference",'fingerprint',l.fingerprint) ORDER BY l.sequence)::text,'UTF8')),'hex') AS digest INTO stats FROM public."FinanceStatementLine" l WHERE l."batchId"=b.id;
 IF stats.n<>b."rowCount" OR stats.last_sequence<>stats.n OR stats.receipts<>b.receipts OR stats.payments<>b.payments OR stats.digest IS DISTINCT FROM b."rowDigest" THEN RAISE EXCEPTION 'FINANCE_STATEMENT_SOURCE' USING ERRCODE='P0001';END IF;
 IF b."replacesId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."FinanceStatementBatch" p WHERE p.id=b."replacesId" AND p.state='VOIDED' AND p."cashAccountId"=b."cashAccountId" AND p.sha256=b.sha256) THEN RAISE EXCEPTION 'FINANCE_STATEMENT_REPLACEMENT' USING ERRCODE='P0001';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FinanceStatementUpload_valid" AFTER INSERT OR UPDATE ON "FinanceStatementUpload" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_statement_check();
CREATE CONSTRAINT TRIGGER "FinanceStatementBatch_valid" AFTER INSERT OR UPDATE ON "FinanceStatementBatch" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_statement_check();

CREATE FUNCTION encova_finance_statement_preview(actor UUID,input JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE u public."FinanceStatementUpload"%ROWTYPE;BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['id','metadata','rows']<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 SELECT * INTO u FROM public."FinanceStatementUpload" WHERE id=(input->>'id')::uuid;
 IF u.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
 IF u."createdById"<>actor THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF u.state<>'UPLOADING' THEN RAISE EXCEPTION 'FINANCE_STATEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
 RETURN public.encova_finance_statement_evaluate(u.id,input->'metadata',input->'rows');
 EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;
CREATE FUNCTION encova_finance_statement_transport(actor UUID,input JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE u public."FinanceStatementUpload"%ROWTYPE;c public."FinanceStatementChunk"%ROWTYPE;content BYTEA;chunk_index INTEGER;BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['id','index','content','sha256','intentHash']<>'{}'::jsonb OR jsonb_typeof(input->'index') IS DISTINCT FROM 'number' OR EXISTS(SELECT 1 FROM unnest(ARRAY['content','sha256','intentHash'])k WHERE jsonb_typeof(input->k) IS DISTINCT FROM 'string') OR length(input->>'content') NOT BETWEEN 4 AND 2796204 OR input->>'content'!~'^[A-Za-z0-9+/]*={0,2}$' OR input->>'sha256'!~'^[0-9a-f]{64}$' OR input->>'intentHash'!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(629815);SELECT * INTO u FROM public."FinanceStatementUpload" WHERE id=(input->>'id')::uuid FOR UPDATE;
 IF u.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
 IF u."createdById"<>actor OR u."intentHash" IS DISTINCT FROM input->>'intentHash' OR u."intentVerifiedAt"<CURRENT_TIMESTAMP-interval '5 minutes' OR u."intentVerifiedAt">CURRENT_TIMESTAMP+interval '5 seconds' OR u.state<>'UPLOADING' THEN RAISE EXCEPTION 'FINANCE_STATEMENT_UPLOAD_EXPIRED' USING ERRCODE='P0001';END IF;
 chunk_index:=(input->>'index')::integer;content:=decode(input->>'content','base64');
 IF chunk_index NOT BETWEEN 0 AND 2 OR chunk_index>=ceil(u."byteSize"/2097152.0)::integer OR octet_length(content)<>least(2097152,u."byteSize"-chunk_index*2097152) OR encode(sha256(content),'hex') IS DISTINCT FROM input->>'sha256' THEN RAISE EXCEPTION 'FINANCE_STATEMENT_FILE' USING ERRCODE='P0001';END IF;
 SELECT * INTO c FROM public."FinanceStatementChunk" WHERE "uploadId"=u.id AND index=chunk_index;
 IF c."uploadId" IS NOT NULL THEN IF c.sha256 IS DISTINCT FROM input->>'sha256' THEN RAISE EXCEPTION 'FINANCE_STATEMENT_CHUNK_CONFLICT' USING ERRCODE='P0001';END IF;RETURN jsonb_build_object('index',chunk_index,'sha256',c.sha256,'version',u.version,'uploaded',true);END IF;
 INSERT INTO public."FinanceStatementChunk"("uploadId",index,bytes,sha256) VALUES(u.id,chunk_index,content,input->>'sha256');
 UPDATE public."FinanceStatementUpload" SET version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=u.id RETURNING * INTO u;
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_STATEMENT_CHUNK','FinanceStatementUpload',u.id,'Transfer bounded data for the explicitly reserved statement',jsonb_build_object('index',chunk_index,'sha256',input->>'sha256','bytes',octet_length(content),'version',u.version),gen_random_uuid());
 RETURN jsonb_build_object('index',chunk_index,'sha256',input->>'sha256','version',u.version,'uploaded',true);
 EXCEPTION WHEN data_exception OR check_violation OR not_null_violation OR foreign_key_violation THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;
CREATE FUNCTION encova_finance_statement_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u public."FinanceStatementUpload"%ROWTYPE;b public."FinanceStatementBatch"%ROWTYPE;p public."FinanceStatementBatch"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;bank public."FinanceCashAccount"%ROWTYPE;reason TEXT;digest TEXT;result JSONB;metadata JSONB;evaluated JSONB;ack INTEGER[];required_ack INTEGER[];allowed TEXT[];entity_id UUID;entity_type TEXT;
BEGIN
 IF action IS NULL OR action NOT IN('RESERVE','IMPORT','CANCEL','VOID') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 allowed:=CASE WHEN action='RESERVE' THEN ARRAY['cashAccountId','fileName','byteSize','sha256','replacesId','reason','intentHash'] WHEN action='IMPORT' THEN ARRAY['id','expectedVersion','basisHash','mapping','startDate','endDate','openingBalance','closingBalance','currency','acknowledgedRows','duplicateReview','reason','rows'] ELSE ARRAY['id','expectedVersion','reason'] END;
 reason:=trim(input->>'reason');IF jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR length(reason) NOT BETWEEN 3 AND 500 OR input-allowed<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 digest:=encode(sha256(convert_to(jsonb_strip_nulls(input-'intentHash')::text,'UTF8')),'hex');SELECT * INTO r FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation='STMT_'||action AND key=request_key;
 PERFORM pg_advisory_xact_lock(629815);
 IF r.id IS NOT NULL THEN
  IF r."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;
  IF action='RESERVE' AND r.result->>'uploadId' IS NOT NULL THEN
   SELECT * INTO u FROM public."FinanceStatementUpload" WHERE id=(r.result->>'uploadId')::uuid FOR UPDATE;
   IF u.state='UPLOADING' AND u."createdById"=actor THEN
    UPDATE public."FinanceStatementUpload" SET "intentHash"=input->>'intentHash',"intentVerifiedAt"=verified_at,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=u.id;
    INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_STATEMENT_UPLOAD_REAUTHORIZED','FinanceStatementUpload',u.id,reason,jsonb_build_object('fileSha256',u.sha256),request_id);
   END IF;
  END IF;RETURN r.result;
 END IF;
 IF action='RESERVE' THEN
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['fileName','sha256','intentHash'])k WHERE jsonb_typeof(input->k) IS DISTINCT FROM 'string') OR jsonb_typeof(input->'byteSize') IS DISTINCT FROM 'number' OR(input->>'byteSize')::integer NOT BETWEEN 1 AND 5000000 OR input->>'sha256'!~'^[0-9a-f]{64}$' OR input->>'intentHash'!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  SELECT * INTO b FROM public."FinanceStatementBatch" WHERE "cashAccountId"=(input->>'cashAccountId')::uuid AND sha256=input->>'sha256' AND state='IMPORTED';
  IF b.id IS NOT NULL THEN result:=jsonb_build_object('batchId',b.id,'uploadId',NULL,'reused',true,'retainedVoided',false);END IF;
  IF result IS NULL THEN
   IF input->>'replacesId' IS NOT NULL THEN
    SELECT * INTO p FROM public."FinanceStatementBatch" WHERE id=(input->>'replacesId')::uuid;
    IF p.id IS NULL OR p.state<>'VOIDED' OR p.sha256 IS DISTINCT FROM input->>'sha256' OR p."cashAccountId" IS DISTINCT FROM(input->>'cashAccountId')::uuid OR EXISTS(SELECT 1 FROM public."FinanceStatementBatch" WHERE "replacesId"=p.id) THEN RAISE EXCEPTION 'FINANCE_STATEMENT_REPLACEMENT' USING ERRCODE='P0001';END IF;
   ELSE
    SELECT * INTO b FROM public."FinanceStatementBatch" WHERE "cashAccountId"=(input->>'cashAccountId')::uuid AND sha256=input->>'sha256' AND state='VOIDED' ORDER BY "createdAt" DESC,id DESC LIMIT 1;
    IF b.id IS NOT NULL THEN result:=jsonb_build_object('batchId',b.id,'uploadId',NULL,'reused',true,'retainedVoided',true);END IF;
   END IF;
  END IF;
  IF result IS NULL THEN
   SELECT c.* INTO bank FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" a ON a.id=c."glAccountId" WHERE c.id=(input->>'cashAccountId')::uuid AND c.active AND c.currency='PKR' AND a.active AND a."isPosting" AND a.currency='PKR' AND a."controlType"='CASH';
   IF bank.id IS NULL THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
   SELECT * INTO u FROM public."FinanceStatementUpload" WHERE "cashAccountId"=bank.id AND sha256=input->>'sha256' AND "replacesId" IS NOT DISTINCT FROM p.id AND "createdById"=actor AND state='UPLOADING' FOR UPDATE;
   IF u.id IS NOT NULL THEN
    IF u."byteSize"<>(input->>'byteSize')::integer OR u."fileName" IS DISTINCT FROM input->>'fileName' OR u."glAccountId"<>bank."glAccountId" THEN RAISE EXCEPTION 'FINANCE_STATEMENT_RESERVATION' USING ERRCODE='P0001';END IF;
    UPDATE public."FinanceStatementUpload" SET "intentHash"=input->>'intentHash',"intentVerifiedAt"=verified_at,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=u.id RETURNING * INTO u;
   ELSE
    INSERT INTO public."FinanceStatementUpload"(id,"cashAccountId","glAccountId","fileName","byteSize",sha256,"replacesId","intentHash","intentVerifiedAt","createdById") VALUES(gen_random_uuid(),bank.id,bank."glAccountId",input->>'fileName',(input->>'byteSize')::integer,input->>'sha256',p.id,input->>'intentHash',verified_at,actor) RETURNING * INTO u;
   END IF;result:=jsonb_build_object('uploadId',u.id,'batchId',NULL,'reused',false,'retainedVoided',false);
  END IF;
 ELSIF action='VOID' THEN
  SELECT * INTO b FROM public."FinanceStatementBatch" WHERE id=(input->>'id')::uuid FOR UPDATE;IF b.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR b.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF b.state<>'IMPORTED' THEN RAISE EXCEPTION 'FINANCE_STATEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
  UPDATE public."FinanceStatementBatch" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=b.id RETURNING * INTO b;result:=jsonb_build_object('id',b.id,'number',b.number,'version',b.version,'reused',false);
 ELSE
  SELECT * INTO u FROM public."FinanceStatementUpload" WHERE id=(input->>'id')::uuid FOR UPDATE;IF u.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF u."createdById"<>actor THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF action='CANCEL' THEN
   IF u.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
   IF u.state<>'UPLOADING' THEN RAISE EXCEPTION 'FINANCE_STATEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
   UPDATE public."FinanceStatementUpload" SET state='CANCELLED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=u.id RETURNING * INTO u;result:=jsonb_build_object('id',u.id,'version',u.version,'reused',false);
  ELSE
   IF u.state NOT IN('UPLOADING','IMPORTED') THEN RAISE EXCEPTION 'FINANCE_STATEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
   metadata:=input-ARRAY['id','expectedVersion','basisHash','acknowledgedRows','duplicateReview','reason','rows'];evaluated:=public.encova_finance_statement_evaluate(u.id,metadata,input->'rows');
   SELECT * INTO b FROM public."FinanceStatementBatch" WHERE "cashAccountId"=u."cashAccountId" AND sha256=u.sha256 AND state='IMPORTED';
   IF b.id IS NOT NULL THEN
    IF b."glAccountId"<>u."glAccountId" OR b.mapping IS DISTINCT FROM metadata->'mapping' OR b."startDate"<>(metadata->>'startDate')::date OR b."endDate"<>(metadata->>'endDate')::date OR b."openingBalance"<>(metadata->>'openingBalance')::numeric OR b."closingBalance"<>(metadata->>'closingBalance')::numeric OR b."rowDigest" IS DISTINCT FROM evaluated->>'rowDigest' THEN RAISE EXCEPTION 'FINANCE_STATEMENT_REIMPORT_CONFLICT' USING ERRCODE='P0001';END IF;
    IF u.state='UPLOADING' THEN
     IF u.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
     UPDATE public."FinanceStatementUpload" SET state='IMPORTED',"resultBatchId"=b.id,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=u.id;
    END IF;result:=jsonb_build_object('id',b.id,'number',b.number,'version',b.version,'uploadId',u.id,'reused',true);
   ELSE
    IF u.state<>'UPLOADING' THEN RAISE EXCEPTION 'FINANCE_STATEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
    IF u.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
    IF input->>'basisHash' IS DISTINCT FROM evaluated->>'basisHash' THEN RAISE EXCEPTION 'FINANCE_STATEMENT_STALE_PREVIEW' USING ERRCODE='P0001';END IF;
    IF evaluated->>'balanced' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FINANCE_STATEMENT_EQUATION' USING ERRCODE='P0001';END IF;
    IF jsonb_typeof(input->'acknowledgedRows') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'acknowledgedRows')>5000 OR jsonb_typeof(input->'duplicateReview') IS DISTINCT FROM 'string' OR length(input->>'duplicateReview')>1000 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
    SELECT coalesce(array_agg((value->>'sourceRow')::integer ORDER BY(value->>'sourceRow')::integer),ARRAY[]::INTEGER[]) INTO required_ack FROM jsonb_array_elements(evaluated->'duplicates');
    SELECT coalesce(array_agg(value::text::integer ORDER BY value::text::integer),ARRAY[]::INTEGER[]) INTO ack FROM jsonb_array_elements(input->'acknowledgedRows');
    IF ack IS DISTINCT FROM required_ack OR(cardinality(required_ack)>0 AND length(trim(input->>'duplicateReview'))<3) THEN RAISE EXCEPTION 'FINANCE_STATEMENT_DUPLICATES' USING ERRCODE='P0001';END IF;
    IF NOT EXISTS(SELECT 1 FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" a ON a.id=c."glAccountId" WHERE c.id=u."cashAccountId" AND c."glAccountId"=u."glAccountId" AND c.active AND a.active AND c.currency='PKR' AND a.currency='PKR' AND a."isPosting" AND a."controlType"='CASH') THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
    IF u."replacesId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."FinanceStatementBatch" prior_batch WHERE prior_batch.id=u."replacesId" AND prior_batch.state='VOIDED' AND prior_batch."cashAccountId"=u."cashAccountId" AND prior_batch.sha256=u.sha256 AND NOT EXISTS(SELECT 1 FROM public."FinanceStatementBatch" child WHERE child."replacesId"=prior_batch.id)) THEN RAISE EXCEPTION 'FINANCE_STATEMENT_REPLACEMENT' USING ERRCODE='P0001';END IF;
    INSERT INTO public."FinanceStatementBatch"(id,number,"uploadId","cashAccountId","glAccountId",sha256,"importKey","parserVersion",mapping,"startDate","endDate","openingBalance","closingBalance",receipts,payments,"rowCount","rowDigest","sourceSnapshot","duplicateReview","duplicateSnapshot","replacesId","createdById") VALUES(gen_random_uuid(),'STMT-'||lpad(nextval('public.finance_statement_number')::text,10,'0'),u.id,u."cashAccountId",u."glAccountId",u.sha256,request_key,'ENCOVA_CSV_V1',metadata->'mapping',(metadata->>'startDate')::date,(metadata->>'endDate')::date,(metadata->>'openingBalance')::numeric,(metadata->>'closingBalance')::numeric,(evaluated->>'receipts')::numeric,(evaluated->>'payments')::numeric,(evaluated->>'rowCount')::integer,evaluated->>'rowDigest','{}'::jsonb,input->>'duplicateReview',evaluated->'duplicates',u."replacesId",actor) RETURNING * INTO b;
    INSERT INTO public."FinanceStatementLine"(id,"batchId",sequence,"sourceRow","valueDate",direction,amount,description,"bankReference",fingerprint) SELECT gen_random_uuid(),b.id,x.* FROM public.encova_finance_statement_rows(u.id,input->'rows',metadata->'mapping')x ORDER BY x.sequence;
    UPDATE public."FinanceStatementBatch" SET state='IMPORTED',"sourceSnapshot"=public.encova_finance_statement_snapshot(b.id),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=b.id RETURNING * INTO b;
    UPDATE public."FinanceStatementUpload" SET state='IMPORTED',"resultBatchId"=b.id,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=u.id;
    result:=jsonb_build_object('id',b.id,'number',b.number,'version',b.version,'uploadId',u.id,'reused',false);
   END IF;
  END IF;
 END IF;
 entity_id:=coalesce(b.id,u.id);entity_type:=CASE WHEN b.id IS NULL THEN 'FinanceStatementUpload' ELSE 'FinanceStatementBatch' END;
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,'STMT_'||action,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_STATEMENT_'||action,entity_type,entity_id,reason,CASE WHEN b.id IS NOT NULL THEN jsonb_build_object('source',public.encova_finance_statement_snapshot(b.id),'reused',result->'reused') ELSE jsonb_build_object('uploadId',u.id,'fileName',u."fileName",'fileSha256',u.sha256,'byteSize',u."byteSize",'cashAccountId',u."cashAccountId",'state',u.state,'version',u.version) END,request_id);RETURN result;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';WHEN data_exception OR check_violation OR not_null_violation OR foreign_key_violation THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;
DO $$ DECLARE t TEXT;f RECORD;role_name TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceStatementUpload','FinanceStatementChunk','FinanceStatementBatch','FinanceStatementLine'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,role_name);END IF;END LOOP;END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'encova_finance_statement_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);FOREACH role_name IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name);END IF;END LOOP;END LOOP;
 REVOKE ALL ON SEQUENCE public.finance_statement_number FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION public.encova_finance_statement_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID),public.encova_finance_statement_transport(UUID,JSONB),public.encova_finance_statement_preview(UUID,JSONB) TO encova_app;END IF;
END $$;
COMMIT;
