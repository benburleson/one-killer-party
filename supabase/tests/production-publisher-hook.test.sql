-- Run only against a disposable migrated local database.
-- Installation and synthetic data are rolled back, including on connection loss.
-- ON_ERROR_STOP plus the final finish() check makes pgTAP failures exit nonzero.
\set ON_ERROR_STOP on
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path TO public, extensions;
GRANT USAGE ON SCHEMA extensions TO mystery_operator, supabase_auth_admin;
SELECT no_plan();

CREATE ROLE synthetic_direct_operator_member NOLOGIN;
GRANT mystery_operator TO synthetic_direct_operator_member;
SAVEPOINT direct_member_check;
-- The installer must fail here; capture its SQLSTATE before recovering.
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set direct_member_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT direct_member_check;
SELECT is(:'direct_member_sqlstate'::text, '42501'::text, 'direct untrusted role membership blocks installation');
SELECT ok(pg_catalog.to_regclass('private_mystery.production_publisher_install') IS NULL,
  'rejected installation leaves no installation marker');
REVOKE mystery_operator FROM synthetic_direct_operator_member;
DROP ROLE synthetic_direct_operator_member;

\ir production-publisher-hook-review.inc
\ir production-publisher-hook-review.inc
CREATE ROLE synthetic_operator_bridge NOLOGIN;
CREATE ROLE synthetic_indirect_operator_member NOLOGIN;
GRANT mystery_operator TO synthetic_operator_bridge;
GRANT synthetic_operator_bridge TO synthetic_indirect_operator_member;
SELECT ok(pg_catalog.pg_has_role('synthetic_indirect_operator_member', 'mystery_operator', 'MEMBER'),
  'synthetic indirect member reaches operator through a role bridge');
SAVEPOINT indirect_member_check;
-- Both the untrusted bridge and its indirect member must be rejected.
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set indirect_member_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT indirect_member_check;
SELECT is(:'indirect_member_sqlstate'::text, '42501'::text,
  'transitive untrusted role membership blocks repeat installation');
REVOKE synthetic_operator_bridge FROM synthetic_indirect_operator_member;
REVOKE mystery_operator FROM synthetic_operator_bridge;
DROP ROLE synthetic_indirect_operator_member;
DROP ROLE synthetic_operator_bridge;

INSERT INTO auth.users (id, aud, role, email, is_anonymous) VALUES
  ('00000000-0000-4000-8000-000000000901', 'authenticated', 'authenticated', 'publisher-synthetic@test.invalid', false),
  ('00000000-0000-4000-8000-000000000902', 'authenticated', 'authenticated', 'nonpublisher-synthetic@test.invalid', false);
INSERT INTO private_mystery.production_publisher_identity (user_id)
VALUES ('00000000-0000-4000-8000-000000000901');
-- A broad permissive policy must not bypass the production restrictive policy.
CREATE POLICY synthetic_permissive_operator ON storage.objects
  FOR ALL TO mystery_operator USING (true) WITH CHECK (true);

SELECT is(
  private_mystery.production_publisher_hook(
    '{"user_id":"00000000-0000-4000-8000-000000000902","claims":{"role":"custom","aal":"aal1","extra":42},"extra":"unchanged"}'::jsonb),
  '{"user_id":"00000000-0000-4000-8000-000000000902","claims":{"role":"custom","aal":"aal1","extra":42},"extra":"unchanged"}'::jsonb,
  'nonpublisher event and claims are unchanged'
);
SELECT is(
  private_mystery.production_publisher_hook(
    '{"user_id":"00000000-0000-4000-8000-000000000901","claims":{"role":"authenticated","aal":"aal2","extra":42}}'::jsonb),
  '{"user_id":"00000000-0000-4000-8000-000000000901","claims":{"role":"mystery_operator","aal":"aal2","extra":42}}'::jsonb,
  'mapped authenticated user changes only the role'
);
SELECT is(
  private_mystery.production_publisher_hook(
    '{"user_id":"00000000-0000-4000-8000-000000000901","claims":{"role":"service_role","extra":42}}'::jsonb),
  '{"user_id":"00000000-0000-4000-8000-000000000901","claims":{"role":"service_role","extra":42}}'::jsonb,
  'mapped user cannot change a different upstream role'
);
SELECT pg_catalog.pg_has_role(current_user, 'supabase_auth_admin', 'MEMBER') AS can_set_auth_admin \gset
\if :can_set_auth_admin
SET LOCAL ROLE supabase_auth_admin;
SELECT is(
  private_mystery.production_publisher_hook(
    '{"user_id":"00000000-0000-4000-8000-000000000901","claims":{"role":"authenticated"}}'::jsonb),
  '{"user_id":"00000000-0000-4000-8000-000000000901","claims":{"role":"mystery_operator"}}'::jsonb,
  'auth admin can invoke the hook without table access'
);
RESET ROLE;
\else
SELECT skip('test runner cannot assume supabase_auth_admin');
\endif
SELECT ok(
  NOT pg_catalog.has_table_privilege('supabase_auth_admin', 'private_mystery.production_publisher_identity', 'SELECT')
  AND NOT pg_catalog.has_function_privilege('authenticated', 'private_mystery.production_publisher_hook(jsonb)', 'EXECUTE')
  AND pg_catalog.has_function_privilege('supabase_auth_admin', 'private_mystery.production_publisher_hook(jsonb)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('mystery_operator', 'private_mystery.publish_mystery_version(text,text,integer,text,text,text,text,text,text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated', 'public.publish_mystery_version(text,text,integer,text,text,text,text,text,text)', 'EXECUTE'),
  'identity and registration implementation are not exposed to callers'
);
SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog']
   FROM pg_catalog.pg_proc WHERE oid = 'private_mystery.production_publisher_hook(jsonb)'::regprocedure)
  AND (SELECT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog']
   FROM pg_catalog.pg_proc WHERE oid = 'private_mystery.production_publisher_authorized()'::regprocedure),
  'hook and authorization helper are security definers with pinned search paths'
);

SET LOCAL ROLE mystery_operator;
SELECT pg_catalog.set_config('request.jwt.claims',
  '{"role":"mystery_operator","sub":"00000000-0000-4000-8000-000000000901"}', true);
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name) VALUES
    ('private-mystery-packages', 'synthetic-missing-aal')$$,
  '42501', NULL, 'missing assurance cannot insert even with a permissive policy'
);
SELECT pg_catalog.set_config('request.jwt.claims',
  '{"role":"mystery_operator","aal":"aal2"}', true);
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name) VALUES
    ('private-mystery-packages', 'synthetic-missing-sub')$$,
  '42501', NULL, 'missing subject cannot insert'
);
SELECT pg_catalog.set_config('request.jwt.claims',
  '{"role":"mystery_operator","sub":"00000000-0000-4000-8000-000000000902","aal":"aal2"}', true);
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name) VALUES
    ('private-mystery-packages', 'synthetic-other-sub')$$,
  '42501', NULL, 'unmapped subject cannot insert'
);
SELECT pg_catalog.set_config('request.jwt.claims',
  '{"role":"mystery_operator","sub":"00000000-0000-4000-8000-000000000901","aal":"aal1"}', true);
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name) VALUES
    ('private-mystery-packages', 'synthetic-mfa/test-v1/' || repeat('a',64) || '.json')$$,
  '42501', NULL, 'aal1 cannot insert a private object'
);
SELECT throws_ok(
  $$SELECT public.publish_mystery_version('synthetic-mfa','test-v1',1,repeat('a',64),
    'synthetic-mfa/test-v1/' || repeat('a',64) || '.json',
    'eight-role-prototype-v1','synthetic:test','operator','test')$$,
  '42501', NULL, 'aal1 cannot register'
);

SELECT pg_catalog.set_config('request.jwt.claims',
  '{"role":"mystery_operator","sub":"00000000-0000-4000-8000-000000000901","aal":"aal2"}', true);
SELECT lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name) VALUES
    ('private-mystery-packages', 'synthetic-mfa/test-v1/' || repeat('a',64) || '.json')$$,
  'mapped aal2 operator can insert'
);
SELECT is(
  (SELECT count(*)::integer FROM storage.objects WHERE bucket_id = 'private-mystery-packages'
   AND name = 'synthetic-mfa/test-v1/' || repeat('a',64) || '.json'),
  1, 'mapped aal2 operator can read'
);
SELECT is(
  public.publish_mystery_version('synthetic-mfa','test-v1',1,repeat('a',64),
    'synthetic-mfa/test-v1/' || repeat('a',64) || '.json',
    'eight-role-prototype-v1','synthetic:test','operator','test'),
  'published', 'mapped aal2 operator can register'
);
SELECT is(
  public.publish_mystery_version('synthetic-mfa','test-v1',1,repeat('a',64),
    'synthetic-mfa/test-v1/' || repeat('a',64) || '.json',
    'eight-role-prototype-v1','synthetic:test','operator','test'),
  'already_published', 'registration remains idempotent'
);
SELECT pg_catalog.set_config('request.jwt.claims',
  '{"role":"mystery_operator","sub":"00000000-0000-4000-8000-000000000901","aal":"aal1"}', true);
SELECT is(
  (SELECT count(*)::integer FROM storage.objects WHERE bucket_id = 'private-mystery-packages'
   AND name = 'synthetic-mfa/test-v1/' || repeat('a',64) || '.json'),
  0, 'aal1 cannot read an existing private object'
);

RESET ROLE;
DELETE FROM private_mystery.production_publisher_identity;
SET LOCAL ROLE mystery_operator;
SELECT pg_catalog.set_config('request.jwt.claims',
  '{"role":"mystery_operator","sub":"00000000-0000-4000-8000-000000000901","aal":"aal2"}', true);
SELECT is(
  (SELECT count(*)::integer FROM storage.objects WHERE bucket_id = 'private-mystery-packages'
   AND name = 'synthetic-mfa/test-v1/' || repeat('a',64) || '.json'),
  0, 'revocation blocks reads using the previously issued aal2 claims'
);
SELECT throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name) VALUES
    ('private-mystery-packages', 'synthetic-mfa/test-v2/' || repeat('b',64) || '.json')$$,
  '42501', NULL, 'revocation blocks inserts using the previously issued aal2 claims'
);
SELECT throws_ok(
  $$SELECT public.publish_mystery_version('synthetic-mfa','test-v1',1,repeat('a',64),
    'synthetic-mfa/test-v1/' || repeat('a',64) || '.json',
    'eight-role-prototype-v1','synthetic:test','operator','test')$$,
  '42501', NULL, 'revocation blocks registration using the previously issued aal2 claims'
);
RESET ROLE;
SELECT throws_ok(
  $$UPDATE storage.objects SET name = name WHERE bucket_id = 'private-mystery-packages'
    AND name = 'synthetic-mfa/test-v1/' || repeat('a',64) || '.json'$$,
  '55000', NULL, 'object immutability remains in force'
);
SELECT throws_ok(
  $$DELETE FROM private_mystery.published_versions WHERE mystery_id = 'synthetic-mfa'$$,
  '55000', NULL, 'registry immutability remains in force'
);
-- Only after disabling issuance and waiting out tokens, restore the original.
DROP POLICY synthetic_permissive_operator ON storage.objects;
DROP POLICY production_publisher_restrict_objects ON storage.objects;
DROP FUNCTION public.publish_mystery_version(text,text,integer,text,text,text,text,text,text);
ALTER FUNCTION private_mystery.publish_mystery_version(text,text,integer,text,text,text,text,text,text)
  SET SCHEMA public;
GRANT EXECUTE ON FUNCTION public.publish_mystery_version(text,text,integer,text,text,text,text,text,text)
  TO mystery_operator;
DROP FUNCTION private_mystery.production_publisher_hook(jsonb);
DROP FUNCTION private_mystery.production_publisher_authorized();
DROP TABLE private_mystery.production_publisher_identity;
DROP TABLE private_mystery.production_publisher_install;
SELECT ok(
  pg_catalog.has_function_privilege('mystery_operator',
    'public.publish_mystery_version(text,text,integer,text,text,text,text,text,text)', 'EXECUTE')
  AND pg_catalog.to_regprocedure('private_mystery.publish_mystery_version(text,text,integer,text,text,text,text,text,text)') IS NULL,
  'reviewed rollback restores the original registration entry point'
);
CREATE TEMP TABLE publisher_test_finish ON COMMIT DROP AS SELECT * FROM finish();
TABLE publisher_test_finish;
DO $$
BEGIN
  IF (SELECT count(*) <> 1 OR NOT bool_and(finish ~ '^1\.\.[0-9]+$') FROM publisher_test_finish) THEN
    RAISE EXCEPTION 'publisher pgTAP assertions failed';
  END IF;
END;
$$;
ROLLBACK;
