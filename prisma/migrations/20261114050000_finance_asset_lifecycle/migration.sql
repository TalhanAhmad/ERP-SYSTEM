BEGIN;
CREATE SEQUENCE finance_asset_movement_number AS BIGINT MINVALUE 1 MAXVALUE 9999999999 NO CYCLE;
CREATE TABLE "FinanceAssetMovement"(id UUID PRIMARY KEY,number TEXT NOT NULL UNIQUE,"assetId" UUID NOT NULL REFERENCES "FinanceAsset" ON DELETE RESTRICT,kind TEXT NOT NULL CHECK(kind IN('DEPRECIATION','IMPAIRMENT','ADJUSTMENT_INCREASE','ADJUSTMENT_DECREASE','DISPOSAL','POLICY_CHANGE','REVERSAL')),month TEXT CHECK(month~'^[0-9]{4}-(0[1-9]|1[0-2])$'),"postingDate" DATE NOT NULL CHECK("postingDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 1000),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),"approvalEvidence" TEXT NOT NULL CHECK(length(trim("approvalEvidence")) BETWEEN 3 AND 1000),amount NUMERIC(20,2) NOT NULL CHECK(amount>=0),"feeAmount" NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK("feeAmount">=0),"expenseAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,"accumulatedAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,"counterAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,"cashAccountId" UUID REFERENCES "FinanceCashAccount" ON DELETE RESTRICT,"gainAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,"lossAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,"feeAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,"newResidual" NUMERIC(20,2),"newLifeMonths" INTEGER CHECK("newLifeMonths" BETWEEN 1 AND 1200),"newFirstMonth" TEXT CHECK("newFirstMonth"~'^[0-9]{4}-(0[1-9]|1[0-2])$'),"basisHash" TEXT NOT NULL,"sourceSnapshot" JSONB,state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','POSTED','VOIDED')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"reversalOfId" UUID UNIQUE REFERENCES "FinanceAssetMovement" ON DELETE RESTRICT,"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK((kind='DEPRECIATION' AND month IS NOT NULL AND "reversalOfId" IS NULL) OR(kind='REVERSAL' AND "reversalOfId" IS NOT NULL) OR(kind NOT IN('DEPRECIATION','REVERSAL') AND month IS NULL AND "reversalOfId" IS NULL)),CHECK("feeAmount"=0 OR kind IN('DISPOSAL','REVERSAL')));
CREATE UNIQUE INDEX "FinanceAssetMovement_asset_month_key" ON "FinanceAssetMovement"("assetId",month) WHERE kind='DEPRECIATION';
CREATE TABLE "FinanceAssetEvent"(id UUID PRIMARY KEY,"assetId" UUID NOT NULL REFERENCES "FinanceAsset" ON DELETE RESTRICT,"movementId" UUID NOT NULL UNIQUE REFERENCES "FinanceAssetMovement" ON DELETE RESTRICT,"journalId" UUID UNIQUE REFERENCES "FinanceJournalEntry" ON DELETE RESTRICT,"effectiveDate" DATE NOT NULL,"costDelta" NUMERIC(20,2) NOT NULL,"depreciationDelta" NUMERIC(20,2) NOT NULL,"disposalDelta" INTEGER NOT NULL CHECK("disposalDelta" BETWEEN -1 AND 1),"policy" JSONB,"recordedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
CREATE INDEX "FinanceAssetEvent_assetId_effectiveDate_idx" ON "FinanceAssetEvent"("assetId","effectiveDate");
CREATE TRIGGER "FinanceAssetEvent_immutable" BEFORE UPDATE OR DELETE ON "FinanceAssetEvent" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
CREATE TRIGGER "FinanceAssetMovement_config" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceAssetMovement" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
ALTER TABLE "FinanceJournalEntry" ADD COLUMN "assetMovementId" UUID UNIQUE REFERENCES "FinanceAssetMovement" ON DELETE RESTRICT;
DO $$ DECLARE def TEXT;BEGIN SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint WHERE conrelid='public."FinanceJournalEntry"'::regclass AND conname='FinanceJournalEntry_source_identity';ALTER TABLE "FinanceJournalEntry" DROP CONSTRAINT "FinanceJournalEntry_source_identity";EXECUTE 'ALTER TABLE public."FinanceJournalEntry" ADD CONSTRAINT "FinanceJournalEntry_source_identity" CHECK(('||substr(def,8,length(def)-8)||' AND "assetMovementId" IS NULL) OR("sourceType"=''ASSET_MOVEMENT'' AND "sourceAction"=''POST'' AND "assetMovementId"="sourceId" AND "assetMovementId" IS NOT NULL AND "draftId" IS NULL AND "movementId" IS NULL AND "invoiceId" IS NULL AND "billId" IS NULL AND "customerDocumentId" IS NULL AND "supplierDocumentId" IS NULL AND "reversalOfId" IS NULL))';END $$;
-- F25 deliberately prevented posting; F26 replaces those guards with event-derived mirrors.
ALTER TABLE "FinanceAsset" DROP CONSTRAINT "FinanceAsset_accumulatedDepreciation_check",DROP CONSTRAINT "FinanceAsset_disposalDate_check",DROP CONSTRAINT "FinanceAsset_disposalJournalId_check",DROP CONSTRAINT "FinanceAsset_usedAt_check",DROP CONSTRAINT "FinanceAsset_state_check";
ALTER TABLE "FinanceAsset" ADD CONSTRAINT "FinanceAsset_accumulatedDepreciation_check" CHECK("accumulatedDepreciation">=0),ADD CONSTRAINT "FinanceAsset_state_check" CHECK(state IN('REGISTERED','DISPOSED','VOIDED'));
CREATE FUNCTION encova_finance_asset_position(target UUID,cutoff DATE DEFAULT DATE '9999-12-31') RETURNS TABLE(cost NUMERIC,depreciation NUMERIC,carrying NUMERIC,disposed INTEGER) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT a.cost+coalesce(sum(e."costDelta"),0),coalesce(sum(e."depreciationDelta"),0),a.cost+coalesce(sum(e."costDelta"-e."depreciationDelta"),0),coalesce(sum(e."disposalDelta"),0)::integer FROM public."FinanceAsset" a LEFT JOIN public."FinanceAssetEvent" e ON e."assetId"=a.id AND e."effectiveDate"<=cutoff WHERE a.id=target GROUP BY a.id $$;
CREATE FUNCTION encova_finance_asset_basis_hash(target UUID) RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT encode(sha256(convert_to(jsonb_build_object('asset',to_jsonb(a)-ARRAY['description','tag','location','custodianId','version','updatedAt'],'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) FROM public."FinanceAssetEvent" e WHERE e."assetId"=a.id))::text,'UTF8')),'hex') FROM public."FinanceAsset" a WHERE a.id=target $$;
CREATE FUNCTION encova_finance_asset_plan(target UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE a public."FinanceAsset"%ROWTYPE;policy_event public."FinanceAssetEvent"%ROWTYPE;BEGIN
 SELECT * INTO a FROM public."FinanceAsset" WHERE id=target;
 SELECT e.* INTO policy_event FROM public."FinanceAssetEvent" e JOIN public."FinanceAssetMovement" m ON m.id=e."movementId" WHERE e."assetId"=target AND m.kind='POLICY_CHANGE' AND m.state='POSTED' AND NOT EXISTS(SELECT 1 FROM public."FinanceAssetMovement" r WHERE r."reversalOfId"=m.id AND r.state='POSTED') ORDER BY e."recordedAt" DESC,e.id LIMIT 1;
 IF EXISTS(SELECT 1 FROM public."FinanceAssetEvent" e JOIN public."FinanceAssetMovement" m ON m.id=e."movementId" WHERE e."assetId"=target AND(m.kind IN('IMPAIRMENT','ADJUSTMENT_INCREASE','ADJUSTMENT_DECREASE','REVERSAL')) AND e."recordedAt">coalesce(policy_event."recordedAt",'-infinity'::timestamptz)) THEN RAISE EXCEPTION 'FINANCE_ASSET_POLICY_REVIEW' USING ERRCODE='P0001';END IF;
 IF policy_event.id IS NOT NULL THEN RETURN policy_event.policy;END IF;
 IF a.convention<>'FULL_MONTH_FROM_FIRST_MONTH' OR a."firstDepMonth" IS NULL OR a."policyEvidence" IS NULL THEN RAISE EXCEPTION 'FINANCE_ASSET_POLICY' USING ERRCODE='P0001';END IF;
 RETURN jsonb_build_object('base',(a.cost-a."residualValue")::text,'residual',a."residualValue"::text,'months',a."usefulLifeMonths",'firstMonth',a."firstDepMonth");
END $$;
CREATE FUNCTION encova_finance_asset_charge(target UUID,charge_month TEXT) RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE plan JSONB;offset_month INTEGER;months INTEGER;base_paisa NUMERIC;ordinary NUMERIC;BEGIN
 IF charge_month IS NULL OR charge_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR charge_month<'0001-01' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 plan:=public.encova_finance_asset_plan(target);months:=(plan->>'months')::integer;offset_month:=((extract(year FROM(charge_month||'-01')::date)-extract(year FROM((plan->>'firstMonth')||'-01')::date))*12+extract(month FROM(charge_month||'-01')::date)-extract(month FROM((plan->>'firstMonth')||'-01')::date))::integer;
 IF offset_month<0 OR offset_month>=months THEN RAISE EXCEPTION 'FINANCE_ASSET_MONTH' USING ERRCODE='P0001';END IF;
 base_paisa:=(plan->>'base')::numeric*100;ordinary:=floor(base_paisa/months);
 RETURN CASE WHEN offset_month=months-1 THEN(base_paisa-ordinary*(months-1))/100 ELSE ordinary/100 END;
END $$;
ALTER TABLE "FinanceAssetMovement" ADD COLUMN "basisSnapshot" JSONB NOT NULL;
CREATE FUNCTION encova_finance_asset_capture(target UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT jsonb_build_object('asset',to_jsonb(a)||jsonb_build_object('cost',a.cost::text,'residualValue',a."residualValue"::text,'accumulatedDepreciation',a."accumulatedDepreciation"::text),'position',(SELECT jsonb_build_object('cost',p.cost::text,'depreciation',p.depreciation::text,'carrying',p.carrying::text,'disposed',p.disposed) FROM public.encova_finance_asset_position(target)p),'accumulatedLines',(SELECT coalesce(jsonb_agg(x ORDER BY x."accountId"),'[]'::jsonb) FROM(SELECT l."accountId",round(sum(l.credit-l.debit),2)::text AS amount FROM public."FinanceJournalLine" l JOIN public."FinanceJournalEntry" j ON j.id=l."journalId" JOIN public."FinanceAssetMovement" m ON m.id=j."assetMovementId" JOIN public."FinanceAccount" a ON a.id=l."accountId" WHERE m."assetId"=target AND a."controlType"='ACCUMULATED_DEPRECIATION' GROUP BY l."accountId" HAVING sum(l.credit-l.debit)<>0)x)) FROM public."FinanceAsset" a WHERE a.id=target $$;
CREATE FUNCTION encova_finance_asset_movement_lines(target UUID) RETURNS TABLE(sequence INTEGER,"accountId" UUID,description TEXT,debit NUMERIC,credit NUMERIC,"projectId" UUID,"partyId" UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT 1,CASE WHEN d.kind='DEPRECIATION' OR d.kind='IMPAIRMENT' THEN d."expenseAccountId" WHEN d.kind='ADJUSTMENT_INCREASE' THEN a."accountId" ELSE d."counterAccountId" END,d.description,d.amount,0::numeric,NULL::uuid,NULL::uuid FROM public."FinanceAssetMovement" d JOIN public."FinanceAsset" a ON a.id=d."assetId" WHERE d.id=target AND d.kind IN('DEPRECIATION','IMPAIRMENT','ADJUSTMENT_INCREASE','ADJUSTMENT_DECREASE') AND d.amount>0
 UNION ALL SELECT 2,CASE WHEN d.kind='DEPRECIATION' THEN d."accumulatedAccountId" WHEN d.kind='ADJUSTMENT_INCREASE' THEN d."counterAccountId" ELSE a."accountId" END,d.description,0::numeric,d.amount,NULL::uuid,NULL::uuid FROM public."FinanceAssetMovement" d JOIN public."FinanceAsset" a ON a.id=d."assetId" WHERE d.id=target AND d.kind IN('DEPRECIATION','IMPAIRMENT','ADJUSTMENT_INCREASE','ADJUSTMENT_DECREASE') AND d.amount>0
 UNION ALL SELECT leg.sequence,leg.account,d.description,leg.debit,leg.credit,NULL::uuid,NULL::uuid FROM public."FinanceAssetMovement" d JOIN public."FinanceAsset" a ON a.id=d."assetId" LEFT JOIN public."FinanceCashAccount" c ON c.id=d."cashAccountId" CROSS JOIN LATERAL(VALUES
 (1,c."glAccountId",greatest(d.amount-d."feeAmount",0),greatest(d."feeAmount"-d.amount,0)),(2,d."feeAccountId",d."feeAmount",0::numeric),(3,d."lossAccountId",greatest((d."basisSnapshot"#>>'{position,carrying}')::numeric-d.amount,0),0::numeric),(4,d."gainAccountId",0::numeric,greatest(d.amount-(d."basisSnapshot"#>>'{position,carrying}')::numeric,0)),(5,a."accountId",0::numeric,(d."basisSnapshot"#>>'{position,cost}')::numeric))leg(sequence,account,debit,credit) WHERE d.id=target AND d.kind='DISPOSAL' AND(leg.debit>0 OR leg.credit>0)
 UNION ALL SELECT 10+x.ord::integer,(x.line->>'accountId')::uuid,d.description,(x.line->>'amount')::numeric,0::numeric,NULL::uuid,NULL::uuid FROM public."FinanceAssetMovement" d CROSS JOIN LATERAL jsonb_array_elements(d."basisSnapshot"->'accumulatedLines') WITH ORDINALITY x(line,ord) WHERE d.id=target AND d.kind='DISPOSAL' AND(x.line->>'amount')::numeric>0
 UNION ALL SELECT l.sequence,l."accountId",l.description,l.credit,l.debit,l."projectId",l."partyId" FROM public."FinanceAssetMovement" d JOIN public."FinanceJournalEntry" e ON e."assetMovementId"=d."reversalOfId" JOIN public."FinanceJournalLine" l ON l."journalId"=e.id WHERE d.id=target AND d.kind='REVERSAL';
$$;
CREATE FUNCTION encova_finance_asset_movement_snapshot(target UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT(to_jsonb(d)-ARRAY['sourceSnapshot','state','version','createdAt','updatedAt','basisHash'])||jsonb_build_object('amount',d.amount::text,'feeAmount',d."feeAmount"::text,'newResidual',d."newResidual"::text) FROM public."FinanceAssetMovement" d WHERE d.id=target $$;
CREATE FUNCTION encova_finance_asset_movement_validate(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE d public."FinanceAssetMovement"%ROWTYPE;a public."FinanceAsset"%ROWTYPE;o public."FinanceAssetMovement"%ROWTYPE;p RECORD;plan JSONB;first_month DATE;charge_index INTEGER;BEGIN
 SELECT * INTO d FROM public."FinanceAssetMovement" WHERE id=target FOR UPDATE;SELECT * INTO a FROM public."FinanceAsset" WHERE id=d."assetId" FOR UPDATE;SELECT * INTO p FROM public.encova_finance_asset_position(a.id);
 IF d.id IS NULL OR d.state<>'DRAFT' OR a.id IS NULL OR a.state='VOIDED' OR d."postingDate"<a."sourcePostingDate" THEN RAISE EXCEPTION 'FINANCE_ASSET_SOURCE' USING ERRCODE='P0001';END IF;
 IF d."basisHash" IS DISTINCT FROM public.encova_finance_asset_basis_hash(a.id) THEN RAISE EXCEPTION 'FINANCE_ASSET_STALE_BASIS' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM public."FinanceAssetEvent" WHERE "assetId"=a.id AND "effectiveDate">d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ASSET_DATE_ORDER' USING ERRCODE='P0001';END IF;
 IF d.kind='REVERSAL' THEN
  SELECT * INTO o FROM public."FinanceAssetMovement" WHERE id=d."reversalOfId";
  IF o.id IS NULL OR o.state<>'POSTED' OR o.kind='REVERSAL' OR o."assetId"<>a.id OR d."postingDate"<o."postingDate" OR EXISTS(SELECT 1 FROM public."FinanceAssetMovement" WHERE "reversalOfId"=o.id AND id<>d.id) THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001';END IF;
  IF o.kind='POLICY_CHANGE' AND EXISTS(SELECT 1 FROM public."FinanceAssetEvent" WHERE "assetId"=a.id AND "recordedAt">(SELECT "recordedAt" FROM public."FinanceAssetEvent" WHERE "movementId"=o.id)) THEN RAISE EXCEPTION 'FINANCE_ASSET_POLICY_USED' USING ERRCODE='P0001';END IF;RETURN;
 END IF;
 IF p.disposed<>0 OR a.state<>'REGISTERED' THEN RAISE EXCEPTION 'FINANCE_ASSET_DISPOSED' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=a."accountId" AND active AND "isPosting" AND "controlType"='FIXED_ASSET') THEN RAISE EXCEPTION 'FINANCE_ASSET_MAPPING' USING ERRCODE='P0001';END IF;
 IF d.kind IN('DEPRECIATION','IMPAIRMENT') AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."expenseAccountId" AND active AND "isPosting" AND "controlType"='NONE' AND type IN('OPERATING_EXPENSE','OTHER_EXPENSE') AND NOT "isContra") THEN RAISE EXCEPTION 'FINANCE_ASSET_MAPPING' USING ERRCODE='P0001';END IF;
 IF d.kind='DEPRECIATION' THEN
  plan:=public.encova_finance_asset_plan(a.id);first_month:=((plan->>'firstMonth')||'-01')::date;charge_index:=((extract(year FROM(d.month||'-01')::date)-extract(year FROM first_month))*12+extract(month FROM(d.month||'-01')::date)-extract(month FROM first_month))::integer;
  IF d.amount<>public.encova_finance_asset_charge(a.id,d.month) OR d."postingDate"<((d.month||'-01')::date+interval '1 month'-interval '1 day')::date OR NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."accumulatedAccountId" AND active AND "isPosting" AND "controlType"='ACCUMULATED_DEPRECIATION' AND "isContra") THEN RAISE EXCEPTION 'FINANCE_ASSET_MONTH' USING ERRCODE='P0001';END IF;
  IF EXISTS(SELECT 1 FROM generate_series(0,charge_index-1)x WHERE NOT EXISTS(SELECT 1 FROM public."FinanceAssetMovement" prior WHERE prior."assetId"=a.id AND prior.kind='DEPRECIATION' AND prior.month=to_char(first_month+x*interval '1 month','YYYY-MM') AND prior.state='POSTED' AND NOT EXISTS(SELECT 1 FROM public."FinanceAssetMovement" r WHERE r."reversalOfId"=prior.id AND r.state='POSTED'))) THEN RAISE EXCEPTION 'FINANCE_ASSET_MONTH_ORDER' USING ERRCODE='P0001';END IF;
  IF d.amount>p.carrying-(plan->>'residual')::numeric THEN RAISE EXCEPTION 'FINANCE_ASSET_CAPACITY' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='IMPAIRMENT' OR d.kind='ADJUSTMENT_DECREASE' THEN IF d.amount<=0 OR d.amount>p.carrying THEN RAISE EXCEPTION 'FINANCE_ASSET_CAPACITY' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='ADJUSTMENT_INCREASE' THEN IF d.amount<=0 OR p.cost+d.amount>999999999999999999.99 THEN RAISE EXCEPTION 'FINANCE_ASSET_CAPACITY' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='POLICY_CHANGE' THEN
  IF d.amount<>0 OR d."newResidual" IS NULL OR d."newResidual"<0 OR d."newResidual">p.carrying OR d."newLifeMonths" IS NULL OR d."newFirstMonth" IS NULL OR d."newFirstMonth"<to_char(greatest(a."inServiceDate",d."postingDate"),'YYYY-MM') OR EXISTS(SELECT 1 FROM public."FinanceAssetMovement" WHERE "assetId"=a.id AND kind='DEPRECIATION' AND month>=d."newFirstMonth") THEN RAISE EXCEPTION 'FINANCE_ASSET_POLICY' USING ERRCODE='P0001';END IF;
 END IF;
 IF d.kind IN('ADJUSTMENT_INCREASE','ADJUSTMENT_DECREASE') AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."counterAccountId" AND active AND "isPosting" AND "controlType"='NONE' AND NOT "isContra") THEN RAISE EXCEPTION 'FINANCE_ASSET_MAPPING' USING ERRCODE='P0001';END IF;
 IF d.kind='DISPOSAL' THEN
  IF(d.amount<>d."feeAmount" AND NOT EXISTS(SELECT 1 FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" account ON account.id=c."glAccountId" WHERE c.id=d."cashAccountId" AND c.active AND account.active AND account."controlType"='CASH')) OR(d.amount=d."feeAmount" AND d."cashAccountId" IS NOT NULL) OR NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."gainAccountId" AND active AND "isPosting" AND "controlType"='NONE' AND type='OTHER_INCOME') OR NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."lossAccountId" AND active AND "isPosting" AND "controlType"='NONE' AND type='OTHER_EXPENSE') OR(d."feeAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."feeAccountId" AND active AND "isPosting" AND "controlType"='NONE' AND type IN('OPERATING_EXPENSE','OTHER_EXPENSE'))) THEN RAISE EXCEPTION 'FINANCE_ASSET_MAPPING' USING ERRCODE='P0001';END IF;
 END IF;
END $$;
CREATE FUNCTION encova_finance_asset_expected(target UUID) RETURNS TABLE("costDelta" NUMERIC,"depreciationDelta" NUMERIC,"disposalDelta" INTEGER,policy JSONB) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN d.kind='DISPOSAL' THEN -(d."basisSnapshot"#>>'{position,cost}')::numeric WHEN d.kind IN('IMPAIRMENT','ADJUSTMENT_DECREASE') THEN -d.amount WHEN d.kind='ADJUSTMENT_INCREASE' THEN d.amount ELSE 0::numeric END,CASE WHEN d.kind='DISPOSAL' THEN -(d."basisSnapshot"#>>'{position,depreciation}')::numeric WHEN d.kind='DEPRECIATION' THEN d.amount ELSE 0::numeric END,CASE WHEN d.kind='DISPOSAL' THEN 1 ELSE 0 END,CASE WHEN d.kind='POLICY_CHANGE' THEN jsonb_build_object('base',((d."basisSnapshot"#>>'{position,carrying}')::numeric-d."newResidual")::text,'residual',d."newResidual"::text,'months',d."newLifeMonths",'firstMonth',d."newFirstMonth") END FROM public."FinanceAssetMovement" d WHERE d.id=target AND d.kind<>'REVERSAL'
 UNION ALL SELECT -e."costDelta",-e."depreciationDelta",-e."disposalDelta",NULL::jsonb FROM public."FinanceAssetMovement" d JOIN public."FinanceAssetEvent" e ON e."movementId"=d."reversalOfId" WHERE d.id=target AND d.kind='REVERSAL';
$$;
CREATE FUNCTION encova_finance_asset_movement_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' OR(TG_OP='UPDATE' AND OLD.state='POSTED') THEN RAISE EXCEPTION 'FINANCE_ASSET_MOVEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN IF NEW.state<>'DRAFT' OR NEW.version<>1 OR NEW."sourceSnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;RETURN NEW;END IF;
 IF ROW(NEW.id,NEW.number,NEW."assetId",NEW.kind,NEW.month,NEW."createdById",NEW."createdAt",NEW."reversalOfId") IS DISTINCT FROM ROW(OLD.id,OLD.number,OLD."assetId",OLD.kind,OLD.month,OLD."createdById",OLD."createdAt",OLD."reversalOfId") OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
 IF NEW.state='POSTED' THEN IF(to_jsonb(NEW)-ARRAY['state','version','sourceSnapshot','updatedAt']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','sourceSnapshot','updatedAt']) OR NEW."sourceSnapshot" IS DISTINCT FROM public.encova_finance_asset_movement_snapshot(NEW.id) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;ELSIF NEW."sourceSnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceAssetMovement_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceAssetMovement" FOR EACH ROW EXECUTE FUNCTION encova_finance_asset_movement_guard();
CREATE FUNCTION encova_finance_asset_check(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE a public."FinanceAsset"%ROWTYPE;p RECORD;used TIMESTAMPTZ;disposal_date DATE;disposal_journal UUID;BEGIN
 SELECT * INTO a FROM public."FinanceAsset" WHERE id=target;SELECT * INTO p FROM public.encova_finance_asset_position(target);SELECT min("recordedAt") INTO used FROM public."FinanceAssetEvent" WHERE "assetId"=target;
 SELECT m."postingDate",j.id INTO disposal_date,disposal_journal FROM public."FinanceAssetMovement" m LEFT JOIN public."FinanceJournalEntry" j ON j."assetMovementId"=m.id WHERE m."assetId"=target AND m.kind='DISPOSAL' AND m.state='POSTED' AND NOT EXISTS(SELECT 1 FROM public."FinanceAssetMovement" r WHERE r."reversalOfId"=m.id AND r.state='POSTED') ORDER BY m."createdAt" DESC LIMIT 1;
 IF a."accumulatedDepreciation" IS DISTINCT FROM p.depreciation OR a."usedAt" IS DISTINCT FROM used OR a."disposalDate" IS DISTINCT FROM disposal_date OR a."disposalJournalId" IS DISTINCT FROM disposal_journal OR(a.state='DISPOSED')<>(p.disposed=1) OR(a.state='VOIDED' AND used IS NOT NULL) THEN RAISE EXCEPTION 'FINANCE_ASSET_EVENT_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT a.cost+sum("costDelta") OVER(ORDER BY "effectiveDate" RANGE UNBOUNDED PRECEDING) cost,sum("depreciationDelta") OVER(ORDER BY "effectiveDate" RANGE UNBOUNDED PRECEDING) dep,sum("disposalDelta") OVER(ORDER BY "effectiveDate" RANGE UNBOUNDED PRECEDING) disposed FROM public."FinanceAssetEvent" WHERE "assetId"=target)x WHERE cost<0 OR cost>999999999999999999.99 OR dep<0 OR dep>cost OR disposed NOT BETWEEN 0 AND 1 OR(disposed=1 AND(cost<>0 OR dep<>0))) THEN RAISE EXCEPTION 'FINANCE_ASSET_CAPACITY' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM public."FinanceJournalLine" l JOIN public."FinanceJournalEntry" e ON e.id=l."journalId" JOIN public."FinanceAssetMovement" m ON m.id=e."assetMovementId" JOIN public."FinanceAccount" account ON account.id=l."accountId" WHERE m."assetId"=target AND account."controlType"='ACCUMULATED_DEPRECIATION' GROUP BY l."accountId" HAVING sum(l.credit-l.debit)<0) THEN RAISE EXCEPTION 'FINANCE_ASSET_CAPACITY' USING ERRCODE='P0001';END IF;
END $$;
CREATE FUNCTION encova_finance_check_asset_movement(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE d public."FinanceAssetMovement"%ROWTYPE;o public."FinanceAssetMovement"%ROWTYPE;e public."FinanceJournalEntry"%ROWTYPE;v public."FinanceAssetEvent"%ROWTYPE;BEGIN
 SELECT * INTO d FROM public."FinanceAssetMovement" WHERE id=target;SELECT * INTO e FROM public."FinanceJournalEntry" WHERE "assetMovementId"=target;SELECT * INTO v FROM public."FinanceAssetEvent" WHERE "movementId"=target;
 IF d.state<>'POSTED' THEN IF e.id IS NOT NULL OR v.id IS NOT NULL OR d."sourceSnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;END IF;
 IF d.id IS NULL OR v.id IS NULL OR v."assetId"<>d."assetId" OR v."journalId" IS DISTINCT FROM e.id OR v."effectiveDate"<>d."postingDate" OR d."sourceSnapshot" IS DISTINCT FROM public.encova_finance_asset_movement_snapshot(target) OR ROW(v."costDelta",v."depreciationDelta",v."disposalDelta",v.policy) IS DISTINCT FROM(SELECT x."costDelta",x."depreciationDelta",x."disposalDelta",x.policy FROM public.encova_finance_asset_expected(target)x) THEN RAISE EXCEPTION 'FINANCE_ASSET_EVENT_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM public.encova_finance_asset_movement_lines(target)) THEN IF e.id IS NULL OR e."sourceType"<>'ASSET_MOVEMENT' OR e."postingDate"<>d."postingDate" OR e.description<>d.description OR e.evidence<>d.evidence THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;ELSIF e.id IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id) EXCEPT(SELECT * FROM public.encova_finance_asset_movement_lines(target))) OR EXISTS((SELECT * FROM public.encova_finance_asset_movement_lines(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF d.kind='REVERSAL' THEN SELECT * INTO o FROM public."FinanceAssetMovement" WHERE id=d."reversalOfId";IF o.state IS DISTINCT FROM 'POSTED' OR o.kind='REVERSAL' OR d."postingDate"<o."postingDate" OR(to_jsonb(d)-ARRAY['id','number','kind','postingDate','evidence','approvalEvidence','basisHash','basisSnapshot','sourceSnapshot','state','version','reversalOfId','createdById','createdAt','updatedAt']) IS DISTINCT FROM(to_jsonb(o)-ARRAY['id','number','kind','postingDate','evidence','approvalEvidence','basisHash','basisSnapshot','sourceSnapshot','state','version','reversalOfId','createdById','createdAt','updatedAt']) THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001';END IF;END IF;
 PERFORM public.encova_finance_asset_check(d."assetId");
END $$;
CREATE FUNCTION encova_finance_asset_lifecycle_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_TABLE_NAME='FinanceAsset' THEN PERFORM public.encova_finance_asset_check(NEW.id);ELSIF TG_TABLE_NAME='FinanceAssetMovement' THEN PERFORM public.encova_finance_check_asset_movement(NEW.id);ELSE PERFORM public.encova_finance_check_asset_movement(NEW."movementId");END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FinanceAsset_lifecycle_valid" AFTER INSERT OR UPDATE ON "FinanceAsset" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_asset_lifecycle_check();
CREATE CONSTRAINT TRIGGER "FinanceAssetMovement_valid" AFTER INSERT OR UPDATE ON "FinanceAssetMovement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_asset_lifecycle_check();
CREATE CONSTRAINT TRIGGER "FinanceAssetEvent_valid" AFTER INSERT ON "FinanceAssetEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_asset_lifecycle_check();
CREATE FUNCTION encova_finance_asset_movement_effects(actor UUID,target UUID,entry_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE d public."FinanceAssetMovement"%ROWTYPE;p RECORD;disposal_date DATE;disposal_journal UUID;BEGIN
 SELECT * INTO d FROM public."FinanceAssetMovement" WHERE id=target;
 INSERT INTO public."FinanceAssetEvent"(id,"assetId","movementId","journalId","effectiveDate","costDelta","depreciationDelta","disposalDelta",policy) SELECT gen_random_uuid(),d."assetId",target,entry_id,d."postingDate",x.* FROM public.encova_finance_asset_expected(target)x;
 UPDATE public."FinanceAssetMovement" SET state='POSTED',version=version+1,"sourceSnapshot"=public.encova_finance_asset_movement_snapshot(id),"updatedAt"=CURRENT_TIMESTAMP WHERE id=target;
 SELECT * INTO p FROM public.encova_finance_asset_position(d."assetId");SELECT m."postingDate",j.id INTO disposal_date,disposal_journal FROM public."FinanceAssetMovement" m LEFT JOIN public."FinanceJournalEntry" j ON j."assetMovementId"=m.id WHERE m."assetId"=d."assetId" AND m.kind='DISPOSAL' AND m.state='POSTED' AND NOT EXISTS(SELECT 1 FROM public."FinanceAssetMovement" r WHERE r."reversalOfId"=m.id AND r.state='POSTED') ORDER BY m."createdAt" DESC LIMIT 1;
 UPDATE public."FinanceAsset" SET "accumulatedDepreciation"=p.depreciation,"usedAt"=(SELECT min("recordedAt") FROM public."FinanceAssetEvent" WHERE "assetId"=d."assetId"),"disposalDate"=disposal_date,"disposalJournalId"=disposal_journal,state=CASE WHEN p.disposed=1 THEN 'DISPOSED' ELSE 'REGISTERED' END,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d."assetId";
END $$;
CREATE FUNCTION encova_finance_asset_movement_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public."FinanceAssetMovement"%ROWTYPE;o public."FinanceAssetMovement"%ROWTYPE;a public."FinanceAsset"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;reason TEXT;digest TEXT;result JSONB;entry_id UUID;original UUID;original_number TEXT;original_version INTEGER;BEGIN
 IF action IS NULL OR action NOT IN('CREATE','GENERATE','UPDATE','REFRESH','REOPEN','POST','VOID','REVERSE') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 reason:=trim(input->>'reason');IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 500 OR input-(CASE WHEN action='CREATE' THEN ARRAY['assetId','kind','postingDate','description','evidence','approvalEvidence','amount','feeAmount','expenseAccountId','accumulatedAccountId','counterAccountId','cashAccountId','gainAccountId','lossAccountId','feeAccountId','newResidual','newLifeMonths','newFirstMonth','reason'] WHEN action='UPDATE' THEN ARRAY['id','expectedVersion','postingDate','description','evidence','approvalEvidence','amount','feeAmount','expenseAccountId','accumulatedAccountId','counterAccountId','cashAccountId','gainAccountId','lossAccountId','feeAccountId','newResidual','newLifeMonths','newFirstMonth','reason'] WHEN action='GENERATE' THEN ARRAY['assetId','month','postingDate','expenseAccountId','accumulatedAccountId','evidence','approvalEvidence','reason'] WHEN action='REVERSE' THEN ARRAY['id','expectedVersion','postingDate','reason'] ELSE ARRAY['id','expectedVersion','reason'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF input->>'newResidual' IS NOT NULL AND(jsonb_typeof(input->'newResidual')<>'string' OR input->>'newResidual' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT public.encova_finance_session_ok(actor,provider,session_id) OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 digest:=encode(sha256(convert_to(jsonb_strip_nulls(input)::text,'UTF8')),'hex');SELECT * INTO r FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation='ASSET_MOVEMENT_'||action AND key=request_key;
 IF FOUND THEN IF r."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN r.result;END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF action IN('CREATE','GENERATE') THEN
  SELECT * INTO a FROM public."FinanceAsset" WHERE id=(input->>'assetId')::uuid FOR UPDATE;
  IF a.id IS NULL OR a.state<>'REGISTERED' THEN RAISE EXCEPTION 'FINANCE_ASSET_SOURCE' USING ERRCODE='P0001';END IF;
  IF input->>'postingDate' IS NULL OR input->>'postingDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  IF action='GENERATE' THEN
   SELECT * INTO d FROM public."FinanceAssetMovement" WHERE "assetId"=a.id AND kind='DEPRECIATION' AND month=input->>'month';
   IF NOT FOUND THEN INSERT INTO public."FinanceAssetMovement"(id,number,"assetId",kind,month,"postingDate",description,evidence,"approvalEvidence",amount,"expenseAccountId","accumulatedAccountId","basisHash","basisSnapshot","createdById") VALUES(gen_random_uuid(),'ASM-'||lpad(nextval('public.finance_asset_movement_number')::text,10,'0'),a.id,'DEPRECIATION',input->>'month',(input->>'postingDate')::date,'Monthly depreciation '||a.tag||' '||(input->>'month'),input->>'evidence',input->>'approvalEvidence',public.encova_finance_asset_charge(a.id,input->>'month'),(input->>'expenseAccountId')::uuid,(input->>'accumulatedAccountId')::uuid,public.encova_finance_asset_basis_hash(a.id),public.encova_finance_asset_capture(a.id),actor) RETURNING * INTO d;END IF;
  ELSE
   IF input->>'kind' IS NULL OR input->>'kind' NOT IN('IMPAIRMENT','ADJUSTMENT_INCREASE','ADJUSTMENT_DECREASE','DISPOSAL','POLICY_CHANGE') OR jsonb_typeof(input->'amount') IS DISTINCT FROM 'string' OR input->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR jsonb_typeof(input->'feeAmount') IS DISTINCT FROM 'string' OR input->>'feeAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   INSERT INTO public."FinanceAssetMovement"(id,number,"assetId",kind,"postingDate",description,evidence,"approvalEvidence",amount,"feeAmount","expenseAccountId","accumulatedAccountId","counterAccountId","cashAccountId","gainAccountId","lossAccountId","feeAccountId","newResidual","newLifeMonths","newFirstMonth","basisHash","basisSnapshot","createdById") VALUES(gen_random_uuid(),'ASM-'||lpad(nextval('public.finance_asset_movement_number')::text,10,'0'),a.id,input->>'kind',(input->>'postingDate')::date,input->>'description',input->>'evidence',input->>'approvalEvidence',(input->>'amount')::numeric,(input->>'feeAmount')::numeric,(input->>'expenseAccountId')::uuid,(input->>'accumulatedAccountId')::uuid,(input->>'counterAccountId')::uuid,(input->>'cashAccountId')::uuid,(input->>'gainAccountId')::uuid,(input->>'lossAccountId')::uuid,(input->>'feeAccountId')::uuid,(input->>'newResidual')::numeric,(input->>'newLifeMonths')::integer,input->>'newFirstMonth',public.encova_finance_asset_basis_hash(a.id),public.encova_finance_asset_capture(a.id),actor) RETURNING * INTO d;
  END IF;
 ELSE
  SELECT * INTO d FROM public."FinanceAssetMovement" WHERE id=(input->>'id')::uuid FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR d.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF action='REVERSE' THEN
   IF d.state<>'POSTED' OR d.kind='REVERSAL' OR EXISTS(SELECT 1 FROM public."FinanceAssetMovement" WHERE "reversalOfId"=d.id) THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001';END IF;
   o:=d;original:=d.id;original_number:=d.number;original_version:=d.version;
   INSERT INTO public."FinanceAssetMovement" SELECT x.* FROM jsonb_populate_record(NULL::public."FinanceAssetMovement",to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),'number','ASM-'||lpad(nextval('public.finance_asset_movement_number')::text,10,'0'),'kind','REVERSAL','reversalOfId',o.id,'postingDate',(input->>'postingDate')::date,'evidence',reason,'approvalEvidence',reason,'basisHash',public.encova_finance_asset_basis_hash(o."assetId"),'basisSnapshot',public.encova_finance_asset_capture(o."assetId"),'sourceSnapshot',NULL,'state','DRAFT','version',1,'createdById',actor,'createdAt',CURRENT_TIMESTAMP,'updatedAt',CURRENT_TIMESTAMP))x RETURNING * INTO d;
   entry_id:=public.encova_finance_emit_journal(actor,'ASSET_MOVEMENT',d.id,d."postingDate",reason);
  ELSIF action='UPDATE' THEN
   IF d.state<>'DRAFT' OR jsonb_typeof(input->'amount') IS DISTINCT FROM 'string' OR input->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR jsonb_typeof(input->'feeAmount') IS DISTINCT FROM 'string' OR input->>'feeAmount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   UPDATE public."FinanceAssetMovement" SET "postingDate"=(input->>'postingDate')::date,description=input->>'description',evidence=input->>'evidence',"approvalEvidence"=input->>'approvalEvidence',amount=CASE WHEN kind='DEPRECIATION' THEN public.encova_finance_asset_charge("assetId",month) ELSE(input->>'amount')::numeric END,"feeAmount"=(input->>'feeAmount')::numeric,"expenseAccountId"=(input->>'expenseAccountId')::uuid,"accumulatedAccountId"=(input->>'accumulatedAccountId')::uuid,"counterAccountId"=(input->>'counterAccountId')::uuid,"cashAccountId"=(input->>'cashAccountId')::uuid,"gainAccountId"=(input->>'gainAccountId')::uuid,"lossAccountId"=(input->>'lossAccountId')::uuid,"feeAccountId"=(input->>'feeAccountId')::uuid,"newResidual"=(input->>'newResidual')::numeric,"newLifeMonths"=(input->>'newLifeMonths')::integer,"newFirstMonth"=input->>'newFirstMonth',"basisHash"=public.encova_finance_asset_basis_hash("assetId"),"basisSnapshot"=public.encova_finance_asset_capture("assetId"),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
  ELSIF action IN('REFRESH','REOPEN') THEN
   IF(action='REFRESH' AND d.state<>'DRAFT') OR(action='REOPEN' AND d.state<>'VOIDED') THEN RAISE EXCEPTION 'FINANCE_ASSET_MOVEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
   UPDATE public."FinanceAssetMovement" SET state='DRAFT',amount=CASE WHEN kind='DEPRECIATION' THEN public.encova_finance_asset_charge("assetId",month) ELSE amount END,"basisHash"=public.encova_finance_asset_basis_hash("assetId"),"basisSnapshot"=public.encova_finance_asset_capture("assetId"),version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;
  ELSE
   IF d.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_ASSET_MOVEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
   IF action='VOID' THEN UPDATE public."FinanceAssetMovement" SET state='VOIDED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=d.id RETURNING * INTO d;ELSE entry_id:=public.encova_finance_emit_journal(actor,'ASSET_MOVEMENT',d.id,d."postingDate",reason);END IF;
  END IF;
 END IF;
 SELECT * INTO d FROM public."FinanceAssetMovement" WHERE id=d.id;
 result:=CASE WHEN original IS NOT NULL THEN jsonb_build_object('id',original,'number',original_number,'version',original_version,'reversalId',d.id,'journalId',entry_id) ELSE jsonb_build_object('id',d.id,'number',d.number,'version',d.version,'journalId',entry_id) END;
 INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,'ASSET_MOVEMENT_'||action,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_ASSET_MOVEMENT_'||action,'FinanceAssetMovement',coalesce(original,d.id),reason,jsonb_build_object('source',to_jsonb(d)||jsonb_build_object('amount',d.amount::text),'journalId',entry_id),request_id);RETURN result;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'FINANCE_DUPLICATE' USING ERRCODE='P0001';WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';
END $$;
ALTER TABLE "FinanceAssetMovement" ADD CHECK("basisHash"~'^[0-9a-f]{64}$'),ADD CHECK(jsonb_typeof("basisSnapshot")='object'),ADD CONSTRAINT "FinanceAssetMovement_shape" CHECK(
 (kind='DEPRECIATION' AND "expenseAccountId" IS NOT NULL AND "accumulatedAccountId" IS NOT NULL AND num_nonnulls("counterAccountId","cashAccountId","gainAccountId","lossAccountId","feeAccountId","newResidual","newLifeMonths","newFirstMonth")=0 AND "feeAmount"=0)
 OR(kind='IMPAIRMENT' AND amount>0 AND "expenseAccountId" IS NOT NULL AND num_nonnulls("accumulatedAccountId","counterAccountId","cashAccountId","gainAccountId","lossAccountId","feeAccountId","newResidual","newLifeMonths","newFirstMonth")=0 AND "feeAmount"=0)
 OR(kind IN('ADJUSTMENT_INCREASE','ADJUSTMENT_DECREASE') AND amount>0 AND "counterAccountId" IS NOT NULL AND num_nonnulls("expenseAccountId","accumulatedAccountId","cashAccountId","gainAccountId","lossAccountId","feeAccountId","newResidual","newLifeMonths","newFirstMonth")=0 AND "feeAmount"=0)
 OR(kind='DISPOSAL' AND "gainAccountId" IS NOT NULL AND "lossAccountId" IS NOT NULL AND num_nonnulls("expenseAccountId","accumulatedAccountId","counterAccountId","newResidual","newLifeMonths","newFirstMonth")=0 AND((amount<>"feeAmount" AND "cashAccountId" IS NOT NULL)OR(amount="feeAmount" AND "cashAccountId" IS NULL)) AND("feeAmount"=0 OR "feeAccountId" IS NOT NULL))
 OR(kind='POLICY_CHANGE' AND amount=0 AND "feeAmount"=0 AND "newResidual" IS NOT NULL AND "newLifeMonths" IS NOT NULL AND "newFirstMonth" IS NOT NULL AND num_nonnulls("expenseAccountId","accumulatedAccountId","counterAccountId","cashAccountId","gainAccountId","lossAccountId","feeAccountId")=0) OR(kind='REVERSAL' AND "reversalOfId" IS NOT NULL));
DROP INDEX "FinanceAsset_active_tag_key";CREATE UNIQUE INDEX "FinanceAsset_active_tag_key" ON "FinanceAsset"(tag) WHERE state<>'VOIDED';
CREATE OR REPLACE FUNCTION encova_finance_asset_check_source(bill_line UUID,funding_movement UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE allocated NUMERIC;available NUMERIC;BEGIN
 IF bill_line IS NULL AND funding_movement IS NULL THEN RETURN;END IF;
 SELECT coalesce(sum(cost),0) INTO allocated FROM public."FinanceAsset" WHERE state<>'VOIDED' AND "billLineId" IS NOT DISTINCT FROM bill_line AND "fundingMovementId" IS NOT DISTINCT FROM funding_movement;
 IF allocated<=0 THEN RETURN;END IF;SELECT "eligibleCost" INTO available FROM public.encova_finance_asset_source(bill_line,funding_movement);
 IF available IS NULL OR allocated>available THEN RAISE EXCEPTION 'FINANCE_ASSET_SOURCE_CAPACITY' USING ERRCODE='P0001';END IF;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_asset_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE source RECORD;BEGIN
 IF TG_OP='DELETE' OR(TG_OP='UPDATE' AND OLD.state='VOIDED') THEN RAISE EXCEPTION 'FINANCE_ASSET_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD."usedAt" IS NOT NULL AND(NEW.state='VOIDED' OR ROW(NEW."inServiceDate",NEW."usefulLifeMonths",NEW."residualValue",NEW.convention,NEW."firstDepMonth",NEW."policyEvidence") IS DISTINCT FROM ROW(OLD."inServiceDate",OLD."usefulLifeMonths",OLD."residualValue",OLD.convention,OLD."firstDepMonth",OLD."policyEvidence")) THEN RAISE EXCEPTION 'FINANCE_ASSET_POLICY_USED' USING ERRCODE='P0001';END IF;

  IF ROW(NEW.id,NEW.number,NEW."billLineId",NEW."fundingMovementId",NEW."accountId",NEW.cost,NEW."purchaseDate",NEW."sourcePostingDate",NEW."sourceSnapshot",NEW."createdById",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD.number,OLD."billLineId",OLD."fundingMovementId",OLD."accountId",OLD.cost,OLD."purchaseDate",OLD."sourcePostingDate",OLD."sourceSnapshot",OLD."createdById",OLD."createdAt") THEN RAISE EXCEPTION 'FINANCE_ASSET_IMMUTABLE' USING ERRCODE='P0001';END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF NEW.state='VOIDED' AND(to_jsonb(NEW)-ARRAY['state','version','updatedAt']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','updatedAt']) THEN RAISE EXCEPTION 'FINANCE_ASSET_IMMUTABLE' USING ERRCODE='P0001';END IF;
 ELSE
  SELECT * INTO source FROM public.encova_finance_asset_source(NEW."billLineId",NEW."fundingMovementId");
  IF NEW.state<>'REGISTERED' OR NEW.version<>1 OR source."accountId" IS NULL OR ROW(NEW."accountId",NEW."purchaseDate",NEW."sourcePostingDate",NEW."sourceSnapshot") IS DISTINCT FROM ROW(source."accountId",source."documentDate",source."postingDate",source.snapshot) OR NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=NEW."accountId" AND active AND "isPosting" AND "controlType"='FIXED_ASSET') THEN RAISE EXCEPTION 'FINANCE_ASSET_SOURCE' USING ERRCODE='P0001';END IF;
 END IF;
 IF(TG_OP='INSERT' OR NEW."custodianId" IS DISTINCT FROM OLD."custodianId") AND NEW."custodianId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=NEW."custodianId" AND status='ACTIVE') THEN RAISE EXCEPTION 'FINANCE_ASSET_CUSTODIAN' USING ERRCODE='P0001';END IF;
 IF NEW.convention='FULL_MONTH_FROM_FIRST_MONTH' AND(NEW."firstDepMonth" IS NULL OR NEW."policyEvidence" IS NULL OR length(trim(NEW."policyEvidence")) NOT BETWEEN 3 AND 1000 OR(NEW."firstDepMonth"||'-01')::date<date_trunc('month',greatest(NEW."inServiceDate",NEW."sourcePostingDate"))) THEN RAISE EXCEPTION 'FINANCE_ASSET_POLICY' USING ERRCODE='P0001';END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_emit_journal(actor UUID,source_kind TEXT,source_id UUID,posting_date DATE,reason TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE asset_movement public."FinanceAssetMovement"%ROWTYPE; movement public."FinanceMovement"%ROWTYPE; supplier public."FinanceSupplierDocument"%ROWTYPE; bill public."FinanceBill"%ROWTYPE; draft public."FinanceJournalDraft"%ROWTYPE; original public."FinanceJournalEntry"%ROWTYPE; invoice public."FinanceInvoice"%ROWTYPE;
 period_id UUID; entry_id UUID:=gen_random_uuid(); mappings UUID[]; customer public."FinanceCustomerDocument"%ROWTYPE;
BEGIN
 IF source_kind IS NULL OR source_kind NOT IN ('JOURNAL_DRAFT','JOURNAL_REVERSAL','INVOICE','CUSTOMER_DOCUMENT','BILL','SUPPLIER_DOCUMENT','MOVEMENT','ASSET_MOVEMENT') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(629815);
 IF NOT EXISTS(SELECT 1 FROM public."Person" WHERE id=actor AND role='SUPER_ADMIN' AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public."FinanceGrant" WHERE "userId"=actor AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF source_kind='ASSET_MOVEMENT' THEN
  SELECT * INTO asset_movement FROM public."FinanceAssetMovement" WHERE id=source_id FOR UPDATE;
  IF asset_movement.id IS NULL OR asset_movement."postingDate"<>posting_date THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;PERFORM public.encova_finance_asset_movement_validate(source_id);
 ELSIF source_kind='MOVEMENT' THEN
  SELECT * INTO movement FROM public."FinanceMovement" WHERE id=source_id FOR UPDATE;
  IF movement.id IS NULL OR movement."postingDate"<>posting_date THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_movement_validate(source_id);
 ELSIF source_kind='SUPPLIER_DOCUMENT' THEN
  SELECT * INTO supplier FROM public."FinanceSupplierDocument" WHERE id=source_id FOR UPDATE;
  IF supplier.id IS NULL OR supplier."postingDate"<>posting_date THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_supplier_validate(source_id);
 ELSIF source_kind='BILL' THEN
  SELECT * INTO bill FROM public."FinanceBill" WHERE id=source_id FOR UPDATE;
  IF bill.id IS NULL OR bill."postingDate"<>posting_date THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_bill_validate(source_id);PERFORM public.encova_finance_bill_tax_validate(source_id);
 ELSIF source_kind='INVOICE' THEN
  SELECT * INTO invoice FROM public."FinanceInvoice" WHERE id=source_id FOR UPDATE;
  IF invoice.id IS NULL OR invoice.state<>'DRAFT' OR invoice."postingDate"<>posting_date THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_invoice_tax_validate(source_id);
  IF invoice."totalAmount"<=0 THEN RAISE EXCEPTION 'FINANCE_INVOICE_EMPTY' USING ERRCODE='P0001';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=invoice."partyId" AND active AND kind IN ('CLIENT','BOTH')) THEN RAISE EXCEPTION 'FINANCE_INVOICE_PARTY' USING ERRCODE='P0001';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=invoice."receivableAccountId" AND active AND "isPosting" AND NOT "isContra" AND currency='PKR' AND "controlType"='RECEIVABLES' AND type='ASSET') OR EXISTS(
   SELECT 1 FROM public."FinanceInvoiceLine" l JOIN public."FinanceAccount" a ON a.id=l."revenueAccountId" WHERE l."invoiceId"=source_id AND (NOT a.active OR NOT a."isPosting" OR a."isContra" OR a.currency<>'PKR' OR a.type NOT IN ('INCOME','OTHER_INCOME') OR a."controlType"<>'NONE')) OR EXISTS(
   SELECT 1 FROM public."FinanceInvoiceLine" l JOIN public."FinanceAccount" a ON a.id=l."deferredAccountId" WHERE l."invoiceId"=source_id AND l.recognition='DEFERRED' AND (NOT a.active OR NOT a."isPosting" OR a."isContra" OR a.currency<>'PKR' OR a.type<>'LIABILITY' OR a."controlType"<>'DEFERRED_REVENUE')) THEN RAISE EXCEPTION 'FINANCE_INVOICE_MAPPING' USING ERRCODE='P0001';END IF;
  IF (invoice."projectId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Project" WHERE id=invoice."projectId" AND "archivedAt" IS NULL)) OR EXISTS(SELECT 1 FROM public."FinanceInvoiceLine" l JOIN public."Project" p ON p.id=l."projectId" WHERE l."invoiceId"=source_id AND p."archivedAt" IS NOT NULL) THEN RAISE EXCEPTION 'FINANCE_PROJECT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 ELSIF source_kind='CUSTOMER_DOCUMENT' THEN
  SELECT * INTO customer FROM public."FinanceCustomerDocument" WHERE id=source_id FOR UPDATE;
  IF customer.id IS NULL OR customer."postingDate"<>posting_date THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_customer_validate(source_id);
 ELSE
  SELECT * INTO draft FROM public."FinanceJournalDraft" WHERE id=source_id FOR UPDATE;
  IF draft.id IS NULL OR (source_kind='JOURNAL_DRAFT' AND (draft.state<>'DRAFT' OR draft."postingDate"<>posting_date)) OR (source_kind='JOURNAL_REVERSAL' AND draft.state<>'POSTED') THEN RAISE EXCEPTION 'FINANCE_DRAFT_IMMUTABLE' USING ERRCODE='P0001';END IF;
  IF source_kind='JOURNAL_REVERSAL' THEN
   SELECT * INTO original FROM public."FinanceJournalEntry" WHERE "draftId"=source_id AND "sourceType"='JOURNAL_DRAFT' FOR UPDATE;
   IF original.id IS NULL OR EXISTS(SELECT 1 FROM public."FinanceJournalEntry" WHERE "reversalOfId"=original.id) OR posting_date<original."postingDate" THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001';END IF;
  END IF;
 END IF;
 SELECT id INTO period_id FROM public."FinancePeriod" WHERE state='OPEN' AND posting_date BETWEEN "startDate" AND "endDate" FOR UPDATE;
 IF period_id IS NULL THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF posting_date>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'FINANCE_FUTURE_DATE' USING ERRCODE='P0001';END IF;
 IF source_kind='JOURNAL_DRAFT' THEN
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","draftId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'JOURNAL_DRAFT',draft.id,'POST',draft.id,posting_date,period_id,draft.description,draft.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId") SELECT gen_random_uuid(),entry_id,sequence,"accountId",description,debit,credit,"projectId" FROM public."FinanceJournalDraftLine" WHERE "draftId"=draft.id ORDER BY "accountId",sequence;
  UPDATE public."FinanceJournalDraft" SET state='POSTED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=draft.id;
 ELSIF source_kind='JOURNAL_REVERSAL' THEN
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","postingDate","periodId",description,evidence,"postedById","reversalOfId") VALUES(entry_id,'JRN-'||entry_id::text,'JOURNAL_REVERSAL',original.id,'REVERSE',posting_date,period_id,original.description,reason,actor,original.id);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId") SELECT gen_random_uuid(),entry_id,sequence,"accountId",description,credit,debit,"projectId" FROM public."FinanceJournalLine" WHERE "journalId"=original.id ORDER BY "accountId",sequence;
 ELSIF source_kind='ASSET_MOVEMENT' THEN
  IF EXISTS(SELECT 1 FROM public.encova_finance_asset_movement_lines(asset_movement.id)) THEN
   INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","assetMovementId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'ASSET_MOVEMENT',asset_movement.id,'POST',asset_movement.id,posting_date,period_id,asset_movement.description,asset_movement.evidence,actor);
   INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId") SELECT gen_random_uuid(),entry_id,x.* FROM public.encova_finance_asset_movement_lines(asset_movement.id)x ORDER BY x."accountId",x.sequence;
  ELSE entry_id:=NULL;UPDATE public."FinancePeriod" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=period_id;END IF;
  PERFORM public.encova_finance_asset_movement_effects(actor,asset_movement.id,entry_id);
 ELSIF source_kind='MOVEMENT' THEN
  IF public.encova_finance_investment_register_only(movement.id) THEN entry_id:=NULL;UPDATE public."FinancePeriod" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=period_id;ELSE
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","movementId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'MOVEMENT',movement.id,'POST',movement.id,posting_date,period_id,movement.description,movement.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId") SELECT gen_random_uuid(),entry_id,x.* FROM public.encova_finance_movement_lines(movement.id) x ORDER BY x."accountId",x.sequence;
  END IF;
  PERFORM public.encova_finance_movement_effects(actor,movement.id,entry_id);
 ELSIF source_kind='SUPPLIER_DOCUMENT' THEN
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","supplierDocumentId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'SUPPLIER_DOCUMENT',supplier.id,'POST',supplier.id,posting_date,period_id,supplier.description,supplier.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId","billLineId") SELECT gen_random_uuid(),entry_id,x.* FROM public.encova_finance_supplier_lines(supplier.id) x ORDER BY x."accountId",x.sequence;
  PERFORM public.encova_finance_supplier_effects(actor,supplier.id,entry_id);
 ELSIF source_kind='SUPPLIER_DOCUMENT' THEN
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","supplierDocumentId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'SUPPLIER_DOCUMENT',supplier.id,'POST',supplier.id,posting_date,period_id,supplier.description,supplier.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId","billLineId") SELECT gen_random_uuid(),entry_id,x.* FROM public.encova_finance_supplier_lines(supplier.id) x ORDER BY x."accountId",x.sequence;
  PERFORM public.encova_finance_supplier_effects(actor,supplier.id,entry_id);
 ELSIF source_kind='BILL' THEN
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","billId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'BILL',bill.id,'POST',bill.id,posting_date,period_id,bill.description,bill.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId","billLineId") SELECT gen_random_uuid(),entry_id,x.* FROM public.encova_finance_bill_lines(bill.id) x ORDER BY x."accountId",x.sequence;
  PERFORM public.encova_finance_bill_effects(bill.id,entry_id);
 ELSIF source_kind='CUSTOMER_DOCUMENT' THEN
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","customerDocumentId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'CUSTOMER_DOCUMENT',customer.id,'POST',customer.id,posting_date,period_id,customer.description,customer.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId") SELECT gen_random_uuid(),entry_id,x.* FROM public.encova_finance_customer_lines(customer.id) x ORDER BY x."accountId",x.sequence;
  PERFORM public.encova_finance_customer_effects(actor,customer.id,entry_id);
 ELSE
  INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","invoiceId","postingDate","periodId",description,evidence,"postedById") VALUES(entry_id,'JRN-'||entry_id::text,'INVOICE',invoice.id,'POST',invoice.id,posting_date,period_id,invoice.description,invoice.evidence,actor);
  INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId") SELECT gen_random_uuid(),entry_id,x.* FROM public.encova_finance_invoice_lines(invoice.id) x ORDER BY x."accountId",x.sequence;
  INSERT INTO public."FinanceReceivableEvent"(id,"invoiceId","partyId","accountId","journalId","effectiveDate",kind,amount) VALUES(gen_random_uuid(),invoice.id,invoice."partyId",invoice."receivableAccountId",entry_id,posting_date,'INVOICE',invoice."totalAmount");
  INSERT INTO public."FinanceDeferredRevenueEvent"(id,"invoiceLineId","journalId","effectiveDate",kind,amount) SELECT gen_random_uuid(),id,entry_id,posting_date,'BILLED',"netAmount" FROM public."FinanceInvoiceLine" WHERE "invoiceId"=invoice.id AND recognition='DEFERRED' AND "netAmount">0;
  SELECT array_agg(id) INTO mappings FROM public."FinanceAccount" WHERE id=invoice."receivableAccountId" OR id IN(SELECT "revenueAccountId" FROM public."FinanceInvoiceLine" WHERE "invoiceId"=invoice.id) OR id IN(SELECT "deferredAccountId" FROM public."FinanceInvoiceLine" WHERE "invoiceId"=invoice.id);
  PERFORM public.encova_finance_mark_accounts(mappings);
  UPDATE public."FinanceParty" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=invoice."partyId";
  UPDATE public."FinanceInvoice" SET state='POSTED',version=version+1,"partySnapshot"=public.encova_finance_party_snapshot("partyId"),"updatedAt"=CURRENT_TIMESTAMP WHERE id=invoice.id;
 END IF;
 RETURN entry_id;
END $$;
CREATE OR REPLACE FUNCTION encova_finance_journal_header_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE period public."FinancePeriod"%ROWTYPE;
BEGIN
 SELECT * INTO period FROM public."FinancePeriod" WHERE id=NEW."periodId" FOR UPDATE;
 IF period.id IS NULL OR period.state<>'OPEN' OR NEW."postingDate" NOT BETWEEN period."startDate" AND period."endDate" THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 IF NEW."postingDate">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'FINANCE_FUTURE_DATE' USING ERRCODE='P0001'; END IF;
 IF NEW."sourceType"='SUPPLIER_DOCUMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE id=NEW."supplierDocumentId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='SUPPLIER_DOCUMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE id=NEW."supplierDocumentId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='ASSET_MOVEMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceAssetMovement" WHERE id=NEW."assetMovementId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='MOVEMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceMovement" WHERE id=NEW."movementId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='BILL' AND NOT EXISTS(SELECT 1 FROM public."FinanceBill" WHERE id=NEW."billId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='INVOICE' AND NOT EXISTS(SELECT 1 FROM public."FinanceInvoice" WHERE id=NEW."invoiceId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='CUSTOMER_DOCUMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" WHERE id=NEW."customerDocumentId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
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
DO $$ DECLARE f RECORD;t TEXT;role_name TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceAssetMovement','FinanceAssetEvent'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);END IF;FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,role_name);END IF;END LOOP;END LOOP;
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND(proname LIKE 'encova_finance_asset_%' OR proname='encova_finance_check_asset_movement') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);FOREACH role_name IN ARRAY ARRAY['anon','authenticated','encova_app'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,role_name);END IF;END LOOP;END LOOP;
 REVOKE ALL ON SEQUENCE public.finance_asset_movement_number FROM PUBLIC;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION encova_finance_asset_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID),encova_finance_asset_movement_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID) TO encova_app;END IF;
END $$;
COMMIT;
