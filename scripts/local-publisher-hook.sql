-- Apply only to a disposable local Supabase database, never as a migration.
BEGIN;

CREATE TABLE private_mystery.local_publisher_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE private_mystery.local_publisher_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_mystery.local_publisher_identity FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private_mystery.local_publisher_identity FROM PUBLIC, anon, authenticated, service_role, mystery_operator, supabase_auth_admin;

CREATE FUNCTION private_mystery.local_mystery_publisher_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  claims jsonb := event->'claims';
BEGIN
  IF EXISTS (
    SELECT 1 FROM private_mystery.local_publisher_identity
    WHERE user_id::text = event->>'user_id'
  ) THEN
    claims := jsonb_set(claims, '{role}', '"mystery_operator"'::jsonb);
  ELSE
    claims := jsonb_set(claims, '{role}', '"authenticated"'::jsonb);
  END IF;
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;
REVOKE ALL ON FUNCTION private_mystery.local_mystery_publisher_hook(jsonb)
  FROM PUBLIC, anon, authenticated, service_role, mystery_operator;
GRANT USAGE ON SCHEMA private_mystery TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private_mystery.local_mystery_publisher_hook(jsonb) TO supabase_auth_admin;

COMMIT;
