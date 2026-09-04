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
        /// What the core uplink does to a vanilla summary when a provider WITHDREW
        /// from the capability: it was installed and switched off, so the vanilla
        /// backend's "nothing is installed" reading is false. Restated here rather
        /// than reached through the KSP-referencing uplink, exactly as the
        /// activation-failure case above is.
        /// </summary>
        private static ReliabilitySummary AfterWithdrawal(
            ReliabilitySummary summary, string providerId) =>
            ReliabilityWithdrawal.Apply(summary, new[]
            {
                new ResolutionNotice
                {
                    Capability = ReliabilityElection.CapabilityId,
                    Kind = "provider-declined",
                    ProviderId = providerId,
                },
            });

        /// <summary>
        /// Every reachable state, named, so a collapse fails with the pair that
        /// collapsed rather than with a count.
        /// </summary>
        private static Dictionary<string, ReliabilitySummary> States() => new()
        {
            ["stock, nothing installed"] = new NoneReliabilityBackend().Summary(),
            ["a selected provider's factory threw"] =
                AfterActivationFailure(new NoneReliabilityBackend().Summary()),
            // ONE state, reached two ways, and they MUST agree: Kerbalism withdrew
            // before the election (its CanServe saw the feature off at resolve
            // time), or it won and then reported "disabled" itself (the player
            // toggled the feature off mid-session, after resolution had run).
            // Same fact about the same install, so the same bytes; building it
            // through the real correction rather than as a literal is what makes
            // the agreement checkable.
            ["kerbalism installed, not modelling this save"] =
                AfterWithdrawal(new NoneReliabilityBackend().Summary(), "kerbalism"),
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
        /// The collapse this class exists to prevent, in the shape it actually
        /// shipped in: a provider withdrawing is the ONLY way an installed,
        /// switched-off modelling mod reaches the vanilla backend, and the vanilla
        /// backend's reading says the opposite of what is true.
        ///
        /// <para>The direction matters. "Nothing is installed that could model
        /// reliability" is heard as "nothing can be silently breaking"; the truth
        /// is that nothing is watching. An operator who reads the reassuring one
        /// off a save where they themselves turned the feature off has been told a
        /// confident wrong answer rather than an honest absence.</para>
        /// </summary>
        [Fact]
        public void AWithdrawnProviderIsNotTheSameWireFrameAsNothingInstalled()
        {
            var stock = Write(new NoneReliabilityBackend().Summary());
            var switchedOff = Write(
                AfterWithdrawal(new NoneReliabilityBackend().Summary(), "kerbalism"));

            Assert.NotEqual(stock, switchedOff);
            Assert.Contains("\"coverage\":\"none\"", stock);
            Assert.Contains("\"source\":\"none\"", stock);
            Assert.Contains("\"coverage\":\"disabled\"", switchedOff);
            Assert.Contains("\"source\":\"kerbalism\"", switchedOff);
        }

        /// <summary>
        /// The two routes to "Kerbalism is installed and not modelling" agree
        /// byte-for-byte, because they are the same fact about the same install.
        ///
        /// <para>Kerbalism withdraws when its CanServe sees the feature off at
        /// RESOLVE time; it wins and reports <c>disabled</c> itself when the player
        /// toggles the feature off afterwards, since CanServe is asked once per
        /// resolution and nothing re-runs it mid-session. An operator must not be
        /// able to tell from the wire which side of resolution they flipped the
        /// switch on: that is an implementation detail of ours, not a fact about
        /// their save.</para>
        /// </summary>
        [Fact]
        public void BothRoutesToKerbalismNotModellingProduceTheSameFrame()
        {
            var withdrewBeforeTheElection =
                Write(AfterWithdrawal(new NoneReliabilityBackend().Summary(), "kerbalism"));
            var wonThenReportedDisabled = Write(new ReliabilitySummary
            {
                Source = "kerbalism",
                Coverage = ReliabilityCoverage.Disabled,
            });

            Assert.Equal(wonThenReportedDisabled, withdrewBeforeTheElection);
        }

        /// <summary>
        /// A withdrawal on some OTHER capability must not be read as a reliability
        /// one. The notices list is capability-wide, so a filter that forgets to
        /// check <c>Capability</c> would report a switched-off comms provider as a
        /// switched-off reliability provider on a stock install.
        /// </summary>
        [Fact]
        public void AWithdrawalOnAnotherCapabilityLeavesTheVanillaReadingAlone()
        {
            var summary = ReliabilityWithdrawal.Apply(
                new NoneReliabilityBackend().Summary(),
                new[]
                {
                    new ResolutionNotice
                    {
                        Capability = "comms",
                        Kind = "provider-declined",
                        ProviderId = "some-comms-provider",
                    },
                });

            Assert.Equal(ReliabilityCoverage.None, summary.Coverage);
            Assert.Equal("none", summary.Source);
        }

        /// <summary>
        /// A provider SUPERSEDED by a higher-priority one is not a withdrawal:
        /// something did win, and it publishes its own reading. Only a decline
        /// leaves the capability with nobody modelling it.
        /// </summary>
        [Fact]
        public void ASupersededProviderIsNotAWithdrawal()
        {
            var summary = ReliabilityWithdrawal.Apply(
                new NoneReliabilityBackend().Summary(),
                new[]
                {
                    new ResolutionNotice
                    {
                        Capability = ReliabilityElection.CapabilityId,
                        Kind = "superseded",
                        ProviderId = "kerbalism",
                    },
                });

            Assert.Equal(ReliabilityCoverage.None, summary.Coverage);
        }

        /// <summary>
        /// A backend that actually won says what it is modelling, and a notice
        /// cannot overrule it. Kerbalism withdrawing while TestFlight wins is the
        /// ordinary RO install, and TestFlight's reading is the correct one.
        /// </summary>
        [Fact]
        public void AWinningBackendsOwnReadingSurvivesAWithdrawalNotice()
        {
            var summary = ReliabilityWithdrawal.Apply(
                new ReliabilitySummary
                {
                    Source = "testflight",
                    Coverage = ReliabilityCoverage.Modeled,
                },
                new[]
                {
                    new ResolutionNotice
                    {
                        Capability = ReliabilityElection.CapabilityId,
                        Kind = "provider-declined",
                        ProviderId = "kerbalism",
                    },
                });

            Assert.Equal(ReliabilityCoverage.Modeled, summary.Coverage);
            Assert.Equal("testflight", summary.Source);
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
