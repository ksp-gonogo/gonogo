#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="$ROOT/mod/Sitrep.Contract"
OUT="$ROOT/mod/sitrep-sdk/src/__generated__/contract.ts"
TOPIC_MAP_OUT="$ROOT/mod/sitrep-sdk/src/__generated__/topic-map.ts"
UNIT_MAP_OUT="$ROOT/mod/sitrep-sdk/src/__generated__/units.ts"
# The same map as data. Read by anything that is not TypeScript, and served
# by the mod beside the telemetry socket so the stream describes its own units.
UNIT_JSON_OUT="$ROOT/mod/sitrep-sdk/src/__generated__/units.json"
CHANNEL_MAP_OUT="$ROOT/mod/sitrep-sdk/src/__generated__/control-channels.ts"
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
  SITREP_UNITJSON_OUT="$UNIT_JSON_OUT" \
  SITREP_CHANNELMAP_OUT="$CHANNEL_MAP_OUT" \
  dotnet "$RTCLI" \
  SourceAssemblies="$BIN/Sitrep.Contract.dll" \
  TargetFile="$OUT" \
  ConfigurationMethod="Sitrep.Contract.RtConfig.Configure"
echo "codegen -> $OUT"
echo "codegen -> $TOPIC_MAP_OUT"
echo "codegen -> $UNIT_MAP_OUT"
echo "codegen -> $UNIT_JSON_OUT"
echo "codegen -> $CHANNEL_MAP_OUT"

# --- Per-Uplink codegen ---
#
# One rtcli run per Uplink that owns its own wire types, in addition to the
# core Sitrep.Contract run above. Each Uplink's types live in its OWN
# contract-slice project (e.g. GonogoMechJebUplink.Contract), never in
# Sitrep.Contract (see local_docs/design/2026-08-10-uplink-types-out-of-core-plan.md),
# and each writes into ITS OWN client/src/__generated__/, never into
# sitrep-sdk: sitrep-sdk stays core-only, an Uplink's client package imports
# its generated types locally (Option A in the plan's §4b).
#
# MechJeb is the pilot (the smallest Uplink, 2 command-arg types, neither
# wire-published raw). To migrate the next Uplink: add its own
# <X>RtConfig.Configure (mirroring MechJebRtConfig.cs) to its own
# <X>.Contract.csproj, then add one block below following the same shape.
mechjeb_proj="$ROOT/mod/GonogoMechJebUplink.Contract"
mechjeb_out_dir="$ROOT/mod/GonogoMechJebUplink/client/src/__generated__"
mechjeb_bin="$mechjeb_proj/bin/Debug/netstandard2.0"

dotnet build "$mechjeb_proj/GonogoMechJebUplink.Contract.csproj" -v minimal
cp "$RT_PKG/tools/net5.0/Reinforced.Typings.dll" "$mechjeb_bin/"
# Sitrep.Contract.dll: not copied by the build (Private="false", provided by
# core at runtime), but rtcli loads GonogoMechJebUplink.Contract.dll's
# metadata and has to resolve every type it references (SitrepContractAttribute,
# SitrepUnitAttribute, Units, ...), so it must sit alongside it here.
cp "$BIN/Sitrep.Contract.dll" "$mechjeb_bin/"
mkdir -p "$mechjeb_out_dir"

# No SITREP_MECHJEB_TOPICMAP_OUT: MechJeb has no [SitrepTopic]-tagged type
# yet (it is command-only), so there is nothing for a topic map to name. The
# next Uplink that DOES read a Topic (Avionics is next in the plan's
# sequencing) should set it, mirroring the core invocation above.
DOTNET_ROLL_FORWARD=LatestMajor \
  SITREP_MECHJEB_UNITMAP_OUT="$mechjeb_out_dir/units.ts" \
  SITREP_MECHJEB_UNITJSON_OUT="$mechjeb_out_dir/units.json" \
  dotnet "$RTCLI" \
  SourceAssemblies="$mechjeb_bin/GonogoMechJebUplink.Contract.dll" \
  TargetFile="$mechjeb_out_dir/contract.ts" \
  ConfigurationMethod="Gonogo.MechJebUplink.MechJebRtConfig.Configure"
echo "codegen -> $mechjeb_out_dir/contract.ts"
echo "codegen -> $mechjeb_out_dir/units.ts"
echo "codegen -> $mechjeb_out_dir/units.json"

# Avionics: the second relocation. Unlike MechJeb, AvionicsStatus DOES carry
# [SitrepTopic("avionics.status")], so SITREP_AVIONICS_TOPICMAP_OUT is set
# here, mirroring the core invocation above.
avionics_proj="$ROOT/mod/GonogoAvionicsUplink.Contract"
avionics_out_dir="$ROOT/mod/GonogoAvionicsUplink/client/src/__generated__"
avionics_bin="$avionics_proj/bin/Debug/netstandard2.0"

dotnet build "$avionics_proj/GonogoAvionicsUplink.Contract.csproj" -v minimal
cp "$RT_PKG/tools/net5.0/Reinforced.Typings.dll" "$avionics_bin/"
cp "$BIN/Sitrep.Contract.dll" "$avionics_bin/"
mkdir -p "$avionics_out_dir"

DOTNET_ROLL_FORWARD=LatestMajor \
  SITREP_AVIONICS_TOPICMAP_OUT="$avionics_out_dir/topic-map.ts" \
  SITREP_AVIONICS_UNITMAP_OUT="$avionics_out_dir/units.ts" \
  SITREP_AVIONICS_UNITJSON_OUT="$avionics_out_dir/units.json" \
  dotnet "$RTCLI" \
  SourceAssemblies="$avionics_bin/GonogoAvionicsUplink.Contract.dll" \
  TargetFile="$avionics_out_dir/contract.ts" \
  ConfigurationMethod="GonogoAvionicsUplink.AvionicsRtConfig.Configure"
echo "codegen -> $avionics_out_dir/contract.ts"
echo "codegen -> $avionics_out_dir/topic-map.ts"
echo "codegen -> $avionics_out_dir/units.ts"
echo "codegen -> $avionics_out_dir/units.json"

# Kerbcast: the third relocation. KerbcastCameraEntry carries
# [SitrepTopic("kerbcast.cameras")], same as Avionics, so
# SITREP_KERBCAST_TOPICMAP_OUT is set here too. Unlike either predecessor
# alone, this leg also carries two inbound-only command-arg types
# (KerbcastSetFieldOfViewArgs/KerbcastSetPanArgs), same shape as MechJeb's.
kerbcast_proj="$ROOT/mod/GonogoKerbcastUplink.Contract"
kerbcast_out_dir="$ROOT/mod/GonogoKerbcastUplink/client/src/__generated__"
kerbcast_bin="$kerbcast_proj/bin/Debug/netstandard2.0"

dotnet build "$kerbcast_proj/GonogoKerbcastUplink.Contract.csproj" -v minimal
cp "$RT_PKG/tools/net5.0/Reinforced.Typings.dll" "$kerbcast_bin/"
cp "$BIN/Sitrep.Contract.dll" "$kerbcast_bin/"
mkdir -p "$kerbcast_out_dir"

DOTNET_ROLL_FORWARD=LatestMajor \
  SITREP_KERBCAST_TOPICMAP_OUT="$kerbcast_out_dir/topic-map.ts" \
  SITREP_KERBCAST_UNITMAP_OUT="$kerbcast_out_dir/units.ts" \
  SITREP_KERBCAST_UNITJSON_OUT="$kerbcast_out_dir/units.json" \
  dotnet "$RTCLI" \
  SourceAssemblies="$kerbcast_bin/GonogoKerbcastUplink.Contract.dll" \
  TargetFile="$kerbcast_out_dir/contract.ts" \
  ConfigurationMethod="GonogoKerbcastUplink.KerbcastRtConfig.Configure"
echo "codegen -> $kerbcast_out_dir/contract.ts"
echo "codegen -> $kerbcast_out_dir/topic-map.ts"
echo "codegen -> $kerbcast_out_dir/units.ts"
echo "codegen -> $kerbcast_out_dir/units.json"

# SCANsat: the fourth relocation, and the largest. FIVE types, TWO
# [SitrepTopic]-tagged roots (scansat.scanningVessels and scansat.science, both
# isArray), so SITREP_SCANSAT_TOPICMAP_OUT is set here the same as Avionics's
# and Kerbcast's. It is also the first relocation with NESTED payload types
# (ScanningVesselEntry.sensors/trackColor), which is why the emitted units.ts
# matters twice over: EmitUnitMap writes the field->unit map AND the
# field->nested-type SHAPE map from the same pass, and this Uplink's client
# has to register both (see ScansatRtConfig.Configure's doc comment).
scansat_proj="$ROOT/mod/GonogoScansatUplink.Contract"
scansat_out_dir="$ROOT/mod/GonogoScansatUplink/client/src/__generated__"
scansat_bin="$scansat_proj/bin/Debug/netstandard2.0"

dotnet build "$scansat_proj/GonogoScansatUplink.Contract.csproj" -v minimal
cp "$RT_PKG/tools/net5.0/Reinforced.Typings.dll" "$scansat_bin/"
cp "$BIN/Sitrep.Contract.dll" "$scansat_bin/"
mkdir -p "$scansat_out_dir"

DOTNET_ROLL_FORWARD=LatestMajor \
  SITREP_SCANSAT_TOPICMAP_OUT="$scansat_out_dir/topic-map.ts" \
  SITREP_SCANSAT_UNITMAP_OUT="$scansat_out_dir/units.ts" \
  SITREP_SCANSAT_UNITJSON_OUT="$scansat_out_dir/units.json" \
  dotnet "$RTCLI" \
  SourceAssemblies="$scansat_bin/GonogoScansatUplink.Contract.dll" \
  TargetFile="$scansat_out_dir/contract.ts" \
  ConfigurationMethod="GonogoScansatUplink.ScansatRtConfig.Configure"
echo "codegen -> $scansat_out_dir/contract.ts"
echo "codegen -> $scansat_out_dir/topic-map.ts"
echo "codegen -> $scansat_out_dir/units.ts"
echo "codegen -> $scansat_out_dir/units.json"

# Kerbalism: the fifth relocation, and the largest by every measure. FIFTEEN
# types and FIVE [SitrepTopic]-tagged roots (kerbalism.spaceweather / .profile /
# .lifesupport / .crew (isArray) / .features), so SITREP_KERBALISM_TOPICMAP_OUT
# is set here the same as the earlier legs above. The emitted units.ts carries
# more weight here than in any predecessor: EmitUnitMap writes the field->unit
# map AND the field->nested-type SHAPE map from one pass, and this slice nests at
# four separate roots (spaceweather's stars/storms, crew's rules, lifesupport's
# habitat/processes/greenhouses, profile's resources/rules/processes), plus a
# Vec3 on a NESTED type (KerbalismStarInfo.direction) that no earlier slice had.
# The client has to register both halves: see KerbalismRtConfig.Configure's doc
# comment.
kerbalism_proj="$ROOT/mod/GonogoKerbalismUplink.Contract"
kerbalism_out_dir="$ROOT/mod/GonogoKerbalismUplink/client/src/__generated__"
kerbalism_bin="$kerbalism_proj/bin/Debug/netstandard2.0"

dotnet build "$kerbalism_proj/GonogoKerbalismUplink.Contract.csproj" -v minimal
cp "$RT_PKG/tools/net5.0/Reinforced.Typings.dll" "$kerbalism_bin/"
cp "$BIN/Sitrep.Contract.dll" "$kerbalism_bin/"
mkdir -p "$kerbalism_out_dir"

DOTNET_ROLL_FORWARD=LatestMajor \
  SITREP_KERBALISM_TOPICMAP_OUT="$kerbalism_out_dir/topic-map.ts" \
  SITREP_KERBALISM_UNITMAP_OUT="$kerbalism_out_dir/units.ts" \
  SITREP_KERBALISM_UNITJSON_OUT="$kerbalism_out_dir/units.json" \
  dotnet "$RTCLI" \
  SourceAssemblies="$kerbalism_bin/GonogoKerbalismUplink.Contract.dll" \
  TargetFile="$kerbalism_out_dir/contract.ts" \
  ConfigurationMethod="GonogoKerbalismUplink.KerbalismRtConfig.Configure"
echo "codegen -> $kerbalism_out_dir/contract.ts"
echo "codegen -> $kerbalism_out_dir/topic-map.ts"
echo "codegen -> $kerbalism_out_dir/units.ts"
echo "codegen -> $kerbalism_out_dir/units.json"

# kOS: the sixth and last relocation in the plan's per-Uplink list. ELEVEN types,
# but only ONE [SitrepTopic]-tagged root (kos.processors, isArray), so
# SITREP_KOS_TOPICMAP_OUT is set here and names exactly one entry. That ratio is
# the point: the other ten are the payloads of DYNAMIC channels
# (kos.terminal.<coreId>, kos.run.<coreId>, kos.compute.<id>.status, whose names
# are only known at runtime and so cannot carry a static tag) and seven
# inbound-only command args. Nothing in this slice nests, so the field ->
# nested-type SHAPE half of the emitted units.ts comes out empty, and exactly one
# declared quantity in the whole slice survives to a Value<> (KosComputeStatus's
# lastGoodAt, Units.Seconds): see KosRtConfig.Configure's doc comment for that
# accounting in full, and this Uplink's client topics.ts for the runtime half.
kos_proj="$ROOT/mod/GonogoKosUplink.Contract"
kos_out_dir="$ROOT/mod/GonogoKosUplink/client/src/__generated__"
kos_bin="$kos_proj/bin/Debug/netstandard2.0"

dotnet build "$kos_proj/GonogoKosUplink.Contract.csproj" -v minimal
cp "$RT_PKG/tools/net5.0/Reinforced.Typings.dll" "$kos_bin/"
cp "$BIN/Sitrep.Contract.dll" "$kos_bin/"
mkdir -p "$kos_out_dir"

DOTNET_ROLL_FORWARD=LatestMajor \
  SITREP_KOS_TOPICMAP_OUT="$kos_out_dir/topic-map.ts" \
  SITREP_KOS_UNITMAP_OUT="$kos_out_dir/units.ts" \
  SITREP_KOS_UNITJSON_OUT="$kos_out_dir/units.json" \
  dotnet "$RTCLI" \
  SourceAssemblies="$kos_bin/GonogoKosUplink.Contract.dll" \
  TargetFile="$kos_out_dir/contract.ts" \
  ConfigurationMethod="Gonogo.KosUplink.KosRtConfig.Configure"
echo "codegen -> $kos_out_dir/contract.ts"
echo "codegen -> $kos_out_dir/topic-map.ts"
echo "codegen -> $kos_out_dir/units.ts"
echo "codegen -> $kos_out_dir/units.json"

# RealAntennas: the seventh and last relocation, and the only PARTIAL one: three
# types carved out of Sitrep.Contract/Comms.cs rather than a whole file moved,
# because the rest of the comms.* family is the shared shape an ELECTED backend
# fills and stays core. Highest Topic ratio of any slice, three types and three
# [SitrepTopic] roots (comms.linkQuality / comms.dataRate / comms.linkMargin), so
# SITREP_REALANTENNAS_TOPICMAP_OUT names all three. No command args at all here
# (these channels are read-only observations) and nothing nests, so the field ->
# nested-type SHAPE half of the emitted units.ts comes out empty. What IS dense is
# the unit retyping: four of the five annotated properties name a real dimension
# (ratio, two bit rates, a decibel margin), so every generated interface in this
# slice carries a Value<>, and its client can prove the runtime hydration by
# decoding a frame rather than by inspecting a registry. See
# RealAntennasRtConfig.Configure's doc comment.
realantennas_proj="$ROOT/mod/GonogoRealAntennasUplink.Contract"
realantennas_out_dir="$ROOT/mod/GonogoRealAntennasUplink/client/src/__generated__"
realantennas_bin="$realantennas_proj/bin/Debug/netstandard2.0"

dotnet build "$realantennas_proj/GonogoRealAntennasUplink.Contract.csproj" -v minimal
cp "$RT_PKG/tools/net5.0/Reinforced.Typings.dll" "$realantennas_bin/"
cp "$BIN/Sitrep.Contract.dll" "$realantennas_bin/"
mkdir -p "$realantennas_out_dir"

DOTNET_ROLL_FORWARD=LatestMajor \
  SITREP_REALANTENNAS_TOPICMAP_OUT="$realantennas_out_dir/topic-map.ts" \
  SITREP_REALANTENNAS_UNITMAP_OUT="$realantennas_out_dir/units.ts" \
  SITREP_REALANTENNAS_UNITJSON_OUT="$realantennas_out_dir/units.json" \
  dotnet "$RTCLI" \
  SourceAssemblies="$realantennas_bin/GonogoRealAntennasUplink.Contract.dll" \
  TargetFile="$realantennas_out_dir/contract.ts" \
  ConfigurationMethod="Gonogo.RealAntennasUplink.RealAntennasRtConfig.Configure"
echo "codegen -> $realantennas_out_dir/contract.ts"
echo "codegen -> $realantennas_out_dir/topic-map.ts"
echo "codegen -> $realantennas_out_dir/units.ts"
echo "codegen -> $realantennas_out_dir/units.json"

# ui-kit's symbol -> kind table is generated FROM the SDK's unit model rather
# than hand-maintained beside it. It is a separate step because its input is
# TypeScript rather than the C# assembly: see scripts/gen-unit-kinds.mjs. Run
# through `pnpm codegen`, which chains the two.
