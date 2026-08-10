#!/usr/bin/env bash
# Regenerates every committed artifact and fails if the bytes on disk changed.
#
# Deliberately does NOT ask git. The obvious `git diff --exit-code` only
# inspects TRACKED files, so a newly added generated file is invisible to it:
# the check passes on a hand-edited artifact right up until someone commits it,
# which is when a gate is least useful. Switching to `git status --porcelain`
# fixed that and broke the opposite case, reporting a correctly staged
# first-land as dirty.
#
# Hashing sidesteps both. The question is "would regenerating change this
# file", and that has nothing to do with whether git has seen it yet.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PATHS=(
  mod/sitrep-sdk/src/__generated__
  packages/ui-kit/src/__generated__
  mod/GonogoMechJebUplink/client/src/__generated__
  mod/GonogoAvionicsUplink/client/src/__generated__
)

snapshot() {
  # Sorted so the digest is stable, and missing paths are tolerated so a first
  # run on a clean checkout still works.
  find "${PATHS[@]}" -type f 2>/dev/null | sort | xargs -r sha256sum
}

BEFORE="$(snapshot)"
bash mod/codegen.sh
node scripts/gen-unit-kinds.mjs
AFTER="$(snapshot)"

if [ "$BEFORE" != "$AFTER" ]; then
  echo
  echo "✖ Generated files were out of date or hand-edited. They have just been"
  echo "  regenerated: review and commit the result."
  echo
  diff <(echo "$BEFORE") <(echo "$AFTER") || true
  echo
  git --no-pager diff -- "${PATHS[@]}" || true
  exit 1
fi
echo "codegen check: generated files are current."
