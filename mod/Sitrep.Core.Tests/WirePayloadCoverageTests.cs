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
            // vessel.*: VesselViewProvider.ToWire(...) flattens each of these to
            // a Dictionary<string, object?> before Publish; JsonWriter only ever
            // sees the dictionary, never the POCO.
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
            // fleet.<guid>.delay: FleetVesselLinkBuilder.Build returns a
            // Dictionary<string, object?> and FleetDelayUplink.HandleOnCourier
            // publishes that, so JsonWriter only ever sees the flattened
            // dictionary; the POCO exists for the generated TS shape only.
            "FleetVesselLink",
            // currency.<guid>.science: CurrencyEventBuilder.BuildScienceCredit returns
            // a Dictionary<string, object?> and CurrencyEventUplink publishes that, so
            // JsonWriter only ever sees the flattened dictionary; the POCO exists for
            // the generated TS shape only.
            "ScienceCreditEvent",
            // career.status / career.mode: CareerViewProvider builds every one of
            // these as a Dictionary<string, object?> by hand (BuildEconomy/
            // BuildFacilities/BuildContracts/BuildStrategies/BuildTech, and
            // BuildCareerMode's local ToWire); the Sitrep.Contract POCOs exist only
            // for the generated TS shape and are never handed to AppendValue raw.
            "CareerMode", "CareerStatus", "CareerEconomy", "CareerFacility",
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
            // commandCentre.roster: the command-centre enumeration pass
            // hand-flattens each centre to a Dictionary; this POCO is TS-shape-only.
            "CommandCentreEntry",
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
            // BuildLab/BuildDeployed/BuildSensors/BuildExperimentBreakdown
            // hand-build Dictionary<string, object?> trees; these POCOs are
            // TS-shape-only.
            "ExperimentEntry", "InstrumentEntry", "LabEntry", "DeployedEntry",
            "SensorEntry", "ExperimentBreakdownEntry",
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
            "AddManeuverNodeArgs", "RemoveManeuverNodeArgs", "UpdateManeuverNodeArgs",
            "SetActionGroupArgs", "SetEnabledArgs",
            "SetPausedArgs", "SetSasModeArgs", "SetTargetArgs", "SetThrottleArgs",
            "SetWarpIndexArgs", "SetFlyByWireArgs", "SetControlAxesArgs",
            "ActivateStrategyArgs", "DeactivateStrategyArgs", "UnlockTechArgs",
            "ContractActionArgs", "UpgradeFacilityArgs", "RevertToEditorArgs",
            "SwitchVesselArgs", "LaunchArgs", "ServoSetTargetArgs", "ServoSetEnabledArgs",
            "RotorSetValueArgs", "RotorReverseArgs", "ExperimentActionArgs",
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
                // IsDefined checks only for THIS attribute: it does NOT construct
                // the sibling Reinforced.Typings [TsInterface]/[TsEnum] attributes
                // (whose assembly isn't loadable in this net10.0 test), unlike
                // GetCustomAttributesData().
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
                         nameof(CommsDelay),
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
        }
    }
}
