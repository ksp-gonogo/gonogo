#!/usr/bin/env bash
# Usage: ci-dev-forward-verdict.sh <owner/repo> <sha>
#
# Exits 0 only when every CI run of <sha> has reached a verdict and that verdict
# is green: at least one run concluded `success`, none is queued or in progress,
# and none concluded anything but `success` or `cancelled`. Every event and
# branch counts, so a red `workflow_dispatch` retry of the same commit refuses
# too. Prints one line per run, then the verdict; exits 1 on a refusal and 2 when
# the run list cannot be read whole.
#
# `cancelled` is not a verdict on the tree: ci.yml's concurrency group cancels
# the earlier of two copies of one trigger, and the copy that survives still has
# to finish green on its own. A run that FAILED stays in the list whatever ran
# after it, so a flaky test cannot land by being run again until it passes. A
# re-run ATTEMPT replaces its run's conclusion, which is a person's decision and
# not something this can tell apart.
#
# A green run is not enough either: a ratchet-style gate (face, render, minsize)
# may fail on ci-dev without failing the run, and the commit then carries a
# `ci/verdict` status that says amber. An amber commit is refused here, so it
# stays on ci-dev until a later commit is green.
#
# A commit the operator stopped carries a failing `ci/hold` status, and every head that contains one is refused too, until the status is replaced by a passing one.
set -euo pipefail

repo="${1:?usage: ci-dev-forward-verdict.sh <owner/repo> <sha>}"
sha="${2:?usage: ci-dev-forward-verdict.sh <owner/repo> <sha>}"

runs="$(gh api "repos/$repo/actions/workflows/ci.yml/runs?head_sha=$sha&per_page=100")" || {
  echo "refusing: could not list the CI runs of $sha"
  exit 2
}

total="$(jq '.total_count' <<<"$runs")"
listed="$(jq '.workflow_runs | length' <<<"$runs")"
if [ "$total" != "$listed" ]; then
  echo "refusing: $total CI runs exist for $sha but $listed were listed"
  exit 2
fi

jq -r '.workflow_runs[] | "  run \(.id) \(.event) on \(.head_branch): \(.status) \(.conclusion // "-")"' <<<"$runs"

pending="$(jq '[.workflow_runs[] | select(.status != "completed")] | length' <<<"$runs")"
red="$(jq '[.workflow_runs[] | select(.status == "completed" and .conclusion != "success" and .conclusion != "cancelled")] | length' <<<"$runs")"
green="$(jq '[.workflow_runs[] | select(.status == "completed" and .conclusion == "success")] | length' <<<"$runs")"

if [ "$pending" -gt 0 ]; then
  echo "refusing: $pending CI run(s) of $sha have not finished"
  exit 1
fi
if [ "$red" -gt 0 ]; then
  echo "refusing: $red CI run(s) of $sha did not pass"
  exit 1
fi
if [ "$green" -eq 0 ]; then
  echo "refusing: no CI run of $sha passed"
  exit 1
fi
grade="$(gh api "repos/$repo/commits/$sha/statuses?per_page=100" --jq '[.[] | select(.context == "ci/verdict")][0].description // ""')" || {
  echo "refusing: could not read the statuses of $sha"
  exit 2
}
case "$grade" in
  *amber:*)
    echo "refusing: $sha is amber ($grade), so it is not forwarded until a later commit is green"
    exit 1
    ;;
esac
range="$(git rev-list --max-count=100 "origin/staging..$sha" 2>/dev/null || true)"
for commit in $range; do
  hold="$(gh api "repos/$repo/commits/$commit/statuses?per_page=100" --jq '[.[] | select(.context == "ci/hold")][0] | select(.state == "failure") | .description // "held"' 2>/dev/null || true)"
  if [ -n "$hold" ]; then
    echo "refusing: $commit is held back ($hold), so no head that contains it is forwarded"
    exit 1
  fi
done
echo "every CI run of $sha that reached a verdict passed ($green green)"
