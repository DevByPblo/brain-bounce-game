-- 1) Add hints_disabled flag on matches.
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS hints_disabled boolean NOT NULL DEFAULT false;

-- 2) Replace join_quick_match: now accepts p_hints_disabled.
--    If either player wants hints off, the match is off (OR semantics).
CREATE OR REPLACE FUNCTION public.join_quick_match(
  p_player_id uuid,
  p_display_name text,
  p_start text,
  p_target text,
  p_hints_disabled boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_match_id UUID;
BEGIN
  SELECT id INTO v_match_id
  FROM public.matches
  WHERE status = 'waiting'
    AND is_private = false
    AND created_at > now() - interval '2 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM public.match_players mp
      WHERE mp.match_id = matches.id AND mp.player_id = p_player_id
    )
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_match_id IS NOT NULL THEN
    INSERT INTO public.match_players (match_id, player_id, display_name, current_title, path)
    VALUES (
      v_match_id, p_player_id, p_display_name,
      (SELECT start_title FROM public.matches WHERE id = v_match_id),
      jsonb_build_array((SELECT start_title FROM public.matches WHERE id = v_match_id))
    );

    UPDATE public.matches
    SET status = 'playing',
        started_at = now(),
        hints_disabled = hints_disabled OR p_hints_disabled
    WHERE id = v_match_id;
  ELSE
    INSERT INTO public.matches (status, start_title, target_title, is_private, hints_disabled)
    VALUES ('waiting', p_start, p_target, false, p_hints_disabled)
    RETURNING id INTO v_match_id;

    INSERT INTO public.match_players (match_id, player_id, display_name, current_title, path)
    VALUES (v_match_id, p_player_id, p_display_name, p_start, jsonb_build_array(p_start));
  END IF;

  RETURN v_match_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.join_quick_match(uuid, text, text, text, boolean) TO anon, authenticated;

-- 3) Replace create_private_room to accept p_hints_disabled.
CREATE OR REPLACE FUNCTION public.create_private_room(
  p_player_id uuid,
  p_display_name text,
  p_start text,
  p_target text,
  p_hints_disabled boolean DEFAULT false
)
RETURNS TABLE(match_id uuid, room_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      SELECT 1 FROM public.matches m
      WHERE m.room_code = v_code AND m.status IN ('waiting','playing')
    ) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;

  INSERT INTO public.matches (status, start_title, target_title, is_private, room_code, hints_disabled)
  VALUES ('waiting', p_start, p_target, true, v_code, p_hints_disabled)
  RETURNING id INTO v_match_id;

  INSERT INTO public.match_players (match_id, player_id, display_name, current_title, path)
  VALUES (v_match_id, p_player_id, p_display_name, p_start, jsonb_build_array(p_start));

  match_id := v_match_id;
  room_code := v_code;
  RETURN NEXT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_private_room(uuid, text, text, text, boolean) TO anon, authenticated;

-- 4) Replace join_private_room to accept the joiner's preference (OR with existing).
CREATE OR REPLACE FUNCTION public.join_private_room(
  p_player_id uuid,
  p_display_name text,
  p_code text,
  p_hints_disabled boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_match_id uuid;
  v_start text;
BEGIN
  SELECT id, start_title INTO v_match_id, v_start
  FROM public.matches
  WHERE room_code = p_code
    AND status = 'waiting'
  LIMIT 1
  FOR UPDATE;

  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.match_players
    WHERE match_id = v_match_id AND player_id = p_player_id
  ) THEN
    RETURN v_match_id;
  END IF;

  INSERT INTO public.match_players (match_id, player_id, display_name, current_title, path)
  VALUES (v_match_id, p_player_id, p_display_name, v_start, jsonb_build_array(v_start));

  UPDATE public.matches
  SET status = 'playing',
      started_at = now(),
      hints_disabled = hints_disabled OR p_hints_disabled
  WHERE id = v_match_id;

  RETURN v_match_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.join_private_room(uuid, text, text, boolean) TO anon, authenticated;