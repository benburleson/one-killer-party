CREATE TABLE public.parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_principal_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  mystery_id text NOT NULL CHECK (length(btrim(mystery_id)) > 0),
  mystery_version text NOT NULL CHECK (length(btrim(mystery_version)) > 0),
  status text NOT NULL DEFAULT 'LOBBY' CHECK (status = 'LOBBY'),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, mystery_id),
  CHECK (updated_at >= created_at)
);

CREATE FUNCTION public.enforce_party_update_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.mystery_id IS DISTINCT FROM OLD.mystery_id
    OR NEW.mystery_version IS DISTINCT FROM OLD.mystery_version THEN
    RAISE EXCEPTION 'party mystery reference cannot change'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.version < OLD.version THEN
    RAISE EXCEPTION 'party version cannot decrease'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER parties_enforce_update_invariants
BEFORE UPDATE ON public.parties
FOR EACH ROW
EXECUTE FUNCTION public.enforce_party_update_invariants();

CREATE TABLE public.party_character_refs (
  party_id uuid NOT NULL REFERENCES public.parties (id) ON DELETE CASCADE,
  character_id text NOT NULL CHECK (length(btrim(character_id)) > 0),
  PRIMARY KEY (party_id, character_id)
);

CREATE TABLE public.participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties (id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  assigned_character_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_id, principal_id),
  FOREIGN KEY (party_id, assigned_character_id)
    REFERENCES public.party_character_refs (party_id, character_id)
    ON DELETE RESTRICT
);

CREATE INDEX participants_principal_party_idx
  ON public.participants (principal_id, party_id);

CREATE UNIQUE INDEX participants_party_character_unique
  ON public.participants (party_id, assigned_character_id)
  WHERE assigned_character_id IS NOT NULL;

CREATE TABLE public.invitation_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties (id) ON DELETE CASCADE,
  verifier_hash bytea NOT NULL CHECK (octet_length(verifier_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  expires_at timestamptz,
  UNIQUE (verifier_hash),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE UNIQUE INDEX invitation_credentials_one_active_per_party
  ON public.invitation_credentials (party_id)
  WHERE revoked_at IS NULL;

CREATE INDEX invitation_credentials_party_idx
  ON public.invitation_credentials (party_id);

ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_character_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation_credentials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.parties,
  public.party_character_refs,
  public.participants,
  public.invitation_credentials
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.enforce_party_update_invariants()
FROM PUBLIC, anon, authenticated;
