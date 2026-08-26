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
FLOOR=11
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
EXEMPT=(
  "GonogoMechJebUplink|MechJeb2/Plugins/MechJeb2.dll|MechJeb2.dll is not vendored in ksp-gonogo/ksp-managed. This Uplink is the only one that binds its mod's types at compile time (MechJebController.cs, MechJebUplink.Ksp.cs bind MuMech directly) rather than by runtime reflection, so it cannot compile without the dll. Vendoring it would work and is licensable, but the RECOMMENDED fix is to bring the Uplink onto the reflection pattern every other one follows: it returns the assembly to MIT, and the ten MuMech members it touches are already resolved reflectively by MechJebVersionGuard.cs. Scope: local_docs/design/mechjeb-reflection-rewrite-scope.md. Either resolution deletes this line."
)

exempt_reason() {
  local name="$1" entry
  for entry in "${EXEMPT[@]}"; do
    [ "${entry%%|*}" = "$name" ] && { echo "${entry#*|}"; return 0; }
  done
  return 1
}

# Both directions, because they fail differently and both fail silently. A stale
# exemption is the one that matters: it reads as coverage and is not.
stale=""
for entry in "${EXEMPT[@]}"; do
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

echo "Building $COUNT Uplink plugin assemblies against $KSP_MANAGED"
failed=""
skipped=""
for csproj in $(uplink_csprojs); do
  name="$(basename "$csproj" .csproj)"
  if reason="$(exempt_reason "$name")"; then
    echo "::warning::$name NOT COMPILED. ${reason#*|}"
    skipped="$skipped $name"
    continue
  fi
  echo "::group::dotnet build $name"
  if ! dotnet build "$csproj" --configuration Release \
      -p:KspManaged="$KSP_MANAGED" -p:KspGameData="$KSP_GAMEDATA" --nologo; then
    failed="$failed $name"
  fi
  echo "::endgroup::"
done

if [ -n "$failed" ]; then
  echo "::error::Uplink plugin assemblies failed to compile:$failed"
  echo "These ship in GameData. Nothing else in CI compiles them."
  exit 1
fi
echo "uplink mod build: $((COUNT - $(echo $skipped | wc -w | tr -d ' '))) of $COUNT Uplink plugin assemblies compiled.${skipped:+ Exempt:$skipped}"
