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
    /// frame is silently dropped — the client sees only "subscribed".
    ///
    /// <para>This enumerates every <see cref="SitrepContractAttribute"/>-marked
    /// concrete class in the contract assembly and asserts each serializes
    /// through the REAL stream-data wire path (<see cref="EnvelopeCodec.WriteStreamData"/>
    /// → <see cref="JsonWriter"/>) without hitting the switch's default-throw.
    /// A "forgot a JsonWriter case" is therefore a RED test, not a silent live
    /// frame-drop.</para>
    ///
    /// <para>Polarity: types are IN by default; the only exclusions are the
    /// explicitly documented <see cref="FlattenedByProducer"/> allowlist — types
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
        // producer" — that knowledge lives at the Publish/Record call sites. So
        // the flatten-by-producer / envelope / inbound-only types are listed
        // explicitly here. Removing a type from this set (or adding a new raw
        // payload type) makes the test require a JsonWriter case for it, which is
        // exactly the forcing function that catches the bug class. Grouped by why
        // each is excluded.
        private static readonly HashSet<string> FlattenedByProducer = new()
        {
            // vessel.* — VesselViewProvider.ToWire(...) flattens each of these to
            // a Dictionary<string, object?> before Publish; JsonWriter only ever
            // sees the dictionary, never the POCO.
            "VesselIdentity", "VesselOrbit", "VesselOrbitTruth", "OrbitEncounter",
            "VesselFlight", "VesselAttitude", "VesselResources", "ResourceAmount",
            // ActionGroupState rides VesselControl.ActionGroups — ToWire(VesselControl)
            // maps each entry through its own ToWire(ActionGroupState) overload,
            // so JsonWriter only ever sees the flattened dictionary list.
            "VesselControl", "ActionGroupState", "VesselComms", "VesselCrew", "VesselManeuver",
            "VesselPropulsion", "VesselStructure", "VesselSurface", "VesselTarget",
            "VesselThermal", "ThermalHottestPart", "ManeuverNode", "OrbitPatch", "Vec3",
            "DockAlignment", "WarpState", "CrewMember", "VesselPhysicsMode",
            // vessel.parts — VesselPartsViewProvider.ToWire flattens VesselParts/
            // VesselPart/PartBounds/PartResourceFlow/PartModuleState to
            // Dictionary<string, object?> before Publish; TS-shape-only, never
            // handed to AppendValue raw.
            "VesselParts", "VesselPart", "PartBounds", "PartResourceFlow", "PartModuleState",
            // kOS status — flattened by its provider before publish.
            "KosComputeStatus",
            // kos.processors / kos.terminal.<coreId> / kos.run.<coreId> —
            // Gonogo.KosUplink.Kos*Builder.Build() returns a
            // Dictionary<string, object?> and the actual publish call sites
            // (KosExtension.HandleProcessors, KosExtension.Ksp.cs's terminal
            // and run publish delegates) flatten through it before reaching
            // the Courier, so JsonWriter only ever sees the flattened
            // dictionary; the POCOs exist for the generated TS shape only.
            "KosProcessorInfo", "KosTerminalFrame", "KosRunResult",
            // kerbcast.cameras — KerbcastCameraEntryBuilder.Build returns a
            // Dictionary<string, object?> and KerbcastUplink publishes that list
            // directly, so JsonWriter only ever sees the flattened dictionary;
            // the POCO exists for the generated TS shape only.
            "KerbcastCameraEntry",
            // career.status / career.mode — CareerViewProvider builds every one of
            // these as a Dictionary<string, object?> by hand (BuildEconomy/
            // BuildFacilities/BuildContracts/BuildStrategies/BuildTech, and
            // BuildCareerMode's local ToWire); the Sitrep.Contract POCOs exist only
            // for the generated TS shape and are never handed to AppendValue raw.
            "CareerMode", "CareerStatus", "CareerEconomy", "CareerFacility",
            "CareerContracts", "CareerContract", "CareerContractParameter",
            "CareerStrategies", "CareerStrategy", "CareerTech", "CareerTechNode",
            // game.dlc / ksp.revertAvailability / system.bodies / system.vessels —
            // SystemViewProvider.BuildGameDlc/BuildRevertAvailability/
            // BuildSystemBodies/BuildSystemVessels all hand-build
            // Dictionary<string, object?> trees; these POCOs are TS-shape-only.
            "GameDlc", "RevertAvailability", "SystemBodies", "BodyEntry",
            "OrbitEntry", "AtmosphereEntry", "SystemVessels", "VesselRosterEntry",
            // dv.* — StageDeltaVViewProvider.BuildStages/BuildSummary hand-build
            // Dictionary/List trees; these POCOs are TS-shape-only.
            "StageDeltaVEntry", "StageDeltaVSummary",
            // spaceCenter.* — SpaceCenterViewProvider.BuildLaunchSites/BuildScene/
            // BuildCrewRoster/BuildSavedShips/BuildPartsAvailable/BuildPois
            // hand-build Dictionary/List trees; these POCOs are TS-shape-only.
            "LaunchSiteEntry", "SpaceCenterScene",
            "CrewRosterEntry", "SavedShipEntry", "SpaceCenterPartsAvailable",
            "SpaceCenterPoiEntry",
            // parts.power / parts.robotics / robotics.available —
            // PartsViewProvider.BuildPower/BuildRobotics/BuildRoboticsAvailable
            // hand-build Dictionary<string, object?> trees; these POCOs are
            // TS-shape-only.
            "SolarPanelEntry", "BatteryEntry", "FuelCellEntry", "AlternatorEntry",
            "PartsPower", "ServoEntry", "RoboticsAvailability",
            // science.* — ScienceViewProvider.BuildExperiments/BuildInstruments/
            // BuildLab/BuildDeployed/BuildSensors/BuildExperimentBreakdown
            // hand-build Dictionary<string, object?> trees; these POCOs are
            // TS-shape-only.
            "ExperimentEntry", "InstrumentEntry", "LabEntry", "DeployedEntry",
            "SensorEntry", "ExperimentBreakdownEntry",
            // scansat.scanningVessels — Gonogo.ScansatUplink.ScanningVessels.Build is
            // deliberately SCANsat/KSP-type-free and hand-builds
            // Dictionary<string, object?> trees; these POCOs are TS-shape-only.
            "ScanSensorEntry", "ScanTrackColor", "ScanningVesselEntry",
            // scansat.science — Gonogo.ScansatUplink.ScanScience.Build hand-builds
            // the Dictionary<string, object?> tree the uplink publishes; this POCO
            // is TS-shape-only, never handed to AppendValue raw.
            "ScanScienceEntry",
            // scansat.anomalies.<body> — Gonogo.ScansatUplink.ScanAnomalies.Build
            // hand-builds the Dictionary<string, object?> tree the uplink
            // publishes (via ScanPublications.Compute); this POCO is
            // TS-shape-only (dynamic-namespace element documentation, no
            // [SitrepTopic] root), never handed to AppendValue raw.
            "ScanAnomalyEntry",
            // crash.lastCrash — Sitrep.Host.Crash.CrashPayload.Build hand-builds
            // the Dictionary<string, object?> tree the producer (Gonogo.KSP.
            // CrashUplink) publishes; these POCOs are TS-shape-only, never handed
            // to AppendValue raw.
            "CrashReport", "CrashPartLost", "CrashFlightStats",
            // recovery.lastSummary — Sitrep.Host.Recovery.RecoveryPayload.Build
            // hand-builds the Dictionary<string, object?> tree the producer
            // (Gonogo.KSP.RecoveryUplink) publishes; these POCOs are
            // TS-shape-only, never handed to AppendValue raw.
            "RecoveryReport", "RecoveryScienceEntry", "RecoveryPartEntry",
            "RecoveryResourceEntry", "RecoveryCrewEntry",
            // Envelope / meta — serialized field-by-field by EnvelopeCodec itself
            // (WriteStreamData / WriteMeta), never through AppendValue as a POCO.
            "Meta", "PayloadMeta", "ErrorMsg", "EventMsg", "Subscribe", "Unsubscribe",
            // Inbound command-arg types — only ever DESERIALIZED (client → server);
            // never serialized outbound as a raw POCO.
            "AddManeuverNodeArgs", "RemoveManeuverNodeArgs", "UpdateManeuverNodeArgs",
            "KosExecArgs", "KosReEnableArgs", "SetActionGroupArgs", "SetEnabledArgs",
            "SetPausedArgs", "SetSasModeArgs", "SetTargetArgs", "SetThrottleArgs",
            "SetWarpIndexArgs", "SetFlyByWireArgs", "SetControlAxesArgs",
            "ActivateStrategyArgs", "DeactivateStrategyArgs", "UnlockTechArgs",
            "ContractActionArgs", "UpgradeFacilityArgs", "RevertToEditorArgs",
            "SwitchVesselArgs", "LaunchArgs", "ServoSetTargetArgs", "ServoSetEnabledArgs",
            "RotorSetValueArgs", "RotorReverseArgs", "ExperimentActionArgs",
            // kos.terminal.* command args — inbound only (KosExtension.cs
            // AddCommandHandler for open/keystroke/resize/close); deserialized
            // client → server, never serialized outbound as a raw POCO. The
            // OUTBOUND KosTerminalFrame IS allowlisted above (self-flattened
            // by KosTerminalFrameBuilder at the publish boundary).
            "KosTerminalOpenArgs", "KosKeystrokeArgs", "KosTerminalResizeArgs",
            "KosTerminalCloseArgs",
            // kerbcast.setFieldOfView / kerbcast.setPan command args — inbound
            // only (KerbcastUplink.Register's AddCommandHandler for each);
            // deserialized client → server, never serialized outbound as a raw
            // POCO.
            "KerbcastSetFieldOfViewArgs", "KerbcastSetPanArgs",
            // kos.run command args — inbound only (KosExtension.Ksp.cs's Run
            // handler, AddCommandHandler<KosRunArgs, CommandResult>);
            // deserialized client → server, never serialized outbound as a raw
            // POCO. The OUTBOUND KosRunResult IS allowlisted above
            // (self-flattened by KosRunResultBuilder at the publish boundary).
            "KosRunArgs",
            // system.uplink.pending — PendingUplink is only ever nested inside
            // PendingUplinkQueue.Pending, flattened element-by-element by
            // AppendPendingUplinkQueue's own loop (AppendPendingUplink); it is
            // never handed to AppendValue on its own. PendingUplinkQueue itself
            // is NOT allowlisted — it IS published raw (ChannelEngine's
            // UplinkPendingTopic channel-source mapper) and has its own
            // JsonWriter case, exercised by this test.
            "PendingUplink",
        };

        private static IEnumerable<Type> ContractPayloadTypes() =>
            typeof(CommsDelay).Assembly.GetTypes()
                .Where(t => t.IsClass && !t.IsAbstract && !t.IsGenericTypeDefinition)
                // IsDefined checks only for THIS attribute — it does NOT construct
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
                "These [SitrepContract] payload types have no JsonWriter case and would be silently dropped at the wire boundary if published raw. Add an AppendValue case + Append<Type> helper (mirror AppendCommsDelay), or — if the type is flattened by its producer / envelope-serialized / inbound-only — add it to FlattenedByProducer with a reason: "
                    + string.Join(", ", missing));
        }

        [Fact]
        public void CommsPayloadsAreCovered_NotAllowlisted()
        {
            // The exact types the comms.* bug concerned — asserted covered AND
            // asserted NOT hidden behind the allowlist, so this test genuinely
            // exercises them (it would have gone RED before their JsonWriter
            // cases existed). KosProcessorInfo used to sit in this same list —
            // as of the kos migration (2026-07-18) it self-flattens
            // producer-side (KosProcessorInfoBuilder) and IS allowlisted (see
            // FlattenedByProducer above), so it no longer belongs in a "must
            // NOT be allowlisted" assertion.
            foreach (var name in new[]
                     {
                         nameof(CommsConnectivity), nameof(CommsSignalStrength),
                         nameof(CommsControlState), nameof(CommsPath), nameof(CommsNetwork),
                         nameof(CommsDelay),
                     })
            {
                Assert.False(FlattenedByProducer.Contains(name),
                    $"{name} must NOT be allowlisted — it is published raw and must have a JsonWriter case exercised by the coverage test.");
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
