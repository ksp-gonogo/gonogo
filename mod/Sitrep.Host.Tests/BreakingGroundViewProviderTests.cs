using System.Collections.Generic;
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
    /// mapped to <c>robotics.servos</c>/<c>robotics.available</c>/
    /// <c>deployed.bases</c> and asserted against the same rules the split
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
                            ["solarPanels"] = new List<object?>(),
                            ["batteries"] = new List<object?>(),
                            ["fuelCells"] = new List<object?>(),
                            ["alternators"] = new List<object?>(),
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
                            ["solarPanels"] = new List<object?>(),
                            ["batteries"] = new List<object?>(),
                            ["fuelCells"] = new List<object?>(),
                            ["alternators"] = new List<object?>(),
                            ["totalProductionEc"] = 0.0,
                        },
                    },
                },
            };

            Assert.Null(BreakingGroundViewProvider.BuildRobotics(snapshot));
            Assert.NotNull(PartsViewProvider.BuildPower(snapshot));
        }

        [Fact]
        public void BuildDeployedReturnsNullWhenSnapshotHasNoScienceKeyAtAll()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(BreakingGroundViewProvider.BuildDeployed(snapshot));
        }

        [Fact]
        public void BuildDeployedReturnsNullWhenSnapshotItselfIsNull()
        {
            Assert.Null(BreakingGroundViewProvider.BuildDeployed(null));
        }

        [Fact]
        public void BuildDeployedMapsGroundExperimentsFromSeparateNonActiveVessels()
        {
            // Regression guard for the "science.deployed always null" bug:
            // Breaking Ground deployed experiments live on their OWN ground
            // vessels (a deployed cluster is a peer vessel, never the vessel
            // the player is flying), so the raw "deployed" list is captured
            // GLOBALLY across FlightGlobals.Vessels. This fixture carries two
            // experiments from TWO DIFFERENT deployed-science vessels -
            // neither of which is the active vessel - and both must map, each
            // tagged with its own "vesselName". The old capture read only the
            // active vessel's parts and produced null here.
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["science"] = new Dictionary<string, object?>
                    {
                        ["deployed"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["vesselName"] = "Probodobodyne Experiment Control Station",
                                ["partName"] = "Atmospheric Fluid Spectro-Variometer",
                                ["body"] = "Mun",
                                ["situation"] = "LANDED",
                                ["biome"] = "Highlands",
                                ["experimentId"] = "surfaceExperimentAtmosphericFluidSpectroVariometer",
                                ["scienceCompletedPercentage"] = 42.5,
                                ["scienceTransmittedPercentage"] = 10.0,
                                ["scienceValue"] = 8.0,
                                ["scienceLimit"] = 20.0,
                                ["powerState"] = "Powered",
                                ["connectionState"] = "Connected",
                                ["deployedOnGround"] = true,
                            },
                            new Dictionary<string, object?>
                            {
                                ["vesselName"] = "Deployed Seismometer Site",
                                ["partName"] = "Seismic Accelerometer",
                                ["body"] = "Mun",
                                ["situation"] = "LANDED",
                                ["biome"] = "Midlands",
                                ["experimentId"] = "surfaceExperimentSeismicAccelerometer",
                                ["scienceCompletedPercentage"] = 0.0,
                                ["scienceTransmittedPercentage"] = 0.0,
                                ["scienceValue"] = 12.0,
                                ["scienceLimit"] = 30.0,
                                ["powerState"] = "NoPower",
                                ["connectionState"] = "NotConnected",
                                ["deployedOnGround"] = true,
                            },
                        },
                    },
                },
            };

            var payload = BreakingGroundViewProvider.BuildDeployed(snapshot);
            var list = Assert.IsType<List<object?>>(payload);
            Assert.Equal(2, list.Count);

            var first = Assert.IsType<Dictionary<string, object?>>(list[0]);
            Assert.Equal("Probodobodyne Experiment Control Station", first["vesselName"]);
            Assert.Equal("Atmospheric Fluid Spectro-Variometer", first["partName"]);
            Assert.Equal("Mun", first["body"]);
            Assert.Equal("Highlands", first["biome"]);
            Assert.Equal("surfaceExperimentAtmosphericFluidSpectroVariometer", first["experimentId"]);
            Assert.Equal(42.5, first["scienceCompletedPercentage"]);
            Assert.Equal("Powered", first["powerState"]);
            Assert.Equal("Connected", first["connectionState"]);
            Assert.Equal(true, first["deployedOnGround"]);

            var second = Assert.IsType<Dictionary<string, object?>>(list[1]);
            Assert.Equal("Deployed Seismometer Site", second["vesselName"]);
            Assert.Equal("Seismic Accelerometer", second["partName"]);
            Assert.Equal("NoPower", second["powerState"]);
            Assert.Equal("NotConnected", second["connectionState"]);
        }

        [Fact]
        public void BuildDeployedReturnsNullWhenSubGroupIsAbsentEvenThoughScienceKeyExists()
        {
            // KspHost's own TryBuildGroup can omit an individual science
            // sub-group (e.g. "deployed" while no cluster exists) without
            // taking out the others - the provider must map that to null,
            // not throw or fabricate an empty list.
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

            Assert.Null(BreakingGroundViewProvider.BuildDeployed(snapshot));
        }
    }
}
