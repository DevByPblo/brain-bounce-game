CREATE OR REPLACE FUNCTION public.reassign_coop_host(p_match_id uuid, p_caller_id uuid, p_candidate_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_host uuid;
  v_status text;
  v_caller_active boolean;
  v_candidate_active boolean;
  v_new_host uuid;
BEGIN
  SELECT host_player_id, status INTO v_host, v_status
  FROM public.coop_matches WHERE id = p_match_id FOR UPDATE;

  IF v_host IS NULL THEN RETURN NULL; END IF;
  IF v_status NOT IN ('waiting','playing') THEN RETURN v_host; END IF;
  IF v_host = p_caller_id THEN RETURN v_host; END IF; -- host is fine

  -- Caller must be an active member.
  SELECT EXISTS (
    SELECT 1 FROM public.coop_players
    WHERE match_id = p_match_id AND player_id = p_caller_id AND left_at IS NULL
  ) INTO v_caller_active;
  IF NOT v_caller_active THEN RETURN v_host; END IF;

  -- Candidate must also be active (preferably the caller).
  SELECT EXISTS (
    SELECT 1 FROM public.coop_players
    WHERE match_id = p_match_id AND player_id = p_candidate_id AND left_at IS NULL
  ) INTO v_candidate_active;

  IF v_candidate_active THEN
    v_new_host := p_candidate_id;
  ELSE
    SELECT player_id INTO v_new_host
    FROM public.coop_players
    WHERE match_id = p_match_id AND left_at IS NULL
    ORDER BY joined_at ASC LIMIT 1;
  END IF;

  IF v_new_host IS NULL THEN RETURN v_host; END IF;

  UPDATE public.coop_matches
  SET host_player_id = v_new_host
  WHERE id = p_match_id;

  RETURN v_new_host;
END;
$$;