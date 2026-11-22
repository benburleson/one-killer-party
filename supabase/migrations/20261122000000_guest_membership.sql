CREATE TABLE public.lobby_rate_limits (
  bucket_hash bytea PRIMARY KEY CHECK (octet_length(bucket_hash) = 32),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0)
);

CREATE TABLE public.removed_participants (
  party_id uuid NOT NULL REFERENCES public.parties (id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  removed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (party_id, principal_id)
);

CREATE TABLE public.participant_recovery_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties (id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.participants (id) ON DELETE CASCADE,
  verifier_hash bytea NOT NULL UNIQUE CHECK (octet_length(verifier_hash) = 32),
  created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX participant_recovery_tokens_participant_idx
  ON public.participant_recovery_tokens (participant_id);

CREATE TABLE public.participant_recovery_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  party_id uuid NOT NULL REFERENCES public.parties (id) ON DELETE CASCADE,
  participant_id uuid NOT NULL,
  actor_principal_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  event text NOT NULL CHECK (event IN ('initiated', 'consumed', 'removed')),
  previous_principal_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  new_principal_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lobby_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.removed_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participant_recovery_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participant_recovery_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.lobby_rate_limits,
  public.removed_participants,
  public.participant_recovery_tokens,
  public.participant_recovery_audit
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.consume_lobby_rate_limit(
  p_bucket_hash bytea,
  p_window_seconds integer,
  p_max_requests integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_count integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_bucket_hash IS NULL OR pg_catalog.octet_length(p_bucket_hash) <> 32
    OR p_window_seconds NOT BETWEEN 1 AND 3600
    OR p_max_requests NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid rate limit arguments' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.lobby_rate_limits (bucket_hash, window_started_at, request_count)
  VALUES (p_bucket_hash, v_now, 1)
  ON CONFLICT (bucket_hash) DO UPDATE SET
    window_started_at = CASE
      WHEN public.lobby_rate_limits.window_started_at <=
        v_now - pg_catalog.make_interval(secs => p_window_seconds)
      THEN v_now ELSE public.lobby_rate_limits.window_started_at END,
    request_count = CASE
      WHEN public.lobby_rate_limits.window_started_at <=
        v_now - pg_catalog.make_interval(secs => p_window_seconds)
      THEN 1 ELSE public.lobby_rate_limits.request_count + 1 END
  RETURNING request_count INTO v_count;

  DELETE FROM public.lobby_rate_limits
  WHERE window_started_at < v_now - interval '1 day';

  RETURN v_count <= p_max_requests;
END;
$$;

CREATE FUNCTION public.join_party(
  p_principal uuid,
  p_verifier_hash bytea,
  p_display_name text,
  p_rate_bucket_hash bytea
)
RETURNS TABLE (outcome text, party_id uuid, participant_id uuid, display_name text, status text, participant_count integer)
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
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  SELECT i.party_id INTO v_party_id
  FROM public.invitation_credentials AS i
  WHERE i.verifier_hash = p_verifier_hash
    AND i.revoked_at IS NULL
    AND (i.expires_at IS NULL OR i.expires_at > pg_catalog.clock_timestamp());
  IF NOT FOUND THEN
    PERFORM public.consume_lobby_rate_limit(p_rate_bucket_hash, 900, 20);
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  SELECT p.* INTO v_party FROM public.parties AS p WHERE p.id = v_party_id FOR UPDATE;
  IF NOT FOUND OR v_party.status <> 'LOBBY' THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  SELECT p.* INTO v_participant
  FROM public.participants AS p
  WHERE p.party_id = v_party_id AND p.principal_id = p_principal;
  IF FOUND THEN
    RETURN QUERY SELECT 'joined'::text, v_party_id, v_participant.id, v_participant.display_name,
      v_party.status, (SELECT pg_catalog.count(*)::integer FROM public.participants AS members WHERE members.party_id = v_party_id);
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.removed_participants AS r
    WHERE r.party_id = v_party_id AND r.principal_id = p_principal
  ) THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  IF NOT public.consume_lobby_rate_limit(p_rate_bucket_hash, 900, 20) THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.invitation_credentials AS i
    WHERE i.party_id = v_party_id AND i.verifier_hash = p_verifier_hash
      AND i.revoked_at IS NULL
      AND (i.expires_at IS NULL OR i.expires_at > pg_catalog.clock_timestamp())
  ) THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  IF v_party.mystery_id = 'blackwood-affair'
    AND (SELECT pg_catalog.count(*) FROM public.participants AS members WHERE members.party_id = v_party_id) >= 8 THEN
    RETURN QUERY SELECT 'full'::text, NULL::uuid, NULL::uuid, NULL::text, v_party.status,
      (SELECT pg_catalog.count(*)::integer FROM public.participants AS members WHERE members.party_id = v_party_id);
    RETURN;
  END IF;

  INSERT INTO public.participants (party_id, principal_id, display_name)
  VALUES (v_party_id, p_principal, pg_catalog.btrim(p_display_name))
  RETURNING * INTO v_participant;
  UPDATE public.parties SET version = version + 1 WHERE id = v_party_id;

  RETURN QUERY SELECT 'joined'::text, v_party_id, v_participant.id, v_participant.display_name,
    v_party.status, (SELECT pg_catalog.count(*)::integer FROM public.participants AS members WHERE members.party_id = v_party_id);
END;
$$;

CREATE FUNCTION public.get_guest_membership(p_principal uuid)
RETURNS TABLE (party_id uuid, participant_id uuid, display_name text, status text, participant_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT p.party_id, p.id, p.display_name, party.status,
    (SELECT pg_catalog.count(*)::integer FROM public.participants AS all_members WHERE all_members.party_id = p.party_id)
  FROM public.participants AS p
  JOIN public.parties AS party ON party.id = p.party_id
  WHERE p.principal_id = p_principal AND party.status = 'LOBBY';
$$;

CREATE FUNCTION public.list_host_participants(p_host uuid, p_party_id uuid)
RETURNS TABLE (participant_id uuid, display_name text, principal_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT member.id, member.display_name, member.principal_id
  FROM public.parties AS party
  JOIN public.participants AS member ON member.party_id = party.id
  WHERE party.id = p_party_id AND party.host_principal_id = p_host;
$$;

CREATE FUNCTION public.enroll_host_participant(p_host uuid, p_party_id uuid, p_display_name text)
RETURNS TABLE (outcome text, participant_id uuid, display_name text, participant_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_party public.parties%ROWTYPE;
  v_participant public.participants%ROWTYPE;
BEGIN
  IF p_display_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_display_name)) NOT BETWEEN 1 AND 50 THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;
  SELECT p.* INTO v_party FROM public.parties AS p
  WHERE p.id = p_party_id AND p.host_principal_id = p_host FOR UPDATE;
  IF NOT FOUND OR v_party.status <> 'LOBBY' THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;
  SELECT p.* INTO v_participant FROM public.participants AS p
  WHERE p.party_id = p_party_id AND p.principal_id = p_host;
  IF NOT FOUND THEN
    IF v_party.mystery_id = 'blackwood-affair'
      AND (SELECT pg_catalog.count(*) FROM public.participants AS members WHERE members.party_id = p_party_id) >= 8 THEN
      RETURN QUERY SELECT 'full'::text, NULL::uuid, NULL::text,
        (SELECT pg_catalog.count(*)::integer FROM public.participants AS members WHERE members.party_id = p_party_id);
      RETURN;
    END IF;
    INSERT INTO public.participants (party_id, principal_id, display_name)
    VALUES (p_party_id, p_host, pg_catalog.btrim(p_display_name))
    RETURNING * INTO v_participant;
    UPDATE public.parties SET version = version + 1 WHERE id = p_party_id;
  END IF;
  RETURN QUERY SELECT 'joined'::text, v_participant.id, v_participant.display_name,
    (SELECT pg_catalog.count(*)::integer FROM public.participants AS members WHERE members.party_id = p_party_id);
END;
$$;

CREATE FUNCTION public.remove_host_participant(p_host uuid, p_party_id uuid, p_participant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_party public.parties%ROWTYPE;
  v_principal uuid;
BEGIN
  SELECT p.* INTO v_party FROM public.parties AS p
  WHERE p.id = p_party_id AND p.host_principal_id = p_host FOR UPDATE;
  IF NOT FOUND OR v_party.status <> 'LOBBY' THEN RETURN false; END IF;
  SELECT p.principal_id INTO v_principal FROM public.participants AS p
  WHERE p.id = p_participant_id AND p.party_id = p_party_id FOR UPDATE;
  IF NOT FOUND OR v_principal = p_host THEN RETURN false; END IF;

  INSERT INTO public.removed_participants (party_id, principal_id)
  VALUES (p_party_id, v_principal) ON CONFLICT DO NOTHING;
  INSERT INTO public.participant_recovery_audit (
    party_id, participant_id, actor_principal_id, event, previous_principal_id
  ) VALUES (p_party_id, p_participant_id, p_host, 'removed', v_principal);
  UPDATE public.participant_recovery_tokens
  SET revoked_at = pg_catalog.clock_timestamp()
  WHERE participant_id = p_participant_id AND consumed_at IS NULL AND revoked_at IS NULL;
  DELETE FROM public.participants WHERE id = p_participant_id;
  UPDATE public.parties SET version = version + 1 WHERE id = p_party_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.initiate_participant_recovery(
  p_host uuid,
  p_party_id uuid,
  p_participant_id uuid,
  p_verifier_hash bytea,
  p_rate_bucket_hash bytea
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_party public.parties%ROWTYPE;
  v_principal uuid;
BEGIN
  IF p_verifier_hash IS NULL OR pg_catalog.octet_length(p_verifier_hash) <> 32
    OR p_rate_bucket_hash IS NULL OR pg_catalog.octet_length(p_rate_bucket_hash) <> 32
    OR NOT public.consume_lobby_rate_limit(p_rate_bucket_hash, 900, 5) THEN
    RETURN false;
  END IF;
  SELECT p.* INTO v_party FROM public.parties AS p
  WHERE p.id = p_party_id AND p.host_principal_id = p_host FOR UPDATE;
  IF NOT FOUND OR v_party.status <> 'LOBBY' THEN RETURN false; END IF;
  SELECT member.principal_id INTO v_principal FROM public.participants AS member
  WHERE member.id = p_participant_id AND member.party_id = p_party_id FOR UPDATE;
  IF NOT FOUND OR v_principal = p_host THEN RETURN false; END IF;

  UPDATE public.participant_recovery_tokens
  SET revoked_at = pg_catalog.clock_timestamp()
  WHERE participant_id = p_participant_id AND consumed_at IS NULL AND revoked_at IS NULL;
  INSERT INTO public.participant_recovery_tokens (
    party_id, participant_id, verifier_hash, created_by, expires_at
  ) VALUES (
    p_party_id, p_participant_id, p_verifier_hash, p_host,
    pg_catalog.clock_timestamp() + interval '15 minutes'
  );
  INSERT INTO public.participant_recovery_audit (
    party_id, participant_id, actor_principal_id, event, previous_principal_id
  ) VALUES (p_party_id, p_participant_id, p_host, 'initiated', v_principal);
  RETURN true;
END;
$$;

CREATE FUNCTION public.redeem_participant_recovery(
  p_new_principal uuid,
  p_verifier_hash bytea,
  p_rate_bucket_hash bytea
)
RETURNS TABLE (outcome text, party_id uuid, participant_id uuid, display_name text, status text, participant_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_party_id uuid;
  v_participant_id uuid;
  v_party public.parties%ROWTYPE;
  v_token public.participant_recovery_tokens%ROWTYPE;
  v_participant public.participants%ROWTYPE;
  v_is_anonymous boolean;
BEGIN
  IF p_new_principal IS NULL OR p_verifier_hash IS NULL
    OR pg_catalog.octet_length(p_verifier_hash) <> 32
    OR p_rate_bucket_hash IS NULL OR pg_catalog.octet_length(p_rate_bucket_hash) <> 32
    OR NOT public.consume_lobby_rate_limit(p_rate_bucket_hash, 900, 10) THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  SELECT token.party_id, token.participant_id INTO v_party_id, v_participant_id
  FROM public.participant_recovery_tokens AS token WHERE token.verifier_hash = p_verifier_hash;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  SELECT party.* INTO v_party FROM public.parties AS party WHERE party.id = v_party_id FOR UPDATE;
  IF NOT FOUND OR v_party.status <> 'LOBBY' THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  SELECT token.* INTO v_token FROM public.participant_recovery_tokens AS token
  WHERE token.verifier_hash = p_verifier_hash AND token.party_id = v_party_id FOR UPDATE;
  IF NOT FOUND OR v_token.consumed_at IS NOT NULL OR v_token.revoked_at IS NOT NULL
    OR v_token.expires_at <= pg_catalog.clock_timestamp() THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  SELECT member.* INTO v_participant FROM public.participants AS member
  WHERE member.id = v_participant_id AND member.party_id = v_party_id FOR UPDATE;
  IF NOT FOUND OR v_participant.principal_id = p_new_principal
    OR EXISTS (SELECT 1 FROM public.participants AS member
      WHERE member.party_id = v_party_id AND member.principal_id = p_new_principal) THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  SELECT user_record.is_anonymous INTO v_is_anonymous
  FROM auth.users AS user_record WHERE user_record.id = p_new_principal;
  IF v_is_anonymous IS DISTINCT FROM true THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  UPDATE public.participants SET principal_id = p_new_principal WHERE id = v_participant_id;
  INSERT INTO public.removed_participants (party_id, principal_id)
  VALUES (v_party_id, v_participant.principal_id)
  ON CONFLICT DO NOTHING;
  UPDATE public.participant_recovery_tokens
  SET consumed_at = pg_catalog.clock_timestamp()
  WHERE id = v_token.id;
  UPDATE public.participant_recovery_tokens AS tokens
  SET revoked_at = pg_catalog.clock_timestamp()
  WHERE tokens.participant_id = v_participant_id AND tokens.id <> v_token.id
    AND tokens.consumed_at IS NULL AND tokens.revoked_at IS NULL;
  INSERT INTO public.participant_recovery_audit (
    party_id, participant_id, actor_principal_id, event, previous_principal_id, new_principal_id
  ) VALUES (
    v_party_id, v_participant_id, p_new_principal, 'consumed', v_participant.principal_id, p_new_principal
  );
  UPDATE public.parties SET version = version + 1 WHERE id = v_party_id;

  RETURN QUERY SELECT 'recovered'::text, v_party_id, v_participant_id, v_participant.display_name,
    v_party.status, (SELECT pg_catalog.count(*)::integer FROM public.participants AS members WHERE members.party_id = v_party_id);
END;
$$;

REVOKE ALL ON FUNCTION
  public.consume_lobby_rate_limit(bytea, integer, integer),
  public.join_party(uuid, bytea, text, bytea),
  public.get_guest_membership(uuid),
  public.list_host_participants(uuid, uuid),
  public.enroll_host_participant(uuid, uuid, text),
  public.remove_host_participant(uuid, uuid, uuid),
  public.initiate_participant_recovery(uuid, uuid, uuid, bytea, bytea),
  public.redeem_participant_recovery(uuid, bytea, bytea)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.consume_lobby_rate_limit(bytea, integer, integer),
  public.join_party(uuid, bytea, text, bytea),
  public.get_guest_membership(uuid),
  public.list_host_participants(uuid, uuid),
  public.enroll_host_participant(uuid, uuid, text),
  public.remove_host_participant(uuid, uuid, uuid),
  public.initiate_participant_recovery(uuid, uuid, uuid, bytea, bytea),
  public.redeem_participant_recovery(uuid, bytea, bytea)
TO service_role;
