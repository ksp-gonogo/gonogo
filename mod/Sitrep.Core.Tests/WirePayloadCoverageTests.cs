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
            "VesselControl", "VesselComms", "VesselCrew", "VesselManeuver",
            "VesselPropulsion", "VesselStructure", "VesselSurface", "VesselTarget",
            "VesselThermal", "ThermalHottestPart", "ManeuverNode", "Vec3",
            "DockAlignment", "WarpState", "CrewMember", "VesselPhysicsMode",
            // vessel.parts — VesselPartsViewProvider.ToWire flattens VesselParts/
            // VesselPart/PartBounds to Dictionary<string, object?> before Publish;
            // TS-shape-only, never handed to AppendValue raw.
            "VesselParts", "VesselPart", "PartBounds",
            // kOS status — flattened by its provider before publish.
            "KosComputeStatus",
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
            "OrbitEntry", "SystemVessels", "VesselRosterEntry",
            // dv.* — StageDeltaVViewProvider.BuildStages/BuildSummary hand-build
            // Dictionary/List trees; these POCOs are TS-shape-only.
            "StageDeltaVEntry", "StageDeltaVSummary",
            // spaceCenter.* — SpaceCenterViewProvider.BuildLaunchSites/BuildScene/
            // BuildCrewRoster/BuildSavedShips/BuildPartsAvailable hand-build
            // Dictionary/List trees; these POCOs are TS-shape-only.
            "LaunchSiteEntry", "SpaceCenterScene",
            "CrewRosterEntry", "SavedShipEntry", "SpaceCenterPartsAvailable",
            // parts.power / parts.robotics / robotics.available —
            // PartsViewProvider.BuildPower/BuildRobotics/BuildRoboticsAvailable
            // hand-build Dictionary<string, object?> trees; these POCOs are
            // TS-shape-only.
            "SolarPanelEntry", "BatteryEntry", "FuelCellEntry", "AlternatorEntry",
            "PartsPower", "ServoEntry", "RoboticsAvailability",
            // science.* — ScienceViewProvider.BuildExperiments/BuildInstruments/
            // BuildLab/BuildDeployed/BuildSensors hand-build
            // Dictionary<string, object?> trees; these POCOs are TS-shape-only.
            "ExperimentEntry", "InstrumentEntry", "LabEntry", "DeployedEntry",
            "SensorEntry",
            // scansat.scanningVessels — Gonogo.ScansatUplink.ScanningVessels.Build is
            // deliberately SCANsat/KSP-type-free and hand-builds
            // Dictionary<string, object?> trees; these POCOs are TS-shape-only.
            "ScanSensorEntry", "ScanTrackColor", "ScanningVesselEntry",
            // crash.lastCrash — Sitrep.Host.Crash.CrashPayload.Build hand-builds
            // the Dictionary<string, object?> tree the producer (Gonogo.KSP.
            // CrashUplink) publishes; these POCOs are TS-shape-only, never handed
            // to AppendValue raw.
            "CrashReport", "CrashPartLost", "CrashFlightStats",
            // Envelope / meta — serialized field-by-field by EnvelopeCodec itself
            // (WriteStreamData / WriteMeta), never through AppendValue as a POCO.
            "Meta", "PayloadMeta", "ErrorMsg", "EventMsg", "Subscribe", "Unsubscribe",
            // Inbound command-arg types — only ever DESERIALIZED (client → server);
            // never serialized outbound as a raw POCO.
            "AddManeuverNodeArgs", "RemoveManeuverNodeArgs", "UpdateManeuverNodeArgs",
            "KosExecArgs", "KosReEnableArgs", "SetActionGroupArgs", "SetEnabledArgs",
            "SetPausedArgs", "SetSasModeArgs", "SetTargetArgs", "SetThrottleArgs",
            "SetWarpIndexArgs",
            "ActivateStrategyArgs", "DeactivateStrategyArgs", "UnlockTechArgs",
            "ContractActionArgs", "UpgradeFacilityArgs", "RevertToEditorArgs",
            "SwitchVesselArgs", "LaunchArgs", "ServoSetTargetArgs", "ServoSetEnabledArgs",
            "RotorSetValueArgs", "RotorReverseArgs", "ExperimentActionArgs",
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
        public void CommsAndKosPayloadsAreCovered_NotAllowlisted()
        {
            // The exact types the two prior bugs concerned — asserted covered AND
            // asserted NOT hidden behind the allowlist, so this test genuinely
            // exercises them (it would have gone RED before their JsonWriter
            // cases existed).
            foreach (var name in new[]
                     {
                         nameof(CommsConnectivity), nameof(CommsSignalStrength),
                         nameof(CommsControlState), nameof(CommsPath), nameof(CommsNetwork),
                         nameof(CommsDelay), nameof(KosProcessorInfo),
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
            SerializeThroughWire(new KosProcessorInfo());
        }
    }
}
