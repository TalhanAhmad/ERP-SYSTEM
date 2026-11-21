BEGIN;
ALTER FUNCTION public.encova_finance_posted_source_read(UUID,JSONB) RENAME TO encova_finance_posted_source_before_workflow_links;
CREATE FUNCTION public.encova_finance_posted_source_read(actor UUID,input JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB; source_id UUID; batch_id UUID;
BEGIN
 result:=public.encova_finance_posted_source_before_workflow_links(actor,input);
 source_id:=(result->'entry'->>'sourceId')::uuid;
 IF result->'entry'->>'sourceType'='OPENING' THEN
  SELECT "batchId" INTO batch_id FROM public."FinanceOpeningPosting" WHERE id=source_id;
  IF batch_id IS NOT NULL THEN result:=jsonb_set(result,'{workflow}',jsonb_build_object('href','/finance/openings/'||batch_id::text,'kind','OPENING','original',false));END IF;
 ELSIF result->'entry'->>'sourceType'='RECOGNITION' THEN
  result:=jsonb_set(result,'{workflow}',jsonb_build_object('href','/finance/recognitions/'||source_id::text,'kind','RECOGNITION','original',result->'entry'->>'sourceAction'='REVERSE'));
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.encova_finance_posted_source_before_workflow_links(UUID,JSONB),public.encova_finance_posted_source_read(UUID,JSONB) FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN
 FOREACH role_name IN ARRAY ARRAY['encova_app','anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.encova_finance_posted_source_before_workflow_links(UUID,JSONB),public.encova_finance_posted_source_read(UUID,JSONB) FROM %I',role_name);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN GRANT EXECUTE ON FUNCTION public.encova_finance_posted_source_read(UUID,JSONB) TO encova_app;END IF;
END $$;
COMMIT;
