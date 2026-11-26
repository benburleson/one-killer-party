-- REVIEW ONLY: manual artifact source; not a migration or authorization to publish.
-- Execute as a trusted database owner only after separate approval and a backup.
-- This does not configure Auth, assign an identity, verify owner approval, or
-- revoke a provider session. Auth must supply verified JWT claims; database
-- owners, service_role (BYPASSRLS), and JWT signing authorities remain trusted.
-- Do not enable this hook over an existing Auth hook without a reviewed composition.
-- Re-running is a no-op, not a drift repair: inspect installed objects before use.
-- Only the reviewed exact Supabase membership graph may reach mystery_operator.
-- cli_login_postgres is accepted only as the exact postgres delegate below;
-- every SET-reachable role, edge, option and grantor must match the disposable
-- managed baseline. These database and service credentials remain trusted.
-- Recheck memberships continuously: later grants are not prevented here.
-- Re-adding the same user can reactivate an unexpired token; revoke provider
-- sessions as well and wait for token expiry before re-enabling that identity.
-- Rollback is privileged and must first stop role issuance and revoke/wait out
-- all operator tokens: removing the guard otherwise restores their access.
-- After disabling this hook and reviewing dependencies, in one transaction:
-- drop the public wrapper, move the private original back to public and restore
-- its mystery_operator EXECUTE grant; drop the restrictive policy, hook and
-- helper, then the identity and install tables. Review any schema USAGE grants
-- and other Auth hooks before changing them. Back up/audit the mapping first.

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
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'authenticator' AND rolcanlogin AND NOT rolinherit
      AND NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'authenticator role has unsafe attributes';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'supabase_storage_admin' AND rolcanlogin AND NOT rolinherit
      AND NOT (rolsuper OR rolbypassrls) AND rolcreaterole
      AND NOT (rolcreatedb OR rolreplication)
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'supabase_admin' AND rolcanlogin AND rolinherit
      AND rolsuper AND rolbypassrls AND rolcreaterole AND rolcreatedb
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'trusted Supabase service/admin role attributes have drifted';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'cli_login_postgres') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = 'cli_login_postgres' AND rolcanlogin
        AND NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb
                 OR rolreplication OR rolinherit)
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = 'postgres' AND rolcanlogin AND rolbypassrls
        AND rolcreaterole AND rolcreatedb AND rolinherit AND NOT rolsuper
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members
      WHERE member = 'cli_login_postgres'::regrole AND roleid = 'postgres'::regrole
        AND set_option AND NOT inherit_option
        AND NOT admin_option
        AND grantor = 'supabase_admin'::regrole
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members
      WHERE member = 'cli_login_postgres'::regrole AND roleid = 'postgres'::regrole
        AND (NOT set_option OR inherit_option OR admin_option
             OR grantor <> 'supabase_admin'::regrole)
    ) OR (SELECT count(*) FROM pg_catalog.pg_auth_members
          WHERE member = 'cli_login_postgres'::regrole) <> 1
      OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members
      WHERE roleid = 'cli_login_postgres'::regrole
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = 'unverified delegated postgres administrator path';
    END IF;

    IF EXISTS (
      WITH expected_roles(rolname) AS (
        VALUES
          ('anon'::name), ('authenticated'::name), ('authenticator'::name),
          ('mystery_operator'::name), ('pg_create_subscription'::name),
          ('pg_database_owner'::name), ('pg_monitor'::name),
          ('pg_read_all_data'::name), ('pg_read_all_settings'::name),
          ('pg_read_all_stats'::name), ('pg_signal_backend'::name),
          ('pg_stat_scan_tables'::name), ('postgres'::name),
          ('service_role'::name), ('supabase_functions_admin'::name),
          ('supabase_privileged_role'::name)
      )
      SELECT 1
      FROM pg_catalog.pg_roles AS reachable
      WHERE reachable.oid <> 'cli_login_postgres'::regrole
        AND pg_catalog.pg_has_role(
          'cli_login_postgres'::regrole, reachable.oid, 'SET'
        )
        AND NOT EXISTS (
          SELECT 1 FROM expected_roles
          WHERE expected_roles.rolname = reachable.rolname
        )
      UNION ALL
      SELECT 1
      FROM expected_roles
      LEFT JOIN pg_catalog.pg_roles AS expected_role
        ON expected_role.rolname = expected_roles.rolname
      WHERE expected_role.oid IS NULL
         OR NOT pg_catalog.pg_has_role(
           'cli_login_postgres'::regrole, expected_role.oid, 'SET'
         )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = 'delegated administrator has an unexpected effective SET role graph';
    END IF;

    IF EXISTS (
      WITH expected_attributes(
        rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls,
        rolcreaterole, rolcreatedb, rolreplication
      ) AS (
        VALUES
          ('anon'::name, false, true, false, false, false, false, false),
          ('authenticated'::name, false, true, false, false, false, false, false),
          ('authenticator'::name, true, false, false, false, false, false, false),
          ('mystery_operator'::name, false, false, false, false, false, false, false),
          ('pg_create_subscription'::name, false, true, false, false, false, false, false),
          ('pg_database_owner'::name, false, true, false, false, false, false, false),
          ('pg_monitor'::name, false, true, false, false, false, false, false),
          ('pg_read_all_data'::name, false, true, false, false, false, false, false),
          ('pg_read_all_settings'::name, false, true, false, false, false, false, false),
          ('pg_read_all_stats'::name, false, true, false, false, false, false, false),
          ('pg_signal_backend'::name, false, true, false, false, false, false, false),
          ('pg_stat_scan_tables'::name, false, true, false, false, false, false, false),
          ('postgres'::name, true, true, false, true, true, true, true),
          ('service_role'::name, false, true, false, true, false, false, false),
          ('supabase_functions_admin'::name, true, false, false, false, true, false, false),
          ('supabase_privileged_role'::name, false, true, false, false, false, false, false)
      )
      SELECT 1
      FROM expected_attributes AS expected
      LEFT JOIN pg_catalog.pg_roles AS actual USING (rolname)
      WHERE actual.oid IS NULL
         OR actual.rolcanlogin IS DISTINCT FROM expected.rolcanlogin
         OR actual.rolinherit IS DISTINCT FROM expected.rolinherit
         OR actual.rolsuper IS DISTINCT FROM expected.rolsuper
         OR actual.rolbypassrls IS DISTINCT FROM expected.rolbypassrls
         OR actual.rolcreaterole IS DISTINCT FROM expected.rolcreaterole
         OR actual.rolcreatedb IS DISTINCT FROM expected.rolcreatedb
         OR actual.rolreplication IS DISTINCT FROM expected.rolreplication
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = 'SET-reachable role attributes differ from reviewed baseline';
    END IF;

    IF EXISTS (
      WITH expected_edges(
        member_name, role_name, set_option, inherit_option, admin_option, grantor_name
      ) AS (
        VALUES
          ('authenticator'::name, 'anon'::name, true, false, false, 'supabase_admin'::name),
          ('authenticator'::name, 'authenticated'::name, true, false, false, 'supabase_admin'::name),
          ('authenticator'::name, 'mystery_operator'::name, true, false, false, 'postgres'::name),
          ('authenticator'::name, 'service_role'::name, true, false, false, 'supabase_admin'::name),
          ('pg_monitor'::name, 'pg_read_all_settings'::name, true, true, false, 'supabase_admin'::name),
          ('pg_monitor'::name, 'pg_read_all_stats'::name, true, true, false, 'supabase_admin'::name),
          ('pg_monitor'::name, 'pg_stat_scan_tables'::name, true, true, false, 'supabase_admin'::name),
          ('postgres'::name, 'anon'::name, true, true, true, 'supabase_admin'::name),
          ('postgres'::name, 'authenticated'::name, true, true, true, 'supabase_admin'::name),
          ('postgres'::name, 'authenticator'::name, true, true, true, 'supabase_admin'::name),
          ('postgres'::name, 'mystery_operator'::name, false, false, true, 'supabase_admin'::name),
          ('postgres'::name, 'pg_create_subscription'::name, true, true, true, 'supabase_admin'::name),
          ('postgres'::name, 'pg_monitor'::name, true, true, true, 'supabase_admin'::name),
          ('postgres'::name, 'pg_read_all_data'::name, true, true, true, 'supabase_admin'::name),
          ('postgres'::name, 'pg_signal_backend'::name, true, true, true, 'supabase_admin'::name),
          ('postgres'::name, 'service_role'::name, true, true, true, 'supabase_admin'::name),
          ('postgres'::name, 'supabase_functions_admin'::name, true, true, false, 'supabase_admin'::name),
          ('postgres'::name, 'supabase_privileged_role'::name, true, true, false, 'supabase_admin'::name)
      ), actual_edges AS (
        SELECT member.rolname AS member_name, granted.rolname AS role_name,
               membership.set_option, membership.inherit_option,
               membership.admin_option,
               pg_catalog.pg_get_userbyid(membership.grantor)::name AS grantor_name,
               count(*) AS grant_count
        FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
        JOIN pg_catalog.pg_roles AS granted ON granted.oid = membership.roleid
        WHERE pg_catalog.pg_has_role('postgres', member.oid, 'SET')
        GROUP BY member.rolname, granted.rolname,
                 membership.set_option, membership.inherit_option,
                 membership.admin_option, membership.grantor
      ), invalid_edges AS (
        SELECT 1
        FROM actual_edges AS actual
        LEFT JOIN expected_edges AS expected
          ON expected.member_name = actual.member_name
         AND expected.role_name = actual.role_name
         AND expected.set_option = actual.set_option
         AND expected.inherit_option = actual.inherit_option
         AND expected.admin_option = actual.admin_option
         AND expected.grantor_name = actual.grantor_name
        WHERE expected.member_name IS NULL OR actual.grant_count <> 1
        UNION ALL
        SELECT 1
        FROM expected_edges AS expected
        WHERE (SELECT count(*)
               FROM actual_edges AS actual
               WHERE actual.member_name = expected.member_name
                 AND actual.role_name = expected.role_name
                 AND actual.set_option = expected.set_option
                 AND actual.inherit_option = expected.inherit_option
                 AND actual.admin_option = expected.admin_option
                 AND actual.grantor_name = expected.grantor_name) <> 1
      )
      SELECT 1 FROM invalid_edges
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = 'postgres has an unexpected SET-reachable membership edge';
    END IF;

    IF EXISTS (
      WITH expected_edges(
        member_name, role_name, set_option, inherit_option, admin_option, grantor_name
      ) AS (
        VALUES
          ('authenticator'::name, 'anon'::name, true, false, false, 'supabase_admin'::name),
          ('authenticator'::name, 'authenticated'::name, true, false, false, 'supabase_admin'::name),
          ('authenticator'::name, 'mystery_operator'::name, true, false, false, 'postgres'::name),
          ('authenticator'::name, 'service_role'::name, true, false, false, 'supabase_admin'::name),
          ('pg_monitor'::name, 'pg_read_all_settings'::name, true, true, false, 'supabase_admin'::name),
          ('pg_monitor'::name, 'pg_read_all_stats'::name, true, true, false, 'supabase_admin'::name),
          ('pg_monitor'::name, 'pg_stat_scan_tables'::name, true, true, false, 'supabase_admin'::name),
          ('postgres'::name, 'anon'::name, true, true, true, 'supabase_admin'::name),
          ('postgres'::name, 'authenticated'::name, true, true, true, 'supabase_admin'::name),
          ('postgres'::name, 'authenticator'::name, true, true, true, 'supabase_admin'::name),
          ('postgres'::name, 'mystery_operator'::name, false, false, true, 'supabase_admin'::name),
          ('postgres'::name, 'pg_create_subscription'::name, true, true, true, 'supabase_admin'::name),
          ('postgres'::name, 'pg_monitor'::name, true, true, true, 'supabase_admin'::name),
          ('postgres'::name, 'pg_read_all_data'::name, true, true, true, 'supabase_admin'::name),
          ('postgres'::name, 'pg_signal_backend'::name, true, true, true, 'supabase_admin'::name),
          ('postgres'::name, 'service_role'::name, true, true, true, 'supabase_admin'::name),
          ('postgres'::name, 'supabase_functions_admin'::name, true, true, false, 'supabase_admin'::name),
          ('postgres'::name, 'supabase_privileged_role'::name, true, true, false, 'supabase_admin'::name)
      ), actual_edges AS (
        SELECT member.rolname AS member_name, granted.rolname AS role_name,
               membership.set_option, membership.inherit_option,
               membership.admin_option,
               pg_catalog.pg_get_userbyid(membership.grantor)::name AS grantor_name,
               count(*) AS grant_count
        FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
        JOIN pg_catalog.pg_roles AS granted ON granted.oid = membership.roleid
        WHERE pg_catalog.pg_has_role('postgres', member.oid, 'SET')
        GROUP BY member.rolname, granted.rolname,
                 membership.set_option, membership.inherit_option,
                 membership.admin_option, membership.grantor
      ), invalid_edges AS (
        SELECT 1
        FROM actual_edges AS actual
        LEFT JOIN expected_edges AS expected
          ON expected.member_name = actual.member_name
         AND expected.role_name = actual.role_name
         AND expected.set_option = actual.set_option
         AND expected.inherit_option = actual.inherit_option
         AND expected.admin_option = actual.admin_option
         AND expected.grantor_name = actual.grantor_name
        WHERE expected.member_name IS NULL OR actual.grant_count <> 1
        UNION ALL
        SELECT 1
        FROM expected_edges AS expected
        WHERE (SELECT count(*)
               FROM actual_edges AS actual
               WHERE actual.member_name = expected.member_name
                 AND actual.role_name = expected.role_name
                 AND actual.set_option = expected.set_option
                 AND actual.inherit_option = expected.inherit_option
                 AND actual.admin_option = expected.admin_option
                 AND actual.grantor_name = expected.grantor_name) <> 1
      )
      SELECT 1 FROM invalid_edges
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = 'postgres has an unexpected SET-reachable membership edge';
    END IF;

    IF NOT pg_catalog.pg_has_role('cli_login_postgres', 'postgres', 'SET')
       OR NOT pg_catalog.pg_has_role('cli_login_postgres', 'mystery_operator', 'SET')
       OR pg_catalog.pg_has_role('cli_login_postgres', 'mystery_operator', 'USAGE') THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = 'effective delegated operator privileges do not match review';
    END IF;
  END IF;
  IF EXISTS (
    WITH RECURSIVE inbound(role_oid, path, cycle) AS (
      SELECT 'mystery_operator'::regrole::oid,
             ARRAY['mystery_operator'::regrole::oid],
             false
      UNION ALL
      SELECT membership.member, inbound.path || membership.member,
             membership.member = ANY(inbound.path)
      FROM pg_catalog.pg_auth_members AS membership
      JOIN inbound ON membership.roleid = inbound.role_oid
      WHERE NOT inbound.cycle
    ), inbound_roles AS (
      SELECT DISTINCT role_oid FROM inbound
    ), expected_edges(
      member_name, role_name, set_option, inherit_option, admin_option, grantor_name
    ) AS (
      VALUES
        ('authenticator'::name, 'mystery_operator'::name, true, false, false, 'postgres'::name),
        ('postgres'::name, 'mystery_operator'::name, false, false, true, 'supabase_admin'::name),
        ('postgres'::name, 'authenticator'::name, true, true, true, 'supabase_admin'::name),
        ('supabase_storage_admin'::name, 'authenticator'::name, true, false, false, 'supabase_admin'::name),
        ('cli_login_postgres'::name, 'postgres'::name, true, false, false, 'supabase_admin'::name)
    ), actual_edges AS (
      SELECT member.rolname AS member_name, granted.rolname AS role_name,
             membership.set_option, membership.inherit_option,
             membership.admin_option, pg_catalog.pg_get_userbyid(membership.grantor)::name AS grantor_name,
             count(*) AS grant_count
      FROM pg_catalog.pg_auth_members AS membership
      JOIN inbound_roles ON inbound_roles.role_oid = membership.roleid
      JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted ON granted.oid = membership.roleid
      GROUP BY member.rolname, granted.rolname,
               membership.set_option, membership.inherit_option,
               membership.admin_option, membership.grantor
    ), invalid_nodes AS (
      SELECT 1
      FROM inbound
      JOIN pg_catalog.pg_roles AS role ON role.oid = inbound.role_oid
      WHERE inbound.cycle
         OR role.rolname NOT IN (
           'mystery_operator', 'authenticator', 'postgres',
           'supabase_storage_admin', 'cli_login_postgres'
         )
    ), invalid_edges AS (
      SELECT 1
      FROM actual_edges AS actual
      LEFT JOIN expected_edges AS expected
        ON expected.member_name = actual.member_name
       AND expected.role_name = actual.role_name
       AND expected.set_option = actual.set_option
       AND expected.inherit_option = actual.inherit_option
       AND expected.admin_option = actual.admin_option
       AND expected.grantor_name = actual.grantor_name
      WHERE expected.member_name IS NULL OR actual.grant_count <> 1
      UNION ALL
      SELECT 1
      FROM expected_edges AS expected
      WHERE (expected.member_name <> 'cli_login_postgres'
             OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'cli_login_postgres'))
        AND (SELECT count(*)
             FROM actual_edges AS actual
             WHERE actual.member_name = expected.member_name
               AND actual.role_name = expected.role_name
               AND actual.set_option = expected.set_option
               AND actual.inherit_option = expected.inherit_option
               AND actual.admin_option = expected.admin_option
               AND actual.grantor_name = expected.grantor_name) <> 1
    )
    SELECT 1 FROM invalid_nodes
    UNION ALL
    SELECT 1 FROM invalid_edges
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'unauthorized direct or indirect mystery_operator member';
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
