#!/usr/bin/env bash
# Prints the commit the shrink-only ratchets should grade this checkout against.
#
# Every one of those gates reads its debt list at a base revision with
# `git show <ref>:<path>` and diffs it. Get the base wrong and there is no
# diff, and for as long as these gates have existed the base in CI was wrong in
# both available ways: `actions/checkout` clones at depth 1 so no remote ref
# existed at all, and had one existed on a push to `staging` it would have been
# the pushed commit itself, which a debt list can only ever match.
#
# So the base is different per trigger, and neither answer is `origin/<branch>`:
#
#   push            the branch tip BEFORE this push (github.event.before), which
#                   is the last state that was already graded. `origin/staging`
#                   on a staging push IS the subject, and comparing a file with
#                   itself reports "unchanged" forever
#   pull_request    the branch's fork point, not the target's tip: commits
#                   landing on the target while the PR is open are not this
#                   branch's growth to answer for. Taken as the LATER of the
#                   merge base with the target and the merge base with staging,
#                   because branches here are cut from staging and PR'd at main,
#                   and main trails staging by a whole release. Against main's
#                   merge base a PR would be graded from before any of these debt
#                   lists existed, so all five would find nothing to diff
#   workflow_dispatch  merge base with origin/staging, since the ref can be
#                   anything; falls back to HEAD^ when the ref IS staging
#
# Diagnostics go to stderr, the resolved sha alone to stdout, so a caller can
# read it with a command substitution.
#
# Usage:
#   base="$(bash scripts/resolve-ratchet-base-ref.sh)"
#   RATCHET_BASE_REF="$base" pnpm --filter @ksp-gonogo/core test

set -euo pipefail

ZERO_SHA="0000000000000000000000000000000000000000"
EVENT_NAME="${GITHUB_EVENT_NAME:-${EVENT_NAME:-local}}"
PUSH_BEFORE="${PUSH_BEFORE:-}"
PR_BASE_REF="${PR_BASE_REF:-${GITHUB_BASE_REF:-}}"

log() { echo "resolve-ratchet-base-ref: $*" >&2; }

head_sha="$(git rev-parse --verify HEAD)"
base=""

case "$EVENT_NAME" in
  pull_request | pull_request_target)
    if [ -z "$PR_BASE_REF" ]; then
      echo "::error::pull_request run with no base branch name; cannot resolve a ratchet base." >&2
      exit 1
    fi
    log "pull_request targeting $PR_BASE_REF, using the fork point"
    git fetch --no-tags --quiet origin "$PR_BASE_REF"
    base="$(git merge-base "$head_sha" FETCH_HEAD || true)"
    git fetch --no-tags --quiet origin staging || true
    via_staging="$(git merge-base "$head_sha" FETCH_HEAD 2>/dev/null || true)"
    # Never the checkout itself: a PR opened straight from the staging tip would
    # otherwise pick its own commit and grade nothing.
    if [ -n "$via_staging" ] && [ -n "$base" ] && [ "$via_staging" != "$head_sha" ] &&
      git merge-base --is-ancestor "$base" "$via_staging"; then
      log "staging's fork point ($via_staging) is later than $PR_BASE_REF's ($base)"
      base="$via_staging"
    fi
    ;;

  push)
    if [ -n "$PUSH_BEFORE" ] && [ "$PUSH_BEFORE" != "$ZERO_SHA" ] &&
      git cat-file -e "${PUSH_BEFORE}^{commit}" 2>/dev/null; then
      log "push, using the tip before it: $PUSH_BEFORE"
      base="$PUSH_BEFORE"
    else
      # A brand-new branch (before is all zeroes) or a force-push whose old tip
      # is gone. HEAD^ grades only the last commit rather than the whole push,
      # which understates the range but is still a real comparison, and it is
      # the only ancestor guaranteed to be here.
      log "push with no usable 'before' ($PUSH_BEFORE), falling back to HEAD^"
      base="$(git rev-parse --verify "${head_sha}^" 2>/dev/null || true)"
    fi
    ;;

  *)
    log "$EVENT_NAME, using the merge base with origin/staging"
    git fetch --no-tags --quiet origin staging || true
    base="$(git merge-base "$head_sha" FETCH_HEAD 2>/dev/null || true)"
    if [ -z "$base" ] || [ "$base" = "$head_sha" ]; then
      log "merge base is the checkout itself, falling back to HEAD^"
      base="$(git rev-parse --verify "${head_sha}^" 2>/dev/null || true)"
    fi
    ;;
esac

if [ -z "$base" ]; then
  echo "::error::No base revision could be resolved for a $EVENT_NAME run at $head_sha. The shrink-only ratchets cannot grade their debt lists without one, and skipping them looks exactly like passing. Check the checkout uses fetch-depth: 0." >&2
  exit 1
fi

base="$(git rev-parse --verify "${base}^{commit}")"

if [ "$base" = "$head_sha" ]; then
  echo "::error::The resolved base ($base) IS the commit under test, so every debt list would be diffed against itself and could only report 'unchanged'. On a push the base must be github.event.before, never origin/<the branch being pushed>." >&2
  exit 1
fi

log "base = $base (HEAD = $head_sha)"
echo "$base"
