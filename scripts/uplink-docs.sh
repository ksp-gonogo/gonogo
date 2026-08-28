#!/usr/bin/env bash
# Regenerate every client-bearing Uplink's page, or check that none has drifted.
#
#   scripts/uplink-docs.sh            write README.md, gonogo-uplink.json, docs/assets/
#   scripts/uplink-docs.sh --check    regenerate in memory and fail on any difference
#
# ## Why the check exists alongside the regenerate-on-main workflow
#
# `uplink-docs.yml` runs the write half on a push to main and commits the result
# back, so main heals itself. That is exactly why the check has to exist too: a
# workflow that silently fixes main means nobody ever sees a generator that has
# quietly stopped emitting a section. The self-heal keeps the pages right; the
# check keeps the SIGNAL, on the pull request, where a person is looking.
#
# ## Why the loop keeps going after a failure
#
# `docs --check` names the first line that differs, per Uplink, and a stale page
# is usually stale across several at once (a widget field added, a generator
# section changed). Stopping at the first would hide the shape of the change
# behind one Uplink's diff and take three CI runs to learn what one can say.
#
# Asset BYTES are deliberately not compared, only which assets exist:
# rasterisation is per-engine and per-OS, so a byte comparison would fail on
# every machine but the one that generated it. That policy lives in the CLI, not
# here.
#
# Needs chromium, and a built `@ksp-gonogo/ui-kit` dist, which
# `pnpm --filter '@ksp-gonogo/ui-kit...' build` provides.

set -uo pipefail
cd "$(dirname "$0")/.."

mode="${1:-}"
if [ -n "$mode" ] && [ "$mode" != "--check" ]; then
  echo "usage: scripts/uplink-docs.sh [--check]" >&2
  exit 2
fi

# A `while read` rather than `mapfile`, which bash 3.2 does not have: the runner
# is bash 5 and a macOS developer's shell is not, and a gate that only runs in CI
# is one nobody runs before pushing.
packages=()
while IFS= read -r pkg; do
  packages+=("$pkg")
done < <(node -e '
  const legs = JSON.parse(require("node:child_process").execFileSync(
    "node", ["scripts/uplink-matrix.mjs"], { encoding: "utf8" }));
  for (const leg of legs) if (leg.client) console.log(leg.pkg);
')

# A run that examines nothing exits clean, which is the failure mode this repo
# keeps meeting. The floor lives in uplink-matrix.mjs too, and is repeated here
# because a filter typo above would empty the list without the matrix noticing.
if [ "${#packages[@]}" -eq 0 ]; then
  echo "✖ discovered no client-bearing Uplink, so this ${mode:+checked}${mode:-generated} nothing and"
  echo "  would have exited clean. Discovery is broken rather than the repo being empty."
  exit 1
fi

failed=()
for pkg in "${packages[@]}"; do
  echo "── $pkg"
  # shellcheck disable=SC2086 # $mode is one optional flag, deliberately split
  if ! pnpm --filter "$pkg" exec gonogo-uplink docs $mode; then
    failed+=("$pkg")
  fi
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo
  if [ -n "$mode" ]; then
    echo "✖ ${#failed[@]} of ${#packages[@]} Uplink page(s) no longer describe the code:"
    for pkg in "${failed[@]}"; do
      echo "    $pkg"
    done
    echo
    echo "  Regenerate and commit the result. The page is derived, so the fix is never to edit it:"
    echo "    pnpm uplink-docs"
  else
    echo "✖ ${#failed[@]} of ${#packages[@]} Uplink page(s) could not be generated:"
    for pkg in "${failed[@]}"; do
      echo "    $pkg"
    done
  fi
  exit 1
fi

echo
if [ -n "$mode" ]; then
  echo "all ${#packages[@]} Uplink page(s) match the code."
else
  echo "all ${#packages[@]} Uplink page(s) regenerated."
fi
