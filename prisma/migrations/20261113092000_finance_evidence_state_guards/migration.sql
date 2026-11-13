BEGIN;
CREATE OR REPLACE FUNCTION encova_finance_file_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE n BIGINT;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'RESERVED' OR NEW.version<>1 OR NEW."scanResult" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  SELECT count(*) INTO n FROM public."FinanceFile" WHERE state<>'REMOVED' AND ROW("invoiceId","billId","customerDocumentId","supplierDocumentId","journalDraftId") IS NOT DISTINCT FROM ROW(NEW."invoiceId",NEW."billId",NEW."customerDocumentId",NEW."supplierDocumentId",NEW."journalDraftId");
  IF n>=10 THEN RAISE EXCEPTION 'FINANCE_FILE_LIMIT' USING ERRCODE='P0001';END IF;
 ELSE
  IF NEW.state='REMOVED' AND OLD.state<>'REMOVED' THEN
   IF public.encova_finance_file_source(CASE WHEN OLD."invoiceId" IS NOT NULL THEN 'INVOICE' WHEN OLD."billId" IS NOT NULL THEN 'BILL' WHEN OLD."customerDocumentId" IS NOT NULL THEN 'CUSTOMER_DOCUMENT' WHEN OLD."supplierDocumentId" IS NOT NULL THEN 'SUPPLIER_DOCUMENT' ELSE 'JOURNAL_DRAFT' END,coalesce(OLD."invoiceId",OLD."billId",OLD."customerDocumentId",OLD."supplierDocumentId",OLD."journalDraftId"))<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;
  END IF;
  IF NEW.state IN('CLEAN','REJECTED') AND OLD.state='QUARANTINED' THEN
   IF NOT public.encova_finance_file_scan_signature(OLD.id,NEW."scanResult",OLD."intentHash") OR(NEW.state='CLEAN') IS DISTINCT FROM(NEW."scanResult"->>'status'='CLEAN') THEN RAISE EXCEPTION 'FINANCE_FILE_SIGNATURE' USING ERRCODE='P0001';END IF;
  END IF;
  IF(to_jsonb(NEW)-ARRAY['state','version','intentHash','intentProvider','intentSessionId','intentVerifiedAt','scanResult','updatedAt','intentActorId','blobDeletedAt']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','intentHash','intentProvider','intentSessionId','intentVerifiedAt','scanResult','updatedAt','intentActorId','blobDeletedAt']) OR NEW.version<>OLD.version+1 OR(OLD.state IN('CLEAN','REJECTED') AND NEW.state<>'REMOVED') OR(OLD.state='REMOVED' AND NEW.state<>'REMOVED') OR NOT((OLD.state=NEW.state AND NEW.state IN('RESERVED','QUARANTINED')) OR(OLD.state='RESERVED' AND NEW.state='QUARANTINED') OR(OLD.state='QUARANTINED' AND NEW.state IN('CLEAN','REJECTED')) OR NEW.state='REMOVED') THEN RAISE EXCEPTION 'FINANCE_FILE_RETAINED' USING ERRCODE='P0001';END IF;
 END IF;RETURN NEW;END $$;
COMMIT;
