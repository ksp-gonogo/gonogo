using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Gonogo.KerbalismUplink;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Xunit;

namespace GonogoKerbalismUplink.Tests
{
    /// <summary>
    /// The SERVER half of the science-superset proof: Kerbalism wins the
    /// <c>"science"</c> election, fills the shared <c>science.*</c> shapes from its
    /// own model, and carries everything that shape cannot express in its own
    /// namespace of the payload's extension bag, with the REAL wire writer carrying
    /// it.
    ///
    /// <para><b>Why the real codec.</b> The claim is about the wire, so these go
    /// through <see cref="EnvelopeCodec.WriteStreamData"/>, the same call the courier
    /// makes. Asserting on <see cref="KerbalismScienceMap"/>'s dictionary would
    /// restate the producer and prove nothing about serialisation.</para>
    ///
    /// <para><b>The fixture is the handoff to the client.</b> The JSON asserted here
    /// is committed as <c>mod/golden-fixtures/science-extensions.json</c> and read
    /// back by this Uplink's client test (<c>client/src/science.test.ts</c>), which
    /// drives it through the real decode path and asserts the typed narrow and the
    /// wrapped <c>Value&lt;"MB"&gt;</c>. Neither side can drift without one of the
    /// two going red: the same discipline
    /// <c>ReliabilityExtensionWireTests</c> established.</para>
    /// </summary>
    public class ScienceExtensionWireTests
    {
        private static readonly string FixturePath = Path.Combine(
            AppContext.BaseDirectory, "golden-fixtures", "science-extensions.json");

        private static string FixtureWire(string name)
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(FixturePath));
            foreach (var vector in doc.RootElement.EnumerateArray())
            {
                if (vector.GetProperty("name").GetString() == name)
                {
                    return vector.GetProperty("json").GetString()!;
                }
            }

            throw new InvalidOperationException(
                "No fixture vector named '" + name + "' in " + FixturePath);
        }

        /// <summary>
        /// A vessel with one transmissible FILE and one physical SAMPLE of a
        /// different subject, on a drive that is neither empty nor unlimited, plus a
        /// running experiment with an issue and a lab. Enough that every branch the
        /// map takes is exercised and no field can pass by coincidence: the file and
        /// the sample differ in kind, size, mass and transmit state, and the two
        /// subjects differ in every ledger figure.
        /// </summary>
        private static ScienceRaw Raw() => new ScienceRaw
        {
            Modeled = true,
            Experiments =
            {
                new ScienceExperimentRaw
                {
                    PartId = "101", PartName = "Geiger Counter",
                    ExperimentId = "radiationScan", Title = "Radiation Scan",
                    Issue = "no storage", RunningState = "Running", ExpStatus = "Issue",
                    DataRate = 0.002, ProdFactor = 0.5,
                    TakesSample = false, RemainingSampleMass = null,
                },
                new ScienceExperimentRaw
                {
                    PartId = "102", PartName = "Mystery Goo Containment Pod",
                    ExperimentId = "mysteryGoo", Title = "Mystery Goo Observation",
                    Issue = "", RunningState = "Running", ExpStatus = "Running",
                    DataRate = 0.0005, ProdFactor = 1.0,
                    TakesSample = true, RemainingSampleMass = 0.0,
                },
            },
            Stored =
            {
                new ScienceStoredRaw
                {
                    PartId = "200", PartName = "Hard Drive",
                    SubjectId = "radiationScan@KerbinInSpaceLow",
                    ExperimentId = "radiationScan", Title = "Radiation Scan",
                    Situation = "Space", Biome = "",
                    Kind = "file", SizeMB = 12.5,
                    SciencePerMB = 1.6, ScienceMaxValue = 40.0,
                    ScienceRemainingTotal = 30.0, PercentCollectedTotal = 0.25,
                    ScienceCollectedInFlight = 6.5, TimesCompleted = 1,
                    TransmitRate = 0.004, Transmitting = true,
                    DriveCapacityMB = 512.0, DriveUsedMB = 20.0,
                    SampleSlotsTotal = 2, SampleSlotsUsed = 1,
                },
                new ScienceStoredRaw
                {
                    PartId = "200", PartName = "Hard Drive",
                    SubjectId = "mysteryGoo@KerbinSrfLandedLaunchPad",
                    ExperimentId = "mysteryGoo", Title = "Mystery Goo Observation",
                    Situation = "Surface", Biome = "LaunchPad",
                    Kind = "sample", SizeMB = 7.5, SampleMass = 0.0125, Analyze = true,
                    SciencePerMB = 0.8, ScienceMaxValue = 10.0,
                    ScienceRemainingTotal = 4.0, PercentCollectedTotal = 0.6,
                    ScienceCollectedInFlight = 0.0, TimesCompleted = 3,
                    TransmitRate = 0.0, Transmitting = false,
                    DriveCapacityMB = 512.0, DriveUsedMB = 20.0,
                    SampleSlotsTotal = 2, SampleSlotsUsed = 1,
                },
            },
            Labs =
            {
                new ScienceLabRaw
                {
                    PartId = "300", PartName = "Mobile Processing Lab MPL-LG-2",
                    AnalysisRate = 0.0008, EffectiveRate = 0.0012,
                    Status = "RUNNING", Running = true,
                },
            },
            Sensors =
            {
                new ScienceSensorRaw
                {
                    PartId = "400", PartName = "2HOT Thermometer",
                    Type = "temperature", Readout = "293.1 K", Active = true,
                },
            },
        };

        private static Meta FixedMeta() => new Meta
        {
            Source = "vessel-1",
            ValidAt = 120.5,
            Seq = 7,
            DeliveredAt = 122.75,
            Vantage = "KSC",
            Quality = Quality.OnRails,
            Active = true,
            Staleness = Staleness.Fresh,
            TimelineEpoch = 0,
        };

        private static string Write(string topic, object? payload) =>
            EnvelopeCodec.WriteStreamData(new StreamData<object?>
            {
                Topic = topic,
                Payload = payload,
                Meta = FixedMeta(),
            });

        /// <summary>
        /// End to end, server side: the provider's own map fills
        /// <c>extensions["kerbalism"]</c> on a shared science payload and the real
        /// codec writes it, namespaced, with the megabyte figure intact. The client
        /// half of the same fixture is <c>science.test.ts</c>.
        /// </summary>
        [Fact]
        public void TheProvidersNamespaceReachesTheWireThroughTheRealCodec()
        {
            var json = Write("science.experiments", KerbalismScienceMap.Experiments(Raw()));

            Assert.Contains("\"extensions\":{\"kerbalism\":{", json);
            // 12.5 is the FILE's size, not the sample's 7.5 and not the drive's 20
            // used: a map that reached for the wrong blob would fail here.
            Assert.Contains("\"dataSizeMB\":12.5", json);
            Assert.Contains("\"kind\":\"file\"", json);
            Assert.Contains("\"kind\":\"sample\"", json);
            Assert.Contains("\"storageCapacityMB\":512", json);
        }

        /// <summary>
        /// The committed fixture IS what the real codec produces. This is what makes
        /// the client-side test non-vacuous: it reads a file this test proves came
        /// out of the server, not a hand-authored approximation of one.
        /// </summary>
        [Fact]
        public void TheCommittedFixtureIsExactlyWhatTheCodecProduces()
        {
            Assert.Equal(
                FixtureWire("experiments-kerbalism"),
                Write("science.experiments", KerbalismScienceMap.Experiments(Raw())));
            Assert.Equal(
                FixtureWire("instruments-kerbalism"),
                Write("science.instruments", KerbalismScienceMap.Instruments(Raw())));
            Assert.Equal(
                FixtureWire("lab-kerbalism"),
                Write("science.lab", KerbalismScienceMap.Lab(Raw())));
            Assert.Equal(
                FixtureWire("breakdown-kerbalism"),
                Write("science.experimentBreakdown", KerbalismScienceMap.ExperimentBreakdown(Raw())));
        }

        /// <summary>
        /// Every value-bearing payload is TAGGED, and tagged the same way. Untagged,
        /// a widget would read Kerbalism's linear-per-megabyte numbers as stock's
        /// R&amp;D-curve ones, which is the exact silent-misread the tag exists to
        /// stop.
        /// </summary>
        [Fact]
        public void EveryValueBearingPayloadCarriesTheProvidersValueModelTag()
        {
            var raw = Raw();

            Assert.Contains("\"valueModel\":\"kerbalism-linear\"", Write("science.experiments", KerbalismScienceMap.Experiments(raw)));
            Assert.Contains("\"valueModel\":\"kerbalism-linear\"", Write("science.lab", KerbalismScienceMap.Lab(raw)));
            Assert.Contains("\"valueModel\":\"kerbalism-linear\"", Write("science.experimentBreakdown", KerbalismScienceMap.ExperimentBreakdown(raw)));
            Assert.NotEqual(ScienceValueModels.Stock, KerbalismScienceMap.ValueModel);
        }

        /// <summary>
        /// The unit-mismatched core fields are NULL on the wire, not filled with a
        /// megabyte figure wearing a mits label. This is the whole reason the bag
        /// exists on these payloads rather than the numbers being crammed into the
        /// shared fields, so it is asserted as bytes rather than described in a doc
        /// comment.
        /// </summary>
        [Fact]
        public void CoreFieldsKerbalismCannotHonestlyFillAreNull()
        {
            var experiments = Write("science.experiments", KerbalismScienceMap.Experiments(Raw()));
            // dataAmount is mits-typed; Kerbalism's figure is megabytes and rides
            // the bag. baseTransmitValue/transmitBonus are the placeholders
            // Kerbalism's own stock bridge hardcodes; sciencePerMB is the real one.
            Assert.Contains("\"dataAmount\":null", experiments);
            Assert.Contains("\"baseTransmitValue\":null,\"transmitBonus\":null", experiments);
            Assert.Contains("\"sciencePerMB\":1.6", experiments);

            var lab = Write("science.lab", KerbalismScienceMap.Lab(Raw()));
            // A Kerbalism lab analyses samples into files; it produces no science, so
            // a science-per-day rate would be a fiction, and a scientist headcount is
            // not exposed at all (the crew bonus is baked into the rate).
            Assert.Contains("\"scienceRate\":null", lab);
            Assert.Contains("\"storedScience\":null", lab);
            Assert.Contains("\"scientistCount\":null", lab);
            Assert.Contains("\"effectiveRateMBps\":0.0012", lab);
        }

        /// <summary>
        /// <c>science.sensors</c> is the one science payload with NO namespace: a
        /// live readout maps cleanly between the two models, so the entry is
        /// byte-identical in shape to a stock one and carries no bag at all. Stated
        /// as an assertion because "we added a bag to every payload" would have been
        /// the lazy, wrong answer.
        /// </summary>
        [Fact]
        public void SensorsCarryNoNamespaceBecauseTheyNeedNone()
        {
            var json = Write("science.sensors", KerbalismScienceMap.Sensors(Raw()));

            Assert.DoesNotContain("extensions", json);
            Assert.Contains("\"type\":\"temperature\",\"readout\":\"293.1 K\",\"active\":true", json);
        }

        /// <summary>
        /// Nothing to say is said by ABSENCE, at the source: with
        /// <c>Features.Science</c> off, every read is null, which leaves the channels
        /// unborn and silent. An empty list would instead publish "this vessel has no
        /// science" on a vessel Kerbalism simply is not simulating.
        /// </summary>
        [Fact]
        public void AnUnmodeledVesselYieldsNullNotAnEmptyList()
        {
            var raw = new ScienceRaw { Modeled = false };

            Assert.Null(KerbalismScienceMap.Experiments(raw));
            Assert.Null(KerbalismScienceMap.Instruments(raw));
            Assert.Null(KerbalismScienceMap.Sensors(raw));
            Assert.Null(KerbalismScienceMap.Lab(raw));
            Assert.Null(KerbalismScienceMap.ExperimentBreakdown(raw));
        }

        /// <summary>
        /// Kerbalism's four-state machine projected onto stock's two bools, both
        /// directions of the interesting case: an experiment with an ISSUE is not
        /// "deployed" even though its state says Running, and a depleted-sample
        /// experiment is "inoperable" the way a spent stock experiment is. The
        /// unprojected truth is in the namespace alongside.
        /// </summary>
        [Fact]
        public void TheStateMachineProjectsOntoStocksTwoBoolsAndKeepsTheTruthInTheBag()
        {
            var json = Write("science.instruments", KerbalismScienceMap.Instruments(Raw()));

            // Entry 1: Running but blocked -> not producing, and the reason survives.
            Assert.Contains("\"deployed\":false", json);
            Assert.Contains("\"issue\":\"no storage\"", json);
            Assert.Contains("\"expStatus\":\"Issue\"", json);
            // Entry 2: running cleanly, but its finite sample is spent.
            Assert.Contains("\"deployed\":true", json);
            Assert.Contains("\"inoperable\":true", json);
            Assert.Contains("\"remainingSampleMass\":0", json);
            // Kerbalism results never sit in the instrument, so nothing is
            // collectable FROM one: false, not null, because that IS a known fact.
            Assert.Contains("\"dataIsCollectable\":false", json);
        }

        /// <summary>
        /// The rollup collapses per-subject the way stock's does, one row per
        /// DISTINCT subject: two stored blobs of the same subject must not become two
        /// rows. Here the two blobs differ by subject, so two rows are correct, and a
        /// third blob repeating the first subject changes nothing but the count.
        /// </summary>
        [Fact]
        public void TheBreakdownIsOneRowPerDistinctSubject()
        {
            var raw = Raw();
            var repeat = new ScienceStoredRaw
            {
                PartId = "201", PartName = "Hard Drive",
                SubjectId = "radiationScan@KerbinInSpaceLow",
                ExperimentId = "radiationScan", Title = "Radiation Scan",
                Kind = "file", SizeMB = 2.5,
                ScienceRemainingTotal = 30.0, PercentCollectedTotal = 0.25,
                TimesCompleted = 1,
            };
            raw.Stored.Add(repeat);

            var rows = KerbalismScienceMap.ExperimentBreakdown(raw);

            Assert.NotNull(rows);
            Assert.Equal(2, rows!.Count);
        }
    }
}
