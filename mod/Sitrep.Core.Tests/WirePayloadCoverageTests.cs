using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// GENERAL guard against the "subscribed but no stream-data" bug class that
    /// has now bitten twice (kos.processors, then the comms.* trio): a payload
    /// type published to the wire as a RAW POCO with no
    /// <see cref="JsonWriter.AppendValue"/> case compiles fine but throws
    /// <c>NotSupportedException</c> at the wire boundary at runtime, and the
    /// frame is silently dropped, the client sees only "subscribed".
    ///
    /// <para>This enumerates every <see cref="SitrepContractAttribute"/>-marked
    /// concrete class in the contract assembly and asserts each serializes
    /// through the REAL stream-data wire path (<see cref="EnvelopeCodec.WriteStreamData"/>
    /// → <see cref="JsonWriter"/>) without hitting the switch's default-throw.
    /// A "forgot a JsonWriter case" is therefore a RED test, not a silent live
    /// frame-drop.</para>
    ///
    /// <para>Polarity: types are IN by default; the only exclusions are the
    /// explicitly documented <see cref="FlattenedByProducer"/> allowlist: types
    /// that are NEVER handed to <see cref="JsonWriter.AppendValue"/> as a raw
    /// POCO because their producer flattens them to a
    /// <c>Dictionary&lt;string, object?&gt;</c> first (VesselViewProvider.ToWire
    /// and friends), or they are envelope/meta types serialized field-by-field
    /// by <see cref="EnvelopeCodec"/> directly, or inbound command-arg types that
    /// are only ever DESERIALIZED. Any NEW raw-published payload type is caught
    /// automatically: it is not on the allowlist, so a missing case fails here.</para>
    /// </summary>
    public class WirePayloadCoverageTests
    {
        // Reflection can't distinguish "published raw" from "flattened by its
        // producer", that knowledge lives at the Publish/Record call sites. So
        // the flatten-by-producer / envelope / inbound-only types are listed
        // explicitly here. Removing a type from this set (or adding a new raw
        // payload type) makes the test require a JsonWriter case for it, which is
        // exactly the forcing function that catches the bug class. Grouped by why
        // each is excluded.
        private static readonly HashSet<string> FlattenedByProducer = new()
        {
            // Inbound only: comms.setSimulationDelayPolicy's arguments. A
            // command's args travel client-to-server inside the command
            // envelope, so JsonWriter never writes this type.
            "SetSimulationDelayPolicyArgs",
            // Inbound only, and emptier than that: the marker the five no-argument
            // core commands carry their [SitrepCommand] tags on. It has no
            // properties at all, so there is nothing for JsonWriter to write even
            // in the direction it never travels.
            "NoCommandArgs",
            // vessel.*: VesselViewProvider.ToWire(...) flattens each of these to
            // a Dictionary<string, object?> before Publish; JsonWriter only ever
            // sees the dictionary, never the POCO.
            // PropagationHorizon rides VesselOrbit.Horizon: ToWire(VesselOrbit)
            // maps it through its own ToWire(PropagationHorizon) overload, the
            // same as OrbitEncounter beside it, so JsonWriter only ever sees the
            // flattened dictionary.
            "PropagationHorizon",
            // TrajectoryArc rides VesselOrbit.Arc, and its three nested shapes
            // ride it in turn: ToWire(VesselOrbit) maps the whole tree through
            // its own overloads, so JsonWriter only ever sees dictionaries.
            "TrajectoryArc", "TrajectoryPoint", "TrajectoryFrameRef", "TrajectoryForceModel",
            "VesselIdentity", "VesselOrbit", "VesselOrbitTruth", "OrbitEncounter",
            "VesselFlight", "VesselAttitude", "VesselResources", "ResourceAmount",
            // ActionGroupState rides VesselControl.ActionGroups: ToWire(VesselControl)
            // maps each entry through its own ToWire(ActionGroupState) overload,
            // so JsonWriter only ever sees the flattened dictionary list.
            "VesselControl", "ActionGroupState", "VesselComms", "VesselCrew", "VesselManeuver",
            "VesselPropulsion", "VesselStructure", "VesselSurface", "VesselTarget",
            "VesselThermal", "ThermalHottestPart", "ManeuverNode", "OrbitPatch", "Vec3",
            "DockAlignment", "WarpState", "CrewMember", "VesselPhysicsMode",
            // ClosestApproach rides VesselTarget: VesselViewProvider.ToWire(VesselTarget)
            // flattens it into the target dictionary, so JsonWriter only ever
            // sees the flattened value, never this POCO.
            "ClosestApproach",
            // vessel.parts: VesselPartsViewProvider.ToWire flattens VesselParts/
            // VesselPart/PartBounds/PartResourceFlow/PartModuleState to
            // Dictionary<string, object?> before Publish; TS-shape-only, never
            // handed to AppendValue raw.
            "VesselParts", "VesselPart", "PartBounds", "PartResourceFlow", "PartModuleState",
            // vessel.partActions.<flightId>: PartActionsViewProvider.ToWire flattens
            // PartActions/PartActionEntry to Dictionary<string, object?> before
            // Publish (the producer also has to own the flatten to compute its own
            // change-gate signature, see PartActionsPublicationCache); JsonWriter
            // only ever sees the dictionary, never the POCO.
            "PartActions", "PartActionEntry",
            // fleet.<guid>.delay: FleetVesselLinkBuilder.Build returns a
            // Dictionary<string, object?> and FleetChannels.HandleOnCourier
            // publishes that, so JsonWriter only ever sees the flattened
            // dictionary; the POCO exists for the generated TS shape only.
            "FleetVesselLink",
            // fleet.<guid>.contact: FleetVesselContactBuilder.Build returns a
            // Dictionary<string, object?> and FleetChannels.HandleOnCourier
            // publishes that, so JsonWriter only ever sees the flattened dictionary;
            // the POCO exists for the generated TS shape only.
            "FleetVesselContact",
            // silence.<guid>.state: FleetVesselSilenceBuilder.Build returns a
            // Dictionary<string, object?> and FleetSilenceChannels.HandleSilenceOnCourier
            // publishes that, so JsonWriter only ever sees the flattened dictionary;
            // the POCO exists for the generated TS shape only.
            "FleetVesselSilence",
            // fleet.silence: FleetSilenceRosterBuilder builds the same flattened
            // dictionary per entry (reusing FleetVesselSilenceBuilder, so the
            // aggregate and the per-vessel topic cannot drift) and wraps them in
            // a { vessels: [...] } dictionary, exactly as BuildSystemVessels
            // does; both POCOs are TS-shape-only.
            "FleetSilence", "FleetSilenceEntry",
            // fleet.<guid>.resources: FleetVesselResourcesBuilder hand-builds
            // the same { resources: { name: {current,max,active} } } dictionary
            // tree KspHost already builds for vessel.resources; the POCO is a
            // TS-shape marker only.
            "FleetVesselResources",
            // currency.<guid>.science: CurrencyEventBuilder.BuildScienceCredit returns
            // a Dictionary<string, object?> and CurrencyEventUplink publishes that, so
            // JsonWriter only ever sees the flattened dictionary; the POCO exists for
            // the generated TS shape only.
            "ScienceCreditEvent", "ReputationLossEvent",
            // career.status / career.mode / career.facilities: CareerViewProvider
            // builds every one of these as a Dictionary<string, object?> by hand
            // (BuildEconomy/BuildFacilities/BuildContracts/BuildStrategies/
            // BuildTech, and BuildCareerMode's local ToWire); the Sitrep.Contract
            // POCOs exist only for the generated TS shape and are never handed to
            // AppendValue raw.
            "CareerMode", "CareerStatus", "CareerEconomy", "CareerUpkeep",
            "CareerFacilities", "CareerFacility",
            "CareerContracts", "CareerContract", "CareerContractParameter",
            "CareerStrategies", "CareerStrategy", "CareerTech", "CareerTechNode",
            // game.dlc / ksp.revertAvailability / system.bodies / system.vessels,
            // SystemViewProvider.BuildGameDlc/BuildRevertAvailability/
            // BuildSystemBodies/BuildSystemVessels all hand-build
            // Dictionary<string, object?> trees; these POCOs are TS-shape-only.
            "GameDlc", "RevertAvailability", "SystemBodies", "BodyEntry",
            "OrbitEntry", "AtmosphereEntry", "SystemVessels", "VesselRosterEntry",
            // target.available: TargetAvailableProvider hand-builds a
            // Dictionary<string, object?> ({ entries: [...] }) before Publish,
            // same as BuildSystemVessels; the POCOs are TS-shape markers only.
            "TargetAvailable", "TargetListEntry",
            // dv.*: StageDeltaVViewProvider.BuildStages/BuildSummary hand-build
            // Dictionary/List trees; these POCOs are TS-shape-only.
            "StageDeltaVEntry", "StageDeltaVSummary",
            // spaceCenter.*: SpaceCenterViewProvider.BuildLaunchSites/BuildScene/
            // BuildCrewRoster/BuildSavedShips/BuildPartsAvailable/BuildPois
            // hand-build Dictionary/List trees; these POCOs are TS-shape-only.
            "LaunchSiteEntry", "SpaceCenterScene",
            "CrewRosterEntry", "SavedShipEntry", "SpaceCenterPartsAvailable",
            "SpaceCenterPoiEntry",
            // spaceCenter.astronautComplex: SpaceCenterViewProvider.BuildAstronautComplex
            // hand-builds the { applicants: [...], activeCrew, crewCapacity,
            // nextHireCost } Dictionary/List tree (applicants reusing
            // CrewRosterEntry's shape); this POCO is TS-shape-only.
            "AstronautComplexInfo",
            // time.calendar: VesselViewProvider.ToWire(TimeCalendar) returns a
            // Dictionary<string, object?> and publishes that, so JsonWriter only
            // ever sees the flattened dictionary; the POCO is TS-shape-only.
            "TimeCalendar",
            // parts.power / parts.robotics / robotics.available:
            // PartsViewProvider.BuildPower/BuildRobotics/BuildRoboticsAvailable
            // hand-build Dictionary<string, object?> trees; these POCOs are
            // TS-shape-only.
            "SolarPanelEntry", "BatteryEntry", "FuelCellEntry", "AlternatorEntry",
            "PartsPower", "ServoEntry", "RoboticsAvailability",
            // science.*: ScienceViewProvider.BuildExperiments/BuildInstruments/
            // BuildLab/BuildDeployed/BuildSensors/BuildExperimentBreakdown/
            // BuildArchive hand-build Dictionary<string, object?> trees; these
            // POCOs are TS-shape-only.
            "ExperimentEntry", "InstrumentEntry", "LabEntry", "DeployedEntry",
            "SensorEntry", "ExperimentBreakdownEntry", "ArchiveEntry",
            // crash.lastCrash: Sitrep.Host.Crash.CrashPayload.Build hand-builds
            // the Dictionary<string, object?> tree the producer (Gonogo.KSP.
            // CrashUplink) publishes; these POCOs are TS-shape-only, never handed
            // to AppendValue raw.
            "CrashReport", "CrashPartLost", "CrashFlightStats",
            // recovery.lastSummary: Sitrep.Host.Recovery.RecoveryPayload.Build
            // hand-builds the Dictionary<string, object?> tree the producer
            // (Gonogo.KSP.RecoveryUplink) publishes; these POCOs are
            // TS-shape-only, never handed to AppendValue raw.
            "RecoveryReport", "RecoveryScienceEntry", "RecoveryPartEntry",
            "RecoveryResourceEntry", "RecoveryCrewEntry",
            // Envelope / meta: serialized field-by-field by EnvelopeCodec itself
            // (WriteStreamData / WriteMeta), never through AppendValue as a POCO.
            "Meta", "PayloadMeta", "ErrorMsg", "EventMsg", "Subscribe", "Unsubscribe", "SetVantage",
            // Inbound command-arg types: only ever DESERIALIZED (client → server);
            // never serialized outbound as a raw POCO.
            // vessel.trajectory.forVantage: the request is inbound-only, and the
            // reply goes out as a flattened dictionary like every other command
            // result, with the POCO existing so a client has a type to read it as.
            "VantagePlanRequest", "VantagePlanReply",
            "AddManeuverNodeArgs", "RemoveManeuverNodeArgs", "UpdateManeuverNodeArgs",
            // vessel.repair's args are inbound-only. RepairOutcome is NOT here:
            // it used to be, on the claim that the outcome "rides out inside
            // CommandResult<T>'s flattened reply", and that claim was false.
            // CommandResult<T>.Payload is written by AppendCommandResult back
            // through AppendValue, so the raw POCO reaches the payload switch
            // exactly like a channel value does.
            "RepairPartArgs",
            "SetActionGroupArgs", "SetEnabledArgs",
            "SetPausedArgs", "SetSasModeArgs", "SetTargetArgs", "SetThrottleArgs",
            "SetControlFrameArgs", "SendManeuverPlanArgs", "ComposedBurn",
            "SetWarpIndexArgs", "SetFlyByWireArgs", "SetControlAxesArgs",
            "ActivateStrategyArgs", "DeactivateStrategyArgs", "UnlockTechArgs",
            "ContractActionArgs", "UpgradeFacilityArgs", "HireApplicantArgs", "FireCrewArgs", "RevertToEditorArgs",
            "SwitchVesselArgs", "LaunchArgs", "ServoSetTargetArgs", "ServoSetEnabledArgs",
            "RotorSetValueArgs", "RotorReverseArgs", "ExperimentActionArgs",
            "InvokePartActionArgs",
            // The eleven kOS payload/command-arg types (kos.processors'
            // KosProcessorInfo, the dynamic-channel KosTerminalFrame/KosRunResult/
            // KosComputeStatus, and the seven command args KosExecArgs/
            // KosReEnableArgs/KosRunArgs/KosTerminalOpenArgs/KosKeystrokeArgs/
            // KosTerminalResizeArgs/KosTerminalCloseArgs) relocated out of
            // Sitrep.Contract into GonogoKosUplink.Contract (uplink-types-out-of-core
            // plan, sixth and last relocation): no longer reflected by this assembly
            // at all, so no allowlist entries are needed here any more. (For the
            // record, since this slice held the plan's only types the allowlist had
            // split across THREE reasons: the three outbound ones were
            // self-flattened producer-side by Gonogo.KosUplink's Kos*Builder.Build
            // at the publish boundary, KosComputeStatus was flattened by its
            // provider, and the seven args were inbound-only. JsonWriter never saw
            // any of the eleven raw.)
            // mechjeb.* command args relocated out of Sitrep.Contract into
            // GonogoMechJebUplink.Contract (uplink-types-out-of-core pilot):
            // no longer reflected by this assembly at all, so no allowlist
            // entry is needed here any more.
            // kerbcast.cameras (KerbcastCameraEntry) + kerbcast.setFieldOfView/
            // kerbcast.setPan command args (KerbcastSetFieldOfViewArgs/
            // KerbcastSetPanArgs) relocated out of Sitrep.Contract into
            // GonogoKerbcastUplink.Contract (uplink-types-out-of-core plan,
            // third relocation): no longer reflected by this assembly at all,
            // so no allowlist entry is needed here any more. (For the record:
            // KerbcastCameraEntryBuilder.Build returns a Dictionary<string,
            // object?> and KerbcastUplink publishes that list directly, so
            // JsonWriter never saw KerbcastCameraEntry raw even while it lived
            // here; the two Args types were always inbound-only.)
            // The five SCANsat payload types (scansat.scanningVessels'
            // ScanningVesselEntry + its nested ScanSensorEntry/ScanTrackColor,
            // scansat.science's ScanScienceEntry, and the dynamic
            // scansat.anomalies.<body> element ScanAnomalyEntry) relocated out
            // of Sitrep.Contract into GonogoScansatUplink.Contract
            // (uplink-types-out-of-core plan, fourth relocation): no longer
            // reflected by this assembly at all, so no allowlist entries are
            // needed here any more. (For the record: every one of the five was
            // already TS-shape-only while it lived here.
            // Gonogo.ScansatUplink's ScanningVessels.Build/ScanScience.Build/
            // ScanAnomalies.Build each hand-build a Dictionary<string, object?>
            // tree, deliberately SCANsat/KSP-type-free, and the uplink
            // publishes those; JsonWriter never saw any of the POCOs raw.)
            // system.uplink.pending: PendingUplink is only ever nested inside
            // PendingUplinkQueue.Pending, flattened element-by-element by
            // AppendPendingUplinkQueue's own loop (AppendPendingUplink); it is
            // never handed to AppendValue on its own. PendingUplinkQueue itself
            // is NOT allowlisted, it IS published raw (ChannelEngine's
            // UplinkPendingTopic channel-source mapper) and has its own
            // JsonWriter case, exercised by this test.
            "PendingUplink",
            // avionics.status: AvionicsStatus relocated out of Sitrep.Contract into
            // GonogoAvionicsUplink.Contract (uplink-types-out-of-core plan): no
            // longer reflected by this assembly at all, so no allowlist entry is
            // needed here any more. (For the record: GonogoAvionicsUplink.AvionicsCapture.Build
            // returns a Dictionary<string, object?> and AvionicsUplink publishes that,
            // so JsonWriter never saw this POCO raw even while it lived here.)
            // The fifteen kerbalism payload types (the five [SitrepTopic] roots
            // KerbalismSpaceWeather/KerbalismProfile/KerbalismLifeSupport/
            // KerbalismCrewEntry/KerbalismFeatures plus the ten nested shapes
            // KerbalismStarInfo/KerbalismStormEntry/KerbalismResource/
            // KerbalismHabitat/KerbalismProcessEntry/KerbalismGreenhouseEntry/
            // KerbalismCrewRule/KerbalismResourceDef/KerbalismRuleDef/
            // KerbalismProcessDef) relocated out of Sitrep.Contract into
            // GonogoKerbalismUplink.Contract (uplink-types-out-of-core plan, fifth
            // relocation): no longer reflected by this assembly at all, so no
            // allowlist entries are needed here any more. (For the record: every one
            // of the fifteen was already TS-shape-only while it lived here.
            // GonogoKerbalismUplink.KerbalismCapture's BuildSpaceWeather/
            // BuildLifeSupport/BuildCrew/BuildFeatures/BuildProfile each return a
            // nested Dictionary<string, object?> / List<object> tree, and
            // KerbalismUplink publishes those dictionaries, so JsonWriter never saw
            // any of the POCOs raw. KerbalismGreenhouseEntry did not even have a
            // producer: it is a forward-looking wire shape with no BuildGreenhouse to
            // match its siblings.)
            // vessel.landing: VesselViewProvider.ToWire(VesselLanding) flattens it to
            // a Dictionary<string, object?> before Publish, same as every other
            // vessel.* POCO above; JsonWriter only ever sees the dictionary.
            "VesselLanding",
            // vessel.parts action bindings: VesselPartsViewProvider.ToWire(ActionBinding)
            // flattens each binding to a Dictionary<string, object?> nested in the
            // part's "actionBindings" list, same pattern as VesselPart/PartBounds
            // above; the POCO is TS-shape-only.
            "ActionBinding",
        };

        private static IEnumerable<Type> ContractPayloadTypes() =>
            typeof(CommsDelay).Assembly.GetTypes()
                .Where(t => t.IsClass && !t.IsAbstract && !t.IsGenericTypeDefinition)
                // [SitrepContract] is the contract's own marker, applied alongside
                // every codegen attribute. It used to matter that IsDefined does
                // not construct the sibling Reinforced.Typings attributes, whose
                // assembly was unloadable here; those attributes no longer ship at
                // all (see Sitrep.Contract.Codegen), so this is now just the
                // straightforward way to ask.
                .Where(t => t.IsDefined(typeof(SitrepContractAttribute), false))
                .Where(t => t.GetConstructor(Type.EmptyTypes) != null);

        private static void SerializeThroughWire(object payload)
        {
            var msg = new StreamData<object?>
            {
                Type = "stream-data",
                Topic = "coverage",
                Payload = payload,
                Meta = new Meta
                {
                    Source = "s", ValidAt = 0, Seq = 1, DeliveredAt = 0, Vantage = "v",
                    Quality = Quality.OnRails, Active = true, Staleness = Staleness.Fresh,
                    TimelineEpoch = 0,
                },
            };
            EnvelopeCodec.WriteStreamData(msg);
        }

        /// <summary>
        /// The payload-type discovery reaches the contract, so a clean sweep means
        /// something.
        ///
        /// <para><see cref="EveryRawPublishedContractTypeHasAJsonWriterCase"/> reports
        /// nothing missing over an empty type list, which is the same answer it gives
        /// for a fully covered one. <c>CommsPayloadsAreCovered_NotAllowlisted</c> is a
        /// real control for the seven comms types and leaves the rest of the ~200-type
        /// surface, and the <c>FlattenedByProducer</c> allowlist that forces a decision
        /// on each NEW type, resting on this discovery holding.</para>
        /// </summary>
        [Fact]
        public void DiscoveryReachesTheContractPayloadTypes()
        {
            var found = ContractPayloadTypes().Select(t => t.Name).ToList();
            Assert.True(
                found.Count >= 100,
                "Contract payload discovery collapsed to " + found.Count
                    + " types, so the wire sweep is covering almost nothing. Found: "
                    + string.Join(", ", found.OrderBy(x => x)));
        }

        [Fact]
        public void EveryRawPublishedContractTypeHasAJsonWriterCase()
        {
            var missing = new List<string>();
            foreach (var t in ContractPayloadTypes())
            {
                if (FlattenedByProducer.Contains(t.Name))
                {
                    continue;
                }

                var inst = Activator.CreateInstance(t)!;
                try
                {
                    SerializeThroughWire(inst);
                }
                catch (NotSupportedException)
                {
                    missing.Add(t.Name);
                }
            }

            Assert.True(
                missing.Count == 0,
                "These [SitrepContract] payload types have no JsonWriter case and would be silently dropped at the wire boundary if published raw. Add an AppendValue case + Append<Type> helper (mirror AppendCommsDelay), or (if the type is flattened by its producer / envelope-serialized / inbound-only) add it to FlattenedByProducer with a reason: "
                    + string.Join(", ", missing));
        }

        /// <summary>
        /// The two types the 2026-09-05 incident concerned, in the shapes their
        /// producers actually publish rather than as bare default instances.
        ///
        /// <para>Both had been ALLOWLISTED above on a claim that turned out to be
        /// false: the roster's entry was recorded as hand-flattened by its
        /// producer (it is not, <c>CommandCentreDelayUplink.ToRosterEntry</c>
        /// builds the POCO and the publisher hands the list straight over) and the
        /// repair outcome as riding out inside a flattened reply (it does not,
        /// <c>CommandResult&lt;T&gt;.Payload</c> goes back through
        /// <see cref="JsonWriter.AppendValue"/>). An allowlist entry is a human
        /// claim, and the sweep above cannot grade one; these two are asserted
        /// NOT allowlisted so the claim cannot come back.</para>
        ///
        /// <para>The roster is exercised POPULATED, which is the whole reason this
        /// shipped: an empty <c>List&lt;CommandCentreEntry&gt;</c> serializes to
        /// <c>[]</c> without the element type ever reaching the payload switch, so
        /// every headless rig and every save without real command centres in it
        /// read healthy.</para>
        /// </summary>
        [Fact]
        public void CommandCentreRosterAndRepairOutcomeAreCovered_NotAllowlisted()
        {
            foreach (var name in new[] { nameof(CommandCentreEntry), nameof(RepairOutcome) })
            {
                Assert.False(FlattenedByProducer.Contains(name),
                    $"{name} must NOT be allowlisted, it reaches JsonWriter.AppendValue as a raw POCO.");
            }

            SerializeThroughWire(new List<CommandCentreEntry>
            {
                new CommandCentreEntry
                {
                    Id = "ksc",
                    DisplayName = "Kerbal Space Center",
                    Kind = "GroundStation",
                    BodyIndex = 1,
                    Latitude = -0.0972,
                    Longitude = -74.5577,
                    Active = true,
                    DelayQuality = "routed",
                },
            });

            SerializeThroughWire(
                RepairRefusal.ResultFor(new RepairOutcome { Repaired = true, KitsUsed = 1, KitsFrom = "carried" }));
            SerializeThroughWire(
                RepairRefusal.ResultFor(new RepairOutcome { Repaired = false, Refusal = RepairRefusal.NoKits }));
        }

        [Fact]
        public void CommsPayloadsAreCovered_NotAllowlisted()
        {
            // The exact types the comms.* bug concerned, asserted covered AND
            // asserted NOT hidden behind the allowlist, so this test genuinely
            // exercises them (it would have gone RED before their JsonWriter
            // cases existed). KosProcessorInfo used to sit in this same list,
            // then moved to the allowlist at the kos migration (2026-07-18) once
            // it began self-flattening producer-side, and has now left this
            // assembly altogether for GonogoKosUplink.Contract. Either way it
            // does not belong in a "must NOT be allowlisted" assertion; the
            // relocation note in FlattenedByProducer above records where it
            // went. Its own Uplink's tests own its coverage now.
            foreach (var name in new[]
                     {
                         nameof(CommsConnectivity), nameof(CommsSignalStrength),
                         nameof(CommsControlState), nameof(CommsPath), nameof(CommsNetwork),
                         nameof(CommsDelay), nameof(CommsOcclusion),
                     })
            {
                Assert.False(FlattenedByProducer.Contains(name),
                    $"{name} must NOT be allowlisted, it is published raw and must have a JsonWriter case exercised by the coverage test.");
            }

            // And they serialize without throwing.
            SerializeThroughWire(new CommsConnectivity());
            SerializeThroughWire(new CommsSignalStrength());
            SerializeThroughWire(new CommsControlState());
            SerializeThroughWire(new CommsPath());
            SerializeThroughWire(new CommsNetwork());
            SerializeThroughWire(new CommsDelay());
            SerializeThroughWire(new CommsOcclusion
            {
                ModelId = "commnet-scaled-radius",
                ModelName = "Stock CommNet (occlusion multipliers)",
                Bodies = new List<CommsOcclusionBody>
                {
                    // A populated body, not just the empty default: the nested
                    // list is where a missing writer helper would actually bite.
                    new CommsOcclusionBody
                    {
                        Index = 1,
                        Name = "Kerbin",
                        RadiusMeters = 600_000,
                        HasAtmosphere = true,
                        OccludingRadiusMeters = 450_000,
                    },
                },
            });
        }
    }
}
