ALTER TABLE public.coop_matches
  ADD COLUMN IF NOT EXISTS host_player_id uuid,
  ADD COLUMN IF NOT EXISTS round_number int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS next_match_id uuid;

UPDATE public.coop_matches m
SET host_player_id = sub.player_id
FROM (
  SELECT DISTINCT ON (match_id) match_id, player_id
  FROM public.coop_players
  ORDER BY match_id, joined_at ASC
) sub
WHERE m.id = sub.match_id AND m.host_player_id IS NULL;

CREATE OR REPLACE FUNCTION public.create_coop_room(
  p_player_id uuid, p_display_name text, p_start text, p_word_list jsonb
) RETURNS TABLE(match_id uuid, room_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_match_id uuid;
  v_code text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_attempt int;
  v_char int;
  v_exists boolean;
BEGIN
  FOR v_attempt IN 1..6 LOOP
    v_code := '';
    FOR v_char IN 1..6 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    SELECT EXISTS (
      SELECT 1 FROM public.coop_matches m
      WHERE m.room_code = v_code AND m.status IN ('waiting','playing')
    ) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;

  INSERT INTO public.coop_matches (status, start_title, word_list, room_code, host_player_id, round_number)
  VALUES ('waiting', p_start, p_word_list, v_code, p_player_id, 1)
  RETURNING id INTO v_match_id;

  INSERT INTO public.coop_players (match_id, player_id, display_name, current_title)
  VALUES (v_match_id, p_player_id, p_display_name, p_start);

  match_id := v_match_id;
  room_code := v_code;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.rematch_coop_match(
  p_match_id uuid,
  p_player_id uuid,
  p_start text,
  p_word_list jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_existing uuid;
  v_new_match_id uuid;
  v_round int;
  v_code text;
  v_other_player uuid;
  v_host uuid;
  rec record;
BEGIN
  SELECT next_match_id, round_number, room_code
    INTO v_existing, v_round, v_code
  FROM public.coop_matches
  WHERE id = p_match_id AND host_player_id = p_player_id
  FOR UPDATE;

  IF v_round IS NULL THEN
    RAISE EXCEPTION 'Only the host can start a rematch';
  END IF;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT player_id INTO v_other_player
  FROM public.coop_players
  WHERE match_id = p_match_id AND player_id <> p_player_id
  ORDER BY joined_at ASC LIMIT 1;

  v_host := COALESCE(v_other_player, p_player_id);

  INSERT INTO public.coop_matches (status, start_title, word_list, room_code, host_player_id, round_number, started_at)
  VALUES ('playing', p_start, p_word_list, v_code, v_host, COALESCE(v_round,1) + 1, now())
  RETURNING id INTO v_new_match_id;

  FOR rec IN
    SELECT player_id, display_name FROM public.coop_players WHERE match_id = p_match_id
  LOOP
    INSERT INTO public.coop_players (match_id, player_id, display_name, current_title)
    VALUES (v_new_match_id, rec.player_id, rec.display_name, p_start);
  END LOOP;

  UPDATE public.coop_matches
  SET next_match_id = v_new_match_id,
      status = CASE WHEN status = 'playing' THEN 'finished' ELSE status END,
      finished_at = COALESCE(finished_at, now())
  WHERE id = p_match_id;

  RETURN v_new_match_id;
END;
$$;