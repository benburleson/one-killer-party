BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT no_plan();

-- Catalog-wide deny-by-default guards. These cover every current and future
-- object in the public schema, so a later migration cannot add a table or RPC
-- that silently skips RLS, grants, or a pinned search path.

SELECT ok(
  (SELECT count(*) FROM pg_catalog.pg_class AS c
   JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')) >= 8,
  'the public schema contains the lobby tables under test'
);
SELECT is(
  (SELECT pg_catalog.string_agg(c.relname, ', ' ORDER BY c.relname)
   FROM pg_catalog.pg_class AS c
   JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity),
  NULL, 'every public table has row-level security enabled'
);
SELECT is(
  (SELECT pg_catalog.string_agg(policy.tablename || '.' || policy.policyname, ', ')
   FROM pg_catalog.pg_policies AS policy WHERE policy.schemaname = 'public'),
  NULL, 'no public table has a browser-facing RLS policy'
);
SELECT is(
  (SELECT pg_catalog.string_agg(
     browser.rolname || ':' || privilege.name || ':' || c.relname, ', '
     ORDER BY c.relname, browser.rolname, privilege.name)
   FROM pg_catalog.pg_class AS c
   JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
   CROSS JOIN (VALUES ('anon'), ('authenticated')) AS browser(rolname)
   CROSS JOIN (VALUES
     ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
     ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
   ) AS privilege(name)
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND pg_catalog.has_table_privilege(browser.rolname, c.oid, privilege.name)),
  NULL, 'browser roles hold no privilege on any public table or view'
);
SELECT is(
  (SELECT pg_catalog.string_agg(
     browser.rolname || ':' || privilege.name || ':' || c.relname, ', '
     ORDER BY c.relname, browser.rolname, privilege.name)
   FROM pg_catalog.pg_class AS c
   JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
   CROSS JOIN (VALUES ('anon'), ('authenticated')) AS browser(rolname)
   CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS privilege(name)
   WHERE n.nspname = 'public' AND c.relkind = 'S'
     AND pg_catalog.has_sequence_privilege(browser.rolname, c.oid, privilege.name)),
  NULL, 'browser roles hold no privilege on any public sequence'
);

-- Objects created by a later migration must not inherit browser grants.
CREATE TABLE public.default_privilege_probe (id bigserial PRIMARY KEY);
SELECT ok(
  NOT pg_catalog.has_table_privilege('anon', 'public.default_privilege_probe',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.default_privilege_probe',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
  'a newly created public table grants nothing to browser roles by default'
);
SELECT ok(
  NOT pg_catalog.has_sequence_privilege('anon', 'public.default_privilege_probe_id_seq', 'USAGE, SELECT, UPDATE')
  AND NOT pg_catalog.has_sequence_privilege('authenticated', 'public.default_privilege_probe_id_seq', 'USAGE, SELECT, UPDATE'),
  'a newly created public sequence grants nothing to browser roles by default'
);
DROP TABLE public.default_privilege_probe;

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT pg_catalog.setval('public.participant_recovery_audit_id_seq', 5)$$,
  '42501', NULL, 'the anonymous role cannot reset the audit sequence');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT pg_catalog.setval('public.participant_recovery_audit_id_seq', 5)$$,
  '42501', NULL, 'the authenticated role cannot reset the audit sequence');
RESET ROLE;

SELECT ok(
  (SELECT count(*) FROM pg_catalog.pg_proc AS p
   JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public') >= 14,
  'the public schema contains the lobby functions under test'
);
SELECT is(
  (SELECT pg_catalog.string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.proname)
   FROM pg_catalog.pg_proc AS p
   JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
       OR EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(
           coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
         WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'))),
  NULL, 'no public function is executable by PUBLIC or a browser role'
);
SELECT is(
  (SELECT pg_catalog.string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.proname)
   FROM pg_catalog.pg_proc AS p
   JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND NOT coalesce(p.proconfig @> ARRAY['search_path=pg_catalog'], false)),
  NULL, 'every public function pins search_path to pg_catalog'
);
SELECT is(
  (SELECT pg_catalog.string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.proname)
   FROM pg_catalog.pg_proc AS p
   JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prorettype <> 'pg_catalog.trigger'::regtype
     AND NOT (p.prosecdef
       AND CASE WHEN p.proname = 'publish_mystery_version'
         THEN pg_catalog.has_function_privilege('mystery_operator', p.oid, 'EXECUTE')
         ELSE pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
       END)),
  NULL, 'every public RPC is SECURITY DEFINER and limited to its trusted role'
);

-- Cross-host and cross-party negative authorization for the roster commands.
INSERT INTO auth.users (id, aud, role, email, is_anonymous) VALUES
  ('00000000-0000-4000-8000-000000000401', 'authenticated', 'authenticated', 'invariant-host-a@test.invalid', false),
  ('00000000-0000-4000-8000-000000000402', 'authenticated', 'authenticated', 'invariant-host-b@test.invalid', false),
  ('00000000-0000-4000-8000-000000000403', 'authenticated', 'authenticated', NULL, true),
  ('00000000-0000-4000-8000-000000000404', 'authenticated', 'authenticated', NULL, true),
  ('00000000-0000-4000-8000-000000000405', 'authenticated', 'authenticated', NULL, true);

SELECT results_eq(
  $$SELECT created FROM public.create_host_party(
    '00000000-0000-4000-8000-000000000401',
    '10000000-0000-4000-8000-000000000401', decode(repeat('a1', 32), 'hex'))$$,
  $$VALUES (true)$$, 'host A creates party A'
);
SELECT results_eq(
  $$SELECT created FROM public.create_host_party(
    '00000000-0000-4000-8000-000000000402',
    '10000000-0000-4000-8000-000000000402', decode(repeat('b2', 32), 'hex'))$$,
  $$VALUES (true)$$, 'host B creates party B'
);
SELECT results_eq(
  $$SELECT outcome, party_id, mystery_id, mystery_version FROM public.join_party(
    '00000000-0000-4000-8000-000000000403', decode(repeat('a1', 32), 'hex'),
    'Guest A', decode(repeat('c1', 32), 'hex'))$$,
  $$VALUES ('joined'::text, '10000000-0000-4000-8000-000000000401'::uuid,
    'blackwood-affair'::text, 'first-playtest-placeholder-v1'::text)$$,
  'a successful join returns the party''s own pinned mystery ID and version'
);
SELECT results_eq(
  $$SELECT outcome, mystery_id, mystery_version FROM public.join_party(
    '00000000-0000-4000-8000-000000000403', decode(repeat('a1', 32), 'hex'),
    'Guest A', decode(repeat('c1', 32), 'hex'))$$,
  $$VALUES ('joined'::text, 'blackwood-affair'::text, 'first-playtest-placeholder-v1'::text)$$,
  'an idempotent repeat join returns the same pin'
);
SELECT results_eq(
  $$SELECT outcome, party_id, mystery_id, mystery_version FROM public.join_party(
    '00000000-0000-4000-8000-000000000405', decode(repeat('ff', 32), 'hex'),
    'Nobody', decode(repeat('c3', 32), 'hex'))$$,
  $$VALUES ('unavailable'::text, NULL::uuid, NULL::text, NULL::text)$$,
  'a rejected join discloses no party or package identifier'
);
SELECT results_eq(
  $$SELECT outcome FROM public.join_party(
    '00000000-0000-4000-8000-000000000404', decode(repeat('b2', 32), 'hex'),
    'Guest B', decode(repeat('c2', 32), 'hex'))$$,
  $$VALUES ('joined'::text)$$, 'guest B joins party B'
);
SELECT results_eq(
  $$SELECT outcome FROM public.enroll_host_participant(
    '00000000-0000-4000-8000-000000000401',
    '10000000-0000-4000-8000-000000000401', 'Host A')$$,
  $$VALUES ('joined'::text)$$, 'host A enrolls as a player in party A'
);

CREATE TEMPORARY TABLE invariant_ids ON COMMIT DROP AS
SELECT
  (SELECT id FROM public.participants
   WHERE principal_id = '00000000-0000-4000-8000-000000000403') AS guest_a,
  (SELECT id FROM public.participants
   WHERE principal_id = '00000000-0000-4000-8000-000000000404') AS guest_b,
  (SELECT id FROM public.participants
   WHERE principal_id = '00000000-0000-4000-8000-000000000401') AS host_a_player,
  (SELECT version FROM public.parties
   WHERE id = '10000000-0000-4000-8000-000000000401') AS party_a_version,
  (SELECT version FROM public.parties
   WHERE id = '10000000-0000-4000-8000-000000000402') AS party_b_version;

SELECT is_empty(
  $$SELECT * FROM public.list_host_participants(
    '00000000-0000-4000-8000-000000000402', '10000000-0000-4000-8000-000000000401')$$,
  'another host cannot list a party roster'
);
SELECT is_empty(
  $$SELECT * FROM public.list_host_participants(
    '00000000-0000-4000-8000-000000000403', '10000000-0000-4000-8000-000000000401')$$,
  'a guest principal cannot list its own party roster through the host RPC'
);
SELECT is_empty(
  $$SELECT * FROM public.get_host_party(
    '00000000-0000-4000-8000-000000000403', '10000000-0000-4000-8000-000000000401')$$,
  'a guest principal cannot read host party metadata'
);
SELECT is(
  public.remove_host_participant(
    '00000000-0000-4000-8000-000000000402',
    '10000000-0000-4000-8000-000000000401',
    (SELECT guest_a FROM invariant_ids)),
  false, 'another host cannot remove a participant'
);
SELECT is(
  public.remove_host_participant(
    '00000000-0000-4000-8000-000000000402',
    '10000000-0000-4000-8000-000000000402',
    (SELECT guest_a FROM invariant_ids)),
  false, 'a host cannot remove another party''s participant through its own party ID'
);
SELECT is(
  public.remove_host_participant(
    '00000000-0000-4000-8000-000000000403',
    '10000000-0000-4000-8000-000000000401',
    (SELECT guest_a FROM invariant_ids)),
  false, 'a guest cannot remove participants'
);
SELECT is(
  public.remove_host_participant(
    '00000000-0000-4000-8000-000000000401',
    '10000000-0000-4000-8000-000000000401',
    (SELECT host_a_player FROM invariant_ids)),
  false, 'the host cannot remove their own player membership through guest removal'
);
SELECT is(
  public.initiate_participant_recovery(
    '00000000-0000-4000-8000-000000000402',
    '10000000-0000-4000-8000-000000000402',
    (SELECT guest_a FROM invariant_ids),
    decode(repeat('d1', 32), 'hex'), decode(repeat('e1', 32), 'hex')),
  false, 'a host cannot issue recovery for another party''s participant through its own party ID'
);
SELECT is(
  public.initiate_participant_recovery(
    '00000000-0000-4000-8000-000000000401',
    '10000000-0000-4000-8000-000000000401',
    (SELECT host_a_player FROM invariant_ids),
    decode(repeat('d2', 32), 'hex'), decode(repeat('e2', 32), 'hex')),
  false, 'recovery cannot be issued for the host''s own player membership'
);
SELECT results_eq(
  $$SELECT outcome FROM public.assign_public_character(
    '00000000-0000-4000-8000-000000000402',
    '10000000-0000-4000-8000-000000000402',
    (SELECT guest_a FROM invariant_ids), 'vivienne',
    (SELECT party_b_version FROM invariant_ids), false)$$,
  $$VALUES ('unavailable'::text)$$,
  'a host cannot assign another party''s participant through its own party ID'
);
SELECT results_eq(
  $$SELECT outcome FROM public.enroll_host_participant(
    '00000000-0000-4000-8000-000000000403',
    '10000000-0000-4000-8000-000000000401', 'Impostor')$$,
  $$VALUES ('unavailable'::text)$$,
  'a guest cannot use host enrollment'
);

SELECT is(
  (SELECT count(*)::integer FROM public.participant_recovery_tokens),
  0, 'rejected recovery requests store no credential'
);
SELECT is(
  (SELECT count(*)::integer FROM public.participants
   WHERE party_id IN ('10000000-0000-4000-8000-000000000401', '10000000-0000-4000-8000-000000000402')),
  3, 'rejected commands leave both rosters intact'
);
SELECT is(
  (SELECT count(*)::integer FROM public.participants WHERE assigned_character_id IS NOT NULL),
  0, 'rejected commands assign no character'
);
SELECT is(
  (SELECT ARRAY[
     (SELECT version FROM public.parties WHERE id = '10000000-0000-4000-8000-000000000401'),
     (SELECT version FROM public.parties WHERE id = '10000000-0000-4000-8000-000000000402')]),
  (SELECT ARRAY[party_a_version, party_b_version] FROM invariant_ids),
  'rejected commands do not advance either party version'
);

-- A recovery credential for party A must not rebind a principal who already
-- holds a membership in that same party, and never crosses into party B.
SELECT is(
  public.initiate_participant_recovery(
    '00000000-0000-4000-8000-000000000401',
    '10000000-0000-4000-8000-000000000401',
    (SELECT guest_a FROM invariant_ids),
    decode(repeat('d3', 32), 'hex'), decode(repeat('e3', 32), 'hex')),
  true, 'the owning host can issue recovery for its own guest'
);
SELECT results_eq(
  $$SELECT outcome FROM public.redeem_participant_recovery(
    '00000000-0000-4000-8000-000000000401',
    decode(repeat('d3', 32), 'hex'), decode(repeat('e4', 32), 'hex'))$$,
  $$VALUES ('unavailable'::text)$$,
  'a non-anonymous host principal cannot redeem a guest recovery credential'
);
SELECT results_eq(
  $$SELECT outcome, party_id FROM public.redeem_participant_recovery(
    '00000000-0000-4000-8000-000000000404',
    decode(repeat('d3', 32), 'hex'), decode(repeat('e5', 32), 'hex'))$$,
  $$VALUES ('recovered'::text, '10000000-0000-4000-8000-000000000401'::uuid)$$,
  'redemption binds only to the credential''s own party'
);
SELECT is(
  (SELECT count(*)::integer FROM public.participants
   WHERE party_id = '10000000-0000-4000-8000-000000000402'
     AND principal_id = '00000000-0000-4000-8000-000000000404'),
  1, 'redeeming in party A leaves the principal''s party B membership unchanged'
);
SELECT results_eq(
  $$SELECT party_id FROM public.get_guest_membership('00000000-0000-4000-8000-000000000403')$$,
  $$SELECT NULL::uuid WHERE false$$,
  'the replaced principal resolves no membership'
);

SELECT * FROM finish();
ROLLBACK;
