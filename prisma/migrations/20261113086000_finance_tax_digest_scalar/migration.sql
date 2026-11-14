BEGIN;
CREATE OR REPLACE FUNCTION encova_finance_optional_tax_digest(input JSONB) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE canonical JSONB:=input;BEGIN
 IF coalesce(input->>'withholdingAmount','0.00') IN('0','0.0','0.00') AND input->>'withholdingCodeId' IS NULL THEN canonical:=canonical-ARRAY['withholdingAmount','withholdingCodeId'];END IF;
 IF jsonb_typeof(input->'lines')='array' THEN canonical:=jsonb_set(canonical,'{lines}',(SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(x)='object' AND x->>'taxCodeId' IS NULL THEN x-'taxCodeId' ELSE x END ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(input->'lines') WITH ORDINALITY t(x,n)));END IF;
 RETURN encode(sha256(convert_to(canonical::text,'UTF8')),'hex');END $$;
COMMIT;
