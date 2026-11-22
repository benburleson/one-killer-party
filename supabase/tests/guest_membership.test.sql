BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT no_plan();

INSERT INTO auth.users (id, aud, role, email, is_anonymous) VALUES
  ('00000000-0000-4000-8000-000000000201', 'authenticated', 'authenticated', 'guest-host@test.invalid', false),
  ('00000000-0000-4000-8000-000000000202', 'authenticated', 'authenticated', NULL, true),
  ('00000000-0000-4000-8000-000000000203', 'authenticated', 'authenticated', NULL, true),
  ('00000000-0000-4000-8000-000000000204', 'authenticated', 'authenticated', NULL, true),
  ('00000000-0000-4000-8000-000000000205', 'authenticated', 'authenticated', NULL, true),
  ('00000000-0000-4000-8000-000000000206', 'authenticated', 'authenticated', NULL, true),
  ('00000000-0000-4000-8000-000000000207', 'authenticated', 'authenticated', NULL, true),
  ('00000000-0000-4000-8000-000000000208', 'authenticated', 'authenticated', NULL, true),
  ('00000000-0000-4000-8000-000000000209', 'authenticated', 'authenticated', NULL, true),
  ('00000000-0000-4000-8000-000000000210', 'authenticated', 'authenticated', NULL, true),
  ('00000000-0000-4000-8000-000000000212', 'authenticated', 'authenticated', NULL, true),
  ('00000000-0000-4000-8000-000000000213', 'authenticated', 'authenticated', NULL, true),
  ('00000000-0000-4000-8000-000000000211', 'authenticated', 'authenticated', 'other-host@test.invalid', false);

SELECT ok(
  (SELECT bool_and(relrowsecurity) FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN (
     'lobby_rate_limits', 'removed_participants',
     'participant_recovery_tokens', 'participant_recovery_audit'
   )),
  'new command tables keep RLS enabled'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.lobby_rate_limits', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.lobby_rate_limits', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.participant_recovery_tokens', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.participant_recovery_tokens', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.participant_recovery_audit', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.participant_recovery_audit', 'SELECT'),
  'browser table grants remain denied for rate limits and recovery data'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.join_party(uuid,bytea,text,bytea)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.join_party(uuid,bytea,text,bytea)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.join_party(uuid,bytea,text,bytea)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.redeem_participant_recovery(uuid,bytea,bytea)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.redeem_participant_recovery(uuid,bytea,bytea)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.redeem_participant_recovery(uuid,bytea,bytea)', 'EXECUTE'),
  'guest commands remain service-role only'
);

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT * FROM public.join_party(NULL, NULL, NULL, NULL)$$,
  '42501', NULL, 'anon cannot call the join command'
);
SELECT throws_ok(
  $$SELECT * FROM public.redeem_participant_recovery(NULL, NULL, NULL)$$,
  '42501', NULL, 'anon cannot call recovery'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT results_eq(
  $$SELECT * FROM public.create_host_party(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    decode(repeat('11', 32), 'hex'))$$,
  $$VALUES ('10000000-0000-4000-8000-000000000201'::uuid, true)$$,
  'test host creates a party with a stored invitation verifier'
);
RESET ROLE;

SELECT results_eq(
  $$SELECT outcome FROM public.join_party(
    '00000000-0000-4000-8000-000000000202',
    decode(repeat('11', 32), 'hex'), 'Alex',
    decode(repeat('21', 32), 'hex'))$$,
  $$VALUES ('joined'::text)$$,
  'first guest joins with the active reusable code'
);
SELECT results_eq(
  $$SELECT outcome FROM public.join_party(
    '00000000-0000-4000-8000-000000000203',
    decode(repeat('11', 32), 'hex'), 'Alex',
    decode(repeat('22', 32), 'hex'))$$,
  $$VALUES ('joined'::text)$$,
  'another independent guest can reuse the same code and duplicate name'
);
SELECT is(
  (SELECT count(*)::integer FROM public.participants
   WHERE party_id = '10000000-0000-4000-8000-000000000201'
     AND display_name = 'Alex'),
  2, 'duplicate names do not merge participant identities'
);
SELECT results_eq(
  $$SELECT display_name FROM public.join_party(
    '00000000-0000-4000-8000-000000000202',
    decode(repeat('11', 32), 'hex'), 'Changed',
    decode(repeat('23', 32), 'hex'))$$,
  $$VALUES ('Alex'::text)$$,
  'repeated submission returns the same principal membership without renaming it'
);
SELECT is(
  (SELECT count(*)::integer FROM public.participants
   WHERE party_id = '10000000-0000-4000-8000-000000000201'),
  2, 'same-principal retry does not add a participant'
);
SELECT results_eq(
  $$SELECT outcome FROM public.join_party(
    '00000000-0000-4000-8000-000000000204',
    decode(repeat('99', 32), 'hex'), 'Alex',
    decode(repeat('24', 32), 'hex'))$$,
  $$VALUES ('unavailable'::text)$$,
  'invalid codes fail with a generic unavailable outcome'
);
SELECT is(
  (SELECT request_count FROM public.lobby_rate_limits
   WHERE bucket_hash = decode(repeat('24', 32), 'hex')),
  1, 'invalid invite attempts are counted by the distributed rate limiter'
);
SELECT is(
  (SELECT pg_catalog.bool_and(joined.outcome = 'unavailable')
   FROM pg_catalog.generate_series(1, 20) AS attempts
   CROSS JOIN LATERAL public.join_party(
     '00000000-0000-4000-8000-000000000204',
     decode(repeat('99', 32), 'hex'), 'Alex',
     decode(repeat('24', 32), 'hex')) AS joined),
  true, 'invalid attempts remain generically unavailable after the rate limit'
);

SELECT results_eq(
  $$SELECT outcome FROM public.enroll_host_participant(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    'Playing host')$$,
  $$VALUES ('joined'::text)$$,
  'host is explicitly enrolled as a player'
);
SELECT is(
  (SELECT count(*)::integer FROM public.participants
   WHERE party_id = '10000000-0000-4000-8000-000000000201'),
  3, 'host enrollment adds one player only after explicit command'
);
SELECT results_eq(
  $$SELECT outcome FROM public.enroll_host_participant(
    '00000000-0000-4000-8000-000000000211',
    '10000000-0000-4000-8000-000000000201',
    'Unauthorized')$$,
  $$VALUES ('unavailable'::text)$$,
  'another host cannot enroll a player in this party'
);

SELECT results_eq(
  $$SELECT outcome FROM public.join_party('00000000-0000-4000-8000-000000000204', decode(repeat('11',32),'hex'), 'Guest 3', decode(repeat('44',32),'hex'))$$,
  $$VALUES ('joined'::text)$$, 'third guest joins');
SELECT results_eq(
  $$SELECT outcome FROM public.join_party('00000000-0000-4000-8000-000000000205', decode(repeat('11',32),'hex'), 'Guest 4', decode(repeat('25',32),'hex'))$$,
  $$VALUES ('joined'::text)$$, 'fourth guest joins');
SELECT results_eq(
  $$SELECT outcome FROM public.join_party('00000000-0000-4000-8000-000000000206', decode(repeat('11',32),'hex'), 'Guest 5', decode(repeat('26',32),'hex'))$$,
  $$VALUES ('joined'::text)$$, 'fifth guest joins');
SELECT results_eq(
  $$SELECT outcome FROM public.join_party('00000000-0000-4000-8000-000000000207', decode(repeat('11',32),'hex'), 'Guest 6', decode(repeat('27',32),'hex'))$$,
  $$VALUES ('joined'::text)$$, 'sixth guest joins');
SELECT results_eq(
  $$SELECT outcome FROM public.join_party('00000000-0000-4000-8000-000000000208', decode(repeat('11',32),'hex'), 'Guest 7', decode(repeat('28',32),'hex'))$$,
  $$VALUES ('joined'::text)$$, 'seventh guest fills the eighth slot');
SELECT results_eq(
  $$SELECT outcome FROM public.join_party('00000000-0000-4000-8000-000000000209', decode(repeat('11',32),'hex'), 'Guest 8', decode(repeat('29',32),'hex'))$$,
  $$VALUES ('full'::text)$$, 'ninth player is rejected at Blackwood capacity');
SELECT is(
  (SELECT count(*)::integer FROM public.participants
   WHERE party_id = '10000000-0000-4000-8000-000000000201'),
  8, 'capacity rejection leaves the eight existing memberships intact'
);

SELECT is(
  public.remove_host_participant(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    (SELECT id FROM public.participants
     WHERE party_id = '10000000-0000-4000-8000-000000000201'
       AND principal_id = '00000000-0000-4000-8000-000000000202')),
  true, 'host can remove a guest before the game starts'
);
SELECT results_eq(
  $$SELECT outcome FROM public.join_party(
    '00000000-0000-4000-8000-000000000202',
    decode(repeat('11', 32), 'hex'), 'Alex',
    decode(repeat('30', 32), 'hex'))$$,
  $$VALUES ('unavailable'::text)$$,
  'removed principal cannot restore membership by reloading and rejoining'
);
SELECT results_eq(
  $$SELECT outcome FROM public.join_party(
    '00000000-0000-4000-8000-000000000209',
    decode(repeat('11', 32), 'hex'), 'Replacement',
    decode(repeat('31', 32), 'hex'))$$,
  $$VALUES ('joined'::text)$$,
  'a fresh principal can use the released slot'
);

SELECT is(
  public.initiate_participant_recovery(
    '00000000-0000-4000-8000-000000000211',
    '10000000-0000-4000-8000-000000000201',
    (SELECT id FROM public.participants
     WHERE party_id = '10000000-0000-4000-8000-000000000201'
       AND principal_id = '00000000-0000-4000-8000-000000000203'),
    decode(repeat('cc', 32), 'hex'),
    decode(repeat('32', 32), 'hex')),
  false, 'a different host cannot issue a recovery credential'
);
SELECT is(
  public.initiate_participant_recovery(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    (SELECT id FROM public.participants
     WHERE party_id = '10000000-0000-4000-8000-000000000201'
       AND principal_id = '00000000-0000-4000-8000-000000000203'),
    decode(repeat('cc', 32), 'hex'),
    decode(repeat('33', 32), 'hex')),
  true, 'the verified host can initiate recovery for a current guest'
);
SELECT results_eq(
  $$SELECT outcome FROM public.redeem_participant_recovery(
    '00000000-0000-4000-8000-000000000210',
    decode(repeat('cc', 32), 'hex'),
    decode(repeat('34', 32), 'hex'))$$,
  $$VALUES ('recovered'::text)$$,
  'a new anonymous principal reclaims the original participant'
);
SELECT is(
  (SELECT count(*)::integer FROM public.participants
   WHERE party_id = '10000000-0000-4000-8000-000000000201'),
  8, 'recovery does not increase party capacity usage'
);
SELECT is(
  (SELECT count(*)::integer FROM public.participants
   WHERE party_id = '10000000-0000-4000-8000-000000000201'
     AND principal_id = '00000000-0000-4000-8000-000000000203'),
  0, 'old principal no longer authorizes the recovered membership'
);
SELECT results_eq(
  $$SELECT outcome FROM public.redeem_participant_recovery(
    '00000000-0000-4000-8000-000000000203',
    decode(repeat('cc', 32), 'hex'),
    decode(repeat('35', 32), 'hex'))$$,
  $$VALUES ('unavailable'::text)$$,
  'single-use recovery credential cannot be replayed'
);
SELECT is(
  public.initiate_participant_recovery(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    (SELECT id FROM public.participants
     WHERE party_id = '10000000-0000-4000-8000-000000000201'
       AND principal_id = '00000000-0000-4000-8000-000000000210'),
    decode(repeat('dd', 32), 'hex'),
    decode(repeat('36', 32), 'hex')),
  true, 'host can initiate a subsequent recovery'
);
SELECT is(
  public.initiate_participant_recovery(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    (SELECT id FROM public.participants
     WHERE party_id = '10000000-0000-4000-8000-000000000201'
       AND principal_id = '00000000-0000-4000-8000-000000000210'),
    decode(repeat('ee', 32), 'hex'),
    decode(repeat('37', 32), 'hex')),
  true, 'new recovery issuance revokes the previous outstanding token'
);
SELECT results_eq(
  $$SELECT outcome FROM public.redeem_participant_recovery(
    '00000000-0000-4000-8000-000000000212',
    decode(repeat('dd', 32), 'hex'),
    decode(repeat('38', 32), 'hex'))$$,
  $$VALUES ('unavailable'::text)$$,
  'revoked recovery credential fails generically'
);
SELECT results_eq(
  $$SELECT outcome FROM public.redeem_participant_recovery(
    '00000000-0000-4000-8000-000000000212',
    decode(repeat('ee', 32), 'hex'),
    decode(repeat('39', 32), 'hex'))$$,
  $$VALUES ('recovered'::text)$$,
  'replacement recovery token reclaims the same participant'
);
SELECT is(
  public.initiate_participant_recovery(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    (SELECT id FROM public.participants
     WHERE party_id = '10000000-0000-4000-8000-000000000201'
       AND principal_id = '00000000-0000-4000-8000-000000000204'),
    decode(repeat('ff', 32), 'hex'),
    decode(repeat('40', 32), 'hex')),
  true, 'host can initiate recovery for another current member'
);
UPDATE public.participant_recovery_tokens
SET created_at = now() - interval '1 day',
    expires_at = now() - interval '1 second'
WHERE verifier_hash = decode(repeat('ff', 32), 'hex');
SELECT results_eq(
  $$SELECT outcome FROM public.redeem_participant_recovery(
    '00000000-0000-4000-8000-000000000213',
    decode(repeat('ff', 32), 'hex'),
    decode(repeat('41', 32), 'hex'))$$,
  $$VALUES ('unavailable'::text)$$,
  'expired recovery credential fails generically'
);
SELECT is(
  (SELECT count(*)::integer FROM public.participant_recovery_audit
   WHERE party_id = '10000000-0000-4000-8000-000000000201'
     AND event IN ('initiated', 'consumed', 'removed')),
  7, 'recovery and removal create nonsecret audit entries'
);
SELECT is(
  (SELECT count(*)::integer FROM public.participant_recovery_tokens
   WHERE verifier_hash = decode(repeat('cc', 32), 'hex')
     AND consumed_at IS NOT NULL),
  1, 'only a verifier, not the bearer credential, is stored after redemption'
);
SELECT is(
  (SELECT count(*)::integer FROM public.get_guest_membership('00000000-0000-4000-8000-000000000212')),
  1, 'recovered principal reads only its own membership projection'
);
SELECT is(
  (SELECT count(*)::integer FROM public.get_guest_membership('00000000-0000-4000-8000-000000000203')),
  0, 'old principal cannot read the rebound membership'
);

SELECT is(public.consume_lobby_rate_limit(decode(repeat('ee', 32), 'hex'), 900, 2), true, 'rate bucket permits first request');
SELECT is(public.consume_lobby_rate_limit(decode(repeat('ee', 32), 'hex'), 900, 2), true, 'rate bucket permits request under limit');
SELECT is(public.consume_lobby_rate_limit(decode(repeat('ee', 32), 'hex'), 900, 2), false, 'rate bucket rejects requests over limit');

SELECT * FROM finish();
ROLLBACK;
