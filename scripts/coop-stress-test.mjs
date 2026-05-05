// 10-player co-op stress test.
// Simulates: lobby join → host start → countdown → claims → host drop → host migration
// → finish → rematch → repeat. Verifies start/countdown, scores, and timers stay in sync.
//
// Run: node scripts/coop-stress-test.mjs
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.VITE_SUPABASE_URL || "https://wlphzkaaewhpcgghvmej.supabase.co";
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndscGh6a2FhZXdocGNnZ2h2bWVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NDEyNjksImV4cCI6MjA5MjAxNzI2OX0.G472xrEQt3ZfGneSHW7MLtjbiTyXmRB75AtIh4hY0tI";

const PLAYER_COUNT = 10;
const ROUNDS = 3;
const WORD_COUNT = 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = (msg, ...rest) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${msg}`, ...rest);
let failures = 0;
const fail = (msg) => { failures++; console.error("  ❌", msg); };
const ok = (msg) => console.log("  ✅", msg);

const fakeWords = () => Array.from({ length: WORD_COUNT }, (_, i) => `StressWord_${randomUUID().slice(0, 8)}_${i}`);

const makeClient = () => createClient(URL, KEY, { auth: { persistSession: false } });

async function main() {
  const players = Array.from({ length: PLAYER_COUNT }, (_, i) => ({
    id: randomUUID(),
    name: `Bot${i + 1}`,
    sb: makeClient(),
  }));
  let host = players[0];
  log(`Spawned ${PLAYER_COUNT} players. Host: ${host.name}`);

  // ── Round 1: Create + join ────────────────────────────────────────────────
  const start = `StressStart_${randomUUID().slice(0, 8)}`;
  const wordList = fakeWords();
  const { data: created, error: e1 } = await host.sb.rpc("create_coop_room", {
    p_player_id: host.id, p_display_name: host.name, p_start: start, p_word_list: wordList,
  });
  if (e1) { fail(`create_coop_room: ${e1.message}`); return; }
  let matchId = created[0].match_id;
  const code = created[0].room_code;
  log(`Room ${code} created → ${matchId}`);

  // 9 others join in parallel
  const joinResults = await Promise.all(players.slice(1).map((p) =>
    p.sb.rpc("join_coop_room", { p_player_id: p.id, p_display_name: p.name, p_code: code })
  ));
  joinResults.forEach((r, i) => { if (r.error) fail(`join ${players[i + 1].name}: ${r.error.message}`); });

  let { data: lobbyPlayers } = await host.sb.from("coop_players").select("*").eq("match_id", matchId);
  lobbyPlayers.length === PLAYER_COUNT ? ok(`All ${PLAYER_COUNT} players in lobby`) : fail(`Lobby has ${lobbyPlayers.length}/${PLAYER_COUNT}`);

  for (let round = 1; round <= ROUNDS; round++) {
    log(`──── Round ${round} ────`);

    // Host starts
    const beforeStart = Date.now();
    const { error: eStart } = await host.sb.rpc("start_coop_match", { p_match_id: matchId, p_player_id: host.id });
    if (eStart) { fail(`start_coop_match: ${eStart.message}`); return; }

    let { data: m } = await host.sb.from("coop_matches").select("*").eq("id", matchId).single();
    m.status === "playing" ? ok(`Status=playing, countdown_at set: ${!!m.start_countdown_at}`) : fail(`Status=${m.status}`);
    m.start_countdown_at ? ok("start_countdown_at present") : fail("start_countdown_at NULL");
    m.started_at ? ok("started_at present") : fail("started_at NULL");

    // Duplicate start should be a no-op (idempotent guard)
    await host.sb.rpc("start_coop_match", { p_match_id: matchId, p_player_id: host.id });
    let { data: m2 } = await host.sb.from("coop_matches").select("*").eq("id", matchId).single();
    m2.start_countdown_at === m.start_countdown_at ? ok("Duplicate start did not reset countdown") : fail("countdown re-set on second start");

    // Players claim words concurrently
    const claimPromises = [];
    wordList.forEach((w, i) => {
      const p = players[i % PLAYER_COUNT];
      claimPromises.push(p.sb.rpc("claim_coop_word", { p_match_id: matchId, p_player_id: p.id, p_word: w })
        .then((r) => ({ w, ok: r.data === true, err: r.error?.message })));
      // Race: have a second player try the same word
      if (i % 3 === 0) {
        const q = players[(i + 1) % PLAYER_COUNT];
        claimPromises.push(q.sb.rpc("claim_coop_word", { p_match_id: matchId, p_player_id: q.id, p_word: w })
          .then((r) => ({ w, ok: r.data === true, err: r.error?.message, race: true })));
      }
    });
    const claimResults = await Promise.all(claimPromises);
    const successes = claimResults.filter((r) => r.ok).length;
    successes === WORD_COUNT
      ? ok(`Exactly ${WORD_COUNT} unique claims (race conditions correctly rejected)`)
      : fail(`Got ${successes} successful claims, expected ${WORD_COUNT}`);

    // Verify scores match claims
    const { data: rowsAfter } = await host.sb.from("coop_players").select("*").eq("match_id", matchId);
    let totalClaims = 0, totalScore = 0;
    rowsAfter.forEach((r) => { totalClaims += r.claims; totalScore += r.score; });
    totalClaims === WORD_COUNT ? ok(`Sum of claims = ${WORD_COUNT}`) : fail(`Sum of claims = ${totalClaims}`);
    totalScore === WORD_COUNT * 1000 ? ok(`Team score = ${totalScore}`) : fail(`Team score = ${totalScore}`);

    const { data: mFinal } = await host.sb.from("coop_matches").select("*").eq("id", matchId).single();
    mFinal.team_score === WORD_COUNT * 1000 ? ok(`match.team_score = ${mFinal.team_score}`) : fail(`match.team_score = ${mFinal.team_score}`);
    mFinal.status === "finished" ? ok("Auto-finished after sweep") : fail(`status=${mFinal.status} after sweep`);
    mFinal.finished_at ? ok("finished_at set") : fail("finished_at NULL");

    if (round === ROUNDS) break;

    // ── HOST DROP simulation ──
    log(`Simulating host drop: ${host.name} leaves`);
    await host.sb.rpc("leave_coop_match", { p_match_id: matchId, p_player_id: host.id });
    // New host = next player still active
    const newHostCandidate = players.find((p) => p.id !== host.id);
    await newHostCandidate.sb.rpc("reassign_coop_host", {
      p_match_id: matchId, p_caller_id: newHostCandidate.id, p_candidate_id: newHostCandidate.id,
    });
    const { data: mAfterDrop } = await host.sb.from("coop_matches").select("host_player_id").eq("id", matchId).single();
    mAfterDrop.host_player_id === newHostCandidate.id
      ? ok(`Host migrated → ${newHostCandidate.name}`)
      : fail(`Host migration failed (host_player_id=${mAfterDrop.host_player_id})`);
    host = newHostCandidate;

    // Opt-in everyone for rematch
    await Promise.all(players.filter((p) => p.id !== players[0].id).map((p) =>
      p.sb.rpc("opt_in_rematch", { p_match_id: matchId, p_player_id: p.id, p_opt_in: true })
    ));

    // New host calls rematch
    const start2 = `StressStart_${randomUUID().slice(0, 8)}`;
    const newWords = fakeWords();
    const { data: nextId, error: eR } = await host.sb.rpc("rematch_coop_match", {
      p_match_id: matchId, p_player_id: host.id, p_start: start2, p_word_list: newWords,
    });
    if (eR) { fail(`rematch: ${eR.message}`); return; }
    matchId = nextId;
    wordList.splice(0, wordList.length, ...newWords);
    log(`Rematch → ${matchId}`);

    // Verify carry-over (host + opted-in)
    const { data: nextLobby } = await host.sb.from("coop_players").select("*").eq("match_id", matchId);
    nextLobby.length >= PLAYER_COUNT - 1
      ? ok(`Rematch carried ${nextLobby.length} players`)
      : fail(`Only ${nextLobby.length} carried into rematch`);

    // Original (now-dropped) host should NOT be in next lobby
    nextLobby.find((p) => p.player_id === players[0].id)
      ? fail("Dropped host appeared in rematch lobby")
      : ok("Dropped host correctly excluded");
  }

  log(`\n========== Stress test complete: ${failures === 0 ? "PASS ✅" : `${failures} failure(s) ❌`} ==========`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("Crash:", e); process.exit(2); });
