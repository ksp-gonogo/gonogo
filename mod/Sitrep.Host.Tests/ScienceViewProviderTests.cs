using System.Collections.Generic;
using Sitrep.Host;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Headless test for the <c>science.*</c> capture-add's
    /// <see cref="ScienceViewProvider"/>: fake <see cref="KspSnapshot"/>s
    /// carrying the raw <c>"science"</c> encoding <c>Gonogo.KSP.KspHost.
    /// BuildScience</c> produces are mapped to each of the <c>science.*</c>
    /// payloads and asserted against the class doc's rules: no-vessel/no-data
    /// -&gt; null, primitives-only shape, missing fields -&gt; null never a
    /// sentinel. The sibling Breaking Ground deployed-science tests that used
    /// to live here moved to <c>BreakingGroundViewProviderTests</c> alongside
    /// the split-out <see cref="BreakingGroundViewProvider"/>.
    /// </summary>
    public class ScienceViewProviderTests
    {
        [Fact]
        public void BuildExperimentsReturnsNullWhenSnapshotHasNoScienceKeyAtAll()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(ScienceViewProvider.BuildExperiments(snapshot));
            Assert.Null(ScienceViewProvider.BuildLab(snapshot));
        }

        [Fact]
        public void BuildExperimentsReturnsNullWhenSnapshotItselfIsNull()
        {
            Assert.Null(ScienceViewProvider.BuildExperiments(null));
            Assert.Null(ScienceViewProvider.BuildLab(null));
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
            var list = Assert.IsType<List<ExperimentEntry>>(payload);
            Assert.Equal(2, list.Count);

            var first = list[0];
            Assert.Equal("Mystery Goo Containment Pod", first.PartName);
            Assert.Equal("experiment", first.Location);
            Assert.Equal("mysteryGoo", first.ExperimentId);
            Assert.Equal(5.0, first.DataAmount);
            Assert.Equal(true, first.Deployed);
            Assert.Equal(false, first.Inoperable);

            var second = list[1];
            Assert.Equal("container", second.Location);
            Assert.Null(second.ExperimentId);
            Assert.Null(second.Deployed);
        }

        [Fact]
        public void BuildInstrumentsMapsExperimentModuleInventoryKeyedByPartId()
        {
            // science.instruments is an INVENTORY of ModuleScienceExperiment
            // modules (one row per module, regardless of stored data), keyed
            // by partId - distinct from science.experiments which rows per
            // STORED ScienceData result. Two modules on two parts here; both
            // map with their operability flags.
            var snapshot = new KspSnapshot
            {
                Ut = 100.0,
                Values = new Dictionary<string, object?>
                {
                    ["science"] = new Dictionary<string, object?>
                    {
                        ["instruments"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["partId"] = "12345",
                                ["partName"] = "Mystery Goo Containment Pod",
                                ["experimentId"] = "mysteryGoo",
                                ["title"] = "Mystery Goo Observation",
                                ["deployed"] = true,
                                ["inoperable"] = false,
                                ["rerunnable"] = false,
                                ["resettable"] = true,
                                ["dataIsCollectable"] = true,
                            },
                            new Dictionary<string, object?>
                            {
                                ["partId"] = "67890",
                                ["partName"] = "PresMat Barometer",
                                ["experimentId"] = "barometerScan",
                                ["title"] = null,
                                ["deployed"] = null,
                                ["inoperable"] = null,
                                ["rerunnable"] = true,
                                ["resettable"] = false,
                                ["dataIsCollectable"] = false,
                            },
                        },
                    },
                },
            };

            var payload = ScienceViewProvider.BuildInstruments(snapshot);
            var list = Assert.IsType<List<InstrumentEntry>>(payload);
            Assert.Equal(2, list.Count);

            var first = list[0];
            Assert.Equal("12345", first.PartId);
            Assert.Equal("Mystery Goo Containment Pod", first.PartName);
            Assert.Equal("mysteryGoo", first.ExperimentId);
            Assert.Equal("Mystery Goo Observation", first.Title);
            Assert.Equal(true, first.Deployed);
            Assert.Equal(false, first.Inoperable);
            Assert.Equal(false, first.Rerunnable);
            Assert.Equal(true, first.Resettable);
            Assert.Equal(true, first.DataIsCollectable);

            var second = list[1];
            Assert.Equal("67890", second.PartId);
            Assert.Null(second.Title);
            Assert.Null(second.Deployed);
            Assert.Equal(true, second.Rerunnable);
            Assert.Equal(false, second.DataIsCollectable);
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
            var list = Assert.IsType<List<LabEntry>>(payload);
            var lab = Assert.Single(list);
            Assert.Equal("Mobile Processing Lab MPL-LG-2", lab.PartName);
            Assert.Equal(120.0, lab.DataStored);
            Assert.Equal(2, lab.ScientistCount);
            Assert.Equal(true, lab.ProcessingData);
            Assert.Equal(0.02, lab.ScienceRate);
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
                        // "lab" absent entirely
                    },
                },
            };

            Assert.Null(ScienceViewProvider.BuildLab(snapshot));
        }

        [Fact]
        public void BuildSensorsMapsEnviroSensorEntries()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["science"] = new Dictionary<string, object?>
                    {
                        // A GENERAL sensor group: one entry per ModuleEnviroSensor,
                        // "type" carrying the raw SensorType enum name as a string
                        // (NOT four fixed temp/pres/grav/acc keys). Two sensors of
                        // the same type on different parts both appear, kept apart
                        // by "partId".
                        ["sensors"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["partId"] = "101",
                                ["partName"] = "PresMat Barometer",
                                ["type"] = "PRES",
                                ["readout"] = "0.998atm",
                                ["active"] = true,
                            },
                            new Dictionary<string, object?>
                            {
                                ["partId"] = "102",
                                ["partName"] = "2HOT Thermometer",
                                ["type"] = "TEMP",
                                ["readout"] = "Off",
                                ["active"] = false,
                            },
                        },
                    },
                },
            };

            var payload = ScienceViewProvider.BuildSensors(snapshot);
            var list = Assert.IsType<List<SensorEntry>>(payload);
            Assert.Equal(2, list.Count);

            var first = list[0];
            Assert.Equal("101", first.PartId);
            Assert.Equal("PresMat Barometer", first.PartName);
            Assert.Equal("PRES", first.Type);
            Assert.Equal("0.998atm", first.Readout);
            Assert.Equal(true, first.Active);

            var second = list[1];
            Assert.Equal("102", second.PartId);
            Assert.Equal("TEMP", second.Type);
            Assert.Equal("Off", second.Readout);
            Assert.Equal(false, second.Active);
        }

        [Fact]
        public void BuildSensorsReturnsNullWhenSubGroupAbsentOrSnapshotEmpty()
        {
            Assert.Null(ScienceViewProvider.BuildSensors(null));
            Assert.Null(ScienceViewProvider.BuildSensors(
                new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() }));

            // "science" present but no "sensors" sub-group (e.g. a vessel with
            // no environmental sensor) -> null, never an empty list.
            var partialScience = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["science"] = new Dictionary<string, object?>
                    {
                        ["experiments"] = new List<object?>(),
                    },
                },
            };
            Assert.Null(ScienceViewProvider.BuildSensors(partialScience));
        }

        [Fact]
        public void BuildExperimentBreakdownMapsPerSubjectEntries()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["science"] = new Dictionary<string, object?>
                    {
                        // One entry per DISTINCT subject id -- KspHost.BuildScienceExperimentBreakdown
                        // collapses multiple stored blobs for the same subject into
                        // one row with dataMits summed, so the raw group here is
                        // already collapsed (the collapsing itself is exercised by
                        // KspHost, out of this KSP-free provider's scope).
                        ["experimentBreakdown"] = new List<object?>
                        {
                            new Dictionary<string, object?>
                            {
                                ["subjectId"] = "mysteryGoo@KerbinSrfLandedShores",
                                ["biome"] = "Shores",
                                ["situation"] = "SrfLanded",
                                ["expTitle"] = "Mystery Goo Observation",
                                ["dataMits"] = 5.0,
                                ["remainingPotential"] = 12.5,
                            },
                            new Dictionary<string, object?>
                            {
                                ["subjectId"] = "crewReport@KerbinInSpaceLow",
                                ["biome"] = "",
                                ["situation"] = "InSpaceLow",
                                ["expTitle"] = "Crew Report",
                                ["dataMits"] = 10.0,
                                ["remainingPotential"] = 0.0,
                            },
                        },
                    },
                },
            };

            var payload = ScienceViewProvider.BuildExperimentBreakdown(snapshot);
            var list = Assert.IsType<List<ExperimentBreakdownEntry>>(payload);
            Assert.Equal(2, list.Count);

            var first = list[0];
            Assert.Equal("mysteryGoo@KerbinSrfLandedShores", first.SubjectId);
            Assert.Equal("Shores", first.Biome);
            Assert.Equal("SrfLanded", first.Situation);
            Assert.Equal("Mystery Goo Observation", first.ExpTitle);
            Assert.Equal(5.0, first.DataMits);
            Assert.Equal(12.5, first.RemainingPotential);
            // The stock backend tags every value-bearing entry with the model that
            // produced its numbers: present on every frame rather than inferred from
            // absence, see Sitrep.Contract.ScienceValueModels.
            Assert.Equal(ScienceValueModels.Stock, first.ValueModel);

            var second = list[1];
            Assert.Equal("crewReport@KerbinInSpaceLow", second.SubjectId);
            Assert.Equal(0.0, second.RemainingPotential);
        }

        [Fact]
        public void BuildExperimentBreakdownReturnsNullWhenSubGroupAbsentOrSnapshotEmpty()
        {
            Assert.Null(ScienceViewProvider.BuildExperimentBreakdown(null));
            Assert.Null(ScienceViewProvider.BuildExperimentBreakdown(
                new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() }));

            // "science" present but no "experimentBreakdown" sub-group (e.g. a
            // vessel carrying no stored science data) -> null, never an empty list.
            var partialScience = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["science"] = new Dictionary<string, object?>
                    {
                        ["experiments"] = new List<object?>(),
                    },
                },
            };
            Assert.Null(ScienceViewProvider.BuildExperimentBreakdown(partialScience));
        }

        [Fact]
        public void BuildArchiveMapsSubjectsFromDifferentBodiesAcrossTheWholeCareer()
        {
            // Unlike every other science.* builder above, the raw list lives
            // at a TOP-LEVEL "scienceArchive" key, not nested under
            // "science" - the archive is global R&D ground truth, not
            // gated on an active vessel, so it can't ride the same
            // vessel-only group. Two subjects from two different bodies,
            // neither collected by "the active vessel" (there isn't one).
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["scienceArchive"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["subjectId"] = "crewReport@KerbinSrfLandedKSC",
                            ["experimentId"] = "crewReport",
                            ["experimentTitle"] = "Crew Report",
                            ["body"] = "Kerbin",
                            ["situation"] = "SrfLanded",
                            ["biome"] = "KSC",
                            ["title"] = "Crew Report from Kerbin's Space Center",
                            ["science"] = 5.0,
                            ["scienceCap"] = 5.0,
                            ["remainingPotential"] = 0.0,
                            ["subjectValue"] = 1.0,
                        },
                        new Dictionary<string, object?>
                        {
                            ["subjectId"] = "mysteryGoo@MunSrfLandedMidlands",
                            ["experimentId"] = "mysteryGoo",
                            ["experimentTitle"] = "Mystery Goo Observation",
                            ["body"] = "Mun",
                            ["situation"] = "SrfLanded",
                            ["biome"] = "Midlands",
                            ["title"] = "Mystery Goo Observation from Mun's midlands",
                            ["science"] = 6.0,
                            ["scienceCap"] = 15.0,
                            ["remainingPotential"] = 9.0,
                            ["subjectValue"] = 1.5,
                        },
                        new Dictionary<string, object?>
                        {
                            ["subjectId"] = "temperatureScan@DunaInSpaceLow",
                            ["experimentId"] = "temperatureScan",
                            ["experimentTitle"] = "Temperature Scan",
                            ["body"] = "Duna",
                            ["situation"] = "InSpaceLow",
                            ["biome"] = "",
                            ["title"] = "Temperature scan while in space near Duna",
                            ["science"] = 2.0,
                            ["scienceCap"] = 4.0,
                            ["remainingPotential"] = 2.0,
                            ["subjectValue"] = 3.0,
                        },
                    },
                },
            };

            var payload = ScienceViewProvider.BuildArchive(snapshot);
            var list = Assert.IsType<List<object?>>(payload);
            Assert.Equal(3, list.Count);

            var first = Assert.IsType<Dictionary<string, object?>>(list[0]);
            Assert.Equal("crewReport@KerbinSrfLandedKSC", first["subjectId"]);
            Assert.Equal("crewReport", first["experimentId"]);
            Assert.Equal("Crew Report", first["experimentTitle"]);
            Assert.Equal("Kerbin", first["body"]);
            Assert.Equal("SrfLanded", first["situation"]);
            Assert.Equal("KSC", first["biome"]);
            Assert.Equal("Crew Report from Kerbin's Space Center", first["title"]);
            Assert.Equal(5.0, first["science"]);
            Assert.Equal(5.0, first["scienceCap"]);
            Assert.Equal(0.0, first["remainingPotential"]);
            Assert.Equal(1.0, first["subjectValue"]);
            Assert.Equal(11, first.Count);

            var second = Assert.IsType<Dictionary<string, object?>>(list[1]);
            Assert.Equal("mysteryGoo@MunSrfLandedMidlands", second["subjectId"]);
            Assert.Equal("Mun", second["body"]);
            Assert.Equal("Midlands", second["biome"]);
            Assert.Equal(6.0, second["science"]);
            Assert.Equal(15.0, second["scienceCap"]);
            Assert.Equal(9.0, second["remainingPotential"]);

            var third = Assert.IsType<Dictionary<string, object?>>(list[2]);
            Assert.Equal("temperatureScan@DunaInSpaceLow", third["subjectId"]);
            Assert.Equal("Duna", third["body"]);
            Assert.Equal("", third["biome"]);
            Assert.Equal(3.0, third["subjectValue"]);
        }

        [Fact]
        public void BuildArchiveReturnsNullWhenSnapshotHasNoScienceArchiveKey()
        {
            Assert.Null(ScienceViewProvider.BuildArchive(null));
            Assert.Null(ScienceViewProvider.BuildArchive(
                new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() }));

            // The archive lives at a TOP-LEVEL key: a snapshot carrying a
            // populated "science" group (active vessel flying) but no
            // "scienceArchive" sibling - e.g. Sandbox mode, no R&D instance
            // to walk - must still map to null, never fall back to reading
            // anything out of "science".
            var vesselOnly = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["science"] = new Dictionary<string, object?>
                    {
                        ["experiments"] = new List<object?>(),
                    },
                },
            };
            Assert.Null(ScienceViewProvider.BuildArchive(vesselOnly));
        }

    }
}
