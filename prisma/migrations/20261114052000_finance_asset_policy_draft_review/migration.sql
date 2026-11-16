-- Unposted monthly drafts retain identity and can be refreshed under a new reviewed plan.
BEGIN;
CREATE OR REPLACE FUNCTION encova_finance_asset_movement_validate(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE d public."FinanceAssetMovement"%ROWTYPE;a public."FinanceAsset"%ROWTYPE;o public."FinanceAssetMovement"%ROWTYPE;p RECORD;plan JSONB;first_month DATE;charge_index INTEGER;BEGIN
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
  IF d.amount<>0 OR d."newResidual" IS NULL OR d."newResidual"<0 OR d."newResidual">p.carrying OR d."newLifeMonths" IS NULL OR d."newFirstMonth" IS NULL OR d."newFirstMonth"<to_char(greatest(a."inServiceDate",d."postingDate"),'YYYY-MM') OR EXISTS(SELECT 1 FROM public."FinanceAssetMovement" WHERE "assetId"=a.id AND kind='DEPRECIATION' AND state='POSTED' AND month>=d."newFirstMonth") THEN RAISE EXCEPTION 'FINANCE_ASSET_POLICY' USING ERRCODE='P0001';END IF;
 END IF;
 IF d.kind IN('ADJUSTMENT_INCREASE','ADJUSTMENT_DECREASE') AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."counterAccountId" AND active AND "isPosting" AND "controlType"='NONE' AND NOT "isContra") THEN RAISE EXCEPTION 'FINANCE_ASSET_MAPPING' USING ERRCODE='P0001';END IF;
 IF d.kind='DISPOSAL' THEN
  IF(d.amount<>d."feeAmount" AND NOT EXISTS(SELECT 1 FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" account ON account.id=c."glAccountId" WHERE c.id=d."cashAccountId" AND c.active AND account.active AND account."controlType"='CASH')) OR(d.amount=d."feeAmount" AND d."cashAccountId" IS NOT NULL) OR NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."gainAccountId" AND active AND "isPosting" AND "controlType"='NONE' AND type='OTHER_INCOME' AND NOT "isContra") OR NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."lossAccountId" AND active AND "isPosting" AND "controlType"='NONE' AND type='OTHER_EXPENSE' AND NOT "isContra") OR(d."feeAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."feeAccountId" AND active AND "isPosting" AND "controlType"='NONE' AND type IN('OPERATING_EXPENSE','OTHER_EXPENSE') AND NOT "isContra")) THEN RAISE EXCEPTION 'FINANCE_ASSET_MAPPING' USING ERRCODE='P0001';END IF;
 END IF;
END $$;
COMMIT;
