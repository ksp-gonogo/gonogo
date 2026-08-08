#if NETSTANDARD2_0
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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
        builder.ExportAsInterface<SetVantage>().AutoI(false).WithPublicProperties().OverrideName("SetVantage");

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
                typeof(TimeCalendar),
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
                // fleet.<guid>.* per-vessel dynamic channels (Plan 2c): the
                // display-only delay/connectivity carried on fleet.<guid>.delay
                // (fleet.<guid>.orbit reuses VesselOrbit, already listed above).
                typeof(FleetVesselLink),
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
                // commandCentre.roster: the vantage/authority union (Plan 3)
                typeof(CommandCentreEntry),
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
                // kerbalism.profile: the loaded profile's own definitions, so the
                // app derives the resource graph without gonogo naming a resource.
                typeof(KerbalismResourceDef),
                typeof(KerbalismRuleDef),
                typeof(KerbalismProcessDef),
                typeof(KerbalismProfile),
                // reliability.* capability channels (Domain-neutral; see Reliability.cs)
                typeof(ReliabilitySummary),
                typeof(ReliabilityPartEntry),
                // avionics.status, RP-1 controllable-mass ascent go/no-go
                typeof(AvionicsStatus),
                // mechjeb.engageAscentAutopilot / mechjeb.executeNextNode /
                // mechjeb.landAtTarget command args
                typeof(MechJebAscentArgs),
                typeof(MechJebNoArgs),
            };
        builder.ExportAsInterfaces(wirePayloadTypes, c => c.AutoI(false).WithPublicProperties());

        // --- Declared units become TYPES, not just a lookup ---
        // Retypes every quantity-bearing property to Value<"<token>"> so the unit
        // travels in the type system rather than in a map a caller has to
        // remember to consult. Runs last: it configures properties on blueprints
        // the registrations above already created.
        //
        // The ENVELOPE is deliberately absent from this list, and it was
        // deliberately present once.
        //
        // `generated.test.ts` walks the whole field->unit map against the
        // emitted source, so when Meta.validAt/deliveredAt turned up untyped it
        // looked like a bug and the envelope types were added to close it.
        // Migrating the readers showed that was backwards. Those timestamps are
        // never RENDERED: ten transport and timeline files use them for
        // ordering, staleness and heartbeats, and not one readout shows them.
        //
        // So wrapping them buys nothing and costs twice. It puts a Value in the
        // way of arithmetic in code that is transport rather than telemetry,
        // and Meta rides on EVERY stream-data message, so it allocates two
        // objects per message on the hottest path in the app for a quantity
        // nobody looks at.
        //
        // The declaration stays on the C# property, because the field IS in
        // seconds and the coverage gate is right to want it said. What changes
        // is that the declaration stops becoming a type. The exhaustive test
        // carries the matching exemption, with this reasoning.
        ApplyUnitValueTypes(builder, wirePayloadTypes);

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
            // SITREP_UNITJSON_OUT is the same reflection pass's second output:
            // the SAME data with no TypeScript around it. Everything the unit
            // system knows is otherwise a TypeScript artifact, and none of it
            // survives the wire, so a consumer in any other language receives
            // {"heatShieldFlux": 3400.0} with no way to learn it is kilowatts.
            // The JSON is what a generator in another language reads, what a
            // test can assert the contract against without importing the SDK,
            // and what the mod serves beside the telemetry socket.
            EmitUnitMap(unitMapOut!, Environment.GetEnvironmentVariable("SITREP_UNITJSON_OUT"));
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
    /// <para>Three shapes, one rule. A scalar becomes <c>Value&lt;U&gt;</c>. A
    /// SEQUENCE of same-unit readings takes the unit inside the array, since a
    /// terrain profile is a list of distances rather than one distance. A
    /// <see cref="Vec3"/> becomes <c>Vec3Of&lt;U&gt;</c>, carrying the unit down
    /// to its x/y/z leaves: the unit is declared per USE SITE because one
    /// canonical Vec3 shape is reused at sites carrying three different units,
    /// which is the same reason <see cref="EmitUnitMap"/> propagates onto dotted
    /// leaf keys.</para>
    ///
    /// <para>A NON-NUMERIC property is the one thing that cannot be handled: a
    /// magnitude it does not have cannot be wrapped, so a quantity token on one
    /// is a contract defect and throws rather than emitting something that would
    /// not compile.</para>
    /// </summary>
    /// <param name="valueImportFrom">
    /// Where the emitted file should import <c>Value</c>/<c>Vec3Of</c> from.
    /// Defaults to the first party's own layout. An UPLINK passes the path
    /// that reaches the SDK from ITS generated file, which is the only thing
    /// about this pass that was ever first-party-specific.
    /// </param>
    /// <remarks>
    /// <para><b>Public, and reusable against any assembly's types.</b>
    /// Declaring a unit was always symmetric (<see cref="SitrepUnitAttribute"/>
    /// takes an arbitrary string), but GENERATING from the declaration was
    /// not, so an Uplink author hand-wrote the <c>Value&lt;&gt;</c> types the
    /// first party generates. That is the drift generation exists to prevent.
    /// This pass never cared which assembly the types came from, it takes them
    /// as an argument; it was simply private. An Uplink's own
    /// <c>Configure</c> calls this with its own exported types and gets the
    /// same retyping, and <see cref="UnitDescriptor.ToJson(Assembly)"/> gives
    /// it the matching descriptor.</para>
    /// </remarks>
    public static void ApplyUnitValueTypes(
        ConfigurationBuilder builder,
        IEnumerable<Type> exportedTypes,
        string valueImportFrom = "../value")
    {
        // One emitted file, so the import is declared once globally rather
        // than per-type.
        builder.AddImport("{ Value, Vec3Of }", valueImportFrom);

        var retyped = 0;
        var vectors = 0;
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

                // A COMMAND ARGS type is a wire-WRITE, and the wrap is
                // inbound only. A widget builds these and they go straight to
                // JSON.stringify, so a Value would serialise as
                // {"magnitude":80,"unit":"count"} and the mod's deserialiser
                // would reject it. There is no unwrap step on the way out, and
                // adding one would put a conversion between a slider and the
                // command it fires for no reading anyone takes.
                //
                // Same rule as the envelope, from the same direction: the unit
                // system describes what the client RECEIVES.
                if (type.Name.EndsWith("Args", StringComparison.Ordinal))
                {
                    continue;
                }

                var value = "Value<\"" + unit.Unit + "\">";
                string tsType;
                // Vec3 is a class, so `Vec3?` is the same runtime type; one
                // comparison covers the required and the optional field alike.
                if (prop.PropertyType == typeof(Vec3))
                {
                    // The unit sits on the WHOLE vector, because one canonical
                    // Vec3 shape is reused at sites carrying three different
                    // units (its own X/Y/Z are annotated NotApplicable for
                    // exactly that reason). Vec3Of<U> carries the per-use-site
                    // unit down to the leaves, which is the same propagation
                    // EmitUnitMap does below, expressed as a type.
                    vectors++;
                    tsType = "Vec3Of<\"" + unit.Unit + "\">";
                }
                else if (IsNumeric(prop.PropertyType))
                {
                    tsType = value;
                }
                else if (IsNumeric(UnitDescriptor.NumericSequenceElement(prop.PropertyType)))
                {
                    // A sequence of same-unit readings (a terrain profile, a
                    // per-stage delta-v list). The unit belongs to each ELEMENT,
                    // so it lands inside the array rather than on it.
                    tsType = value + "[]";
                }
                else if (IsNumeric(UnitDescriptor.DictionaryValueType(prop.PropertyType)))
                {
                    // A name-keyed map of same-unit readings (a rate per resource
                    // name). Same rule as the sequence above: the unit belongs to
                    // each VALUE, so it lands inside the map rather than on it,
                    // and the key is just a name.
                    //
                    // Every name-keyed channel before this one had a POCO value
                    // (vessel.resources -> ResourceAmount, career.facilities ->
                    // CareerFacility) whose own properties carried the units, so
                    // a map of BARE scalars had never come up and this branch did
                    // not exist. Its absence was a gap, not a decision: without it
                    // the only ways to declare such a map were a wrapper object
                    // per entry, or a bare `number` the client has to guess at.
                    tsType = "{ [key: string]: " + value + " }";
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
            "codegen (unit types) -> " + retyped + " properties carry their unit (" +
            vectors + " as Vec3Of<...>)");
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
    private static void EmitUnitMap(string outPath, string jsonOutPath = null)
    {
        // Collected by UnitDescriptor, not here: the mod serves this same
        // document at runtime and two reflection passes over one assembly is
        // two things to keep in step. `validateVocabulary: true` because
        // everything reflected at CODEGEN time is compiled into this
        // assembly, so a token outside the catalog is drift and should stop
        // the build. The runtime pass deliberately does not throw.
        var maps = UnitDescriptor.Collect(validateVocabulary: true);
        var vocabulary = maps.Vocabulary;
        var byType = maps.ByType;
        var byTopic = maps.ByTopic;
        var shapesByType = maps.ShapesByType;
        var shapesByTopic = maps.ShapesByTopic;

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
        sb.Append("};\n\n");

        sb.Append("/** The nested payload shape each complex field holds, by its interface name. */\n");
        sb.Append("export type ShapesByField = Readonly<Record<string, string>>;\n\n");

        sb.Append("/**\n");
        sb.Append(" * Which fields hold ANOTHER payload shape, and which one.\n");
        sb.Append(" *\n");
        sb.Append(" * The unit maps above are flat: they describe one shape's own fields and\n");
        sb.Append(" * stop there. That was enough while a unit was only ever looked up, and\n");
        sb.Append(" * wrong once the runtime started WRAPPING decoded payloads, because a\n");
        sb.Append(" * nested shape's declared units were unreachable from the parent's entry.\n");
        sb.Append(" * `vessel.target.orbit.sma` is the plain case: the contract types it as\n");
        sb.Append(" * Value<\"m\">, and without this it arrived as a bare number.\n");
        sb.Append(" *\n");
        sb.Append(" * A field holding a LIST of a shape is recorded the same way; the element\n");
        sb.Append(" * is what a consumer indexes into, which is the same convention the topic\n");
        sb.Append(" * unit map already follows for an array Topic.\n");
        sb.Append(" */\n");
        sb.Append("export const GENERATED_TYPE_SHAPES: Readonly<Record<string, ShapesByField>> = {\n");
        AppendMapBody(sb, shapesByType);
        sb.Append("};\n\n");

        sb.Append("/** The same, keyed by Topic id. */\n");
        sb.Append("export const GENERATED_TOPIC_SHAPES: Readonly<Record<string, ShapesByField>> = {\n");
        AppendMapBody(sb, shapesByTopic);
        sb.Append("};\n");

        File.WriteAllText(outPath, sb.ToString());
        Console.WriteLine("codegen (unit-map) -> " + outPath);

        if (!string.IsNullOrEmpty(jsonOutPath))
        {
            File.WriteAllText(jsonOutPath, UnitDescriptor.ToJson(maps));
            Console.WriteLine("codegen (unit-descriptor) -> " + jsonOutPath);
        }
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
                    UnitDescriptor.CamelCase(prop.Name),
                    attr.WriteCommand,
                    attr.Args.Name,
                    UnitDescriptor.CamelCase(attr.ValueField)));
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

}
#endif
