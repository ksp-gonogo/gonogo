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
mechjeb_proj="$ROOT/mod/GonogoMechJebUplink.Contract.Codegen"
mechjeb_out_dir="$ROOT/mod/GonogoMechJebUplink/client/src/__generated__"
mechjeb_bin="$mechjeb_proj/bin/Debug/netstandard2.0"

dotnet build "$mechjeb_proj/GonogoMechJebUplink.Contract.Codegen.csproj" -v minimal
# rtcli loads this assembly's metadata and has to resolve every type it
# references (SitrepContractAttribute, SitrepUnitAttribute, Units, ...), so
# Sitrep.Contract.dll must sit alongside it. The twin references the core twin
# normally, so the build puts it there; the shipped slice keeps its
# Private="false" reference, core providing it at runtime.
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
avionics_proj="$ROOT/mod/GonogoAvionicsUplink.Contract.Codegen"
avionics_out_dir="$ROOT/mod/GonogoAvionicsUplink/client/src/__generated__"
avionics_bin="$avionics_proj/bin/Debug/netstandard2.0"

dotnet build "$avionics_proj/GonogoAvionicsUplink.Contract.Codegen.csproj" -v minimal
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
kerbcast_proj="$ROOT/mod/GonogoKerbcastUplink.Contract.Codegen"
kerbcast_out_dir="$ROOT/mod/GonogoKerbcastUplink/client/src/__generated__"
kerbcast_bin="$kerbcast_proj/bin/Debug/netstandard2.0"

dotnet build "$kerbcast_proj/GonogoKerbcastUplink.Contract.Codegen.csproj" -v minimal
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
kerbalism_proj="$ROOT/mod/GonogoKerbalismUplink.Contract.Codegen"
kerbalism_out_dir="$ROOT/mod/GonogoKerbalismUplink/client/src/__generated__"
kerbalism_bin="$kerbalism_proj/bin/Debug/netstandard2.0"

dotnet build "$kerbalism_proj/GonogoKerbalismUplink.Contract.Codegen.csproj" -v minimal
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
kos_proj="$ROOT/mod/GonogoKosUplink.Contract.Codegen"
kos_out_dir="$ROOT/mod/GonogoKosUplink/client/src/__generated__"
kos_bin="$kos_proj/bin/Debug/netstandard2.0"

dotnet build "$kos_proj/GonogoKosUplink.Contract.Codegen.csproj" -v minimal
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
realantennas_proj="$ROOT/mod/GonogoRealAntennasUplink.Contract.Codegen"
realantennas_out_dir="$ROOT/mod/GonogoRealAntennasUplink/client/src/__generated__"
realantennas_bin="$realantennas_proj/bin/Debug/netstandard2.0"

dotnet build "$realantennas_proj/GonogoRealAntennasUplink.Contract.Codegen.csproj" -v minimal
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

# Principia: the flight-plan slice. PrincipiaFlightPlan carries
# [SitrepTopic("principia.flightPlan")], so the topic map is emitted here the
# same as every other topic-carrying slice above. What IS different is that this
# slice has TWO exported
# types, the plan and its burn rows, and both are in the ExportAsInterfaces set
# in PrincipiaRtConfig: a nested payload left out of that set generates with
# bare numbers where its parent generates Value<> types, in the same file, with
# nothing failing.
principia_proj="$ROOT/mod/GonogoPrincipiaUplink.Contract.Codegen"
principia_out_dir="$ROOT/mod/GonogoPrincipiaUplink/client/src/__generated__"
principia_bin="$principia_proj/bin/Debug/netstandard2.0"

dotnet build "$principia_proj/GonogoPrincipiaUplink.Contract.Codegen.csproj" -v minimal
cp "$RT_PKG/tools/net5.0/Reinforced.Typings.dll" "$principia_bin/"
mkdir -p "$principia_out_dir"

DOTNET_ROLL_FORWARD=LatestMajor \
  SITREP_PRINCIPIA_TOPICMAP_OUT="$principia_out_dir/topic-map.ts" \
  SITREP_PRINCIPIA_UNITMAP_OUT="$principia_out_dir/units.ts" \
  SITREP_PRINCIPIA_UNITJSON_OUT="$principia_out_dir/units.json" \
  dotnet "$RTCLI" \
  SourceAssemblies="$principia_bin/GonogoPrincipiaUplink.Contract.dll" \
  TargetFile="$principia_out_dir/contract.ts" \
  ConfigurationMethod="GonogoPrincipiaUplink.PrincipiaRtConfig.Configure"
echo "codegen -> $principia_out_dir/contract.ts"
echo "codegen -> $principia_out_dir/topic-map.ts"
echo "codegen -> $principia_out_dir/units.ts"
echo "codegen -> $principia_out_dir/units.json"

# RP-1: the space-centre and Programs slice. Eleven types, eleven
# [SitrepTopic]s, and two unit tokens core has never heard of (bp and
# confidence), declared in this slice's own Units class. The catalog check judges the slice against core's tokens PLUS
# that class, so an undeclared token stops the build here rather than reaching
# the client as an opaque symbol with no ladder.
rp1_proj="$ROOT/mod/GonogoRp1Uplink.Contract.Codegen"
rp1_out_dir="$ROOT/mod/GonogoRp1Uplink/client/src/__generated__"
rp1_bin="$rp1_proj/bin/Debug/netstandard2.0"

dotnet build "$rp1_proj/GonogoRp1Uplink.Contract.Codegen.csproj" -v minimal
mkdir -p "$rp1_out_dir"

DOTNET_ROLL_FORWARD=LatestMajor \
  SITREP_RP1_TOPICMAP_OUT="$rp1_out_dir/topic-map.ts" \
  SITREP_RP1_UNITMAP_OUT="$rp1_out_dir/units.ts" \
  SITREP_RP1_UNITJSON_OUT="$rp1_out_dir/units.json" \
  dotnet "$RTCLI" \
  SourceAssemblies="$rp1_bin/GonogoRp1Uplink.Contract.dll" \
  TargetFile="$rp1_out_dir/contract.ts" \
  ConfigurationMethod="GonogoRp1Uplink.Rp1RtConfig.Configure"
echo "codegen -> $rp1_out_dir/contract.ts"
echo "codegen -> $rp1_out_dir/topic-map.ts"
echo "codegen -> $rp1_out_dir/units.ts"
echo "codegen -> $rp1_out_dir/units.json"

# Ferram Aerospace Research: the aerodynamic-state slice. One type, one
# [SitrepTopic] (aero.state), and the densest unit annotation of any slice:
# twelve of AeroState's fifteen properties name a real dimension, so nearly the
# whole generated interface retypes to Value<>. Two of those tokens are this
# Uplink's own (kg/m² and W/kg, declared in its Units class), and the catalog
# check judges the slice against core's tokens PLUS that class.
aero_proj="$ROOT/mod/GonogoFerramAerospaceResearchUplink.Contract.Codegen"
aero_out_dir="$ROOT/mod/GonogoFerramAerospaceResearchUplink/client/src/__generated__"
aero_bin="$aero_proj/bin/Debug/netstandard2.0"

dotnet build "$aero_proj/GonogoFerramAerospaceResearchUplink.Contract.Codegen.csproj" -v minimal
mkdir -p "$aero_out_dir"

DOTNET_ROLL_FORWARD=LatestMajor \
  SITREP_AERO_TOPICMAP_OUT="$aero_out_dir/topic-map.ts" \
  SITREP_AERO_UNITMAP_OUT="$aero_out_dir/units.ts" \
  SITREP_AERO_UNITJSON_OUT="$aero_out_dir/units.json" \
  dotnet "$RTCLI" \
  SourceAssemblies="$aero_bin/GonogoFerramAerospaceResearchUplink.Contract.dll" \
  TargetFile="$aero_out_dir/contract.ts" \
  ConfigurationMethod="GonogoFerramAerospaceResearchUplink.AeroRtConfig.Configure"
echo "codegen -> $aero_out_dir/contract.ts"
echo "codegen -> $aero_out_dir/topic-map.ts"
echo "codegen -> $aero_out_dir/units.ts"
echo "codegen -> $aero_out_dir/units.json"

# ui-kit's symbol -> kind table is generated FROM the SDK's unit model rather
# than hand-maintained beside it. It is a separate step because its input is
# TypeScript rather than the C# assembly: see scripts/gen-unit-kinds.mjs. Run
# through `pnpm codegen`, which chains the two.
