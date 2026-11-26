-- MANUAL INSTALLER: executing this psql entry point mutates the database.
-- It is not a read-only preflight or a migration; review without executing it.
-- Run only after a separate installation approval and backup, against the
-- independently verified target. The SQL source is shared with disposable tests.
\set ON_ERROR_STOP on
DO $preflight$
DECLARE
  registration regprocedure := pg_catalog.to_regprocedure(
    'public.publish_mystery_version(text,text,integer,text,text,text,text,text,text)');
  owner_name name;
BEGIN
  IF registration IS NULL
     OR pg_catalog.to_regclass('private_mystery.published_versions') IS NULL
     OR pg_catalog.to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'publisher preflight: baseline registration or dependency is missing';
  END IF;
  SELECT pg_catalog.pg_get_userbyid(proowner) INTO owner_name
  FROM pg_catalog.pg_proc WHERE oid = registration;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = owner_name AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'publisher preflight: registration owner is not trusted';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'mystery_operator', registration, 'EXECUTE'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) AS acl
    WHERE p.oid = registration
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee NOT IN (p.proowner, 'mystery_operator'::regrole)
  ) THEN
    RAISE EXCEPTION 'publisher preflight: registration grants are not exact';
  END IF;
  IF pg_catalog.to_regclass('private_mystery.production_publisher_install') IS NOT NULL
     OR pg_catalog.to_regprocedure('private_mystery.production_publisher_hook(jsonb)') IS NOT NULL
     OR pg_catalog.to_regprocedure('private_mystery.production_publisher_authorized()') IS NOT NULL
     OR pg_catalog.to_regprocedure(
          'private_mystery.publish_mystery_version(text,text,integer,text,text,text,text,text,text)')
        IS NOT NULL THEN
    RAISE EXCEPTION 'publisher preflight: installed objects require drift review';
  END IF;
END
$preflight$;
\ir ../supabase/tests/production-publisher-hook-review.inc
