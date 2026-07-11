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
        // emits DATA SHAPES ONLY — no constructors, no static factory methods
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
        // must have identical type parameters") — TS interface-merging cannot span a
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
                typeof(VesselTarget),
                typeof(VesselThermal),
                // nested payload records
                typeof(OrbitEncounter),
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
                typeof(CommsLinkQuality),
                typeof(CommsDataRate),
                typeof(CommsLinkMargin),
                // kos.* channels
                typeof(KosProcessorInfo),
                typeof(KosComputeStatus),
                typeof(KosExecArgs),
                typeof(KosReEnableArgs),
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
                // system.* channel payloads + entries (P0.5)
                typeof(SystemBodies),
                typeof(BodyEntry),
                typeof(OrbitEntry),
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
                // vessel.parts channel payload + nested value shapes (P1b)
                typeof(VesselParts),
                typeof(VesselPart),
                typeof(PartBounds),
                // spaceCenter.launchSites / spaceCenter.scene (P1b)
                typeof(LaunchSiteEntry),
                typeof(SpaceCenterScene),
                // spaceCenter.crewRoster / spaceCenter.savedShips / spaceCenter.partsAvailable
                typeof(CrewRosterEntry),
                typeof(SavedShipEntry),
                typeof(SpaceCenterPartsAvailable),
                // dv.stages / dv.summary (P1b)
                typeof(StageDeltaVEntry),
                typeof(StageDeltaVSummary),
                // crash.lastCrash payload + nested value shapes
                typeof(CrashReport),
                typeof(CrashPartLost),
                typeof(CrashFlightStats),
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
            });

        // --- Topic -> payload map (single source of truth for the SDK registry) ---
        // Reinforced.Typings emits the payload INTERFACES above but has no notion
        // of the TopicId -> payload string-keyed map the SDK's topics.ts needs.
        // codegen.sh sets SITREP_TOPICMAP_OUT to the generated map's path; when it
        // is present we reflect over every [SitrepTopic]-tagged type in this
        // assembly and write that map alongside contract.ts, so ONE `codegen.sh`
        // run regenerates both committed artifacts from the same contract source.
        // No-op (and no dependency) when the env var is unset — e.g. a bare rtcli
        // invocation that only wants contract.ts.
        var topicMapOut = Environment.GetEnvironmentVariable("SITREP_TOPICMAP_OUT");
        if (!string.IsNullOrEmpty(topicMapOut))
        {
            EmitTopicMap(topicMapOut!);
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
        sb.Append("// value — with `[]` appended for the IsArray channels whose payload is a\n");
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
}
#endif
