BEGIN;
CREATE OR REPLACE FUNCTION encova_finance_reconciliation_statement_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF OLD.state='DRAFT' AND NEW.state='IMPORTED' AND EXISTS(SELECT 1 FROM public."FinanceReconciliation" r WHERE r.state='FINALIZED' AND r."statementBatchId" IS NULL AND r."cashAccountId"=NEW."cashAccountId" AND EXISTS(SELECT 1 FROM public."FinanceStatementLine" l WHERE l."batchId"=NEW.id AND l."valueDate" BETWEEN r."startDate" AND r."cutoffDate")) THEN RAISE EXCEPTION 'FINANCE_RECON_CLOSED' USING ERRCODE='P0001';END IF;
 IF OLD.state='IMPORTED'  AND NEW.state='VOIDED' AND EXISTS(SELECT 1 FROM public."FinanceReconciliation" r WHERE r.state='FINALIZED' AND(r."statementBatchId"=OLD.id OR EXISTS(SELECT 1 FROM public."FinanceReconciliationNote" n JOIN public."FinanceStatementLine" l ON l.id=n."peerStatementLineId" WHERE n."reconciliationId"=r.id AND l."batchId"=OLD.id))) THEN RAISE EXCEPTION 'FINANCE_RECON_CLOSED' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE FUNCTION encova_finance_reconciliation_mapping_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF ROW(NEW."glAccountId",NEW.currency,NEW.kind,NEW."maskedReference") IS DISTINCT FROM ROW(OLD."glAccountId",OLD.currency,OLD.kind,OLD."maskedReference") AND EXISTS(SELECT 1 FROM public."FinanceReconciliation" r WHERE r."cashAccountId"=OLD.id) THEN RAISE EXCEPTION 'FINANCE_MASTER_USED' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceCashAccount_reconciliation_mapping_valid" BEFORE UPDATE ON "FinanceCashAccount" FOR EACH ROW EXECUTE FUNCTION encova_finance_reconciliation_mapping_guard();
REVOKE ALL ON FUNCTION encova_finance_reconciliation_mapping_guard() FROM PUBLIC;
DO $$ DECLARE r TEXT;BEGIN FOREACH r IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION public.encova_finance_reconciliation_mapping_guard() FROM %I',r);END IF;END LOOP;END $$;
COMMIT;
