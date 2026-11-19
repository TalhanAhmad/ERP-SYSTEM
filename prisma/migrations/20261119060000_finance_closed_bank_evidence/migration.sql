BEGIN;
-- A finalized bank proof used by an issued period close cannot be reopened underneath that close.
CREATE FUNCTION encova_finance_close_bank_reopen_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF OLD.state='FINALIZED' AND NEW.state='REOPENED' THEN PERFORM public.encova_finance_close_assert_open(OLD."cutoffDate");END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceReconciliation_period_close" BEFORE UPDATE ON "FinanceReconciliation" FOR EACH ROW EXECUTE FUNCTION encova_finance_close_bank_reopen_guard();
REVOKE ALL ON FUNCTION encova_finance_close_bank_reopen_guard() FROM PUBLIC;
DO $$ DECLARE r TEXT;BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','encova_app'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.encova_finance_close_bank_reopen_guard() FROM %I',r);END IF;END LOOP;END $$;
COMMIT;
