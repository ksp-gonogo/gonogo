#!/bin/sh
# The C# half of the push gate: `dotnet test` over every *.Tests project
# mod/Gonogo.sln declares, when the push carries a change under `mod/`.
#
# The push gate could not see the C# suites AT ALL, and not as an omission a
# flag could close: turbo only runs tasks declared in a workspace package.json,
# every `test` script in the tree is `vitest run`, and no workspace package
# exists under mod/Sitrep.* or mod/Gonogo*Uplink. So `turbo run test test:scans`
# is structurally incapable of reaching them. Two C# ratchets broke on the
# RealAntennas departure and both landed on staging green: one was found hours
# later by an agent doing unrelated work, one turned CI red after it landed.
#
# WHY `mod/` IS THE RIGHT TRIGGER, and it was checked rather than assumed: every
# C# test that reads the tree roots itself at mod/Gonogo.sln and walks only
# inside mod/. The `packages/` paths that appear in mod/**/*.cs are all in doc
# comments. So a change that cannot touch mod/ cannot break a C# suite, and
# paying four minutes on every push to prove that would be the surest way to get
# this hook bypassed.
#
# The project list is DERIVED from the solution, never hand-listed. ci.yml's
# `mod` job hand-lists the same eleven and its own header records four projects
# that drifted in over four weeks and were gated by nothing, because the failure
# mode of a hand-list is silent omission.
#
# EVERY path out of here that does not run the suites says NOT RUN. A gate that
# can decline quietly reports a skip as a pass, which is the failure this repo
# keeps paying for, and adding a new instance of it while fixing an old one
# would be worse than leaving the hole open.
#
# Skip for a quick push:  GONOGO_SKIP_MOD_SUITES=1 git push   (CI still runs them)
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
if git rev-parse --verify --quiet "$BASE" >/dev/null; then
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
# Resolution follows scripts/gonogo_claude_tools.sh, which already solved this:
# a worktree reads the main checkout's synced data through --git-common-dir
# rather than a symlink, because linking 13GB of game data into a directory that
# gets pruned is how that folder was lost once already.
DATA_ROOT="${GONOGO_DATA_ROOT:-$ROOT}"
if [ ! -d "$DATA_ROOT/local_docs/syncthing" ]; then
  _common="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  if [ -n "$_common" ] && [ -d "$(dirname "$_common")/local_docs/syncthing" ]; then
    DATA_ROOT="$(dirname "$_common")"
  fi
fi
KSP_GAMEDATA="${KSP_GAMEDATA:-$DATA_ROOT/local_docs/syncthing/kspdata/GameData}"
KSP_MANAGED="${KSP_MANAGED:-$DATA_ROOT/local_docs/syncthing/kspdata/KSP_Data/Managed}"

KOS_ARGS=""
KSP_ARGS=""
REDUCED=""
if [ -f "$KSP_GAMEDATA/kOS/Plugins/kOS.dll" ] && [ -f "$KSP_GAMEDATA/kOS/Plugins/kOS.Safe.dll" ]; then
  KOS_ARGS="/p:KspGameData=$KSP_GAMEDATA"
else
  REDUCED="$REDUCED GonogoKosUplink.Tests(headless-terminal-harness)"
fi
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

# `[^"]*Tests\.csproj`, with no dot before Tests: the first spelling of this
# pattern required `.Tests.csproj` and silently dropped
# Sitrep.Host.IntegrationTests, the project carrying 161 of the run's 276
# seconds and one of the two suites this gate exists because of. A derived list
# omits as quietly as a hand-written one when the derivation is wrong, which is
# why the agreement check below is here and not a tidiness.
PROJECTS="$(sed -n 's/^Project(.*) = "[^"]*", "\([^"]*Tests\.csproj\)".*/\1/p' "$MOD/Gonogo.sln" | tr '\\' '/')"
if [ -z "$PROJECTS" ]; then
  say "✖ mod/Gonogo.sln declares no test project. Either the solution moved or"
  say "  this parse stopped matching it; a gate that finds nothing to run reports"
  say "  success, so this is an error rather than an empty pass."
  exit 1
fi

# A SECOND instrument, failing differently from the first. ci.yml's `mod` job
# hand-lists the same projects and its own header records four that drifted into
# the solution over four weeks and were gated by nothing. Reading the solution
# fixes that direction and opens the opposite one: this parse can stop matching
# a project and report a clean run over the rest. Neither list can check itself,
# so they check each other, and any disagreement is an error here rather than a
# quiet difference in what two gates cover.
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

LOG="$(mktemp -t gonogo-modgate)"
trap 'rm -f "$LOG"' EXIT
COUNT=0
for proj in $PROJECTS; do
  name="$(basename "$proj" .csproj)"
  extra=""
  [ "$name" = "GonogoKosUplink.Tests" ] && extra="$KOS_ARGS"
  [ "$name" = "Gonogo.KSP.Tests" ] && extra="$KSP_ARGS"
  start="$(date +%s)"
  # shellcheck disable=SC2086  # $extra is one optional /p: argument or empty
  if ! (cd "$MOD" && dotnet test "$proj" --configuration Release $extra --nologo) > "$LOG" 2>&1; then
    cat "$LOG"
    say "✖ $name FAILED (this is what CI's \`mod\` job would have caught)."
    exit 1
  fi
  COUNT=$((COUNT + 1))
  say "  $name ok ($(( $(date +%s) - start ))s)"
done

if [ -n "$REDUCED" ]; then
  say "C# suites green: $COUNT projects, but REDUCED:$REDUCED ran without their KSP-linked sources."
else
  say "C# suites green: $COUNT projects, KSP-linked sources included."
fi
