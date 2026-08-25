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

# Every committed generated directory, DISCOVERED rather than listed.
#
# This used to be a hand-maintained array, and a hand-maintained list has no
# gate on its own completeness. It had already drifted by two:
# `GonogoRp1Uplink` and `GonogoPrincipiaUplink` were both created after the
# array was written and neither was added to it, so every run regenerated their
# output and hashed none of it. A hand-edit in either passed silently, which is
# precisely the state this script exists to make impossible.
#
# Discovery also runs on BOTH sides of the regeneration below, so a codegen run
# that creates a directory nobody has seen before shows up as a difference
# rather than as an absence.
generated_dirs() {
  find . \
    \( -name node_modules -o -name dist -o -name .git -o -name .claude \) -prune \
    -o -type d -name __generated__ -print |
    sed 's|^\./||' | sort
}

snapshot() {
  local dirs=()
  local dir
  while IFS= read -r dir; do dirs+=("$dir"); done < <(generated_dirs)
  # Sorted so the digest is stable, and missing paths are tolerated so a first
  # run on a clean checkout still works.
  find "${dirs[@]}" -type f 2>/dev/null | sort | xargs -r sha256sum
}

# A discovery that matches nothing hashes nothing, compares equal to itself and
# reports success, which is the exact shape of a gate that has gone blind. The
# number is a floor rather than an equality: adding an Uplink must not require
# editing this script, which was the whole problem.
DIR_COUNT="$(generated_dirs | wc -l | tr -d ' ')"
if [ "$DIR_COUNT" -lt 8 ]; then
  echo "✖ codegen check: found only $DIR_COUNT __generated__ director(y/ies)."
  echo "  That is fewer than this repo has ever had, so the discovery below is"
  echo "  broken rather than the tree being small. Refusing to report success."
  exit 1
fi

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
  git --no-pager diff -- $(generated_dirs) || true
  exit 1
fi
echo "codegen check: generated files are current ($DIR_COUNT directories)."
