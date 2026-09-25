#!/bin/sh
# The push gate's copy of CI's `mod` job: every step of that job that can run on
# a dev machine runs here before a push, and every one that cannot is named with
# the reason it cannot.
#
# Turbo cannot reach any of it under any configuration: it only runs tasks a
# workspace package.json declares, every `test` script in the tree is
# `vitest run`, and no workspace package exists under mod/Sitrep.* or
# mod/Gonogo*Uplink. Without this script the push path runs no C#, no codegen
# check and no package gate, so a change that breaks one reaches staging green
# and is first seen by CI afterwards.
#
# MOD_JOB_STEPS is the whole job, one line per `- name:` step of ci.yml's `mod`
# job in the job's order, and it is what this script executes.
# packages/core/src/mod-job-push-gate.test.ts fails when the two disagree in
# either direction, so a step added to the job is refused until this table says
# how the push path treats it. Each line is `<step name>|<treatment>`:
#
#   always:<fn>  run on every push, because its inputs span the tree or it is free
#   mod:<fn>     run when the push changes a path in MOD_TRIGGER
#   same:<name>  the named step's run already performs this one in full
#   ci:<reason>  cannot run here, and why
#
# EVERY path out of here that does not run a step says NOT RUN. A gate that can
# decline quietly reports a skip as a pass.
#
# Skip for a quick push:   GONOGO_SKIP_MOD_SUITES=1 git push   (CI still runs the job)
# Run with no mod/ change: GONOGO_FORCE_MOD_SUITES=1 sh scripts/mod-job-gate.sh
set -u

MOD_JOB_STEPS='pnpm install|ci:setup, and a push is made from a tree the turbo gate before this one has already needed installed
Every generated artifact is in sync with its source|always:codegen
Uplink client hashes are armed|always:client_hash
Checkout KSP reference assemblies|ci:fetches the private ksp-managed repo with a secret; here the reference set is the synced KSP install the next step finds
KSP reference assemblies are mandatory on main/staging and on PRs|mod:reference_set
Uplink plugin assemblies compile|mod:uplink_build
dotnet test (KSP-independent Sitrep projects)|mod:dotnet_test
Contract codegen is buildable and its committed output is current|same:Every generated artifact is in sync with its source
Pack and gate KspGonogo.Sitrep.Contract|mod:pack
Upload the NuGet package|ci:uploads the packed file as a run artifact and checks nothing
An Uplink builds against the packed contract|mod:probe
Which Uplinks build against the packed contract|ci:continue-on-error in the job, a report on each Uplink rather than a gate, so failing a push on it would hold the push to more than CI does'

# `mod/` because every C# test that reads the tree roots itself at
# mod/Gonogo.sln and walks only inside mod/, and the `packages/` paths in
# mod/**/*.cs are all in doc comments. `scripts/` because every step runs a
# script there and the probe's own subject Uplink lives there. ci.yml because it
# holds the project list and the reference-set list this script reads.
MOD_TRIGGER="mod scripts .github/workflows/ci.yml"

ROOT="$(git rev-parse --show-toplevel)"
MOD="$ROOT/mod"
CI_YML="$ROOT/.github/workflows/ci.yml"

say() { echo "pre-push[mod]: $*"; }

if [ "${GONOGO_SKIP_MOD_SUITES:-}" = "1" ]; then
  say "MOD JOB STEPS NOT RUN: GONOGO_SKIP_MOD_SUITES=1 (CI's \`mod\` job still gates them)."
  exit 0
fi

LOG="$(mktemp -t gonogo-modgate)"
WORK="$(mktemp -d -t gonogo-modgate-work)"
trap 'rm -rf "$LOG" "$WORK"' EXIT

# Runs a command with its output held back, and prints that output only when it
# fails. One line per step on success is what keeps the NOT RUN and REDUCED
# lines readable to the person pushing.
quiet() {
  "$@" > "$LOG" 2>&1 && return 0
  cat "$LOG"
  return 1
}

# Base = the branch's merge target, resolved exactly as the pre-push hook's e2e
# block resolves it. FAIL CLOSED: when there is no base to diff against we cannot
# tell whether a trigger path changed, so we run rather than guess the cheaper
# answer.
if [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ]; then
  BASE="origin/main"
else
  BASE="origin/staging"
fi
RUN_MOD=1
if [ "${GONOGO_FORCE_MOD_SUITES:-}" = "1" ]; then
  say "GONOGO_FORCE_MOD_SUITES=1, running every mod-job step whatever changed."
elif git rev-parse --verify --quiet "$BASE" >/dev/null; then
  BASE="$(git merge-base HEAD "$BASE" 2>/dev/null || git rev-parse "$BASE")"
  # shellcheck disable=SC2086  # MOD_TRIGGER is a list of pathspecs
  if git diff --quiet "$BASE" HEAD -- $MOD_TRIGGER; then
    RUN_MOD=0
  else
    say "changes under $MOD_TRIGGER vs $(echo "$BASE" | cut -c1-9), running every mod-job step..."
  fi
else
  say "no base ref to diff against, running every mod-job step anyway."
fi

if ! command -v dotnet >/dev/null 2>&1; then
  if [ "$RUN_MOD" = "1" ]; then
    say "✖ the C#-side mod-job steps are due (changes under $MOD_TRIGGER, or forced)"
    say "  and \`dotnet\` is not on PATH, so they cannot run. Install the .NET 10 SDK, or push with"
    say "  GONOGO_SKIP_MOD_SUITES=1 and let CI's \`mod\` job be the only gate."
    exit 1
  fi
  NO_DOTNET=1
else
  NO_DOTNET=0
fi

# The KSP reference assemblies. Absent is the NORMAL case for a contributor
# without a KSP install and for any worktree, since local_docs is gitignored,
# so it is a reduced run rather than a failure. It is not silent: suites drop
# sources at BUILD time when these are missing and then pass having tested
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
export KSP_GAMEDATA KSP_MANAGED
KSP_ARGS=""
REDUCED=""
NOT_RUN=""

# Each step_<fn> returns 0 for a pass, 2 for a step it could not run here with
# the reason in DECLINED, and anything else for a failure.
DECLINED=""

step_codegen() {
  if [ "$NO_DOTNET" = "1" ]; then
    DECLINED="\`dotnet\` is not on PATH, and mod/codegen.sh builds the contract with it"
    return 2
  fi
  quiet bash "$ROOT/scripts/codegen-check.sh"
}

step_client_hash() {
  quiet node "$ROOT/scripts/client-hash-armed.mjs"
}

# The DLL list is read from ci.yml's own mandatory-assemblies step rather than
# copied, because that list is the rule for which DLLs a suite's availability
# gate conditions on, and a local check of a subset passes on exactly the install
# that silently tests nothing.
step_reference_set() {
  required="$(sed -n '/^ *required=(/,/^ *)/p' "$CI_YML" |
    sed -n 's|^ *"KSP_Data/Managed/\([^"]*\.dll\)" *$|\1|p')"
  if [ -z "$required" ]; then
    say "✖ read no DLL names from ci.yml's \`required=(\` list. Either the step moved"
    say "  or this parse stopped matching it, and an empty list would call any"
    say "  install complete."
    return 1
  fi
  missing=""
  for dll in $required; do
    [ -f "$KSP_MANAGED/$dll" ] || missing="$missing $dll"
  done
  if [ -z "$missing" ]; then
    KSP_ARGS="/p:KspManaged=$KSP_MANAGED"
    return 0
  fi
  REDUCED="$REDUCED Gonogo.KSP.Tests(ConfigNode-ledger)"
  say "⚠ KSP reference assemblies incomplete, missing:$missing"
  say "⚠   $KSP_MANAGED"
  say "⚠ Gonogo.KSP.Tests will BUILD WITHOUT its KSP-linked sources and pass having"
  say "⚠ run none of them, and the Uplink plugin compile and the NuGet extraction"
  say "⚠ probe cannot run at all. CI runs all three against the ksp-managed set."
  DECLINED="the reference set is incomplete, which fails CI on staging and is a reduced run here"
  return 2
}

step_uplink_build() {
  if [ -z "$KSP_ARGS" ]; then
    DECLINED="no complete KSP reference set to compile against"
    return 2
  fi
  quiet bash "$ROOT/scripts/uplink-mod-build.sh"
}

# Projects allowed a retry, each for a stated cause. The WS integration suite
# drives a real socket server under wall-clock budgets, so a loaded machine can
# time out a correct test; every other project gets one attempt, because a
# blanket retry would also absorb a genuinely flaky new test. A pass that needed
# a retry is printed as such, never as a plain "ok".
RETRIED="Sitrep.Host.IntegrationTests"
ATTEMPTS=3
FLAKED=""
TESTED=0

step_dotnet_test() {
  # `[^"]*Tests\.csproj`, with no dot before Tests, so the match includes
  # Sitrep.Host.IntegrationTests as well as every `*.Tests` project. A derived
  # list omits as quietly as a hand-written one when the derivation is wrong,
  # which is why the agreement check below exists.
  projects="$(sed -n 's/^Project(.*) = "[^"]*", "\([^"]*Tests\.csproj\)".*/\1/p' "$MOD/Gonogo.sln" | tr '\\' '/')"
  if [ -z "$projects" ]; then
    say "✖ mod/Gonogo.sln declares no test project. Either the solution moved or"
    say "  this parse stopped matching it; a gate that finds nothing to run reports"
    say "  success, so this is an error rather than an empty pass."
    return 1
  fi

  # A SECOND instrument, failing differently from the first. ci.yml's `mod` job
  # hand-lists the same projects, and a hand-list misses a project added to the
  # solution. Reading the solution fixes that direction and opens the opposite
  # one: this parse can stop matching a project and report a clean run over the
  # rest. Neither list can check itself, so they check each other.
  ci_projects="$(sed -n '/^ *projects=(/,/^ *)/p' "$CI_YML" |
    sed -n 's/^ *\([A-Za-z0-9._]*Tests\) *$/\1/p' | sort)"
  sln_projects="$(echo "$projects" | sed 's|.*/||; s|\.csproj$||' | sort)"
  if [ "$ci_projects" != "$sln_projects" ]; then
    say "✖ this gate and ci.yml's \`mod\` job disagree about which projects to test."
    say "  mod/Gonogo.sln: $(echo "$sln_projects" | tr '\n' ' ')"
    say "  ci.yml:         $(echo "$ci_projects" | tr '\n' ' ')"
    say "  A project named by one and not the other is gated by that one alone."
    return 1
  fi

  for proj in $projects; do
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
        say "✖ $name FAILED after $attempt attempt(s)."
        return 1
      fi
      say "  ⚠ $name failed attempt $attempt/$allowed, retrying. What failed, before the retry replaces it:"
      grep -E "\[FAIL\]|^Failed!" "$LOG" | head -10 | sed "s/^/pre-push[mod]:     /"
      attempt=$((attempt + 1))
    done
    TESTED=$((TESTED + 1))
    if [ "$attempt" -gt 1 ]; then
      FLAKED="$FLAKED $name(attempt $attempt)"
      say "    ⚠ $name passed only on attempt $attempt ($(($(date +%s) - start))s)"
    else
      say "    $name ok ($(($(date +%s) - start))s)"
    fi
  done
}

step_pack() {
  quiet dotnet pack "$MOD/Sitrep.Contract.Package/Sitrep.Contract.Package.csproj" \
    -c Release -o "$WORK/nuget" --nologo || return 1
  quiet node "$ROOT/scripts/nuget-contract-package-gate.mjs" "$WORK"/nuget/*.nupkg
}

step_probe() {
  if [ -z "$KSP_ARGS" ]; then
    DECLINED="no complete KSP reference set to build the probe Uplink against"
    return 2
  fi
  set -- "$WORK"/nuget/KspGonogo.Sitrep.Contract.*.nupkg
  quiet node "$ROOT/scripts/nuget-extraction-probe.mjs" --nupkg "$1" --uplink GonogoProbeUplink || return 1
  quiet node "$ROOT/scripts/nuget-extraction-probe.mjs" --nupkg "$1" --plant --uplink GonogoProbeUplink
}

RAN=0
CI_ONLY=""
SKIPPED_MOD=0
while IFS='|' read -r step treatment; do
  [ -n "$step" ] || continue
  kind="${treatment%%:*}"
  arg="${treatment#*:}"
  case "$kind" in
    ci)
      CI_ONLY="$CI_ONLY
pre-push[mod]:   $step: $arg"
      continue
      ;;
    same) continue ;;
    mod)
      if [ "$RUN_MOD" = "0" ]; then
        SKIPPED_MOD=$((SKIPPED_MOD + 1))
        continue
      fi
      ;;
    always) ;;
    *)
      say "✖ MOD_JOB_STEPS has no treatment \"$kind\" (for: $step)."
      exit 1
      ;;
  esac
  step_start="$(date +%s)"
  # stdin is the table this loop reads; a step that reads stdin would eat it.
  "step_$arg" </dev/null
  rc=$?
  if [ "$rc" = "2" ]; then
    say "  $step: NOT RUN, $DECLINED"
    NOT_RUN="$NOT_RUN [$step]"
    continue
  fi
  if [ "$rc" != "0" ]; then
    say "✖ $step FAILED (this is what CI's \`mod\` job would have caught)."
    exit 1
  fi
  RAN=$((RAN + 1))
  say "  $step ok ($(($(date +%s) - step_start))s)"
done <<EOF
$MOD_JOB_STEPS
EOF

say "CI-only, not run here:$CI_ONLY"
if [ "$SKIPPED_MOD" -gt 0 ]; then
  NOT_RUN="$NOT_RUN [$SKIPPED_MOD C#-side steps: no changes under $MOD_TRIGGER vs $(echo "$BASE" | cut -c1-9)]"
fi
if [ -n "$FLAKED" ]; then
  say "⚠ passed only on retry:$FLAKED"
fi
if [ -n "$NOT_RUN" ] || [ -n "$REDUCED" ]; then
  say "MOD JOB STEPS NOT ALL RUN: $RAN run and passed; NOT RUN:$NOT_RUN${REDUCED:+; REDUCED:$REDUCED}"
else
  say "mod job green: $RAN steps run, $TESTED test projects, KSP-linked sources included."
fi
