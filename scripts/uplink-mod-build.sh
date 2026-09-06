#!/usr/bin/env bash
# Compile every Uplink's PLUGIN assembly against the KSP reference set.
#
# `dotnet test` over the test projects does not do this and never has. Not one
# `Gonogo*Uplink.Tests` project references its own Uplink's implementation
# csproj: they all reference the `.Contract` slice, `Sitrep.Contract` and
# `Sitrep.Contract.TestSupport`. So the eleven `mod/Gonogo*Uplink/*.csproj`
# assemblies, the ones that actually ship in GameData, were compiled by NOTHING
# in CI. Seven of them appeared in no workflow at all; the other four were built
# only by `publish-mods.yml`, which runs on `workflow_run` AFTER CI on main, so a
# compile error landed on main first and was reported by a publish job.
#
# This is the same shape as the trap the repo already knows about one layer in
# (`mod/Gonogo.sln` cannot be built wholesale because the KSP-linked projects
# need a gitignored install, so a green `dotnet test` does not mean `Gonogo.KSP`
# compiles). The answer is the same: build explicitly, with `-p:KspManaged`.
#
# Discovery, not a list, for the reason `codegen-check.sh` gives at length: a
# hand-maintained array has no gate on its own completeness, and this repo has
# been bitten by that shape five times (the `mod` job's test-project array, the
# old codegen PATHS array, the isolation ratchet's `client/src`-only walk,
# ci.yml's `required=()` DLL subset, and `publish-mods.yml`'s 4-of-11 matrix).
set -uo pipefail
# Resolved with its own error check rather than the usual one-liner: a
# `cd ... && pwd` that fails leaves ROOT empty, `cd ""` is a silent no-op, and
# the discovery below then runs against whatever directory the caller happened to
# be in. That reports "discovered 0 csprojs", which reads as a broken tree rather
# than a broken invocation. It cost twenty minutes the first time.
ROOT="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)"
if [ -z "$ROOT" ] || [ ! -f "$ROOT/pnpm-workspace.yaml" ]; then
  echo "✖ uplink mod build: could not resolve the repo root from $0"
  exit 1
fi
cd "$ROOT" || exit 1

: "${KSP_MANAGED:?set KSP_MANAGED to <ksp-managed>/KSP_Data/Managed}"
: "${KSP_GAMEDATA:?set KSP_GAMEDATA to <ksp-managed>/GameData}"

uplink_csprojs() {
  find mod -maxdepth 2 -type f -name 'Gonogo*Uplink.csproj' | sort
}

# A discovery that matches nothing builds nothing, finds no failures and exits 0,
# which is indistinguishable from success. The floor is what makes that
# impossible; it is a FLOOR rather than an equality so adding an Uplink does not
# require editing this script, which is the whole point of discovering.
# Lowered from 11, once per Uplink that migrated to the gonogo-uplinks repo:
# GonogoTestFlightUplink and the four that followed it on 2026-09-06.
FLOOR=6
COUNT="$(uplink_csprojs | wc -l | tr -d ' ')"
if [ "$COUNT" -lt "$FLOOR" ]; then
  echo "✖ uplink mod build: discovered only $COUNT Uplink csproj(s), fewer than this repo has ever had ($FLOOR)."
  echo "  The discovery is broken rather than the tree being small. Refusing to report success."
  exit 1
fi

# EXEMPTIONS: "<csproj name>|<the reference DLL that is missing>|<why>".
#
# An exemption is a named condition with its reason attached, never a bare name
# in a list. That distinction is not stylistic: `Sitrep.Host.IntegrationTests`
# sat in ci.yml's exemption list for over a month after the hang that justified
# it was fixed, and what it cost in the meantime was a live flake nobody saw,
# because red only ever printed as a warning.
#
# So an exemption here EXPIRES BY ITSELF. The check below requires the named DLL
# to be genuinely absent from the reference set: the moment someone vendors it,
# this script fails as STALE and the exemption has to be deleted. A debt that
# cannot outlive its cause is the only kind worth writing down.
#
# THE LIST IS EMPTY: all eleven Uplink plugin assemblies compile. It stays,
# empty, because it is what holds eleven-of-eleven there. An Uplink that stops
# compiling has to earn a line with a reason rather than quietly become a
# warning, which is what an exemption turns into the moment its cause is gone.
#
# The array keeps its multi-line form while empty: uplink-mod-build-coverage's
# parser looks for `EXEMPT=(` with entries on following lines, and it THROWS when
# it cannot find one, which is the right report for an array someone deleted and
# the wrong one for an array that is legitimately empty.
#
# Both expansions below are written `${EXEMPT[@]+"${EXEMPT[@]}"}` rather than
# `"${EXEMPT[@]}"`. Under `set -u` bash 3.2, which is what macOS ships, expanding
# an EMPTY array is an unbound-variable error, so the plain form kills this
# script locally while passing on CI's bash 5. An empty list is the state this
# file is supposed to be in, so it has to be the state it survives.
EXEMPT=(
)

exempt_reason() {
  local name="$1" entry
  for entry in ${EXEMPT[@]+"${EXEMPT[@]}"}; do
    [ "${entry%%|*}" = "$name" ] && { echo "${entry#*|}"; return 0; }
  done
  return 1
}

# Both directions, because they fail differently and both fail silently. A stale
# exemption is the one that matters: it reads as coverage and is not.
stale=""
for entry in ${EXEMPT[@]+"${EXEMPT[@]}"}; do
  name="${entry%%|*}"
  rest="${entry#*|}"
  dll="${rest%%|*}"
  [ -f "mod/$name/$name.csproj" ] || stale="$stale
  $name is exempt but has no csproj: delete the exemption or fix the name."
  [ -f "$KSP_GAMEDATA/$dll" ] && stale="$stale
  $name is exempt because $dll is missing, but it is PRESENT. The exemption has outlived its cause: delete it and let the build gate."
done
if [ -n "$stale" ]; then
  echo "✖ uplink mod build: the exemption list no longer describes reality:$stale"
  exit 1
fi

# UNRESOLVED REFERENCES: a `<Reference>` whose HintPath does not exist is MSB3245,
# a WARNING, and the build carries on without that assembly on the reference list.
# So a csproj can name a reference the CI set does not have, compile green, and
# only go red the day someone writes code that needs a type from it. That is the
# same shape as a compile nothing runs: a green build that is not checking what it
# claims to check.
#
# It is live right now. Ten csprojs reference Assembly-CSharp-firstpass, the local
# dev reference directory has it and ksp-gonogo/ksp-managed does not, so every
# local build resolves it and every CI build silently does not.
#
# Same contract as EXEMPT above: named, with a reason, and it EXPIRES BY ITSELF the
# moment the assembly appears in the reference set.
UNRESOLVED_OK=(
  "Assembly-CSharp-firstpass|KSP's own second compilation unit, the sibling of Assembly-CSharp.dll that ksp-managed already vendors. No source in the repo uses a type from it today, which is why nothing is red. Vendor KSP_Data/Managed/Assembly-CSharp-firstpass.dll into ksp-gonogo/ksp-managed (no new licence question: identical status to Assembly-CSharp.dll, same private repo) so the CI and local reference sets agree, then delete this line. Dropping the ten references instead also works and also deletes this line."
)

unresolved_allowed() {
  local asm="$1" entry
  for entry in "${UNRESOLVED_OK[@]}"; do
    [ "${entry%%|*}" = "$asm" ] && return 0
  done
  return 1
}

# The other direction, for the same reason the EXEMPT list checks both: an entry
# for an assembly that IS present reads as covered debt and is not.
#
# Fatal in CI only. The entry describes what ksp-managed lacks, so CI is where it
# can go stale and where deleting it is the right answer. A local reference set is
# routinely MORE complete than CI's, and failing there blocked every local build of
# every Uplink on a discrepancy the developer cannot act on: deleting the entry to
# unblock themselves would break CI, which still lacks the assembly.
for entry in "${UNRESOLVED_OK[@]}"; do
  asm="${entry%%|*}"
  if [ -f "$KSP_MANAGED/$asm.dll" ] && [ -z "${CI:-}" ]; then
    echo "note: $asm is present here but absent from CI's reference set, so its"
    echo "  accepted-unresolved entry is still load-bearing. Not an error locally."
    continue
  fi
  if [ -f "$KSP_MANAGED/$asm.dll" ]; then
    echo "✖ uplink mod build: $asm is listed as an accepted unresolved reference, but it is PRESENT in $KSP_MANAGED."
    echo "  The entry has outlived its cause: delete it and let the build gate."
    exit 1
  fi
done

echo "Building $COUNT Uplink plugin assemblies against $KSP_MANAGED"
failed=""
skipped=""
unresolved=""
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
for csproj in $(uplink_csprojs); do
  name="$(basename "$csproj" .csproj)"
  if reason="$(exempt_reason "$name")"; then
    echo "::warning::$name NOT COMPILED. ${reason#*|}"
    skipped="$skipped $name"
    continue
  fi
  echo "::group::dotnet build $name"
  if ! dotnet build "$csproj" --configuration Release \
      -p:KspManaged="$KSP_MANAGED" -p:KspGameData="$KSP_GAMEDATA" --nologo 2>&1 | tee "$log"; then
    failed="$failed $name"
  fi
  # MSB3245's message names the assembly it could not locate, in quotes.
  for asm in $(sed -n 's/.*MSB3245.*Could not locate the assembly "\([^"]*\)".*/\1/p' "$log" | sort -u); do
    unresolved_allowed "$asm" || unresolved="$unresolved
  $name references $asm, which is not in the reference set."
  done
  echo "::endgroup::"
done

if [ -n "$failed" ]; then
  echo "::error::Uplink plugin assemblies failed to compile:$failed"
  echo "These ship in GameData. Nothing else in CI compiles them."
  exit 1
fi

if [ -n "$unresolved" ]; then
  echo "::error::Uplink plugin assemblies compiled against an incomplete reference set:$unresolved"
  echo "The build is green only because no source uses a type from those assemblies yet."
  echo "Vendor them into ksp-gonogo/ksp-managed, drop the reference, or name them in UNRESOLVED_OK with a reason."
  exit 1
fi
echo "uplink mod build: $((COUNT - $(echo $skipped | wc -w | tr -d ' '))) of $COUNT Uplink plugin assemblies compiled.${skipped:+ Exempt:$skipped}"
