#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="$ROOT/mod/Sitrep.Contract"
OUT="$ROOT/mod/sitrep-sdk/src/__generated__/contract.ts"
TOPIC_MAP_OUT="$ROOT/mod/sitrep-sdk/src/__generated__/topic-map.ts"
UNIT_MAP_OUT="$ROOT/mod/sitrep-sdk/src/__generated__/units.ts"
RT_VER="1.6.7"
RT_PKG="$HOME/.nuget/packages/reinforced.typings/$RT_VER"
RTCLI="$RT_PKG/tools/net5.0/rtcli.dll"

dotnet build "$PROJ/Sitrep.Contract.csproj" -v minimal
BIN="$PROJ/bin/Debug/netstandard2.0"
cp "$RT_PKG/tools/net5.0/Reinforced.Typings.dll" "$BIN/"   # rtcli needs to resolve the attributes assembly

mkdir -p "$(dirname "$OUT")"
# SITREP_TOPICMAP_OUT triggers RtConfig.Configure to also emit the Topic->payload
# map (topic-map.ts) by reflecting over the [SitrepTopic]-tagged contract types,
# see RtConfig.EmitTopicMap. SITREP_UNITMAP_OUT does the same for the field->unit
# map (units.ts) off the [SitrepUnit]-tagged properties, see RtConfig.EmitUnitMap:
# rtcli emits TYPES, and a unit is a runtime value, so it needs its own artifact.
# All three come out of this one rtcli run.
DOTNET_ROLL_FORWARD=LatestMajor \
  SITREP_TOPICMAP_OUT="$TOPIC_MAP_OUT" \
  SITREP_UNITMAP_OUT="$UNIT_MAP_OUT" \
  dotnet "$RTCLI" \
  SourceAssemblies="$BIN/Sitrep.Contract.dll" \
  TargetFile="$OUT" \
  ConfigurationMethod="Sitrep.Contract.RtConfig.Configure"
echo "codegen -> $OUT"
echo "codegen -> $TOPIC_MAP_OUT"
echo "codegen -> $UNIT_MAP_OUT"
