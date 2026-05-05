CREATE OR REPLACE FUNCTION public.rematch_coop_match(p_match_id uuid, p_player_id uuid, p_start text, p_word_list jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing uuid;
  v_new_match_id uuid;
  v_round int;
  v_code text;
  v_max int;
  v_host uuid;
  rec record;
BEGIN
  SELECT next_match_id, round_number, room_code, max_players, host_player_id
    INTO v_existing, v_round, v_code, v_max, v_host
  FROM public.coop_matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF v_round IS NULL THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  IF v_host <> p_player_id THEN
    RAISE EXCEPTION 'Only the host can start a rematch';
  END IF;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Free the room_code on the previous match so the new one can inherit it
  -- (room_code has a UNIQUE constraint).
  UPDATE public.coop_matches
  SET room_code = NULL
  WHERE id = p_match_id;

  INSERT INTO public.coop_matches
    (status, start_title, word_list, room_code,
     host_player_id, round_number, max_players)
  VALUES
    ('waiting', p_start, p_word_list, v_code,
     p_player_id, COALESCE(v_round,1) + 1, COALESCE(v_max,10))
  RETURNING id INTO v_new_match_id;

  FOR rec IN
    SELECT player_id, display_name
    FROM public.coop_players
    WHERE match_id = p_match_id
      AND left_at IS NULL
      AND (rematch_opt_in = true OR player_id = p_player_id)
  LOOP
    INSERT INTO public.coop_players
      (match_id, player_id, display_name, current_title)
    VALUES (v_new_match_id, rec.player_id, rec.display_name, p_start);
  END LOOP;

  UPDATE public.coop_matches
  SET next_match_id = v_new_match_id,
      status = CASE WHEN status = 'playing' THEN 'finished' ELSE status END,
      finished_at = COALESCE(finished_at, now())
  WHERE id = p_match_id;

  RETURN v_new_match_id;
END;
$function$;