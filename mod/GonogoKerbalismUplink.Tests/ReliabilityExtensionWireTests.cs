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
    /// The SERVER half of the provider-extension proof: a provider fills its own
    /// namespace of a Kernel-elected payload's extension bag, and the REAL wire
    /// writer carries it.
    ///
    /// <para><b>Why the real codec and not an assertion on the map's output.</b>
    /// The mechanism's claim is about the WIRE, not about a dictionary: that a
    /// namespaced sub-tree core has never heard of survives serialisation, and that
    /// a payload nobody extended is unchanged. Asserting on
    /// <c>KerbalismReliabilityMap</c>'s return value would restate the producer and
    /// prove neither. So these go through
    /// <see cref="EnvelopeCodec.WriteStreamData"/>, the same call the courier
    /// makes.</para>
    ///
    /// <para><b>The fixture is the handoff to the client.</b> The JSON asserted here
    /// is committed as <c>mod/golden-fixtures/reliability-extensions.json</c> and
    /// read back by this Uplink's client test (<c>client/src/reliability.test.ts</c>),
    /// which drives it through the real decode path and asserts the typed narrow and
    /// the wrapped <c>Value</c>. Neither side can drift without one of the two going
    /// red: the same shared-JSON discipline <c>mod/golden-fixtures/README.md</c>
    /// describes, run in the C#-to-TS direction.</para>
    /// </summary>
    public class ReliabilityExtensionWireTests
    {
        private static readonly string FixturePath = Path.Combine(
            AppContext.BaseDirectory, "golden-fixtures", "reliability-extensions.json");

        /// <summary>
        /// The wire text of one named fixture vector. The frame is held as a JSON
        /// STRING inside the fixture rather than as an object, which is the shape
        /// every other file in <c>mod/golden-fixtures/</c> already uses: the point of
        /// this test is byte equality, and a nested object would be reformatted by
        /// the repo's JSON formatter the moment anyone ran the linter.
        /// </summary>
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
        /// A vessel with a broken part, two parts due service, and a third that is
        /// merely worn: enough that all three rollup fields differ from each other,
        /// so none of them can pass by coincidence.
        /// </summary>
        private static ReliabilityRaw Raw() => new()
        {
            Ut = 1_000_000,
            Parts =
            {
                new ReliabilityPartRaw
                {
                    PartId = "part-1", Title = "LV-909 Terrier", Group = "engine",
                    Broken = true, Critical = false, MtbfSeconds = 940.5, NeedsService = true,
                },
                new ReliabilityPartRaw
                {
                    PartId = "part-2", Title = "Z-400 Battery", Group = "electrical",
                    Broken = false, Critical = false, MtbfSeconds = 12_000, NeedsService = true,
                },
                new ReliabilityPartRaw
                {
                    PartId = "part-3", Title = "Communotron 16", Group = "antenna",
                    Broken = false, Critical = false, MtbfSeconds = 3_600, NeedsService = true,
                },
            },
        };

        /// <summary>The difficulty settings that ride the namespace, fixed so the fixture is deterministic.</summary>
        private static ReliabilityPreferencesRaw Prefs() => new()
        {
            MtbfFailures = true,
            CriticalChance = 0.25,
            SafeModeChance = 0.5,
            RequireRepairKits = true,
            IncentiveRedundancy = true,
        };

        private static Meta FixedMeta() => new()
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

        private static string WriteSummary(ReliabilitySummary summary) =>
            EnvelopeCodec.WriteStreamData(new StreamData<object?>
            {
                Topic = "reliability.summary",
                Payload = summary,
                Meta = FixedMeta(),
            });

        /// <summary>
        /// End to end, server side: the provider's own map fills
        /// <c>extensions["kerbalism"]</c> and the real codec writes it, namespaced,
        /// with the quantity intact. The client half of the same fixture is
        /// <c>reliability.test.ts</c>.
        /// </summary>
        [Fact]
        public void TheProvidersNamespaceReachesTheWireThroughTheRealCodec()
        {
            var json = WriteSummary(
                KerbalismReliabilityMap.Summary(Raw(), Prefs(), ReliabilityCoverage.Modeled));

            Assert.Contains("\"extensions\":{\"kerbalism\":{", json);
            // 940.5 is part-1's MTBF: the SHORTEST of the three, not the first and
            // not the last, so a rollup that returned either would fail here. The
            // key says SECONDS, which is what ReliabilityInfo.mtbf always was.
            Assert.Contains("\"worstMtbfSeconds\":940.5", json);
            Assert.Contains("\"brokenPartCount\":1", json);
            // Two, not three: the broken part is counted as broken, and Kerbalism
            // keeps needs-service (preventive) distinct from needs-repair (failed).
            Assert.Contains("\"serviceDuePartCount\":2", json);
        }

        /// <summary>
        /// The committed fixture IS what the real codec produces. This is what makes
        /// the client-side test non-vacuous: it reads a file this test proves came
        /// out of the server, not a hand-authored approximation of one.
        /// </summary>
        [Fact]
        public void TheCommittedFixtureIsExactlyWhatTheCodecProduces()
        {
            var expected = FixtureWire("summary-with-provider-namespace");
            var actual = WriteSummary(
                KerbalismReliabilityMap.Summary(Raw(), Prefs(), ReliabilityCoverage.Modeled));

            Assert.Equal(expected, actual);
        }

        /// <summary>
        /// The additive claim, stated as bytes: a payload no provider extended is
        /// EXACTLY the shared shape and nothing else. The bag is omitted rather than
        /// written as null, so a subscriber cannot tell the mechanism landed.
        ///
        /// <para>The expected string is written out in full on purpose. A comparison
        /// built by stripping the extensions segment out of the other payload would
        /// pass even if both had drifted together.</para>
        /// </summary>
        [Fact]
        public void AnUnextendedPayloadIsTheBareSharedShape()
        {
            var json = WriteSummary(new ReliabilitySummary
            {
                Source = "kerbalism",
                Coverage = ReliabilityCoverage.Modeled,
            });

            Assert.Equal(
                "{\"type\":\"stream-data\",\"topic\":\"reliability.summary\"," +
                "\"payload\":{\"source\":\"kerbalism\",\"coverage\":\"modeled\"}," +
                "\"meta\":{\"source\":\"vessel-1\",\"validAt\":120.5,\"seq\":7,\"deliveredAt\":122.75," +
                "\"vantage\":\"KSC\",\"quality\":0,\"active\":true,\"staleness\":0,\"timelineEpoch\":0}}",
                json);
            Assert.DoesNotContain("extensions", json);
        }

        /// <summary>
        /// The shared fields are byte-identical WITH the bag present too: the
        /// extension is appended, it does not reorder or restate anything. Together
        /// with the test above this is the whole "breaks nothing" claim, on both
        /// sides of the only thing that changed.
        /// </summary>
        [Fact]
        public void TheSharedFieldsAreUnchangedWhenAnExtensionIsPresent()
        {
            var json = WriteSummary(
                KerbalismReliabilityMap.Summary(Raw(), Prefs(), ReliabilityCoverage.Modeled));

            Assert.Contains(
                "\"payload\":{\"source\":\"kerbalism\",\"coverage\":\"modeled\",\"extensions\":",
                json);
        }

        /// <summary>
        /// A per-part bag rides the OTHER elected payload through the same writer,
        /// after the budget list, for a provider core has never heard of.
        /// </summary>
        [Fact]
        public void ThePerPartBagRidesTheWireToo()
        {
            var json = EnvelopeCodec.WriteStreamData(new StreamData<object?>
            {
                Topic = "reliability.parts",
                Payload = new List<ReliabilityPartEntry>
                {
                    new()
                    {
                        PartId = "part-1:0",
                        Condition = "failed",
                        Extensions = new Dictionary<string, object?>
                        {
                            ["someprovider"] = new Dictionary<string, object?> { ["depth"] = 3.5 },
                        },
                    },
                },
                Meta = FixedMeta(),
            });

            Assert.Contains("\"budgets\":null,\"extensions\":{\"someprovider\":{\"depth\":3.5}}", json);
        }

        /// <summary>
        /// A budget list reaches the wire as an ARRAY of objects, with an absent
        /// count pair written as null rather than omitted: the client thresholds on
        /// which pair is filled, so "no denominator" has to be visible.
        /// </summary>
        [Fact]
        public void ABudgetListRidesTheWireAsObjectsInOrder()
        {
            var json = EnvelopeCodec.WriteStreamData(new StreamData<object?>
            {
                Topic = "reliability.parts",
                Payload = KerbalismReliabilityMap.Parts(
                    new ReliabilityRaw
                    {
                        Ut = 1_000_000,
                        Parts =
                        {
                            new ReliabilityPartRaw
                            {
                                PartId = "part-1", Title = "Antenna",
                                MtbfSeconds = 1_000_000, LastInspection = 600_000,
                            },
                        },
                    },
                    ReliabilityCoverage.Modeled),
                Meta = FixedMeta(),
            });

            Assert.Contains(
                "\"budgets\":[{\"id\":\"service\",\"label\":\"service\",\"kind\":\"schedule\"," +
                "\"consumed\":0.8,\"usedSeconds\":400000,\"limitSeconds\":500000," +
                "\"usedCount\":null,\"limitCount\":null}]",
                json);
        }

        /// <summary>
        /// Nothing to say is said by ABSENCE, at the source. A backend that is not
        /// modelling has no per-part list to roll up, and an empty namespace would
        /// read in a widget as "Kerbalism reports zero broken parts" rather than
        /// "Kerbalism is not modelling this".
        /// </summary>
        [Fact]
        public void ANonModellingSummaryCarriesNoNamespaceAtAll()
        {
            var json = WriteSummary(
                KerbalismReliabilityMap.Summary(Raw(), Prefs(), ReliabilityCoverage.Disabled));

            Assert.DoesNotContain("extensions", json);
            Assert.Contains("\"coverage\":\"disabled\"", json);
        }
    }
}
