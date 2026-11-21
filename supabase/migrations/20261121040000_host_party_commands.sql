CREATE FUNCTION public.create_host_party(
  p_host uuid,
  p_party_id uuid,
  p_verifier_hash bytea
)
RETURNS TABLE (party_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_created_id uuid;
  v_existing_host uuid;
BEGIN
  IF p_host IS NULL OR p_party_id IS NULL OR p_verifier_hash IS NULL
    OR pg_catalog.octet_length(p_verifier_hash) <> 32 THEN
    RAISE EXCEPTION 'invalid host party arguments' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.parties (id, host_principal_id, mystery_id, mystery_version)
  VALUES (p_party_id, p_host, 'blackwood-affair', 'first-playtest-placeholder-v1')
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_created_id;

  IF v_created_id IS NOT NULL THEN
    INSERT INTO public.invitation_credentials (party_id, verifier_hash)
    VALUES (p_party_id, p_verifier_hash);
    RETURN QUERY SELECT p_party_id, true;
    RETURN;
  END IF;

  SELECT p.host_principal_id INTO v_existing_host
  FROM public.parties AS p
  WHERE p.id = p_party_id
  FOR UPDATE;

  IF NOT FOUND OR v_existing_host IS DISTINCT FROM p_host THEN
    RAISE EXCEPTION 'party unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT p_party_id, false;
END;
$$;

CREATE FUNCTION public.get_host_party(p_host uuid, p_party_id uuid)
RETURNS TABLE (party_id uuid, status text, version integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT p.id, p.status, p.version
  FROM public.parties AS p
  WHERE p.id = p_party_id AND p.host_principal_id = p_host;
$$;

CREATE FUNCTION public.list_host_parties(p_host uuid)
RETURNS TABLE (party_id uuid, status text, version integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT p.id, p.status, p.version
  FROM public.parties AS p
  WHERE p.host_principal_id = p_host;
$$;

CREATE FUNCTION public.rotate_host_invite(
  p_host uuid,
  p_party_id uuid,
  p_verifier_hash bytea,
  p_expected_version integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_version integer;
BEGIN
  IF p_verifier_hash IS NULL OR pg_catalog.octet_length(p_verifier_hash) <> 32 THEN
    RAISE EXCEPTION 'invalid invitation verifier' USING ERRCODE = '22023';
  END IF;

  SELECT p.version INTO v_version FROM public.parties AS p
  WHERE p.id = p_party_id AND p.host_principal_id = p_host
  FOR UPDATE;
  IF NOT FOUND OR v_version IS DISTINCT FROM p_expected_version THEN
    RETURN false;
  END IF;

  UPDATE public.invitation_credentials AS i
  SET revoked_at = pg_catalog.clock_timestamp()
  WHERE i.party_id = p_party_id AND i.revoked_at IS NULL;

  INSERT INTO public.invitation_credentials (party_id, verifier_hash)
  VALUES (p_party_id, p_verifier_hash);
  UPDATE public.parties AS p
  SET version = p.version + 1
  WHERE p.id = p_party_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.create_host_party(uuid, uuid, bytea),
  public.get_host_party(uuid, uuid),
  public.list_host_parties(uuid),
  public.rotate_host_invite(uuid, uuid, bytea, integer)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_host_party(uuid, uuid, bytea),
  public.get_host_party(uuid, uuid),
  public.list_host_parties(uuid),
  public.rotate_host_invite(uuid, uuid, bytea, integer)
TO service_role;
