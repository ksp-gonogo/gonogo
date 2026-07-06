#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="$ROOT/mod/Gonogo.Contract"
OUT="$ROOT/packages/telemetry-sdk/src/__generated__/contract.ts"
RT_VER="1.6.7"
RT_PKG="$HOME/.nuget/packages/reinforced.typings/$RT_VER"
RTCLI="$RT_PKG/tools/net5.0/rtcli.dll"

dotnet build "$PROJ/Gonogo.Contract.csproj" -v minimal
BIN="$PROJ/bin/Debug/netstandard2.0"
cp "$RT_PKG/tools/net5.0/Reinforced.Typings.dll" "$BIN/"   # rtcli needs to resolve the attributes assembly

mkdir -p "$(dirname "$OUT")"
DOTNET_ROLL_FORWARD=LatestMajor dotnet "$RTCLI" \
  SourceAssemblies="$BIN/Gonogo.Contract.dll" \
  TargetFile="$OUT" \
  ConfigurationMethod="Gonogo.Contract.RtConfig.Configure"
echo "codegen -> $OUT"
