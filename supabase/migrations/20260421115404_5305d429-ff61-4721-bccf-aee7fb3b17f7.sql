-- ============================================================
-- Co-op Time Attack mode
-- ============================================================

CREATE TABLE public.coop_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code text UNIQUE,
  status text NOT NULL DEFAULT 'waiting', -- waiting | playing | finished | abandoned
  start_title text NOT NULL,
  word_list jsonb NOT NULL DEFAULT '[]'::jsonb, -- array of target titles
  duration_ms integer NOT NULL DEFAULT 300000,  -- 5 minutes
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  team_score integer NOT NULL DEFAULT 0
);

CREATE TABLE public.coop_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.coop_matches(id) ON DELETE CASCADE,
  player_id uuid NOT NULL,
  display_name text NOT NULL,
  current_title text,           -- where the player is browsing
  chasing_word text,            -- which target they're currently going for
  claims integer NOT NULL DEFAULT 0,
  score integer NOT NULL DEFAULT 0,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, player_id)
);

CREATE TABLE public.coop_word_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.coop_matches(id) ON DELETE CASCADE,
  word text NOT NULL,
  claimed_by uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, word)
);

CREATE INDEX idx_coop_matches_room_code ON public.coop_matches(room_code) WHERE status IN ('waiting','playing');
CREATE INDEX idx_coop_players_match ON public.coop_players(match_id);
CREATE INDEX idx_coop_word_claims_match ON public.coop_word_claims(match_id);

ALTER TABLE public.coop_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coop_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coop_word_claims ENABLE ROW LEVEL SECURITY;

-- Public read (matches/players/claims are all public for any authenticated session,
-- mirroring existing `matches` policy). Writes go through SECURITY DEFINER RPCs.
CREATE POLICY "coop_matches_select" ON public.coop_matches
  FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "coop_players_select" ON public.coop_players
  FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "coop_word_claims_select" ON public.coop_word_claims
  FOR SELECT TO authenticated, anon USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.coop_matches;
ALTER PUBLICATION supabase_realtime ADD TABLE public.coop_players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.coop_word_claims;

-- ============================================================
-- RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_coop_room(
  p_player_id uuid,
  p_display_name text,
  p_start text,
  p_word_list jsonb
) RETURNS TABLE(match_id uuid, room_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  INSERT INTO public.coop_matches (status, start_title, word_list, room_code)
  VALUES ('waiting', p_start, p_word_list, v_code)
  RETURNING id INTO v_match_id;

  INSERT INTO public.coop_players (match_id, player_id, display_name, current_title)
  VALUES (v_match_id, p_player_id, p_display_name, p_start);

  match_id := v_match_id;
  room_code := v_code;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_coop_room(
  p_player_id uuid,
  p_display_name text,
  p_code text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_match_id uuid;
  v_start text;
  v_count int;
BEGIN
  SELECT id, start_title INTO v_match_id, v_start
  FROM public.coop_matches
  WHERE upper(room_code) = upper(p_code)
    AND status IN ('waiting','playing')
  ORDER BY created_at DESC LIMIT 1
  FOR UPDATE;

  IF v_match_id IS NULL THEN
    RAISE EXCEPTION 'Room not found or already finished';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.coop_players WHERE match_id = v_match_id AND player_id = p_player_id) THEN
    SELECT count(*) INTO v_count FROM public.coop_players WHERE match_id = v_match_id;
    IF v_count >= 2 THEN
      RAISE EXCEPTION 'Room is full';
    END IF;

    INSERT INTO public.coop_players (match_id, player_id, display_name, current_title)
    VALUES (v_match_id, p_player_id, p_display_name, v_start);

    UPDATE public.coop_matches
    SET status = 'playing', started_at = COALESCE(started_at, now())
    WHERE id = v_match_id;
  END IF;

  RETURN v_match_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_coop_chasing(
  p_match_id uuid,
  p_player_id uuid,
  p_current_title text,
  p_chasing_word text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.coop_players
  SET current_title = p_current_title,
      chasing_word  = p_chasing_word
  WHERE match_id = p_match_id AND player_id = p_player_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_coop_word(
  p_match_id uuid,
  p_player_id uuid,
  p_word text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inserted boolean := false;
  v_word_in_list boolean;
  v_total int;
  v_found int;
BEGIN
  -- Validate the word is part of this match's list.
  SELECT EXISTS (
    SELECT 1 FROM public.coop_matches m,
                  jsonb_array_elements_text(m.word_list) w
    WHERE m.id = p_match_id AND lower(w) = lower(p_word)
  ) INTO v_word_in_list;

  IF NOT v_word_in_list THEN RETURN false; END IF;

  BEGIN
    INSERT INTO public.coop_word_claims (match_id, word, claimed_by)
    VALUES (p_match_id, p_word, p_player_id);
    v_inserted := true;
  EXCEPTION WHEN unique_violation THEN
    v_inserted := false;
  END;

  IF v_inserted THEN
    UPDATE public.coop_players
    SET claims = claims + 1,
        score  = score  + 1000,
        chasing_word = NULL
    WHERE match_id = p_match_id AND player_id = p_player_id;

    UPDATE public.coop_matches
    SET team_score = team_score + 1000
    WHERE id = p_match_id;

    -- Auto-finish if all words found.
    SELECT jsonb_array_length(word_list) INTO v_total FROM public.coop_matches WHERE id = p_match_id;
    SELECT count(*) INTO v_found FROM public.coop_word_claims WHERE match_id = p_match_id;
    IF v_found >= v_total THEN
      UPDATE public.coop_matches
      SET status = 'finished', finished_at = now()
      WHERE id = p_match_id AND status = 'playing';
    END IF;
  END IF;

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_coop_match(
  p_match_id uuid,
  p_player_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.coop_matches
  SET status = 'finished', finished_at = COALESCE(finished_at, now())
  WHERE id = p_match_id
    AND status = 'playing'
    AND EXISTS (
      SELECT 1 FROM public.coop_players cp
      WHERE cp.match_id = p_match_id AND cp.player_id = p_player_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_coop_match(
  p_match_id uuid,
  p_player_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.coop_matches
  SET status = 'abandoned'
  WHERE id = p_match_id
    AND status = 'waiting'
    AND EXISTS (
      SELECT 1 FROM public.coop_players cp
      WHERE cp.match_id = p_match_id AND cp.player_id = p_player_id
    );
END;
$$;