#!/usr/bin/env bash
#
# CI-faithful visual-diff PREVIEW loop, in a container.
#
# The `visual-gate` (packages/components/scripts/visual-gate.ts) already renders
# every widget, diffs each against its committed baseline, and on drift writes
# baseline/actual/diff PNGs to local_docs/renders/_visual-gate-diffs/. This is a
# thin wrapper that runs that gate INSIDE the exact Linux image CI uses, so the
# diffs are faithful — a macOS-local gate run is pure font noise and useless for
# deciding whether a render legitimately changed.
#
#   scripts/visual-preview.sh --engine <chromium|firefox|webkit> [--widget <id>] [--update]
#
# PREVIEW (default): run the gate, surface the drift, print a SUMMARY (drifted
#   renders + host paths to their baseline/actual/diff PNGs) and exit 0 — drift
#   is the signal you asked for, not a failure. Share the PNGs, get an OK.
# UPDATE (--update): (re)write Linux-faithful, committable baselines to the host
#   (packages/components/visual-baselines/<engine>/). The post-confirm step.
#
# Prereqs:
#   • podman (default /opt/podman/bin/podman; override with $PODMAN).
#   • ~/.npmrc — mounted read-only into the container for registry auth. `pnpm
#     install` pulls @ksp-gonogo/kerbcast* from npm; ~/.npmrc carries the
#     @ksp-gonogo registry routing + token. (If those packages are ever moved to
#     GitHub Packages, ~/.npmrc would need a GH token / a GH_TOKEN env instead.)
#
# The container does its OWN Linux `pnpm install` into NAMED volumes (the host's
# node_modules are macOS-native — esbuild darwin binaries — and cannot be
# reused). First run is slow (full install); named volumes make re-runs fast.
# The host's node_modules are never touched (each is shadowed by a volume).
set -euo pipefail

PODMAN="${PODMAN:-/opt/podman/bin/podman}"
# MUST match pnpm-lock.yaml's resolved `playwright` version (= what CI's
# `visual` job installs). noble = 24.04 = ubuntu-latest. Bump both together.
PLAYWRIGHT_VERSION="1.60.0"
IMAGE="mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

STORE_VOL="gonogo-visualpreview-pnpm-store"
NM_PREFIX="gonogo-visualpreview-nm"

usage() {
  echo "usage: visual-preview.sh --engine <chromium|firefox|webkit> [--widget <id>] [--update]" >&2
  exit 2
}

ENGINE=""
WIDGET=""
UPDATE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --engine) ENGINE="${2:-}"; shift 2 ;;
    --widget) WIDGET="${2:-}"; shift 2 ;;
    --update) UPDATE=1; shift ;;
    -h|--help) usage ;;
    *) echo "unknown arg: $1" >&2; usage ;;
  esac
done
case "$ENGINE" in
  chromium|firefox|webkit) ;;
  *) echo "error: --engine must be chromium|firefox|webkit" >&2; usage ;;
esac

if [ ! -x "$PODMAN" ] && ! command -v "$PODMAN" >/dev/null 2>&1; then
  echo "error: podman not found at '$PODMAN' (set \$PODMAN)" >&2
  exit 2
fi
if [ ! -f "$HOME/.npmrc" ]; then
  echo "error: ~/.npmrc not found — needed for registry auth inside the container." >&2
  echo "       Run a local 'pnpm install' once, or create ~/.npmrc with the @ksp-gonogo registry + token." >&2
  exit 2
fi

# Shadow every workspace package's node_modules (root + globs) with its own
# named volume, so the container's Linux install lands in the volumes and the
# host's macOS node_modules are left untouched. (inject-workspace-packages=true
# means these are real copies, not symlinks — each must be shadowed.)
NM_MOUNTS=()
add_nm() {
  local dir="$1" target slug
  if [ "$dir" = "." ]; then
    target="/work/node_modules"; slug="root"
  else
    target="/work/$dir/node_modules"; slug="$(echo "$dir" | tr '/' '-')"
  fi
  NM_MOUNTS+=( -v "${NM_PREFIX}-${slug}:${target}" )
}
add_nm "."
for glob in "packages"/* "mod"/* "mod"/*/client; do
  [ -f "$REPO_ROOT/$glob/package.json" ] && add_nm "$glob"
done

# Assemble the in-container command.
GATE="pnpm --filter @ksp-gonogo/components visual-gate --engine $ENGINE"
[ -n "$WIDGET" ] && GATE="$GATE --widget $WIDGET"
[ "$UPDATE" = 1 ] && GATE="$GATE --update"
IN_CMD="set -e
corepack enable
echo '── pnpm install (frozen) ──'
pnpm install --frozen-lockfile --store-dir /pnpm-store
echo '── build render deps ──'
pnpm --filter '@ksp-gonogo/components...' build
echo '── visual-gate ──'
$GATE"

echo "image:  $IMAGE"
echo "engine: $ENGINE${WIDGET:+  widget: $WIDGET}$([ "$UPDATE" = 1 ] && echo '  MODE: update' || echo '  MODE: preview')"
echo "(first run installs Linux deps into named volumes — slow; re-runs are fast)"
echo

LOG="$(mktemp)"
set +e
"$PODMAN" run --rm \
  -v "$REPO_ROOT:/work" \
  -v "$STORE_VOL:/pnpm-store" \
  "${NM_MOUNTS[@]}" \
  -v "$HOME/.npmrc:/root/.npmrc:ro" \
  -w /work \
  "$IMAGE" bash -lc "$IN_CMD" 2>&1 | tee "$LOG"
GATE_EXIT="${PIPESTATUS[0]}"
set -e

# ── update mode: the gate's own exit is the verdict (0 = baselines written). ──
if [ "$UPDATE" = 1 ]; then
  rm -f "$LOG"
  exit "$GATE_EXIT"
fi

# ── preview mode: drift is expected. Distinguish it from a real (install/build)
#    failure so we never silently swallow those. ──
DIFF_DIR="$REPO_ROOT/local_docs/renders/_visual-gate-diffs/$ENGINE"
echo
echo "════════════ VISUAL PREVIEW SUMMARY ($ENGINE) ════════════"
if grep -q "✓ No visual drift." "$LOG"; then
  echo "CLEAN — no drift against the committed $ENGINE baselines."
  echo "(This is the faithfulness proof for an unchanged widget.)"
  rm -f "$LOG"
  exit 0
fi
if ! grep -q "visual difference(s):" "$LOG"; then
  echo "!! The gate did not complete (install/build/other error, exit $GATE_EXIT)."
  echo "   This is a REAL failure, not drift — see the log above."
  rm -f "$LOG"
  exit "${GATE_EXIT:-1}"
fi

# Drift (and/or missing baselines): enumerate the diff artifacts on the host.
count=0
if [ -d "$DIFF_DIR" ]; then
  while IFS= read -r diff; do
    [ -n "$diff" ] || continue
    count=$((count + 1))
    stem="${diff%.diff.png}"
    widget="$(basename "$(dirname "$diff")")"
    render="$(basename "$stem")"
    echo
    echo "DRIFT: ${widget}/${render}"
    echo "   baseline: ${stem}.baseline.png"
    echo "   actual:   ${stem}.actual.png"
    echo "   diff:     ${diff}"
  done < <(find "$DIFF_DIR" -name '*.diff.png' 2>/dev/null | sort)
fi
# Missing-baseline failures produce no diff PNGs — surface them from the log.
if grep -q "MISSING baseline:" "$LOG"; then
  echo
  echo "MISSING baselines (no committed baseline to diff against):"
  grep "MISSING baseline:" "$LOG" | sed 's/^/  /'
fi
echo
echo "${count} drifted render(s) with baseline/actual/diff PNGs above."
echo "Review, get an OK, then re-run with --update to write committable baselines."
rm -f "$LOG"
exit 0
