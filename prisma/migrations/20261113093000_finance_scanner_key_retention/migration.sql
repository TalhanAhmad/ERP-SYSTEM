BEGIN;
CREATE FUNCTION encova_finance_file_authority_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' OR(to_jsonb(NEW)-'active') IS DISTINCT FROM(to_jsonb(OLD)-'active') THEN RAISE EXCEPTION 'FINANCE_SCANNER_KEY_IMMUTABLE' USING ERRCODE='P0001';END IF;RETURN NEW;END $$;
CREATE TRIGGER "FinanceScanAuthority_guard" BEFORE UPDATE OR DELETE ON "FinanceScanAuthority" FOR EACH ROW EXECUTE FUNCTION encova_finance_file_authority_guard();
CREATE TRIGGER "FinanceScanAuthority_config" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceScanAuthority" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_config_lock();
REVOKE ALL ON FUNCTION encova_finance_file_authority_guard() FROM PUBLIC;
DO $$ DECLARE role_name TEXT;BEGIN FOREACH role_name IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION encova_finance_file_authority_guard() FROM %I',role_name);END IF;END LOOP;END $$;
COMMIT;
