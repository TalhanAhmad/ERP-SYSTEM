BEGIN;
CREATE TABLE "FinanceOpeningBatch"(
 id UUID PRIMARY KEY,name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),"cutoverDate" DATE NOT NULL CHECK("cutoverDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),"clearingAccountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,"fileName" TEXT NOT NULL,"sourceText" TEXT NOT NULL CHECK(octet_length("sourceText")<=180000),"sourceHash" TEXT NOT NULL UNIQUE CHECK("sourceHash"=encode(sha256(convert_to("sourceText",'UTF8')),'hex')),evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 1000),state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','POSTED','VOIDED')),version INTEGER NOT NULL DEFAULT 1,"createdById" UUID NOT NULL REFERENCES "Person" ON DELETE RESTRICT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"postedById" UUID REFERENCES "Person" ON DELETE RESTRICT,"postedAt" TIMESTAMPTZ,"reviewEvidence" TEXT,"basisHash" TEXT,proof JSONB,CHECK((state='POSTED')=("postedById" IS NOT NULL AND "postedAt" IS NOT NULL AND "reviewEvidence" IS NOT NULL AND "basisHash" IS NOT NULL AND proof IS NOT NULL))
);
CREATE UNIQUE INDEX "FinanceOpeningBatch_once" ON "FinanceOpeningBatch"((1)) WHERE state='POSTED';
CREATE TABLE "FinanceOpeningLine"(
 id UUID PRIMARY KEY,"batchId" UUID NOT NULL REFERENCES "FinanceOpeningBatch" ON DELETE RESTRICT,sequence INTEGER NOT NULL,"cashSide" TEXT NOT NULL DEFAULT 'DEBIT' CHECK("cashSide" IN('DEBIT','CREDIT')),kind TEXT NOT NULL CHECK(kind IN('TB','AR','AP','CASH','LOAN_PRINCIPAL','LOAN_INTEREST','INVESTMENT','INVESTMENT_INCOME','ASSET','CAPITAL','DISTRIBUTION','FOUNDER_PAYABLE','CLIENT_ADVANCE','SUPPLIER_ADVANCE','DEFERRED')),
 "accountId" UUID NOT NULL REFERENCES "FinanceAccount" ON DELETE RESTRICT,debit NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK(debit>=0),credit NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK(credit>=0),amount NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK(amount>=0),reference TEXT NOT NULL,"originalDate" DATE,"dueDate" DATE,description TEXT NOT NULL,
 "partyId" UUID REFERENCES "FinanceParty" ON DELETE RESTRICT,"cashAccountId" UUID REFERENCES "FinanceCashAccount" ON DELETE RESTRICT,"loanId" UUID REFERENCES "FinanceLoan" ON DELETE RESTRICT,"holdingId" UUID REFERENCES "FinanceInvestmentHolding" ON DELETE RESTRICT,"secondaryAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,"resultAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,"receivableAccountId" UUID REFERENCES "FinanceAccount" ON DELETE RESTRICT,
 "costBasis" NUMERIC(20,2),accumulated NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK(accumulated>=0),units NUMERIC(20,6),tag TEXT,location TEXT,"inServiceDate" DATE,residual NUMERIC(20,2) NOT NULL DEFAULT 0,"remainingMonths" INTEGER,"firstDepMonth" TEXT,"policyEvidence" TEXT,
 UNIQUE("batchId",sequence),CHECK((kind='TB' AND(debit>0 AND credit=0 OR credit>0 AND debit=0) AND amount=0) OR(kind<>'TB' AND amount>0 AND debit=0 AND credit=0)),CHECK(kind='TB' OR("originalDate" IS NOT NULL AND length(trim(reference)) BETWEEN 1 AND 80))
);
CREATE INDEX "FinanceOpeningLine_batchId_kind_sequence_idx" ON "FinanceOpeningLine"("batchId",kind,sequence);
CREATE UNIQUE INDEX "FinanceOpeningLine_tb_account" ON "FinanceOpeningLine"("batchId","accountId") WHERE kind='TB';
CREATE UNIQUE INDEX "FinanceOpeningLine_source_reference" ON "FinanceOpeningLine"("batchId",kind,coalesce("partyId"::text,''),reference) WHERE kind<>'TB';
CREATE UNIQUE INDEX "FinanceOpeningLine_cash_once" ON "FinanceOpeningLine"("batchId","cashAccountId") WHERE kind='CASH';
CREATE UNIQUE INDEX "FinanceOpeningLine_loan_bucket_once" ON "FinanceOpeningLine"("batchId","loanId",kind) WHERE kind IN('LOAN_PRINCIPAL','LOAN_INTEREST');
CREATE UNIQUE INDEX "FinanceOpeningLine_asset_tag_once" ON "FinanceOpeningLine"("batchId",tag) WHERE kind='ASSET';
CREATE TABLE "FinanceOpeningPosting"(id UUID PRIMARY KEY,"batchId" UUID NOT NULL REFERENCES "FinanceOpeningBatch" ON DELETE RESTRICT,"lineId" UUID UNIQUE REFERENCES "FinanceOpeningLine" ON DELETE RESTRICT,"journalId" UUID NOT NULL UNIQUE REFERENCES "FinanceJournalEntry" ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED);
CREATE TRIGGER "FinanceOpeningBatch_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceOpeningBatch" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_close_lock();
CREATE TRIGGER "FinanceOpeningLine_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceOpeningLine" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_close_lock();
CREATE TRIGGER "FinanceOpeningPosting_lock" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceOpeningPosting" FOR EACH STATEMENT EXECUTE FUNCTION encova_finance_close_lock();
CREATE TRIGGER "FinanceOpeningLine_immutable" BEFORE UPDATE OR DELETE ON "FinanceOpeningLine" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
CREATE TRIGGER "FinanceOpeningPosting_immutable" BEFORE UPDATE OR DELETE ON "FinanceOpeningPosting" FOR EACH ROW EXECUTE FUNCTION encova_finance_audit_immutable();
CREATE FUNCTION encova_finance_opening_typed(control TEXT) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT control IN('CASH','RECEIVABLES','PAYABLES','CLIENT_ADVANCE','SUPPLIER_ADVANCE','FIXED_ASSET','ACCUMULATED_DEPRECIATION','INVESTMENT','INVESTMENT_INCOME_RECEIVABLE','LOAN_RECEIVABLE','LOAN_PAYABLE','INTEREST_RECEIVABLE','INTEREST_PAYABLE','DEFERRED_REVENUE','CAPITAL','DISTRIBUTION','FOUNDER_PAYABLE') $$;
CREATE FUNCTION encova_finance_opening_sign(kind TEXT,account_id UUID,cash_side TEXT DEFAULT NULL) RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN kind='CASH' AND cash_side='CREDIT' THEN -1 WHEN kind IN('AP','CLIENT_ADVANCE','DEFERRED','CAPITAL','FOUNDER_PAYABLE') THEN -1 WHEN kind IN('LOAN_PRINCIPAL','LOAN_INTEREST') AND a."normalSide"='CREDIT' THEN -1 ELSE 1 END FROM public."FinanceAccount" a WHERE a.id=account_id
$$;
CREATE FUNCTION encova_finance_opening_legs(target UUID) RETURNS TABLE(sequence INTEGER,"accountId" UUID,description TEXT,debit NUMERIC,credit NUMERIC,"partyId" UUID,"invoiceLineId" UUID,"billLineId" UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH source AS(SELECT p.id,p."lineId",b."clearingAccountId",l.kind,l."cashSide",l."accountId",l.amount,l.accumulated,l."secondaryAccountId",l."partyId",l.description FROM public."FinanceOpeningPosting" p JOIN public."FinanceOpeningBatch" b ON b.id=p."batchId" LEFT JOIN public."FinanceOpeningLine" l ON l.id=p."lineId" WHERE p.id=target),
 raw AS(
 SELECT t.sequence::bigint AS ordering,t."accountId",t.description,t.debit-t.credit AS signed,NULL::uuid AS "partyId",NULL::uuid AS "invoiceLineId",NULL::uuid AS "billLineId" FROM source s JOIN public."FinanceOpeningPosting" p ON p.id=s.id JOIN public."FinanceOpeningLine" t ON t."batchId"=p."batchId" AND t.kind='TB' JOIN public."FinanceAccount" a ON a.id=t."accountId" WHERE s."lineId" IS NULL AND NOT public.encova_finance_opening_typed(a."controlType")
 UNION ALL SELECT 1,s."accountId",s.description,s.amount*public.encova_finance_opening_sign(s.kind,s."accountId",s."cashSide"),s."partyId",NULL::uuid,NULL::uuid FROM source s WHERE s."lineId" IS NOT NULL
 UNION ALL SELECT 2,s."secondaryAccountId",s.description,-s.accumulated,NULL::uuid,NULL::uuid,NULL::uuid FROM source s WHERE s.kind='ASSET' AND s.accumulated>0),
 counter AS(SELECT 999999 AS ordering,s."clearingAccountId" AS "accountId",'Opening clearing proof'::text AS description,-sum(r.signed) AS signed,NULL::uuid AS "partyId",NULL::uuid AS "invoiceLineId",NULL::uuid AS "billLineId" FROM source s CROSS JOIN raw r GROUP BY s."clearingAccountId" HAVING sum(r.signed)<>0),all_lines AS(SELECT * FROM raw UNION ALL SELECT * FROM counter)
 SELECT row_number() OVER(ORDER BY ordering,"accountId")::integer,"accountId",description,greatest(signed,0),greatest(-signed,0),"partyId","invoiceLineId","billLineId" FROM all_lines
$$;
CREATE FUNCTION encova_finance_opening_line_valid(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE l public."FinanceOpeningLine"%ROWTYPE;b public."FinanceOpeningBatch"%ROWTYPE;a public."FinanceAccount"%ROWTYPE;control TEXT;BEGIN
 SELECT * INTO l FROM public."FinanceOpeningLine" WHERE id=target;SELECT * INTO b FROM public."FinanceOpeningBatch" WHERE id=l."batchId";SELECT * INTO a FROM public."FinanceAccount" WHERE id=l."accountId";
 IF l.id IS NULL OR NOT a.active OR NOT a."isPosting" OR a.currency<>'PKR' OR l."accountId"=b."clearingAccountId" THEN RAISE EXCEPTION 'FINANCE_OPENING_MAPPING' USING ERRCODE='P0001';END IF;
 IF l.kind='TB' THEN RETURN;END IF;
 IF l."originalDate">b."cutoverDate" OR l."originalDate"<DATE '0001-01-01' OR(l."dueDate" IS NOT NULL AND l."dueDate"<l."originalDate") OR length(trim(l.description)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 control:=CASE l.kind WHEN 'AR' THEN 'RECEIVABLES' WHEN 'AP' THEN 'PAYABLES' WHEN 'CASH' THEN 'CASH' WHEN 'INVESTMENT' THEN 'INVESTMENT' WHEN 'INVESTMENT_INCOME' THEN 'INVESTMENT_INCOME_RECEIVABLE' WHEN 'ASSET' THEN 'FIXED_ASSET' WHEN 'CAPITAL' THEN 'CAPITAL' WHEN 'DISTRIBUTION' THEN 'DISTRIBUTION' WHEN 'FOUNDER_PAYABLE' THEN 'FOUNDER_PAYABLE' WHEN 'CLIENT_ADVANCE' THEN 'CLIENT_ADVANCE' WHEN 'SUPPLIER_ADVANCE' THEN 'SUPPLIER_ADVANCE' WHEN 'DEFERRED' THEN 'DEFERRED_REVENUE' ELSE a."controlType" END;
 IF a."controlType"<>control OR a."isContra" THEN RAISE EXCEPTION 'FINANCE_OPENING_MAPPING' USING ERRCODE='P0001';END IF;
 IF l.kind IN('AR','AP','CAPITAL','DISTRIBUTION','FOUNDER_PAYABLE','CLIENT_ADVANCE','SUPPLIER_ADVANCE','DEFERRED') AND NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=l."partyId" AND active AND(kind IN('CLIENT','BOTH') AND l.kind IN('AR','CLIENT_ADVANCE','DEFERRED') OR kind IN('SUPPLIER','BOTH','EMPLOYEE') AND l.kind IN('AP','SUPPLIER_ADVANCE') OR l.kind IN('CAPITAL','DISTRIBUTION','FOUNDER_PAYABLE'))) THEN RAISE EXCEPTION 'FINANCE_OPENING_MAPPING' USING ERRCODE='P0001';END IF;
 IF l.kind IN('AR','AP') AND l."dueDate" IS NULL THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF l."cashSide"='CREDIT' AND(l.kind<>'CASH' OR NOT EXISTS(SELECT 1 FROM public."FinanceCashAccount" WHERE id=l."cashAccountId" AND kind='BANK') OR NOT EXISTS(SELECT 1 FROM public."FinanceStatementPolicy" WHERE "overdraftPresentation"='CURRENT_LIABILITY')) THEN RAISE EXCEPTION 'FINANCE_OPENING_MAPPING' USING ERRCODE='P0001';END IF;
 IF l.kind='CASH' AND NOT EXISTS(SELECT 1 FROM public."FinanceCashAccount" WHERE id=l."cashAccountId" AND "glAccountId"=a.id AND active) THEN RAISE EXCEPTION 'FINANCE_OPENING_MAPPING' USING ERRCODE='P0001';END IF;
 IF l.kind LIKE 'LOAN_%' AND NOT EXISTS(SELECT 1 FROM public."FinanceLoan" x WHERE x.id=l."loanId" AND x.active AND x."startDate"<=b."cutoverDate" AND CASE WHEN l.kind='LOAN_PRINCIPAL' THEN x."principalAccountId" ELSE x."interestAccountId" END=a.id AND a."controlType"=CASE WHEN l.kind='LOAN_PRINCIPAL' AND x.direction='RECEIVED' THEN 'LOAN_PAYABLE' WHEN l.kind='LOAN_PRINCIPAL' THEN 'LOAN_RECEIVABLE' WHEN x.direction='RECEIVED' THEN 'INTEREST_PAYABLE' ELSE 'INTEREST_RECEIVABLE' END AND(l.kind<>'LOAN_PRINCIPAL' OR l.amount<=x."agreedPrincipal")) THEN RAISE EXCEPTION 'FINANCE_OPENING_MAPPING' USING ERRCODE='P0001';END IF;
 IF l.kind LIKE 'INVESTMENT%' AND NOT EXISTS(SELECT 1 FROM public."FinanceInvestmentHolding" h WHERE h.id=l."holdingId" AND h.active AND h."policyStatus"='REVIEWED' AND CASE WHEN l.kind='INVESTMENT' THEN h."investmentAccountId" ELSE h."incomeControlAccountId" END=a.id AND(l.kind<>'INVESTMENT' OR((h."unitMode"='UNIT')=(l.units IS NOT NULL) AND(l.units IS NULL OR l.units>0) AND l."costBasis">0 AND(h."measurementMode"='MANUAL_VALUATION' OR l.amount<=l."costBasis")))) THEN RAISE EXCEPTION 'FINANCE_OPENING_MAPPING' USING ERRCODE='P0001';END IF;
 IF l.kind='DEFERRED' AND(NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=l."resultAccountId" AND active AND "isPosting" AND NOT "isContra" AND "controlType"='NONE' AND type IN('INCOME','OTHER_INCOME')) OR NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=l."receivableAccountId" AND active AND "isPosting" AND NOT "isContra" AND "controlType"='RECEIVABLES')) THEN RAISE EXCEPTION 'FINANCE_OPENING_MAPPING' USING ERRCODE='P0001';END IF;
 IF(l."loanId" IS NOT NULL AND l.kind NOT IN('LOAN_PRINCIPAL','LOAN_INTEREST')) OR(l."holdingId" IS NOT NULL AND l.kind NOT IN('INVESTMENT','INVESTMENT_INCOME')) OR(l."cashAccountId" IS NOT NULL AND l.kind<>'CASH') OR(l."secondaryAccountId" IS NOT NULL AND l.kind<>'ASSET') OR(l."resultAccountId" IS NOT NULL AND l.kind<>'DEFERRED') OR(l."receivableAccountId" IS NOT NULL AND l.kind<>'DEFERRED') THEN RAISE EXCEPTION 'FINANCE_OPENING_MAPPING' USING ERRCODE='P0001';END IF;
 IF l.kind='ASSET' AND(l."secondaryAccountId" IS NULL OR NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=l."secondaryAccountId" AND active AND "isPosting" AND "controlType"='ACCUMULATED_DEPRECIATION' AND "isContra") OR l.accumulated>l.amount OR l.residual<0 OR l.residual>l.amount-l.accumulated OR l.tag !~ '^[A-Z0-9._-]{3,40}$' OR l.location IS NULL OR l.tag IS NULL OR l."inServiceDate" IS NULL OR l."remainingMonths" IS NULL OR l."policyEvidence" IS NULL OR l."inServiceDate" NOT BETWEEN l."originalDate" AND b."cutoverDate" OR l."remainingMonths" NOT BETWEEN 1 AND 1200 OR l."firstDepMonth" IS NULL OR l."firstDepMonth"<to_char(b."cutoverDate",'YYYY-MM') OR length(trim(l."policyEvidence")) NOT BETWEEN 3 AND 1000) THEN RAISE EXCEPTION 'FINANCE_OPENING_MAPPING' USING ERRCODE='P0001';END IF;
END $$;
CREATE FUNCTION encova_finance_opening_pack(target UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE b public."FinanceOpeningBatch"%ROWTYPE;bad INTEGER:=0;rec RECORD;matches JSONB;debits NUMERIC;credits NUMERIC;masters JSONB;ready BOOLEAN;diagnostics JSONB:='[]';BEGIN
 SELECT * INTO b FROM public."FinanceOpeningBatch" WHERE id=target;IF b.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
 FOR rec IN SELECT id FROM public."FinanceOpeningLine" WHERE "batchId"=target LOOP BEGIN PERFORM public.encova_finance_opening_line_valid(rec.id);EXCEPTION WHEN SQLSTATE 'P0001' THEN bad:=bad+1;diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('id',rec.id,'code',SQLERRM));END;END LOOP;
 WITH items AS(SELECT l."accountId",sum(l.amount*public.encova_finance_opening_sign(l.kind,l."accountId",l."cashSide")) AS actual FROM public."FinanceOpeningLine" l WHERE l."batchId"=target AND l.kind<>'TB' GROUP BY l."accountId" UNION ALL SELECT "secondaryAccountId",-sum(accumulated) FROM public."FinanceOpeningLine" WHERE "batchId"=target AND kind='ASSET' GROUP BY "secondaryAccountId"),actual AS(SELECT "accountId",sum(actual) AS actual FROM items GROUP BY "accountId"),expected AS(SELECT t."accountId",t.debit-t.credit AS expected FROM public."FinanceOpeningLine" t JOIN public."FinanceAccount" a ON a.id=t."accountId" WHERE t."batchId"=target AND t.kind='TB' AND public.encova_finance_opening_typed(a."controlType")),all_accounts AS(SELECT coalesce(e."accountId",a."accountId") AS id,coalesce(e.expected,0) AS expected,coalesce(a.actual,0) AS actual FROM expected e FULL JOIN actual a ON a."accountId"=e."accountId")
 SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',id,'expected',expected::numeric(20,2)::text,'items',actual::numeric(20,2)::text,'difference',(actual-expected)::numeric(20,2)::text,'ready',actual=expected) ORDER BY id),'[]'::jsonb) INTO matches FROM all_accounts;
 SELECT coalesce(sum(debit),0),coalesce(sum(credit),0) INTO debits,credits FROM public."FinanceOpeningLine" WHERE "batchId"=target AND kind='TB';
 masters:=jsonb_build_object('accounts',(SELECT coalesce(jsonb_agg((to_jsonb(a)-ARRAY['createdAt','updatedAt','usedAt']) ORDER BY a.id),'[]'::jsonb) FROM public."FinanceAccount" a WHERE id=b."clearingAccountId" OR id IN(SELECT "accountId" FROM public."FinanceOpeningLine" WHERE "batchId"=target) OR id IN(SELECT "secondaryAccountId" FROM public."FinanceOpeningLine" WHERE "batchId"=target) OR id IN(SELECT "resultAccountId" FROM public."FinanceOpeningLine" WHERE "batchId"=target) OR id IN(SELECT "receivableAccountId" FROM public."FinanceOpeningLine" WHERE "batchId"=target)), 'parties',(SELECT coalesce(jsonb_agg((to_jsonb(p)-ARRAY['createdAt','updatedAt','usedAt']) ORDER BY p.id),'[]') FROM public."FinanceParty" p WHERE id IN(SELECT "partyId" FROM public."FinanceOpeningLine" WHERE "batchId"=target)), 'cash',(SELECT coalesce(jsonb_agg((to_jsonb(p)-ARRAY['createdAt','updatedAt','usedAt']) ORDER BY p.id),'[]') FROM public."FinanceCashAccount" p WHERE id IN(SELECT "cashAccountId" FROM public."FinanceOpeningLine" WHERE "batchId"=target)), 'loans',(SELECT coalesce(jsonb_agg((to_jsonb(p)-ARRAY['createdAt','updatedAt','usedAt']) ORDER BY p.id),'[]') FROM public."FinanceLoan" p WHERE id IN(SELECT "loanId" FROM public."FinanceOpeningLine" WHERE "batchId"=target)), 'holdings',(SELECT coalesce(jsonb_agg((to_jsonb(p)-ARRAY['createdAt','updatedAt','usedAt']) ORDER BY p.id),'[]') FROM public."FinanceInvestmentHolding" p WHERE id IN(SELECT "holdingId" FROM public."FinanceOpeningLine" WHERE "batchId"=target)));
 ready:=b.state='DRAFT' AND bad=0 AND debits=credits AND debits>0 AND debits<=999999999999999999.99 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(matches) x WHERE NOT(x->>'ready')::boolean) AND NOT EXISTS(SELECT 1 FROM public."FinanceJournalEntry") AND NOT EXISTS(SELECT 1 FROM public."FinanceOpeningBatch" WHERE state='POSTED') AND b."cutoverDate"<=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date AND b."cutoverDate"=(SELECT min("startDate") FROM public."FinancePeriod" WHERE state='OPEN') AND EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=b."clearingAccountId" AND active AND "isPosting" AND "controlType"='OPENING_CLEARING' AND type='EQUITY' AND NOT "isContra" AND currency='PKR') AND NOT EXISTS(SELECT 1 FROM public."FinanceFiscalYear" WHERE "retainedAccountId"=b."clearingAccountId" AND state<>'VOID');
 RETURN jsonb_build_object('ready',coalesce(ready,false),'balanced',debits=credits,'debits',debits::numeric(20,2)::text,'credits',credits::numeric(20,2)::text,'mappingIssueCount',bad,'issues',diagnostics,'controls',matches,'ledgerEmpty',NOT EXISTS(SELECT 1 FROM public."FinanceJournalEntry"),'cutoverIsFirstOpenDate',coalesce(b."cutoverDate"=(SELECT min("startDate") FROM public."FinancePeriod" WHERE state='OPEN'),false),'basisHash',encode(sha256(convert_to(jsonb_build_object('source',b."sourceHash",'version',b.version,'masters',masters,'controls',matches,'periods',(SELECT jsonb_agg((to_jsonb(p)-ARRAY['createdAt','updatedAt','usedAt']) ORDER BY p.id) FROM public."FinancePeriod" p),'ledgerCount',(SELECT count(*) FROM public."FinanceJournalEntry"))::text,'UTF8')),'hex'));
END $$;
CREATE FUNCTION encova_finance_opening_source_check(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE p public."FinanceOpeningPosting"%ROWTYPE;b public."FinanceOpeningBatch"%ROWTYPE;l public."FinanceOpeningLine"%ROWTYPE;j public."FinanceJournalEntry"%ROWTYPE;BEGIN
 SELECT * INTO p FROM public."FinanceOpeningPosting" WHERE id=target;IF p.id IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;SELECT * INTO b FROM public."FinanceOpeningBatch" WHERE id=p."batchId";SELECT * INTO l FROM public."FinanceOpeningLine" WHERE id=p."lineId";SELECT * INTO j FROM public."FinanceJournalEntry" WHERE id=p."journalId";
 IF b.state<>'POSTED' OR j.id IS NULL OR j."sourceType"<>'OPENING' OR j."sourceId"<>target OR j."sourceAction"<>'POST' OR j."postingDate"<>b."cutoverDate" OR j."postedById"<>b."postedById" OR j.evidence<>b.evidence OR j.description<>'Reviewed opening balance' OR j."reversalOfId" IS NOT NULL OR j."draftId" IS NOT NULL OR j."costAllocationId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public."FinancePeriod" WHERE id=j."periodId" AND b."cutoverDate" BETWEEN "startDate" AND "endDate") OR EXISTS((SELECT sequence,"accountId",description,debit,credit,"partyId","invoiceLineId","billLineId" FROM public."FinanceJournalLine" WHERE "journalId"=j.id) EXCEPT(SELECT * FROM public.encova_finance_opening_legs(target))) OR EXISTS((SELECT * FROM public.encova_finance_opening_legs(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"partyId","invoiceLineId","billLineId" FROM public."FinanceJournalLine" WHERE "journalId"=j.id)) OR EXISTS(SELECT 1 FROM public."FinanceJournalLine" WHERE "journalId"=j.id AND "projectId" IS NOT NULL) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF ROW(j."invoiceId",j."billId",j."movementId",j."assetMovementId",j."customerDocumentId",j."supplierDocumentId") IS DISTINCT FROM ROW(CASE WHEN l.kind IN('AR','DEFERRED') THEN l.id END,CASE WHEN l.kind='AP' THEN l.id END,CASE WHEN l.kind IN('LOAN_PRINCIPAL','LOAN_INTEREST','INVESTMENT','INVESTMENT_INCOME','ASSET','CAPITAL','DISTRIBUTION','FOUNDER_PAYABLE') THEN l.id END,CASE WHEN l.kind='ASSET' THEN l.id END,CASE WHEN l.kind='CLIENT_ADVANCE' THEN l.id END,CASE WHEN l.kind='SUPPLIER_ADVANCE' THEN l.id END) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF j."movementId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."FinanceMovement" d WHERE d.id=l.id AND d.kind='OPENING' AND d.state='POSTED' AND d.amount=l.amount AND d.reference=l.reference AND d."documentDate"=l."originalDate" AND d."postingDate"=b."cutoverDate" AND d."controlAccountId"=l."accountId" AND d."sourceSnapshot" IS NOT DISTINCT FROM public.encova_finance_movement_snapshot(l.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF l.kind IN('AR','DEFERRED') THEN
  IF (SELECT count(*) FROM public."FinanceInvoiceLine" WHERE "invoiceId"=l.id)<>1 OR NOT EXISTS(SELECT 1 FROM public."FinanceInvoiceLine" d WHERE d.id=l.id AND d."invoiceId"=l.id AND d.quantity=10000 AND d."unitRate"=l.amount/10000 AND d."lineAmount"=l.amount AND d."discountAmount"=0 AND d."netAmount"=l.amount AND d."taxAmount"=0 AND d."totalAmount"=l.amount AND d."taxCodeId" IS NULL AND d."projectId" IS NULL AND d."revenueAccountId"=CASE WHEN l.kind='AR' THEN b."clearingAccountId" ELSE l."resultAccountId" END AND d.recognition=CASE WHEN l.kind='AR' THEN 'EARNED' ELSE 'DEFERRED' END AND d."deferredAccountId" IS NOT DISTINCT FROM CASE WHEN l.kind='DEFERRED' THEN l."accountId" END) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;

  IF j."invoiceId" IS DISTINCT FROM l.id OR NOT EXISTS(SELECT 1 FROM public."FinanceInvoice" i WHERE i.id=l.id AND i.state='POSTED' AND i.reference=l.reference AND i."invoiceDate"=l."originalDate" AND i."postingDate"=b."cutoverDate" AND i."partyId"=l."partyId" AND i."totalAmount"=l.amount AND i.description='Opening balance: '||l.description AND i.evidence=b.evidence AND i."partySnapshot" IS NOT NULL) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  IF l.kind='AR' AND NOT EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" WHERE "invoiceId"=l.id AND "journalId"=j.id AND "accountId"=l."accountId" AND kind='INVOICE' AND amount=l.amount AND "effectiveDate"=b."cutoverDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  IF l.kind='DEFERRED' AND(EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" WHERE "invoiceId"=l.id AND "journalId"=j.id) OR NOT EXISTS(SELECT 1 FROM public."FinanceDeferredRevenueEvent" WHERE "invoiceLineId"=l.id AND "journalId"=j.id AND kind='BILLED' AND amount=l.amount AND "effectiveDate"=b."cutoverDate")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF l.kind='AP' THEN
  IF (SELECT count(*) FROM public."FinanceBillLine" WHERE "billId"=l.id)<>1 OR NOT EXISTS(SELECT 1 FROM public."FinanceBillLine" d WHERE d.id=l.id AND d."billId"=l.id AND d.quantity=10000 AND d."unitRate"=l.amount/10000 AND d."totalAmount"=l.amount AND d."netAmount"=l.amount AND d."lineAmount"=l.amount AND d."discountAmount"=0 AND d."taxAmount"=0 AND d."taxCodeId" IS NULL AND d."costAccountId"=b."clearingAccountId" AND d."projectId" IS NULL) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;

  IF j."billId" IS DISTINCT FROM l.id OR NOT EXISTS(SELECT 1 FROM public."FinanceBill" d WHERE d.id=l.id AND d.state='POSTED' AND d.reference=l.reference AND d."partyId"=l."partyId" AND d."payableAccountId"=l."accountId" AND d."totalAmount"=l.amount AND d."billDate"=l."originalDate" AND d."postingDate"=b."cutoverDate") OR NOT EXISTS(SELECT 1 FROM public."FinancePayableEvent" WHERE "billId"=l.id AND "journalId"=j.id AND "accountId"=l."accountId" AND kind='BILL' AND amount=l.amount AND "effectiveDate"=b."cutoverDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF l.kind IN('LOAN_PRINCIPAL','LOAN_INTEREST') THEN
  IF j."movementId" IS DISTINCT FROM l.id OR NOT EXISTS(SELECT 1 FROM public."FinanceLoanEvent" WHERE "movementId"=l.id AND "journalId"=j.id AND "loanId"=l."loanId" AND bucket=CASE WHEN l.kind='LOAN_PRINCIPAL' THEN 'PRINCIPAL' ELSE 'INTEREST' END AND amount=l.amount AND "effectiveDate"=b."cutoverDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF l.kind='INVESTMENT' THEN
  IF j."movementId" IS DISTINCT FROM l.id OR NOT EXISTS(SELECT 1 FROM public."FinanceInvestmentLot" WHERE id=l.id AND "movementId"=l.id AND "holdingId"=l."holdingId" AND "acquisitionDate"=l."originalDate" AND cost=l."costBasis" AND units IS NOT DISTINCT FROM l.units) OR NOT EXISTS(SELECT 1 FROM public."FinanceInvestmentEvent" WHERE "lotId"=l.id AND "holdingId"=l."holdingId" AND "movementId"=l.id AND "journalId"=j.id AND "costDelta"=l."costBasis" AND "carryingDelta"=l.amount AND "unitsDelta" IS NOT DISTINCT FROM l.units AND "effectiveDate"=b."cutoverDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF l.kind='INVESTMENT_INCOME' THEN
  IF NOT EXISTS(SELECT 1 FROM public."FinanceInvestmentIncomeEvent" WHERE "movementId"=l.id AND "journalId"=j.id AND "holdingId"=l."holdingId" AND amount=l.amount AND "effectiveDate"=b."cutoverDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF l.kind IN('CAPITAL','DISTRIBUTION','FOUNDER_PAYABLE') THEN
  IF NOT EXISTS(SELECT 1 FROM public."FinanceFundingEvent" WHERE "movementId"=l.id AND "journalId"=j.id AND "partyId"=l."partyId" AND "accountId"=l."accountId" AND bucket=l.kind AND amount=l.amount AND "effectiveDate"=b."cutoverDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF l.kind='ASSET' THEN
  IF NOT EXISTS(SELECT 1 FROM public."FinanceAsset" a WHERE a.id=l.id AND a."fundingMovementId"=l.id AND a.cost=l.amount AND a.tag=l.tag AND a."purchaseDate"=l."originalDate" AND a."sourcePostingDate"=b."cutoverDate" AND a."accountId"=l."accountId") OR NOT EXISTS(SELECT 1 FROM public."FinanceAssetMovement" m WHERE m.id=l.id AND m.kind='OPENING' AND m.state='POSTED' AND m."assetId"=l.id AND m.amount=l.accumulated AND m."accumulatedAccountId"=l."secondaryAccountId" AND m."sourceSnapshot" IS NOT DISTINCT FROM public.encova_finance_asset_movement_snapshot(l.id)) OR NOT EXISTS(SELECT 1 FROM public."FinanceAssetEvent" e WHERE e."movementId"=l.id AND e."assetId"=l.id AND e."journalId"=j.id AND e."effectiveDate"=b."cutoverDate" AND e."costDelta"=0 AND e."depreciationDelta"=l.accumulated AND e."disposalDelta"=0) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF l.kind='CLIENT_ADVANCE' THEN
  IF NOT EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" d WHERE d.id=l.id AND d.kind='OPENING_ADVANCE' AND d.state='POSTED' AND d."partyId"=l."partyId" AND d."advanceAccountId"=l."accountId" AND d."advanceAmount"=l.amount AND d."totalAmount"=l.amount AND d."partySnapshot" IS NOT NULL) OR NOT EXISTS(SELECT 1 FROM public."FinanceClientBalanceEvent" e WHERE e."documentId"=l.id AND e."sourceDocumentId"=l.id AND e."partyId"=l."partyId" AND e."accountId"=l."accountId" AND e."journalId"=j.id AND e.amount=l.amount AND e.kind='RECEIVED' AND e."effectiveDate"=b."cutoverDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF l.kind='SUPPLIER_ADVANCE' THEN
  IF NOT EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" d WHERE d.id=l.id AND d.kind='OPENING_ADVANCE' AND d.state='POSTED' AND d."partyId"=l."partyId" AND d."advanceAccountId"=l."accountId" AND d."advanceAmount"=l.amount AND d."totalAmount"=l.amount AND d."partySnapshot" IS NOT NULL) OR NOT EXISTS(SELECT 1 FROM public."FinanceSupplierBalanceEvent" e WHERE e."documentId"=l.id AND e."sourceDocumentId"=l.id AND e."partyId"=l."partyId" AND e."accountId"=l."accountId" AND e."journalId"=j.id AND e.amount=l.amount AND e.kind='RECEIVED' AND e."effectiveDate"=b."cutoverDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 END IF;
END $$;
CREATE FUNCTION encova_finance_opening_emit(actor UUID,target UUID) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE p public."FinanceOpeningPosting"%ROWTYPE;b public."FinanceOpeningBatch"%ROWTYPE;l public."FinanceOpeningLine"%ROWTYPE;pid UUID;BEGIN
 SELECT * INTO p FROM public."FinanceOpeningPosting" WHERE id=target;SELECT * INTO b FROM public."FinanceOpeningBatch" WHERE id=p."batchId";SELECT * INTO l FROM public."FinanceOpeningLine" WHERE id=p."lineId";SELECT id INTO pid FROM public."FinancePeriod" WHERE state='OPEN' AND b."cutoverDate" BETWEEN "startDate" AND "endDate" FOR UPDATE;
 INSERT INTO public."FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","postingDate","periodId",description,evidence,"postedById","invoiceId","billId","movementId","assetMovementId","customerDocumentId","supplierDocumentId") VALUES(p."journalId",'OPN-'||p.id::text,'OPENING',p.id,'POST',b."cutoverDate",pid,'Reviewed opening balance',b.evidence,actor,CASE WHEN l.kind IN('AR','DEFERRED') THEN l.id END,CASE WHEN l.kind='AP' THEN l.id END,CASE WHEN l.kind IN('LOAN_PRINCIPAL','LOAN_INTEREST','INVESTMENT','INVESTMENT_INCOME','ASSET','CAPITAL','DISTRIBUTION','FOUNDER_PAYABLE') THEN l.id END,CASE WHEN l.kind='ASSET' THEN l.id END,CASE WHEN l.kind='CLIENT_ADVANCE' THEN l.id END,CASE WHEN l.kind='SUPPLIER_ADVANCE' THEN l.id END);
 INSERT INTO public."FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"partyId","invoiceLineId","billLineId") SELECT gen_random_uuid(),p."journalId",sequence,"accountId",description,debit,credit,"partyId","invoiceLineId","billLineId" FROM public.encova_finance_opening_legs(target);RETURN p."journalId";
END $$;
CREATE FUNCTION encova_finance_opening_prepare_source(actor UUID,target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE l public."FinanceOpeningLine"%ROWTYPE;b public."FinanceOpeningBatch"%ROWTYPE;BEGIN
 SELECT * INTO l FROM public."FinanceOpeningLine" WHERE id=target;SELECT * INTO b FROM public."FinanceOpeningBatch" WHERE id=l."batchId";
 IF l.kind IN('AR','DEFERRED') THEN
  INSERT INTO public."FinanceInvoice"(id,number,reference,"partyId","receivableAccountId","invoiceDate","postingDate","dueDate",description,evidence,"lineAmount","discountAmount","netAmount","totalAmount","createdById") VALUES(l.id,'INV-'||lpad(nextval('public.finance_invoice_number')::text,10,'0'),l.reference,l."partyId",CASE WHEN l.kind='AR' THEN l."accountId" ELSE l."receivableAccountId" END,l."originalDate",b."cutoverDate",coalesce(l."dueDate",l."originalDate"),'Opening balance: '||l.description,b.evidence,l.amount,0,l.amount,l.amount,actor);
  INSERT INTO public."FinanceInvoiceLine"(id,"invoiceId",sequence,description,quantity,"unitRate","lineAmount","discountAmount","netAmount","totalAmount",recognition,"revenueAccountId","deferredAccountId") VALUES(l.id,l.id,1,'Imported cutover balance; not a newly issued sale',10000,l.amount/10000,l.amount,0,l.amount,l.amount,CASE WHEN l.kind='DEFERRED' THEN 'DEFERRED' ELSE 'EARNED' END,CASE WHEN l.kind='DEFERRED' THEN l."resultAccountId" ELSE b."clearingAccountId" END,CASE WHEN l.kind='DEFERRED' THEN l."accountId" END);
 ELSIF l.kind='AP' THEN
  INSERT INTO public."FinanceBill"(id,number,kind,reference,"referenceReliable","duplicateAcknowledged","partyId","payableAccountId","billDate","postingDate","dueDate",description,evidence,"lineAmount","discountAmount","netAmount","totalAmount","createdById") VALUES(l.id,'BIL-'||lpad(nextval('public.finance_bill_number')::text,10,'0'),'BILL',l.reference,true,true,l."partyId",l."accountId",l."originalDate",b."cutoverDate",l."dueDate",'Opening balance: '||l.description,b.evidence,l.amount,0,l.amount,l.amount,actor);
  INSERT INTO public."FinanceBillLine"(id,"billId",sequence,description,quantity,"unitRate","lineAmount","discountAmount","netAmount","totalAmount",treatment,"costAccountId") VALUES(l.id,l.id,1,'Imported cutover balance; not a new purchase',10000,l.amount/10000,l.amount,0,l.amount,l.amount,'EXPENSE',b."clearingAccountId");
 ELSIF l.kind IN('LOAN_PRINCIPAL','LOAN_INTEREST','INVESTMENT','INVESTMENT_INCOME','ASSET','CAPITAL','DISTRIBUTION','FOUNDER_PAYABLE') THEN
  INSERT INTO public."FinanceMovement"(id,number,kind,reference,"documentDate","postingDate",description,evidence,"approvalEvidence",amount,"partyId","controlAccountId","counterAccountId","loanId","holdingId",units,"createdById") VALUES(l.id,'MVT-'||lpad(nextval('public.finance_movement_number')::text,10,'0'),'OPENING',l.reference,l."originalDate",b."cutoverDate",l.description,b.evidence,b.evidence,l.amount,l."partyId",l."accountId",CASE WHEN l.kind='ASSET' THEN l."accountId" ELSE b."clearingAccountId" END,l."loanId",l."holdingId",l.units,actor);
 ELSIF l.kind='CLIENT_ADVANCE' THEN
  INSERT INTO public."FinanceCustomerDocument"(id,number,kind,reference,"documentDate","postingDate",description,evidence,"partyId","cashAmount","feeAmount","allocationAmount","totalAmount","advanceAccountId","advanceAmount","createdById") VALUES(l.id,'OPA-'||lpad(nextval('public.finance_customer_number')::text,10,'0'),'OPENING_ADVANCE',l.reference,l."originalDate",b."cutoverDate",l.description,b.evidence,l."partyId",0,0,0,l.amount,l."accountId",l.amount,actor);
 ELSIF l.kind='SUPPLIER_ADVANCE' THEN
  INSERT INTO public."FinanceSupplierDocument"(id,number,kind,reference,"documentDate","postingDate",description,evidence,"partyId","cashAmount","feeAmount","allocationAmount","totalAmount","advanceAccountId","advanceAmount","createdById") VALUES(l.id,'OPA-'||lpad(nextval('public.finance_supplier_number')::text,10,'0'),'OPENING_ADVANCE',l.reference,l."originalDate",b."cutoverDate",l.description,b.evidence,l."partyId",0,0,0,l.amount,l."accountId",l.amount,actor);
 END IF;
END $$;
CREATE FUNCTION encova_finance_opening_finish_source(actor UUID,target UUID,journal_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE l public."FinanceOpeningLine"%ROWTYPE;b public."FinanceOpeningBatch"%ROWTYPE;source RECORD;basis JSONB;recorded TIMESTAMPTZ;BEGIN
 SELECT * INTO l FROM public."FinanceOpeningLine" WHERE id=target;SELECT * INTO b FROM public."FinanceOpeningBatch" WHERE id=l."batchId";
 IF l.kind IN('AR','DEFERRED') THEN
  IF l.kind='AR' THEN INSERT INTO public."FinanceReceivableEvent"(id,"invoiceId","partyId","accountId","journalId","effectiveDate",kind,amount) VALUES(gen_random_uuid(),l.id,l."partyId",l."accountId",journal_id,b."cutoverDate",'INVOICE',l.amount);
  ELSE INSERT INTO public."FinanceDeferredRevenueEvent"(id,"invoiceLineId","journalId","effectiveDate",kind,amount) VALUES(gen_random_uuid(),l.id,journal_id,b."cutoverDate",'BILLED',l.amount);END IF;
  UPDATE public."FinanceInvoice" SET state='POSTED',version=version+1,"partySnapshot"=public.encova_finance_party_snapshot("partyId"),"updatedAt"=CURRENT_TIMESTAMP WHERE id=l.id;
 ELSIF l.kind='AP' THEN
  INSERT INTO public."FinancePayableEvent"(id,"billId","partyId","accountId","journalId","effectiveDate",kind,amount) VALUES(gen_random_uuid(),l.id,l."partyId",l."accountId",journal_id,b."cutoverDate",'BILL',l.amount);
  UPDATE public."FinanceBill" SET state='POSTED',version=version+1,"partySnapshot"=public.encova_finance_party_snapshot("partyId"),"updatedAt"=CURRENT_TIMESTAMP WHERE id=l.id;
 ELSIF l.kind IN('CLIENT_ADVANCE','SUPPLIER_ADVANCE') THEN
  IF l.kind='CLIENT_ADVANCE' THEN
   INSERT INTO public."FinanceClientBalanceEvent"(id,"partyId","accountId","sourceDocumentId","documentId","journalId","effectiveDate",kind,amount) VALUES(gen_random_uuid(),l."partyId",l."accountId",l.id,l.id,journal_id,b."cutoverDate",'RECEIVED',l.amount);
   UPDATE public."FinanceCustomerDocument" SET state='POSTED',version=version+1,"partySnapshot"=public.encova_finance_party_snapshot("partyId"),"updatedAt"=CURRENT_TIMESTAMP WHERE id=l.id;
  ELSE
   INSERT INTO public."FinanceSupplierBalanceEvent"(id,"partyId","accountId","sourceDocumentId","documentId","journalId","effectiveDate",kind,amount) VALUES(gen_random_uuid(),l."partyId",l."accountId",l.id,l.id,journal_id,b."cutoverDate",'RECEIVED',l.amount);
   UPDATE public."FinanceSupplierDocument" SET state='POSTED',version=version+1,"partySnapshot"=public.encova_finance_party_snapshot("partyId"),"updatedAt"=CURRENT_TIMESTAMP WHERE id=l.id;
  END IF;
 ELSIF l.kind IN('LOAN_PRINCIPAL','LOAN_INTEREST','INVESTMENT','INVESTMENT_INCOME','ASSET','CAPITAL','DISTRIBUTION','FOUNDER_PAYABLE') THEN
  IF l.kind IN('LOAN_PRINCIPAL','LOAN_INTEREST') THEN
   INSERT INTO public."FinanceLoanEvent"(id,"movementId","loanId","journalId","effectiveDate",bucket,amount) VALUES(gen_random_uuid(),l.id,l."loanId",journal_id,b."cutoverDate",CASE WHEN l.kind='LOAN_PRINCIPAL' THEN 'PRINCIPAL' ELSE 'INTEREST' END,l.amount);
   UPDATE public."FinanceLoan" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE id=l."loanId";
  ELSIF l.kind='INVESTMENT' THEN
   INSERT INTO public."FinanceInvestmentLot"(id,"holdingId","movementId","acquisitionDate",cost,units) VALUES(l.id,l."holdingId",l.id,l."originalDate",l."costBasis",l.units);
   INSERT INTO public."FinanceInvestmentEvent"(id,"holdingId","lotId","movementId","journalId","effectiveDate","costDelta","carryingDelta","unitsDelta") VALUES(gen_random_uuid(),l."holdingId",l.id,l.id,journal_id,b."cutoverDate",l."costBasis",l.amount,l.units);
  ELSIF l.kind='INVESTMENT_INCOME' THEN
   INSERT INTO public."FinanceInvestmentIncomeEvent"(id,"holdingId","movementId","journalId","effectiveDate",amount) VALUES(gen_random_uuid(),l."holdingId",l.id,journal_id,b."cutoverDate",l.amount);
  ELSIF l.kind IN('CAPITAL','DISTRIBUTION','FOUNDER_PAYABLE') THEN
   INSERT INTO public."FinanceFundingEvent"(id,"movementId","partyId","accountId","journalId","effectiveDate",bucket,amount) VALUES(gen_random_uuid(),l.id,l."partyId",l."accountId",journal_id,b."cutoverDate",l.kind,l.amount);
  END IF;
  IF l."holdingId" IS NOT NULL THEN UPDATE public."FinanceInvestmentHolding" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE id=l."holdingId";END IF;
  UPDATE public."FinanceMovement" SET state='POSTED',version=version+1,"sourceSnapshot"=public.encova_finance_movement_snapshot(l.id),"updatedAt"=CURRENT_TIMESTAMP WHERE id=l.id;
  IF l.kind='ASSET' THEN
   SELECT * INTO source FROM public.encova_finance_asset_source(NULL,l.id);
   INSERT INTO public."FinanceAsset"(id,number,tag,description,location,"fundingMovementId","accountId",cost,"purchaseDate","sourcePostingDate","sourceSnapshot","inServiceDate","usefulLifeMonths","residualValue",convention,"firstDepMonth","policyEvidence","createdById") VALUES(l.id,'AST-'||lpad(nextval('public.finance_asset_number')::text,10,'0'),l.tag,l.description,l.location,l.id,l."accountId",l.amount,l."originalDate",b."cutoverDate",source.snapshot,l."inServiceDate",l."remainingMonths",l.residual,'FULL_MONTH_FROM_FIRST_MONTH',l."firstDepMonth",l."policyEvidence",actor);
   basis:=public.encova_finance_asset_capture(l.id);
   INSERT INTO public."FinanceAssetMovement"(id,number,"assetId",kind,"postingDate",description,evidence,"approvalEvidence",amount,"accumulatedAccountId","basisHash","basisSnapshot","createdById") VALUES(l.id,'ASM-'||lpad(nextval('public.finance_asset_movement_number')::text,10,'0'),l.id,'OPENING',b."cutoverDate",l.description,b.evidence,l."policyEvidence",l.accumulated,l."secondaryAccountId",public.encova_finance_asset_basis_hash(l.id),basis,actor);
   UPDATE public."FinanceAssetMovement" SET state='POSTED',version=version+1,"sourceSnapshot"=public.encova_finance_asset_movement_snapshot(l.id),"updatedAt"=CURRENT_TIMESTAMP WHERE id=l.id;
   INSERT INTO public."FinanceAssetEvent"(id,"assetId","movementId","journalId","effectiveDate","costDelta","depreciationDelta","disposalDelta") VALUES(gen_random_uuid(),l.id,l.id,journal_id,b."cutoverDate",0,l.accumulated,0) RETURNING "recordedAt" INTO recorded;
   UPDATE public."FinanceAsset" SET "accumulatedDepreciation"=l.accumulated,"usedAt"=recorded,version=version+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=l.id;
  END IF;
 END IF;
END $$;

DO $$ DECLARE definition TEXT;BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public."FinanceJournalEntry"'::regclass AND conname='FinanceJournalEntry_source_identity';
 ALTER TABLE public."FinanceJournalEntry" DROP CONSTRAINT "FinanceJournalEntry_source_identity";
 EXECUTE 'ALTER TABLE public."FinanceJournalEntry" ADD CONSTRAINT "FinanceJournalEntry_source_identity" CHECK ('||substring(definition FROM 8 FOR length(definition)-8)||' OR ("sourceType"=''OPENING'' AND "sourceAction"=''POST'' AND "draftId" IS NULL AND "reversalOfId" IS NULL AND "costAllocationId" IS NULL))';
END $$;
DO $$ DECLARE definition TEXT;BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public."FinanceMovement"'::regclass AND conname='FinanceMovement_kind_check';
 ALTER TABLE public."FinanceMovement" DROP CONSTRAINT "FinanceMovement_kind_check";
 EXECUTE 'ALTER TABLE public."FinanceMovement" ADD CONSTRAINT "FinanceMovement_kind_check" CHECK ('||substring(definition FROM 8 FOR length(definition)-8)||' OR (kind=''OPENING'' AND "fromCashId" IS NULL AND "toCashId" IS NULL AND "reversalOfId" IS NULL AND "billId" IS NULL AND "projectId" IS NULL AND "feeAmount"=0))';
END $$;
DO $$ DECLARE definition TEXT;BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public."FinanceMovement"'::regclass AND conname='FinanceMovement_source_shape';
 ALTER TABLE public."FinanceMovement" DROP CONSTRAINT "FinanceMovement_source_shape";
 EXECUTE 'ALTER TABLE public."FinanceMovement" ADD CONSTRAINT "FinanceMovement_source_shape" CHECK ('||substring(definition FROM 8 FOR length(definition)-8)||' OR (kind=''OPENING'' AND "fromCashId" IS NULL AND "toCashId" IS NULL AND "reversalOfId" IS NULL AND "billId" IS NULL AND "projectId" IS NULL AND "feeAmount"=0))';
END $$;
DO $$ DECLARE definition TEXT;BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public."FinanceAssetMovement"'::regclass AND conname='FinanceAssetMovement_kind_check';
 ALTER TABLE public."FinanceAssetMovement" DROP CONSTRAINT "FinanceAssetMovement_kind_check";
 EXECUTE 'ALTER TABLE public."FinanceAssetMovement" ADD CONSTRAINT "FinanceAssetMovement_kind_check" CHECK ('||substring(definition FROM 8 FOR length(definition)-8)||' OR (kind=''OPENING'' AND "reversalOfId" IS NULL AND month IS NULL AND "cashAccountId" IS NULL AND "feeAmount"=0))';
END $$;
DO $$ DECLARE definition TEXT;BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public."FinanceAssetMovement"'::regclass AND conname='FinanceAssetMovement_shape';
 ALTER TABLE public."FinanceAssetMovement" DROP CONSTRAINT "FinanceAssetMovement_shape";
 EXECUTE 'ALTER TABLE public."FinanceAssetMovement" ADD CONSTRAINT "FinanceAssetMovement_shape" CHECK ('||substring(definition FROM 8 FOR length(definition)-8)||' OR (kind=''OPENING'' AND "reversalOfId" IS NULL AND month IS NULL AND "cashAccountId" IS NULL AND "feeAmount"=0))';
END $$;
DO $$ DECLARE definition TEXT;BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public."FinanceCustomerDocument"'::regclass AND conname='FinanceCustomerDocument_kind_check';
 ALTER TABLE public."FinanceCustomerDocument" DROP CONSTRAINT "FinanceCustomerDocument_kind_check";
 EXECUTE 'ALTER TABLE public."FinanceCustomerDocument" ADD CONSTRAINT "FinanceCustomerDocument_kind_check" CHECK ('||substring(definition FROM 8 FOR length(definition)-8)||' OR (kind=''OPENING_ADVANCE'' AND "cashAmount"=0 AND "feeAmount"=0 AND "cashAccountId" IS NULL AND "allocationAmount"=0 AND "advanceAmount"="totalAmount" AND "advanceAccountId" IS NOT NULL AND "sourceDocumentId" IS NULL AND "reversalOfId" IS NULL AND "unallocationOfId" IS NULL))';
END $$;
DO $$ DECLARE definition TEXT;BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public."FinanceCustomerDocument"'::regclass AND conname='FinanceCustomerDocument_number_kind';
 ALTER TABLE public."FinanceCustomerDocument" DROP CONSTRAINT "FinanceCustomerDocument_number_kind";
 EXECUTE 'ALTER TABLE public."FinanceCustomerDocument" ADD CONSTRAINT "FinanceCustomerDocument_number_kind" CHECK ('||substring(definition FROM 8 FOR length(definition)-8)||' OR (kind=''OPENING_ADVANCE'' AND "cashAmount"=0 AND "feeAmount"=0 AND "cashAccountId" IS NULL AND "allocationAmount"=0 AND "advanceAmount"="totalAmount" AND "advanceAccountId" IS NOT NULL AND "sourceDocumentId" IS NULL AND "reversalOfId" IS NULL AND "unallocationOfId" IS NULL))';
END $$;
DO $$ DECLARE definition TEXT;BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public."FinanceCustomerDocument"'::regclass AND conname='FinanceCustomerDocument_commercial_source';
 ALTER TABLE public."FinanceCustomerDocument" DROP CONSTRAINT "FinanceCustomerDocument_commercial_source";
 EXECUTE 'ALTER TABLE public."FinanceCustomerDocument" ADD CONSTRAINT "FinanceCustomerDocument_commercial_source" CHECK ('||substring(definition FROM 8 FOR length(definition)-8)||' OR (kind=''OPENING_ADVANCE'' AND "cashAmount"=0 AND "feeAmount"=0 AND "cashAccountId" IS NULL AND "allocationAmount"=0 AND "advanceAmount"="totalAmount" AND "advanceAccountId" IS NOT NULL AND "sourceDocumentId" IS NULL AND "reversalOfId" IS NULL AND "unallocationOfId" IS NULL))';
END $$;
DO $$ DECLARE definition TEXT;BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public."FinanceSupplierDocument"'::regclass AND conname='FinanceSupplierDocument_kind_check';
 ALTER TABLE public."FinanceSupplierDocument" DROP CONSTRAINT "FinanceSupplierDocument_kind_check";
 EXECUTE 'ALTER TABLE public."FinanceSupplierDocument" ADD CONSTRAINT "FinanceSupplierDocument_kind_check" CHECK ('||substring(definition FROM 8 FOR length(definition)-8)||' OR (kind=''OPENING_ADVANCE'' AND "cashAmount"=0 AND "feeAmount"=0 AND "cashAccountId" IS NULL AND "allocationAmount"=0 AND "advanceAmount"="totalAmount" AND "advanceAccountId" IS NOT NULL AND "sourceDocumentId" IS NULL AND "reversalOfId" IS NULL AND "unallocationOfId" IS NULL))';
END $$;
DO $$ DECLARE definition TEXT;BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public."FinanceSupplierDocument"'::regclass AND conname='FinanceSupplierDocument_number_kind';
 ALTER TABLE public."FinanceSupplierDocument" DROP CONSTRAINT "FinanceSupplierDocument_number_kind";
 EXECUTE 'ALTER TABLE public."FinanceSupplierDocument" ADD CONSTRAINT "FinanceSupplierDocument_number_kind" CHECK ('||substring(definition FROM 8 FOR length(definition)-8)||' OR (kind=''OPENING_ADVANCE'' AND "cashAmount"=0 AND "feeAmount"=0 AND "cashAccountId" IS NULL AND "allocationAmount"=0 AND "advanceAmount"="totalAmount" AND "advanceAccountId" IS NOT NULL AND "sourceDocumentId" IS NULL AND "reversalOfId" IS NULL AND "unallocationOfId" IS NULL))';
END $$;
DO $$ DECLARE definition TEXT;BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public."FinanceSupplierDocument"'::regclass AND conname='FinanceSupplierDocument_commercial_source';
 ALTER TABLE public."FinanceSupplierDocument" DROP CONSTRAINT "FinanceSupplierDocument_commercial_source";
 EXECUTE 'ALTER TABLE public."FinanceSupplierDocument" ADD CONSTRAINT "FinanceSupplierDocument_commercial_source" CHECK ('||substring(definition FROM 8 FOR length(definition)-8)||' OR (kind=''OPENING_ADVANCE'' AND "cashAmount"=0 AND "feeAmount"=0 AND "cashAccountId" IS NULL AND "allocationAmount"=0 AND "advanceAmount"="totalAmount" AND "advanceAccountId" IS NOT NULL AND "sourceDocumentId" IS NULL AND "reversalOfId" IS NULL AND "unallocationOfId" IS NULL))';
END $$;
ALTER TABLE "FinanceJournalEntry" ALTER CONSTRAINT "FinanceJournalEntry_assetMovementId_fkey" DEFERRABLE INITIALLY DEFERRED;
CREATE OR REPLACE FUNCTION public.encova_finance_journal_header_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE period public."FinancePeriod"%ROWTYPE;
BEGIN
 SELECT * INTO period FROM public."FinancePeriod" WHERE id=NEW."periodId" FOR UPDATE;
 IF period.id IS NULL OR period.state<>'OPEN' OR NEW."postingDate" NOT BETWEEN period."startDate" AND period."endDate" THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 IF NEW."postingDate">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'FINANCE_FUTURE_DATE' USING ERRCODE='P0001'; END IF;
 IF NEW."sourceType"='SUPPLIER_DOCUMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE id=NEW."supplierDocumentId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='SUPPLIER_DOCUMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE id=NEW."supplierDocumentId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='COST_ALLOCATION' AND NOT EXISTS(SELECT 1 FROM public."FinanceCostAllocation" WHERE id=NEW."costAllocationId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='ASSET_MOVEMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceAssetMovement" WHERE id=NEW."assetMovementId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='MOVEMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceMovement" WHERE id=NEW."movementId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='BILL' AND NOT EXISTS(SELECT 1 FROM public."FinanceBill" WHERE id=NEW."billId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='INVOICE' AND NOT EXISTS(SELECT 1 FROM public."FinanceInvoice" WHERE id=NEW."invoiceId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='CUSTOMER_DOCUMENT' AND NOT EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" WHERE id=NEW."customerDocumentId" AND state='DRAFT' AND "postingDate"=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF NEW."sourceType"='OPENING' THEN
  IF NOT EXISTS(SELECT 1 FROM public."FinanceOpeningPosting" p JOIN public."FinanceOpeningBatch" b ON b.id=p."batchId" WHERE p.id=NEW."sourceId" AND p."journalId"=NEW.id AND b.state='DRAFT' AND b."cutoverDate"=NEW."postingDate" AND b.evidence=NEW.evidence AND NEW.description='Reviewed opening balance' AND NEW."sourceAction"='POST' AND NEW."reversalOfId" IS NULL AND public.encova_finance_export_access(NEW."postedById") AND EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=NEW."postedById")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  UPDATE public."FinancePeriod" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=period.id;RETURN NEW;
 END IF;
 IF NEW."sourceType"='YEAR_CLOSE' THEN
  IF NOT EXISTS(SELECT 1 FROM public."FinanceYearClose" c JOIN public."FinanceFiscalYear" y ON y.id=c."fiscalYearId" WHERE c.id=NEW."sourceId" AND c."periodId"=NEW."periodId" AND y."endDate"=NEW."postingDate" AND NEW.description='Fiscal-year retained earnings transfer' AND NEW.evidence=c.reason AND(
   NEW."sourceAction"='POST' AND c.state='DRAFT' AND c."journalId"=NEW.id AND NEW."reversalOfId" IS NULL AND NEW."postedById"=c."closedById" OR
   NEW."sourceAction"='REVERSE' AND c.state='REVERSED' AND c."reversalJournalId"=NEW.id AND NEW."reversalOfId"=c."journalId" AND NEW."postedById"=c."reversedById")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  UPDATE public."FinancePeriod" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=period.id;RETURN NEW;
 END IF;
 IF NEW."reversalOfId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."FinanceJournalEntry" WHERE id=NEW."reversalOfId" AND "sourceType"='JOURNAL_DRAFT' AND "reversalOfId" IS NULL AND "postingDate"<=NEW."postingDate") THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001'; END IF;
 UPDATE public."FinancePeriod" SET "usedAt"=coalesce("usedAt",CURRENT_TIMESTAMP) WHERE id=period.id;
 RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.encova_finance_journal_line_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE account public."FinanceAccount"%ROWTYPE; entry public."FinanceJournalEntry"%ROWTYPE; invoice public."FinanceInvoice"%ROWTYPE; line public."FinanceInvoiceLine"%ROWTYPE;
BEGIN
 SELECT * INTO account FROM public."FinanceAccount" WHERE id=NEW."accountId" FOR UPDATE;
 IF account.id IS NULL OR NOT account.active OR NOT account."isPosting" OR account.currency<>'PKR' THEN RAISE EXCEPTION 'FINANCE_ACCOUNT_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
 SELECT * INTO entry FROM public."FinanceJournalEntry" WHERE id=NEW."journalId";
 IF entry."sourceType"='OPENING' THEN
  IF NEW."projectId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.encova_finance_opening_legs(entry."sourceId") x WHERE ROW(x.sequence,x."accountId",x.description,x.debit,x.credit,x."partyId",x."invoiceLineId",x."billLineId") IS NOT DISTINCT FROM ROW(NEW.sequence,NEW."accountId",NEW.description,NEW.debit,NEW.credit,NEW."partyId",NEW."invoiceLineId",NEW."billLineId")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;PERFORM public.encova_finance_mark_accounts(ARRAY[NEW."accountId"]);RETURN NEW;
 END IF;
 IF entry."sourceType"='YEAR_CLOSE' THEN
  IF NEW."projectId" IS NOT NULL OR NEW."partyId" IS NOT NULL OR NEW."invoiceLineId" IS NOT NULL OR NEW."billLineId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public."FinanceYearClose" c CROSS JOIN LATERAL jsonb_array_elements(c.lines) x WHERE c.id=entry."sourceId" AND (x->>'sequence')::integer=NEW.sequence AND (x->>'accountId')::uuid=NEW."accountId" AND x->>'description'=NEW.description AND (x->>CASE WHEN entry."sourceAction"='POST' THEN 'debit' ELSE 'credit' END)::numeric=NEW.debit AND (x->>CASE WHEN entry."sourceAction"='POST' THEN 'credit' ELSE 'debit' END)::numeric=NEW.credit) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  PERFORM public.encova_finance_mark_accounts(ARRAY[NEW."accountId"]);RETURN NEW;
 END IF;
 IF entry."sourceType"='JOURNAL_DRAFT' AND EXISTS(SELECT 1 FROM public."FinanceFiscalYear" WHERE state<>'VOID' AND "retainedAccountId"=NEW."accountId") THEN RAISE EXCEPTION 'FINANCE_CONTROL_PROTECTED' USING ERRCODE='P0001';END IF;
 IF entry."sourceType"='COST_ALLOCATION' THEN
  IF NEW."invoiceLineId" IS NOT NULL OR NEW."billLineId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.encova_finance_cost_lines(entry."costAllocationId")x WHERE ROW(x.sequence,x."accountId",x.description,x.debit,x.credit,x."projectId",x."partyId") IS NOT DISTINCT FROM ROW(NEW.sequence,NEW."accountId",NEW.description,NEW.debit,NEW.credit,NEW."projectId",NEW."partyId")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;PERFORM public.encova_finance_mark_accounts(ARRAY[NEW."accountId"]);RETURN NEW;
 END IF;
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
END $function$
;
CREATE OR REPLACE FUNCTION public.encova_finance_journal_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE target UUID; entry public."FinanceJournalEntry"%ROWTYPE; line_count BIGINT; debits NUMERIC; credits NUMERIC;
BEGIN
 IF TG_TABLE_NAME='FinanceJournalEntry' THEN target:=NEW.id; ELSE target:=NEW."journalId"; END IF;
 SELECT * INTO entry FROM public."FinanceJournalEntry" WHERE id=target;
 SELECT count(*),coalesce(sum(debit),0),coalesce(sum(credit),0) INTO line_count,debits,credits FROM public."FinanceJournalLine" WHERE "journalId"=target;
 IF line_count NOT BETWEEN 2 AND 400 OR debits<>credits OR debits<=0 OR debits>999999999999999999.99 THEN RAISE EXCEPTION 'FINANCE_UNBALANCED' USING ERRCODE='P0001'; END IF;
 IF entry."sourceType"='OPENING' THEN PERFORM public.encova_finance_opening_source_check(entry."sourceId");RETURN NULL;END IF;
 IF entry."sourceType"='YEAR_CLOSE' THEN
  PERFORM public.encova_finance_year_check(entry."sourceId");RETURN NULL;
 END IF;
 IF entry."sourceType"='COST_ALLOCATION' THEN PERFORM public.encova_finance_check_cost(entry."costAllocationId");RETURN NULL;END IF;
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
END $function$
;
CREATE OR REPLACE FUNCTION public.encova_finance_check_invoice(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE invoice public."FinanceInvoice"%ROWTYPE; entry public."FinanceJournalEntry"%ROWTYPE; count_lines BIGINT; gross NUMERIC; discounts NUMERIC; nets NUMERIC; totals NUMERIC;
BEGIN
 IF EXISTS(SELECT 1 FROM public."FinanceOpeningLine" l JOIN public."FinanceOpeningPosting" p ON p."lineId"=l.id WHERE l.id=target) THEN PERFORM public.encova_finance_opening_source_check(target);RETURN;END IF;

 SELECT * INTO invoice FROM public."FinanceInvoice" WHERE id=target;
 IF (SELECT "taxAmount" FROM public."FinanceInvoice" WHERE id=target) IS DISTINCT FROM(SELECT coalesce(sum("taxAmount"),0) FROM public."FinanceInvoiceLine" WHERE "invoiceId"=target) THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;
 IF invoice.id IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 SELECT count(*),coalesce(sum("lineAmount"),0),coalesce(sum("discountAmount"),0),coalesce(sum("netAmount"),0),coalesce(sum("totalAmount"),0) INTO count_lines,gross,discounts,nets,totals FROM public."FinanceInvoiceLine" WHERE "invoiceId"=target;
 IF count_lines NOT BETWEEN 1 AND 100 OR gross>999999999999999999.99 OR discounts>999999999999999999.99 OR nets>999999999999999999.99 OR totals>999999999999999999.99 OR ROW(invoice."lineAmount",invoice."discountAmount",invoice."netAmount",invoice."totalAmount") IS DISTINCT FROM ROW(gross,discounts,nets,totals) THEN RAISE EXCEPTION 'FINANCE_INVOICE_TOTALS' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM public."FinanceInvoiceLine" WHERE "invoiceId"=target AND "projectId" IS NULL AND invoice."projectId" IS NOT NULL) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 SELECT * INTO entry FROM public."FinanceJournalEntry" WHERE "invoiceId"=target;
 IF invoice.state<>'POSTED' THEN
  IF entry.id IS NOT NULL OR invoice."partySnapshot" IS NOT NULL OR EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" WHERE "invoiceId"=target) OR EXISTS(SELECT 1 FROM public."FinanceDeferredRevenueEvent" e JOIN public."FinanceInvoiceLine" l ON l.id=e."invoiceLineId" WHERE l."invoiceId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;
 END IF;
 IF invoice."totalAmount"<=0 OR invoice."partySnapshot" IS NULL OR entry.id IS NULL OR entry."sourceType"<>'INVOICE' OR entry."postingDate"<>invoice."postingDate" OR entry.description<>invoice.description OR entry.evidence<>invoice.evidence THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId" FROM public."FinanceJournalLine" WHERE "journalId"=entry.id) EXCEPT(SELECT * FROM public.encova_finance_invoice_lines(target))) OR EXISTS((SELECT * FROM public.encova_finance_invoice_lines(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId" FROM public."FinanceJournalLine" WHERE "journalId"=entry.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF (SELECT count(*) FROM public."FinanceReceivableEvent" WHERE "invoiceId"=target AND kind='INVOICE')<>1 OR NOT EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" WHERE "invoiceId"=target AND "journalId"=entry.id AND "partyId"=invoice."partyId" AND "accountId"=invoice."receivableAccountId" AND "effectiveDate"=invoice."postingDate" AND kind='INVOICE' AND amount=invoice."totalAmount") THEN RAISE EXCEPTION 'FINANCE_RECEIVABLE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF (SELECT count(*) FROM public."FinanceDeferredRevenueEvent" e JOIN public."FinanceInvoiceLine" l ON l.id=e."invoiceLineId" WHERE l."invoiceId"=target AND e.kind='BILLED')<>(SELECT count(*) FROM public."FinanceInvoiceLine" WHERE "invoiceId"=target AND recognition='DEFERRED' AND "netAmount">0) OR EXISTS(SELECT 1 FROM public."FinanceInvoiceLine" l WHERE l."invoiceId"=target AND l.recognition='DEFERRED' AND l."netAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceDeferredRevenueEvent" e WHERE e."invoiceLineId"=l.id AND e."journalId"=entry.id AND e."effectiveDate"=invoice."postingDate" AND e.kind='BILLED' AND e.amount=l."netAmount")) THEN RAISE EXCEPTION 'FINANCE_DEFERRED_MISMATCH' USING ERRCODE='P0001';END IF;
END $function$
;
CREATE OR REPLACE FUNCTION public.encova_finance_check_bill(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$ DECLARE d public."FinanceBill"%ROWTYPE;e public."FinanceJournalEntry"%ROWTYPE;n BIGINT;gross NUMERIC;discounts NUMERIC;net NUMERIC;total NUMERIC;BEGIN
 IF EXISTS(SELECT 1 FROM public."FinanceOpeningLine" l JOIN public."FinanceOpeningPosting" p ON p."lineId"=l.id WHERE l.id=target) THEN PERFORM public.encova_finance_opening_source_check(target);RETURN;END IF;

 SELECT * INTO d FROM public."FinanceBill" WHERE id=target;SELECT count(*),coalesce(sum(l."lineAmount"),0),coalesce(sum(l."discountAmount"),0),coalesce(sum(l."netAmount"),0),coalesce(sum(l."totalAmount"),0) INTO n,gross,discounts,net,total FROM public."FinanceBillLine" l WHERE l."billId"=target;
 IF (SELECT "taxAmount" FROM public."FinanceBill" WHERE id=target) IS DISTINCT FROM(SELECT coalesce(sum("taxAmount"),0) FROM public."FinanceBillLine" WHERE "billId"=target) THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;
 IF d.id IS NULL OR n NOT BETWEEN 1 AND 100 OR ROW(d."lineAmount",d."discountAmount",d."netAmount",d."totalAmount") IS DISTINCT FROM ROW(gross,discounts,net,total) THEN RAISE EXCEPTION 'FINANCE_BILL_TOTALS' USING ERRCODE='P0001';END IF;
 SELECT * INTO e FROM public."FinanceJournalEntry" WHERE "billId"=target;
 IF d.state<>'POSTED' THEN IF e.id IS NOT NULL OR EXISTS(SELECT 1 FROM public."FinancePayableEvent" WHERE "billId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;END IF;
 IF e.id IS NULL OR e."postingDate"<>d."postingDate" OR e.description<>d.description OR e.evidence<>d.evidence OR d."partySnapshot" IS NULL OR EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","billLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id) EXCEPT(SELECT * FROM public.encova_finance_bill_lines(target))) OR EXISTS((SELECT * FROM public.encova_finance_bill_lines(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","billLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF(d.kind='BILL' AND((SELECT count(*) FROM public."FinancePayableEvent" WHERE "billId"=target AND kind='BILL')<>1 OR NOT EXISTS(SELECT 1 FROM public."FinancePayableEvent" WHERE "billId"=target AND "journalId"=e.id AND "partyId"=d."partyId" AND "accountId"=d."payableAccountId" AND "effectiveDate"=d."postingDate" AND kind='BILL' AND amount=d."totalAmount"))) OR(d.kind='EXPENSE' AND EXISTS(SELECT 1 FROM public."FinancePayableEvent" WHERE "billId"=target)) THEN RAISE EXCEPTION 'FINANCE_PAYABLE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM public."FinanceBill" x WHERE x.id<>d.id AND x.state='POSTED' AND x."partyId"=d."partyId" AND lower(trim(x.reference))=lower(trim(d.reference)) AND(x."referenceReliable" OR d."referenceReliable")) THEN RAISE EXCEPTION 'FINANCE_DUPLICATE_REFERENCE' USING ERRCODE='P0001';END IF;
END $function$
;
CREATE OR REPLACE FUNCTION public.encova_finance_check_movement(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$ DECLARE d public."FinanceMovement"%ROWTYPE;j UUID;a public."FinanceInvestmentAllocation"%ROWTYPE;BEGIN
 IF EXISTS(SELECT 1 FROM public."FinanceOpeningLine" l JOIN public."FinanceOpeningPosting" p ON p."lineId"=l.id WHERE l.id=target) THEN PERFORM public.encova_finance_opening_source_check(target);RETURN;END IF;

 IF target IS NULL THEN RETURN;END IF;PERFORM public.encova_finance_check_movement_f23(target);SELECT * INTO d FROM public."FinanceMovement" WHERE id=target;SELECT id INTO j FROM public."FinanceJournalEntry" WHERE "movementId"=target;
 IF(d.kind IN('INVESTMENT_DISPOSAL','INVESTMENT_IMPAIRMENT','INVESTMENT_VALUATION_UP','INVESTMENT_VALUATION_DOWN'))<>(EXISTS(SELECT 1 FROM public."FinanceInvestmentAllocation" WHERE "movementId"=target)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 FOR a IN SELECT * FROM public."FinanceInvestmentAllocation" WHERE "movementId"=target LOOP PERFORM public.encova_finance_investment_check_allocation(a.id);END LOOP;
 IF d.state<>'POSTED' THEN IF EXISTS(SELECT 1 FROM public."FinanceInvestmentIncomeEvent" WHERE "movementId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;END IF;
 IF EXISTS(SELECT 1 FROM public."FinanceInvestmentEvent" WHERE "movementId"=target AND("journalId" IS DISTINCT FROM j OR("journalId" IS NULL AND NOT public.encova_finance_investment_register_only(target)))) OR EXISTS((SELECT "holdingId",amount FROM public."FinanceInvestmentIncomeEvent" WHERE "movementId"=target) EXCEPT(SELECT * FROM public.encova_finance_investment_income_expected(target))) OR EXISTS((SELECT * FROM public.encova_finance_investment_income_expected(target)) EXCEPT(SELECT "holdingId",amount FROM public."FinanceInvestmentIncomeEvent" WHERE "movementId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceInvestmentIncomeEvent" WHERE "movementId"=target AND("journalId" IS DISTINCT FROM j OR "effectiveDate"<>d."postingDate")) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(amount) OVER(PARTITION BY "holdingId" ORDER BY "effectiveDate" RANGE UNBOUNDED PRECEDING) balance FROM public."FinanceInvestmentIncomeEvent" WHERE "holdingId" IN(SELECT "holdingId" FROM public.encova_finance_investment_income_expected(target)))v WHERE balance<0) THEN RAISE EXCEPTION 'FINANCE_INVESTMENT_INCOME_CAPACITY' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT l.cost AS original_cost,l.units AS original_units,sum(e."costDelta") OVER(PARTITION BY e."lotId" ORDER BY e."effectiveDate" RANGE UNBOUNDED PRECEDING) cost,sum(e."unitsDelta") OVER(PARTITION BY e."lotId" ORDER BY e."effectiveDate" RANGE UNBOUNDED PRECEDING) units FROM public."FinanceInvestmentEvent" e JOIN public."FinanceInvestmentLot" l ON l.id=e."lotId" WHERE e."lotId" IN(SELECT "lotId" FROM public.encova_finance_investment_expected(target)))v WHERE cost>original_cost OR units>original_units) THEN RAISE EXCEPTION 'FINANCE_INVESTMENT_CAPACITY' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(e."costDelta") OVER(PARTITION BY e."lotId" ORDER BY e."effectiveDate" RANGE UNBOUNDED PRECEDING) cost,sum(e."carryingDelta") OVER(PARTITION BY e."lotId" ORDER BY e."effectiveDate" RANGE UNBOUNDED PRECEDING) carrying,sum(e."unitsDelta") OVER(PARTITION BY e."lotId" ORDER BY e."effectiveDate" RANGE UNBOUNDED PRECEDING) units FROM public."FinanceInvestmentEvent" e WHERE e."lotId" IN(SELECT "lotId" FROM public.encova_finance_investment_expected(target)))v WHERE cost=0 AND coalesce(units,0)=0 AND carrying<>0) THEN RAISE EXCEPTION 'FINANCE_INVESTMENT_CAPACITY' USING ERRCODE='P0001';END IF;
END $function$
;
CREATE OR REPLACE FUNCTION public.encova_finance_check_customer(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;origin public."FinanceCustomerDocument"%ROWTYPE;e public."FinanceJournalEntry"%ROWTYPE;s public."FinanceCustomerCreditSplit"%ROWTYPE;n_alloc BIGINT;n_credit BIGINT;alloc_sum NUMERIC;credit_sum NUMERIC;expected_ar NUMERIC;
BEGIN
 IF EXISTS(SELECT 1 FROM public."FinanceOpeningLine" l JOIN public."FinanceOpeningPosting" p ON p."lineId"=l.id WHERE l.id=target) THEN PERFORM public.encova_finance_opening_source_check(target);RETURN;END IF;

 SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=target;
 IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 SELECT count(*),coalesce(sum(x.amount),0) INTO n_alloc,alloc_sum FROM public."FinanceCustomerAllocation" x WHERE x."documentId"=target;
 SELECT count(*),coalesce(sum(x.amount),0) INTO n_credit,credit_sum FROM public."FinanceCustomerCreditLine" x WHERE x."documentId"=target;
 IF (d.kind IN('RECEIPT','ADVANCE_APPLICATION','UNALLOCATION') AND (n_alloc NOT BETWEEN 0 AND 100 OR (d.kind<>'RECEIPT' AND n_alloc=0) OR alloc_sum<>d."allocationAmount" OR n_credit<>0)) OR (d.kind='CUSTOMER_CREDIT' AND (n_alloc<>0 OR n_credit NOT BETWEEN 1 AND 100 OR credit_sum<>d."totalAmount" OR EXISTS(SELECT 1 FROM public."FinanceCustomerCreditLine" c JOIN public."FinanceInvoiceLine" l ON l.id=c."invoiceLineId" WHERE c."documentId"=target AND l."invoiceId"<>d."creditInvoiceId"))) OR (d.kind IN('CUSTOMER_REFUND','REVERSAL') AND (n_alloc<>0 OR n_credit<>0)) THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_TOTALS' USING ERRCODE='P0001';END IF;
 SELECT * INTO e FROM public."FinanceJournalEntry" WHERE "customerDocumentId"=target;
 IF d.state<>'POSTED' THEN
  IF e.id IS NOT NULL OR EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" WHERE "customerDocumentId"=target) OR EXISTS(SELECT 1 FROM public."FinanceClientBalanceEvent" WHERE "documentId"=target) OR EXISTS(SELECT 1 FROM public."FinanceInvoiceCreditEvent" WHERE "customerDocumentId"=target) OR EXISTS(SELECT 1 FROM public."FinanceDeferredRevenueEvent" WHERE "customerDocumentId"=target) OR EXISTS(SELECT 1 FROM public."FinanceCustomerCreditSplit" WHERE "documentId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;
 END IF;
 IF e.id IS NULL OR e."sourceType"<>'CUSTOMER_DOCUMENT' OR e."postingDate"<>d."postingDate" OR e.description<>d.description OR e.evidence<>d.evidence OR d."partySnapshot" IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF d.kind='REVERSAL' THEN
  SELECT * INTO origin FROM public."FinanceCustomerDocument" WHERE id=d."reversalOfId";
  IF origin.id IS NULL OR origin.state<>'POSTED' OR origin.kind='REVERSAL' OR origin."postingDate">d."postingDate" OR ROW(d."partyId",d."projectId",d."cashAccountId",d."feeAccountId",d."advanceAccountId",d."sourceDocumentId",d."creditInvoiceId",d."cashAmount",d."feeAmount",d."allocationAmount",d."advanceAmount",d."totalAmount",d."withholdingAmount",d."withholdingCodeId",d."withholdingSnapshot",d."withholdingAccountId") IS DISTINCT FROM ROW(origin."partyId",origin."projectId",origin."cashAccountId",origin."feeAccountId",origin."advanceAccountId",origin."sourceDocumentId",origin."creditInvoiceId",origin."cashAmount",origin."feeAmount",origin."allocationAmount",origin."advanceAmount",origin."totalAmount",origin."withholdingAmount",origin."withholdingCodeId",origin."withholdingSnapshot",origin."withholdingAccountId") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='UNALLOCATION' THEN
  SELECT * INTO origin FROM public."FinanceCustomerDocument" WHERE id=d."unallocationOfId";
  IF origin.kind IS DISTINCT FROM 'RECEIPT' OR origin.state<>'POSTED' OR origin."partyId"<>d."partyId" OR origin."projectId" IS DISTINCT FROM d."projectId" OR origin."postingDate">d."postingDate" OR origin."allocationAmount"<>d."totalAmount" OR EXISTS((SELECT sequence,"invoiceId",amount FROM public."FinanceCustomerAllocation" WHERE "documentId"=target) EXCEPT(SELECT sequence,"invoiceId",amount FROM public."FinanceCustomerAllocation" WHERE "documentId"=origin.id)) OR EXISTS((SELECT sequence,"invoiceId",amount FROM public."FinanceCustomerAllocation" WHERE "documentId"=origin.id) EXCEPT(SELECT sequence,"invoiceId",amount FROM public."FinanceCustomerAllocation" WHERE "documentId"=target)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 END IF;
 IF d.kind='CUSTOMER_CREDIT' THEN
  IF EXISTS(SELECT 1 FROM public."FinanceCustomerCreditLine" c JOIN public."FinanceInvoiceLine" l ON l.id=c."invoiceLineId" LEFT JOIN public."FinanceCreditTaxSplit" t ON t."customerCreditLineId"=c.id WHERE c."documentId"=target AND((l."taxAmount">0 AND t.id IS NULL) OR(t.id IS NOT NULL AND(t."netAmount"+t."taxAmount"<>c.amount OR t."taxAccountId" IS DISTINCT FROM l."taxAccountId")))) THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;
  SELECT * INTO s FROM public."FinanceCustomerCreditSplit" WHERE "documentId"=target;
  SELECT least(d."totalAmount",coalesce(sum(v.amount),0)) INTO expected_ar FROM public."FinanceReceivableEvent" v WHERE v."invoiceId"=d."creditInvoiceId" AND v."effectiveDate"<=d."postingDate" AND v."customerDocumentId" IS DISTINCT FROM target;
  IF s."documentId" IS NULL OR s."arAmount"+s."balanceAmount"<>d."totalAmount" OR s."arAmount"<>expected_ar THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 ELSIF EXISTS(SELECT 1 FROM public."FinanceCustomerCreditSplit" WHERE "documentId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id) EXCEPT(SELECT * FROM public.encova_finance_customer_lines(target))) OR EXISTS((SELECT * FROM public.encova_finance_customer_lines(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "invoiceId",amount FROM public."FinanceReceivableEvent" WHERE "customerDocumentId"=target) EXCEPT(SELECT * FROM public.encova_finance_customer_ar(target))) OR EXISTS((SELECT * FROM public.encova_finance_customer_ar(target)) EXCEPT(SELECT "invoiceId",amount FROM public."FinanceReceivableEvent" WHERE "customerDocumentId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceReceivableEvent" v JOIN public."FinanceInvoice" i ON i.id=v."invoiceId" WHERE v."customerDocumentId"=target AND(v."partyId"<>d."partyId" OR v."accountId"<>i."receivableAccountId" OR v."journalId"<>e.id OR v."effectiveDate"<>d."postingDate" OR v.kind<>d.kind)) THEN RAISE EXCEPTION 'FINANCE_RECEIVABLE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "sourceDocumentId","accountId",amount,kind FROM public."FinanceClientBalanceEvent" WHERE "documentId"=target) EXCEPT(SELECT * FROM public.encova_finance_customer_fund(target))) OR EXISTS((SELECT * FROM public.encova_finance_customer_fund(target)) EXCEPT(SELECT "sourceDocumentId","accountId",amount,kind FROM public."FinanceClientBalanceEvent" WHERE "documentId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceClientBalanceEvent" b WHERE b."documentId"=target AND(b."partyId"<>d."partyId" OR b."journalId"<>e.id OR b."effectiveDate"<>d."postingDate")) THEN RAISE EXCEPTION 'FINANCE_CLIENT_BALANCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "invoiceLineId",amount FROM public."FinanceInvoiceCreditEvent" WHERE "customerDocumentId"=target) EXCEPT(SELECT * FROM public.encova_finance_customer_credits(target))) OR EXISTS((SELECT * FROM public.encova_finance_customer_credits(target)) EXCEPT(SELECT "invoiceLineId",amount FROM public."FinanceInvoiceCreditEvent" WHERE "customerDocumentId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceInvoiceCreditEvent" c WHERE c."customerDocumentId"=target AND(c."journalId"<>e.id OR c."effectiveDate"<>d."postingDate" OR c.kind<>d.kind)) THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "invoiceLineId",amount FROM public."FinanceDeferredRevenueEvent" WHERE "customerDocumentId"=target) EXCEPT(SELECT x.* FROM public.encova_finance_customer_deferred_credits(target) x JOIN public."FinanceInvoiceLine" l ON l.id=x."invoiceLineId" WHERE l.recognition='DEFERRED')) OR EXISTS((SELECT x.* FROM public.encova_finance_customer_deferred_credits(target) x JOIN public."FinanceInvoiceLine" l ON l.id=x."invoiceLineId" WHERE l.recognition='DEFERRED') EXCEPT(SELECT "invoiceLineId",amount FROM public."FinanceDeferredRevenueEvent" WHERE "customerDocumentId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceDeferredRevenueEvent" v WHERE v."customerDocumentId"=target AND(v."journalId"<>e.id OR v."effectiveDate"<>d."postingDate" OR v.kind<>d.kind)) THEN RAISE EXCEPTION 'FINANCE_DEFERRED_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(v.amount) OVER(PARTITION BY v."invoiceId" ORDER BY v."effectiveDate" RANGE UNBOUNDED PRECEDING) AS balance FROM public."FinanceReceivableEvent" v WHERE v."invoiceId" IN(SELECT "invoiceId" FROM public.encova_finance_customer_ar(target)))balances WHERE balance<0) THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(b.amount) OVER(PARTITION BY b."sourceDocumentId" ORDER BY b."effectiveDate" RANGE UNBOUNDED PRECEDING) AS balance FROM public."FinanceClientBalanceEvent" b WHERE b."sourceDocumentId" IN(SELECT "sourceDocumentId" FROM public.encova_finance_customer_fund(target)))balances WHERE balance<0) THEN RAISE EXCEPTION 'FINANCE_ADVANCE_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT l."totalAmount"+sum(c.amount) OVER(PARTITION BY c."invoiceLineId" ORDER BY c."effectiveDate" RANGE UNBOUNDED PRECEDING) AS capacity FROM public."FinanceInvoiceCreditEvent" c JOIN public."FinanceInvoiceLine" l ON l.id=c."invoiceLineId" WHERE c."invoiceLineId" IN(SELECT "invoiceLineId" FROM public.encova_finance_customer_credits(target)))balances WHERE capacity<0) THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(v.amount) OVER(PARTITION BY v."invoiceLineId" ORDER BY v."effectiveDate" RANGE UNBOUNDED PRECEDING) AS capacity FROM public."FinanceDeferredRevenueEvent" v WHERE v."invoiceLineId" IN(SELECT "invoiceLineId" FROM public.encova_finance_customer_deferred_credits(target)))balances WHERE capacity<0) THEN RAISE EXCEPTION 'FINANCE_DEFERRED_MISMATCH' USING ERRCODE='P0001';END IF;
END $function$
;
CREATE OR REPLACE FUNCTION public.encova_finance_check_supplier(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE d public."FinanceSupplierDocument"%ROWTYPE;origin public."FinanceSupplierDocument"%ROWTYPE;e public."FinanceJournalEntry"%ROWTYPE;s public."FinanceSupplierCreditSplit"%ROWTYPE;n_alloc BIGINT;n_credit BIGINT;alloc_sum NUMERIC;credit_sum NUMERIC;expected_ar NUMERIC;
BEGIN
 IF EXISTS(SELECT 1 FROM public."FinanceOpeningLine" l JOIN public."FinanceOpeningPosting" p ON p."lineId"=l.id WHERE l.id=target) THEN PERFORM public.encova_finance_opening_source_check(target);RETURN;END IF;

 SELECT * INTO d FROM public."FinanceSupplierDocument" WHERE id=target;
 IF d.id IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 SELECT count(*),coalesce(sum(x.amount),0) INTO n_alloc,alloc_sum FROM public."FinanceSupplierAllocation" x WHERE x."documentId"=target;
 SELECT count(*),coalesce(sum(x.amount),0) INTO n_credit,credit_sum FROM public."FinanceSupplierCreditLine" x WHERE x."documentId"=target;
 IF (d.kind IN('PAYMENT','ADVANCE_APPLICATION','UNALLOCATION') AND (n_alloc NOT BETWEEN 0 AND 100 OR (d.kind<>'PAYMENT' AND n_alloc=0) OR alloc_sum<>d."allocationAmount" OR n_credit<>0)) OR (d.kind='SUPPLIER_CREDIT' AND (n_alloc<>0 OR n_credit NOT BETWEEN 1 AND 100 OR credit_sum<>d."totalAmount" OR EXISTS(SELECT 1 FROM public."FinanceSupplierCreditLine" c JOIN public."FinanceBillLine" l ON l.id=c."billLineId" WHERE c."documentId"=target AND l."billId"<>d."creditBillId"))) OR (d.kind IN('SUPPLIER_REFUND','REVERSAL') AND (n_alloc<>0 OR n_credit<>0)) THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_TOTALS' USING ERRCODE='P0001';END IF;
 SELECT * INTO e FROM public."FinanceJournalEntry" WHERE "supplierDocumentId"=target;
 IF d.state<>'POSTED' THEN
  IF e.id IS NOT NULL OR EXISTS(SELECT 1 FROM public."FinancePayableEvent" WHERE "supplierDocumentId"=target) OR EXISTS(SELECT 1 FROM public."FinanceSupplierBalanceEvent" WHERE "documentId"=target) OR EXISTS(SELECT 1 FROM public."FinanceBillCreditEvent" WHERE "supplierDocumentId"=target) OR EXISTS(SELECT 1 FROM public."FinanceSupplierCreditSplit" WHERE "documentId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;
 END IF;
 IF e.id IS NULL OR e."sourceType"<>'SUPPLIER_DOCUMENT' OR e."postingDate"<>d."postingDate" OR e.description<>d.description OR e.evidence<>d.evidence OR d."partySnapshot" IS NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF d.kind='REVERSAL' THEN
  SELECT * INTO origin FROM public."FinanceSupplierDocument" WHERE id=d."reversalOfId";
  IF origin.id IS NULL OR origin.state<>'POSTED' OR origin.kind='REVERSAL' OR origin."postingDate">d."postingDate" OR ROW(d."partyId",d."projectId",d."cashAccountId",d."feeAccountId",d."advanceAccountId",d."sourceDocumentId",d."creditBillId",d."cashAmount",d."feeAmount",d."allocationAmount",d."advanceAmount",d."totalAmount",d."withholdingAmount",d."withholdingCodeId",d."withholdingSnapshot",d."withholdingAccountId") IS DISTINCT FROM ROW(origin."partyId",origin."projectId",origin."cashAccountId",origin."feeAccountId",origin."advanceAccountId",origin."sourceDocumentId",origin."creditBillId",origin."cashAmount",origin."feeAmount",origin."allocationAmount",origin."advanceAmount",origin."totalAmount",origin."withholdingAmount",origin."withholdingCodeId",origin."withholdingSnapshot",origin."withholdingAccountId") THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='UNALLOCATION' THEN
  SELECT * INTO origin FROM public."FinanceSupplierDocument" WHERE id=d."unallocationOfId";
  IF origin.kind IS DISTINCT FROM 'PAYMENT' OR origin.state<>'POSTED' OR origin."partyId"<>d."partyId" OR origin."projectId" IS DISTINCT FROM d."projectId" OR origin."postingDate">d."postingDate" OR origin."allocationAmount"<>d."totalAmount" OR EXISTS((SELECT sequence,"billId",amount FROM public."FinanceSupplierAllocation" WHERE "documentId"=target) EXCEPT(SELECT sequence,"billId",amount FROM public."FinanceSupplierAllocation" WHERE "documentId"=origin.id)) OR EXISTS((SELECT sequence,"billId",amount FROM public."FinanceSupplierAllocation" WHERE "documentId"=origin.id) EXCEPT(SELECT sequence,"billId",amount FROM public."FinanceSupplierAllocation" WHERE "documentId"=target)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 END IF;
 IF d.kind='SUPPLIER_CREDIT' THEN
  IF EXISTS(SELECT 1 FROM public."FinanceSupplierCreditLine" c JOIN public."FinanceBillLine" l ON l.id=c."billLineId" LEFT JOIN public."FinanceCreditTaxSplit" t ON t."supplierCreditLineId"=c.id WHERE c."documentId"=target AND((l."taxAmount">0 AND t.id IS NULL) OR(t.id IS NOT NULL AND(t."netAmount"+t."taxAmount"<>c.amount OR t."taxAccountId" IS DISTINCT FROM l."taxAccountId")))) THEN RAISE EXCEPTION 'FINANCE_TAX_MISMATCH' USING ERRCODE='P0001';END IF;
  SELECT * INTO s FROM public."FinanceSupplierCreditSplit" WHERE "documentId"=target;
  SELECT least(d."totalAmount",coalesce(sum(v.amount),0)) INTO expected_ar FROM public."FinancePayableEvent" v WHERE v."billId"=d."creditBillId" AND v."effectiveDate"<=d."postingDate" AND v."supplierDocumentId" IS DISTINCT FROM target;
  IF s."documentId" IS NULL OR s."arAmount"+s."balanceAmount"<>d."totalAmount" OR s."arAmount"<>expected_ar THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 ELSIF EXISTS(SELECT 1 FROM public."FinanceSupplierCreditSplit" WHERE "documentId"=target) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","billLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id) EXCEPT(SELECT * FROM public.encova_finance_supplier_lines(target))) OR EXISTS((SELECT * FROM public.encova_finance_supplier_lines(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId","billLineId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "billId",amount FROM public."FinancePayableEvent" WHERE "supplierDocumentId"=target) EXCEPT(SELECT * FROM public.encova_finance_supplier_ar(target))) OR EXISTS((SELECT * FROM public.encova_finance_supplier_ar(target)) EXCEPT(SELECT "billId",amount FROM public."FinancePayableEvent" WHERE "supplierDocumentId"=target)) OR EXISTS(SELECT 1 FROM public."FinancePayableEvent" v JOIN public."FinanceBill" i ON i.id=v."billId" WHERE v."supplierDocumentId"=target AND(v."partyId"<>d."partyId" OR v."accountId"<>i."payableAccountId" OR v."journalId"<>e.id OR v."effectiveDate"<>d."postingDate" OR v.kind<>d.kind)) THEN RAISE EXCEPTION 'FINANCE_PAYABLE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "sourceDocumentId","accountId",amount,kind FROM public."FinanceSupplierBalanceEvent" WHERE "documentId"=target) EXCEPT(SELECT * FROM public.encova_finance_supplier_fund(target))) OR EXISTS((SELECT * FROM public.encova_finance_supplier_fund(target)) EXCEPT(SELECT "sourceDocumentId","accountId",amount,kind FROM public."FinanceSupplierBalanceEvent" WHERE "documentId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceSupplierBalanceEvent" b WHERE b."documentId"=target AND(b."partyId"<>d."partyId" OR b."journalId"<>e.id OR b."effectiveDate"<>d."postingDate")) THEN RAISE EXCEPTION 'FINANCE_CLIENT_BALANCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT "billLineId",amount FROM public."FinanceBillCreditEvent" WHERE "supplierDocumentId"=target) EXCEPT(SELECT * FROM public.encova_finance_supplier_credits(target))) OR EXISTS((SELECT * FROM public.encova_finance_supplier_credits(target)) EXCEPT(SELECT "billLineId",amount FROM public."FinanceBillCreditEvent" WHERE "supplierDocumentId"=target)) OR EXISTS(SELECT 1 FROM public."FinanceBillCreditEvent" c WHERE c."supplierDocumentId"=target AND(c."journalId"<>e.id OR c."effectiveDate"<>d."postingDate" OR c.kind<>d.kind)) THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(v.amount) OVER(PARTITION BY v."billId" ORDER BY v."effectiveDate" RANGE UNBOUNDED PRECEDING) AS balance FROM public."FinancePayableEvent" v WHERE v."billId" IN(SELECT "billId" FROM public.encova_finance_supplier_ar(target)))balances WHERE balance<0) THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT sum(b.amount) OVER(PARTITION BY b."sourceDocumentId" ORDER BY b."effectiveDate" RANGE UNBOUNDED PRECEDING) AS balance FROM public."FinanceSupplierBalanceEvent" b WHERE b."sourceDocumentId" IN(SELECT "sourceDocumentId" FROM public.encova_finance_supplier_fund(target)))balances WHERE balance<0) THEN RAISE EXCEPTION 'FINANCE_ADVANCE_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT l."totalAmount"+sum(c.amount) OVER(PARTITION BY c."billLineId" ORDER BY c."effectiveDate" RANGE UNBOUNDED PRECEDING) AS capacity FROM public."FinanceBillCreditEvent" c JOIN public."FinanceBillLine" l ON l.id=c."billLineId" WHERE c."billLineId" IN(SELECT "billLineId" FROM public.encova_finance_supplier_credits(target)))balances WHERE capacity<0) THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
END $function$
;
CREATE OR REPLACE FUNCTION public.encova_finance_check_asset_movement(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$ DECLARE d public."FinanceAssetMovement"%ROWTYPE;o public."FinanceAssetMovement"%ROWTYPE;e public."FinanceJournalEntry"%ROWTYPE;v public."FinanceAssetEvent"%ROWTYPE;BEGIN
 IF EXISTS(SELECT 1 FROM public."FinanceOpeningLine" l JOIN public."FinanceOpeningPosting" p ON p."lineId"=l.id WHERE l.id=target) THEN PERFORM public.encova_finance_opening_source_check(target);RETURN;END IF;

 SELECT * INTO d FROM public."FinanceAssetMovement" WHERE id=target;SELECT * INTO e FROM public."FinanceJournalEntry" WHERE "assetMovementId"=target;SELECT * INTO v FROM public."FinanceAssetEvent" WHERE "movementId"=target;
 IF d.state<>'POSTED' THEN IF e.id IS NOT NULL OR v.id IS NOT NULL OR d."sourceSnapshot" IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;RETURN;END IF;
 IF d.id IS NULL OR v.id IS NULL OR v."assetId"<>d."assetId" OR v."journalId" IS DISTINCT FROM e.id OR v."effectiveDate"<>d."postingDate" OR d."sourceSnapshot" IS DISTINCT FROM public.encova_finance_asset_movement_snapshot(target) OR ROW(v."costDelta",v."depreciationDelta",v."disposalDelta",v.policy) IS DISTINCT FROM(SELECT ROW(x."costDelta",x."depreciationDelta",x."disposalDelta",x.policy) FROM public.encova_finance_asset_expected(target)x) THEN RAISE EXCEPTION 'FINANCE_ASSET_EVENT_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM public.encova_finance_asset_movement_lines(target)) THEN IF e.id IS NULL OR e."sourceType"<>'ASSET_MOVEMENT' OR e."postingDate"<>d."postingDate" OR e.description<>d.description OR e.evidence<>d.evidence THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;ELSIF e.id IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF EXISTS((SELECT sequence,"accountId",description,debit,credit,"projectId","partyId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id) EXCEPT(SELECT * FROM public.encova_finance_asset_movement_lines(target))) OR EXISTS((SELECT * FROM public.encova_finance_asset_movement_lines(target)) EXCEPT(SELECT sequence,"accountId",description,debit,credit,"projectId","partyId" FROM public."FinanceJournalLine" WHERE "journalId"=e.id)) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
 IF d.kind='REVERSAL' THEN SELECT * INTO o FROM public."FinanceAssetMovement" WHERE id=d."reversalOfId";IF o.state IS DISTINCT FROM 'POSTED' OR o.kind='REVERSAL' OR d."postingDate"<o."postingDate" OR(to_jsonb(d)-ARRAY['id','number','kind','postingDate','evidence','approvalEvidence','basisHash','basisSnapshot','sourceSnapshot','state','version','reversalOfId','createdById','createdAt','updatedAt']) IS DISTINCT FROM(to_jsonb(o)-ARRAY['id','number','kind','postingDate','evidence','approvalEvidence','basisHash','basisSnapshot','sourceSnapshot','state','version','reversalOfId','createdById','createdAt','updatedAt']) THEN RAISE EXCEPTION 'FINANCE_REVERSAL_INVALID' USING ERRCODE='P0001';END IF;END IF;
 PERFORM public.encova_finance_asset_check(d."assetId");
END $function$
;
CREATE OR REPLACE FUNCTION public.encova_finance_asset_source(bill_line uuid, funding_movement uuid)
 RETURNS TABLE("accountId" uuid, "documentDate" date, "postingDate" date, "eligibleCost" numeric, snapshot jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT l."costAccountId",b."billDate",b."postingDate",cost.amount,jsonb_build_object('sourceType','BILL_LINE','billId',b.id,'number',b.number,'lineId',l.id,'description',l.description,'originalNetCost',l."netAmount"::text,'recoverableTax',l."taxAmount"::text,'eligibleCost',cost.amount::text,'party',b."partySnapshot",'evidence',b.evidence) FROM public."FinanceBillLine" l JOIN public."FinanceBill" b ON b.id=l."billId" JOIN public."FinanceAccount" a ON a.id=l."costAccountId" CROSS JOIN LATERAL(SELECT coalesce(sum(debit-credit),0) AS amount FROM public."FinanceJournalLine" WHERE "billLineId"=l.id AND "accountId"=l."costAccountId")cost WHERE funding_movement IS NULL AND l.id=bill_line AND b.state='POSTED' AND l.treatment='ASSET' AND a."controlType"='FIXED_ASSET'
 UNION ALL SELECT d."counterAccountId",d."documentDate",d."postingDate",cost.amount,jsonb_build_object('sourceType','FUNDING_MOVEMENT','number',d.number,'movementId',d.id,'description',d.description,'eligibleCost',cost.amount::text,'sourceSnapshot',d."sourceSnapshot",'evidence',d.evidence) FROM public."FinanceMovement" d JOIN public."FinanceAccount" a ON a.id=d."counterAccountId" CROSS JOIN LATERAL(SELECT coalesce(sum(l.debit-l.credit),0) AS amount FROM public."FinanceJournalLine" l JOIN public."FinanceJournalEntry" e ON e.id=l."journalId" JOIN public."FinanceMovement" m ON m.id=e."movementId" WHERE(m.id=d.id OR m."reversalOfId"=d.id) AND l."accountId"=d."counterAccountId")cost WHERE bill_line IS NULL AND d.id=funding_movement AND d.state='POSTED' AND d.kind IN('NONCASH_CAPITAL','FOUNDER_OUTLAY') AND a."controlType"='FIXED_ASSET'
 UNION ALL SELECT l."accountId",l."originalDate",b."cutoverDate",l.amount,jsonb_build_object('sourceType','OPENING','batchId',b.id,'sourceHash',b."sourceHash",'lineId',l.id,'reference',l.reference,'grossCost',l.amount::text,'accumulatedDepreciation',l.accumulated::text) FROM public."FinanceOpeningLine" l JOIN public."FinanceOpeningBatch" b ON b.id=l."batchId" JOIN public."FinanceMovement" m ON m.id=l.id WHERE bill_line IS NULL AND l.id=funding_movement AND l.kind='ASSET' AND m.state='POSTED'
$function$
;
CREATE OR REPLACE FUNCTION public.encova_finance_asset_plan(target uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$ DECLARE a public."FinanceAsset"%ROWTYPE;policy_event public."FinanceAssetEvent"%ROWTYPE;BEGIN
 SELECT * INTO a FROM public."FinanceAsset" WHERE id=target;
 SELECT e.* INTO policy_event FROM public."FinanceAssetEvent" e JOIN public."FinanceAssetMovement" m ON m.id=e."movementId" WHERE e."assetId"=target AND m.kind='POLICY_CHANGE' AND m.state='POSTED' AND NOT EXISTS(SELECT 1 FROM public."FinanceAssetMovement" r WHERE r."reversalOfId"=m.id AND r.state='POSTED') ORDER BY e."recordedAt" DESC,e.id LIMIT 1;
 IF EXISTS(SELECT 1 FROM public."FinanceAssetEvent" e JOIN public."FinanceAssetMovement" m ON m.id=e."movementId" WHERE e."assetId"=target AND(m.kind IN('IMPAIRMENT','ADJUSTMENT_INCREASE','ADJUSTMENT_DECREASE','REVERSAL')) AND e."recordedAt">coalesce(policy_event."recordedAt",'-infinity'::timestamptz)) THEN RAISE EXCEPTION 'FINANCE_ASSET_POLICY_REVIEW' USING ERRCODE='P0001';END IF;
 IF policy_event.id IS NOT NULL THEN RETURN policy_event.policy;END IF;
 IF a.convention<>'FULL_MONTH_FROM_FIRST_MONTH' OR a."firstDepMonth" IS NULL OR a."policyEvidence" IS NULL THEN RAISE EXCEPTION 'FINANCE_ASSET_POLICY' USING ERRCODE='P0001';END IF;
 RETURN jsonb_build_object('base',(a.cost-a."residualValue"-coalesce((SELECT accumulated FROM public."FinanceOpeningLine" WHERE id=a.id AND kind='ASSET'),0))::text,'residual',a."residualValue"::text,'months',a."usefulLifeMonths",'firstMonth',a."firstDepMonth");
END $function$
;
CREATE OR REPLACE FUNCTION public.encova_finance_close_assert_open(effective date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$ BEGIN
 IF EXISTS(SELECT 1 FROM public."FinanceOpeningBatch" WHERE state='POSTED' AND "cutoverDate">effective) THEN RAISE EXCEPTION 'FINANCE_OPENING_DATE' USING ERRCODE='P0001';END IF;
 IF effective IS NULL OR EXISTS(SELECT 1 FROM public."FinancePeriod" p JOIN public."FinancePeriodClose" c ON c."periodId"=p.id AND c.state='CLOSED' WHERE p.state='CLOSED' AND p."endDate">=effective) THEN RAISE EXCEPTION 'FINANCE_PERIOD_UNAVAILABLE' USING ERRCODE='P0001';END IF;
END $function$
;
CREATE OR REPLACE FUNCTION public.encova_finance_cash_flow_report(date_from date, cutoff date, search text, requested_page integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$ DECLARE result JSONB;BEGIN
 WITH actual AS MATERIALIZED(SELECT * FROM public.encova_finance_cash_flow_lines(cutoff)),period AS MATERIALIZED(SELECT * FROM actual WHERE "postingDate">=date_from AND "sourceType"<>'OPENING'),
 balances AS(SELECT coalesce(sum(delta) FILTER(WHERE "postingDate"<date_from OR "sourceType"='OPENING'),0) AS opening,coalesce(sum(delta),0) AS closing FROM actual),
 categories AS(SELECT p->>'category' AS category,sum((p->>'signedAmount')::numeric) FILTER(WHERE(p->>'signedAmount')::numeric>0) AS inflows,-sum((p->>'signedAmount')::numeric) FILTER(WHERE(p->>'signedAmount')::numeric<0) AS outflows,sum((p->>'signedAmount')::numeric) AS net FROM period b CROSS JOIN LATERAL jsonb_array_elements(b.components)p WHERE b.classified GROUP BY p->>'category'),
 summary AS(SELECT count(DISTINCT "journalId") FILTER(WHERE NOT classified)::integer AS missing,coalesce(sum(delta) FILTER(WHERE NOT classified),0) AS unclassified,encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('line',"journalLineId",'review',"reviewId",'version',"reviewVersion",'classified',classified) ORDER BY "journalLineId"),'[]'::jsonb)::text,'UTF8')),'hex') AS digest FROM period),
 groups AS(SELECT "journalId",min("postingDate") AS "postingDate",min(reference) AS reference,min("sourceType") AS "sourceType",min("sourceId"::text)::uuid AS "sourceId",min("originalJournalId"::text)::uuid AS "originalJournalId",min("reviewId"::text)::uuid AS "reviewId",bool_and(classified) AS classified,sum(delta) AS "cashChange",count(*)::integer AS "cashLegCount" FROM period GROUP BY "journalId"),
 displayed AS MATERIALIZED(SELECT * FROM groups WHERE concat_ws(' ',reference,"sourceType","journalId") ILIKE '%'||search||'%'),counts AS(SELECT count(*)::integer AS total,greatest(1,ceil(count(*)/25.0)::integer) AS pages FROM displayed),paging AS(SELECT *,least(requested_page,pages) AS page FROM counts),bounded AS(SELECT * FROM displayed ORDER BY "postingDate","journalId" LIMIT 25 OFFSET((SELECT page FROM paging)-1)*25),rows AS(SELECT coalesce(jsonb_agg((to_jsonb(b)-'cashChange')||jsonb_build_object('cashChange',round(b."cashChange",2)::text) ORDER BY b."postingDate",b."journalId"),'[]'::jsonb) AS items FROM bounded b),external AS(SELECT coalesce(sum(net) FILTER(WHERE category<>'INTERNAL'),0) AS net,coalesce(sum(net) FILTER(WHERE category='INTERNAL'),0) AS internal FROM categories)
 SELECT jsonb_build_object('metadata',public.encova_finance_report_metadata(date_from,cutoff,jsonb_build_object('report','CASH_FLOW','cashScope','All PKR CASH controls, including archived accounts and designated cash equivalents','componentDigest',s.digest,'displaySearch',search)),'openingBalance',round(b.opening,2)::text,'closingBalance',round(b.closing,2)::text,'externalNet',round(x.net,2)::text,'internalNet',round(x.internal,2)::text,'unclassifiedNet',round(s.unclassified,2)::text,'difference',round(b.closing-b.opening-x.net,2)::text,'unclassifiedCount',s.missing,'classificationReady',s.missing=0 AND b.closing-b.opening=x.net AND x.internal=0,'categories',(SELECT jsonb_agg(jsonb_build_object('category',k,'inflows',round(coalesce(c.inflows,0),2)::text,'outflows',round(coalesce(c.outflows,0),2)::text,'net',round(coalesce(c.net,0),2)::text) ORDER BY k) FROM unnest(ARRAY['OPERATING','INVESTING','FINANCING'])k LEFT JOIN categories c ON c.category=k),'items',rows.items,'total',paging.total,'page',paging.page,'pages',paging.pages) INTO result FROM balances b CROSS JOIN summary s CROSS JOIN external x CROSS JOIN paging CROSS JOIN rows;RETURN result;
END $function$
;
CREATE FUNCTION encova_finance_opening_proof(target UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH actual AS(SELECT l."accountId",sum(l.debit-l.credit) AS amount FROM public."FinanceOpeningPosting" p JOIN public."FinanceJournalLine" l ON l."journalId"=p."journalId" WHERE p."batchId"=target GROUP BY l."accountId"),expected AS(SELECT "accountId",debit-credit AS amount FROM public."FinanceOpeningLine" WHERE "batchId"=target AND kind='TB'),rows AS(SELECT coalesce(a."accountId",e."accountId") AS id,coalesce(a.amount,0) AS actual,coalesce(e.amount,0) AS expected FROM actual a FULL JOIN expected e ON e."accountId"=a."accountId")
 SELECT jsonb_build_object('ready',coalesce(bool_and(actual=expected),false),'clearingBalance',coalesce((SELECT amount FROM actual WHERE "accountId"=(SELECT "clearingAccountId" FROM public."FinanceOpeningBatch" WHERE id=target)),0)::numeric(20,2)::text,'accounts',coalesce(jsonb_agg(jsonb_build_object('accountId',id,'expected',expected::numeric(20,2)::text,'posted',actual::numeric(20,2)::text,'difference',(actual-expected)::numeric(20,2)::text) ORDER BY id),'[]'::jsonb),'journalCount',(SELECT count(*) FROM public."FinanceOpeningPosting" WHERE "batchId"=target),'sourceHash',(SELECT "sourceHash" FROM public."FinanceOpeningBatch" WHERE id=target),'journalDigest',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY sequence) FROM public."FinanceJournalLine" l WHERE l."journalId"=e.id)) ORDER BY e.id),'[]'::jsonb)::text,'UTF8')),'hex') FROM public."FinanceJournalEntry" e JOIN public."FinanceOpeningPosting" p ON p."journalId"=e.id WHERE p."batchId"=target)) FROM rows
$$;
CREATE FUNCTION encova_finance_opening_batch_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE source JSONB;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FINANCE_OPENING_RETAINED' USING ERRCODE='P0001';END IF;
 IF TG_OP='INSERT' THEN
  source:=NEW."sourceText"::jsonb;
  IF NEW.state<>'DRAFT' OR NEW.version<>1 OR NEW."postedAt" IS NOT NULL OR NOT public.encova_finance_export_access(NEW."createdById") OR NOT EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=NEW."createdById") OR NEW.name IS DISTINCT FROM trim(source->>'name') OR NEW."cutoverDate" IS DISTINCT FROM(source->>'cutoverDate')::date OR NEW."clearingAccountId" IS DISTINCT FROM(source->>'clearingAccountId')::uuid OR NEW.evidence IS DISTINCT FROM trim(source->>'evidence') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 ELSE
  IF OLD.state<>'DRAFT' OR NEW.state NOT IN('POSTED','VOIDED') OR NEW.version<>OLD.version+1 OR(to_jsonb(NEW)-ARRAY['state','version','postedById','postedAt','reviewEvidence','basisHash','proof']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','postedById','postedAt','reviewEvidence','basisHash','proof']) THEN RAISE EXCEPTION 'FINANCE_OPENING_RETAINED' USING ERRCODE='P0001';END IF;
  IF NEW.state='POSTED' AND(NOT public.encova_finance_export_access(NEW."postedById") OR NOT EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=NEW."postedById") OR length(trim(NEW."reviewEvidence")) NOT BETWEEN 3 AND 1000 OR NEW.proof IS DISTINCT FROM public.encova_finance_opening_proof(NEW.id) OR NOT(NEW.proof->>'ready')::boolean OR NEW.proof->>'clearingBalance'<>'0.00') THEN RAISE EXCEPTION 'FINANCE_OPENING_PROOF' USING ERRCODE='P0001';END IF;
 END IF;RETURN NEW;
 EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END $$;
CREATE TRIGGER "FinanceOpeningBatch_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinanceOpeningBatch" FOR EACH ROW EXECUTE FUNCTION encova_finance_opening_batch_guard();
CREATE FUNCTION encova_finance_opening_staging_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."FinanceOpeningBatch" WHERE id=NEW."batchId" AND state='DRAFT') THEN RAISE EXCEPTION 'FINANCE_OPENING_RETAINED' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "FinanceOpeningLine_stage" BEFORE INSERT ON "FinanceOpeningLine" FOR EACH ROW EXECUTE FUNCTION encova_finance_opening_staging_guard();
CREATE TRIGGER "FinanceOpeningPosting_stage" BEFORE INSERT ON "FinanceOpeningPosting" FOR EACH ROW EXECUTE FUNCTION encova_finance_opening_staging_guard();
CREATE FUNCTION encova_finance_opening_consistency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE target UUID;b public."FinanceOpeningBatch"%ROWTYPE;posting_rec RECORD;BEGIN
 IF TG_TABLE_NAME='FinanceOpeningBatch' THEN target:=NEW.id;ELSE target:=NEW."batchId";END IF;SELECT * INTO b FROM public."FinanceOpeningBatch" WHERE id=target;
 IF b.state='POSTED' THEN
  IF NOT(b.proof->>'ready')::boolean OR b.proof->>'clearingBalance'<>'0.00' OR b.proof IS DISTINCT FROM public.encova_finance_opening_proof(b.id) OR EXISTS(SELECT 1 FROM public."FinanceOpeningLine" l WHERE l."batchId"=b.id AND kind<>'TB' AND NOT EXISTS(SELECT 1 FROM public."FinanceOpeningPosting" p WHERE p."lineId"=l.id AND p."batchId"=b.id)) THEN RAISE EXCEPTION 'FINANCE_OPENING_PROOF' USING ERRCODE='P0001';END IF;
  FOR posting_rec IN SELECT id FROM public."FinanceOpeningPosting" WHERE "batchId"=b.id LOOP PERFORM public.encova_finance_opening_source_check(posting_rec.id);END LOOP;
 ELSIF EXISTS(SELECT 1 FROM public."FinanceOpeningPosting" WHERE "batchId"=b.id) THEN RAISE EXCEPTION 'FINANCE_OPENING_PROOF' USING ERRCODE='P0001';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FinanceOpeningBatch_valid" AFTER INSERT OR UPDATE ON "FinanceOpeningBatch" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_opening_consistency();
CREATE CONSTRAINT TRIGGER "FinanceOpeningLine_valid" AFTER INSERT ON "FinanceOpeningLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_opening_consistency();
CREATE CONSTRAINT TRIGGER "FinanceOpeningPosting_valid" AFTER INSERT ON "FinanceOpeningPosting" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION encova_finance_opening_consistency();
CREATE FUNCTION encova_finance_opening_command(actor UUID,provider TEXT,session_id TEXT,verified_at TIMESTAMPTZ,action TEXT,input JSONB,request_key TEXT,request_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
 DECLARE b public."FinanceOpeningBatch"%ROWTYPE;r public."FinanceLedgerReceipt"%ROWTYPE;source JSONB;line JSONB;position INTEGER:=0;why TEXT;digest TEXT;pack JSONB;result JSONB;item RECORD;journal_id UUID;field TEXT;BEGIN
 IF action IS NULL OR action NOT IN('CREATE','POST','VOID') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR request_key IS NULL OR length(request_key) NOT BETWEEN 8 AND 128 OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR length(trim(input->>'reason')) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 IF verified_at IS NULL OR verified_at<CURRENT_TIMESTAMP-interval '5 minutes' OR verified_at>CURRENT_TIMESTAMP+interval '5 seconds' THEN RAISE EXCEPTION 'FINANCE_REAUTH_REQUIRED' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(987661);PERFORM public.encova_finance_lock_person(actor);IF NOT public.encova_finance_export_access(actor) OR NOT public.encova_finance_session_ok(actor,provider,session_id) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 PERFORM pg_advisory_xact_lock(629815);IF NOT EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=actor) THEN RAISE EXCEPTION 'FINANCE_OWNER_REQUIRED' USING ERRCODE='P0001';END IF;
 IF input-(CASE WHEN action='CREATE' THEN ARRAY['fileName','sourceText','reason'] WHEN action='POST' THEN ARRAY['id','expectedVersion','basisHash','reviewEvidence','reason'] ELSE ARRAY['id','expectedVersion','reason'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 why:=trim(input->>'reason');digest:=encode(sha256(convert_to(input::text,'UTF8')),'hex');SELECT * INTO r FROM public."FinanceLedgerReceipt" WHERE "actorId"=actor AND operation='OPENING_'||action AND key=request_key;
 IF r.id IS NOT NULL THEN IF r."requestHash"<>digest THEN RAISE EXCEPTION 'FINANCE_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';END IF;RETURN r.result;END IF;
 IF action='CREATE' THEN
  IF jsonb_typeof(input->'sourceText') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'fileName') IS DISTINCT FROM 'string' OR length(input->>'fileName') NOT BETWEEN 1 AND 160 OR input->>'fileName' !~* '[.]json$' OR octet_length(input->>'sourceText')>180000 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  source:=(input->>'sourceText')::jsonb;
  FOREACH field IN ARRAY ARRAY['name','currency','cutoverDate','clearingAccountId','evidence'] LOOP IF jsonb_typeof(source->field) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;END LOOP;
  IF jsonb_typeof(source) IS DISTINCT FROM 'object' OR source-ARRAY['formatVersion','name','currency','cutoverDate','clearingAccountId','evidence','trialBalance','items']<>'{}'::jsonb OR source->'formatVersion' IS DISTINCT FROM '1'::jsonb OR source->>'currency' IS DISTINCT FROM 'PKR' OR jsonb_typeof(source->'trialBalance') IS DISTINCT FROM 'array' OR jsonb_array_length(source->'trialBalance') NOT BETWEEN 2 AND 200 OR jsonb_typeof(source->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(source->'items')>200 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  SELECT * INTO b FROM public."FinanceOpeningBatch" WHERE "sourceHash"=encode(sha256(convert_to(input->>'sourceText','UTF8')),'hex');
  IF b.id IS NULL THEN
   INSERT INTO public."FinanceOpeningBatch"(id,name,"cutoverDate","clearingAccountId","fileName","sourceText","sourceHash",evidence,"createdById") VALUES(gen_random_uuid(),trim(source->>'name'),(source->>'cutoverDate')::date,(source->>'clearingAccountId')::uuid,input->>'fileName',input->>'sourceText',encode(sha256(convert_to(input->>'sourceText','UTF8')),'hex'),trim(source->>'evidence'),actor) RETURNING * INTO b;
   FOR line IN SELECT value FROM jsonb_array_elements(source->'trialBalance') LOOP
    IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR line-ARRAY['accountId','debit','credit']<>'{}'::jsonb OR jsonb_typeof(line->'debit') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'credit') IS DISTINCT FROM 'string' OR line->>'debit' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR line->>'credit' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;position:=position+1;
    INSERT INTO public."FinanceOpeningLine"(id,"batchId",sequence,kind,"accountId",debit,credit,reference,description) VALUES(gen_random_uuid(),b.id,position,'TB',(line->>'accountId')::uuid,(line->>'debit')::numeric,(line->>'credit')::numeric,'TB-'||position::text,'Reviewed imported trial balance');
   END LOOP;
   FOR line IN SELECT value FROM jsonb_array_elements(source->'items') LOOP
    IF line ? 'side' AND (jsonb_typeof(line->'side') IS DISTINCT FROM 'string' OR line->>'side' NOT IN('DEBIT','CREDIT')) THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
    FOREACH field IN ARRAY ARRAY['kind','reference','originalDate','accountId','amount','description'] LOOP IF jsonb_typeof(line->field) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;END LOOP;
    FOREACH field IN ARRAY ARRAY['amount','costBasis','accumulatedDepreciation','residualValue'] LOOP IF line ? field AND(jsonb_typeof(line->field) IS DISTINCT FROM 'string' OR line->>field !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;END LOOP;
    IF line ? 'units' AND line->'units'<>'null'::jsonb AND(jsonb_typeof(line->'units') IS DISTINCT FROM 'string' OR line->>'units' !~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,6})?$') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
    IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR line-ARRAY['kind','side','reference','originalDate','dueDate','accountId','amount','partyId','cashAccountId','loanId','holdingId','secondaryAccountId','resultAccountId','receivableAccountId','costBasis','accumulatedDepreciation','units','tag','description','location','inServiceDate','residualValue','remainingLifeMonths','firstDepMonth','policyEvidence']<>'{}'::jsonb OR jsonb_typeof(line->'amount') IS DISTINCT FROM 'string' OR line->>'amount' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$' OR (line->>'originalDate')::date>(source->>'cutoverDate')::date THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;position:=position+1;
    INSERT INTO public."FinanceOpeningLine"(id,"batchId",sequence,kind,"cashSide","accountId",amount,reference,"originalDate","dueDate",description,"partyId","cashAccountId","loanId","holdingId","secondaryAccountId","resultAccountId","receivableAccountId","costBasis",accumulated,units,tag,location,"inServiceDate",residual,"remainingMonths","firstDepMonth","policyEvidence") VALUES(gen_random_uuid(),b.id,position,line->>'kind',coalesce(line->>'side','DEBIT'),(line->>'accountId')::uuid,(line->>'amount')::numeric,trim(line->>'reference'),(line->>'originalDate')::date,(line->>'dueDate')::date,trim(line->>'description'),(line->>'partyId')::uuid,(line->>'cashAccountId')::uuid,(line->>'loanId')::uuid,(line->>'holdingId')::uuid,(line->>'secondaryAccountId')::uuid,(line->>'resultAccountId')::uuid,(line->>'receivableAccountId')::uuid,coalesce(line->>'costBasis',line->>'amount')::numeric,coalesce(line->>'accumulatedDepreciation','0')::numeric,(line->>'units')::numeric,line->>'tag',line->>'location',(line->>'inServiceDate')::date,coalesce(line->>'residualValue','0')::numeric,(line->>'remainingLifeMonths')::integer,line->>'firstDepMonth',line->>'policyEvidence');
   END LOOP;
  END IF;
 ELSE
  SELECT * INTO b FROM public."FinanceOpeningBatch" WHERE id=(input->>'id')::uuid FOR UPDATE;IF b.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF jsonb_typeof(input->'expectedVersion') IS DISTINCT FROM 'number' OR b.version<>(input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'FINANCE_STALE_VERSION' USING ERRCODE='P0001';END IF;
  IF b.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_OPENING_RETAINED' USING ERRCODE='P0001';END IF;
  IF action='VOID' THEN UPDATE public."FinanceOpeningBatch" SET state='VOIDED',version=version+1 WHERE id=b.id RETURNING * INTO b;
  ELSE
   pack:=public.encova_finance_opening_pack(b.id);IF pack->>'basisHash' IS DISTINCT FROM input->>'basisHash' THEN RAISE EXCEPTION 'FINANCE_OPENING_STALE' USING ERRCODE='P0001';END IF;
   IF NOT(pack->>'ready')::boolean THEN RAISE EXCEPTION 'FINANCE_OPENING_INCOMPLETE' USING ERRCODE='P0001';END IF;
   IF jsonb_typeof(input->'reviewEvidence') IS DISTINCT FROM 'string' OR length(trim(input->>'reviewEvidence')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
   IF EXISTS(SELECT 1 FROM public."FinanceOpeningLine" l JOIN public."FinanceAccount" a ON a.id=l."accountId" WHERE l."batchId"=b.id AND l.kind='TB' AND NOT public.encova_finance_opening_typed(a."controlType")) THEN
    INSERT INTO public."FinanceOpeningPosting"(id,"batchId","journalId") VALUES(b.id,b.id,gen_random_uuid());PERFORM public.encova_finance_opening_emit(actor,b.id);
   END IF;
   FOR item IN SELECT id FROM public."FinanceOpeningLine" WHERE "batchId"=b.id AND kind<>'TB' ORDER BY sequence LOOP
    PERFORM public.encova_finance_opening_prepare_source(actor,item.id);INSERT INTO public."FinanceOpeningPosting"(id,"batchId","lineId","journalId") VALUES(item.id,b.id,item.id,gen_random_uuid());journal_id:=public.encova_finance_opening_emit(actor,item.id);PERFORM public.encova_finance_opening_finish_source(actor,item.id,journal_id);
   END LOOP;
   UPDATE public."FinanceOpeningBatch" SET state='POSTED',version=version+1,"postedById"=actor,"postedAt"=CURRENT_TIMESTAMP,"reviewEvidence"=trim(input->>'reviewEvidence'),"basisHash"=pack->>'basisHash',proof=public.encova_finance_opening_proof(b.id) WHERE id=b.id RETURNING * INTO b;
  END IF;
 END IF;
 result:=jsonb_build_object('id',b.id,'state',b.state,'version',b.version,'sourceHash',b."sourceHash");INSERT INTO public."FinanceLedgerReceipt"(id,"actorId",operation,key,"requestHash",result) VALUES(gen_random_uuid(),actor,'OPENING_'||action,request_key,digest,result);
 INSERT INTO public."FinanceAuditEvent"(id,"actorId",action,"entityType","entityId",reason,data,"requestId") VALUES(gen_random_uuid(),actor,'FINANCE_OPENING_'||action,'FinanceOpeningBatch',b.id,why,result,request_id);RETURN result;
 EXCEPTION WHEN data_exception OR check_violation OR not_null_violation OR foreign_key_violation OR unique_violation THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END $$;

DO $$ DECLARE definition TEXT;BEGIN SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public."FinanceAccount"'::regclass AND conname='FinanceAccount_controlType_check';ALTER TABLE public."FinanceAccount" DROP CONSTRAINT "FinanceAccount_controlType_check";EXECUTE 'ALTER TABLE public."FinanceAccount" ADD CONSTRAINT "FinanceAccount_controlType_check" CHECK ('||substring(definition FROM 8 FOR length(definition)-8)||' OR ("controlType"=''OPENING_CLEARING'' AND type=''EQUITY'' AND "isPosting" AND NOT "isContra" AND NOT "isCashEquivalent"))';END $$;
DO $$ DECLARE definition TEXT;BEGIN SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public."FinanceAccount"'::regclass AND conname='FinanceAccount_control_type';ALTER TABLE public."FinanceAccount" DROP CONSTRAINT "FinanceAccount_control_type";EXECUTE 'ALTER TABLE public."FinanceAccount" ADD CONSTRAINT "FinanceAccount_control_type" CHECK ('||substring(definition FROM 8 FOR length(definition)-8)||' OR ("controlType"=''OPENING_CLEARING'' AND type=''EQUITY'' AND "isPosting" AND NOT "isContra" AND NOT "isCashEquivalent"))';END $$;
ALTER FUNCTION encova_finance_report_metadata(date,date,jsonb) RENAME TO encova_finance_report_metadata_before_opening;
CREATE FUNCTION encova_finance_report_metadata(date_from DATE,cutoff DATE,filters JSONB) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT public.encova_finance_report_metadata_before_opening(date_from,cutoff,filters)||coalesce((SELECT jsonb_build_object('openingCutoverDate',"cutoverDate",'openingSourceHash',"sourceHash",'beforeCutoverRequested',date_from<"cutoverDate") FROM public."FinanceOpeningBatch" WHERE state='POSTED'),'{}'::jsonb) $$;
CREATE FUNCTION encova_finance_opening_history_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE data JSONB;cutoff DATE;day DATE;BEGIN
 SELECT "cutoverDate" INTO cutoff FROM public."FinanceOpeningBatch" WHERE state='POSTED';IF cutoff IS NULL THEN RETURN NEW;END IF;
 data:=to_jsonb(NEW);day:=coalesce((data->>'invoiceDate')::date,(data->>'billDate')::date,(data->>'documentDate')::date);
 IF day<cutoff AND NOT EXISTS(SELECT 1 FROM public."FinanceOpeningLine" WHERE id=NEW.id AND kind<>'TB') THEN RAISE EXCEPTION 'FINANCE_OPENING_HISTORY' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
DO $$ DECLARE t TEXT;BEGIN FOREACH t IN ARRAY ARRAY['FinanceInvoice','FinanceBill','FinanceMovement','FinanceCustomerDocument','FinanceSupplierDocument'] LOOP EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.encova_finance_opening_history_guard()',t||'_opening_history',t);END LOOP;END $$;
CREATE OR REPLACE FUNCTION public.encova_finance_customer_validate(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE d public."FinanceCustomerDocument"%ROWTYPE;origin public."FinanceCustomerDocument"%ROWTYPE;inv public."FinanceInvoice"%ROWTYPE;allocation_row record;line_row record;event_row record;ar NUMERIC;
BEGIN
 SELECT * INTO d FROM public."FinanceCustomerDocument" WHERE id=target;
 IF d.id IS NULL OR d.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=d."partyId" AND kind IN('CLIENT','BOTH')) THEN RAISE EXCEPTION 'FINANCE_INVOICE_PARTY' USING ERRCODE='P0001';END IF;
 IF d."advanceAccountId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."advanceAccountId" AND active AND "isPosting" AND NOT "isContra" AND "controlType"='CLIENT_ADVANCE' AND type='LIABILITY' AND currency='PKR') THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_MAPPING' USING ERRCODE='P0001';END IF;
 IF d.kind IN('RECEIPT','CUSTOMER_REFUND') THEN
  IF NOT EXISTS(SELECT 1 FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" gl ON gl.id=c."glAccountId" WHERE c.id=d."cashAccountId" AND c.active AND gl.active AND gl."isPosting" AND NOT gl."isContra" AND gl."controlType"='CASH' AND gl.type='ASSET' AND gl.currency='PKR' AND c.currency='PKR') THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_MAPPING' USING ERRCODE='P0001';END IF;
 END IF;
 IF d.kind='RECEIPT' THEN
  IF d."feeAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."feeAccountId" AND active AND "isPosting" AND NOT "isContra" AND "controlType"='NONE' AND type IN('DIRECT_COST','OPERATING_EXPENSE','OTHER_EXPENSE') AND currency='PKR') THEN RAISE EXCEPTION 'FINANCE_CUSTOMER_MAPPING' USING ERRCODE='P0001';END IF;
  IF d."advanceAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=d."partyId" AND active) THEN RAISE EXCEPTION 'FINANCE_INVOICE_PARTY' USING ERRCODE='P0001';END IF;
 ELSIF d.kind IN('ADVANCE_APPLICATION','CUSTOMER_REFUND') THEN
  SELECT * INTO origin FROM public."FinanceCustomerDocument" WHERE id=d."sourceDocumentId";
  IF origin.id IS NULL OR origin.kind NOT IN('RECEIPT','CUSTOMER_CREDIT','UNALLOCATION','OPENING_ADVANCE') OR origin.state<>'POSTED' OR EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" WHERE "reversalOfId"=origin.id) OR origin."partyId"<>d."partyId" OR origin."advanceAccountId" IS DISTINCT FROM d."advanceAccountId" OR origin."postingDate">d."documentDate" OR d."totalAmount">public.encova_finance_client_capacity(origin.id,d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ADVANCE_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='CUSTOMER_CREDIT' THEN
  INSERT INTO public."FinanceCreditTaxSplit"(id,"customerCreditLineId","netAmount","taxAmount","taxAccountId") SELECT gen_random_uuid(),c.id,q.net,q.tax,q.account FROM public."FinanceCustomerCreditLine" c CROSS JOIN LATERAL public.encova_finance_customer_credit_tax_quote(c.id) q WHERE c."documentId"=target;
  SELECT * INTO inv FROM public."FinanceInvoice" WHERE id=d."creditInvoiceId";
  IF inv.id IS NULL OR inv.state<>'POSTED' OR inv."partyId"<>d."partyId" OR inv.currency<>d.currency OR inv."postingDate">d."documentDate" THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  FOR line_row IN SELECT c.amount,l.* FROM public."FinanceCustomerCreditLine" c JOIN public."FinanceInvoiceLine" l ON l.id=c."invoiceLineId" WHERE c."documentId"=target LOOP
   IF line_row."invoiceId"<>inv.id OR line_row.amount>public.encova_finance_credit_capacity(line_row.id,d."postingDate") OR (line_row.recognition='DEFERRED' AND (SELECT s."netAmount" FROM public."FinanceCreditTaxSplit" s JOIN public."FinanceCustomerCreditLine" c ON c.id=s."customerCreditLineId" WHERE c."documentId"=target AND c."invoiceLineId"=line_row.id)>public.encova_finance_deferred_capacity(line_row.id,d."postingDate")) THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  END LOOP;
  SELECT least(d."totalAmount",coalesce(sum(amount),0)) INTO ar FROM public."FinanceReceivableEvent" WHERE "invoiceId"=inv.id AND "effectiveDate"<=d."postingDate";
  IF ar<0 OR ar>public.encova_finance_ar_capacity(inv.id,d."postingDate") THEN RAISE EXCEPTION 'FINANCE_SETTLEMENT_ORDER' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinanceCustomerCreditSplit"("documentId","arAmount","balanceAmount") VALUES(d.id,ar,d."totalAmount"-ar);
 ELSIF d.kind='UNALLOCATION' THEN
  SELECT * INTO origin FROM public."FinanceCustomerDocument" WHERE id=d."unallocationOfId";
  IF origin.id IS NULL OR origin.kind<>'RECEIPT' OR origin.state<>'POSTED' OR origin."partyId"<>d."partyId" OR origin."postingDate">d."postingDate" OR origin."allocationAmount"<=0 OR EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" WHERE "reversalOfId"=origin.id) THEN RAISE EXCEPTION 'FINANCE_SETTLEMENT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='REVERSAL' THEN
  SELECT * INTO origin FROM public."FinanceCustomerDocument" WHERE id=d."reversalOfId";
  IF origin.id IS NULL OR origin.kind='REVERSAL' OR origin.state<>'POSTED' OR origin."postingDate">d."postingDate" OR EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" WHERE "reversalOfId"=origin.id AND id<>target) OR EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" u WHERE u."unallocationOfId"=origin.id AND NOT EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" undo WHERE undo."reversalOfId"=u.id)) THEN RAISE EXCEPTION 'FINANCE_SETTLEMENT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  FOR event_row IN SELECT b.* FROM public."FinanceClientBalanceEvent" b WHERE b."documentId"=origin.id AND b.amount>0 LOOP
   IF event_row.amount>public.encova_finance_client_capacity(event_row."sourceDocumentId",d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ADVANCE_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  END LOOP;
  FOR event_row IN SELECT v.* FROM public."FinanceReceivableEvent" v WHERE v."customerDocumentId"=origin.id AND v.amount>0 LOOP
   IF event_row.amount>public.encova_finance_ar_capacity(event_row."invoiceId",d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  END LOOP;
 END IF;
 IF d.kind IN('RECEIPT','ADVANCE_APPLICATION') THEN
  FOR allocation_row IN SELECT x.*,i.state,i."partyId",i.currency,i."postingDate" FROM public."FinanceCustomerAllocation" x JOIN public."FinanceInvoice" i ON i.id=x."invoiceId" WHERE x."documentId"=target ORDER BY x."invoiceId" LOOP
   IF allocation_row.state<>'POSTED' OR allocation_row."partyId"<>d."partyId" OR allocation_row.currency<>d.currency OR allocation_row."postingDate">d."postingDate" OR allocation_row.amount>public.encova_finance_ar_capacity(allocation_row."invoiceId",d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  END LOOP;
 END IF;
 IF d."projectId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Project" WHERE id=d."projectId" AND "archivedAt" IS NULL) AND NOT EXISTS(SELECT 1 FROM public."FinanceCustomerAllocation" x JOIN public."FinanceInvoice" i ON i.id=x."invoiceId" WHERE x."documentId"=target AND i."projectId"=d."projectId") AND NOT EXISTS(SELECT 1 FROM public."FinanceCustomerDocument" WHERE id=coalesce(d."sourceDocumentId",d."reversalOfId") AND "projectId"=d."projectId") AND NOT EXISTS(SELECT 1 FROM public."FinanceInvoice" WHERE id=d."creditInvoiceId" AND "projectId"=d."projectId") THEN RAISE EXCEPTION 'FINANCE_PROJECT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
END $function$
;
CREATE OR REPLACE FUNCTION public.encova_finance_supplier_validate(target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE d public."FinanceSupplierDocument"%ROWTYPE;origin public."FinanceSupplierDocument"%ROWTYPE;inv public."FinanceBill"%ROWTYPE;allocation_row record;line_row record;event_row record;ar NUMERIC;
BEGIN
 SELECT * INTO d FROM public."FinanceSupplierDocument" WHERE id=target;
 IF d.id IS NULL OR d.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_IMMUTABLE' USING ERRCODE='P0001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=d."partyId" AND kind IN('SUPPLIER','BOTH','EMPLOYEE')) THEN RAISE EXCEPTION 'FINANCE_BILL_PARTY' USING ERRCODE='P0001';END IF;
 IF d."advanceAccountId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."advanceAccountId" AND active AND "isPosting" AND NOT "isContra" AND "controlType"='SUPPLIER_ADVANCE' AND type='ASSET' AND currency='PKR') THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_MAPPING' USING ERRCODE='P0001';END IF;
 IF d.kind IN('PAYMENT','SUPPLIER_REFUND') THEN
  IF NOT EXISTS(SELECT 1 FROM public."FinanceCashAccount" c JOIN public."FinanceAccount" gl ON gl.id=c."glAccountId" WHERE c.id=d."cashAccountId" AND c.active AND gl.active AND gl."isPosting" AND NOT gl."isContra" AND gl."controlType"='CASH' AND gl.type='ASSET' AND gl.currency='PKR' AND c.currency='PKR') THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_MAPPING' USING ERRCODE='P0001';END IF;
 END IF;
 IF d.kind='PAYMENT' THEN
  IF d."feeAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceAccount" WHERE id=d."feeAccountId" AND active AND "isPosting" AND NOT "isContra" AND "controlType"='NONE' AND type IN('DIRECT_COST','OPERATING_EXPENSE','OTHER_EXPENSE') AND currency='PKR') THEN RAISE EXCEPTION 'FINANCE_SUPPLIER_MAPPING' USING ERRCODE='P0001';END IF;
  IF d."advanceAmount">0 AND NOT EXISTS(SELECT 1 FROM public."FinanceParty" WHERE id=d."partyId" AND active) THEN RAISE EXCEPTION 'FINANCE_BILL_PARTY' USING ERRCODE='P0001';END IF;
 ELSIF d.kind IN('ADVANCE_APPLICATION','SUPPLIER_REFUND') THEN
  SELECT * INTO origin FROM public."FinanceSupplierDocument" WHERE id=d."sourceDocumentId";
  IF origin.id IS NULL OR origin.kind NOT IN('PAYMENT','SUPPLIER_CREDIT','UNALLOCATION','OPENING_ADVANCE') OR origin.state<>'POSTED' OR EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE "reversalOfId"=origin.id) OR origin."partyId"<>d."partyId" OR origin."advanceAccountId" IS DISTINCT FROM d."advanceAccountId" OR origin."postingDate">d."documentDate" OR d."totalAmount">public.encova_finance_supplier_capacity(origin.id,d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ADVANCE_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='SUPPLIER_CREDIT' THEN
  INSERT INTO public."FinanceCreditTaxSplit"(id,"supplierCreditLineId","netAmount","taxAmount","taxAccountId") SELECT gen_random_uuid(),c.id,q.net,q.tax,q.account FROM public."FinanceSupplierCreditLine" c CROSS JOIN LATERAL public.encova_finance_supplier_credit_tax_quote(c.id) q WHERE c."documentId"=target;
  SELECT * INTO inv FROM public."FinanceBill" WHERE id=d."creditBillId";
  IF inv.id IS NULL OR inv.state<>'POSTED' OR inv."partyId"<>d."partyId" OR inv.currency<>d.currency OR inv."postingDate">d."documentDate" THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  FOR line_row IN SELECT c.amount,l.* FROM public."FinanceSupplierCreditLine" c JOIN public."FinanceBillLine" l ON l.id=c."billLineId" WHERE c."documentId"=target LOOP
   IF line_row."billId"<>inv.id OR line_row.amount>public.encova_finance_supplier_credit_capacity(line_row.id,d."postingDate") THEN RAISE EXCEPTION 'FINANCE_CREDIT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  END LOOP;
  SELECT least(d."totalAmount",coalesce(sum(amount),0)) INTO ar FROM public."FinancePayableEvent" WHERE "billId"=inv.id AND "effectiveDate"<=d."postingDate";
  IF ar<0 OR ar>public.encova_finance_ap_capacity(inv.id,d."postingDate") THEN RAISE EXCEPTION 'FINANCE_SETTLEMENT_ORDER' USING ERRCODE='P0001';END IF;
  INSERT INTO public."FinanceSupplierCreditSplit"("documentId","arAmount","balanceAmount") VALUES(d.id,ar,d."totalAmount"-ar);
 ELSIF d.kind='UNALLOCATION' THEN
  SELECT * INTO origin FROM public."FinanceSupplierDocument" WHERE id=d."unallocationOfId";
  IF origin.id IS NULL OR origin.kind<>'PAYMENT' OR origin.state<>'POSTED' OR origin."partyId"<>d."partyId" OR origin."postingDate">d."postingDate" OR origin."allocationAmount"<=0 OR EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE "reversalOfId"=origin.id) THEN RAISE EXCEPTION 'FINANCE_SETTLEMENT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
 ELSIF d.kind='REVERSAL' THEN
  SELECT * INTO origin FROM public."FinanceSupplierDocument" WHERE id=d."reversalOfId";
  IF origin.id IS NULL OR origin.kind='REVERSAL' OR origin.state<>'POSTED' OR origin."postingDate">d."postingDate" OR EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE "reversalOfId"=origin.id AND id<>target) OR EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" u WHERE u."unallocationOfId"=origin.id AND NOT EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" undo WHERE undo."reversalOfId"=u.id)) THEN RAISE EXCEPTION 'FINANCE_SETTLEMENT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  FOR event_row IN SELECT b.* FROM public."FinanceSupplierBalanceEvent" b WHERE b."documentId"=origin.id AND b.amount>0 LOOP
   IF event_row.amount>public.encova_finance_supplier_capacity(event_row."sourceDocumentId",d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ADVANCE_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  END LOOP;
  FOR event_row IN SELECT v.* FROM public."FinancePayableEvent" v WHERE v."supplierDocumentId"=origin.id AND v.amount>0 LOOP
   IF event_row.amount>public.encova_finance_ap_capacity(event_row."billId",d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  END LOOP;
 END IF;
 IF d.kind IN('PAYMENT','ADVANCE_APPLICATION') THEN
  FOR allocation_row IN SELECT x.*,i.state,i."partyId",i.currency,i."postingDate" FROM public."FinanceSupplierAllocation" x JOIN public."FinanceBill" i ON i.id=x."billId" WHERE x."documentId"=target ORDER BY x."billId" LOOP
   IF allocation_row.state<>'POSTED' OR allocation_row."partyId"<>d."partyId" OR allocation_row.currency<>d.currency OR allocation_row."postingDate">d."postingDate" OR allocation_row.amount>public.encova_finance_ap_capacity(allocation_row."billId",d."postingDate") THEN RAISE EXCEPTION 'FINANCE_ALLOCATION_UNAVAILABLE' USING ERRCODE='P0001';END IF;
  END LOOP;
 END IF;
 IF d."projectId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Project" WHERE id=d."projectId" AND "archivedAt" IS NULL) AND NOT EXISTS(SELECT 1 FROM public."FinanceSupplierAllocation" x JOIN public."FinanceBill" i ON i.id=x."billId" WHERE x."documentId"=target AND i."projectId"=d."projectId") AND NOT EXISTS(SELECT 1 FROM public."FinanceSupplierDocument" WHERE id=coalesce(d."sourceDocumentId",d."reversalOfId") AND "projectId"=d."projectId") AND NOT EXISTS(SELECT 1 FROM public."FinanceBill" WHERE id=d."creditBillId" AND "projectId"=d."projectId") THEN RAISE EXCEPTION 'FINANCE_PROJECT_UNAVAILABLE' USING ERRCODE='P0001';END IF;
END $function$
;
CREATE FUNCTION encova_finance_opening_read(actor UUID,action TEXT,input JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE b public."FinanceOpeningBatch"%ROWTYPE;page INTEGER;total INTEGER;items JSONB;owner BOOLEAN;mode TEXT;BEGIN
 IF NOT public.encova_finance_export_access(actor) THEN RAISE EXCEPTION 'FINANCE_FORBIDDEN' USING ERRCODE='P0001';END IF;
 IF action IS NULL OR action NOT IN('LIST','DETAIL','PREVIEW','LINES','SOURCE') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['id','page','kind']<>'{}'::jsonb THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
 page:=coalesce((input->>'page')::integer,1);IF page NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;owner:=EXISTS(SELECT 1 FROM public."FinanceSettings" WHERE "ownerId"=actor);
 IF action='LIST' THEN
  SELECT count(*) INTO total FROM public."FinanceOpeningBatch";
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."createdAt" DESC,x.id),'[]') INTO items FROM(SELECT id,name,"cutoverDate",state,version,"sourceHash","fileName","createdAt","postedAt" FROM public."FinanceOpeningBatch" ORDER BY "createdAt" DESC,id LIMIT 25 OFFSET(page-1)*25)x;
 ELSE
  SELECT * INTO b FROM public."FinanceOpeningBatch" WHERE id=(input->>'id')::uuid;IF b.id IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_FOUND' USING ERRCODE='P0001';END IF;
  IF action='SOURCE' THEN RETURN jsonb_build_object('fileName',b."fileName",'sourceText',b."sourceText",'sourceHash',b."sourceHash");END IF;
  IF action='DETAIL' THEN RETURN(to_jsonb(b)-'sourceText')||jsonb_build_object('canManage',owner,'lineCount',(SELECT count(*) FROM public."FinanceOpeningLine" WHERE "batchId"=b.id),'journalCount',(SELECT count(*) FROM public."FinanceOpeningPosting" WHERE "batchId"=b.id));END IF;
  IF action='PREVIEW' THEN RETURN public.encova_finance_opening_pack(b.id)||jsonb_build_object('id',b.id,'version',b.version,'state',b.state,'canManage',owner);END IF;
  mode:=coalesce(input->>'kind','ALL');IF mode NOT IN('ALL','TB','ITEMS') THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END IF;
  SELECT count(*) INTO total FROM public."FinanceOpeningLine" WHERE "batchId"=b.id AND(mode='ALL' OR mode='TB' AND kind='TB' OR mode='ITEMS' AND kind<>'TB');
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.sequence),'[]') INTO items FROM(SELECT l.id,l.sequence,l.kind,CASE WHEN l.kind='CASH' THEN l."cashSide" END AS side,l.reference,l."originalDate",l."dueDate",l."accountId",a.code,a.name AS "accountName",l.debit::text AS debit,l.credit::text AS credit,l.amount::text AS amount,l.accumulated::text AS "accumulatedDepreciation",l."costBasis"::text AS "costBasis",l.units::text AS units,l.description,p."journalId" FROM public."FinanceOpeningLine" l JOIN public."FinanceAccount" a ON a.id=l."accountId" LEFT JOIN public."FinanceOpeningPosting" p ON p."lineId"=l.id WHERE l."batchId"=b.id AND(mode='ALL' OR mode='TB' AND l.kind='TB' OR mode='ITEMS' AND l.kind<>'TB') ORDER BY l.sequence LIMIT 25 OFFSET(page-1)*25)x;
 END IF;RETURN jsonb_build_object('items',items,'total',total,'page',page,'pages',greatest(1,ceil(total/25.0)::integer),'canManage',owner);
 EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'FINANCE_INVALID_INPUT' USING ERRCODE='P0001';END $$;
CREATE OR REPLACE FUNCTION encova_finance_opening_staging_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE b public."FinanceOpeningBatch"%ROWTYPE;l public."FinanceOpeningLine"%ROWTYPE;source JSONB;raw JSONB;n INTEGER;BEGIN
 SELECT * INTO b FROM public."FinanceOpeningBatch" WHERE id=NEW."batchId";IF b.id IS NULL OR b.state<>'DRAFT' THEN RAISE EXCEPTION 'FINANCE_OPENING_RETAINED' USING ERRCODE='P0001';END IF;
 IF TG_TABLE_NAME='FinanceOpeningLine' THEN
  l:=NEW;source:=b."sourceText"::jsonb;n:=jsonb_array_length(source->'trialBalance');
  IF l.kind='TB' THEN raw:=source->'trialBalance'->(l.sequence-1);IF raw IS NULL OR ROW(l."accountId",l.debit,l.credit,l.reference,l.description,l.amount) IS DISTINCT FROM ROW((raw->>'accountId')::uuid,(raw->>'debit')::numeric,(raw->>'credit')::numeric,'TB-'||l.sequence::text,'Reviewed imported trial balance',0::numeric) THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  ELSE raw:=source->'items'->(l.sequence-n-1);
   IF raw IS NULL OR ROW(l.kind,l."cashSide",l."accountId",l.amount,l.reference,l."originalDate",l."dueDate",l.description,l."partyId",l."cashAccountId",l."loanId",l."holdingId",l."secondaryAccountId",l."resultAccountId",l."receivableAccountId",l."costBasis",l.accumulated,l.units,l.tag,l.location,l."inServiceDate",l.residual,l."remainingMonths",l."firstDepMonth",l."policyEvidence") IS DISTINCT FROM ROW(raw->>'kind',coalesce(raw->>'side','DEBIT'),(raw->>'accountId')::uuid,(raw->>'amount')::numeric,trim(raw->>'reference'),(raw->>'originalDate')::date,(raw->>'dueDate')::date,trim(raw->>'description'),(raw->>'partyId')::uuid,(raw->>'cashAccountId')::uuid,(raw->>'loanId')::uuid,(raw->>'holdingId')::uuid,(raw->>'secondaryAccountId')::uuid,(raw->>'resultAccountId')::uuid,(raw->>'receivableAccountId')::uuid,coalesce(raw->>'costBasis',raw->>'amount')::numeric,coalesce(raw->>'accumulatedDepreciation','0')::numeric,(raw->>'units')::numeric,raw->>'tag',raw->>'location',(raw->>'inServiceDate')::date,coalesce(raw->>'residualValue','0')::numeric,(raw->>'remainingLifeMonths')::integer,raw->>'firstDepMonth',raw->>'policyEvidence') THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;
  END IF;
 ELSE IF NEW.id IS DISTINCT FROM coalesce(NEW."lineId",b.id) OR NEW."lineId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."FinanceOpeningLine" WHERE id=NEW."lineId" AND "batchId"=b.id AND kind<>'TB') THEN RAISE EXCEPTION 'FINANCE_SOURCE_MISMATCH' USING ERRCODE='P0001';END IF;END IF;RETURN NEW;
END $$;
ALTER FUNCTION encova_finance_export_readiness(DATE,DATE) RENAME TO encova_finance_export_readiness_before_opening;
CREATE FUNCTION encova_finance_export_readiness(date_from DATE,cutoff DATE) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE base JSONB;cutover DATE;covered BOOLEAN;BEGIN
 base:=public.encova_finance_export_readiness_before_opening(date_from,cutoff);SELECT "cutoverDate" INTO cutover FROM public."FinanceOpeningBatch" WHERE state='POSTED';covered:=cutover IS NULL OR cutoff>=cutover AND(date_from>=cutover OR date_from=DATE '0001-01-01');RETURN base||jsonb_build_object('openingCutoverDate',cutover,'openingCoverageReady',covered,'finalEligible',(base->>'finalEligible')::boolean AND covered);
END $$;
DO $$ DECLARE t TEXT;f RECORD;r TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['FinanceOpeningBatch','FinanceOpeningLine','FinanceOpeningPosting'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);FOREACH r IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);IF r='encova_app' THEN EXECUTE format('GRANT SELECT ON public.%I TO encova_app',t);EXECUTE format('CREATE POLICY encova_server_read ON public.%I FOR SELECT TO encova_app USING(true)',t);END IF;END IF;END LOOP;END LOOP;
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND(p.proname LIKE 'encova_finance_opening_%' OR p.proname IN('encova_finance_report_metadata','encova_finance_report_metadata_before_opening','encova_finance_export_readiness','encova_finance_export_readiness_before_opening')) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);FOREACH r IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.signature,r);END IF;END LOOP;END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION public.encova_finance_opening_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID),public.encova_finance_opening_read(UUID,TEXT,JSONB) TO encova_app;END IF;
END $$;
COMMIT;
