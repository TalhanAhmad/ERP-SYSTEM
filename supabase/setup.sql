-- Apply with a controlled migration owner after Prisma migrations, before app traffic.
-- Set the encova_app login password separately through the provider's secure SQL UI.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN
  CREATE ROLE encova_app LOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA public TO encova_app;
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t.tablename);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon',t.tablename); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated',t.tablename); END IF;
  -- Legacy password/session tables are retained for local compatibility, never exposed to the new runtime role.
  IF t.tablename NOT IN ('user','session','account','verification','auth_rate_limit') THEN
   EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO encova_app',t.tablename);
   EXECUTE format('DROP POLICY IF EXISTS encova_server_access ON public.%I',t.tablename);
   EXECUTE format('CREATE POLICY encova_server_access ON public.%I TO encova_app USING (true) WITH CHECK (true)',t.tablename);
  END IF;
 END LOOP;
END $$;
-- Keep files private. No direct authenticated/anonymous Storage policies are granted.
-- Upload/download workflow integration is a separate acceptance gate.
DO $$ BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  VALUES('encova-private','encova-private',false,10485760,ARRAY['application/pdf','image/png','image/jpeg','text/plain'])
  ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=10485760,allowed_mime_types=EXCLUDED.allowed_mime_types;
 END IF;
END $$;
