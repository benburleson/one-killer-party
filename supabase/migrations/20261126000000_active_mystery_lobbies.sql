BEGIN;

-- A permanent row serializes creation with changes to the active reference,
-- including transitions from or to the absent state.
CREATE TABLE private_mystery.active_version (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mystery_id text,
  version text,
  schema_version integer,
  digest_sha256 text,
  CHECK (
    (mystery_id IS NULL AND version IS NULL AND schema_version IS NULL AND digest_sha256 IS NULL)
    OR
    (mystery_id IS NOT NULL AND version IS NOT NULL AND schema_version IS NOT NULL AND digest_sha256 IS NOT NULL)
  ),
  FOREIGN KEY (mystery_id, version, schema_version, digest_sha256)
    REFERENCES private_mystery.published_versions (mystery_id, version, schema_version, digest_sha256)
);
INSERT INTO private_mystery.active_version (singleton) VALUES (true);
ALTER TABLE private_mystery.active_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_mystery.active_version FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private_mystery.active_version FROM PUBLIC, anon, authenticated, service_role, mystery_operator;

CREATE FUNCTION private_mystery.protect_active_singleton()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'active version singleton cannot be removed' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER active_version_no_delete
BEFORE DELETE ON private_mystery.active_version
FOR EACH ROW EXECUTE FUNCTION private_mystery.protect_active_singleton();
REVOKE ALL ON FUNCTION private_mystery.protect_active_singleton()
  FROM PUBLIC, anon, authenticated, service_role, mystery_operator;

ALTER TABLE public.parties
  ADD COLUMN mystery_schema_version integer,
  ADD COLUMN mystery_digest_sha256 text,
  ADD CONSTRAINT parties_complete_mystery_pin CHECK (
    (mystery_id = 'blackwood-affair' AND mystery_version = 'first-playtest-placeholder-v1'
      AND mystery_schema_version IS NULL AND mystery_digest_sha256 IS NULL)
    OR
    (NOT (mystery_id = 'blackwood-affair' AND mystery_version = 'first-playtest-placeholder-v1')
      AND mystery_schema_version IS NOT NULL AND mystery_digest_sha256 IS NOT NULL)
  ),
  ADD CONSTRAINT parties_published_version_fk
    FOREIGN KEY (mystery_id, mystery_version, mystery_schema_version, mystery_digest_sha256)
    REFERENCES private_mystery.published_versions (mystery_id, version, schema_version, digest_sha256);

CREATE OR REPLACE FUNCTION public.enforce_party_update_invariants()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.mystery_id IS DISTINCT FROM OLD.mystery_id
    OR NEW.mystery_version IS DISTINCT FROM OLD.mystery_version
    OR NEW.mystery_schema_version IS DISTINCT FROM OLD.mystery_schema_version
    OR NEW.mystery_digest_sha256 IS DISTINCT FROM OLD.mystery_digest_sha256 THEN
    RAISE EXCEPTION 'party mystery reference cannot change' USING ERRCODE = '23514';
  END IF;
  IF NEW.version < OLD.version THEN
    RAISE EXCEPTION 'party version cannot decrease' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.get_active_mystery()
RETURNS TABLE (mystery_id text, version text, schema_version integer, digest_sha256 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT a.mystery_id, a.version, a.schema_version, a.digest_sha256
  FROM private_mystery.active_version AS a WHERE a.singleton;
$$;
REVOKE ALL ON FUNCTION public.get_active_mystery() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_mystery() TO service_role;

-- Old deployments may still create legacy parties only while activation is
-- absent. Keep the compatibility entry point, but never let it bypass an
-- active pointer. Existing retries are handled by the original implementation.
ALTER FUNCTION public.create_host_party(uuid, uuid, bytea)
  RENAME TO create_host_party_legacy_impl;
ALTER FUNCTION public.create_host_party_legacy_impl(uuid, uuid, bytea) SET SCHEMA private_mystery;
REVOKE ALL ON FUNCTION private_mystery.create_host_party_legacy_impl(uuid, uuid, bytea)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.create_host_party(p_host uuid, p_party_id uuid, p_verifier_hash bytea)
RETURNS TABLE (party_id uuid, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_host uuid;
  v_active private_mystery.active_version%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_party_id::text, 0));
  SELECT p.host_principal_id INTO v_host FROM public.parties AS p WHERE p.id = p_party_id;
  IF FOUND THEN
    IF v_host IS DISTINCT FROM p_host THEN
      RAISE EXCEPTION 'party unavailable' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT p_party_id, false;
    RETURN;
  END IF;
  SELECT * INTO v_active FROM private_mystery.active_version AS a WHERE a.singleton FOR SHARE;
  IF NOT FOUND OR v_active.mystery_id IS NOT NULL THEN
    RAISE EXCEPTION 'party unavailable' USING ERRCODE = '55000';
  END IF;
  RETURN QUERY SELECT * FROM private_mystery.create_host_party_legacy_impl(p_host, p_party_id, p_verifier_hash);
END;
$$;
REVOKE ALL ON FUNCTION public.create_host_party(uuid, uuid, bytea) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_host_party(uuid, uuid, bytea) TO service_role;

CREATE FUNCTION public.create_pinned_host_party(
  p_host uuid, p_party_id uuid, p_verifier_hash bytea,
  p_mystery_id text, p_version text, p_schema_version integer, p_digest_sha256 text,
  p_character_ids text[]
)
RETURNS TABLE (party_id uuid, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_host uuid;
  v_active private_mystery.active_version%ROWTYPE;
BEGIN
  IF p_host IS NULL OR p_party_id IS NULL OR p_verifier_hash IS NULL
     OR pg_catalog.octet_length(p_verifier_hash) <> 32 THEN
    RAISE EXCEPTION 'party unavailable' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_party_id::text, 0));
  SELECT p.host_principal_id INTO v_host FROM public.parties AS p WHERE p.id = p_party_id;
  IF FOUND THEN
    IF v_host IS DISTINCT FROM p_host THEN
      RAISE EXCEPTION 'party unavailable' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT p_party_id, false;
    RETURN;
  END IF;
  SELECT * INTO v_active FROM private_mystery.active_version AS a WHERE a.singleton FOR SHARE;
  IF NOT FOUND OR v_active.mystery_id IS DISTINCT FROM p_mystery_id
     OR v_active.version IS DISTINCT FROM p_version
     OR v_active.schema_version IS DISTINCT FROM p_schema_version
     OR v_active.digest_sha256 IS DISTINCT FROM p_digest_sha256 THEN
    RAISE EXCEPTION 'party unavailable' USING ERRCODE = '55000';
  END IF;
  IF v_active.mystery_id IS NULL THEN
    IF p_character_ids IS NOT NULL THEN
      RAISE EXCEPTION 'party unavailable' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT * FROM private_mystery.create_host_party_legacy_impl(p_host, p_party_id, p_verifier_hash);
    RETURN;
  END IF;
  IF pg_catalog.cardinality(p_character_ids) IS DISTINCT FROM 8
     OR (SELECT pg_catalog.count(DISTINCT id) FROM pg_catalog.unnest(p_character_ids) AS id) <> 8
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_character_ids) AS id
       WHERE id IS NULL OR pg_catalog.length(id) > 64 OR id !~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$') THEN
    RAISE EXCEPTION 'party unavailable' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.parties (id, host_principal_id, mystery_id, mystery_version, mystery_schema_version, mystery_digest_sha256)
  VALUES (p_party_id, p_host, p_mystery_id, p_version, p_schema_version, p_digest_sha256);
  INSERT INTO public.party_character_refs (party_id, character_id)
  SELECT p_party_id, id FROM pg_catalog.unnest(p_character_ids) AS id;
  INSERT INTO public.invitation_credentials (party_id, verifier_hash)
  VALUES (p_party_id, p_verifier_hash);
  RETURN QUERY SELECT p_party_id, true;
END;
$$;
REVOKE ALL ON FUNCTION public.create_pinned_host_party(uuid, uuid, bytea, text, text, integer, text, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pinned_host_party(uuid, uuid, bytea, text, text, integer, text, text[])
  TO service_role;

CREATE FUNCTION public.get_lobby_party_pin(p_party_id uuid, p_principal uuid)
RETURNS TABLE (mystery_id text, mystery_version text, schema_version integer, digest_sha256 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT p.mystery_id, p.mystery_version, p.mystery_schema_version, p.mystery_digest_sha256
  FROM public.parties AS p
  WHERE p.id = p_party_id AND p.status = 'LOBBY' AND (
    p.host_principal_id = p_principal OR EXISTS (
      SELECT 1 FROM public.participants AS m
      WHERE m.party_id = p.id AND m.principal_id = p_principal
    )
  );
$$;
REVOKE ALL ON FUNCTION public.get_lobby_party_pin(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_lobby_party_pin(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enroll_host_participant(p_host uuid, p_party_id uuid, p_display_name text)
RETURNS TABLE (outcome text, participant_id uuid, display_name text, participant_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_party public.parties%ROWTYPE;
  v_participant public.participants%ROWTYPE;
BEGIN
  IF p_display_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_display_name)) NOT BETWEEN 1 AND 50 THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::text, NULL::integer; RETURN;
  END IF;
  SELECT p.* INTO v_party FROM public.parties AS p
  WHERE p.id = p_party_id AND p.host_principal_id = p_host FOR UPDATE;
  IF NOT FOUND OR v_party.status <> 'LOBBY' THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::text, NULL::integer; RETURN;
  END IF;
  SELECT p.* INTO v_participant FROM public.participants AS p
  WHERE p.party_id = p_party_id AND p.principal_id = p_host;
  IF NOT FOUND THEN
    IF (SELECT pg_catalog.count(*) FROM public.participants AS m WHERE m.party_id = p_party_id) >= 8 THEN
      RETURN QUERY SELECT 'full'::text, NULL::uuid, NULL::text,
        (SELECT pg_catalog.count(*)::integer FROM public.participants AS m WHERE m.party_id = p_party_id); RETURN;
    END IF;
    INSERT INTO public.participants (party_id, principal_id, display_name)
    VALUES (p_party_id, p_host, pg_catalog.btrim(p_display_name)) RETURNING * INTO v_participant;
    UPDATE public.parties SET version = version + 1 WHERE id = p_party_id;
  END IF;
  RETURN QUERY SELECT 'joined'::text, v_participant.id, v_participant.display_name,
    (SELECT pg_catalog.count(*)::integer FROM public.participants AS m WHERE m.party_id = p_party_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_public_character(
  p_host uuid, p_party_id uuid, p_participant_id uuid, p_character_id text,
  p_expected_version integer, p_confirm_change boolean
)
RETURNS TABLE (outcome text, version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_party public.parties%ROWTYPE;
  v_current text;
BEGIN
  IF p_host IS NULL OR p_party_id IS NULL OR p_participant_id IS NULL
     OR p_expected_version IS NULL OR p_confirm_change IS NULL THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::integer; RETURN;
  END IF;
  SELECT p.* INTO v_party FROM public.parties AS p
  WHERE p.id = p_party_id AND p.host_principal_id = p_host FOR UPDATE;
  IF NOT FOUND OR v_party.status <> 'LOBBY' THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::integer; RETURN;
  END IF;
  IF v_party.version <> p_expected_version THEN
    RETURN QUERY SELECT 'conflict'::text, v_party.version; RETURN;
  END IF;
  SELECT m.assigned_character_id INTO v_current FROM public.participants AS m
  WHERE m.id = p_participant_id AND m.party_id = p_party_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'unavailable'::text, v_party.version; RETURN; END IF;
  IF v_current IS NOT DISTINCT FROM p_character_id THEN
    RETURN QUERY SELECT 'unchanged'::text, v_party.version; RETURN;
  END IF;
  IF v_current IS NOT NULL AND NOT p_confirm_change THEN
    RETURN QUERY SELECT 'confirmation_required'::text, v_party.version; RETURN;
  END IF;
  IF p_character_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.party_character_refs AS r WHERE r.party_id = p_party_id AND r.character_id = p_character_id
  ) THEN RETURN QUERY SELECT 'unavailable'::text, NULL::integer; RETURN; END IF;
  IF p_character_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.participants AS m
    WHERE m.party_id = p_party_id AND m.assigned_character_id = p_character_id AND m.id <> p_participant_id
  ) THEN RETURN QUERY SELECT 'occupied'::text, v_party.version; RETURN; END IF;
  BEGIN
    UPDATE public.participants AS m SET assigned_character_id = p_character_id
    WHERE m.id = p_participant_id AND m.party_id = p_party_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 'occupied'::text, v_party.version; RETURN;
  END;
  UPDATE public.parties AS p SET version = p.version + 1 WHERE p.id = p_party_id;
  RETURN QUERY SELECT 'changed'::text, v_party.version + 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_party(
  p_principal uuid, p_verifier_hash bytea, p_display_name text, p_rate_bucket_hash bytea
)
RETURNS TABLE (
  outcome text, party_id uuid, participant_id uuid, display_name text, status text,
  participant_count integer, mystery_id text, mystery_version text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_party_id uuid;
  v_party public.parties%ROWTYPE;
  v_participant public.participants%ROWTYPE;
BEGIN
  IF p_principal IS NULL OR p_verifier_hash IS NULL OR pg_catalog.octet_length(p_verifier_hash) <> 32
     OR p_display_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_display_name)) NOT BETWEEN 1 AND 50
     OR p_rate_bucket_hash IS NULL OR pg_catalog.octet_length(p_rate_bucket_hash) <> 32 THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer, NULL::text, NULL::text; RETURN;
  END IF;
  SELECT i.party_id INTO v_party_id FROM public.invitation_credentials AS i
  WHERE i.verifier_hash = p_verifier_hash AND i.revoked_at IS NULL
    AND (i.expires_at IS NULL OR i.expires_at > pg_catalog.clock_timestamp());
  IF NOT FOUND THEN
    PERFORM public.consume_lobby_rate_limit(p_rate_bucket_hash, 900, 20);
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer, NULL::text, NULL::text; RETURN;
  END IF;
  SELECT p.* INTO v_party FROM public.parties AS p WHERE p.id = v_party_id FOR UPDATE;
  IF NOT FOUND OR v_party.status <> 'LOBBY' THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer, NULL::text, NULL::text; RETURN;
  END IF;
  SELECT p.* INTO v_participant FROM public.participants AS p
  WHERE p.party_id = v_party_id AND p.principal_id = p_principal;
  IF FOUND THEN
    RETURN QUERY SELECT 'joined'::text, v_party_id, v_participant.id, v_participant.display_name,
      v_party.status, (SELECT pg_catalog.count(*)::integer FROM public.participants AS m WHERE m.party_id = v_party_id),
      v_party.mystery_id, v_party.mystery_version; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.removed_participants AS r
    WHERE r.party_id = v_party_id AND r.principal_id = p_principal) THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer, NULL::text, NULL::text; RETURN;
  END IF;
  IF NOT public.consume_lobby_rate_limit(p_rate_bucket_hash, 900, 20) THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer, NULL::text, NULL::text; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invitation_credentials AS i
    WHERE i.party_id = v_party_id AND i.verifier_hash = p_verifier_hash AND i.revoked_at IS NULL
      AND (i.expires_at IS NULL OR i.expires_at > pg_catalog.clock_timestamp())) THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer, NULL::text, NULL::text; RETURN;
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.participants AS m WHERE m.party_id = v_party_id) >= 8 THEN
    RETURN QUERY SELECT 'full'::text, NULL::uuid, NULL::uuid, NULL::text, v_party.status,
      (SELECT pg_catalog.count(*)::integer FROM public.participants AS m WHERE m.party_id = v_party_id),
      NULL::text, NULL::text; RETURN;
  END IF;
  INSERT INTO public.participants (party_id, principal_id, display_name)
  VALUES (v_party_id, p_principal, pg_catalog.btrim(p_display_name)) RETURNING * INTO v_participant;
  UPDATE public.parties SET version = version + 1 WHERE id = v_party_id;
  RETURN QUERY SELECT 'joined'::text, v_party_id, v_participant.id, v_participant.display_name,
    v_party.status, (SELECT pg_catalog.count(*)::integer FROM public.participants AS m WHERE m.party_id = v_party_id),
    v_party.mystery_id, v_party.mystery_version;
END;
$$;

COMMIT;
