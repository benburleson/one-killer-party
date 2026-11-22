INSERT INTO public.party_character_refs (party_id, character_id)
SELECT party.id, character.character_id
FROM public.parties AS party
CROSS JOIN (VALUES
  ('vivienne'), ('theodore'), ('margot'), ('arthur'),
  ('clara'), ('julian'), ('eleanor'), ('sebastian')
) AS character(character_id)
WHERE party.mystery_id = 'blackwood-affair'
  AND party.mystery_version = 'first-playtest-placeholder-v1'
ON CONFLICT (party_id, character_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_host_party(
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
    INSERT INTO public.party_character_refs (party_id, character_id)
    VALUES
      (p_party_id, 'vivienne'), (p_party_id, 'theodore'),
      (p_party_id, 'margot'), (p_party_id, 'arthur'),
      (p_party_id, 'clara'), (p_party_id, 'julian'),
      (p_party_id, 'eleanor'), (p_party_id, 'sebastian');
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

DROP FUNCTION public.list_host_participants(uuid, uuid);

CREATE FUNCTION public.list_host_participants(p_host uuid, p_party_id uuid)
RETURNS TABLE (
  participant_id uuid,
  display_name text,
  principal_id uuid,
  assigned_character_id text,
  party_version integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT member.id, member.display_name, member.principal_id,
    member.assigned_character_id, party.version
  FROM public.parties AS party
  JOIN public.participants AS member ON member.party_id = party.id
  WHERE party.id = p_party_id AND party.host_principal_id = p_host;
$$;

DROP FUNCTION public.get_guest_membership(uuid);

CREATE FUNCTION public.get_guest_membership(p_principal uuid)
RETURNS TABLE (
  party_id uuid,
  participant_id uuid,
  display_name text,
  status text,
  participant_count integer,
  assigned_character_id text,
  mystery_id text,
  mystery_version text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT member.party_id, member.id, member.display_name, party.status,
    (SELECT pg_catalog.count(*)::integer FROM public.participants AS all_members
      WHERE all_members.party_id = member.party_id),
    member.assigned_character_id, party.mystery_id, party.mystery_version
  FROM public.participants AS member
  JOIN public.parties AS party ON party.id = member.party_id
  WHERE member.principal_id = p_principal AND party.status = 'LOBBY';
$$;

CREATE FUNCTION public.assign_public_character(
  p_host uuid,
  p_party_id uuid,
  p_participant_id uuid,
  p_character_id text,
  p_expected_version integer,
  p_confirm_change boolean
)
RETURNS TABLE (outcome text, version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_party public.parties%ROWTYPE;
  v_current_character text;
BEGIN
  IF p_host IS NULL OR p_party_id IS NULL OR p_participant_id IS NULL
    OR p_expected_version IS NULL OR p_confirm_change IS NULL
    OR (p_character_id IS NOT NULL AND p_character_id NOT IN (
      'vivienne', 'theodore', 'margot', 'arthur',
      'clara', 'julian', 'eleanor', 'sebastian'
    )) THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::integer;
    RETURN;
  END IF;

  SELECT party.* INTO v_party
  FROM public.parties AS party
  WHERE party.id = p_party_id AND party.host_principal_id = p_host
  FOR UPDATE;
  IF NOT FOUND OR v_party.status <> 'LOBBY'
    OR v_party.mystery_id <> 'blackwood-affair'
    OR v_party.mystery_version <> 'first-playtest-placeholder-v1' THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::integer;
    RETURN;
  END IF;
  IF v_party.version <> p_expected_version THEN
    RETURN QUERY SELECT 'conflict'::text, v_party.version;
    RETURN;
  END IF;

  SELECT participant.assigned_character_id INTO v_current_character
  FROM public.participants AS participant
  WHERE participant.id = p_participant_id AND participant.party_id = p_party_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unavailable'::text, v_party.version;
    RETURN;
  END IF;

  IF v_current_character IS NOT DISTINCT FROM p_character_id THEN
    RETURN QUERY SELECT 'unchanged'::text, v_party.version;
    RETURN;
  END IF;
  IF v_current_character IS NOT NULL AND p_confirm_change IS NOT TRUE THEN
    RETURN QUERY SELECT 'confirmation_required'::text, v_party.version;
    RETURN;
  END IF;
  IF p_character_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.party_character_refs AS reference
    WHERE reference.party_id = p_party_id AND reference.character_id = p_character_id
  ) THEN
    RETURN QUERY SELECT 'unavailable'::text, v_party.version;
    RETURN;
  END IF;
  IF p_character_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.participants AS occupant
    WHERE occupant.party_id = p_party_id
      AND occupant.assigned_character_id = p_character_id
      AND occupant.id <> p_participant_id
  ) THEN
    RETURN QUERY SELECT 'occupied'::text, v_party.version;
    RETURN;
  END IF;

  BEGIN
    UPDATE public.participants AS participant
    SET assigned_character_id = p_character_id
    WHERE participant.id = p_participant_id AND participant.party_id = p_party_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 'occupied'::text, v_party.version;
    RETURN;
  END;

  UPDATE public.parties AS party
  SET version = party.version + 1
  WHERE party.id = p_party_id;
  RETURN QUERY SELECT 'changed'::text, v_party.version + 1;
END;
$$;

REVOKE ALL ON FUNCTION
  public.assign_public_character(uuid, uuid, uuid, text, integer, boolean)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.assign_public_character(uuid, uuid, uuid, text, integer, boolean)
TO service_role;

REVOKE ALL ON FUNCTION public.list_host_participants(uuid, uuid),
  public.get_guest_membership(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_host_participants(uuid, uuid),
  public.get_guest_membership(uuid)
TO service_role;
