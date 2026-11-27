BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT no_plan();

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('00000000-0000-4000-8000-000000000701', 'authenticated', 'authenticated', 'dossier-host@test.invalid'),
  ('00000000-0000-4000-8000-000000000702', 'authenticated', 'authenticated', 'dossier-member@test.invalid'),
  ('00000000-0000-4000-8000-000000000703', 'authenticated', 'authenticated', 'dossier-recovered@test.invalid');
INSERT INTO private_mystery.published_versions
  (mystery_id, version, schema_version, digest_sha256, object_path, rule_set_id, provenance, approved_by, approval_reference)
VALUES ('synthetic-dossier', 'v1', 1, repeat('a',64), 'synthetic-dossier/v1/' || repeat('a',64) || '.json',
  'eight-role-prototype-v1', 'synthetic:test', 'test-operator', 'test');
INSERT INTO public.parties (id, host_principal_id, mystery_id, mystery_version, mystery_schema_version, mystery_digest_sha256, version)
VALUES ('10000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000701',
  'synthetic-dossier', 'v1', 1, repeat('a',64), 7);
INSERT INTO public.party_character_refs (party_id, character_id)
VALUES ('10000000-0000-4000-8000-000000000701', 'role-1');
INSERT INTO public.participants (id, party_id, principal_id, display_name, assigned_character_id)
VALUES ('20000000-0000-4000-8000-000000000701', '10000000-0000-4000-8000-000000000701',
  '00000000-0000-4000-8000-000000000702', 'Member', 'role-1');

SELECT ok(has_function_privilege('service_role', 'public.get_dossier_authorization_snapshot(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_dossier_authorization_snapshot(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.get_dossier_authorization_snapshot(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('mystery_operator', 'public.get_dossier_authorization_snapshot(uuid,uuid)', 'EXECUTE'),
  'only service role has RPC access');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.get_dossier_authorization_snapshot(
  '10000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702')$$,
  '42501', NULL, 'browser cannot execute snapshot');
RESET ROLE;
SELECT results_eq(
  $$SELECT party_id, principal_id, participant_id, assigned_character_id, status, party_version,
    mystery_id, mystery_version, schema_version, digest_sha256
    FROM public.get_dossier_authorization_snapshot('10000000-0000-4000-8000-000000000701',
      '00000000-0000-4000-8000-000000000702')$$,
  $$VALUES ('10000000-0000-4000-8000-000000000701'::uuid, '00000000-0000-4000-8000-000000000702'::uuid,
    '20000000-0000-4000-8000-000000000701'::uuid, 'role-1'::text, 'LOBBY'::text, 7,
    'synthetic-dossier'::text, 'v1'::text, 1, repeat('a',64))$$,
  'member receives coherent identity, assignment, phase, version and exact pin');
SELECT is((SELECT count(*) FROM public.get_dossier_authorization_snapshot(
  '10000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000701')), 0::bigint,
  'nonplaying host is not a participant');
SELECT is((SELECT count(*) FROM public.get_dossier_authorization_snapshot(
  '10000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000702')), 0::bigint,
  'other party is unavailable');
UPDATE public.participants SET principal_id = '00000000-0000-4000-8000-000000000703'
WHERE id = '20000000-0000-4000-8000-000000000701';
SELECT is((SELECT count(*) FROM public.get_dossier_authorization_snapshot(
  '10000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702')), 0::bigint,
  'old principal loses access after recovery');
SELECT is((SELECT assigned_character_id FROM public.get_dossier_authorization_snapshot(
  '10000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000703')), 'role-1',
  'recovered principal retains assignment');
SELECT * FROM finish();
ROLLBACK;
