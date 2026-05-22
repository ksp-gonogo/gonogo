#!/usr/bin/env bash
# kerbcam baseline harness — current OCISLY+gonogo performance measurement,
# plus the kerbcam comparison condition.
#
# See local_docs/kerbcam/baseline_harness_plan.md for the full design.
#
# Conditions × the same kOS-piloted flight profile (~120s each):
#
#   A. no-mods            OCISLY DLL renamed out of GameData
#   B. mods-attached      OCISLY loaded, cameras placed, StreamingEnabled = false
#   C. mods-streaming     OCISLY loaded, cameras placed, StreamingEnabled = true
#                         (set AutoStream=true in settings.cfg for auto-enable on
#                         vessel load, or click "Enable streaming" per camera)
#   D. kerbcam-streaming  Kerbcam DLL loaded, sidecar reachable, operator has
#                         subscribed all cameras (typically via the sidecar test
#                         page at http://<sidecar-host>:8088/). OCISLY may be
#                         loaded or not — not checked by this condition.
#
# No relay, no OCISLY server, no gonogo browser needed. The expensive KSP-side
# work (ReadPixels + EncodeToJPG) runs every frame when StreamingEnabled = true
# regardless of whether anyone receives the JPEG. Send failures just back off
# silently. This keeps the baseline focused on game-side framerate impact.
#
# Each condition runs the same kOS boot script (test_assets/baseline.ks):
#   60s static on the pad, then 60s gravity-turn launch (90° -> 45°). Stage
#   events emit [BASELINE-STAGE] markers we correlate with frame drops.
#
# Subcommands:
#   setup <condition>        Verify prerequisites for the given condition.
#   toggle-ocisly off|on     Rename the syncthing-tree OCISLY DLL out/in for no-mods.
#   run <condition>          Run one condition end-to-end (fires AG1, samples, writes JSON).
#   diff <fileA> <fileB>     Compare two reports.
#
# Operator flow:
#   1. Load preset save with kerbcam-baseline rocket on launchpad
#      (boot_baseline.ks auto-runs and logs [BASELINE-READY]).
#   2. For each of the three conditions:
#      a. no-mods only: ./kerbcam_baseline.sh toggle-ocisly off, restart KSP
#      b. mods-attached: ensure AutoStream=false in settings.cfg (or no manual
#         Enable Streaming clicks), restart KSP
#      c. mods-streaming: ensure AutoStream=true in settings.cfg (or click
#         Enable Streaming per camera in OCISLY's GUI), restart KSP
#      d. ./kerbcam_baseline.sh run <condition>
#   3. ./kerbcam_baseline.sh toggle-ocisly on    (restore)

set -euo pipefail

# --- config ---
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TELE_HOST="${TELE_HOST:-http://192.168.86.33:8085}"
OCISLY_CSV="${OCISLY_CSV:-$ROOT/local_docs/syncthing/kspdata/GameData/OfCourseIStillLoveYou/baseline.csv}"
OCISLY_DLL="${OCISLY_DLL:-$ROOT/local_docs/syncthing/kspdata/GameData/OfCourseIStillLoveYou/Plugins/OfCourseIStillLoveYou.dll}"
KERBCAM_DLL="${KERBCAM_DLL:-$ROOT/local_docs/syncthing/kspdata/GameData/Kerbcam/Plugins/Kerbcam.dll}"
KERBCAM_SIDECAR_HOST="${KERBCAM_SIDECAR_HOST:-http://192.168.86.33:8088}"
KOS_LOG="${KOS_LOG:-$ROOT/local_docs/syncthing/kspdata/Ships/Script/baseline.log}"
BASELINES_DIR="$ROOT/local_docs/kerbcam/perf_baselines"
TELE_POLL_MS=250
KOS_TIMEOUT_S=420  # generous default — heavy laggy runs (game-time slipping
                   # at <25 fps) take longer in wall-clock than the script's
                   # 120 s of game-time. Override with KOS_TIMEOUT_S env var.

# --- helpers ---
log() { echo "[$(date +%H:%M:%S)] $*" >&2; }
err() { echo "[ERROR] $*" >&2; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { err "missing required command: $1"; exit 3; }
}

require_baseline_env() {
  for c in curl jq websocat; do require_cmd "$c"; done
}

tele_get() {
  local key="$1"
  local enc="${key//\[/%5B}"
  enc="${enc//\]/%5D}"
  curl -sf "$TELE_HOST/telemachus/datalink?${enc}=${enc}" || echo "{}"
}

tele_action() {
  local key="$1"
  local enc="${key//\[/%5B}"
  enc="${enc//\]/%5D}"
  curl -sf "$TELE_HOST/telemachus/datalink?a=${enc}" >/dev/null
}

# --- subcommands ---

cmd_toggle_ocisly() {
  # The DLL is moved OUT of the synced GameData tree entirely to a sibling
  # holding directory inside kspdata/. KSP scans GameData/**/*.dll, so an
  # in-place rename can be misread if KSP's loader cached state or if a sync
  # race left both names visible briefly. Out-of-GameData is unambiguous.
  local holding_dir="$ROOT/local_docs/syncthing/kspdata/_kerbcam_holding"
  local holding_dll="$holding_dir/OfCourseIStillLoveYou.dll"
  # Tolerate the older in-place .disabled rename for backwards compatibility.
  local legacy_disabled="${OCISLY_DLL}.disabled"
  local mode="${1:-}"
  case "$mode" in
    off)
      mkdir -p "$holding_dir"
      if [ -f "$OCISLY_DLL" ]; then
        mv "$OCISLY_DLL" "$holding_dll"
        log "OCISLY DLL moved to $holding_dll (syncthing will mirror)"
        log "RESTART KSP before running 'no-mods' condition."
      elif [ -f "$legacy_disabled" ]; then
        mv "$legacy_disabled" "$holding_dll"
        log "OCISLY DLL was at legacy .disabled location; moved to $holding_dll"
        log "RESTART KSP before running 'no-mods' condition."
      elif [ -f "$holding_dll" ]; then
        log "OCISLY already disabled (held at $holding_dll) — nothing to do."
      else
        err "no OfCourseIStillLoveYou.dll found in Plugins or holding dir"
        return 4
      fi
      ;;
    on)
      if [ -f "$holding_dll" ]; then
        mv "$holding_dll" "$OCISLY_DLL"
        log "OCISLY DLL restored from holding"
      elif [ -f "$legacy_disabled" ]; then
        mv "$legacy_disabled" "$OCISLY_DLL"
        log "OCISLY DLL restored from legacy .disabled name"
      elif [ -f "$OCISLY_DLL" ]; then
        log "OCISLY already enabled — nothing to do."
      else
        err "no OCISLY DLL found in holding or legacy locations"
        return 4
      fi
      ;;
    *)
      echo "usage: kerbcam_baseline.sh toggle-ocisly off|on"
      exit 2
      ;;
  esac
}

cmd_setup() {
  local condition="${1:-}"
  require_baseline_env

  log "checking Telemachus reachable at $TELE_HOST"
  if ! curl -sf "$TELE_HOST/telemachus/datalink?p=p.paused" >/dev/null; then
    err "Telemachus not reachable at $TELE_HOST"
    return 4
  fi
  log "Telemachus OK"

  log "checking t.unscaledDeltaTime key present"
  local val
  val="$(tele_get "t.unscaledDeltaTime" | jq -r '.["t.unscaledDeltaTime"] // empty')"
  if [ -z "$val" ]; then
    err "t.unscaledDeltaTime not registered — rebuild Telemachus with the kerbcam patch"
    return 4
  fi
  log "Telemachus key OK ($val s/frame)"

  log "checking kOS boot script has armed (looking for [BASELINE-READY] in $KOS_LOG)"
  if [ ! -f "$KOS_LOG" ]; then
    err "kOS log not found at $KOS_LOG — confirm boot_baseline.ks is installed and the scene loaded"
    return 4
  fi
  if ! grep -q '\[BASELINE-READY\]' "$KOS_LOG"; then
    err "[BASELINE-READY] not in kOS log — script may not have armed yet, or wrong vessel"
    return 4
  fi
  log "kOS script armed"

  case "$condition" in
    no-mods)
      if [ -f "$OCISLY_DLL" ]; then
        err "no-mods condition requires OCISLY DLL disabled — run 'toggle-ocisly off' and restart KSP"
        return 4
      fi
      log "OCISLY disabled — OK for no-mods"
      ;;
    mods-attached|mods-streaming)
      if [ ! -f "$OCISLY_DLL" ]; then
        err "$condition requires OCISLY DLL enabled — run 'toggle-ocisly on' and restart KSP"
        return 4
      fi
      log "OCISLY enabled — OK for $condition"
      if [ "$condition" = "mods-streaming" ]; then
        # The OCISLY baseline.csv only gets written while StreamingEnabled is true.
        # We check it exists; if it's missing or hasn't grown recently, Enable
        # Streaming probably isn't toggled on the cameras.
        if [ ! -f "$OCISLY_CSV" ]; then
          err "mods-streaming requires OCISLY CSV at $OCISLY_CSV — confirm AutoStream=true or click Enable Streaming on each camera, then restart KSP"
          return 4
        fi
        local last_modified
        last_modified="$(stat -f %m "$OCISLY_CSV" 2>/dev/null || stat -c %Y "$OCISLY_CSV" 2>/dev/null || echo 0)"
        local now
        now="$(date +%s)"
        if [ "$((now - last_modified))" -gt 30 ]; then
          err "mods-streaming: OCISLY CSV hasn't been written in $((now - last_modified))s — confirm cameras are actively streaming"
          return 4
        fi
        log "OCISLY CSV is being written (cameras streaming)"
      fi
      ;;
    kerbcam-streaming)
      if [ ! -f "$KERBCAM_DLL" ]; then
        err "kerbcam-streaming requires Kerbcam DLL at $KERBCAM_DLL — confirm the plugin is deployed and KSP restarted"
        return 4
      fi
      log "Kerbcam DLL present — OK"
      local cams_json
      cams_json="$(curl -sf "$KERBCAM_SIDECAR_HOST/cameras" || echo '')"
      if [ -z "$cams_json" ]; then
        err "kerbcam sidecar not reachable at $KERBCAM_SIDECAR_HOST/cameras"
        return 4
      fi
      local cam_count
      cam_count="$(echo "$cams_json" | jq -r '.cameras | length')"
      if [ "$cam_count" -lt 1 ]; then
        err "kerbcam sidecar reachable but reports zero cameras"
        return 4
      fi
      log "kerbcam sidecar reachable, $cam_count cameras attached"
      log "(operator: confirm all $cam_count cameras are subscribed via $KERBCAM_SIDECAR_HOST/ before firing)"
      ;;
    *)
      err "unknown condition: $condition (use no-mods|mods-attached|mods-streaming|kerbcam-streaming)"
      return 2
      ;;
  esac
}

# Sample Telemachus t.unscaledDeltaTime over a duration into a JSONL file.
# Mirrors the working `tele subscribe` pattern from gonogo_claude_tools.sh:
# `-n` keeps stdin open for the duration of the subscription, `-t` forces
# text mode. Sending the subscribe payload via printf|pipe (not heredoc)
# means stdin stays attached to websocat so the connection persists past
# the initial message.
tele_sample_to() {
  local outfile="$1"
  local duration="$2"
  local payload="{\"+\":[\"t.unscaledDeltaTime\"],\"rate\":${TELE_POLL_MS}}"
  local ws_url="ws://${TELE_HOST#http://}/datalink"
  perl -e 'alarm shift; exec @ARGV' "$duration" sh -c \
    "printf '%s\n' '$payload' | websocat -n -t '$ws_url' > '$outfile'" \
    || true
}

# Wait for [BASELINE-DONE] in kOS log, return when found or timeout.
wait_for_kos_done() {
  local start
  start="$(date +%s)"
  local timeout="$1"
  while true; do
    if grep -q '\[BASELINE-DONE\]' "$KOS_LOG"; then return 0; fi
    if [ "$(($(date +%s) - start))" -ge "$timeout" ]; then
      err "timeout waiting for [BASELINE-DONE] after ${timeout}s"
      return 1
    fi
    sleep 1
  done
}

cmd_run() {
  local condition="${1:-}"
  if [ -z "$condition" ]; then
    echo "usage: kerbcam_baseline.sh run <no-mods|mods-attached|mods-streaming|kerbcam-streaming>"
    exit 2
  fi

  cmd_setup "$condition"

  local stamp
  stamp="$(date +%Y-%m-%d-%H%M)"
  local scene="${SCENE:-launchpad-5cam-v1}"
  local outdir
  outdir="$(mktemp -d)"
  # Expand $outdir at trap-definition time so the cleanup works after the
  # function scope exits (set -u would otherwise complain on the late expansion).
  trap "rm -rf '$outdir'" EXIT
  mkdir -p "$BASELINES_DIR"
  local report_file="$BASELINES_DIR/${stamp}-${scene}-${condition}.json"

  # Snapshot file positions so we only aggregate this run.
  local csv_start=0
  [ -f "$OCISLY_CSV" ] && csv_start="$(wc -l <"$OCISLY_CSV" | tr -d ' ')"
  local kos_start
  kos_start="$(wc -l <"$KOS_LOG" | tr -d ' ')"

  # Start Telemachus sampling in the background; will be killed when run ends.
  log "starting Telemachus sample stream"
  tele_sample_to "$outdir/tele.jsonl" "$KOS_TIMEOUT_S" &
  local tele_pid=$!

  # Kerbcam-only: clear the sidecar's in-memory status-log ring so the
  # post-run /dumpLogs returns exactly this run's snapshots. Other
  # conditions skip silently (sidecar may not even be running).
  if [ "$condition" = "kerbcam-streaming" ]; then
    log "resetting sidecar /dumpLogs buffer"
    perl -e 'alarm shift; exec @ARGV' 5 \
      curl -sf -X POST "$KERBCAM_SIDECAR_HOST/dumpLogs/reset" >/dev/null \
      || log "WARNING: /dumpLogs/reset failed; status log may include pre-run state"
  fi

  log "firing AG1 to start kOS script"
  # Explicit True (not bare f.ag1 which is a toggle) — idempotent
  # regardless of whether a prior run left ag1 latched. The kOS
  # script only WAITS UNTIL AG1, so re-firing True when it's already
  # True is a no-op anyway.
  tele_action "f.ag1[True]"

  log "sampling until [BASELINE-DONE] (timeout ${KOS_TIMEOUT_S}s)..."
  wait_for_kos_done "$KOS_TIMEOUT_S" || true
  # Give tele sample a beat to drain, then kill.
  sleep 2
  kill "$tele_pid" 2>/dev/null || true
  wait "$tele_pid" 2>/dev/null || true

  # Kerbcam-only: pull the sidecar's buffered status log AFTER
  # BASELINE-DONE so we get the full kspFps / shedLevel / per-camera
  # render-size timeline without polling during the measurement window.
  if [ "$condition" = "kerbcam-streaming" ]; then
    log "fetching sidecar /dumpLogs"
    perl -e 'alarm shift; exec @ARGV' 10 \
      curl -sf "$KERBCAM_SIDECAR_HOST/dumpLogs" > "$outdir/kerbcam-status.json" \
      || log "WARNING: /dumpLogs fetch failed; sidecar status log absent"
  fi

  # Slice the kOS log to this run's events.
  tail -n +"$((kos_start + 1))" "$KOS_LOG" > "$outdir/kos.log"

  # OCISLY CSV slice (empty for no-mods + mods-attached; only mods-streaming
  # produces samples).
  if [ -f "$OCISLY_CSV" ]; then
    tail -n +"$((csv_start + 1))" "$OCISLY_CSV" > "$outdir/ocisly.csv"
  fi

  log "=== aggregating ==="

  # Game framerate stats from Telemachus stream.
  local game_stats='{"mean":0,"p50":0,"p95":0,"samples":0}'
  if [ -s "$outdir/tele.jsonl" ]; then
    game_stats="$(jq -s '
      [.[] | ."t.unscaledDeltaTime" // empty | select(. > 0) | (1.0/.)] as $fps
      | if ($fps | length) == 0 then {mean:0,p50:0,p95:0,samples:0}
        else {
          mean: ($fps | add / length),
          p50:  ($fps | sort | .[length/2|floor]),
          p95:  ($fps | sort | .[(length*0.95)|floor]),
          samples: ($fps | length)
        }
        end' "$outdir/tele.jsonl")"
  fi

  # Stage event timestamps (mission-time seconds since start).
  local stage_events='[]'
  if [ -s "$outdir/kos.log" ]; then
    stage_events="$(grep -E '\[BASELINE-(START|PAD-DONE|STAGE|DONE)\]' "$outdir/kos.log" \
      | sed -E 's/^.*\[BASELINE-([A-Z-]+)\].*mt=([0-9.]+).*$/{"event":"\1","mission_time_s":\2}/' \
      | jq -s '.')"
  fi

  # OCISLY per-camera stats.
  local ocisly_per_cam='{}'
  if [ -s "$outdir/ocisly.csv" ]; then
    ocisly_per_cam="$(awk -F, '
      { encode[$3] = encode[$3] ? encode[$3] "," $4 : $4
        bytes[$3]  = bytes[$3]  ? bytes[$3]  "," $5 : $5
        count[$3]++ }
      END {
        printf "{"
        sep=""
        for (cam in count) {
          printf "%s\"%s\":{\"encode_ms_samples\":[%s],\"jpeg_bytes_samples\":[%s],\"frames\":%d}",
            sep, cam, encode[cam], bytes[cam], count[cam]
          sep=","
        }
        printf "}"
      }' "$outdir/ocisly.csv" | jq '
        with_entries(
          .value |= {
            frames: .frames,
            encode_ms: {
              p50: (.encode_ms_samples | sort | .[length/2|floor] // 0),
              p95: (.encode_ms_samples | sort | .[(length*0.95)|floor] // 0)
            },
            jpeg_size_kb: {
              p50: ((.jpeg_bytes_samples | sort | .[length/2|floor] // 0) / 1024),
              p95: ((.jpeg_bytes_samples | sort | .[(length*0.95)|floor] // 0) / 1024)
            }
          }
        )')"
  fi

  local gonogo_sha
  gonogo_sha="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"

  jq -n \
    --arg started_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg scene "$scene" \
    --arg condition "$condition" \
    --arg gonogo_sha "$gonogo_sha" \
    --argjson game_fps "$game_stats" \
    --argjson stage_events "$stage_events" \
    --argjson ocisly "$ocisly_per_cam" \
    '{
      schema_version: "3",
      run: {
        started_at: $started_at,
        scene: $scene,
        condition: $condition,
        gonogo_sha: $gonogo_sha,
        ksp_host: "Deck"
      },
      game_fps: $game_fps,
      stage_events: $stage_events,
      ocisly_per_camera: $ocisly
    }' > "$report_file"

  # Preserve raw slices alongside the report — the next run's boot script
  # truncates baseline.log, and OCISLY's CSV just keeps appending across runs;
  # without snapshots we can't re-aggregate or correlate later.
  local report_base="${report_file%.json}"
  cp "$outdir/kos.log" "${report_base}.kos.log" 2>/dev/null || true
  [ -s "$outdir/ocisly.csv" ] && cp "$outdir/ocisly.csv" "${report_base}.ocisly.csv"
  [ -s "$outdir/tele.jsonl" ] && cp "$outdir/tele.jsonl" "${report_base}.tele.jsonl"
  [ -s "$outdir/kerbcam-status.json" ] && cp "$outdir/kerbcam-status.json" "${report_base}.kerbcam-status.json"

  log "report written: $report_file"
  echo "$report_file"
}

cmd_diff() {
  if [ "$#" -ne 2 ]; then
    echo "usage: kerbcam_baseline.sh diff <fileA> <fileB>"
    exit 2
  fi
  local a="$1" b="$2"
  jq -s '
    def fps(x): x.game_fps.mean // 0;
    def cond(x): x.run.condition // "?";
    {
      a: cond(.[0]), a_fps: fps(.[0]),
      b: cond(.[1]), b_fps: fps(.[1]),
      delta_fps: ((fps(.[1])) - (fps(.[0])))
    }' "$a" "$b"
}

# --- dispatch ---

print_help() {
  cat <<EOF
kerbcam_baseline.sh — current OCISLY+gonogo baseline harness

  setup <condition>          Verify prereqs for one of: no-mods, mods-attached,
                             mods-streaming, kerbcam-streaming.
  toggle-ocisly off|on       Rename the syncthing-tree OCISLY DLL for no-mods runs.
  run <condition>            Fire AG1, sample until [BASELINE-DONE], write JSON.
  diff <fileA> <fileB>       Compare two reports.

Env:
  TELE_HOST              KSP+Telemachus host. Default: http://192.168.86.33:8085
  OCISLY_DLL             Syncthing-tree OCISLY DLL path. Default under local_docs/syncthing/.
  OCISLY_CSV             Path to OCISLY-side baseline.csv. Default under syncthing tree.
  KERBCAM_DLL            Syncthing-tree Kerbcam DLL path. Default under local_docs/syncthing/.
  KERBCAM_SIDECAR_HOST   Sidecar HTTP base URL. Default: http://192.168.86.33:8088
  KOS_LOG                kOS log path inside syncthing tree.
  KOS_TIMEOUT_S          Hard cap waiting for [BASELINE-DONE]. Default: 420.
  SCENE                  Tag for report file. Default: launchpad-5cam-v1

Prereqs:
  * KSP running on Deck with the baseline rocket on launchpad, kOS booted.
  * Boot script local_docs/kerbcam/test_assets/baseline.ks copied into KSP's
    Ships/Script/ as boot_baseline.ks (or any name beginning with 'boot_').
  * For mods-* conditions: gonogo_claude_tools.sh build ocisly --baseline,
    then gonogo_claude_tools.sh build telemachus, then restart KSP.
  * For mods-streaming: AutoStream=true in settings.cfg, OR click "Enable
    streaming" on each camera in OCISLY's in-game GUI before running. The
    setup subcommand checks the OCISLY CSV is being written.
  * For kerbcam-streaming: Kerbcam DLL deployed, sidecar running on Deck,
    operator has the sidecar test page (KERBCAM_SIDECAR_HOST/) open with
    every camera subscribed (Connect button) before firing. The setup
    subcommand verifies the sidecar is reachable and reports the camera
    count but cannot tell whether the test page is actually consuming
    the streams — that's on the operator to confirm visually.
  * No relay, no OCISLY server needed.
EOF
}

case "${1:-help}" in
  setup) shift; cmd_setup "$@" ;;
  toggle-ocisly) shift; cmd_toggle_ocisly "$@" ;;
  run) shift; cmd_run "$@" ;;
  diff) shift; cmd_diff "$@" ;;
  help|--help|-h|"") print_help ;;
  *) err "unknown subcommand: $1"; print_help; exit 2 ;;
esac
