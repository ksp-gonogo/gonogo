using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host.Reliability;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// A SECOND, different KIND of instrument for the same claim, and the reason it
    /// exists is that the first kind is structurally blind to half of it.
    ///
    /// <para>The client-side matrix (<c>coverage-matrix.test.tsx</c>) renders every
    /// coverage state and asserts the rendered texts are pairwise distinct. It
    /// CANNOT see a producer that is only capable of emitting one of them: hand it a
    /// backend that always says the same thing and it will happily prove that one
    /// string renders one way. So this asserts distinctness at the other end, on the
    /// bytes the real <see cref="JsonWriter"/> produces, where "these two installs
    /// are different situations" either is or is not true of the wire.</para>
    ///
    /// <para>The pairing matters because the previous shape failed exactly here: a
    /// stock install and a Kerbalism install with the feature switched off put
    /// byte-identical payloads on the wire apart from one <c>source</c> string, and
    /// a provider whose factory threw was indistinguishable from a stock install in
    /// every field.</para>
    /// </summary>
    public class ReliabilityStateWireTests
    {
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

        private static string Write(ReliabilitySummary summary) =>
            EnvelopeCodec.WriteStreamData(new StreamData<object?>
            {
                Topic = "reliability.summary",
                Payload = summary,
                Meta = FixedMeta(),
            });

        /// <summary>
        /// What the core uplink does to a vanilla summary when the Kernel reported a
        /// <c>factory-failed</c> notice for this capability: the elected instance is
        /// the None backend and its "nothing is installed" reading is FALSE.
        /// Restated here rather than reached through the KSP-referencing uplink,
        /// which this headless project cannot compile.
        /// </summary>
        private static ReliabilitySummary AfterActivationFailure(ReliabilitySummary summary)
        {
            summary.Coverage = ReliabilityCoverage.Unavailable;
            return summary;
        }

        /// <summary>
        /// Every reachable state, named, so a collapse fails with the pair that
        /// collapsed rather than with a count.
        /// </summary>
        private static Dictionary<string, ReliabilitySummary> States() => new()
        {
            ["stock, nothing installed"] = new NoneReliabilityBackend().Summary(),
            ["a selected provider's factory threw"] =
                AfterActivationFailure(new NoneReliabilityBackend().Summary()),
            ["kerbalism, not modelling this save"] =
                new ReliabilitySummary { Source = "kerbalism", Coverage = ReliabilityCoverage.Disabled },
            ["kerbalism, cannot tell whether it is modelling"] =
                new ReliabilitySummary { Source = "kerbalism", Coverage = ReliabilityCoverage.Indeterminate },
            ["kerbalism, modelling"] =
                new ReliabilitySummary { Source = "kerbalism", Coverage = ReliabilityCoverage.Modeled },
            ["testflight, cannot read a part's condition"] =
                new ReliabilitySummary { Source = "testflight", Coverage = ReliabilityCoverage.Indeterminate },
            ["testflight, modelling"] =
                new ReliabilitySummary { Source = "testflight", Coverage = ReliabilityCoverage.Modeled },
            ["a backend read that threw this capture"] =
                new ReliabilitySummary { Source = "testflight", Coverage = ReliabilityCoverage.Unavailable },
        };

        [Fact]
        public void EveryReachableCoverageStateIsADifferentWireFrame()
        {
            var written = States().ToDictionary(entry => entry.Key, entry => Write(entry.Value));

            var collisions = written
                .GroupBy(entry => entry.Value)
                .Where(group => group.Count() > 1)
                .Select(group => string.Join(" == ", group.Select(entry => entry.Key)))
                .ToList();

            Assert.True(
                collisions.Count == 0,
                "Two reliability situations put the SAME bytes on the wire, so no client can " +
                "ever tell them apart:\n  " + string.Join("\n  ", collisions));
        }

        /// <summary>
        /// The specific collapse that shipped, called out by name rather than left
        /// to the sweep above: it is the one a reader is most likely to reintroduce
        /// by "simplifying" the vanilla backend, and the sweep would report it as an
        /// anonymous pair.
        /// </summary>
        [Fact]
        public void TheVanillaFallbackSaysWhetherItWasReachedByAFailure()
        {
            var stock = Write(new NoneReliabilityBackend().Summary());
            var threw = Write(AfterActivationFailure(new NoneReliabilityBackend().Summary()));

            Assert.NotEqual(stock, threw);
            Assert.Contains("\"coverage\":\"none\"", stock);
            Assert.Contains("\"coverage\":\"unavailable\"", threw);
        }

        /// <summary>
        /// The vanilla backend publishes an EMPTY list, never null: "no provider is
        /// watching" and "the watcher found no parts" are different answers, and the
        /// second is the one an empty array makes.
        /// </summary>
        [Fact]
        public void TheVanillaBackendPublishesAnEmptyPartListRatherThanNone()
        {
            var json = EnvelopeCodec.WriteStreamData(new StreamData<object?>
            {
                Topic = "reliability.parts",
                Payload = new List<ReliabilityPartEntry>(new NoneReliabilityBackend().Parts()),
                Meta = FixedMeta(),
            });

            Assert.Contains("\"payload\":[]", json);
        }
    }
}
