
-- ─────────── Matches ───────────
CREATE TABLE public.matches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status       TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','playing','finished','abandoned')),
  start_title  TEXT,
  target_title TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  winner_player_id UUID
);

CREATE INDEX idx_matches_status ON public.matches(status, created_at);

-- ─────────── Match players ───────────
CREATE TABLE public.match_players (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL,
  display_name  TEXT NOT NULL,
  clicks        INT  NOT NULL DEFAULT 0,
  current_title TEXT,
  path          JSONB NOT NULL DEFAULT '[]'::jsonb,
  finished_at   TIMESTAMPTZ,
  time_ms       INT,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id, player_id)
);

CREATE INDEX idx_match_players_match ON public.match_players(match_id);

-- ─────────── RLS ───────────
ALTER TABLE public.matches        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_players  ENABLE ROW LEVEL SECURITY;

-- Public read so both racers can observe each other in realtime.
-- No PII is stored; display_name is user-chosen.
CREATE POLICY "matches readable by anyone"
  ON public.matches FOR SELECT USING (true);

CREATE POLICY "match_players readable by anyone"
  ON public.match_players FOR SELECT USING (true);

-- All mutations go through SECURITY DEFINER RPCs below, so deny direct writes.
-- (No INSERT/UPDATE/DELETE policies = denied for anon role.)

-- ─────────── Realtime ───────────
ALTER TABLE public.matches       REPLICA IDENTITY FULL;
ALTER TABLE public.match_players REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_players;

-- ─────────── RPC: quick-match join ───────────
-- The CALLING client supplies a candidate (start,target) pair; if a waiting match
-- exists, we join it (its existing pair wins). Otherwise we create a new waiting
-- match using the supplied pair.
CREATE OR REPLACE FUNCTION public.join_quick_match(
  p_player_id    UUID,
  p_display_name TEXT,
  p_start        TEXT,
  p_target       TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match_id UUID;
BEGIN
  -- Try to claim the oldest waiting match (not abandoned, not stale > 2 min)
  SELECT id INTO v_match_id
  FROM public.matches
  WHERE status = 'waiting'
    AND created_at > now() - interval '2 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM public.match_players mp
      WHERE mp.match_id = matches.id AND mp.player_id = p_player_id
    )
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_match_id IS NOT NULL THEN
    -- Second player joins: flip to playing using the EXISTING pair.
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
    -- No waiting match: create one with our proposed pair.
    INSERT INTO public.matches (status, start_title, target_title)
    VALUES ('waiting', p_start, p_target)
    RETURNING id INTO v_match_id;

    INSERT INTO public.match_players (match_id, player_id, display_name, current_title, path)
    VALUES (v_match_id, p_player_id, p_display_name, p_start, jsonb_build_array(p_start));
  END IF;

  RETURN v_match_id;
END;
$$;

-- ─────────── RPC: cancel waiting match ───────────
CREATE OR REPLACE FUNCTION public.cancel_match(
  p_match_id  UUID,
  p_player_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.matches
  SET status = 'abandoned'
  WHERE id = p_match_id
    AND status = 'waiting'
    AND EXISTS (
      SELECT 1 FROM public.match_players mp
      WHERE mp.match_id = p_match_id AND mp.player_id = p_player_id
    );
END;
$$;

-- ─────────── RPC: report progress ───────────
CREATE OR REPLACE FUNCTION public.report_progress(
  p_match_id      UUID,
  p_player_id     UUID,
  p_current_title TEXT,
  p_clicks        INT,
  p_path          JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.match_players
  SET current_title = p_current_title,
      clicks        = p_clicks,
      path          = p_path
  WHERE match_id  = p_match_id
    AND player_id = p_player_id
    AND finished_at IS NULL;
END;
$$;

-- ─────────── RPC: finish ───────────
CREATE OR REPLACE FUNCTION public.finish_match(
  p_match_id  UUID,
  p_player_id UUID,
  p_clicks    INT,
  p_time_ms   INT,
  p_path      JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already_won UUID;
BEGIN
  UPDATE public.match_players
  SET finished_at   = now(),
      clicks        = p_clicks,
      time_ms       = p_time_ms,
      path          = p_path,
      current_title = (p_path->>(jsonb_array_length(p_path)-1))
  WHERE match_id  = p_match_id
    AND player_id = p_player_id
    AND finished_at IS NULL;

  -- First finisher wins.
  SELECT winner_player_id INTO v_already_won
  FROM public.matches WHERE id = p_match_id;

  IF v_already_won IS NULL THEN
    UPDATE public.matches
    SET winner_player_id = p_player_id,
        status      = 'finished',
        finished_at = now()
    WHERE id = p_match_id;
  END IF;
END;
$$;

-- Allow anon + authenticated to call the RPCs.
GRANT EXECUTE ON FUNCTION public.join_quick_match(UUID, TEXT, TEXT, TEXT)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_match(UUID, UUID)                        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_progress(UUID, UUID, TEXT, INT, JSONB)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_match(UUID, UUID, INT, INT, JSONB)       TO anon, authenticated;
