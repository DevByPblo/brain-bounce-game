CREATE OR REPLACE FUNCTION public.add_bot_to_match(p_match_id uuid, p_player_id uuid, p_bot_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_start text;
  v_status text;
  v_bot_id uuid;
  v_existing_bot uuid;
  v_is_member boolean;
BEGIN
  -- Look up the match (any status) so we can give a useful error.
  SELECT start_title, status INTO v_start, v_status
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF v_start IS NULL THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  -- Caller must be a member of this match.
  SELECT EXISTS (
    SELECT 1 FROM public.match_players mp
    WHERE mp.match_id = p_match_id AND mp.player_id = p_player_id
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'Not your match';
  END IF;

  -- Idempotent: if a bot is already in this match, just return its id.
  SELECT player_id INTO v_existing_bot
  FROM public.match_players
  WHERE match_id = p_match_id AND is_bot = true
  LIMIT 1;
  IF v_existing_bot IS NOT NULL THEN
    -- Make sure the match is playing.
    IF v_status = 'waiting' THEN
      UPDATE public.matches
      SET status = 'playing', started_at = COALESCE(started_at, now())
      WHERE id = p_match_id;
    END IF;
    RETURN v_existing_bot;
  END IF;

  IF v_status NOT IN ('waiting','playing') THEN
    RAISE EXCEPTION 'Match already finished';
  END IF;

  v_bot_id := gen_random_uuid();

  INSERT INTO public.match_players (match_id, player_id, display_name, current_title, path, is_bot)
  VALUES (p_match_id, v_bot_id, p_bot_name, v_start, jsonb_build_array(v_start), true);

  UPDATE public.matches
  SET status = 'playing', started_at = COALESCE(started_at, now())
  WHERE id = p_match_id;

  RETURN v_bot_id;
END;
$function$;