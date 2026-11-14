BEGIN;
CREATE OR REPLACE FUNCTION encova_finance_movement_validate(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE d public."FinanceMovement"%ROWTYPE;mapped_account public."FinanceAccount"%ROWTYPE;b public."FinanceBill"%ROWTYPE;x RECORD;BEGIN
 SELECT * INTO d FROM public."FinanceMovement" WHERE id=target FOR UPDATE;
 IF d.id IS NULL OR d.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_MOVEMENT_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF d.kind IN('TRANSFER','REVERSAL') THEN PERFORM public.encova_finance_movement_validate_f20(target);ELSE
  IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=d."partyId" AND active) OR(d."projectId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Project" WHERE id=d."projectId" AND "archivedAt" IS NULL)) THEN RAISE EXCEPTION 'FINANCE_MOVEMENT_MAPPING' USING ERRCODE='P0001';END IF;
  SELECT * INTO mapped_account FROM public."FinanceAccount" WHERE id=d."controlAccountId";
  IF mapped_account.id IS NULL OR NOT mapped_account.active OR NOT mapped_account."isPosting" OR mapped_account.currency<>'PKR' OR mapped_account."isContra" OR mapped_account."controlType" IS DISTINCT FROM(CASE WHEN d.kind IN('CAPITAL_CONTRIBUTION','CAPITAL_RETURN','NONCASH_CAPITAL') THEN 'CAPITAL' WHEN d.kind='DISTRIBUTION' THEN 'DISTRIBUTION' ELSE 'FOUNDER_PAYABLE' END) THEN RAISE EXCEPTION 'FINANCE_MOVEMENT_MAPPING' USING ERRCODE='P0001';END IF;
  IF d.kind IN('CAPITAL_RETURN','DISTRIBUTION','NONCASH_CAPITAL') AND(d."approvalEvidence" IS NULL OR length(trim(d."approvalEvidence")) NOT BETWEEN 3 AND 1000) THEN RAISE EXCEPTION 'FINANCE_APPROVAL_REQUIRED' USING ERRCODE='P0001';END IF;
  IF d.kind='CAPITAL_CONTRIBUTION' THEN
   IF d."toCashId" IS NULL OR d."fromCashId" IS NOT NULL OR d."counterAccountId" IS NOT NULL OR d."billId" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  ELSIF d.kind IN('CAPITAL_RETURN','DISTRIBUTION','FOUNDER_REIMBURSEMENT') THEN
   IF d."fromCashId" IS NULL OR d."toCashId" IS NOT NULL OR d."counterAccountId" IS NOT NULL OR d."billId" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  ELSE
   IF d."fromCashId" IS NOT NULL OR d."toCashId" IS NOT NULL OR d."counterAccountId" IS NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   SELECT * INTO mapped_account FROM public."FinanceAccount" WHERE id=d."counterAccountId";
   IF mapped_account.id IS NULL OR NOT mapped_account.active OR NOT mapped_account."isPosting" OR mapped_account."isContra" OR mapped_account.currency<>'PKR' THEN RAISE EXCEPTION 'FINANCE_MOVEMENT_MAPPING' USING ERRCODE='P0001';END IF;
   IF d.kind='NONCASH_CAPITAL' AND(mapped_account.type<>'ASSET' OR mapped_account."controlType" NOT IN('NONE','FIXED_ASSET')) OR d.kind='FOUNDER_OUTLAY' AND(mapped_account.type NOT IN('ASSET','DIRECT_COST','OPERATING_EXPENSE','OTHER_EXPENSE') OR mapped_account."controlType" NOT IN('NONE','FIXED_ASSET')) THEN RAISE EXCEPTION 'FINANCE_MOVEMENT_MAPPING' USING ERRCODE='P0001';END IF;
   IF d.kind='FOUNDER_BILL_SETTLEMENT' THEN
    SELECT * INTO b FROM public."FinanceBill" WHERE id=d."billId" FOR UPDATE;
    IF b.id IS NULL OR b.state<>'POSTED' OR b.kind<>'BILL' OR b."postingDate">d."postingDate" OR b."payableAccountId"<>mapped_account.id OR public.encova_finance_ap_capacity(b.id,d."postingDate")<d.amount THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
   ELSIF d."billId" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  END IF;
  IF coalesce(d."fromCashId",d."toCashId") IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" bank_gl ON bank_gl.id=c."glAccountId" WHERE c.id=coalesce(d."fromCashId",d."toCashId") AND c.active AND bank_gl.active AND bank_gl.currency='PKR' AND bank_gl."isPosting" AND bank_gl."controlType"='CASH') THEN RAISE EXCEPTION 'FINANCE_MOVEMENT_MAPPING' USING ERRCODE='P0001';END IF;
 END IF;
 FOR x IN SELECT * FROM public.encova_finance_funding_expected(target) LOOP IF x.bucket<>'DISTRIBUTION' AND x.amount<0 AND public.encova_finance_funding_capacity(x."partyId",x."accountId",x.bucket,d."postingDate") < -x.amount THEN RAISE EXCEPTION 'FINANCE_FUNDING_CAPACITY' USING ERRCODE='P0001';END IF;END LOOP;
END $$;
COMMIT;
