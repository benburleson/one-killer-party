BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'host-a@test.invalid'),
  ('00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'guest-a@test.invalid'),
  ('00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'guest-b@test.invalid'),
  ('00000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'host-b@test.invalid'),
  ('00000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'outsider@test.invalid'),
  ('00000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'replacement@test.invalid');

INSERT INTO public.parties (id, host_principal_id, mystery_id, mystery_version)
VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'test-mystery-a', 'test-v1'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004', 'test-mystery-b', 'test-v1');

INSERT INTO public.party_character_refs (party_id, character_id) VALUES
  ('10000000-0000-4000-8000-000000000001', 'test-character-a'),
  ('10000000-0000-4000-8000-000000000001', 'test-character-b'),
  ('10000000-0000-4000-8000-000000000002', 'test-character-a'),
  ('10000000-0000-4000-8000-000000000002', 'test-character-cross');

INSERT INTO public.participants
  (id, party_id, principal_id, display_name, assigned_character_id)
VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Guest A', 'test-character-a'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'Guest B', NULL),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Host A playing', 'test-character-a');

INSERT INTO public.invitation_credentials
  (party_id, verifier_hash)
VALUES
  ('10000000-0000-4000-8000-000000000001', decode(repeat('a1', 32), 'hex'));

SELECT no_plan();

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.parties'::regclass),
  'parties keeps row-level security enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.party_character_refs'::regclass),
  'character references keep row-level security enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.participants'::regclass),
  'participants keep row-level security enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.invitation_credentials'::regclass),
  'invitation credentials keep row-level security enabled'
);
SELECT is(
  (SELECT count(*)::integer FROM pg_policies WHERE schemaname = 'public'
    AND tablename IN ('parties', 'party_character_refs', 'participants', 'invitation_credentials')),
  0,
  'browser tables have no read or write policies until a trusted command boundary exists'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.parties', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.parties', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.party_character_refs', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.party_character_refs', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.participants', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.participants', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.invitation_credentials', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.invitation_credentials', 'SELECT'),
  'anonymous and authenticated roles cannot read party, participant, or credential tables'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.parties', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.parties', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.participants', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.invitation_credentials', 'DELETE'),
  'browser roles have no direct mutation privileges'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.enforce_party_update_invariants()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.enforce_party_update_invariants()', 'EXECUTE'),
  'browser roles cannot call the party update trigger function'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invitation_credentials'
      AND column_name IN ('code', 'raw_code', 'invitation_code')
  ),
  'the invitation table has no raw-code column'
);

SELECT is(
  (SELECT count(*)::integer FROM public.participants
    WHERE party_id = '10000000-0000-4000-8000-000000000001'
      AND principal_id = '00000000-0000-4000-8000-000000000001'),
  0,
  'a host is not a participant without an explicit participant row'
);
SELECT is(
  (SELECT count(*)::integer FROM public.participants
    WHERE party_id = '10000000-0000-4000-8000-000000000002'
      AND principal_id = '00000000-0000-4000-8000-000000000001'),
  1,
  'a host can be a player through an explicit participant row'
);
SELECT is(
  (SELECT count(*)::integer FROM public.participants
    WHERE party_id = '10000000-0000-4000-8000-000000000001'
      AND assigned_character_id IS NULL),
  1,
  'multiple unassigned participants are allowed'
);
SELECT is(
  (SELECT count(*)::integer FROM public.participants
    WHERE assigned_character_id = 'test-character-a'),
  2,
  'the same public character reference is valid in different parties'
);
DELETE FROM public.participants
WHERE id = '20000000-0000-4000-8000-000000000002';
INSERT INTO public.participants (id, party_id, principal_id, display_name, assigned_character_id)
VALUES (
  '20000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000006',
  'Replacement',
  'test-character-b'
);
SELECT is(
  (SELECT count(*)::integer FROM public.participants
    WHERE party_id = '10000000-0000-4000-8000-000000000001'
      AND principal_id = '00000000-0000-4000-8000-000000000006'),
  1,
  'trusted removal permits a replacement participant before any later lifecycle policy'
);

SELECT throws_ok(
  $$INSERT INTO public.parties (id, host_principal_id, mystery_id, mystery_version)
    VALUES ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', 'test-mystery', 'v1')$$,
  '23505',
  NULL,
  'party UUID primary keys reject duplicates'
);

SELECT throws_ok(
  $$INSERT INTO public.participants (party_id, principal_id, display_name)
    VALUES ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Duplicate')$$,
  '23505',
  NULL,
  'duplicate party/principal membership is rejected'
);
SELECT throws_ok(
  $$INSERT INTO public.participants (party_id, principal_id, display_name, assigned_character_id)
    VALUES ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', 'Duplicate role', 'test-character-a')$$,
  '23505',
  NULL,
  'duplicate character assignment in one party is rejected'
);
SELECT throws_ok(
  $$INSERT INTO public.participants (party_id, principal_id, display_name, assigned_character_id)
    VALUES ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', 'Cross-party', 'test-character-cross')$$,
  '23503',
  NULL,
  'a participant cannot be assigned a character absent from that party character reference set'
);
SELECT throws_ok(
  $$INSERT INTO public.participants (party_id, principal_id, display_name)
    VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff', '00000000-0000-4000-8000-000000000005', 'Missing party')$$,
  '23503',
  NULL,
  'participants require an existing party'
);
SELECT throws_ok(
  $$INSERT INTO public.participants (party_id, principal_id, display_name)
    VALUES ('10000000-0000-4000-8000-000000000001', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'Missing principal')$$,
  '23503',
  NULL,
  'participants require an existing authenticated principal'
);
SELECT throws_ok(
  $$INSERT INTO public.parties (host_principal_id, mystery_id, mystery_version, status)
    VALUES ('00000000-0000-4000-8000-000000000005', 'test-mystery', 'v1', 'STARTED')$$,
  '23514',
  NULL,
  'only the implemented LOBBY status is accepted'
);
SELECT throws_ok(
  $$INSERT INTO public.parties (host_principal_id, mystery_id, mystery_version)
    VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'test-mystery', 'v1')$$,
  '23503',
  NULL,
  'parties require an existing authenticated host principal'
);
SELECT throws_ok(
  $$INSERT INTO public.parties (host_principal_id, mystery_id, mystery_version, version)
    VALUES ('00000000-0000-4000-8000-000000000005', 'test-mystery', 'v1', -1)$$,
  '23514',
  NULL,
  'party versions cannot be negative'
);
SELECT throws_ok(
  $$UPDATE public.parties SET version = version - 1
    WHERE id = '10000000-0000-4000-8000-000000000001'$$,
  '23514',
  NULL,
  'party versions cannot decrease'
);
UPDATE public.parties
SET version = version + 1
WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT is(
  (SELECT version FROM public.parties WHERE id = '10000000-0000-4000-8000-000000000001'),
  1,
  'party versions can advance'
);
SELECT ok(
  (SELECT updated_at > created_at FROM public.parties WHERE id = '10000000-0000-4000-8000-000000000001'),
  'party updates refresh the update timestamp'
);
SELECT throws_ok(
  $$INSERT INTO public.invitation_credentials (party_id, verifier_hash)
    VALUES ('10000000-0000-4000-8000-000000000001', decode(repeat('b2', 32), 'hex'))$$,
  '23505',
  NULL,
  'a party cannot have multiple unrevoked reusable invitations'
);
UPDATE public.invitation_credentials
SET revoked_at = clock_timestamp()
WHERE party_id = '10000000-0000-4000-8000-000000000001';
INSERT INTO public.invitation_credentials (party_id, verifier_hash, expires_at)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  decode(repeat('d4', 32), 'hex'),
  clock_timestamp() + interval '1 day'
);
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_credentials
    WHERE party_id = '10000000-0000-4000-8000-000000000001'
      AND revoked_at IS NULL),
  1,
  'a revoked reusable invite can be replaced with a new verifier and expiry'
);
SELECT throws_ok(
  $$INSERT INTO public.invitation_credentials (party_id, verifier_hash)
    VALUES ('10000000-0000-4000-8000-000000000002', decode(repeat('c3', 31), 'hex'))$$,
  '23514',
  NULL,
  'invitation verifiers must be 32-byte hashes'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
SELECT is(
  auth.uid(),
  '00000000-0000-4000-8000-000000000001'::uuid,
  'the authenticated database role sees the simulated host principal'
);
SELECT throws_ok('SELECT * FROM public.parties', '42501', NULL, 'host cannot directly read party rows');
SELECT throws_ok('SELECT * FROM public.participants', '42501', NULL, 'host cannot directly read participant rows');
SELECT throws_ok('SELECT * FROM public.invitation_credentials', '42501', NULL, 'host cannot read invitation verifiers');
SELECT throws_ok(
  'UPDATE public.parties SET host_principal_id = auth.uid()',
  '42501',
  NULL,
  'host authority cannot be changed through a client table update'
);
SELECT throws_ok(
  'INSERT INTO public.participants (party_id, principal_id, display_name) VALUES (gen_random_uuid(), auth.uid(), ''Claimed'')',
  '42501',
  NULL,
  'a host cannot create its own participant authority through a client table insert'
);
SELECT throws_ok(
  'SELECT * FROM public.participants WHERE principal_id = auth.uid()',
  '42501',
  NULL,
  'a host who is a player in another party still has no direct participant authority'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
SELECT is(
  auth.uid(),
  '00000000-0000-4000-8000-000000000002'::uuid,
  'a separate authenticated guest principal is simulated'
);
SELECT throws_ok('SELECT * FROM public.participants', '42501', NULL, 'a guest cannot directly read their own or other participant rows');
SELECT throws_ok(
  $$SELECT * FROM public.participants
    WHERE id = '20000000-0000-4000-8000-000000000003'$$,
  '42501',
  NULL,
  'a guest cannot directly read a different participant in the same or another party'
);
SELECT throws_ok('SELECT * FROM public.parties', '42501', NULL, 'a guest cannot read party rows');
SELECT throws_ok('SELECT * FROM public.invitation_credentials', '42501', NULL, 'a guest cannot read invitation verifiers');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', true);
SELECT is(
  auth.uid(),
  '00000000-0000-4000-8000-000000000005'::uuid,
  'an unjoined principal is simulated independently'
);
SELECT throws_ok('SELECT * FROM public.parties', '42501', NULL, 'an unjoined principal cannot read parties');
SELECT throws_ok('SELECT * FROM public.participants', '42501', NULL, 'an unjoined principal cannot read participants');
SELECT throws_ok('SELECT * FROM public.invitation_credentials', '42501', NULL, 'an unjoined principal cannot read credentials');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT is(auth.uid(), NULL::uuid, 'the anonymous database role has no authenticated principal');
SELECT throws_ok('SELECT * FROM public.parties', '42501', NULL, 'anonymous role cannot read parties');
SELECT throws_ok('SELECT * FROM public.participants', '42501', NULL, 'anonymous role cannot read participants');
SELECT throws_ok('SELECT * FROM public.invitation_credentials', '42501', NULL, 'anonymous role cannot read invitation verifiers');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"service_role"}',
  true
);
SELECT is(current_user, 'authenticated', 'a JWT role claim cannot change the active database role');
SELECT throws_ok('SELECT * FROM public.invitation_credentials', '42501', NULL, 'a forged service-role claim does not expose credentials');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
