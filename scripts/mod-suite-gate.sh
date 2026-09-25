#!/bin/sh
# The C# half of the push gate: `dotnet test` over every *.Tests project
# mod/Gonogo.sln declares, when the push carries a change under `mod/`.
#
# Turbo cannot reach these suites under any configuration: it only runs tasks a
# workspace package.json declares, every `test` script in the tree is
# `vitest run`, and no workspace package exists under mod/Sitrep.* or
# mod/Gonogo*Uplink. Without this script the push path runs no C# at all, so a
# broken C# ratchet reaches staging green and is first seen by CI afterwards.
#
# `mod/` is the right trigger because every C# test that reads the tree roots
# itself at mod/Gonogo.sln and walks only inside mod/, and the `packages/` paths
# in mod/**/*.cs are all in doc comments. A change outside mod/ cannot break a C#
# suite, and paying several minutes on every push to prove it would get this
# hook bypassed.
#
# The project list is DERIVED from the solution rather than hand-listed, because
# a hand-list fails by silent omission: a new test project is gated by nothing
# until someone remembers to add it.
#
# EVERY path out of here that does not run the suites says NOT RUN. A gate that
# can decline quietly reports a skip as a pass.
#
# Skip for a quick push:   GONOGO_SKIP_MOD_SUITES=1 git push   (CI still runs them)
# Run with no mod/ change: GONOGO_FORCE_MOD_SUITES=1 sh scripts/mod-suite-gate.sh
set -u

ROOT="$(git rev-parse --show-toplevel)"
MOD="$ROOT/mod"

say() { echo "pre-push[mod]: $*"; }
not_run() { say "C# SUITES NOT RUN: $*"; exit 0; }

if [ "${GONOGO_SKIP_MOD_SUITES:-}" = "1" ]; then
  not_run "GONOGO_SKIP_MOD_SUITES=1 (CI's \`mod\` job still gates them)."
fi

# Base = the branch's merge target, resolved exactly as this hook's e2e block
# resolves it. FAIL CLOSED: when there is no base to diff against we cannot tell
# whether mod/ changed, so we run rather than guess the cheaper answer.
if [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ]; then
  BASE="origin/main"
else
  BASE="origin/staging"
fi
if [ "${GONOGO_FORCE_MOD_SUITES:-}" = "1" ]; then
  say "GONOGO_FORCE_MOD_SUITES=1, running the C# suites whatever changed."
elif git rev-parse --verify --quiet "$BASE" >/dev/null; then
  BASE="$(git merge-base HEAD "$BASE" 2>/dev/null || git rev-parse "$BASE")"
  if git diff --quiet "$BASE" HEAD -- mod; then
    not_run "no mod/ changes vs $(echo "$BASE" | cut -c1-9)."
  fi
  say "mod/ changed vs $(echo "$BASE" | cut -c1-9), running the C# suites..."
else
  say "no base ref to diff against, running the C# suites anyway."
fi

if ! command -v dotnet >/dev/null 2>&1; then
  say "✖ this push changes mod/ and \`dotnet\` is not on PATH, so the C# suites"
  say "  cannot run. Install the .NET 10 SDK, or push with"
  say "  GONOGO_SKIP_MOD_SUITES=1 and let CI's \`mod\` job be the only gate."
  exit 1
fi

# The KSP reference assemblies. Absent is the NORMAL case for a contributor
# without a KSP install and for any worktree, since local_docs is gitignored,
# so it is a reduced run rather than a failure. It is not silent: two suites
# drop sources at BUILD time when these are missing and then pass having tested
# nothing, which looks exactly like coverage.
#
# Resolution follows scripts/gonogo_claude_tools.sh: a worktree reads the main
# checkout's synced data through --git-common-dir rather than a symlink, because
# a symlink to 13GB of game data inside a prunable worktree puts that data one
# `git worktree remove` away from deletion.
DATA_ROOT="${GONOGO_DATA_ROOT:-$ROOT}"
if [ ! -d "$DATA_ROOT/local_docs/syncthing" ]; then
  _common="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  if [ -n "$_common" ] && [ -d "$(dirname "$_common")/local_docs/syncthing" ]; then
    DATA_ROOT="$(dirname "$_common")"
  fi
fi
KSP_GAMEDATA="${KSP_GAMEDATA:-$DATA_ROOT/local_docs/syncthing/kspdata/GameData}"
KSP_MANAGED="${KSP_MANAGED:-$DATA_ROOT/local_docs/syncthing/kspdata/KSP_Data/Managed}"

KSP_ARGS=""
REDUCED=""
if [ -f "$KSP_MANAGED/Assembly-CSharp.dll" ]; then
  KSP_ARGS="/p:KspManaged=$KSP_MANAGED"
else
  REDUCED="$REDUCED Gonogo.KSP.Tests(ConfigNode-ledger)"
fi
if [ -n "$REDUCED" ]; then
  say "⚠ KSP reference assemblies not found:"
  say "⚠   $KSP_GAMEDATA"
  say "⚠   $KSP_MANAGED"
  say "⚠ these suites will BUILD WITHOUT their KSP-linked sources and pass having"
  say "⚠ run none of them:$REDUCED"
  say "⚠ CI runs them against the ksp-managed reference set; this run does not."
fi

# `[^"]*Tests\.csproj`, with no dot before Tests, so the match includes
# Sitrep.Host.IntegrationTests as well as every `*.Tests` project. A derived list
# omits as quietly as a hand-written one when the derivation is wrong, which is
# why the agreement check below exists.
PROJECTS="$(sed -n 's/^Project(.*) = "[^"]*", "\([^"]*Tests\.csproj\)".*/\1/p' "$MOD/Gonogo.sln" | tr '\\' '/')"
if [ -z "$PROJECTS" ]; then
  say "✖ mod/Gonogo.sln declares no test project. Either the solution moved or"
  say "  this parse stopped matching it; a gate that finds nothing to run reports"
  say "  success, so this is an error rather than an empty pass."
  exit 1
fi

# A SECOND instrument, failing differently from the first. ci.yml's `mod` job
# hand-lists the same projects, and a hand-list misses a project added to the
# solution. Reading the solution fixes that direction and opens the opposite
# one: this parse can stop matching a project and report a clean run over the
# rest. Neither list can check itself, so they check each other, and any
# disagreement is an error here rather than a quiet difference in what two gates
# cover.
CI_PROJECTS="$(sed -n '/^ *projects=(/,/^ *)/p' "$ROOT/.github/workflows/ci.yml" |
  sed -n 's/^ *\([A-Za-z0-9._]*Tests\) *$/\1/p' | sort)"
SLN_PROJECTS="$(echo "$PROJECTS" | sed 's|.*/||; s|\.csproj$||' | sort)"
if [ "$CI_PROJECTS" != "$SLN_PROJECTS" ]; then
  say "✖ this gate and ci.yml's \`mod\` job disagree about which projects to test."
  say "  mod/Gonogo.sln: $(echo "$SLN_PROJECTS" | tr '\n' ' ')"
  say "  ci.yml:         $(echo "$CI_PROJECTS" | tr '\n' ' ')"
  say "  A project named by one and not the other is gated by that one alone."
  exit 1
fi

# Projects allowed a retry, each for a stated cause. The WS integration suite
# drives a real socket server under wall-clock budgets, so a loaded machine can
# time out a correct test; every other project gets one attempt, because a
# blanket retry would also absorb a genuinely flaky new test. A pass that needed
# a retry is printed as such, never as a plain "ok".
RETRIED="Sitrep.Host.IntegrationTests"
ATTEMPTS=3

LOG="$(mktemp -t gonogo-modgate)"
trap 'rm -f "$LOG"' EXIT
COUNT=0
FLAKED=""
for proj in $PROJECTS; do
  name="$(basename "$proj" .csproj)"
  extra=""
  [ "$name" = "Gonogo.KSP.Tests" ] && extra="$KSP_ARGS"
  allowed=1
  case " $RETRIED " in *" $name "*) allowed=$ATTEMPTS ;; esac
  start="$(date +%s)"
  attempt=1
  # shellcheck disable=SC2086  # $extra is one optional /p: argument or empty
  until (cd "$MOD" && dotnet test "$proj" --configuration Release $extra --nologo) > "$LOG" 2>&1; do
    if [ "$attempt" -ge "$allowed" ]; then
      cat "$LOG"
      say "✖ $name FAILED after $attempt attempt(s) (this is what CI's \`mod\` job would have caught)."
      exit 1
    fi
    say "  ⚠ $name failed attempt $attempt/$allowed, retrying. What failed, before the retry replaces it:"
    grep -E "\[FAIL\]|^Failed!" "$LOG" | head -10 | sed "s/^/pre-push[mod]:     /"
    attempt=$((attempt + 1))
  done
  COUNT=$((COUNT + 1))
  if [ "$attempt" -gt 1 ]; then
    FLAKED="$FLAKED $name(attempt $attempt)"
    say "  ⚠ $name passed only on attempt $attempt ($(( $(date +%s) - start ))s)"
  else
    say "  $name ok ($(( $(date +%s) - start ))s)"
  fi
done

if [ -n "$FLAKED" ]; then
  say "⚠ passed only on retry:$FLAKED"
fi
if [ -n "$REDUCED" ]; then
  say "C# suites green: $COUNT projects, but REDUCED:$REDUCED ran without their KSP-linked sources."
else
  say "C# suites green: $COUNT projects, KSP-linked sources included."
fi
