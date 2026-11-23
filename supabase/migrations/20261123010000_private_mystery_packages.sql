BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mystery_operator') THEN
    CREATE ROLE mystery_operator NOLOGIN NOINHERIT;
  END IF;
END;
$$;
GRANT mystery_operator TO authenticator;

CREATE SCHEMA private_mystery;
REVOKE ALL ON SCHEMA private_mystery FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private_mystery TO mystery_operator;

CREATE TABLE private_mystery.published_versions (
  mystery_id text NOT NULL CHECK (mystery_id ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' AND length(mystery_id) <= 64),
  version text NOT NULL CHECK (version ~ '^[a-z0-9]+(?:[.-][a-z0-9]+)*$' AND length(version) <= 64),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  digest_sha256 text NOT NULL CHECK (digest_sha256 ~ '^[0-9a-f]{64}$'),
  object_path text NOT NULL,
  rule_set_id text NOT NULL CHECK (rule_set_id = 'eight-role-prototype-v1'),
  published_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  provenance text NOT NULL CHECK (provenance ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  approved_by text NOT NULL CHECK (approved_by ~ '^[A-Za-z0-9][A-Za-z0-9._@-]{0,79}$'),
  approval_reference text NOT NULL CHECK (approval_reference ~ '^[A-Za-z0-9][A-Za-z0-9._#:/-]{0,119}$'),
  PRIMARY KEY (mystery_id, version),
  UNIQUE (mystery_id, version, schema_version, digest_sha256),
  CHECK (object_path = mystery_id || '/' || version || '/' || digest_sha256 || '.json'),
  CHECK (NOT (mystery_id = 'blackwood-affair' AND version = 'first-playtest-placeholder-v1'))
);

ALTER TABLE private_mystery.published_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_mystery.published_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private_mystery.published_versions FROM PUBLIC, anon, authenticated, service_role, mystery_operator;

CREATE FUNCTION private_mystery.prevent_published_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'published mystery versions are immutable';
END;
$$;
REVOKE ALL ON FUNCTION private_mystery.prevent_published_version_mutation() FROM PUBLIC, anon, authenticated, service_role, mystery_operator;

CREATE TRIGGER published_versions_immutable
BEFORE UPDATE OR DELETE ON private_mystery.published_versions
FOR EACH ROW EXECUTE FUNCTION private_mystery.prevent_published_version_mutation();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('private-mystery-packages', 'private-mystery-packages', false, 1048576, ARRAY['application/json'])
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name, public = false, file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY private_mystery_packages_deny_browser_objects
ON storage.objects AS RESTRICTIVE
FOR ALL TO anon, authenticated
USING (bucket_id <> 'private-mystery-packages')
WITH CHECK (bucket_id <> 'private-mystery-packages');

CREATE POLICY private_mystery_packages_deny_browser_bucket_listing
ON storage.buckets AS RESTRICTIVE
FOR SELECT TO anon, authenticated
USING (id <> 'private-mystery-packages');

GRANT USAGE ON SCHEMA storage TO mystery_operator;
GRANT SELECT, INSERT ON storage.objects TO mystery_operator;
CREATE POLICY private_mystery_operator_read_objects
ON storage.objects FOR SELECT TO mystery_operator
USING (bucket_id = 'private-mystery-packages');
CREATE POLICY private_mystery_operator_insert_objects
ON storage.objects FOR INSERT TO mystery_operator
WITH CHECK (bucket_id = 'private-mystery-packages');

CREATE FUNCTION private_mystery.prevent_published_object_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.bucket_id = 'private-mystery-packages')
     OR (TG_OP = 'UPDATE' AND (
       OLD.bucket_id = 'private-mystery-packages' OR NEW.bucket_id = 'private-mystery-packages'
     )) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'published mystery objects are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION private_mystery.prevent_published_object_mutation() FROM PUBLIC, anon, authenticated, service_role, mystery_operator;

CREATE TRIGGER private_mystery_objects_immutable
BEFORE UPDATE OR DELETE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION private_mystery.prevent_published_object_mutation();

CREATE FUNCTION public.publish_mystery_version(
  p_mystery_id text,
  p_version text,
  p_schema_version integer,
  p_digest_sha256 text,
  p_object_path text,
  p_rule_set_id text,
  p_provenance text,
  p_approved_by text,
  p_approval_reference text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  existing private_mystery.published_versions%ROWTYPE;
  inserted_count integer;
BEGIN
  IF p_object_path <> p_mystery_id || '/' || p_version || '/' || p_digest_sha256 || '.json'
     OR p_rule_set_id <> 'eight-role-prototype-v1'
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects
       WHERE bucket_id = 'private-mystery-packages' AND name = p_object_path
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'mystery publication unavailable';
  END IF;

  INSERT INTO private_mystery.published_versions (
    mystery_id, version, schema_version, digest_sha256, object_path, rule_set_id,
    provenance, approved_by, approval_reference
  )
  VALUES (
    p_mystery_id, p_version, p_schema_version, p_digest_sha256, p_object_path, p_rule_set_id,
    p_provenance, p_approved_by, p_approval_reference
  )
  ON CONFLICT (mystery_id, version) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  SELECT * INTO existing FROM private_mystery.published_versions
  WHERE mystery_id = p_mystery_id AND version = p_version;

  IF existing.schema_version <> p_schema_version OR existing.digest_sha256 <> p_digest_sha256
     OR existing.object_path <> p_object_path OR existing.rule_set_id <> p_rule_set_id THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'mystery version conflict';
  END IF;
  RETURN CASE WHEN inserted_count = 1 THEN 'published' ELSE 'already_published' END;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_mystery_version(text, text, integer, text, text, text, text, text, text)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_mystery_version(text, text, integer, text, text, text, text, text, text)
TO mystery_operator;

CREATE FUNCTION public.get_published_mystery(
  p_mystery_id text,
  p_version text,
  p_schema_version integer,
  p_digest_sha256 text
)
RETURNS TABLE (
  mystery_id text,
  version text,
  schema_version integer,
  digest_sha256 text,
  object_path text,
  rule_set_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT registry.mystery_id, registry.version, registry.schema_version,
         registry.digest_sha256, registry.object_path, registry.rule_set_id
  FROM private_mystery.published_versions AS registry
  WHERE registry.mystery_id = p_mystery_id
    AND registry.version = p_version
    AND registry.schema_version = p_schema_version
    AND registry.digest_sha256 = p_digest_sha256
$$;
REVOKE ALL ON FUNCTION public.get_published_mystery(text, text, integer, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_published_mystery(text, text, integer, text)
TO service_role, mystery_operator;

COMMIT;
