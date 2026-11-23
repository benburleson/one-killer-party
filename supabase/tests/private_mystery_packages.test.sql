BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT no_plan();

SELECT is(
  (SELECT public FROM storage.buckets WHERE id = 'private-mystery-packages'),
  false, 'the mystery package bucket is private'
);
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class WHERE oid = 'private_mystery.published_versions'::regclass),
  'the published registry forces row-level security'
);
SELECT ok(
  NOT pg_catalog.has_table_privilege('anon', 'private_mystery.published_versions', 'SELECT, INSERT, UPDATE, DELETE')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'private_mystery.published_versions', 'SELECT, INSERT, UPDATE, DELETE')
  AND NOT pg_catalog.has_table_privilege('service_role', 'private_mystery.published_versions', 'SELECT, INSERT, UPDATE, DELETE')
  AND NOT pg_catalog.has_table_privilege('mystery_operator', 'private_mystery.published_versions', 'SELECT, INSERT, UPDATE, DELETE'),
  'registry access is only through the narrow RPC boundary'
);
SELECT ok(
  pg_catalog.has_function_privilege('mystery_operator',
    'public.publish_mystery_version(text,text,integer,text,text,text,text,text,text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('service_role',
    'public.publish_mystery_version(text,text,integer,text,text,text,text,text,text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon',
    'public.publish_mystery_version(text,text,integer,text,text,text,text,text,text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated',
    'public.publish_mystery_version(text,text,integer,text,text,text,text,text,text)', 'EXECUTE'),
  'only the separate operator role can register a version'
);
SELECT ok(
  pg_catalog.has_function_privilege('service_role',
    'public.get_published_mystery(text,text,integer,text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon',
    'public.get_published_mystery(text,text,integer,text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated',
    'public.get_published_mystery(text,text,integer,text)', 'EXECUTE'),
  'only trusted server credentials can resolve a published reference'
);
SELECT ok(
  NOT pg_catalog.has_table_privilege('anon', 'storage.objects', 'SELECT, INSERT, UPDATE, DELETE')
  OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'private_mystery_packages_deny_browser_objects'
      AND permissive = 'RESTRICTIVE'
  ),
  'browser storage access is denied by grants or a restrictive package policy'
);
SELECT ok(
  NOT pg_catalog.has_table_privilege('mystery_operator', 'storage.objects', 'UPDATE, DELETE')
  AND pg_catalog.has_table_privilege('mystery_operator', 'storage.objects', 'SELECT, INSERT'),
  'operator storage access is limited to package read and create'
);

SELECT throws_ok(
  $$SELECT public.publish_mystery_version(
    'synthetic-orphan', 'test-v1', 1, repeat('a', 64),
    'synthetic-orphan/test-v1/' || repeat('a', 64) || '.json',
    'eight-role-prototype-v1', 'synthetic:test', 'operator', 'issue-45')$$,
  '22023', NULL, 'unregistered content requires a previously uploaded object'
);
SELECT is(
  (SELECT count(*)::integer FROM private_mystery.published_versions
   WHERE mystery_id = 'synthetic-orphan'),
  0, 'a failed registration leaves no published record'
);

INSERT INTO private_mystery.published_versions (
  mystery_id, version, schema_version, digest_sha256, object_path, rule_set_id,
  provenance, approved_by, approval_reference
) VALUES (
  'synthetic-registry-test', 'test-v1', 1, repeat('b', 64),
  'synthetic-registry-test/test-v1/' || repeat('b', 64) || '.json',
  'eight-role-prototype-v1', 'synthetic:test', 'operator', 'issue-45'
);
SELECT throws_ok(
  $$UPDATE private_mystery.published_versions SET digest_sha256 = repeat('c', 64)
    WHERE mystery_id = 'synthetic-registry-test' AND version = 'test-v1'$$,
  '55000', NULL, 'published registry rows cannot be changed'
);
SELECT throws_ok(
  $$DELETE FROM private_mystery.published_versions
    WHERE mystery_id = 'synthetic-registry-test' AND version = 'test-v1'$$,
  '55000', NULL, 'published registry rows cannot be deleted'
);
SELECT throws_ok(
  $$INSERT INTO private_mystery.published_versions (
      mystery_id, version, schema_version, digest_sha256, object_path, rule_set_id,
      provenance, approved_by, approval_reference
    ) VALUES (
      'synthetic-registry-test', 'test-v1', 1, repeat('c', 64),
      'synthetic-registry-test/test-v1/' || repeat('c', 64) || '.json',
      'eight-role-prototype-v1', 'synthetic:test', 'operator', 'issue-45'
    )$$,
  '23505', NULL, 'a published version identity cannot be republished with another digest'
);
SELECT throws_ok(
  $$INSERT INTO private_mystery.published_versions (
      mystery_id, version, schema_version, digest_sha256, object_path, rule_set_id,
      provenance, approved_by, approval_reference
    ) VALUES (
      'blackwood-affair', 'first-playtest-placeholder-v1', 1, repeat('d', 64),
      'blackwood-affair/first-playtest-placeholder-v1/' || repeat('d', 64) || '.json',
      'eight-role-prototype-v1', 'synthetic:test', 'operator', 'issue-45'
    )$$,
  '23514', NULL, 'the legacy placeholder identity cannot be published'
);

SELECT is(
  (SELECT count(*)::integer FROM public.get_published_mystery(
    'synthetic-orphan', 'test-v1', 1, repeat('a', 64))),
  0, 'unregistered and orphaned objects are unavailable by exact reference'
);

SELECT * FROM finish();
ROLLBACK;
