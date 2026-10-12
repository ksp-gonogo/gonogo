#!/usr/bin/env bash
# Compile the Gonogo mod's own plugin assembly (mod/Gonogo.KSP) against the KSP
# reference set.
#
# Gonogo.KSP.Tests compiles a hand-picked list of Gonogo.KSP sources, and the
# files that need a live scene (every Uplink's main-loop wiring) are not in it,
# so `dotnet test` cannot tell a Gonogo.KSP that builds from one that does not.
# uplink-mod-build.sh discovers `Gonogo*Uplink.csproj` and so never reaches this
# project either. This is the one step that does.
#
# It proves it can see a failure before it reports one: a file with a compile
# error is planted in the project, outside Gonogo.KSP.Tests' Compile Include
# list, and the build must refuse it. A build that cannot is reported as BLIND
# and fails, since a compile step that finds nothing wrong with broken code
# reads exactly like one that checked.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)"
if [ -z "$ROOT" ] || [ ! -f "$ROOT/pnpm-workspace.yaml" ]; then
  echo "✖ ksp mod build: could not resolve the repo root from $0"
  exit 1
fi
cd "$ROOT" || exit 1

: "${KSP_MANAGED:?set KSP_MANAGED to <ksp-managed>/KSP_Data/Managed}"

PROJECT=mod/Gonogo.KSP/Gonogo.KSP.csproj
PLANT=mod/Gonogo.KSP/PlantedCompileFault.cs
log="$(mktemp)"
trap 'rm -f "$log" "$PLANT"' EXIT

build() {
  dotnet build "$PROJECT" --configuration Release -p:KspManaged="$KSP_MANAGED" --nologo 2>&1 | tee "$log"
  return "${PIPESTATUS[0]}"
}

echo "::group::dotnet build Gonogo.KSP"
build
status=$?
echo "::endgroup::"
if [ "$status" -ne 0 ]; then
  echo "::error::Gonogo.KSP failed to compile against $KSP_MANAGED"
  echo "This is the mod that ships in GameData. Nothing else in CI compiles it."
  exit 1
fi

# MSB3245 is a warning: a reference whose HintPath is missing is dropped and the
# build carries on, so the project compiles green until source uses a type from
# the assembly it lost.
unresolved="$(sed -n 's/.*MSB3245.*Could not locate the assembly "\([^"]*\)".*/\1/p' "$log" | sort -u)"
if [ -n "$unresolved" ]; then
  echo "::error::Gonogo.KSP compiled against an incomplete reference set:"
  echo "$unresolved"
  echo "Vendor the assemblies into ksp-gonogo/ksp-managed or drop the reference."
  exit 1
fi

cat > "$PLANT" <<'PLANTED'
namespace Gonogo.KSP
{
    internal static class PlantedCompileFault
    {
        private static readonly int Value = "not an int";
    }
}
PLANTED

echo "::group::dotnet build Gonogo.KSP with a planted compile error"
build
planted=$?
echo "::endgroup::"
rm -f "$PLANT"
if [ "$planted" -eq 0 ] || ! grep -q "PlantedCompileFault.cs.*error CS" "$log"; then
  echo "::error::ksp mod build is BLIND: a planted compile error in mod/Gonogo.KSP was not reported, so a green build proves nothing."
  exit 1
fi

echo "ksp mod build: Gonogo.KSP compiled, and a planted compile error was refused."
