-- ────────────────────────────────────────────────────────────────────
-- Co-op multiplayer rework: up to 10 players, host-start countdown,
-- sudden-death timer, per-player rejoin.
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE public.coop_matches
  ADD COLUMN IF NOT EXISTS max_players          integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS start_countdown_at   timestamptz,
  ADD COLUMN IF NOT EXISTS sudden_death_at      timestamptz,
  ADD COLUMN IF NOT EXISTS sudden_death_ms      integer NOT NULL DEFAULT 120000;

ALTER TABLE public.coop_players
  ADD COLUMN IF NOT EXISTS left_at      timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at  timestamptz,
  ADD COLUMN IF NOT EXISTS rematch_opt_in boolean NOT NULL DEFAULT false;

-- ─── Replace create_coop_room (no signature change) ───────────────
CREATE OR REPLACE FUNCTION public.create_coop_room(
  p_player_id uuid,
  p_display_name text,
  p_start text,
  p_word_list jsonb
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
      SELECT 1 FROM public.coop_matches m
      WHERE m.room_code = v_code AND m.status IN ('waiting','playing')
    ) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;

  -- Always start in 'waiting' (lobby). Host clicks Start to begin.
  INSERT INTO public.coop_matches
    (status, start_title, word_list, room_code, host_player_id, round_number, max_players)
  VALUES
    ('waiting', p_start, p_word_list, v_code, p_player_id, 1, 10)
  RETURNING id INTO v_match_id;

  INSERT INTO public.coop_players (match_id, player_id, display_name, current_title)
  VALUES (v_match_id, p_player_id, p_display_name, p_start);

  match_id := v_match_id;
  room_code := v_code;
  RETURN NEXT;
END;
$function$;

-- ─── Replace join_coop_room: up to N players, lobby OR playing ───
CREATE OR REPLACE FUNCTION public.join_coop_room(
  p_player_id uuid,
  p_display_name text,
  p_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_match_id uuid;
  v_start text;
  v_max int;
  v_status text;
  v_active int;
  v_existing uuid;
BEGIN
  SELECT id, start_title, max_players, status
    INTO v_match_id, v_start, v_max, v_status
  FROM public.coop_matches
  WHERE upper(room_code) = upper(p_code)
    AND status IN ('waiting','playing')
  ORDER BY created_at DESC LIMIT 1
  FOR UPDATE;

  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'Room not found or already finished';
  END IF;

  -- Already in this match? Reactivate them (clear left_at).
  SELECT id INTO v_existing
  FROM public.coop_players
  WHERE match_id = v_match_id AND player_id = p_player_id;

  IF v_existing IS NOT NULL THEN
    UPDATE public.coop_players
    SET left_at = NULL, display_name = p_display_name
    WHERE id = v_existing;
    RETURN v_match_id;
  END IF;

  SELECT count(*) INTO v_active
  FROM public.coop_players
  WHERE match_id = v_match_id AND left_at IS NULL;

  IF v_active >= COALESCE(v_max, 10) THEN
    RAISE EXCEPTION 'Room is full';
  END IF;

  INSERT INTO public.coop_players (match_id, player_id, display_name, current_title)
  VALUES (v_match_id, p_player_id, p_display_name, v_start);

  RETURN v_match_id;
END;
$function$;

-- ─── Host starts the round (lobby → countdown → playing). ─────────
-- Sets start_countdown_at; client uses started_at to actually begin
-- the round timer (set by start_coop_play below after countdown).
CREATE OR REPLACE FUNCTION public.start_coop_match(
  p_match_id uuid,
  p_player_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.coop_matches
  SET start_countdown_at = COALESCE(start_countdown_at, now()),
      status             = 'playing',
      started_at         = COALESCE(started_at, now())
  WHERE id = p_match_id
    AND host_player_id = p_player_id
    AND status = 'waiting';
END;
$function$;

-- ─── Player marks themselves "done"; trigger sudden death after 3. ─
CREATE OR REPLACE FUNCTION public.mark_coop_done(
  p_match_id uuid,
  p_player_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_done int;
  v_active int;
  v_sd timestamptz;
BEGIN
  UPDATE public.coop_players
  SET finished_at = COALESCE(finished_at, now())
  WHERE match_id = p_match_id
    AND player_id = p_player_id
    AND left_at IS NULL;

  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL),
         count(*)
    INTO v_done, v_active
  FROM public.coop_players
  WHERE match_id = p_match_id AND left_at IS NULL;

  -- 3+ players finished and there are still others playing → start sudden death.
  IF v_done >= 3 AND v_active > v_done THEN
    SELECT sudden_death_at INTO v_sd
    FROM public.coop_matches WHERE id = p_match_id;

    IF v_sd IS NULL THEN
      UPDATE public.coop_matches
      SET sudden_death_at = now()
      WHERE id = p_match_id AND status = 'playing';
    END IF;
  END IF;

  -- All active players done → finish the match.
  IF v_active > 0 AND v_done >= v_active THEN
    UPDATE public.coop_matches
    SET status = 'finished', finished_at = COALESCE(finished_at, now())
    WHERE id = p_match_id AND status = 'playing';
  END IF;
END;
$function$;

-- ─── Player leaves (lobby or mid-game). ───────────────────────────
CREATE OR REPLACE FUNCTION public.leave_coop_match(
  p_match_id uuid,
  p_player_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_host uuid;
  v_status text;
  v_new_host uuid;
  v_active int;
BEGIN
  UPDATE public.coop_players
  SET left_at = COALESCE(left_at, now())
  WHERE match_id = p_match_id AND player_id = p_player_id;

  SELECT host_player_id, status INTO v_host, v_status
  FROM public.coop_matches WHERE id = p_match_id FOR UPDATE;

  -- Reassign host if the host left.
  IF v_host = p_player_id THEN
    SELECT player_id INTO v_new_host
    FROM public.coop_players
    WHERE match_id = p_match_id AND left_at IS NULL
    ORDER BY joined_at ASC LIMIT 1;

    UPDATE public.coop_matches
    SET host_player_id = v_new_host
    WHERE id = p_match_id;
  END IF;

  -- If everyone left while playing, mark the match abandoned.
  SELECT count(*) INTO v_active
  FROM public.coop_players WHERE match_id = p_match_id AND left_at IS NULL;

  IF v_active = 0 AND v_status IN ('waiting','playing') THEN
    UPDATE public.coop_matches
    SET status = CASE WHEN status = 'playing' THEN 'finished' ELSE 'abandoned' END,
        finished_at = COALESCE(finished_at, now())
    WHERE id = p_match_id;
  END IF;
END;
$function$;

-- ─── Per-player opt-in for the next round. ───────────────────────
CREATE OR REPLACE FUNCTION public.opt_in_rematch(
  p_match_id uuid,
  p_player_id uuid,
  p_opt_in boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.coop_players
  SET rematch_opt_in = p_opt_in
  WHERE match_id = p_match_id AND player_id = p_player_id;
END;
$function$;

-- ─── Host starts the next round with all opted-in survivors. ─────
-- Replaces the old 2-player rematch_coop_match — now N-aware.
CREATE OR REPLACE FUNCTION public.rematch_coop_match(
  p_match_id uuid,
  p_player_id uuid,
  p_start text,
  p_word_list jsonb
)
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

  -- Create the new match in 'waiting' so opted-in players land in lobby.
  INSERT INTO public.coop_matches
    (status, start_title, word_list, room_code,
     host_player_id, round_number, max_players)
  VALUES
    ('waiting', p_start, p_word_list, v_code,
     p_player_id, COALESCE(v_round,1) + 1, COALESCE(v_max,10))
  RETURNING id INTO v_new_match_id;

  -- Carry over only opted-in players (and the host, always).
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