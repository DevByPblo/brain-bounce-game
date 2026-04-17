
-- Add room code + privacy + bot support to multiplayer.
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS room_code text,
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS matches_room_code_open_idx
  ON public.matches (room_code)
  WHERE room_code IS NOT NULL AND status IN ('waiting','playing');

ALTER TABLE public.match_players
  ADD COLUMN IF NOT EXISTS is_bot boolean NOT NULL DEFAULT false;

-- Restrict join_quick_match to PUBLIC waiting matches only.
CREATE OR REPLACE FUNCTION public.join_quick_match(p_player_id uuid, p_display_name text, p_start text, p_target text)
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
    SET status = 'playing', started_at = now()
    WHERE id = v_match_id;
  ELSE
    INSERT INTO public.matches (status, start_title, target_title, is_private)
    VALUES ('waiting', p_start, p_target, false)
    RETURNING id INTO v_match_id;

    INSERT INTO public.match_players (match_id, player_id, display_name, current_title, path)
    VALUES (v_match_id, p_player_id, p_display_name, p_start, jsonb_build_array(p_start));
  END IF;

  RETURN v_match_id;
END;
$function$;

-- Create a private room with a 6-char code; returns match id + code.
CREATE OR REPLACE FUNCTION public.create_private_room(
  p_player_id uuid,
  p_display_name text,
  p_start text,
  p_target text
) RETURNS TABLE(match_id uuid, room_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_match_id uuid;
  v_code text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  v_i int;
BEGIN
  -- Generate a unique code (try a few times).
  FOR v_i IN 1..6 LOOP
    v_code := '';
    FOR v_i IN 1..6 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.matches
      WHERE room_code = v_code AND status IN ('waiting','playing')
    );
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

-- Join a private room by code.
CREATE OR REPLACE FUNCTION public.join_private_room(
  p_player_id uuid,
  p_display_name text,
  p_code text
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_match_id uuid;
  v_start text;
  v_status text;
  v_already int;
BEGIN
  SELECT id, start_title, status INTO v_match_id, v_start, v_status
  FROM public.matches
  WHERE upper(room_code) = upper(p_code)
    AND status IN ('waiting','playing')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'Room not found or already finished';
  END IF;

  SELECT count(*) INTO v_already
  FROM public.match_players
  WHERE match_id = v_match_id AND player_id = p_player_id;

  IF v_already = 0 THEN
    -- Reject if already 2 players (and not us).
    IF (SELECT count(*) FROM public.match_players WHERE match_id = v_match_id) >= 2 THEN
      RAISE EXCEPTION 'Room is full';
    END IF;
    INSERT INTO public.match_players (match_id, player_id, display_name, current_title, path)
    VALUES (v_match_id, p_player_id, p_display_name, v_start, jsonb_build_array(v_start));

    IF v_status = 'waiting' THEN
      UPDATE public.matches
      SET status = 'playing', started_at = now()
      WHERE id = v_match_id;
    END IF;
  END IF;

  RETURN v_match_id;
END;
$function$;

-- Add a bot opponent to a waiting match and start it.
CREATE OR REPLACE FUNCTION public.add_bot_to_match(
  p_match_id uuid,
  p_player_id uuid,
  p_bot_name text
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_start text;
  v_bot_id uuid := gen_random_uuid();
BEGIN
  SELECT start_title INTO v_start
  FROM public.matches
  WHERE id = p_match_id
    AND status = 'waiting'
    AND EXISTS (
      SELECT 1 FROM public.match_players mp
      WHERE mp.match_id = p_match_id AND mp.player_id = p_player_id
    )
  FOR UPDATE;

  IF v_start IS NULL THEN
    RAISE EXCEPTION 'Match not waiting or not yours';
  END IF;

  INSERT INTO public.match_players (match_id, player_id, display_name, current_title, path, is_bot)
  VALUES (p_match_id, v_bot_id, p_bot_name, v_start, jsonb_build_array(v_start), true);

  UPDATE public.matches
  SET status = 'playing', started_at = now()
  WHERE id = p_match_id;

  RETURN v_bot_id;
END;
$function$;
