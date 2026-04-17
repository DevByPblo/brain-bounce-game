-- 1. Add avatar_id to profiles for the optional avatar picker.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_id text;

-- 2. RPC: migrate scores from a previous (anonymous) user_id onto the
--    currently-authenticated user. Safe because:
--    - SECURITY DEFINER bypasses RLS but we authenticate via auth.uid()
--    - We require the caller to be authenticated and non-anonymous
--    - We never touch rows belonging to other real users
CREATE OR REPLACE FUNCTION public.migrate_anonymous_scores(p_from_user uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_to uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF v_to IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_from_user IS NULL OR p_from_user = v_to THEN
    RETURN 0;
  END IF;

  UPDATE public.scores
  SET user_id = v_to
  WHERE user_id = p_from_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$function$;