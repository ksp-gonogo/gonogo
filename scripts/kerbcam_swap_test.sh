#!/usr/bin/env bash
# kerbcam_swap_test.sh — swap the deployed Kerbcam.dll (and TUFX profile)
# between pre-built test stages without rebuilding.
#
# Each stage corresponds to a kerbcam branch + a cached DLL in
# /tmp/kerbcam-test-artifacts/. Swapping in a new DLL requires a KSP
# restart — KSP loads plugin DLLs once at boot.
#
# Stages:
#   test1   main                            no TUFX, no Hullcam filters
#   test3   wip/test3-hullcam-filters       + HullcamVDS per-part filters
#   test4   wip/test4-tufx-on-top           + TUFX integration + bundled profile
#
# Usage:
#   ./scripts/kerbcam_swap_test.sh test1
#   ./scripts/kerbcam_swap_test.sh test3
#   ./scripts/kerbcam_swap_test.sh test4
#   ./scripts/kerbcam_swap_test.sh status
#
# settings.cfg is operator-owned; this script never touches it. The
# fields EnableHullcamEffects / EnableTUFX / TUFXProfile are silently
# ignored by older DLLs that don't know them, so a single settings.cfg
# works across all stages.

set -euo pipefail

ARTIFACTS_ROOT="/tmp/kerbcam-test-artifacts"
DEPLOY_ROOT="local_docs/syncthing/kspdata/GameData/Kerbcam"
DLL_DEST="$DEPLOY_ROOT/Plugins/Kerbcam.dll"
PROFILE_DEST="$DEPLOY_ROOT/TUFXProfiles/kerbcam.cfg"

case "${1:-}" in
  test1)
    SRC="$ARTIFACTS_ROOT/test1-baseline"
    HAS_PROFILE=0
    ;;
  test3)
    SRC="$ARTIFACTS_ROOT/test3-hullcam"
    HAS_PROFILE=0
    ;;
  test4)
    SRC="$ARTIFACTS_ROOT/test4-tufx"
    HAS_PROFILE=1
    ;;
  status)
    echo "Deployed DLL:"
    ls -la "$DLL_DEST" 2>/dev/null || echo "  (missing)"
    md5_dest=$(md5 -q "$DLL_DEST" 2>/dev/null || echo "n/a")
    echo "  md5=$md5_dest"
    echo
    echo "Cached artifacts:"
    for stage in test1-baseline test3-hullcam test4-tufx; do
      f="$ARTIFACTS_ROOT/$stage/Kerbcam.dll"
      if [ -f "$f" ]; then
        md5_src=$(md5 -q "$f")
        marker=""
        [ "$md5_src" = "$md5_dest" ] && marker="  ← deployed"
        printf "  %-15s  %s  %d bytes%s\n" "$stage" "$md5_src" "$(stat -f%z "$f")" "$marker"
      else
        printf "  %-15s  (missing)\n" "$stage"
      fi
    done
    exit 0
    ;;
  *)
    echo "Usage: $0 {test1|test3|test4|status}" >&2
    exit 1
    ;;
esac

if [ ! -f "$SRC/Kerbcam.dll" ]; then
  echo "Missing artifact: $SRC/Kerbcam.dll" >&2
  echo "Re-cache by checking out the branch and running ./scripts/gonogo_claude_tools.sh build kerbcam" >&2
  exit 1
fi

cp "$SRC/Kerbcam.dll" "$DLL_DEST"
echo "Deployed $1 DLL → $DLL_DEST ($(stat -f%z "$DLL_DEST") bytes)"

if [ "$HAS_PROFILE" = "1" ]; then
  cp "$SRC/kerbcam.cfg" "$PROFILE_DEST"
  echo "Deployed TUFX profile → $PROFILE_DEST"
else
  if [ -f "$PROFILE_DEST" ]; then
    echo "Note: $PROFILE_DEST is present from a previous test4 swap."
    echo "      Harmless when TUFXProfile is empty in settings.cfg, but"
    echo "      delete it if you want a clean test1/test3."
  fi
fi

echo
echo "Restart KSP for the new DLL to take effect."
