-- Alihkan kepemilikan objek skema public ke peran aplikasi dpmd (REASSIGN OWNED BY postgres ditolak PG).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT format('ALTER TABLE public.%I OWNER TO dpmd', c.relname) q FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind IN ('r','p') LOOP EXECUTE r.q; END LOOP;
  FOR r IN SELECT format('ALTER SEQUENCE public.%I OWNER TO dpmd', c.relname) q FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='S' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.deptype IN ('a','i')) LOOP EXECUTE r.q; END LOOP;
  FOR r IN SELECT format('ALTER VIEW public.%I OWNER TO dpmd', c.relname) q FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind IN ('v','m') LOOP EXECUTE r.q; END LOOP;
  FOR r IN SELECT format('ALTER TYPE public.%I OWNER TO dpmd', t.typname) q FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
           WHERE n.nspname='public' AND t.typtype IN ('e','d') LOOP EXECUTE r.q; END LOOP;
  FOR r IN SELECT format('ALTER ROUTINE public.%I(%s) OWNER TO dpmd', p.proname, pg_get_function_identity_arguments(p.oid)) q FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e') LOOP EXECUTE r.q; END LOOP;
END $$;
SELECT 'milik_postgres_sisa=' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles o ON o.oid=c.relowner
 WHERE n.nspname='public' AND o.rolname='postgres' AND c.relkind IN ('r','p','S','v','m');
