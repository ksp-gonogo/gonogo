#if NETSTANDARD2_0
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using Reinforced.Typings.Fluent;

namespace Sitrep.Contract;

public static class RtConfig
{
    public static void Configure(ConfigurationBuilder builder)
    {
        builder.Global(g => g
            .CamelCaseForProperties()
            .UseModules(true) // ES modules: `export interface`, no `module` wrapper
            .AutoOptionalProperties()); // C# `T?` -> TS `prop?`

        // --- Envelope (non-generic) ---
        // Register directly via ExportAsInterface<T>(), which shares the same
        // TypeBlueprint the [TsInterface] attribute already created for the type.
        // AutoI(false) keeps the plain C# name (no I-prefix); WithPublicProperties
        // emits DATA SHAPES ONLY, no constructors, no static factory methods
        // (e.g. Vec3's ctors, CommandResult.Ok/Fail) leak onto the wire type.
        builder.ExportAsInterface<Meta>().AutoI(false).WithPublicProperties().OverrideName("Meta");
        builder.ExportAsInterface<EventMsg>().AutoI(false).WithPublicProperties().OverrideName("EventMsg");
        builder.ExportAsInterface<ErrorMsg>().AutoI(false).WithPublicProperties().OverrideName("ErrorMsg");
        builder.ExportAsInterface<Subscribe>().AutoI(false).WithPublicProperties().OverrideName("Subscribe");
        builder.ExportAsInterface<Unsubscribe>().AutoI(false).WithPublicProperties().OverrideName("Unsubscribe");

        // --- Envelope + command generics (open generic definitions) ---
        // ExportAsInterface<StreamData<object>>() would target the CLOSED
        // constructed type (a distinct TypeBlueprint from the open generic definition
        // the attribute scan already registered), producing a redundant non-generic
        // duplicate with `any` in place of the type parameter. Registering the open
        // generic type definition via the Type-based ExportAsInterfaces overload
        // instead configures the SAME blueprint the attribute scan produced, so the
        // emitted interface keeps its `<T>` / `<TArgs>` / `<TResult>` generic parameter.
        builder.ExportAsInterfaces(
            new[] { typeof(StreamData<>) },
            c => c.AutoI(false).WithPublicProperties().OverrideName("StreamData"));
        builder.ExportAsInterfaces(
            new[] { typeof(CommandRequest<>) },
            c => c.AutoI(false).WithPublicProperties().OverrideName("CommandRequest"));
        builder.ExportAsInterfaces(
            new[] { typeof(CommandResponse<>) },
            c => c.AutoI(false).WithPublicProperties().OverrideName("CommandResponse"));

        // The generic result carries a distinct name (CommandResultOf<T>) from its
        // non-generic base (CommandResult). Two `export interface CommandResult`
        // declarations of differing arity would be a TS2428 error ("all declarations
        // must have identical type parameters"), TS interface-merging cannot span a
        // generic/non-generic pair. Renaming the generic sidesteps the collision while
        // keeping the base name stable; CommandResultOf<T> still `extends CommandResult`.
        builder.ExportAsInterfaces(
            new[] { typeof(CommandResult<>) },
            c => c.AutoI(false).WithPublicProperties().OverrideName("CommandResultOf"));

        // --- Wire payload types (non-generic) ---
        // Everything else marked [SitrepContract]/[TsInterface] that crosses the wire:
        // vessel.* channel payloads, comms.* channels, kos.* channels, command args,
        // and the shared value shapes (Vec3, PayloadMeta, CommandResult).
        builder.ExportAsInterfaces(
            new[]
            {
                // shared value shapes
                typeof(Vec3),
                typeof(PayloadMeta),
                typeof(CommandResult),
                // vessel.* channels
                typeof(VesselAttitude),
                typeof(VesselComms),
                typeof(VesselControl),
                typeof(VesselCrew),
                typeof(VesselFlight),
                typeof(VesselIdentity),
                typeof(VesselManeuver),
                typeof(VesselOrbit),
                typeof(VesselOrbitTruth),
                typeof(VesselPropulsion),
                typeof(VesselResources),
                typeof(VesselStructure),
                typeof(VesselSurface),
                typeof(VesselLanding),
                typeof(VesselTarget),
                typeof(VesselThermal),
                // target.available list channel + its entry + the mod-side
                // closest-approach payload carried on vessel.target
                typeof(TargetAvailable),
                typeof(TargetListEntry),
                typeof(ClosestApproach),
                // nested payload records
                typeof(OrbitEncounter),
                typeof(OrbitPatch),
                typeof(ManeuverNode),
                typeof(DockAlignment),
                typeof(ResourceAmount),
                typeof(ThermalHottestPart),
                typeof(WarpState),
                // comms.* channels
                typeof(CommsConnectivity),
                typeof(CommsSignalStrength),
                typeof(CommsControlState),
                typeof(CommsPath),
                typeof(CommsHop),
                typeof(CommsNetwork),
                typeof(CommsNetworkNode),
                typeof(CommsNetworkEdge),
                typeof(CommsDelay),
                // comms.link connectivity MetaTopic (Delayed, freeze-exempt)
                typeof(CommsLink),
                typeof(CommsLinkQuality),
                typeof(CommsDataRate),
                typeof(CommsLinkMargin),
                // kos.* channels
                typeof(KosProcessorInfo),
                typeof(KosComputeStatus),
                typeof(KosExecArgs),
                typeof(KosReEnableArgs),
                // kos.terminal.<coreId> interactive terminal, downlink frame + command args
                typeof(KosTerminalFrame),
                typeof(KosTerminalOpenArgs),
                typeof(KosKeystrokeArgs),
                typeof(KosTerminalResizeArgs),
                typeof(KosTerminalCloseArgs),
                // kos.run.<coreId> ad-hoc RPC (kos-uplink-full-migration.md), command args + result
                typeof(KosRunArgs),
                typeof(KosRunResult),
                // command args
                typeof(AddManeuverNodeArgs),
                typeof(UpdateManeuverNodeArgs),
                typeof(RemoveManeuverNodeArgs),
                typeof(SetActionGroupArgs),
                typeof(SetEnabledArgs),
                typeof(SetPausedArgs),
                typeof(SetSasModeArgs),
                typeof(SetTargetArgs),
                typeof(SetThrottleArgs),
                typeof(SetWarpIndexArgs),
                // career-write / flight-ops / robotics / science command args
                typeof(ActivateStrategyArgs),
                typeof(DeactivateStrategyArgs),
                typeof(UnlockTechArgs),
                typeof(ContractActionArgs),
                typeof(UpgradeFacilityArgs),
                typeof(RevertToEditorArgs),
                typeof(SwitchVesselArgs),
                typeof(LaunchArgs),
                typeof(ServoSetTargetArgs),
                typeof(ServoSetEnabledArgs),
                typeof(RotorSetValueArgs),
                typeof(RotorReverseArgs),
                typeof(ExperimentActionArgs),
                // vessel.control fly-by-wire command args
                typeof(SetFlyByWireArgs),
                typeof(SetControlAxesArgs),
                // career.status channel payload + sub-groups (P0.5)
                typeof(CareerStatus),
                typeof(CareerEconomy),
                typeof(CareerFacility),
                typeof(CareerContracts),
                typeof(CareerContract),
                typeof(CareerContractParameter),
                typeof(CareerStrategies),
                typeof(CareerStrategy),
                typeof(CareerTech),
                typeof(CareerTechNode),
                // parts.* channel payloads + entries (P0.5)
                typeof(SolarPanelEntry),
                typeof(BatteryEntry),
                typeof(FuelCellEntry),
                typeof(AlternatorEntry),
                typeof(PartsPower),
                typeof(ServoEntry),
                // science.* channel payload entries (P0.5)
                typeof(ExperimentEntry),
                typeof(LabEntry),
                typeof(DeployedEntry),
                // science.experimentBreakdown per-subject rollup
                typeof(ExperimentBreakdownEntry),
                // system.* channel payloads + entries (P0.5)
                // system.uplink.pending, the in-transit command queue snapshot
                // (engine-declared channel, no [SitrepTopic]; hand-declared in
                // topics.ts). Registered here for AutoI(false) so the generated
                // interfaces stay I-prefix-free like every other payload.
                typeof(PendingUplink),
                typeof(PendingUplinkQueue),
                typeof(SystemBodies),
                typeof(BodyEntry),
                typeof(OrbitEntry),
                typeof(AtmosphereEntry),
                typeof(SystemVessels),
                typeof(VesselRosterEntry),
                // career.mode / game.dlc / ksp.revertAvailability / robotics.available
                typeof(CareerMode),
                typeof(GameDlc),
                typeof(RevertAvailability),
                typeof(RoboticsAvailability),
                // vessel.physics.mode + vessel.crew nested roster entry
                typeof(VesselPhysicsMode),
                typeof(CrewMember),
                // science.instruments / science.sensors entries
                typeof(InstrumentEntry),
                typeof(SensorEntry),
                // scansat.scanningVessels payload + nested value shapes
                typeof(ScanningVesselEntry),
                typeof(ScanSensorEntry),
                typeof(ScanTrackColor),
                // scansat.science payload (per-part map-experiment state)
                typeof(ScanScienceEntry),
                // scansat.anomalies.<body> dynamic-namespace element shape
                // (typing-only, no [SitrepTopic], see ScanAnomalyEntry's doc)
                typeof(ScanAnomalyEntry),
                // kerbcast.cameras payload + its command args (control plane
                // only, kerbcast's video stays on WebRTC, see KerbcastPayloads)
                typeof(KerbcastCameraEntry),
                typeof(KerbcastSetFieldOfViewArgs),
                typeof(KerbcastSetPanArgs),
                // vessel.parts channel payload + nested value shapes (P1b)
                typeof(VesselParts),
                typeof(VesselPart),
                typeof(PartBounds),
                // vessel.parts per-part live data (resources/module state
                // gap-close, un-gaps usePartsLive off the legacy source)
                typeof(PartResourceFlow),
                typeof(PartModuleState),
                // vessel.parts per-part action-group bindings (retires the
                // f.ag.bindings shim)
                typeof(ActionBinding),
                // spaceCenter.launchSites / spaceCenter.scene (P1b)
                typeof(LaunchSiteEntry),
                typeof(SpaceCenterScene),
                // spaceCenter.crewRoster / spaceCenter.savedShips / spaceCenter.partsAvailable
                typeof(CrewRosterEntry),
                typeof(SavedShipEntry),
                typeof(SpaceCenterPartsAvailable),
                // spaceCenter.pois: the map points-of-interest union (T-POI-3)
                typeof(SpaceCenterPoiEntry),
                // dv.stages / dv.summary (P1b)
                typeof(StageDeltaVEntry),
                typeof(StageDeltaVSummary),
                // crash.lastCrash payload + nested value shapes
                typeof(CrashReport),
                typeof(CrashPartLost),
                typeof(CrashFlightStats),
                // recovery.lastSummary payload + nested value shapes
                typeof(RecoveryReport),
                typeof(RecoveryScienceEntry),
                typeof(RecoveryPartEntry),
                typeof(RecoveryResourceEntry),
                typeof(RecoveryCrewEntry),
                // flight.current / flight.started / flight.ended / flight.vesselChanged
                //, the flight-lifecycle domain (P4c-b flight-lifecycle spec,
                // 2026-07-11). Replaces the client-side FlightDetector heuristic.
                typeof(FlightCurrent),
                typeof(FlightStarted),
                typeof(FlightEnded),
                typeof(FlightVesselChanged),
                // One NAMED custom action group on vessel.control.actionGroups,
                // the element type that replaced the positional bool[].
                typeof(ActionGroupState),
                // kerbalism.* channels (Domain "kerbalism") + nested value shapes
                typeof(KerbalismSpaceWeather),
                typeof(KerbalismResource),
                typeof(KerbalismHabitat),
                typeof(KerbalismProcessEntry),
                typeof(KerbalismGreenhouseEntry),
                typeof(KerbalismLifeSupport),
                typeof(KerbalismCrewRule),
                typeof(KerbalismCrewEntry),
                typeof(KerbalismFeatures),
                // reliability.* capability channels (Domain-neutral; see Reliability.cs)
                typeof(ReliabilitySummary),
                typeof(ReliabilityPartEntry),
                // avionics.status, RP-1 controllable-mass ascent go/no-go
                typeof(AvionicsStatus),
            },
            c => c.AutoI(false).WithPublicProperties());

        // --- Enums (numeric `export enum`, per the existing Quality/Staleness convention) ---
        builder.ExportAsEnums(
            new[]
            {
                typeof(Quality),
                typeof(Staleness),
                typeof(CommandErrorCode),
                typeof(CommsControlSource),
                typeof(CommsControlStateKind),
                typeof(CommsDelaySource),
                typeof(CommsHopKind),
                typeof(ControlState),
                typeof(SasMode),
                typeof(Situation),
                typeof(TargetKind),
                typeof(TransitionType),
                typeof(VesselType),
                typeof(WarpMode),
                typeof(GameMode),
                typeof(PhysicsMode),
                typeof(FlightEndReason),
                typeof(RosterCommsControlSource),
            });

        // --- Topic -> payload map (single source of truth for the SDK registry) ---
        // Reinforced.Typings emits the payload INTERFACES above but has no notion
        // of the TopicId -> payload string-keyed map the SDK's topics.ts needs.
        // codegen.sh sets SITREP_TOPICMAP_OUT to the generated map's path; when it
        // is present we reflect over every [SitrepTopic]-tagged type in this
        // assembly and write that map alongside contract.ts, so ONE `codegen.sh`
        // run regenerates both committed artifacts from the same contract source.
        // No-op (and no dependency) when the env var is unset, e.g. a bare rtcli
        // invocation that only wants contract.ts.
        var topicMapOut = Environment.GetEnvironmentVariable("SITREP_TOPICMAP_OUT");
        if (!string.IsNullOrEmpty(topicMapOut))
        {
            EmitTopicMap(topicMapOut!);
        }

        // --- Field -> unit map (see SitrepUnitAttribute) ---
        // Same shape of problem, and same answer, as the topic map above:
        // Reinforced.Typings emits TYPES, and a unit is a runtime VALUE a
        // formatter has to look up, so it cannot live in contract.ts at all
        // (rtcli emits interfaces + enums; there is no hook for an arbitrary
        // const map). codegen.sh sets SITREP_UNITMAP_OUT and we reflect over
        // the [SitrepUnit]-tagged properties to write units.ts alongside.
        // Keeping it a SEPARATE artifact also means contract.ts stays exactly
        // what rtcli produced, with no post-processing step to drift.
        var unitMapOut = Environment.GetEnvironmentVariable("SITREP_UNITMAP_OUT");
        if (!string.IsNullOrEmpty(unitMapOut))
        {
            EmitUnitMap(unitMapOut!);
        }
    }

    /// <summary>
    /// Writes the generated Topic -> payload map (<c>GeneratedTopicPayloadMap</c>
    /// + <c>GENERATED_TOPIC_IDS</c>) consumed by
    /// <c>mod/sitrep-sdk/src/topics.ts</c>. Each <c>[SitrepTopic]</c>-tagged
    /// contract type contributes one entry: the attribute's <c>TopicId</c> is the
    /// key and the type's generated interface name is the value (with <c>[]</c>
    /// appended for the <c>IsArray</c> channels, whose wire payload is a bare JSON
    /// array of the tagged element type). Every referenced interface is emitted
    /// into <c>./contract.ts</c> by the registrations above, so the map's imports
    /// always resolve.
    /// </summary>
    private static void EmitTopicMap(string outPath)
    {
        var entries = new List<KeyValuePair<string, string>>();
        var typeNames = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var type in typeof(RtConfig).Assembly.GetTypes())
        {
            var attr = type.GetCustomAttribute<SitrepTopicAttribute>();
            if (attr == null)
            {
                continue;
            }

            entries.Add(new KeyValuePair<string, string>(
                attr.TopicId,
                type.Name + (attr.IsArray ? "[]" : "")));
            typeNames.Add(type.Name);
        }

        entries.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));

        var sb = new StringBuilder();
        sb.Append("//     This code was generated by the Sitrep contract topic-map codegen\n");
        sb.Append("//     (Sitrep.Contract.RtConfig.EmitTopicMap, invoked from mod/codegen.sh).\n");
        sb.Append("//     Changes to this file may cause incorrect behavior and will be lost if\n");
        sb.Append("//     the code is regenerated.\n");
        sb.Append("//\n");
        sb.Append("// Derived by reflecting over every [SitrepTopic]-tagged payload type in\n");
        sb.Append("// Sitrep.Contract: the attribute's TopicId is the map key and the tagged\n");
        sb.Append("// type's generated interface (its plain C# name in ./contract.ts) is the\n");
        sb.Append("// value, with `[]` appended for the IsArray channels whose payload is a\n");
        sb.Append("// bare JSON array of the element type.\n\n");

        sb.Append("import type {\n");
        foreach (var name in typeNames)
        {
            sb.Append("  ").Append(name).Append(",\n");
        }
        sb.Append("} from \"./contract\";\n\n");

        sb.Append("export interface GeneratedTopicPayloadMap {\n");
        foreach (var entry in entries)
        {
            sb.Append("  \"").Append(entry.Key).Append("\": ").Append(entry.Value).Append(";\n");
        }
        sb.Append("}\n\n");

        sb.Append("export const GENERATED_TOPIC_IDS = [\n");
        foreach (var entry in entries)
        {
            sb.Append("  \"").Append(entry.Key).Append("\",\n");
        }
        sb.Append("] as const;\n");

        File.WriteAllText(outPath, sb.ToString());
        Console.WriteLine("codegen (topic-map) -> " + outPath);
    }

    /// <summary>
    /// Writes the generated field -> unit map (<c>SitrepUnit</c>,
    /// <c>GENERATED_TYPE_UNITS</c> and <c>GENERATED_TOPIC_UNITS</c>) consumed by
    /// <c>mod/sitrep-sdk/src/units.ts</c>. Every property carrying
    /// <see cref="SitrepUnitAttribute"/> contributes one entry under its
    /// declaring type's generated interface name, keyed by the CAMEL-CASED
    /// property name so the key matches the emitted TS field exactly
    /// (<c>CamelCaseForProperties</c> above lowercases the leading character and
    /// changes nothing else, hence the same one-character transform here).
    ///
    /// <para>Two views come out of the one scan. <c>GENERATED_TYPE_UNITS</c> is
    /// keyed by interface name and covers NESTED payload shapes too (e.g.
    /// <see cref="ThermalHottestPart"/>), which no Topic names directly.
    /// <c>GENERATED_TOPIC_UNITS</c> is the ergonomic view for a widget, which
    /// holds a Topic id rather than a type name; for an <c>IsArray</c> Topic the
    /// entry describes the ELEMENT's fields, since that is what a consumer
    /// indexes into.</para>
    ///
    /// <para>The <c>SitrepUnit</c> union is emitted from the whole
    /// <see cref="Units"/> catalog, not merely the tokens currently in use, so
    /// it is the stable vocabulary a client-side formatter can switch over
    /// exhaustively while annotation coverage is still being filled in.</para>
    /// </summary>
    private static void EmitUnitMap(string outPath)
    {
        // The closed vocabulary: every public const string on Units.
        var vocabulary = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var field in typeof(Units).GetFields(BindingFlags.Public | BindingFlags.Static))
        {
            if (field.IsLiteral && field.FieldType == typeof(string))
            {
                vocabulary.Add((string)field.GetRawConstantValue());
            }
        }

        var byType = new SortedDictionary<string, SortedDictionary<string, string>>(StringComparer.Ordinal);
        var byTopic = new SortedDictionary<string, SortedDictionary<string, string>>(StringComparer.Ordinal);
        foreach (var type in typeof(RtConfig).Assembly.GetTypes())
        {
            var fields = new SortedDictionary<string, string>(StringComparer.Ordinal);
            foreach (var prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                var unit = prop.GetCustomAttribute<SitrepUnitAttribute>();
                if (unit == null)
                {
                    continue;
                }

                if (!vocabulary.Contains(unit.Unit))
                {
                    // A token outside the catalog is drift for anything compiled
                    // INTO this assembly, and everything reflected here is, so
                    // this stays a hard failure. First-party payloads keep their
                    // typo-safety.
                    //
                    // It is deliberately NOT the rule for a third-party Uplink.
                    // An Uplink cannot add to Units (it is a const-string class
                    // in this assembly), so a closed union would mean an Uplink
                    // could never declare a unit at all. The generated
                    // SitrepUnit type is open for exactly that reason: known
                    // tokens still autocomplete and a mod's own symbol is still
                    // assignable. See the union emitted below.
                    throw new InvalidOperationException(
                        "[SitrepUnit] on " + type.Name + "." + prop.Name + " carries \"" + unit.Unit +
                        "\", which is not a Sitrep.Contract.Units constant. Add it to the Units catalog. " +
                        "(A third-party Uplink does not go through this check: it declares its unit as a " +
                        "plain string and registers the kind client-side via registerUnit.)");
                }

                fields.Add(CamelCase(prop.Name), unit.Unit);
            }

            if (fields.Count == 0)
            {
                continue;
            }

            byType.Add(type.Name, fields);

            var topic = type.GetCustomAttribute<SitrepTopicAttribute>();
            if (topic != null)
            {
                byTopic.Add(topic.TopicId, fields);
            }
        }

        var sb = new StringBuilder();
        sb.Append("//     This code was generated by the Sitrep contract unit-map codegen\n");
        sb.Append("//     (Sitrep.Contract.RtConfig.EmitUnitMap, invoked from mod/codegen.sh).\n");
        sb.Append("//     Changes to this file may cause incorrect behavior and will be lost if\n");
        sb.Append("//     the code is regenerated.\n");
        sb.Append("//\n");
        sb.Append("// Derived by reflecting over every [SitrepUnit]-tagged property in\n");
        sb.Append("// Sitrep.Contract. Keys are the camelCased field names as they appear in\n");
        sb.Append("// ./contract.ts. A field ABSENT here has no declared unit yet (the default),\n");
        sb.Append("// which is not the same as being dimensionless: dimensionless is the\n");
        sb.Append("// explicit \"1\" token.\n\n");

        sb.Append("/** Every token first-party payloads use (Sitrep.Contract.Units). */\n");
        sb.Append("export type KnownSitrepUnit =\n");
        foreach (var token in vocabulary)
        {
            sb.Append("  | \"").Append(token).Append("\"\n");
        }
        sb.Append(";\n\n");

        sb.Append("/**\n");
        sb.Append(" * A declared unit. OPEN on purpose.\n");
        sb.Append(" *\n");
        sb.Append(" * The known tokens above still autocomplete, and a typo in first-party\n");
        sb.Append(" * code is still caught at codegen time by the catalog check. The open arm\n");
        sb.Append(" * exists because a third-party Uplink CANNOT add to Sitrep.Contract.Units:\n");
        sb.Append(" * it is a const-string class compiled into the contract assembly. Closing\n");
        sb.Append(" * this union would therefore have meant an Uplink could never declare a\n");
        sb.Append(" * unit at all, which contradicts third parties being first-class.\n");
        sb.Append(" *\n");
        sb.Append(" * A consumer teaches the client what an unknown symbol MEANS by calling\n");
        sb.Append(" * registerUnit from @ksp-gonogo/ui-kit. Until it does, the value still\n");
        sb.Append(" * renders, bare and unscaled.\n");
        sb.Append(" */\n");
        sb.Append("export type SitrepUnit = KnownSitrepUnit | (string & {});\n\n");

        sb.Append("/** Declared units for one payload shape, keyed by camelCased field name. */\n");
        sb.Append("export type UnitsByField = Readonly<Record<string, SitrepUnit>>;\n\n");

        sb.Append("/**\n");
        sb.Append(" * Keyed by the generated interface name in ./contract.ts. Covers NESTED\n");
        sb.Append(" * payload shapes that no Topic names directly.\n");
        sb.Append(" */\n");
        sb.Append("export const GENERATED_TYPE_UNITS: Readonly<Record<string, UnitsByField>> = {\n");
        AppendMapBody(sb, byType);
        sb.Append("};\n\n");

        sb.Append("/**\n");
        sb.Append(" * Keyed by Topic id. For an array Topic the entry describes the ELEMENT's\n");
        sb.Append(" * fields, which is what a consumer indexes into.\n");
        sb.Append(" */\n");
        sb.Append("export const GENERATED_TOPIC_UNITS: Readonly<Record<string, UnitsByField>> = {\n");
        AppendMapBody(sb, byTopic);
        sb.Append("};\n");

        File.WriteAllText(outPath, sb.ToString());
        Console.WriteLine("codegen (unit-map) -> " + outPath);
    }

    private static void AppendMapBody(
        StringBuilder sb,
        SortedDictionary<string, SortedDictionary<string, string>> map)
    {
        foreach (var outer in map)
        {
            sb.Append("  \"").Append(outer.Key).Append("\": {\n");
            foreach (var inner in outer.Value)
            {
                sb.Append("    ").Append(inner.Key).Append(": \"").Append(inner.Value).Append("\",\n");
            }
            sb.Append("  },\n");
        }
    }

    /// <summary>
    /// Mirrors <c>CamelCaseForProperties</c>: lowercase the leading character,
    /// leave the rest alone (so <c>DynamicPressureKPa</c> stays
    /// <c>dynamicPressureKPa</c> and <c>GForce</c> becomes <c>gForce</c>, both
    /// exactly as they appear in the emitted contract.ts).
    /// </summary>
    private static string CamelCase(string name)
    {
        if (string.IsNullOrEmpty(name) || !char.IsUpper(name[0]))
        {
            return name;
        }

        return char.ToLowerInvariant(name[0]) + name.Substring(1);
    }
}
#endif
