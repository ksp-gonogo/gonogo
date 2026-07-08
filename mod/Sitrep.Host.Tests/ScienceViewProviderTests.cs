using System.Collections.Generic;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Headless test for the <c>science.*</c> capture-add's
    /// <see cref="ScienceViewProvider"/>: fake <see cref="KspSnapshot"/>s
    /// carrying the raw <c>"science"</c> encoding <c>Gonogo.KSP.KspHost.
    /// BuildScience</c> produces are mapped to each of the three
    /// <c>science.*</c> payloads and asserted against the class doc's
    /// rules — no-vessel/no-data -&gt; null, primitives-only shape, missing
    /// fields -&gt; null never a sentinel.
    /// </summary>
    public class ScienceViewProviderTests
    {
        [Fact]
        public void BuildExperimentsReturnsNullWhenSnapshotHasNoScienceKeyAtAll()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(ScienceViewProvider.BuildExperiments(snapshot));
            Assert.Null(ScienceViewProvider.BuildLab(snapshot));
            Assert.Null(ScienceViewProvider.BuildDeployed(snapshot));
        }

        [Fact]
        public void BuildExperimentsReturnsNullWhenSnapshotItselfIsNull()
        {
            Assert.Null(ScienceViewProvider.BuildExperiments(null));
            Assert.Null(ScienceViewProvider.BuildLab(null));
            Assert.Null(ScienceViewProvider.BuildDeployed(null));
        }

        [Fact]
        public void BuildExperimentsMapsOnboardExperimentAndContainerEntries()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 100.0,
                Values = new Dictionary<string, object?>
                {
                    ["science"] = new Dictionary<string, object?>
                    {
                        ["experiments"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["partName"] = "Mystery Goo Containment Pod",
                                ["location"] = "experiment",
                                ["experimentId"] = "mysteryGoo",
                                ["subjectId"] = "mysteryGoo@KerbinSrfLanded",
                                ["title"] = "Mystery Goo Observation",
                                ["dataAmount"] = 5.0,
                                ["scienceValueRatio"] = 1.0,
                                ["baseTransmitValue"] = 0.3,
                                ["transmitBonus"] = 1.0,
                                ["labValue"] = 1.0,
                                ["deployed"] = true,
                                ["inoperable"] = false,
                                ["situation"] = "LANDED",
                            },
                            new Dictionary<string, object?>
                            {
                                ["partName"] = "Science Jr.",
                                ["location"] = "container",
                                ["experimentId"] = null,
                                ["subjectId"] = "temperatureScan@KerbinSrfLanded",
                                ["title"] = "Temperature Scan",
                                ["dataAmount"] = 2.5,
                                ["scienceValueRatio"] = 1.0,
                                ["baseTransmitValue"] = 0.1,
                                ["transmitBonus"] = 1.0,
                                ["labValue"] = 1.0,
                                ["deployed"] = null,
                                ["inoperable"] = null,
                                ["situation"] = "LANDED",
                            },
                        },
                    },
                },
            };

            var payload = ScienceViewProvider.BuildExperiments(snapshot);
            var list = Assert.IsType<List<object?>>(payload);
            Assert.Equal(2, list.Count);

            var first = Assert.IsType<Dictionary<string, object?>>(list[0]);
            Assert.Equal("Mystery Goo Containment Pod", first["partName"]);
            Assert.Equal("experiment", first["location"]);
            Assert.Equal("mysteryGoo", first["experimentId"]);
            Assert.Equal(5.0, first["dataAmount"]);
            Assert.Equal(true, first["deployed"]);
            Assert.Equal(false, first["inoperable"]);

            var second = Assert.IsType<Dictionary<string, object?>>(list[1]);
            Assert.Equal("container", second["location"]);
            Assert.Null(second["experimentId"]);
            Assert.Null(second["deployed"]);
        }

        [Fact]
        public void BuildLabMapsScienceLabEntry()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["science"] = new Dictionary<string, object?>
                    {
                        ["lab"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["partName"] = "Mobile Processing Lab MPL-LG-2",
                                ["dataStored"] = 120.0,
                                ["dataStorage"] = 500.0,
                                ["storedScience"] = 15.5,
                                ["processingData"] = true,
                                ["statusText"] = "Analyzing data...",
                                ["scientistCount"] = 2,
                                ["scienceRate"] = 0.02,
                                ["isOperational"] = true,
                            },
                        },
                    },
                },
            };

            var payload = ScienceViewProvider.BuildLab(snapshot);
            var list = Assert.IsType<List<object?>>(payload);
            var lab = Assert.IsType<Dictionary<string, object?>>(Assert.Single(list));
            Assert.Equal("Mobile Processing Lab MPL-LG-2", lab["partName"]);
            Assert.Equal(120.0, lab["dataStored"]);
            Assert.Equal(2, lab["scientistCount"]);
            Assert.Equal(true, lab["processingData"]);
            Assert.Equal(0.02, lab["scienceRate"]);
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

            var payload = ScienceViewProvider.BuildDeployed(snapshot);
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
        public void BuildLabReturnsNullWhenSubGroupIsAbsentEvenThoughScienceKeyExists()
        {
            // KspHost's own TryBuildGroup can omit an individual science
            // sub-group (e.g. "lab" while the vessel has no MPL) without
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
                        // "lab"/"deployed" absent entirely
                    },
                },
            };

            Assert.Null(ScienceViewProvider.BuildLab(snapshot));
            Assert.Null(ScienceViewProvider.BuildDeployed(snapshot));
        }
    }
}
