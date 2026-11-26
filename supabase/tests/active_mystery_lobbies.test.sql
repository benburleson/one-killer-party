BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT no_plan();

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('00000000-0000-4000-8000-000000000091', 'authenticated', 'authenticated', 'host91@test.invalid'),
  ('00000000-0000-4000-8000-000000000092', 'authenticated', 'authenticated', 'host92@test.invalid');

INSERT INTO private_mystery.published_versions
  (mystery_id, version, schema_version, digest_sha256, object_path, rule_set_id, provenance, approved_by, approval_reference)
SELECT 'synthetic-active', version, 1, digest,
  'synthetic-active/' || version || '/' || digest || '.json',
  'eight-role-prototype-v1', 'synthetic:test', 'test-operator', 'test'
FROM (VALUES ('v1', repeat('a',64)), ('v2', repeat('b',64))) AS fixtures(version, digest);

SELECT ok(NOT has_table_privilege('service_role', 'private_mystery.active_version', 'UPDATE')
  AND NOT has_table_privilege('mystery_operator', 'private_mystery.active_version', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'private_mystery.active_version', 'UPDATE'),
  'runtime, publisher and browser cannot activate');
SELECT ok(NOT has_function_privilege('anon', 'public.create_pinned_host_party(uuid,uuid,bytea,text,text,integer,text,text[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.get_active_mystery()', 'EXECUTE'),
  'browser roles cannot access activation or creation RPCs');
SELECT is((SELECT mystery_id FROM public.get_active_mystery()), NULL::text, 'publication does not activate');
SELECT results_eq(
  $$SELECT created FROM public.create_pinned_host_party(
    '00000000-0000-4000-8000-000000000091', '10000000-0000-4000-8000-000000000091',
    decode(repeat('01',32),'hex'), NULL, NULL, NULL, NULL, NULL)$$,
  $$VALUES (true)$$, 'explicit absence creates legacy party');

UPDATE private_mystery.active_version
SET mystery_id = 'synthetic-active', version = 'v1', schema_version = 1, digest_sha256 = repeat('a',64)
WHERE singleton;
SELECT throws_ok(
  $$SELECT * FROM public.create_host_party('00000000-0000-4000-8000-000000000091',
    '10000000-0000-4000-8000-000000000092', decode(repeat('02',32),'hex'))$$,
  '55000', NULL, 'old creation entry point cannot bypass activation');
SELECT throws_ok(
  $$SELECT * FROM public.create_pinned_host_party('00000000-0000-4000-8000-000000000091',
    '10000000-0000-4000-8000-000000000092', decode(repeat('02',32),'hex'),
    NULL, NULL, NULL, NULL, NULL)$$,
  '55000', NULL, 'stale absent snapshot fails closed');
SELECT results_eq(
  $$SELECT created FROM public.create_pinned_host_party(
    '00000000-0000-4000-8000-000000000091', '10000000-0000-4000-8000-000000000092',
    decode(repeat('02',32),'hex'), 'synthetic-active', 'v1', 1, repeat('a',64),
    ARRAY['role-1','role-2','role-3','role-4','role-5','role-6','role-7','role-8'])$$,
  $$VALUES (true)$$, 'verified IDs can be pinned atomically');
SELECT is((SELECT count(*)::integer FROM public.party_character_refs
  WHERE party_id = '10000000-0000-4000-8000-000000000092'), 8, 'eight character references registered');
SELECT results_eq(
  $$SELECT created FROM public.create_pinned_host_party('00000000-0000-4000-8000-000000000091',
    '10000000-0000-4000-8000-000000000091', decode(repeat('03',32),'hex'),
    NULL,NULL,NULL,NULL,NULL)$$,
  $$VALUES (false)$$, 'same-host retry precedes active snapshot');
SELECT throws_ok(
  $$SELECT * FROM public.create_pinned_host_party('00000000-0000-4000-8000-000000000092',
    '10000000-0000-4000-8000-000000000091', decode(repeat('03',32),'hex'),
    NULL,NULL,NULL,NULL,NULL)$$,
  '42501', NULL, 'other host cannot claim existing ID');
SELECT is((SELECT count(*)::integer FROM public.invitation_credentials
  WHERE party_id = '10000000-0000-4000-8000-000000000091'), 1, 'retry leaves original invite unchanged');

UPDATE private_mystery.active_version
SET version = 'v2', digest_sha256 = repeat('b',64) WHERE singleton;
SELECT throws_ok(
  $$SELECT * FROM public.create_pinned_host_party('00000000-0000-4000-8000-000000000091',
    '10000000-0000-4000-8000-000000000093', decode(repeat('03',32),'hex'),
    'synthetic-active','v1',1,repeat('a',64),
    ARRAY['role-1','role-2','role-3','role-4','role-5','role-6','role-7','role-8'])$$,
  '55000', NULL, 'stale active snapshot fails closed');
SELECT throws_ok(
  $$SELECT * FROM public.create_pinned_host_party('00000000-0000-4000-8000-000000000091',
    '10000000-0000-4000-8000-000000000093', decode(repeat('02',32),'hex'),
    'synthetic-active','v2',1,repeat('b',64),
    ARRAY['role-1','role-2','role-3','role-4','role-5','role-6','role-7','role-8'])$$,
  '23505', NULL, 'invite collision fails creation');
SELECT is((SELECT count(*)::integer FROM public.parties WHERE id = '10000000-0000-4000-8000-000000000093'), 0,
  'collision rolls back party and character references');
SELECT is((SELECT mystery_version FROM public.parties WHERE id = '10000000-0000-4000-8000-000000000092'),
  'v1', 'activation does not repin old parties');
SELECT throws_ok($$UPDATE public.parties SET mystery_digest_sha256 = repeat('b',64)
  WHERE id = '10000000-0000-4000-8000-000000000092'$$,
  '23514', NULL, 'digest pin is immutable');
SELECT throws_ok($$INSERT INTO public.parties (host_principal_id, mystery_id, mystery_version)
  VALUES ('00000000-0000-4000-8000-000000000091', 'synthetic-active', 'v1')$$,
  '23514', NULL, 'published pin requires both schema and digest');
SELECT throws_ok($$UPDATE private_mystery.active_version SET digest_sha256 = repeat('c',64) WHERE singleton$$,
  '23503', NULL, 'activation requires exact published key');
SELECT throws_ok($$DELETE FROM private_mystery.active_version$$,
  '55000', NULL, 'singleton cannot be deleted');

SELECT * FROM finish();
ROLLBACK;
