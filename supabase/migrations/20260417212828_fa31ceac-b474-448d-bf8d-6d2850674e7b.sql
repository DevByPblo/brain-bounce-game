-- Replace create_private_room: previous version had ambiguous "room_code"
-- between the OUT parameter and the matches.room_code column, causing 42702.
-- Also fix the nested loop variable reuse (v_i used twice) which was a latent bug.
CREATE OR REPLACE FUNCTION public.create_private_room(
  p_player_id uuid,
  p_display_name text,
  p_start text,
  p_target text
)
RETURNS TABLE(match_id uuid, room_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_match_id uuid;
  v_code text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  v_attempt int;
  v_char int;
  v_exists boolean;
BEGIN
  -- Generate a unique 6-char code (try a few times).
  FOR v_attempt IN 1..6 LOOP
    v_code := '';
    FOR v_char IN 1..6 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    SELECT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.room_code = v_code AND m.status IN ('waiting','playing')
    ) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;

  INSERT INTO public.matches (status, start_title, target_title, is_private, room_code)
  VALUES ('waiting', p_start, p_target, true, v_code)
  RETURNING id INTO v_match_id;

  INSERT INTO public.match_players (match_id, player_id, display_name, current_title, path)
  VALUES (v_match_id, p_player_id, p_display_name, p_start, jsonb_build_array(p_start));

  match_id := v_match_id;
  room_code := v_code;
  RETURN NEXT;
END;
$function$;