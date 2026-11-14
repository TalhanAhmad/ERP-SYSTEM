BEGIN;
CREATE SEQUENCE finance_project_variation_number AS BIGINT MINVALUE 1 MAXVALUE 9999999999 NO CYCLE;
CREATE SEQUENCE finance_billing_milestone_number AS BIGINT MINVALUE 1 MAXVALUE 9999999999 NO CYCLE;
CREATE TABLE "FinanceProjectProfile"(
 id UUID PRIMARY KEY,"projectId" UUID NOT NULL UNIQUE REFERENCES "Project" ON DELETE RESTRICT,"clientId" UUID NOT NULL REFERENCES "FinanceParty" ON DELETE RESTRICT,"originalContract" NUMERIC(20,2) NOT NULL CHECK("originalContract">=0),currency TEXT NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),"billingModel" TEXT NOT NULL CHECK("billingModel" IN('FIXED_PRICE','TIME_BASED','RETAINER','MILESTONE')),terms TEXT NOT NULL CHECK(length(trim(terms)) BETWEEN 3 AND 1000),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),"signedDate" DATE CHECK("signedDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),"approvalEvidence" TEXT,"contractSnapshot" JSONB,state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','ACTIVE','CLOSED','CANCELLED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK((state IN('ACTIVE','CLOSED'))=("signedDate" IS NOT NULL AND "approvalEvidence" IS NOT NULL AND "contractSnapshot" IS NOT NULL))
);
CREATE INDEX "FinanceProjectProfile_state_projectId_idx" ON "FinanceProjectProfile"(state,"projectId");
CREATE TABLE "FinanceProjectVariation"(
 id UUID PRIMARY KEY,number TEXT NOT NULL UNIQUE,"profileId" UUID NOT NULL REFERENCES "FinanceProjectProfile" ON DELETE RESTRICT,direction TEXT NOT NULL CHECK(direction IN('INCREASE','DECREASE')),amount NUMERIC(20,2) NOT NULL CHECK(amount>0),reference TEXT NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 80),description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 1000),"signedDate" DATE NOT NULL CHECK("signedDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),"approvalEvidence" TEXT,"approvedAt" TIMESTAMPTZ,"approvedById" UUID REFERENCES "Person" ON DELETE RESTRICT,state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','APPROVED','VOIDED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK((state='APPROVED')=("approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL AND "approvalEvidence" IS NOT NULL))
);
CREATE INDEX "FinanceProjectVariation_profileId_createdAt_id_idx" ON "FinanceProjectVariation"("profileId","createdAt",id);
CREATE TABLE "FinanceBillingMilestone"(
 id UUID PRIMARY KEY,number TEXT NOT NULL UNIQUE,"profileId" UUID NOT NULL REFERENCES "FinanceProjectProfile" ON DELETE RESTRICT,description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 1000),amount NUMERIC(20,2) NOT NULL CHECK(amount>0),"expectedDate" DATE NOT NULL CHECK("expectedDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),"dueDate" DATE NOT NULL CHECK("dueDate" BETWEEN "expectedDate" AND DATE '9999-12-31'),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),"approvalEvidence" TEXT,"confirmedAt" TIMESTAMPTZ,"confirmedById" UUID REFERENCES "Person" ON DELETE RESTRICT,state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','CONFIRMED','CANCELLED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK(("confirmedAt" IS NULL AND "confirmedById" IS NULL AND "approvalEvidence" IS NULL) OR("confirmedAt" IS NOT NULL AND "confirmedById" IS NOT NULL AND length(trim("approvalEvidence")) BETWEEN 3 AND 1000)),CHECK(state<>'CONFIRMED' OR "confirmedAt" IS NOT NULL)
);
CREATE INDEX "FinanceBillingMilestone_profileId_expectedDate_id_idx" ON "FinanceBillingMilestone"("profileId","expectedDate",id);
CREATE TABLE "FinanceMilestoneInvoiceLink"(
 id UUID PRIMARY KEY,"milestoneId" UUID NOT NULL REFERENCES "FinanceBillingMilestone" ON DELETE RESTRICT,"invoiceLineId" UUID NOT NULL REFERENCES "FinanceInvoiceLine" ON DELETE RESTRICT,"originalNet" NUMERIC(20,2) NOT NULL CHECK("originalNet">0),snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object'),state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(state IN('ACTIVE','RELEASED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"releasedAt" TIMESTAMPTZ,"releasedById" UUID REFERENCES "Person" ON DELETE RESTRICT,"releaseReason" TEXT,"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK((state='RELEASED')=("releasedAt" IS NOT NULL AND "releasedById" IS NOT NULL AND length(trim("releaseReason")) BETWEEN 3 AND 500))
);
CREATE UNIQUE INDEX "FinanceMilestoneInvoiceLink_active_line_key" ON "FinanceMilestoneInvoiceLink"("invoiceLineId") WHERE state='ACTIVE';
CREATE INDEX "FinanceMilestoneInvoiceLink_milestoneId_createdAt_id_idx" ON "FinanceMilestoneInvoiceLink"("milestoneId","createdAt",id);
CREATE FUNCTION encova_finance_project_contract(target UUID) RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT p."originalContract"+coalesce(sum(CASE WHEN v.direction='INCREASE' THEN v.amount ELSE -v.amount END) FILTER(WHERE v.state='APPROVED'),0) FROM public."FinanceProjectProfile" p LEFT JOIN public."FinanceProjectVariation" v ON v."profileId"=p.id WHERE p.id=target GROUP BY p.id $$;
CREATE FUNCTION encova_finance_project_source_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_RETAINED' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 OR NEW.state<>(CASE WHEN TG_TABLE_NAME='FinanceMilestoneInvoiceLink' THEN 'ACTIVE' ELSE 'DRAFT' END) THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;RETURN NEW;END IF;
 IF ROW(NEW.id,NEW."createdById",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."createdById",OLD."createdAt") OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
 IF TG_TABLE_NAME='FinanceProjectProfile' THEN
  IF NEW."projectId"<>OLD."projectId" OR(OLD.state IN('ACTIVE','CLOSED') AND(to_jsonb(NEW)-ARRAY['state','version','updatedAt']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','updatedAt'])) THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_IMMUTABLE' USING ERRCODE='P0001';END IF;
 ELSIF TG_TABLE_NAME='FinanceMilestoneInvoiceLink' THEN
  IF OLD.state<>'ACTIVE' OR NEW.state<>'RELEASED' OR(to_jsonb(NEW)-ARRAY['state','version','updatedAt','releasedAt','releasedById','releaseReason']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','updatedAt','releasedAt','releasedById','releaseReason']) THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_IMMUTABLE' USING ERRCODE='P0001';END IF;
 ELSE
  IF ROW(NEW.number,NEW."profileId") IS DISTINCT FROM ROW(OLD.number,OLD."profileId") OR OLD.state IN('APPROVED','VOIDED','CANCELLED') OR(OLD.state='CONFIRMED' AND(NEW.state<>'CANCELLED' OR(to_jsonb(NEW)-ARRAY['state','version','updatedAt']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','updatedAt']))) THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_IMMUTABLE' USING ERRCODE='P0001';END IF;
 END IF;RETURN NEW;
END $$;
CREATE FUNCTION encova_finance_project_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE target UUID;total NUMERIC;BEGIN
 IF TG_TABLE_NAME='FinanceProjectProfile' THEN target:=NEW.id;ELSE target:=NEW."profileId";END IF;
 total:=public.encova_finance_project_contract(target);
 IF total<0 OR total>999999999999999999.99 THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_CAPACITY' USING ERRCODE='P0001';END IF;RETURN NULL;
END $$;
DO $$ DECLARE t TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceProjectProfile','FinanceProjectVariation','FinanceBillingMilestone','FinanceMilestoneInvoiceLink'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.encova_finance_project_source_guard()',t||'_guard',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.encova_finance_config_lock()',t||'_config',t);
 END LOOP;
END $$;
CREATE CONSTRAINT TRIGGER "FinanceProjectProfile_total_valid" AFTER INSERT OR UPDATE ON "FinanceProjectProfile" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_project_check();
CREATE CONSTRAINT TRIGGER "FinanceProjectVariation_total_valid" AFTER INSERT OR UPDATE ON "FinanceProjectVariation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_project_check();
ALTER TABLE "FinanceProjectProfile" ADD CHECK("approvalEvidence" IS NULL OR length(trim("approvalEvidence")) BETWEEN 3 AND 1000);
ALTER TABLE "FinanceProjectVariation" ADD CHECK("approvalEvidence" IS NULL OR length(trim("approvalEvidence")) BETWEEN 3 AND 1000);
ALTER TABLE "FinanceBillingMilestone" ADD CHECK(num_nonnulls("confirmedAt","confirmedById","approvalEvidence")=0 OR(num_nonnulls("confirmedAt","confirmedById","approvalEvidence")=3 AND length(trim("approvalEvidence")) BETWEEN 3 AND 1000));
ALTER TABLE "FinanceMilestoneInvoiceLink" ADD CHECK((state='ACTIVE' AND num_nonnulls("releasedAt","releasedById","releaseReason")=0)OR(state='RELEASED' AND num_nonnulls("releasedAt","releasedById","releaseReason")=3 AND length(trim("releaseReason")) BETWEEN 3 AND 500));
CREATE UNIQUE INDEX "FinanceProjectVariation_profileId_reference_key" ON "FinanceProjectVariation"("profileId",lower(btrim(reference))) WHERE state<>'VOIDED';
CREATE FUNCTION encova_finance_project_line_snapshot(target UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT jsonb_build_object('invoiceLineId',l.id,'invoiceId',i.id,'invoiceNumber',i.number,'sequence',l.sequence,'projectId',l."projectId",'partyId',i."partyId",'netAmount',l."netAmount"::text,'taxAmount',l."taxAmount"::text,'totalAmount',l."totalAmount"::text,'postingDate',i."postingDate",'currency',i.currency) FROM public."FinanceInvoiceLine" l JOIN public."FinanceInvoice" i ON i.id=l."invoiceId" WHERE l.id=target $$;
CREATE FUNCTION encova_finance_project_link_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE l public."FinanceMilestoneInvoiceLink"%ROWTYPE;p public."FinanceProjectProfile"%ROWTYPE;m public."FinanceBillingMilestone"%ROWTYPE;source RECORD;BEGIN
 IF TG_TABLE_NAME='FinanceBillingMilestone' THEN IF NEW.state<>'CONFIRMED' AND EXISTS(SELECT 1 FROM public."FinanceMilestoneInvoiceLink" WHERE "milestoneId"=NEW.id AND state='ACTIVE') THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_LINKED' USING ERRCODE='P0001';END IF;RETURN NULL;END IF;
 SELECT * INTO l FROM public."FinanceMilestoneInvoiceLink" WHERE id=NEW.id;SELECT * INTO m FROM public."FinanceBillingMilestone" WHERE id=l."milestoneId";SELECT * INTO p FROM public."FinanceProjectProfile" WHERE id=m."profileId";
 SELECT line."netAmount",line."projectId",i."partyId",i.state,i.currency INTO source FROM public."FinanceInvoiceLine" line JOIN public."FinanceInvoice" i ON i.id=line."invoiceId" WHERE line.id=l."invoiceLineId";
 IF source.state IS DISTINCT FROM 'POSTED' OR source.currency IS DISTINCT FROM 'PKR' OR source."projectId" IS DISTINCT FROM p."projectId" OR source."partyId" IS DISTINCT FROM p."clientId" OR l."originalNet" IS DISTINCT FROM source."netAmount" OR l.snapshot IS DISTINCT FROM public.encova_finance_project_line_snapshot(l."invoiceLineId") OR(l.state='ACTIVE' AND m.state<>'CONFIRMED') THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_SOURCE' USING ERRCODE='P0001';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FinanceMilestoneInvoiceLink_valid" AFTER INSERT OR UPDATE ON "FinanceMilestoneInvoiceLink" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_project_link_check();
CREATE CONSTRAINT TRIGGER "FinanceBillingMilestone_links_valid" AFTER INSERT OR UPDATE ON "FinanceBillingMilestone" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_project_link_check();
CREATE FUNCTION encova_finance_project_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public."FinanceProjectProfile"%ROWTYPE;v public."FinanceProjectVariation"%ROWTYPE;m public."FinanceBillingMilestone"%ROWTYPE;l public."FinanceMilestoneInvoiceLink"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;allowed TEXT[];reason TEXT;digest TEXT;target UUID;entity TEXT;result JSONB;source RECORD;after_value JSONB;before_value JSONB;business_today DATE:=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date;
BEGIN
 IF action IS NULL OR action NOT IN('PROFILE_CREATE','PROFILE_UPDATE','PROFILE_ACTIVATE','PROFILE_CLOSE','PROFILE_REOPEN','PROFILE_CANCEL','VARIATION_CREATE','VARIATION_UPDATE','VARIATION_APPROVE','VARIATION_VOID','MILESTONE_CREATE','MILESTONE_UPDATE','MILESTONE_CONFIRM','MILESTONE_CANCEL','LINK_CREATE','LINK_RELEASE') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 allowed:=CASE WHEN action='PROFILE_CREATE' THEN ARRAY['projectId','clientId','originalContract','billingModel','terms','evidence','reason'] WHEN action='PROFILE_UPDATE' THEN ARRAY['id','expectedVersion','clientId','originalContract','billingModel','terms','evidence','reason'] WHEN action='PROFILE_ACTIVATE' THEN ARRAY['id','expectedVersion','signedDate','approvalEvidence','reason'] WHEN action='VARIATION_CREATE' THEN ARRAY['projectId','direction','amount','reference','description','signedDate','evidence','reason'] WHEN action='VARIATION_UPDATE' THEN ARRAY['id','expectedVersion','direction','amount','reference','description','signedDate','evidence','reason'] WHEN action='VARIATION_APPROVE' THEN ARRAY['id','expectedVersion','approvalEvidence','reason'] WHEN action='MILESTONE_CREATE' THEN ARRAY['projectId','description','amount','expectedDate','dueDate','evidence','reason'] WHEN action='MILESTONE_UPDATE' THEN ARRAY['id','expectedVersion','description','amount','expectedDate','dueDate','evidence','reason'] WHEN action='MILESTONE_CONFIRM' THEN ARRAY['id','expectedVersion','approvalEvidence','reason'] WHEN action='LINK_CREATE' THEN ARRAY['milestoneId','invoiceLineId','reason'] ELSE ARRAY['id','expectedVersion','reason'] END;
 reason:=trim(input->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 OR input-allowed<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF input?'originalContract' AND(jsonb_typeof(input->'originalContract') IS DISTINCT FROM 'string' OR input->>'originalContract' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$') OR input?'amount' AND(jsonb_typeof(input->'amount') IS DISTINCT FROM 'string' OR input->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 digest:=encode(sha256(convert_to(jsonb_strip_nulls(input)::text,'UTF8')),'hex');SELECT * INTO r FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation='COMMERCIAL_'||action AND key=request_key;
 IF FOUND THEN IF r."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN r.result;END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action='PROFILE_CREATE' THEN
  IF NOT EXISTS(SELECT 1 FROM public."Project" WHERE id=(input->>'projectId')::uuid) OR NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=(input->>'clientId')::uuid AND active AND kind IN('CLIENT','BOTH')) THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_SOURCE' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinanceProjectProfile"(id,"projectId","clientId","originalContract","billingModel",terms,evidence,"createdById") VALUES(gen_random_uuid(),(input->>'projectId')::uuid,(input->>'clientId')::uuid,(input->>'originalContract')::numeric,input->>'billingModel',input->>'terms',input->>'evidence',actor) RETURNING * INTO p;
 ELSIF action LIKE 'PROFILE_%' THEN
  SELECT * INTO p FROM public."FinanceProjectProfile" WHERE "projectId"=(input->>'id')::uuid FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;before_value:=to_jsonb(p)||jsonb_build_object('originalContract',p."originalContract"::text);
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR p.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF action='PROFILE_UPDATE' THEN
   IF p.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_IMMUTABLE' USING ERRCODE='P0001';END IF;
   IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=(input->>'clientId')::uuid AND active AND kind IN('CLIENT','BOTH')) THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_SOURCE' USING ERRCODE='P0001';END IF;
   UPDATE public."FinanceProjectProfile" SET "clientId"=(input->>'clientId')::uuid,"originalContract"=(input->>'originalContract')::numeric,"billingModel"=input->>'billingModel',terms=input->>'terms',evidence=input->>'evidence',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=p.id RETURNING * INTO p;
  ELSIF action='PROFILE_ACTIVATE' THEN
   IF p.state<>'DRAFT' OR p."originalContract"<=0 OR(input->>'signedDate')::date>business_today OR length(trim(input->>'approvalEvidence')) NOT BETWEEN 3 AND 1000 OR NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=p."clientId" AND active AND kind IN('CLIENT','BOTH')) THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_REVIEW' USING ERRCODE='P0001';END IF;
   UPDATE public."FinanceProjectProfile" SET state='ACTIVE',"signedDate"=(input->>'signedDate')::date,"approvalEvidence"=input->>'approvalEvidence',"contractSnapshot"=jsonb_build_object('projectId',p."projectId",'projectName',(SELECT name FROM public."Project" WHERE id=p."projectId"),'client',(SELECT to_jsonb(c) FROM public."FinanceParty" c WHERE c.id=p."clientId"),'originalContract',p."originalContract"::text,'currency','PKR','billingModel',p."billingModel",'terms',p.terms,'evidence',p.evidence,'signedDate',(input->>'signedDate')::date,'approvalEvidence',input->>'approvalEvidence'),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=p.id RETURNING * INTO p;
  ELSE
   IF(action='PROFILE_CLOSE' AND p.state<>'ACTIVE') OR(action='PROFILE_CANCEL' AND p.state<>'DRAFT') OR(action='PROFILE_REOPEN' AND p.state NOT IN('CLOSED','CANCELLED')) THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_STATE' USING ERRCODE='P0001';END IF;
   UPDATE public."FinanceProjectProfile" SET state=CASE WHEN action='PROFILE_CLOSE' THEN 'CLOSED' WHEN action='PROFILE_CANCEL' THEN 'CANCELLED' WHEN p.state='CANCELLED' THEN 'DRAFT' ELSE 'ACTIVE' END,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=p.id RETURNING * INTO p;
  END IF;
 ELSIF action LIKE 'VARIATION_%' THEN
  IF action='VARIATION_CREATE' THEN
   SELECT * INTO p FROM public."FinanceProjectProfile" WHERE "projectId"=(input->>'projectId')::uuid FOR UPDATE;
  ELSE
   SELECT * INTO v FROM public."FinanceProjectVariation" WHERE id=(input->>'id')::uuid FOR UPDATE;IF v.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
   SELECT * INTO p FROM public."FinanceProjectProfile" WHERE id=v."profileId" FOR UPDATE;before_value:=to_jsonb(v)||jsonb_build_object('amount',v.amount::text);
   IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR v.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
   IF v.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_IMMUTABLE' USING ERRCODE='P0001';END IF;
  END IF;
  IF p.id IS NULL OR p.state<>'ACTIVE' THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_STATE' USING ERRCODE='P0001';END IF;
  IF action='VARIATION_CREATE' THEN
   INSERT INTO public."FinanceProjectVariation"(id,number,"profileId",direction,amount,reference,description,"signedDate",evidence,"createdById") VALUES(gen_random_uuid(),'VAR-'||lpad(nextval('public.finance_project_variation_number')::text,10,'0'),p.id,input->>'direction',(input->>'amount')::numeric,input->>'reference',input->>'description',(input->>'signedDate')::date,input->>'evidence',actor) RETURNING * INTO v;
  ELSIF action='VARIATION_UPDATE' THEN UPDATE public."FinanceProjectVariation" SET direction=input->>'direction',amount=(input->>'amount')::numeric,reference=input->>'reference',description=input->>'description',"signedDate"=(input->>'signedDate')::date,evidence=input->>'evidence',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=v.id RETURNING * INTO v;
  ELSIF action='VARIATION_APPROVE' THEN
   IF v."signedDate">business_today OR input->>'approvalEvidence' IS NULL OR length(trim(input->>'approvalEvidence')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_REVIEW' USING ERRCODE='P0001';END IF;
   UPDATE public."FinanceProjectVariation" SET state='APPROVED',"approvalEvidence"=input->>'approvalEvidence',"approvedAt"=CURRENT_TIMESTAMP,"approvedById"=actor,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=v.id RETURNING * INTO v;
  ELSE UPDATE public."FinanceProjectVariation" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=v.id RETURNING * INTO v;END IF;
 ELSIF action LIKE 'MILESTONE_%' THEN
  IF action='MILESTONE_CREATE' THEN SELECT * INTO p FROM public."FinanceProjectProfile" WHERE "projectId"=(input->>'projectId')::uuid FOR UPDATE;
  ELSE
   SELECT * INTO m FROM public."FinanceBillingMilestone" WHERE id=(input->>'id')::uuid FOR UPDATE;IF m.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
   SELECT * INTO p FROM public."FinanceProjectProfile" WHERE id=m."profileId" FOR UPDATE;before_value:=to_jsonb(m)||jsonb_build_object('amount',m.amount::text);
   IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR m.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
   IF m.state<>'DRAFT' AND NOT(action='MILESTONE_CANCEL' AND m.state='CONFIRMED') THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_IMMUTABLE' USING ERRCODE='P0001';END IF;
  END IF;
  IF p.id IS NULL OR(p.state<>'ACTIVE' AND NOT(action='MILESTONE_CANCEL' AND p.state='CLOSED')) THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_STATE' USING ERRCODE='P0001';END IF;
  IF action='MILESTONE_CREATE' THEN INSERT INTO public."FinanceBillingMilestone"(id,number,"profileId",description,amount,"expectedDate","dueDate",evidence,"createdById") VALUES(gen_random_uuid(),'MIL-'||lpad(nextval('public.finance_billing_milestone_number')::text,10,'0'),p.id,input->>'description',(input->>'amount')::numeric,(input->>'expectedDate')::date,(input->>'dueDate')::date,input->>'evidence',actor) RETURNING * INTO m;
  ELSIF action='MILESTONE_UPDATE' THEN UPDATE public."FinanceBillingMilestone" SET description=input->>'description',amount=(input->>'amount')::numeric,"expectedDate"=(input->>'expectedDate')::date,"dueDate"=(input->>'dueDate')::date,evidence=input->>'evidence',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=m.id RETURNING * INTO m;
  ELSIF action='MILESTONE_CONFIRM' THEN
   IF input->>'approvalEvidence' IS NULL OR length(trim(input->>'approvalEvidence')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_REVIEW' USING ERRCODE='P0001';END IF;
   UPDATE public."FinanceBillingMilestone" SET state='CONFIRMED',"approvalEvidence"=input->>'approvalEvidence',"confirmedAt"=CURRENT_TIMESTAMP,"confirmedById"=actor,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=m.id RETURNING * INTO m;
  ELSE
   IF EXISTS(SELECT 1 FROM public."FinanceMilestoneInvoiceLink" WHERE "milestoneId"=m.id AND state='ACTIVE') THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_LINKED' USING ERRCODE='P0001';END IF;
   UPDATE public."FinanceBillingMilestone" SET state='CANCELLED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=m.id RETURNING * INTO m;
  END IF;
 ELSE
  IF action='LINK_CREATE' THEN
   SELECT * INTO m FROM public."FinanceBillingMilestone" WHERE id=(input->>'milestoneId')::uuid FOR UPDATE;SELECT * INTO p FROM public."FinanceProjectProfile" WHERE id=m."profileId" FOR UPDATE;
   SELECT line.*,i."partyId",i.state AS "invoiceState",i.currency INTO source FROM public."FinanceInvoiceLine" line JOIN public."FinanceInvoice" i ON i.id=line."invoiceId" WHERE line.id=(input->>'invoiceLineId')::uuid;
   IF p.id IS NULL OR p.state NOT IN('ACTIVE','CLOSED') OR m.state<>'CONFIRMED' OR source.id IS NULL OR source."invoiceState"<>'POSTED' OR source.currency<>'PKR' OR source."netAmount"<=0 OR source."projectId" IS DISTINCT FROM p."projectId" OR source."partyId" IS DISTINCT FROM p."clientId" THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_SOURCE' USING ERRCODE='P0001';END IF;
   INSERT INTO public."FinanceMilestoneInvoiceLink"(id,"milestoneId","invoiceLineId","originalNet",snapshot,"createdById") VALUES(gen_random_uuid(),m.id,source.id,source."netAmount",public.encova_finance_project_line_snapshot(source.id),actor) RETURNING * INTO l;
  ELSE
   SELECT * INTO l FROM public."FinanceMilestoneInvoiceLink" WHERE id=(input->>'id')::uuid FOR UPDATE;IF l.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;before_value:=to_jsonb(l)||jsonb_build_object('originalNet',l."originalNet"::text);
   IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR l.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;IF l.state<>'ACTIVE' THEN RAISE EXCEPTION 'FINANCE_COMMERCIAL_IMMUTABLE' USING ERRCODE='P0001';END IF;
   UPDATE public."FinanceMilestoneInvoiceLink" SET state='RELEASED',"releasedAt"=CURRENT_TIMESTAMP,"releasedById"=actor,"releaseReason"=reason,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=l.id RETURNING * INTO l;
   SELECT * INTO m FROM public."FinanceBillingMilestone" WHERE id=l."milestoneId";SELECT * INTO p FROM public."FinanceProjectProfile" WHERE id=m."profileId";
  END IF;
 END IF;
 IF action LIKE 'PROFILE_%' THEN target:=p.id;entity:='FinanceProjectProfile';after_value:=to_jsonb(p)||jsonb_build_object('originalContract',p."originalContract"::text);result:=jsonb_build_object('id',p."projectId",'financeId',p.id,'version',p.version);
 ELSIF action LIKE 'VARIATION_%' THEN target:=v.id;entity:='FinanceProjectVariation';after_value:=to_jsonb(v)||jsonb_build_object('amount',v.amount::text);result:=jsonb_build_object('id',v.id,'projectId',p."projectId",'number',v.number,'version',v.version);
 ELSIF action LIKE 'MILESTONE_%' THEN target:=m.id;entity:='FinanceBillingMilestone';after_value:=to_jsonb(m)||jsonb_build_object('amount',m.amount::text);result:=jsonb_build_object('id',m.id,'projectId',p."projectId",'number',m.number,'version',m.version);
 ELSE target:=l.id;entity:='FinanceMilestoneInvoiceLink';after_value:=to_jsonb(l)||jsonb_build_object('originalNet',l."originalNet"::text);result:=jsonb_build_object('id',l.id,'projectId',p."projectId",'milestoneId',m.id,'version',l.version);END IF;
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,'COMMERCIAL_'||action,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_'||action,entity,target,reason,jsonb_build_object('before',before_value,'after',after_value),request_id);RETURN result;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;
DO $$ DECLARE t TEXT;f RECORD;role_name TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceProjectProfile','FinanceProjectVariation','FinanceBillingMilestone','FinanceMilestoneInvoiceLink'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,role_name);END IF;END LOOP;END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'encova_finance_project_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);FOREACH role_name IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name);END IF;END LOOP;END LOOP;
 REVOKE ALL ON SEQUENCE public.finance_project_variation_number,public.finance_billing_milestone_number FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION public.encova_finance_project_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID) TO encova_app;END IF;
END $$;
COMMIT;
