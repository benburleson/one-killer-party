-- REVIEW ONLY: manual artifact source; not a migration or authorization to publish.
-- Execute as a trusted database owner only after separate approval and a backup.
-- This does not configure Auth, assign an identity, verify owner approval, or
-- revoke a provider session. Auth must supply verified JWT claims; database
-- owners, service_role (BYPASSRLS), and JWT signing authorities remain trusted.
-- Do not enable this hook over an existing Auth hook without a reviewed composition.
-- Re-running is a no-op, not a drift repair: inspect installed objects before use.
-- Supabase database administrators and their delegates are trusted infrastructure.
-- The guard checks application-role boundaries, publisher grants and collisions;
-- it does not certify the internal managed-administrator role graph.
-- Re-adding the same user can reactivate an unexpired token; revoke provider
-- sessions as well and wait for token expiry before re-enabling that identity.
-- Rollback must first stop role issuance, revoke sessions and wait for all
-- publisher tokens to expire before restoring the unguarded registration RPC.

DO $install$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'installer must bypass RLS for security-definer identity checks';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'mystery_operator'
      AND NOT (rolsuper OR rolbypassrls OR rolcanlogin OR rolinherit
               OR rolcreaterole OR rolcreatedb OR rolreplication)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE member = 'mystery_operator'::regrole
  ) THEN
    RAISE EXCEPTION 'operator role has unsafe attributes or memberships';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'::name), ('authenticated'::name), ('service_role'::name))
      AS application_roles(rolname)
    WHERE pg_catalog.pg_has_role(
      application_roles.rolname, 'mystery_operator'::name, 'MEMBER'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'application roles must not inherit publisher access';
  END IF;

  IF pg_catalog.to_regclass('private_mystery.production_publisher_install') IS NOT NULL THEN
    IF pg_catalog.to_regclass('private_mystery.production_publisher_identity') IS NULL
       OR pg_catalog.to_regprocedure('private_mystery.production_publisher_hook(jsonb)') IS NULL
       OR pg_catalog.to_regprocedure('private_mystery.production_publisher_authorized()') IS NULL
       OR pg_catalog.to_regprocedure('private_mystery.publish_mystery_version(text,text,integer,text,text,text,text,text,text)') IS NULL
       OR pg_catalog.to_regprocedure('public.publish_mystery_version(text,text,integer,text,text,text,text,text,text)') IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policies
         WHERE schemaname = 'storage' AND tablename = 'objects'
           AND policyname = 'production_publisher_restrict_objects' AND permissive = 'RESTRICTIVE'
       ) THEN
      RAISE EXCEPTION 'incomplete publisher installation; manual inspection required';
    END IF;
    RAISE NOTICE 'publisher artifact already installed; inspect for drift separately';
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) AS acl
    WHERE p.oid = pg_catalog.to_regprocedure(
      'public.publish_mystery_version(text,text,integer,text,text,text,text,text,text)')
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee <> p.proowner
      AND acl.grantee <> 'mystery_operator'::regrole
  ) THEN
    RAISE EXCEPTION 'unexpected existing registration grants; manual review required';
  END IF;
  IF pg_catalog.to_regclass('private_mystery.production_publisher_identity') IS NOT NULL
     OR pg_catalog.to_regprocedure('private_mystery.production_publisher_hook(jsonb)') IS NOT NULL
     OR pg_catalog.to_regprocedure('private_mystery.production_publisher_authorized()') IS NOT NULL
     OR pg_catalog.to_regprocedure('private_mystery.publish_mystery_version(text,text,integer,text,text,text,text,text,text)') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND policyname = 'production_publisher_restrict_objects'
     ) THEN
    RAISE EXCEPTION 'publisher artifact name collision; no existing object was replaced';
  END IF;

  CREATE TABLE private_mystery.production_publisher_identity (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE
  );
  ALTER TABLE private_mystery.production_publisher_identity ENABLE ROW LEVEL SECURITY;
  ALTER TABLE private_mystery.production_publisher_identity FORCE ROW LEVEL SECURITY;
  REVOKE ALL ON private_mystery.production_publisher_identity
    FROM PUBLIC, anon, authenticated, service_role, mystery_operator, supabase_auth_admin;

  EXECUTE $sql$
    CREATE FUNCTION private_mystery.production_publisher_hook(event jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $body$
    BEGIN
      IF pg_catalog.jsonb_typeof(event->'claims') = 'object'
         AND event->'claims'->>'role' = 'authenticated'
         AND EXISTS (
           SELECT 1 FROM private_mystery.production_publisher_identity
           WHERE user_id::text = event->>'user_id'
         ) THEN
        RETURN pg_catalog.jsonb_set(event, '{claims,role}', '"mystery_operator"'::jsonb);
      END IF;
      RETURN event;
    END
    $body$
  $sql$;
  REVOKE ALL ON FUNCTION private_mystery.production_publisher_hook(jsonb)
    FROM PUBLIC, anon, authenticated, service_role, mystery_operator, supabase_auth_admin;
  GRANT USAGE ON SCHEMA private_mystery TO supabase_auth_admin;
  GRANT EXECUTE ON FUNCTION private_mystery.production_publisher_hook(jsonb) TO supabase_auth_admin;

  EXECUTE $sql$
    CREATE FUNCTION private_mystery.production_publisher_authorized()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $body$
      SELECT COALESCE(
        auth.jwt()->>'role' = 'mystery_operator'
        AND auth.jwt()->>'aal' = 'aal2'
        AND EXISTS (
          SELECT 1 FROM private_mystery.production_publisher_identity
          WHERE user_id::text = auth.jwt()->>'sub'
        ), false)
    $body$
  $sql$;
  REVOKE ALL ON FUNCTION private_mystery.production_publisher_authorized()
    FROM PUBLIC, anon, authenticated, service_role, mystery_operator, supabase_auth_admin;
  GRANT EXECUTE ON FUNCTION private_mystery.production_publisher_authorized() TO mystery_operator;

  -- Restrictive policy composes with, rather than replaces, existing policies.
  CREATE POLICY production_publisher_restrict_objects
    ON storage.objects AS RESTRICTIVE FOR ALL TO mystery_operator
    USING (bucket_id = 'private-mystery-packages' AND private_mystery.production_publisher_authorized())
    WITH CHECK (bucket_id = 'private-mystery-packages' AND private_mystery.production_publisher_authorized());

  -- Preserve the existing registration implementation and immutable triggers.
  -- The original becomes a private owner-only implementation behind the guard.
  ALTER FUNCTION public.publish_mystery_version(text,text,integer,text,text,text,text,text,text)
    SET SCHEMA private_mystery;
  REVOKE ALL ON FUNCTION private_mystery.publish_mystery_version(text,text,integer,text,text,text,text,text,text)
    FROM PUBLIC, anon, authenticated, service_role, mystery_operator;
  GRANT EXECUTE ON FUNCTION private_mystery.publish_mystery_version(text,text,integer,text,text,text,text,text,text)
    TO CURRENT_USER;

  EXECUTE $sql$
    CREATE FUNCTION public.publish_mystery_version(
      p_mystery_id text, p_version text, p_schema_version integer,
      p_digest_sha256 text, p_object_path text, p_rule_set_id text,
      p_provenance text, p_approved_by text, p_approval_reference text
    )
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $body$
    BEGIN
      IF NOT private_mystery.production_publisher_authorized() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'mystery publication unavailable';
      END IF;
      RETURN private_mystery.publish_mystery_version(
        p_mystery_id, p_version, p_schema_version, p_digest_sha256,
        p_object_path, p_rule_set_id, p_provenance, p_approved_by, p_approval_reference
      );
    END
    $body$
  $sql$;
  REVOKE ALL ON FUNCTION public.publish_mystery_version(text,text,integer,text,text,text,text,text,text)
    FROM PUBLIC, anon, authenticated, service_role, mystery_operator;
  GRANT EXECUTE ON FUNCTION public.publish_mystery_version(text,text,integer,text,text,text,text,text,text)
    TO mystery_operator;

  CREATE TABLE private_mystery.production_publisher_install (installed boolean PRIMARY KEY DEFAULT true CHECK (installed));
  ALTER TABLE private_mystery.production_publisher_install ENABLE ROW LEVEL SECURITY;
  ALTER TABLE private_mystery.production_publisher_install FORCE ROW LEVEL SECURITY;
  REVOKE ALL ON private_mystery.production_publisher_install
    FROM PUBLIC, anon, authenticated, service_role, mystery_operator, supabase_auth_admin;
  INSERT INTO private_mystery.production_publisher_install DEFAULT VALUES;
END
$install$;
