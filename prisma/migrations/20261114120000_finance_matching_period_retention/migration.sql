BEGIN;
-- Matching is nonposting, but its intrinsic effective period is retained just like a dated source.
CREATE FUNCTION encova_finance_bank_match_period_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE period_id UUID;BEGIN
 IF NEW."effectiveDate">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'FINANCE_FUTURE_DATE' USING ERRCODE='P0001';END IF;
 SELECT id INTO period_id FROM public."FinancePeriod" WHERE state='OPEN' AND NEW."effectiveDate" BETWEEN "startDate" AND "endDate" FOR UPDATE;
 IF period_id IS NULL THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 UPDATE public."FinancePeriod" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=period_id;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceBankMatchEvent_period_valid" BEFORE INSERT ON "FinanceBankMatchEvent" FOR EACH ROW EXECUTE FUNCTION encova_finance_bank_match_period_guard();
REVOKE ALL ON FUNCTION encova_finance_bank_match_period_guard() FROM PUBLIC;
DO $$ DECLARE r TEXT;BEGIN FOREACH r IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.encova_finance_bank_match_period_guard() FROM %I',r);END IF;END LOOP;END $$;
COMMIT;
