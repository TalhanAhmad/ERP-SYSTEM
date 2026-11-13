BEGIN;
CREATE OR REPLACE FUNCTION encova_finance_supplier_credit_split_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE id=NEW."documentId" AND kind='SUPPLIER_CREDIT' AND state='DRAFT') THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_IMMUTABLE' USING ERRCODE='P0001';END IF;RETURN NEW;END $$;
DROP TRIGGER "FinanceSupplierCreditSplit_guard" ON "FinanceSupplierCreditSplit";
CREATE TRIGGER "FinanceSupplierCreditSplit_guard" BEFORE INSERT ON "FinanceSupplierCreditSplit" FOR EACH ROW EXECUTE FUNCTION encova_finance_supplier_credit_split_guard();
REVOKE ALL ON FUNCTION encova_finance_supplier_credit_split_guard() FROM PUBLIC;
DO $$ DECLARE role_name TEXT;BEGIN FOREACH role_name IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION encova_finance_supplier_credit_split_guard() FROM %I',role_name);END IF;END LOOP;END $$;
COMMIT;
