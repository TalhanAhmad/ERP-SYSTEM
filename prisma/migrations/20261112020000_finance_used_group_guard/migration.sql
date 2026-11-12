-- Protect ancestor mappings once any descendant is used, preserving migration 21 and all data.
CREATE OR REPLACE FUNCTION encova_finance_account_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE parent public."FinanceAccount"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_RETAINED' USING ERRCODE='P0001'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD."usedAt" IS NOT NULL AND NEW."usedAt" IS DISTINCT FROM OLD."usedAt" THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_USED' USING ERRCODE='P0001'; END IF;
  IF (OLD."usedAt" IS NOT NULL OR EXISTS(WITH RECURSIVE descendants AS (
   SELECT id,"usedAt" FROM public."FinanceAccount" WHERE "parentId"=OLD.id
   UNION SELECT a.id,a."usedAt" FROM public."FinanceAccount" a JOIN descendants d ON a."parentId"=d.id
  ) SELECT 1 FROM descendants WHERE "usedAt" IS NOT NULL)) AND (
   ROW(NEW.code,NEW.type,NEW."normalSide",NEW."reportGroup",NEW."controlType",NEW.currency,NEW."parentId",NEW."isPosting",NEW."isContra",NEW."isCashEquivalent") IS DISTINCT FROM
   ROW(OLD.code,OLD.type,OLD."normalSide",OLD."reportGroup",OLD."controlType",OLD.currency,OLD."parentId",OLD."isPosting",OLD."isContra",OLD."isCashEquivalent")) THEN
   RAISE EXCEPTION 'FINANCE_ACCOUNT_USED' USING ERRCODE='P0001'; END IF;
 END IF;
 IF NEW."parentId" IS NOT NULL THEN
  SELECT * INTO parent FROM public."FinanceAccount" WHERE id=NEW."parentId";
  IF parent.id IS NULL OR parent."isPosting" OR parent.type<>NEW.type OR parent."reportGroup"<>NEW."reportGroup" OR (NEW.active AND NOT parent.active) THEN
   RAISE EXCEPTION 'FINANCE_ACCOUNT_PARENT' USING ERRCODE='P0001'; END IF;
  IF EXISTS(WITH RECURSIVE ancestors AS (
   SELECT id,"parentId" FROM public."FinanceAccount" WHERE id=NEW."parentId"
   UNION SELECT a.id,a."parentId" FROM public."FinanceAccount" a JOIN ancestors x ON a.id=x."parentId"
  ) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_CYCLE' USING ERRCODE='P0001'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE "parentId"=NEW.id AND
  (NEW."isPosting" OR type<>NEW.type OR "reportGroup"<>NEW."reportGroup" OR (active AND NOT NEW.active))) THEN
  RAISE EXCEPTION 'FINANCE_ACCOUNT_CHILDREN' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
