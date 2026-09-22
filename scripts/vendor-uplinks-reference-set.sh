#!/usr/bin/env bash
# Produce the gonogo-uplinks repo's `vendor/contract` and `vendor/devkit` from ONE
# gonogo commit, and record which one.
#
#   scripts/vendor-uplinks-reference-set.sh <gonogo-uplinks checkout> [<gonogo ref>]
#
# The ref defaults to HEAD. Sources are taken from the COMMIT with `git archive`,
# never from the working tree, so an uncommitted edit under mod/ cannot reach the
# vendored set and the sha written beside it is the whole truth about its origin.
#
# What it writes, replacing both directories wholesale so nothing stale survives:
#
#   vendor/contract/net472/Sitrep.Contract.dll          what an Uplink plugin binds to
#   vendor/contract/netstandard2.0/Sitrep.Contract.dll  what a contract slice and a Tests project bind to
#   vendor/contract/codegen/Sitrep.Contract.dll         the SITREP_CODEGEN twin rtcli reads
#   vendor/contract/codegen/Reinforced.Typings.dll      the twin's attribute assembly
#   vendor/contract/CodegenTwin.props                   the shape every Uplink's codegen twin imports
#   vendor/devkit/Sitrep.Contract.TestSupport.dll       fakes and rule assertions for a Tests project
#   vendor/devkit/Sitrep.Core.dll                       the real Courier/Archive delay engine
#   vendor/{contract,devkit}/VENDORED_FROM              the gonogo commit sha
#
# The devkit needs nothing else beside it. TestSupport references
# Sitrep.Contract, which the Tests project already takes from
# vendor/contract/netstandard2.0 (the same build TestSupport compiled against
# here), and xunit.assert, which arrives with the Tests project's own xunit
# package. Sitrep.Core is BCL-only apart from that same Sitrep.Contract.
#
# Sitrep.Core is the netstandard2.0 leg, which is what TestSupport's own net10.0
# build resolved and what a net10.0 Tests project resolves. It is here so a Tests
# project can drive the real delay engine rather than a double of it; a PLUGIN
# still binds Sitrep.Core out of GameData, never from here.
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
# Directory.Build.props is what reads vendor/contract and vendor/devkit, so a
# target without one is not the repo this set is for.
if [ ! -f "$TARGET/Directory.Build.props" ] || [ ! -d "$TARGET/uplinks" ] \
  || ! grep -q "GonogoDevkit" "$TARGET/Directory.Build.props"; then
  echo "✖ vendor: $TARGET does not look like a gonogo-uplinks checkout"
  echo "  (expected uplinks/ and a Directory.Build.props declaring GonogoDevkit)"
  exit 1
fi

SHA="$(git -C "$ROOT" rev-parse --verify "$REF^{commit}")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "vendor: building the reference set from gonogo $SHA"
git -C "$ROOT" archive "$SHA" \
  mod/Directory.Build.props \
  mod/CodegenTwin.props \
  mod/Sitrep.Contract \
  mod/Sitrep.Contract.Codegen \
  mod/Sitrep.Contract.TestSupport \
  mod/Sitrep.Core \
  | tar -x -C "$WORK"

for project in Sitrep.Contract Sitrep.Contract.Codegen Sitrep.Contract.TestSupport Sitrep.Core; do
  dotnet build "$WORK/mod/$project/$project.csproj" -c Release --nologo -v quiet -clp:ErrorsOnly
done

STAGE="$WORK/stage"
mkdir -p "$STAGE/contract/net472" "$STAGE/contract/netstandard2.0" \
  "$STAGE/contract/codegen" "$STAGE/devkit"

# Each copy names its source explicitly and `cp` fails on a missing one, so a
# build that put an assembly somewhere else stops the run instead of vendoring a
# set with a hole in it. MSBuild's missing-HintPath warning would not.
BIN="$WORK/mod"
cp "$BIN/Sitrep.Contract/bin/Release/net472/Sitrep.Contract.dll" "$STAGE/contract/net472/"
cp "$BIN/Sitrep.Contract/bin/Release/netstandard2.0/Sitrep.Contract.dll" "$STAGE/contract/netstandard2.0/"
cp "$BIN/Sitrep.Contract.Codegen/bin/Release/netstandard2.0/Sitrep.Contract.dll" "$STAGE/contract/codegen/"
cp "$BIN/Sitrep.Contract.Codegen/bin/Release/netstandard2.0/Reinforced.Typings.dll" "$STAGE/contract/codegen/"
cp "$BIN/CodegenTwin.props" "$STAGE/contract/"
cp "$BIN/Sitrep.Contract.TestSupport/bin/Release/net10.0/Sitrep.Contract.TestSupport.dll" "$STAGE/devkit/"
cp "$BIN/Sitrep.Core/bin/Release/netstandard2.0/Sitrep.Core.dll" "$STAGE/devkit/"

echo "$SHA" > "$STAGE/contract/VENDORED_FROM"
echo "$SHA" > "$STAGE/devkit/VENDORED_FROM"

mkdir -p "$TARGET/vendor"
for dir in contract devkit; do
  rm -rf "$TARGET/vendor/$dir"
  mv "$STAGE/$dir" "$TARGET/vendor/$dir"
done

echo "vendor: wrote $TARGET/vendor/contract and $TARGET/vendor/devkit from $SHA"
(cd "$TARGET/vendor" && find contract devkit -type f | sort | sed 's/^/  /')
