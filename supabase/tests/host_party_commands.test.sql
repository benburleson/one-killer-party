BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT no_plan();

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('00000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'command-host-a@test.invalid'),
  ('00000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'command-host-b@test.invalid');

SELECT is(
  (SELECT count(*)::integer FROM pg_catalog.pg_proc AS p
   JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('create_host_party', 'get_host_party', 'list_host_parties', 'rotate_host_invite')),
  4, 'each RPC has exactly one overload'
);
SELECT ok(
  (SELECT bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog'])
   FROM pg_catalog.pg_proc AS p
   JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('create_host_party', 'get_host_party', 'list_host_parties', 'rotate_host_invite')),
  'all commands are SECURITY DEFINER with a pinned search path'
);
SELECT ok(
  (SELECT bool_and(
    NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ))
   FROM pg_catalog.pg_proc AS p
   JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('create_host_party', 'get_host_party', 'list_host_parties', 'rotate_host_invite')),
  'only service_role has application-role execution privileges, including no PUBLIC grant'
);
SELECT is(
  (SELECT proargnames FROM pg_catalog.pg_proc WHERE oid = 'public.create_host_party(uuid,uuid,bytea)'::regprocedure),
  ARRAY['p_host', 'p_party_id', 'p_verifier_hash', 'party_id', 'created']::text[],
  'create RPC has named inputs and only the expected outputs'
);
SELECT is(
  (SELECT proargnames FROM pg_catalog.pg_proc WHERE oid = 'public.get_host_party(uuid,uuid)'::regprocedure),
  ARRAY['p_host', 'p_party_id', 'party_id', 'status', 'version', 'mystery_id']::text[],
  'get RPC exposes safe party metadata including the pinned package identifier'
);
SELECT is(
  (SELECT proargnames FROM pg_catalog.pg_proc WHERE oid = 'public.list_host_parties(uuid)'::regprocedure),
  ARRAY['p_host', 'party_id', 'status', 'version']::text[],
  'list RPC exposes only party ID, status and version'
);
SELECT is(
  (SELECT proargnames FROM pg_catalog.pg_proc WHERE oid = 'public.rotate_host_invite(uuid,uuid,bytea,integer)'::regprocedure),
  ARRAY['p_host', 'p_party_id', 'p_verifier_hash', 'p_expected_version']::text[],
  'rotate RPC has named inputs and no hash output'
);
SELECT is(
  pg_catalog.pg_get_function_result('public.rotate_host_invite(uuid,uuid,bytea,integer)'::regprocedure),
  'boolean', 'rotate returns only a boolean'
);

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT * FROM public.create_host_party('00000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', decode(repeat('11', 32), 'hex'))$$,
  '42501', NULL, 'anon cannot create'
);
SELECT throws_ok($$SELECT * FROM public.get_host_party(NULL, NULL)$$, '42501', NULL, 'anon cannot get');
SELECT throws_ok($$SELECT * FROM public.list_host_parties(NULL)$$, '42501', NULL, 'anon cannot list');
SELECT throws_ok($$SELECT public.rotate_host_invite(NULL, NULL, NULL, NULL)$$, '42501', NULL, 'anon cannot rotate');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000101","role":"service_role"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.create_host_party('00000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', decode(repeat('11', 32), 'hex'))$$,
  '42501', NULL, 'authenticated cannot create even with a forged service role claim'
);
SELECT throws_ok($$SELECT * FROM public.get_host_party(NULL, NULL)$$, '42501', NULL, 'authenticated cannot get');
SELECT throws_ok($$SELECT * FROM public.list_host_parties(NULL)$$, '42501', NULL, 'authenticated cannot list');
SELECT throws_ok($$SELECT public.rotate_host_invite(NULL, NULL, NULL, NULL)$$, '42501', NULL, 'authenticated cannot rotate');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT results_eq(
  $$SELECT * FROM public.create_host_party(
      p_host => '00000000-0000-4000-8000-000000000101',
      p_party_id => '10000000-0000-4000-8000-000000000101',
      p_verifier_hash => decode(repeat('11', 32), 'hex'))$$,
  $$VALUES ('10000000-0000-4000-8000-000000000101'::uuid, true)$$,
  'service role creates using RPC parameter names'
);
SELECT results_eq(
  $$SELECT * FROM public.create_host_party(
      p_host => '00000000-0000-4000-8000-000000000101',
      p_party_id => '10000000-0000-4000-8000-000000000101',
      p_verifier_hash => decode(repeat('22', 32), 'hex'))$$,
  $$VALUES ('10000000-0000-4000-8000-000000000101'::uuid, false)$$,
  'same-host retry is idempotent and does not issue another invitation'
);
SELECT throws_ok(
  $$SELECT * FROM public.create_host_party('00000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000101', decode(repeat('22', 32), 'hex'))$$,
  '42501', NULL, 'another host cannot claim an existing party ID'
);
SELECT throws_ok(
  $$SELECT * FROM public.create_host_party('00000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000102', decode(repeat('11', 32), 'hex'))$$,
  '23505', NULL, 'a reused verifier aborts creation'
);
SELECT throws_ok(
  $$SELECT * FROM public.create_host_party('00000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000102', decode(repeat('22', 31), 'hex'))$$,
  '22023', NULL, 'create rejects short hashes'
);
SELECT throws_ok(
  $$SELECT * FROM public.create_host_party('00000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000102', decode(repeat('22', 33), 'hex'))$$,
  '22023', NULL, 'create rejects long hashes'
);
SELECT throws_ok(
  $$SELECT * FROM public.create_host_party('00000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000102', NULL)$$,
  '22023', NULL, 'create rejects null hashes'
);
SELECT throws_ok(
  $$SELECT * FROM public.create_host_party(NULL, '10000000-0000-4000-8000-000000000102', decode(repeat('22', 32), 'hex'))$$,
  '22023', NULL, 'create rejects a null host'
);
SELECT throws_ok(
  $$SELECT * FROM public.create_host_party('00000000-0000-4000-8000-000000000102', NULL, decode(repeat('22', 32), 'hex'))$$,
  '22023', NULL, 'create rejects a null party ID'
);
SELECT throws_ok(
  $$SELECT * FROM public.create_host_party('ffffffff-ffff-4fff-8fff-ffffffffffff', '10000000-0000-4000-8000-000000000102', decode(repeat('22', 32), 'hex'))$$,
  '23503', NULL, 'create requires an existing host'
);
SELECT results_eq(
  $$SELECT * FROM public.create_host_party('00000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000102', decode(repeat('22', 32), 'hex'))$$,
  $$VALUES ('10000000-0000-4000-8000-000000000102'::uuid, true)$$,
  'failed creates leave the party ID available'
);
SELECT results_eq(
  $$SELECT * FROM public.get_host_party(p_host => '00000000-0000-4000-8000-000000000101', p_party_id => '10000000-0000-4000-8000-000000000101')$$,
  $$VALUES ('10000000-0000-4000-8000-000000000101'::uuid, 'LOBBY'::text, 0, 'blackwood-affair'::text)$$,
  'host can get their party'
);
SELECT is(
  (SELECT count(*)::integer FROM public.get_host_party('00000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000101')),
  0, 'another host cannot get the party'
);
SELECT is(
  (SELECT count(*)::integer FROM public.get_host_party('00000000-0000-4000-8000-000000000101', 'ffffffff-ffff-4fff-8fff-ffffffffffff')),
  0, 'missing parties return no rows'
);
SELECT results_eq(
  $$SELECT * FROM public.list_host_parties(p_host => '00000000-0000-4000-8000-000000000101')$$,
  $$VALUES ('10000000-0000-4000-8000-000000000101'::uuid, 'LOBBY'::text, 0)$$,
  'list is scoped to the supplied host'
);
SELECT is((SELECT count(*)::integer FROM public.list_host_parties(NULL)), 0, 'null host lists no parties');
SELECT is(
  public.rotate_host_invite('00000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000101', decode(repeat('33', 32), 'hex'), 0),
  false, 'another host cannot rotate the invitation'
);
SELECT is(
  public.rotate_host_invite('00000000-0000-4000-8000-000000000101', 'ffffffff-ffff-4fff-8fff-ffffffffffff', decode(repeat('33', 32), 'hex'), 0),
  false, 'a missing party cannot be rotated'
);
SELECT throws_ok(
  $$SELECT public.rotate_host_invite('00000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', decode(repeat('33', 33), 'hex'), 0)$$,
  '22023', NULL, 'rotate rejects long hashes'
);
SELECT throws_ok(
  $$SELECT public.rotate_host_invite('00000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', NULL, 0)$$,
  '22023', NULL, 'rotate rejects null hashes'
);
SELECT throws_ok(
  $$SELECT public.rotate_host_invite('00000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', decode(repeat('22', 32), 'hex'), 0)$$,
  '23505', NULL, 'a rotation verifier collision aborts the entire rotation'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_credentials
   WHERE party_id = '10000000-0000-4000-8000-000000000101'
     AND verifier_hash = decode(repeat('11', 32), 'hex') AND revoked_at IS NULL),
  1, 'failed rotation preserves the previous active invitation'
);
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_credentials
   WHERE party_id = '10000000-0000-4000-8000-000000000101'),
  1, 'retry and unauthorized attempts do not create or revoke credentials'
);
SELECT is(
  (SELECT version FROM public.parties WHERE id = '10000000-0000-4000-8000-000000000101'),
  0, 'failed rotations do not increment the party version'
);
SET LOCAL ROLE service_role;
SELECT is(
  public.rotate_host_invite(
    p_host => '00000000-0000-4000-8000-000000000101',
    p_party_id => '10000000-0000-4000-8000-000000000101',
    p_verifier_hash => decode(repeat('33', 32), 'hex'),
    p_expected_version => 0),
  true, 'host can rotate using named RPC parameters'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_credentials
   WHERE party_id = '10000000-0000-4000-8000-000000000101'
     AND verifier_hash = decode(repeat('11', 32), 'hex') AND revoked_at IS NOT NULL),
  1, 'successful rotation revokes the old verifier'
);
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_credentials
   WHERE party_id = '10000000-0000-4000-8000-000000000101'
     AND verifier_hash = decode(repeat('33', 32), 'hex') AND revoked_at IS NULL),
  1, 'successful rotation installs one new active verifier'
);
SELECT is(
  (SELECT version FROM public.parties WHERE id = '10000000-0000-4000-8000-000000000101'),
  1, 'successful rotation increments the party version once'
);
SET LOCAL ROLE service_role;
SELECT is(
  public.rotate_host_invite('00000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', decode(repeat('55', 32), 'hex'), 0),
  false, 'a competing rotation based on the old version fails'
);
SELECT is(
  public.rotate_host_invite('00000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', decode(repeat('55', 32), 'hex'), NULL),
  false, 'a null expected version fails closed'
);
SELECT results_eq(
  $$SELECT * FROM public.create_host_party('00000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', decode(repeat('44', 32), 'hex'))$$,
  $$VALUES ('10000000-0000-4000-8000-000000000101'::uuid, false)$$,
  'retry after rotation still reports the existing party'
);
SELECT throws_ok(
  $$SELECT public.rotate_host_invite('00000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', decode(repeat('33', 32), 'hex'), 1)$$,
  '23505', NULL, 'rotating to the current verifier fails'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_credentials
   WHERE party_id = '10000000-0000-4000-8000-000000000101'
     AND verifier_hash = decode(repeat('33', 32), 'hex') AND revoked_at IS NULL),
  1, 'stale rotations, post-rotation retry and verifier reuse preserve the active invitation'
);
SELECT is(
  (SELECT version FROM public.parties WHERE id = '10000000-0000-4000-8000-000000000101'),
  1, 'stale and failed rotations leave the version unchanged'
);
SET LOCAL ROLE service_role;
SELECT is(
  public.rotate_host_invite('00000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', decode(repeat('55', 32), 'hex'), 1),
  true, 'a rotation using the current version succeeds'
);
SELECT results_eq(
  $$SELECT * FROM public.get_host_party('00000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101')$$,
  $$VALUES ('10000000-0000-4000-8000-000000000101'::uuid, 'LOBBY'::text, 2, 'blackwood-affair'::text)$$,
  'successful second rotation exposes the new version to the host'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_credentials
   WHERE party_id = '10000000-0000-4000-8000-000000000101'
     AND verifier_hash = decode(repeat('55', 32), 'hex') AND revoked_at IS NULL),
  1, 'current-version rotation installs the new invitation'
);
SELECT ok(
  (SELECT bool_and(mystery_id = 'blackwood-affair' AND mystery_version = 'first-playtest-placeholder-v1')
   FROM public.parties WHERE id IN ('10000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000102')),
  'created parties have the fixed mystery pins'
);
SELECT is(
  (SELECT count(*)::integer FROM public.participants
   WHERE party_id IN ('10000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000102')),
  0, 'creation and rotation never create host participants'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.parties', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.parties', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.invitation_credentials', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.invitation_credentials', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.participants', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.participants', 'SELECT'),
  'browser table grants remain unchanged'
);

SELECT * FROM finish();
ROLLBACK;
