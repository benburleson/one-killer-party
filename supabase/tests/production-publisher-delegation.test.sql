-- Disposable database only. These tests alter managed roles inside a transaction.
\set ON_ERROR_STOP on
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path TO public, extensions;
SELECT no_plan();
SELECT rolsuper AS can_test_managed_roles FROM pg_catalog.pg_roles WHERE rolname = current_user \gset
\if :can_test_managed_roles
CREATE ROLE cli_login_postgres LOGIN NOINHERIT;
GRANT postgres TO cli_login_postgres WITH SET TRUE, INHERIT FALSE;
GRANT mystery_operator TO postgres WITH SET FALSE, INHERIT FALSE;
GRANT authenticator TO postgres WITH SET TRUE;
GRANT mystery_operator TO authenticator WITH SET TRUE;

SELECT ok(
  pg_catalog.pg_has_role('cli_login_postgres', 'postgres', 'SET')
  AND pg_catalog.pg_has_role('cli_login_postgres', 'mystery_operator', 'SET')
  AND NOT pg_catalog.pg_has_role('cli_login_postgres', 'mystery_operator', 'USAGE'),
  'delegated administrator has effective SET, but not inherited operator privileges'
);
SAVEPOINT accepted_graph;
\ir production-publisher-hook-review.inc
ROLLBACK TO SAVEPOINT accepted_graph;
SELECT ok(pg_catalog.to_regclass('private_mystery.production_publisher_install') IS NULL,
  'verified managed graph installs successfully and test installation rolls back');

SAVEPOINT missing_admin;
REVOKE postgres FROM cli_login_postgres;
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set rejected :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT missing_admin;
SELECT is(:'rejected'::text, '42501'::text, 'named delegate without the admin grant is rejected');

SAVEPOINT no_set_admin;
GRANT postgres TO cli_login_postgres WITH SET FALSE;
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set rejected :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT no_set_admin;
SELECT is(:'rejected'::text, '42501'::text, 'delegate grant without SET is rejected');

SAVEPOINT inherited_admin;
GRANT postgres TO cli_login_postgres WITH INHERIT TRUE;
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set rejected :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT inherited_admin;
SELECT is(:'rejected'::text, '42501'::text, 'inherited admin grant is rejected');

SAVEPOINT missing_direct_operator;
REVOKE mystery_operator FROM postgres CASCADE;
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set rejected :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT missing_direct_operator;
SELECT is(:'rejected'::text, '42501'::text, 'missing direct postgres operator grant is rejected');

SAVEPOINT changed_operator_grant;
GRANT mystery_operator TO postgres WITH SET TRUE;
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set rejected :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT changed_operator_grant;
SELECT is(:'rejected'::text, '42501'::text, 'changed direct operator grant is rejected');

SAVEPOINT inherited_operator_grant;
GRANT mystery_operator TO postgres WITH INHERIT TRUE;
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set rejected :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT inherited_operator_grant;
SELECT is(:'rejected'::text, '42501'::text, 'inherited direct operator grant is rejected');

SAVEPOINT missing_effective_path;
GRANT authenticator TO postgres WITH SET FALSE;
SELECT ok(NOT pg_catalog.pg_has_role('cli_login_postgres', 'mystery_operator', 'SET'),
  'SET false on both operator paths does not confer effective SET');
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set rejected :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT missing_effective_path;
SELECT is(:'rejected'::text, '42501'::text, 'missing authenticator SET path is rejected');

SAVEPOINT forged_direct;
REVOKE postgres FROM cli_login_postgres;
GRANT mystery_operator TO cli_login_postgres;
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set rejected :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT forged_direct;
SELECT is(:'rejected'::text, '42501'::text, 'forged delegate name with direct operator grant is rejected');

SAVEPOINT extra_path;
GRANT authenticator TO cli_login_postgres WITH SET TRUE, INHERIT FALSE;
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set rejected :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT extra_path;
SELECT is(:'rejected'::text, '42501'::text, 'additional delegate path to operator is rejected');

SAVEPOINT direct_extra_path;
GRANT mystery_operator TO cli_login_postgres;
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set rejected :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT direct_extra_path;
SELECT is(:'rejected'::text, '42501'::text, 'additional direct operator grant is rejected');

SAVEPOINT rogue_admin_delegate;
CREATE ROLE synthetic_rogue_admin_member NOLOGIN;
GRANT postgres TO synthetic_rogue_admin_member;
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set rejected :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT rogue_admin_delegate;
SELECT is(:'rejected'::text, '42501'::text, 'another postgres delegate is not implicitly trusted');

SAVEPOINT changed_admin;
ALTER ROLE postgres NOBYPASSRLS;
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set rejected :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT changed_admin;
SELECT is(:'rejected'::text, '42501'::text, 'postgres without verified administrative attributes is rejected');

SAVEPOINT changed_delegate;
ALTER ROLE cli_login_postgres INHERIT;
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set rejected :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT changed_delegate;
SELECT is(:'rejected'::text, '42501'::text, 'delegate role attribute drift is rejected');

SAVEPOINT changed_delegate_login;
ALTER ROLE cli_login_postgres NOLOGIN;
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set rejected :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT changed_delegate_login;
SELECT is(:'rejected'::text, '42501'::text, 'delegate without LOGIN is rejected');

SAVEPOINT changed_operator;
ALTER ROLE mystery_operator CREATEROLE;
\set ON_ERROR_STOP off
\ir production-publisher-hook-review.inc
\set rejected :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT changed_operator;
SELECT is(:'rejected'::text, 'P0001'::text, 'privileged operator role attribute drift is rejected');
\else
\if :{?require_superuser}
DO $$ BEGIN RAISE EXCEPTION 'delegation tests require a disposable superuser'; END $$;
\else
SELECT skip('managed-role delegation tests require a disposable superuser connection');
\endif
\endif
CREATE TEMP TABLE publisher_delegation_finish ON COMMIT DROP AS SELECT * FROM finish();
TABLE publisher_delegation_finish;
DO $$
BEGIN
  IF (SELECT count(*) <> 1 OR NOT bool_and(finish ~ '^1\.\.[0-9]+$') FROM publisher_delegation_finish) THEN
    RAISE EXCEPTION 'publisher delegation pgTAP assertions failed';
  END IF;
END;
$$;
ROLLBACK;
