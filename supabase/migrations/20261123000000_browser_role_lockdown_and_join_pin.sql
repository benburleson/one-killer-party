-- 1. Browser roles must hold no privilege on any object in the public schema.
--    The recovery-audit identity sequence inherited UPDATE (setval) for anon
--    and authenticated from the default ACL. Revoke it, and stop future
--    tables and sequences created by this role from inheriting browser grants.
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
-- Functions keep their explicit per-function REVOKE: a schema-scoped default
-- cannot remove the built-in PUBLIC execute grant.

-- 2. join_party returns the party's pinned mystery ID and version on a
--    successful join so the server no longer assumes the placeholder package.
--    The body is otherwise unchanged from 20261122000000_guest_membership.sql.
DROP FUNCTION public.join_party(uuid, bytea, text, bytea);

CREATE FUNCTION public.join_party(
  p_principal uuid,
  p_verifier_hash bytea,
  p_display_name text,
  p_rate_bucket_hash bytea
)
RETURNS TABLE (
  outcome text,
  party_id uuid,
  participant_id uuid,
  display_name text,
  status text,
  participant_count integer,
  mystery_id text,
  mystery_version text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_party_id uuid;
  v_party public.parties%ROWTYPE;
  v_participant public.participants%ROWTYPE;
BEGIN
  IF p_principal IS NULL OR p_verifier_hash IS NULL
    OR pg_catalog.octet_length(p_verifier_hash) <> 32
    OR p_display_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_display_name)) NOT BETWEEN 1 AND 50
    OR p_rate_bucket_hash IS NULL OR pg_catalog.octet_length(p_rate_bucket_hash) <> 32 THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer,
      NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT i.party_id INTO v_party_id
  FROM public.invitation_credentials AS i
  WHERE i.verifier_hash = p_verifier_hash
    AND i.revoked_at IS NULL
    AND (i.expires_at IS NULL OR i.expires_at > pg_catalog.clock_timestamp());
  IF NOT FOUND THEN
    PERFORM public.consume_lobby_rate_limit(p_rate_bucket_hash, 900, 20);
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer,
      NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT p.* INTO v_party FROM public.parties AS p WHERE p.id = v_party_id FOR UPDATE;
  IF NOT FOUND OR v_party.status <> 'LOBBY' THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer,
      NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT p.* INTO v_participant
  FROM public.participants AS p
  WHERE p.party_id = v_party_id AND p.principal_id = p_principal;
  IF FOUND THEN
    RETURN QUERY SELECT 'joined'::text, v_party_id, v_participant.id, v_participant.display_name,
      v_party.status, (SELECT pg_catalog.count(*)::integer FROM public.participants AS members WHERE members.party_id = v_party_id),
      v_party.mystery_id, v_party.mystery_version;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.removed_participants AS r
    WHERE r.party_id = v_party_id AND r.principal_id = p_principal
  ) THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer,
      NULL::text, NULL::text;
    RETURN;
  END IF;

  IF NOT public.consume_lobby_rate_limit(p_rate_bucket_hash, 900, 20) THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer,
      NULL::text, NULL::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.invitation_credentials AS i
    WHERE i.party_id = v_party_id AND i.verifier_hash = p_verifier_hash
      AND i.revoked_at IS NULL
      AND (i.expires_at IS NULL OR i.expires_at > pg_catalog.clock_timestamp())
  ) THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer,
      NULL::text, NULL::text;
    RETURN;
  END IF;

  IF v_party.mystery_id = 'blackwood-affair'
    AND (SELECT pg_catalog.count(*) FROM public.participants AS members WHERE members.party_id = v_party_id) >= 8 THEN
    RETURN QUERY SELECT 'full'::text, NULL::uuid, NULL::uuid, NULL::text, v_party.status,
      (SELECT pg_catalog.count(*)::integer FROM public.participants AS members WHERE members.party_id = v_party_id),
      NULL::text, NULL::text;
    RETURN;
  END IF;

  INSERT INTO public.participants (party_id, principal_id, display_name)
  VALUES (v_party_id, p_principal, pg_catalog.btrim(p_display_name))
  RETURNING * INTO v_participant;
  UPDATE public.parties SET version = version + 1 WHERE id = v_party_id;

  RETURN QUERY SELECT 'joined'::text, v_party_id, v_participant.id, v_participant.display_name,
    v_party.status, (SELECT pg_catalog.count(*)::integer FROM public.participants AS members WHERE members.party_id = v_party_id),
      v_party.mystery_id, v_party.mystery_version;
END;
$$;

REVOKE ALL ON FUNCTION public.join_party(uuid, bytea, text, bytea)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.join_party(uuid, bytea, text, bytea)
TO service_role;
