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
        // Held in a local rather than passed inline because the unit-typing
        // pass below re-enters this set: only a type registered with rtcli may
        // have its properties retyped, so the two lists must not drift apart.
        var wirePayloadTypes = new[]
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
            };
        builder.ExportAsInterfaces(wirePayloadTypes, c => c.AutoI(false).WithPublicProperties());

        // --- Declared units become TYPES, not just a lookup ---
        // Retypes every quantity-bearing property to Value<"<token>"> so the unit
        // travels in the type system rather than in a map a caller has to
        // remember to consult. Runs last: it configures properties on blueprints
        // the registrations above already created.
        //
        // The envelope types are registered one at a time further up (they each
        // need an OverrideName), so they have to be named again here. Forgetting
        // one is not silent: `generated.test.ts` walks the WHOLE field->unit map
        // against the emitted source, so an annotated property that never got
        // its Value<> fails there. Meta's validAt/deliveredAt is how this list
        // came to exist.
        var unitTypedTypes = new List<Type>(wirePayloadTypes)
        {
            typeof(Meta),
            typeof(EventMsg),
            typeof(ErrorMsg),
            typeof(Subscribe),
            typeof(Unsubscribe),
            typeof(StreamData<>),
            typeof(CommandRequest<>),
            typeof(CommandResponse<>),
            typeof(CommandResult<>),
        };
        ApplyUnitValueTypes(builder, unitTypedTypes);

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

        // --- Control-channel map (see SitrepControlChannelAttribute) ---
        // Same shape of problem, and same answer, as the topic and unit maps:
        // rtcli emits TYPES, and a control channel is a runtime pairing (read
        // topic field + write command) the SDK looks up, so it needs its own
        // artifact. codegen.sh sets SITREP_CHANNELMAP_OUT and we reflect over the
        // [SitrepControlChannel]-tagged read properties to write control-channels.ts
        // alongside. No-op when the env var is unset.
        var channelMapOut = Environment.GetEnvironmentVariable("SITREP_CHANNELMAP_OUT");
        if (!string.IsNullOrEmpty(channelMapOut))
        {
            EmitChannelMap(channelMapOut!);
        }
    }

    /// <summary>
    /// Tokens that declare a property has no physical dimension AND is not a
    /// number you would ever scale, add or compare. They stay bare on the wire
    /// type: <c>Value</c> carries a magnitude, and a vessel name, a flag or a
    /// flightID has none. <see cref="Units.Count"/>, <see cref="Units.Ratio"/>,
    /// <see cref="Units.Percent"/> and <see cref="Units.Dimensionless"/> are
    /// deliberately NOT here: each is a real number with a real presentation
    /// rule (integral, x100 with a %, bare to two decimals), and that rule is
    /// exactly what the unit system exists to hold in one place.
    /// </summary>
    private static readonly HashSet<string> NonQuantityUnits = new HashSet<string>(StringComparer.Ordinal)
    {
        Units.Text,
        Units.Flag,
        Units.Enumeration,
        Units.Id,
        Units.NotApplicable,
    };

    /// <summary>
    /// Retypes each quantity-bearing property from a bare <c>number</c> to
    /// <c>Value&lt;"&lt;token&gt;"&gt;</c>, so the declared unit is carried by the
    /// generated TYPE rather than only by the <see cref="EmitUnitMap"/> lookup.
    ///
    /// <para>Reinforced.Typings has no notion of a generic type argument built
    /// from an attribute value, but <c>PropertyExportBuilder.Type(string)</c>
    /// takes a raw TS type name, and a raw name is all this needs. That string
    /// overload is the whole mechanism. (Do not go looking for a structured
    /// route: <c>RtRaw</c> does not exist in 1.6.7, <c>RtSimpleTypeName</c>'s
    /// generic-argument parameter is an array rather than <c>params</c>, and
    /// <c>Type()</c> has exactly three overloads (<c>string</c>,
    /// <c>&lt;T&gt;()</c>, <c>Type</c>), none of which accept an
    /// <c>RtTypeName</c>.)</para>
    ///
    /// <para>Two properties are skipped on purpose. A NON-NUMERIC property is
    /// skipped because a magnitude it does not have cannot be wrapped; a
    /// quantity token on one of those is a contract defect and throws rather
    /// than emitting something that would not compile. A <see cref="Vec3"/>-typed
    /// property is skipped because a vector of three same-unit components is a
    /// shape this design has not yet named. <see cref="EmitUnitMap"/> already
    /// propagates its unit onto the x/y/z leaves, so nothing regresses, but the
    /// leaves stay bare numbers until that shape exists.</para>
    /// </summary>
    private static void ApplyUnitValueTypes(ConfigurationBuilder builder, IEnumerable<Type> exportedTypes)
    {
        // contract.ts is one file, so the import has to be declared once
        // globally rather than per-type.
        builder.AddImport("{ Value }", "../value");

        var retyped = 0;
        var skippedVec3 = 0;
        foreach (var type in exportedTypes)
        {
            var targets = new List<KeyValuePair<PropertyInfo, string>>();
            foreach (var prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                var unit = prop.GetCustomAttribute<SitrepUnitAttribute>();
                if (unit == null || NonQuantityUnits.Contains(unit.Unit))
                {
                    continue;
                }

                // Vec3 is a class, so `Vec3?` is the same runtime type; one
                // comparison covers the required and the optional field alike.
                if (prop.PropertyType == typeof(Vec3))
                {
                    skippedVec3++;
                    continue;
                }

                var value = "Value<\"" + unit.Unit + "\">";
                string tsType;
                if (IsNumeric(prop.PropertyType))
                {
                    tsType = value;
                }
                else if (IsNumeric(NumericSequenceElement(prop.PropertyType)))
                {
                    // A sequence of same-unit readings (a terrain profile, a
                    // per-stage delta-v list). The unit belongs to each ELEMENT,
                    // so it lands inside the array rather than on it.
                    tsType = value + "[]";
                }
                else
                {
                    throw new InvalidOperationException(
                        "[SitrepUnit(\"" + unit.Unit + "\")] on " + type.Name + "." + prop.Name +
                        " declares a quantity, but the property is " + prop.PropertyType.Name +
                        ", which has no magnitude to carry. Use a non-quantity token (text/flag/enum/id/n/a) " +
                        "or make the property numeric.");
                }

                targets.Add(new KeyValuePair<PropertyInfo, string>(prop, tsType));
            }

            if (targets.Count == 0)
            {
                continue;
            }

            retyped += targets.Count;
            builder.ExportAsInterfaces(
                new[] { type },
                c =>
                {
                    foreach (var target in targets)
                    {
                        // One call per property: WithProperties applies ONE
                        // configuration to every property it is given, and each
                        // of these needs its own type argument.
                        c.WithProperties(new[] { target.Key }, p => p.Type(target.Value));
                    }
                });
        }

        Console.WriteLine(
            "codegen (unit types) -> " + retyped + " properties typed as Value<...>, " +
            skippedVec3 + " Vec3 properties left bare");
    }

    /// <summary>
    /// The element type of an array or generic collection, or <c>null</c> when
    /// the type is neither. <c>string</c> is deliberately not treated as a
    /// sequence despite implementing <c>IEnumerable&lt;char&gt;</c>.
    /// </summary>
    private static Type? NumericSequenceElement(Type type)
    {
        if (type == typeof(string))
        {
            return null;
        }

        if (type.IsArray)
        {
            return type.GetElementType();
        }

        if (type.IsGenericType)
        {
            var args = type.GetGenericArguments();
            if (args.Length == 1 && typeof(System.Collections.IEnumerable).IsAssignableFrom(type))
            {
                return args[0];
            }
        }

        return null;
    }

    /// <summary>
    /// True for a CLR numeric type, looking through <c>Nullable&lt;T&gt;</c> so
    /// an optional quantity counts. Null (no sequence element) is false. Enums are excluded despite their numeric
    /// underlying type: a closed set of named states is not a magnitude, and the
    /// contract declares those with <see cref="Units.Enumeration"/> anyway.
    /// </summary>
    private static bool IsNumeric(Type? type)
    {
        if (type == null)
        {
            return false;
        }

        var t = Nullable.GetUnderlyingType(type) ?? type;
        if (t.IsEnum)
        {
            return false;
        }

        switch (Type.GetTypeCode(t))
        {
            case TypeCode.Byte:
            case TypeCode.SByte:
            case TypeCode.Int16:
            case TypeCode.UInt16:
            case TypeCode.Int32:
            case TypeCode.UInt32:
            case TypeCode.Int64:
            case TypeCode.UInt64:
            case TypeCode.Single:
            case TypeCode.Double:
            case TypeCode.Decimal:
                return true;
            default:
                return false;
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

                var field = CamelCase(prop.Name);
                if (prop.PropertyType == typeof(Vec3))
                {
                    // A [SitrepUnit] on a Vec3-TYPED field states the unit of
                    // the WHOLE vector. There is ONE canonical Vec3 shape used
                    // at sites carrying three different units, so no unit can
                    // sit on the Vec3 type itself (its own X/Y/Z carry the
                    // NotApplicable placeholder). The wire carries three scalar
                    // leaves (field.x / field.y / field.z), so the composite
                    // field's unit propagates to each leaf: a consumer
                    // formatting a component then reads the same unit it would
                    // for a plain scalar. Leaf names come off the Vec3 shape
                    // itself, so they track a rename of X/Y/Z.
                    foreach (var leaf in Vec3LeafNames())
                    {
                        fields.Add(field + "." + leaf, unit.Unit);
                    }
                }
                else
                {
                    fields.Add(field, unit.Unit);
                }
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
                // A Vec3 field propagates onto dotted leaf keys (position.x),
                // which are not valid bare object keys in TypeScript; quote
                // anything that is not a plain identifier. Existing scalar keys
                // are all identifiers, so this leaves them untouched.
                var key = IsIdentifierKey(inner.Key) ? inner.Key : "\"" + inner.Key + "\"";
                sb.Append("    ").Append(key).Append(": \"").Append(inner.Value).Append("\",\n");
            }
            sb.Append("  },\n");
        }
    }

    /// <summary>
    /// True when <paramref name="key"/> is a plain JS/TS identifier and so can
    /// be an unquoted object key. A propagated Vec3 leaf (<c>position.x</c>)
    /// carries a dot and is not, so it gets quoted.
    /// </summary>
    private static bool IsIdentifierKey(string key)
    {
        if (key.Length == 0)
        {
            return false;
        }

        var first = key[0];
        if (!char.IsLetter(first) && first != '_' && first != '$')
        {
            return false;
        }

        for (var i = 1; i < key.Length; i++)
        {
            var c = key[i];
            if (!char.IsLetterOrDigit(c) && c != '_' && c != '$')
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// Writes the generated control-channel map
    /// (<c>GeneratedControlChannel</c> + <c>GENERATED_CONTROL_CHANNELS</c> +
    /// <c>GeneratedControlChannelId</c>) consumed by
    /// <c>mod/sitrep-sdk/src/control-channels.ts</c>. Each
    /// <see cref="SitrepControlChannelAttribute"/>-tagged READ property
    /// contributes one row: the owning type's <see cref="SitrepTopicAttribute"/>
    /// is the read topic (throws if the owning type has none, enforcing that the
    /// read half is a real Topic field), the camelCased property name is the read
    /// field, and the attribute carries the paired write command + its args type +
    /// the camelCased value field. Read and write stay TWO wire keys; the SDK
    /// wraps them into one handle.
    /// </summary>
    private static void EmitChannelMap(string outPath)
    {
        var rows = new List<(string Id, string ReadTopic, string ReadField, string WriteCommand, string ArgsType, string ValueField)>();
        foreach (var type in typeof(RtConfig).Assembly.GetTypes())
        {
            var topic = type.GetCustomAttribute<SitrepTopicAttribute>();
            foreach (var prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                var attr = prop.GetCustomAttribute<SitrepControlChannelAttribute>();
                if (attr == null)
                {
                    continue;
                }

                if (topic == null)
                {
                    throw new InvalidOperationException(
                        "[SitrepControlChannel] on " + type.Name + "." + prop.Name +
                        " requires its owning type to carry [SitrepTopic]: the read half must be a real Topic field.");
                }

                rows.Add((
                    attr.ChannelId,
                    topic.TopicId,
                    CamelCase(prop.Name),
                    attr.WriteCommand,
                    attr.Args.Name,
                    CamelCase(attr.ValueField)));
            }
        }

        rows.Sort((a, b) => string.CompareOrdinal(a.Id, b.Id));

        var sb = new StringBuilder();
        sb.Append("//     This code was generated by the Sitrep contract control-channel codegen\n");
        sb.Append("//     (Sitrep.Contract.RtConfig.EmitChannelMap, invoked from mod/codegen.sh).\n");
        sb.Append("//     Changes to this file may cause incorrect behavior and will be lost if\n");
        sb.Append("//     the code is regenerated.\n");
        sb.Append("//\n");
        sb.Append("// Derived by reflecting over every [SitrepControlChannel]-tagged read property\n");
        sb.Append("// in Sitrep.Contract: the property's owning [SitrepTopic] is the read topic, the\n");
        sb.Append("// camelCased property name is the read field, and the attribute carries the\n");
        sb.Append("// paired write command + its typed args + the camelCased value field. Read and\n");
        sb.Append("// write stay two wire keys; the SDK unifies them into one handle (see\n");
        sb.Append("// ../control-channels.ts).\n\n");

        sb.Append("export interface GeneratedControlChannel {\n");
        sb.Append("  readonly id: string;\n");
        sb.Append("  readonly readTopic: string;\n");
        sb.Append("  readonly readField: string;\n");
        sb.Append("  readonly writeCommand: string;\n");
        sb.Append("  readonly argsType: string;\n");
        sb.Append("  readonly valueField: string;\n");
        sb.Append("}\n\n");

        sb.Append("export const GENERATED_CONTROL_CHANNELS = [\n");
        foreach (var r in rows)
        {
            sb.Append("  { id: \"").Append(r.Id)
                .Append("\", readTopic: \"").Append(r.ReadTopic)
                .Append("\", readField: \"").Append(r.ReadField)
                .Append("\", writeCommand: \"").Append(r.WriteCommand)
                .Append("\", argsType: \"").Append(r.ArgsType)
                .Append("\", valueField: \"").Append(r.ValueField)
                .Append("\" },\n");
        }
        sb.Append("] as const satisfies readonly GeneratedControlChannel[];\n\n");

        sb.Append("export type GeneratedControlChannelId =\n");
        sb.Append("  (typeof GENERATED_CONTROL_CHANNELS)[number][\"id\"];\n");

        File.WriteAllText(outPath, sb.ToString());
        Console.WriteLine("codegen (control-channel-map) -> " + outPath);
    }

    /// <summary>
    /// The camelCased wire-leaf names of the canonical <see cref="Vec3"/> shape
    /// (<c>x</c>, <c>y</c>, <c>z</c>), read off the type itself rather than
    /// hard-coded so a rename of Vec3's components moves the propagated leaf
    /// keys with it. Order is irrelevant: <see cref="EmitUnitMap"/> writes into
    /// a sorted map.
    /// </summary>
    private static List<string> Vec3LeafNames()
    {
        var names = new List<string>();
        foreach (var prop in typeof(Vec3).GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            names.Add(CamelCase(prop.Name));
        }

        return names;
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
