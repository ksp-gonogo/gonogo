#!/usr/bin/env bash
# Usage: ci-dev-catch-up.sh <sha>
#
# Brings `ci-dev` up to <sha>, a commit on `staging` that ci-dev lacks, so the
# next forward from ci-dev to staging is still a fast-forward. ci-dev is
# fast-forwarded when it is an ancestor of <sha>; when it holds work staging has
# not received yet, <sha> is merged into it instead, so ci-dev still contains
# every commit on staging. Nothing is forced. Prints what it did; exits 0 when
# ci-dev already contains <sha> or now does, and 1 when the merge conflicts,
# leaving ci-dev untouched.
#
# Runs in a checkout whose `origin` can be pushed to, with a git identity set.
set -euo pipefail

sha="${1:?usage: ci-dev-catch-up.sh <sha>}"

git fetch --no-tags origin ci-dev
if git merge-base --is-ancestor "$sha" FETCH_HEAD; then
  echo "ci-dev already contains $sha."
  exit 0
fi
if git merge-base --is-ancestor FETCH_HEAD "$sha"; then
  git push origin "$sha:refs/heads/ci-dev"
  echo "ci-dev fast-forwarded to $sha."
  exit 0
fi
git checkout -q -B ci-dev-catch-up FETCH_HEAD
if ! git merge --no-edit -m "Merge staging into ci-dev" "$sha"; then
  git merge --abort || true
  echo "could not merge $sha into ci-dev: merge staging into ci-dev by hand"
  exit 1
fi
git push origin HEAD:refs/heads/ci-dev
echo "$sha merged into ci-dev."
