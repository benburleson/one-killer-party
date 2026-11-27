-- The existing pin and membership RPCs are separate statements and cannot
-- provide one coherent authorization snapshot across concurrent mutations.
CREATE FUNCTION public.get_dossier_authorization_snapshot(p_party_id uuid, p_principal_id uuid)
RETURNS TABLE (
  party_id uuid, principal_id uuid, participant_id uuid, assigned_character_id text,
  status text, party_version integer, mystery_id text, mystery_version text,
  schema_version integer, digest_sha256 text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT p.id, m.principal_id, m.id, m.assigned_character_id, p.status, p.version,
    p.mystery_id, p.mystery_version, p.mystery_schema_version, p.mystery_digest_sha256
  FROM public.parties AS p
  JOIN public.participants AS m ON m.party_id = p.id
  WHERE p.id = p_party_id AND m.principal_id = p_principal_id;
$$;
REVOKE ALL ON FUNCTION public.get_dossier_authorization_snapshot(uuid, uuid)
  FROM PUBLIC, anon, authenticated, mystery_operator;
GRANT EXECUTE ON FUNCTION public.get_dossier_authorization_snapshot(uuid, uuid) TO service_role;
