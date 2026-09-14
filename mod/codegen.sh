#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Every contract assembly rtcli reads is a *.Contract.Codegen TWIN: the same
# sources recompiled with SITREP_CODEGEN defined, which is the only build in
# which the [TsInterface]/[TsEnum] attributes and the RtConfig classes exist.
# The SHIPPED contract assemblies carry no Reinforced.Typings reference at all
# now, so they cannot be codegen's input, and must not be: a shipped assembly
# holding those attributes breaks every consumer that reflects over one of its
# types, Enum.ToString() included. See mod/CodegenTwin.props.
PROJ="$ROOT/mod/Sitrep.Contract.Codegen"
OUT="$ROOT/mod/sitrep-sdk/src/__generated__/contract.ts"
TOPIC_MAP_OUT="$ROOT/mod/sitrep-sdk/src/__generated__/topic-map.ts"
UNIT_MAP_OUT="$ROOT/mod/sitrep-sdk/src/__generated__/units.ts"
# The same map as data. Read by anything that is not TypeScript, and served
# by the mod beside the telemetry socket so the stream describes its own units.
UNIT_JSON_OUT="$ROOT/mod/sitrep-sdk/src/__generated__/units.json"
CHANNEL_MAP_OUT="$ROOT/mod/sitrep-sdk/src/__generated__/control-channels.ts"
# The write-side twin of the topic map: command -> args type + reply type, off
# the [SitrepCommand] tags. See RtConfig.EmitCommandMap.
COMMAND_MAP_OUT="$ROOT/mod/sitrep-sdk/src/__generated__/command-map.ts"
# Which VALUES the contract says a forward model can carry between observations,
# off the [SitrepReckonable] tags: the model, and the published inputs it needs.
# See RtConfig.EmitReckonability.
RECKONABILITY_OUT="$ROOT/mod/sitrep-sdk/src/__generated__/reckonability.ts"
RT_VER="1.6.7"
RT_PKG="$HOME/.nuget/packages/reinforced.typings/$RT_VER"
RTCLI="$RT_PKG/tools/net5.0/rtcli.dll"

# No Reinforced.Typings.dll is staged or cleaned up here any more, because none
# is copied anywhere. Each twin declares RT as an ordinary dependency, so the
# DLL is already beside the assembly rtcli loads, and it lives in a bin nothing
# ships from.
#
# The staging it replaces existed because a copy left in a contract's bin flowed
# to every dependent's output: on 2026-08-20 that happened 29 copies deep, made
# ControlChannelDescriptor's property scan resolve an assembly that is correctly
# absent everywhere else, aborted every delayed command dispatch, and hid the
# bug for a month by making 13 tests pass while asserting nothing. Tracking and
# deleting the copies fixed the leak downstream; separating the codegen build
# from the shipped one removes the reason to make a copy at all.

dotnet build "$PROJ/Sitrep.Contract.Codegen.csproj" -v minimal
BIN="$PROJ/bin/Debug/netstandard2.0"

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
  SITREP_UNITJSON_OUT="$UNIT_JSON_OUT" \
  SITREP_CHANNELMAP_OUT="$CHANNEL_MAP_OUT" \
  SITREP_COMMANDMAP_OUT="$COMMAND_MAP_OUT" \
  SITREP_RECKONABILITY_OUT="$RECKONABILITY_OUT" \
  dotnet "$RTCLI" \
  DocumentationFilePath="$BIN/Sitrep.Contract.xml" \
  SourceAssemblies="$BIN/Sitrep.Contract.dll" \
  TargetFile="$OUT" \
  ConfigurationMethod="Sitrep.Contract.RtConfig.Configure"
echo "codegen -> $OUT"
echo "codegen -> $TOPIC_MAP_OUT"
echo "codegen -> $UNIT_MAP_OUT"
echo "codegen -> $UNIT_JSON_OUT"
echo "codegen -> $CHANNEL_MAP_OUT"
echo "codegen -> $COMMAND_MAP_OUT"
echo "codegen -> $RECKONABILITY_OUT"

# One rtcli run per Uplink that owns its own wire types, in addition to the core
# Sitrep.Contract run above. Each Uplink's types live in its OWN contract-slice
# project, never in Sitrep.Contract, and each writes into ITS OWN
# client/src/__generated__/, never into sitrep-sdk: sitrep-sdk stays core-only.
#
# DISCOVERED from the `mod/Gonogo*Uplink.Contract.Codegen` twins rather than
# written out once per Uplink. It used to be six hand-written blocks, and every
# mod Uplink is leaving for the gonogo-uplinks repo: each departure then had to
# cut its block out of this file by heading, which silently missed the two whose
# heading did not match their directory and, for the last block in the file,
# took the asyncapi and ui-kit steps below with it. A twin that exists is
# generated; a twin that has left generates nothing, and zero twins is a valid run.
#
# Everything a leg needs follows from the twin's directory name and its slice's
# own source, so adding an Uplink means adding its twin and its <X>RtConfig:
#   - the env prefix is SITREP_<NAME>_, NAME being the directory's middle upper-cased
#     (GonogoExampleUplink -> SITREP_EXAMPLE_), which every RtConfig reads
#   - the ConfigurationMethod is <namespace>.<class>.Configure of the one
#     *RtConfig.cs in the slice, so a slice with none, or two, stops the run
#   - the topic map is asked for only when the slice tags a type [SitrepTopic]:
#     a command-only slice emits none, and asking would add an empty topic-map.ts
#
# rtcli loads each slice's metadata and has to resolve every core type it
# references, so Sitrep.Contract.dll must sit beside it. The twin references the
# core twin normally, so the build puts it there.
for uplink_twin in "$ROOT"/mod/Gonogo*Uplink.Contract.Codegen; do
  [ -d "$uplink_twin" ] || continue
  slice="$(basename "$uplink_twin" .Contract.Codegen)"
  slice_name="${slice#Gonogo}"
  slice_name="${slice_name%Uplink}"
  prefix="SITREP_$(printf '%s' "$slice_name" | tr '[:lower:]' '[:upper:]')"

  rtconfigs=("$ROOT/mod/$slice.Contract/"*RtConfig.cs)
  if [ "${#rtconfigs[@]}" -ne 1 ] || [ ! -f "${rtconfigs[0]}" ]; then
    echo "✖ codegen: $slice.Contract must hold exactly one *RtConfig.cs, found: ${rtconfigs[*]}" >&2
    exit 1
  fi
  rtconfig="${rtconfigs[0]}"
  namespace="$(sed -n 's/^[[:space:]]*namespace[[:space:]]\{1,\}\([A-Za-z0-9_.]\{1,\}\).*/\1/p' "$rtconfig" | head -n 1)"
  if [ -z "$namespace" ]; then
    echo "✖ codegen: no namespace declaration found in $rtconfig" >&2
    exit 1
  fi
  configure="$namespace.$(basename "$rtconfig" .cs).Configure"

  out_dir="$ROOT/mod/$slice/client/src/__generated__"
  bin="$uplink_twin/bin/Debug/netstandard2.0"

  dotnet build "$uplink_twin/$slice.Contract.Codegen.csproj" -v minimal
  mkdir -p "$out_dir"

  outputs=(units.ts units.json command-map.ts)
  topic_env=()
  if grep -rEqs --include='*.cs' '^[[:space:]]*\[SitrepTopic' "$ROOT/mod/$slice.Contract"; then
    topic_env=("${prefix}_TOPICMAP_OUT=$out_dir/topic-map.ts")
    outputs=(topic-map.ts "${outputs[@]}")
  fi

  env DOTNET_ROLL_FORWARD=LatestMajor \
    ${topic_env[@]+"${topic_env[@]}"} \
    "${prefix}_UNITMAP_OUT=$out_dir/units.ts" \
    "${prefix}_UNITJSON_OUT=$out_dir/units.json" \
    "${prefix}_COMMANDMAP_OUT=$out_dir/command-map.ts" \
    dotnet "$RTCLI" \
    DocumentationFilePath="$bin/$slice.Contract.xml" \
    SourceAssemblies="$bin/$slice.Contract.dll" \
    TargetFile="$out_dir/contract.ts" \
    ConfigurationMethod="$configure"
  echo "codegen -> $out_dir/contract.ts"
  for output in "${outputs[@]}"; do
    echo "codegen -> $out_dir/$output"
  done
done

# asyncapi.yaml is generated from the SAME contract assemblies as everything
# above, and it lives at the repo ROOT rather than in a __generated__ directory.
# It used to be regenerated only by scripts/codegen-check.sh, so running this
# script looked like it had finished the job and had not: one contract
# doc-comment edit lands in BOTH contract.ts and asyncapi.yaml, they are checked
# by two unrelated gates in two different CI jobs, and passing the first said
# nothing about the second. That cost two pushes on 2026-09-05, both found
# minutes later at the push gate.
node "$ROOT/scripts/asyncapi-doc.mjs"
echo "codegen -> asyncapi.yaml"

# ui-kit's symbol -> kind table is generated FROM the SDK's unit model rather
# than hand-maintained beside it. It is a separate step because its input is
# TypeScript rather than the C# assembly: see scripts/gen-unit-kinds.mjs. Run
# through `pnpm codegen`, which chains the two.
