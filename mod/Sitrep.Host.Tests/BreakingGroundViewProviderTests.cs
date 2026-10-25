using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Host;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Headless test for the Breaking Ground uplink's
    /// <see cref="BreakingGroundViewProvider"/>: fake <see cref="KspSnapshot"/>s
    /// carrying the same raw <c>"parts"</c>/<c>"science"</c> encodings
    /// <c>Gonogo.KSP.KspHost.BuildParts</c>/<c>BuildScience</c> produce are
    /// mapped to <c>robotics.servos</c>/<c>robotics.available</c> and the
    /// per-station <c>deployed.station.&lt;guid&gt;.report</c> and asserted against the same rules the split
    /// providers use: no-vessel/no-data -&gt; null, primitives-only shape,
    /// missing fields -&gt; null never a sentinel.
    ///
    /// <para>Split out of <c>PartsViewProviderTests</c> (robotics) and
    /// <c>ScienceViewProviderTests</c> (deployed science) alongside the
    /// Breaking Ground uplink extraction: the raw snapshot encoding those
    /// tests exercised is unchanged, only which provider reads it moved.</para>
    /// </summary>
    public class BreakingGroundViewProviderTests
    {
        [Fact]
        public void BuildRoboticsReturnsNullWhenSnapshotHasNoPartsKeyAtAll()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(BreakingGroundViewProvider.BuildRobotics(snapshot));
        }

        [Fact]
        public void BuildRoboticsReturnsNullWhenSnapshotItselfIsNull()
        {
            Assert.Null(BreakingGroundViewProvider.BuildRobotics(null));
        }

        [Fact]
        public void BuildRoboticsMapsRotorAndHingeEntries()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["parts"] = new Dictionary<string, object?>
                    {
                        ["robotics"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["partName"] = "Rotation Servo Rotor M",
                                ["type"] = "rotor",
                                ["servoIsLocked"] = false,
                                ["servoIsMotorized"] = true,
                                ["servoMotorIsEngaged"] = true,
                                ["servoMotorLimit"] = 100.0,
                                ["motorState"] = "Moving",
                                ["currentAngle"] = null,
                                ["targetAngle"] = null,
                                ["traverseVelocity"] = null,
                                ["currentRPM"] = 12.5,
                                ["rpmLimit"] = 60.0,
                                ["normalizedOutput"] = 0.2,
                                ["brakePercentage"] = 100.0,
                                ["currentExtension"] = null,
                                ["targetExtension"] = null,
                            },
                            new Dictionary<string, object?>
                            {
                                ["partName"] = "Hinge Servo M",
                                ["type"] = "hinge",
                                ["servoIsLocked"] = false,
                                ["servoIsMotorized"] = true,
                                ["servoMotorIsEngaged"] = true,
                                ["servoMotorLimit"] = 100.0,
                                ["motorState"] = "Idle",
                                ["currentAngle"] = 45.0,
                                ["targetAngle"] = 90.0,
                                ["traverseVelocity"] = 15.0,
                                ["currentRPM"] = null,
                                ["rpmLimit"] = null,
                                ["normalizedOutput"] = null,
                                ["brakePercentage"] = null,
                                ["currentExtension"] = null,
                                ["targetExtension"] = null,
                            },
                        },
                    },
                },
            };

            var payload = BreakingGroundViewProvider.BuildRobotics(snapshot);
            var list = Assert.IsType<List<object?>>(payload);
            Assert.Equal(2, list.Count);

            var rotor = Assert.IsType<Dictionary<string, object?>>(list[0]);
            Assert.Equal("rotor", rotor["type"]);
            Assert.Equal(12.5, rotor["currentRPM"]);
            Assert.Null(rotor["currentAngle"]);

            var hinge = Assert.IsType<Dictionary<string, object?>>(list[1]);
            Assert.Equal("hinge", hinge["type"]);
            Assert.Equal(45.0, hinge["currentAngle"]);
            Assert.Equal(90.0, hinge["targetAngle"]);
            Assert.Null(hinge["currentRPM"]);
        }

        /// <summary>
        /// The bug this field exists to fix: a multirotor's symmetric arms
        /// (or any two same-named parts) are indistinguishable by
        /// <c>partName</c> alone. Two raw entries sharing a <c>partName</c>
        /// but carrying distinct <c>partId</c>s (as
        /// <c>Gonogo.KSP.KspHost.BuildParts</c> stamps from each part's
        /// <c>flightID</c>) must come out the other side of
        /// <see cref="BreakingGroundViewProvider.BuildRobotics"/> still
        /// distinguishable. The power half of this same fixture is asserted
        /// in <c>PartsViewProviderTests</c>.
        /// </summary>
        [Fact]
        public void SameNamedPartsGetDistinctPartIdsThroughBuildRobotics()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["parts"] = new Dictionary<string, object?>
                    {
                        ["robotics"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["partName"] = "Rotation Servo Rotor M",
                                ["partId"] = "2001",
                                ["type"] = "rotor",
                                ["servoIsLocked"] = false,
                                ["servoIsMotorized"] = true,
                                ["servoMotorIsEngaged"] = true,
                                ["servoMotorLimit"] = 100.0,
                                ["motorState"] = "Moving",
                                ["currentAngle"] = null,
                                ["targetAngle"] = null,
                                ["traverseVelocity"] = null,
                                ["currentRPM"] = 12.5,
                                ["rpmLimit"] = 60.0,
                                ["normalizedOutput"] = 0.2,
                                ["brakePercentage"] = 100.0,
                                ["currentExtension"] = null,
                                ["targetExtension"] = null,
                            },
                            new Dictionary<string, object?>
                            {
                                // Same partName as above (a multirotor's
                                // symmetric second arm) but a different
                                // flightID-derived partId.
                                ["partName"] = "Rotation Servo Rotor M",
                                ["partId"] = "2002",
                                ["type"] = "rotor",
                                ["servoIsLocked"] = false,
                                ["servoIsMotorized"] = true,
                                ["servoMotorIsEngaged"] = true,
                                ["servoMotorLimit"] = 100.0,
                                ["motorState"] = "Idle",
                                ["currentAngle"] = null,
                                ["targetAngle"] = null,
                                ["traverseVelocity"] = null,
                                ["currentRPM"] = 0.0,
                                ["rpmLimit"] = 60.0,
                                ["normalizedOutput"] = 0.0,
                                ["brakePercentage"] = 100.0,
                                ["currentExtension"] = null,
                                ["targetExtension"] = null,
                            },
                        },
                    },
                },
            };

            var robotics = Assert.IsType<List<object?>>(BreakingGroundViewProvider.BuildRobotics(snapshot));
            Assert.Equal(2, robotics.Count);
            var servo1 = Assert.IsType<Dictionary<string, object?>>(robotics[0]);
            var servo2 = Assert.IsType<Dictionary<string, object?>>(robotics[1]);
            Assert.Equal("Rotation Servo Rotor M", servo1["partName"]);
            Assert.Equal("Rotation Servo Rotor M", servo2["partName"]);
            Assert.Equal("2001", servo1["partId"]);
            Assert.Equal("2002", servo2["partId"]);
            Assert.NotEqual(servo1["partId"], servo2["partId"]);
        }

        [Fact]
        public void BuildRoboticsAvailableReturnsNullWhenSnapshotHasNoPartsKeyAtAll()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(BreakingGroundViewProvider.BuildRoboticsAvailable(snapshot));
            Assert.Null(BreakingGroundViewProvider.BuildRoboticsAvailable(null));
        }

        [Fact]
        public void BuildRoboticsAvailableReportsTrueWhenVesselHasRoboticParts()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["parts"] = new Dictionary<string, object?>
                    {
                        ["roboticsAvailable"] = true,
                    },
                },
            };

            var payload = Assert.IsType<Dictionary<string, object?>>(BreakingGroundViewProvider.BuildRoboticsAvailable(snapshot));
            Assert.Equal(true, payload["available"]);
        }

        /// <summary>
        /// The whole reason robotics.available is its own Topic and not an
        /// empty <c>robotics.servos</c> array: a vessel present but carrying no
        /// robotic parts must report <c>available: false</c> (the parts key
        /// exists, roboticsAvailable is false), distinct from "no active
        /// vessel" (no parts key → null payload). Both cases are asserted
        /// here so the empty-vs-no-vessel disambiguation can't regress.
        /// </summary>
        [Fact]
        public void BuildRoboticsAvailableReportsFalseForAVesselWithNoRoboticParts()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["parts"] = new Dictionary<string, object?>
                    {
                        // A vessel present (parts key exists) with power but no
                        // robotics sub-group at all - roboticsAvailable false.
                        ["power"] = new Dictionary<string, object?>
                        {
                            ["totalProductionEc"] = 0.0,
                        },
                        ["roboticsAvailable"] = false,
                    },
                },
            };

            var payload = Assert.IsType<Dictionary<string, object?>>(BreakingGroundViewProvider.BuildRoboticsAvailable(snapshot));
            Assert.Equal(false, payload["available"]);

            // BuildRobotics (the bare array) collapses to null for the same
            // vessel - which is exactly why it can't carry availability.
            Assert.Null(BreakingGroundViewProvider.BuildRobotics(snapshot));
        }

        [Fact]
        public void BuildRoboticsAvailableYieldsNullAvailableWhenFieldWasNeverRecorded()
        {
            // An older snapshot recorded before roboticsAvailable existed: the
            // parts key is present but the flag is absent, so SnapshotDict
            // yields null rather than a sentinel.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["parts"] = new Dictionary<string, object?>
                    {
                        ["robotics"] = new List<object?>(),
                    },
                },
            };

            var payload = Assert.IsType<Dictionary<string, object?>>(BreakingGroundViewProvider.BuildRoboticsAvailable(snapshot));
            Assert.True(payload.ContainsKey("available"));
            Assert.Null(payload["available"]);
        }

        [Fact]
        public void BuildRoboticsAvailableCarriesTheProducersUnsurveyedNullThrough()
        {
            /*
             * The producer half of this pair (KspHost.BuildRoboticsAvailable)
             * answers null when a part could not be read, so the key is PRESENT
             * and explicitly null rather than absent. That is a different
             * snapshot shape from the older-recording case above, and it has to
             * reach the payload as null too: SnapshotDict.GetBool only accepts
             * a boxed bool, so a null value can never become false here.
             */
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["parts"] = new Dictionary<string, object?>
                    {
                        ["robotics"] = new List<object?>(),
                        ["roboticsAvailable"] = null,
                    },
                },
            };

            var payload = Assert.IsType<Dictionary<string, object?>>(BreakingGroundViewProvider.BuildRoboticsAvailable(snapshot));
            Assert.True(payload.ContainsKey("available"));
            Assert.Null(payload["available"]);
        }

        [Fact]
        public void BuildRoboticsReturnsNullWhenSubGroupIsAbsentEvenThoughPartsKeyExists()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["parts"] = new Dictionary<string, object?>
                    {
                        // "power" present, "robotics" absent - a vessel with
                        // solar panels but no robotics parts.
                        ["power"] = new Dictionary<string, object?>
                        {
                            ["totalProductionEc"] = 0.0,
                        },
                    },
                },
            };

            Assert.Null(BreakingGroundViewProvider.BuildRobotics(snapshot));
            Assert.NotNull(PartsViewProvider.BuildPower(snapshot));
        }

        [Fact]
        public void BuildStationsReturnsNullWhenSnapshotHasNoScienceKeyAtAll()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(BreakingGroundViewProvider.BuildStations(snapshot));
        }

        [Fact]
        public void BuildStationsReturnsNullWhenSnapshotItselfIsNull()
        {
            Assert.Null(BreakingGroundViewProvider.BuildStations(null));
        }

        private static Dictionary<string, object?> Experiment(
            string stationId,
            string stationName,
            string partName,
            bool? sendPathHome,
            double? storedData,
            bool? dataSendFailed = false) => new Dictionary<string, object?>
            {
                ["stationId"] = stationId,
                ["stationName"] = stationName,
                ["stationBody"] = "Mun",
                ["stationSituation"] = "LANDED",
                ["stationBiome"] = "Highlands",
                ["partName"] = partName,
                ["experimentId"] = "surfaceExperiment" + partName.Replace(" ", ""),
                ["scienceCompletedPercentage"] = 42.5,
                ["scienceTransmittedPercentage"] = 10.0,
                ["scienceValue"] = 8.0,
                ["scienceLimit"] = 20.0,
                ["storedData"] = storedData,
                ["power"] = (int)DeployedPowerState.Powered,
                ["powerAvailable"] = 30,
                ["powerRequired"] = 20,
                ["sendPathHome"] = sendPathHome,
                ["dataSendFailed"] = dataSendFailed,
                ["deployedOnGround"] = true,
            };

        [Fact]
        public void BuildStationsGroupsExperimentsByTheirControllerVessel()
        {
            // Two stations with the active craft elsewhere: each is keyed by its own
            // controller vessel, and an experiment lands in the station it reports through.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["deployedScience"] = new List<object?>
                    {
                        Experiment("station-a", "Mun Station", "Spectro Variometer", true, 0.0),
                        Experiment("station-b", "Minmus Station", "Seismic Accelerometer", false, 14.5),
                        Experiment("station-a", "Mun Station", "Atmospheric Sampler", true, 3.0),
                    },
                },
            };

            var stations = Assert.IsType<Dictionary<string, Dictionary<string, object?>>>(
                BreakingGroundViewProvider.BuildStations(snapshot));

            Assert.Equal(new[] { "station-a", "station-b" }, stations.Keys.OrderBy(k => k, StringComparer.Ordinal));

            var a = stations["station-a"];
            Assert.Equal("Mun Station", a["stationName"]);
            Assert.Equal("Mun", a["body"]);
            Assert.Equal("Highlands", a["biome"]);
            Assert.Equal((int)DeployedPowerState.Powered, a["power"]);
            Assert.Equal(true, a["sendPathHome"]);
            Assert.Equal(2, Assert.IsType<List<object?>>(a["experiments"]).Count);

            var b = stations["station-b"];
            Assert.Equal(false, b["sendPathHome"]);
            var stranded = Assert.IsType<Dictionary<string, object?>>(Assert.Single(Assert.IsType<List<object?>>(b["experiments"])));
            Assert.Equal(14.5, stranded["storedData"]);
        }

        [Fact]
        public void BuildStationsKeepsAnUnreadSendPathAsNullNotFalse()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["deployedScience"] = new List<object?>
                    {
                        Experiment("station-a", "Mun Station", "Spectro Variometer", sendPathHome: null, storedData: null, dataSendFailed: null),
                    },
                },
            };

            var station = Assert.Single(Assert.IsType<Dictionary<string, Dictionary<string, object?>>>(
                BreakingGroundViewProvider.BuildStations(snapshot))).Value;

            Assert.Null(station["sendPathHome"]);
            Assert.Null(station["dataSendFailed"]);
            var experiment = Assert.IsType<Dictionary<string, object?>>(Assert.Single(Assert.IsType<List<object?>>(station["experiments"])));
            Assert.Null(experiment["storedData"]);
        }

        private static Dictionary<string, object?> StrandedOf(double? completedPercentage, double? storedData)
        {
            var raw = Experiment("station-a", "Mun Station", "Spectro Variometer", true, storedData);
            raw["scienceCompletedPercentage"] = completedPercentage;
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["deployedScience"] = new List<object?> { raw } },
            };
            var station = Assert.Single(Assert.IsType<Dictionary<string, Dictionary<string, object?>>>(
                BreakingGroundViewProvider.BuildStations(snapshot))).Value;
            return Assert.IsType<Dictionary<string, object?>>(Assert.Single(Assert.IsType<List<object?>>(station["experiments"])));
        }

        [Fact]
        public void BuildStationsCallsACompletedExperimentWithAStoreStranded()
        {
            Assert.Equal(true, StrandedOf(100.0, 5.1)["stranded"]);
        }

        [Fact]
        public void BuildStationsDoesNotCallAnExperimentStillCollectingStranded()
        {
            Assert.Equal(false, StrandedOf(42.5, 5.1)["stranded"]);
        }

        [Fact]
        public void BuildStationsDoesNotCallACompletedExperimentWithAnEmptyStoreStranded()
        {
            Assert.Equal(false, StrandedOf(100.0, 0.0)["stranded"]);
        }

        [Fact]
        public void BuildStationsLeavesStrandedUnreadWhenEitherInputIsUnread()
        {
            Assert.Null(StrandedOf(100.0, null)["stranded"]);
            Assert.Null(StrandedOf(null, 5.1)["stranded"]);
        }

        [Fact]
        public void BuildStationsLeavesOutAnExperimentWithNoControllerVessel()
        {
            var unplaced = Experiment("station-a", "x", "Spectro Variometer", true, 0.0);
            unplaced.Remove("stationId");
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["deployedScience"] = new List<object?> { unplaced },
                },
            };

            Assert.Empty(Assert.IsType<Dictionary<string, Dictionary<string, object?>>>(
                BreakingGroundViewProvider.BuildStations(snapshot)));
        }

        [Fact]
        public void BuildStationsReturnsNullWhenSubGroupIsAbsentEvenThoughScienceKeyExists()
        {
            // KspHost's own TryBuildGroup can omit an individual science
            // sub-group (e.g. "deployed" while no cluster exists) without
            // taking out the others - the provider must map that to null,
            // not throw or fabricate an empty map.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["science"] = new Dictionary<string, object?>
                    {
                        ["experiments"] = new List<object?>(),
                        // "deployed" absent entirely
                    },
                },
            };

            Assert.Null(BreakingGroundViewProvider.BuildStations(snapshot));
        }

        [Fact]
        public void BuildStations_AnEmptyRosterIsAnEmptyMapNotNull()
        {
            // Breaking Ground installed and nothing deployed: a complete answer.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["deployedScience"] = new List<object?>() },
            };

            Assert.Empty(Assert.IsType<Dictionary<string, Dictionary<string, object?>>>(
                BreakingGroundViewProvider.BuildStations(snapshot)));
        }
    }
}
