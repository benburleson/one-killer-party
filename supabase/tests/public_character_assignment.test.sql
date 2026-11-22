BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT no_plan();

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('00000000-0000-4000-8000-000000000201', 'authenticated', 'authenticated', 'assign-host-a@test.invalid'),
  ('00000000-0000-4000-8000-000000000202', 'authenticated', 'authenticated', 'assign-host-b@test.invalid'),
  ('00000000-0000-4000-8000-000000000203', 'authenticated', 'authenticated', 'assign-guest-a@test.invalid'),
  ('00000000-0000-4000-8000-000000000204', 'authenticated', 'authenticated', 'assign-guest-b@test.invalid'),
  ('00000000-0000-4000-8000-000000000205', 'authenticated', 'authenticated', 'assign-outsider@test.invalid');

SELECT * FROM public.create_host_party(
  '00000000-0000-4000-8000-000000000201',
  '10000000-0000-4000-8000-000000000201',
  decode(repeat('21', 32), 'hex')
);
SELECT * FROM public.create_host_party(
  '00000000-0000-4000-8000-000000000202',
  '10000000-0000-4000-8000-000000000202',
  decode(repeat('22', 32), 'hex')
);

INSERT INTO public.participants (id, party_id, principal_id, display_name) VALUES
  ('20000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000203', 'Guest A'),
  ('20000000-0000-4000-8000-000000000202', '10000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000204', 'Guest B'),
  ('20000000-0000-4000-8000-000000000203', '10000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000201', 'Playing host'),
  ('20000000-0000-4000-8000-000000000204', '10000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000205', 'Other party');

SELECT is(
  (SELECT count(*)::integer FROM public.party_character_refs
   WHERE party_id = '10000000-0000-4000-8000-000000000201'),
  8, 'new Blackwood parties register exactly eight public character IDs'
);
SELECT is(
  (SELECT pg_catalog.array_agg(character_id ORDER BY character_id)
   FROM public.party_character_refs WHERE party_id = '10000000-0000-4000-8000-000000000201'),
  ARRAY['arthur', 'clara', 'eleanor', 'julian', 'margot', 'sebastian', 'theodore', 'vivienne']::text[],
  'the registered roster contains only the approved playable IDs'
);
SELECT ok(
  (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog']
   FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.assign_public_character(uuid,uuid,uuid,text,integer,boolean)'::regprocedure),
  'assignment RPC is SECURITY DEFINER with a pinned search path'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.assign_public_character(uuid,uuid,uuid,text,integer,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.assign_public_character(uuid,uuid,uuid,text,integer,boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.assign_public_character(uuid,uuid,uuid,text,integer,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_guest_membership(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.get_guest_membership(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.get_guest_membership(uuid)', 'EXECUTE'),
  'only service_role can execute assignment and membership projections'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.parties', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.parties', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.participants', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.participants', 'SELECT'),
  'browser roles retain no direct access to party or participant tables'
);

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT * FROM public.assign_public_character(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000201',
    'vivienne', 0, false)$$,
  '42501', NULL, 'anon cannot assign a character'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT results_eq(
  $$SELECT * FROM public.assign_public_character(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000201',
    'vivienne', 0, false)$$,
  $$VALUES ('changed'::text, 1)$$,
  'host assigns a registered character'
);
SELECT results_eq(
  $$SELECT * FROM public.assign_public_character(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000201',
    'vivienne', 1, false)$$,
  $$VALUES ('unchanged'::text, 1)$$,
  'identical replay with the current version is an idempotent no-op'
);
SELECT results_eq(
  $$SELECT * FROM public.assign_public_character(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000202',
    'vivienne', 1, false)$$,
  $$VALUES ('occupied'::text, 1)$$,
  'an occupied character cannot be assigned twice'
);
SELECT results_eq(
  $$SELECT * FROM public.assign_public_character(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000202',
    'margot', 0, false)$$,
  $$VALUES ('conflict'::text, 1)$$,
  'stale party versions are rejected'
);
SELECT results_eq(
  $$SELECT * FROM public.assign_public_character(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000202',
    'margot', 1, false)$$,
  $$VALUES ('changed'::text, 2)$$,
  'a second participant can receive a different character'
);
SELECT results_eq(
  $$SELECT * FROM public.assign_public_character(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000202',
    'arthur', 2, false)$$,
  $$VALUES ('confirmation_required'::text, 2)$$,
  'reassignment requires explicit confirmation'
);
SELECT results_eq(
  $$SELECT * FROM public.assign_public_character(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000202',
    '20000000-0000-4000-8000-000000000202',
    'arthur', 2, true)$$,
  $$VALUES ('unavailable'::text, NULL::integer)$$,
  'another host cannot assign across parties'
);
SELECT results_eq(
  $$SELECT * FROM public.assign_public_character(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000204',
    'arthur', 2, true)$$,
  $$VALUES ('unavailable'::text, 2)$$,
  'a participant outside the party cannot be assigned'
);
SELECT results_eq(
  $$SELECT * FROM public.assign_public_character(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000202',
    'not-a-public-character', 2, true)$$,
  $$VALUES ('unavailable'::text, NULL::integer)$$,
  'unregistered character IDs are rejected'
);
SELECT results_eq(
  $$SELECT * FROM public.assign_public_character(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000202',
    'arthur', 2, true)$$,
  $$VALUES ('changed'::text, 3)$$,
  'confirmed reassignment increments the version'
);
SELECT results_eq(
  $$SELECT * FROM public.assign_public_character(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000202',
    '20000000-0000-4000-8000-000000000202',
    NULL, 3, false)$$,
  $$VALUES ('unavailable'::text, NULL::integer)$$,
  'a non-host cannot clear assignments'
);
SELECT results_eq(
  $$SELECT * FROM public.assign_public_character(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000202',
    NULL, 3, false)$$,
  $$VALUES ('confirmation_required'::text, 3)$$,
  'clearing an assignment requires explicit confirmation'
);
SELECT results_eq(
  $$SELECT * FROM public.assign_public_character(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000202',
    NULL, 3, true)$$,
  $$VALUES ('changed'::text, 4)$$,
  'confirmed clearing increments the version'
);
SELECT results_eq(
  $$SELECT * FROM public.assign_public_character(
    '00000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000203',
    'arthur', 4, false)$$,
  $$VALUES ('changed'::text, 5)$$,
  'an explicitly enrolled host can receive a public character'
);
SELECT results_eq(
  $$SELECT assigned_character_id, mystery_id, mystery_version
    FROM public.get_guest_membership('00000000-0000-4000-8000-000000000203')$$,
  $$VALUES ('vivienne'::text, 'blackwood-affair'::text, 'first-playtest-placeholder-v1'::text)$$,
  'guest projection returns only that principal’s public assignment and pinned package'
);
SELECT is(
  (SELECT count(*)::integer FROM public.get_guest_membership('00000000-0000-4000-8000-000000000204')),
  1, 'another guest receives only their own membership'
);
SELECT is(
  (SELECT count(*)::integer FROM public.list_host_participants(
    '00000000-0000-4000-8000-000000000202',
    '10000000-0000-4000-8000-000000000201')),
  0, 'another host cannot read the roster'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::integer FROM public.party_character_refs
   WHERE party_id = '10000000-0000-4000-8000-000000000201'
     AND character_id NOT IN (
       'vivienne', 'theodore', 'margot', 'arthur',
       'clara', 'julian', 'eleanor', 'sebastian'
     )),
     0, 'the party roster contains no unapproved character references'
);

SELECT * FROM finish();
ROLLBACK;
