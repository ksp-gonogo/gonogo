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
        /// A vessel with a broken part, a part due maintenance, and a third that is
        /// merely worn: enough that all three rollup fields differ from each other,
        /// so none of them can pass by coincidence.
        /// </summary>
        private static ReliabilityRaw Raw() => new()
        {
            Malfunction = true,
            Critical = false,
            Parts =
            {
                new ReliabilityPartRaw
                {
                    PartId = "part-1", Title = "LV-909 Terrier", Group = "engine",
                    Broken = true, Critical = false, Mtbf = 940.5,
                    IgnitionsConsumed = 0.75, DurationConsumed = 0.5, NeedsRepair = true,
                },
                new ReliabilityPartRaw
                {
                    PartId = "part-2", Title = "Z-400 Battery", Group = "electrical",
                    Broken = false, Critical = false, Mtbf = 12_000,
                    IgnitionsConsumed = 0, DurationConsumed = 0.125, NeedsRepair = true,
                },
                new ReliabilityPartRaw
                {
                    PartId = "part-3", Title = "Communotron 16", Group = "antenna",
                    Broken = false, Critical = false, Mtbf = 3_600,
                    IgnitionsConsumed = 0, DurationConsumed = 0.25, NeedsRepair = false,
                },
            },
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
            var json = WriteSummary(KerbalismReliabilityMap.Summary(Raw(), modeled: true));

            Assert.Contains("\"extensions\":{\"kerbalism\":{", json);
            // 940.5 is part-1's MTBF: the SHORTEST of the three, not the first and
            // not the last, so a rollup that returned either would fail here.
            Assert.Contains("\"worstMtbfHours\":940.5", json);
            Assert.Contains("\"brokenPartCount\":1", json);
            Assert.Contains("\"maintenanceDueCount\":2", json);
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
            var actual = WriteSummary(KerbalismReliabilityMap.Summary(Raw(), modeled: true));

            Assert.Equal(expected, actual);
        }

        /// <summary>
        /// The additive claim, stated as bytes: a payload no provider extended is
        /// EXACTLY what it was before the mechanism existed. The bag is omitted
        /// rather than written as null, so a subscriber cannot tell the mechanism
        /// landed, and the five hand-curated summary fields are untouched.
        ///
        /// <para>The expected string is written out in full on purpose. A comparison
        /// built by stripping the extensions segment out of the other payload would
        /// pass even if both had drifted together.</para>
        /// </summary>
        [Fact]
        public void AnUnextendedPayloadIsByteIdenticalToTheOldWireShape()
        {
            var json = WriteSummary(new ReliabilitySummary
            {
                Unmodeled = false,
                Malfunction = true,
                Critical = false,
                Source = "kerbalism",
                WorstReliabilityFraction = null,
            });

            Assert.Equal(
                "{\"type\":\"stream-data\",\"topic\":\"reliability.summary\"," +
                "\"payload\":{\"unmodeled\":false,\"malfunction\":true,\"critical\":false," +
                "\"source\":\"kerbalism\",\"worstReliabilityFraction\":null}," +
                "\"meta\":{\"source\":\"vessel-1\",\"validAt\":120.5,\"seq\":7,\"deliveredAt\":122.75," +
                "\"vantage\":\"KSC\",\"quality\":0,\"active\":true,\"staleness\":0,\"timelineEpoch\":0}}",
                json);
            Assert.DoesNotContain("extensions", json);
        }

        /// <summary>
        /// The hand-curated fields are byte-identical WITH the bag present too: the
        /// extension is appended, it does not reorder or restate anything. Together
        /// with the test above this is the whole "breaks nothing" claim, on both
        /// sides of the only thing that changed.
        /// </summary>
        [Fact]
        public void TheHandCuratedFieldsAreUnchangedWhenAnExtensionIsPresent()
        {
            var json = WriteSummary(KerbalismReliabilityMap.Summary(Raw(), modeled: true));

            Assert.Contains(
                "\"payload\":{\"unmodeled\":false,\"malfunction\":true,\"critical\":false," +
                "\"source\":\"kerbalism\",\"worstReliabilityFraction\":null,\"extensions\":",
                json);
        }

        /// <summary>
        /// A per-part bag rides the OTHER elected payload through the same writer.
        /// Nothing fills it today (every field Kerbalism's per-part ReliabilityInfo
        /// exposes is already in the core superset), so this is what stops the
        /// second half of the core change from being an untested declaration: the
        /// mechanism is there for the first provider that needs it, per-part, with
        /// no further core edit.
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
                        PartId = "part-1",
                        Broken = true,
                        Extensions = new Dictionary<string, object?>
                        {
                            ["someprovider"] = new Dictionary<string, object?> { ["depth"] = 3.5 },
                        },
                    },
                },
                Meta = FixedMeta(),
            });

            Assert.Contains("\"needsRepair\":null,\"extensions\":{\"someprovider\":{\"depth\":3.5}}", json);
        }

        /// <summary>
        /// Nothing to say is said by ABSENCE, at the source. Unmodeled (RO, where
        /// TestFlight outranks this backend) has no per-part list to roll up, and an
        /// empty namespace would read in a widget as "Kerbalism reports zero broken
        /// parts" rather than "Kerbalism is not modelling this".
        /// </summary>
        [Fact]
        public void AnUnmodeledSummaryCarriesNoNamespaceAtAll()
        {
            var json = WriteSummary(KerbalismReliabilityMap.Summary(Raw(), modeled: false));

            Assert.DoesNotContain("extensions", json);
            Assert.Contains("\"unmodeled\":true", json);
        }
    }
}
