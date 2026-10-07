#!/usr/bin/env bash
# Pack the gonogo-uplinks repo's copy of `KspGonogo.Sitrep.Contract` from ONE
# gonogo commit, into its local NuGet feed, and record which commit.
#
#   scripts/vendor-uplinks-reference-set.sh <gonogo-uplinks checkout> [<gonogo ref>]
#
# The ref defaults to HEAD. Sources are taken from the COMMIT with `git archive`,
# never from the working tree, so an uncommitted edit under mod/ cannot reach the
# package and the sha in its version is the whole truth about its origin.
#
# gonogo-uplinks builds the way an outside author's Uplink does: every project
# there references the package, and nothing references a loose assembly. So this
# writes one file and moves two pins:
#
#   vendor/nuget/KspGonogo.Sitrep.Contract.<version>.nupkg   the package, the only one in the feed
#   Directory.Build.props, GonogoContractVersion             the version every project references
#   vendor/gonogo-ref                                        the gonogo commit sha
#
# THE VERSION NAMES THE PIN: <release>-pin.g<first 12 of the sha>. NuGet keeps a
# machine-wide cache keyed by id and version, and would go on serving the first
# bytes it ever saw under a version that was packed twice. A version that moves
# with the commit cannot be stale, on a developer's machine or on a runner.
#
# The package is what a plugin, a contract slice, a test project and codegen all
# resolve: Sitrep.Contract for net472 and netstandard2.0, TestSupport and
# Sitrep.Core beside it for net10.0, and the codegen twin with CodegenTwin.props
# in its codegen folder.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)"
if [ -z "$ROOT" ] || [ ! -f "$ROOT/pnpm-workspace.yaml" ]; then
  echo "✖ vendor: could not resolve the gonogo repo root from $0"
  exit 1
fi

TARGET="${1:-}"
REF="${2:-HEAD}"
if [ -z "$TARGET" ]; then
  echo "usage: $0 <gonogo-uplinks checkout> [<gonogo ref>]"
  exit 2
fi
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || {
  echo "✖ vendor: $1 is not a directory"
  exit 1
}
# Directory.Build.props is where every project there reads the package version
# from, so a target without that property is not the repo this feed is for.
PROPS="$TARGET/Directory.Build.props"
if [ ! -f "$PROPS" ] || [ ! -d "$TARGET/uplinks" ] \
  || ! grep -q "<GonogoContractVersion>" "$PROPS"; then
  echo "✖ vendor: $TARGET does not look like a gonogo-uplinks checkout"
  echo "  (expected uplinks/ and a Directory.Build.props declaring GonogoContractVersion)"
  exit 1
fi

SHA="$(git -C "$ROOT" rev-parse --verify "$REF^{commit}")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "vendor: packing KspGonogo.Sitrep.Contract from gonogo $SHA"
git -C "$ROOT" archive "$SHA" \
  mod/Directory.Build.props \
  mod/CodegenTwin.props \
  mod/Sitrep.Contract \
  mod/Sitrep.Contract.Codegen \
  mod/Sitrep.Contract.Package \
  mod/Sitrep.Contract.TestSupport \
  mod/Sitrep.Core \
  packages/app/package.json \
  | tar -x -C "$WORK"

RELEASE="$(sed -n 's/^  "version": "\([0-9][0-9.]*\)",\{0,1\}$/\1/p' "$WORK/packages/app/package.json" | head -1)"
if [ -z "$RELEASE" ]; then
  echo "✖ vendor: could not read the release version from packages/app/package.json at $SHA"
  exit 1
fi
VERSION="$RELEASE-pin.g${SHA:0:12}"

# The archive is not a git checkout, so SourceLink has no commit to point at. The
# package's nuspec still carries the repository URL, which the csproj states.
dotnet pack "$WORK/mod/Sitrep.Contract.Package/Sitrep.Contract.Package.csproj" \
  -c Release -o "$WORK/out" --nologo -v quiet -clp:ErrorsOnly \
  -p:PackageVersion="$VERSION" -p:EnableSourceLink=false -p:EmbedUntrackedSources=false

NUPKG="$WORK/out/KspGonogo.Sitrep.Contract.$VERSION.nupkg"
if [ ! -f "$NUPKG" ]; then
  echo "✖ vendor: the pack produced no $NUPKG"
  exit 1
fi
# A package that lost a group or its codegen folder restores cleanly and fails
# later in every Uplink at once, so what it must hold is checked here by name.
for member in \
  lib/net472/Sitrep.Contract.dll \
  lib/netstandard2.0/Sitrep.Contract.dll \
  lib/net10.0/Sitrep.Contract.dll \
  lib/net10.0/Sitrep.Contract.TestSupport.dll \
  lib/net10.0/Sitrep.Core.dll \
  codegen/Sitrep.Contract.dll \
  codegen/CodegenTwin.props; do
  if ! unzip -Z1 "$NUPKG" | grep -qx "$member"; then
    echo "✖ vendor: the package packed from $SHA holds no $member"
    exit 1
  fi
done

FEED="$TARGET/vendor/nuget"
mkdir -p "$FEED"
# One package in the feed: an older one left beside it would still satisfy a
# project whose version nobody moved.
find "$FEED" -maxdepth 1 -name 'KspGonogo.Sitrep.Contract.*.nupkg' -delete
cp "$NUPKG" "$FEED/"

sed -i.bak "s|<GonogoContractVersion>[^<]*</GonogoContractVersion>|<GonogoContractVersion>$VERSION</GonogoContractVersion>|" "$PROPS"
rm -f "$PROPS.bak"
if ! grep -q "<GonogoContractVersion>$VERSION</GonogoContractVersion>" "$PROPS"; then
  echo "✖ vendor: could not write GonogoContractVersion into $PROPS"
  exit 1
fi
echo "$SHA" > "$TARGET/vendor/gonogo-ref"

echo "vendor: $FEED/KspGonogo.Sitrep.Contract.$VERSION.nupkg"
echo "vendor: GonogoContractVersion is $VERSION, vendor/gonogo-ref is $SHA"
