using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Unit tests for <see cref="Journey"/>, <see cref="Hop"/> and
    /// <see cref="StubNetwork.JourneyTo"/>. Cross-language conformance for
    /// the scalar surface stays with <see cref="StubNetworkGoldenFixtureTests"/>;
    /// these lock the C#-only journey shape, which has no TS reference.
    /// </summary>
    public class StubNetworkJourneyTests
    {
        [Fact]
        public void JourneyTotalSecondsSumsItsHops()
        {
            var journey = new Journey(new[]
            {
                new Hop(2.0, distanceMeters: 100, touchesHome: true),
                new Hop(3.5),
                new Hop(0.5),
            });

            Assert.Equal(6.0, journey.TotalSeconds);
            Assert.Equal(3, journey.Hops.Count);
            Assert.Equal(100, journey.Hops[0].DistanceMeters);
            Assert.True(journey.Hops[0].TouchesHome);
        }

        [Fact]
        public void LegDefaultsGeometryAndHandlesWhenNotGiven()
        {
            var hop = new Hop(1.5);

            Assert.Equal(1.5, hop.Seconds);
            Assert.Equal(0, hop.DistanceMeters);
            Assert.False(hop.TouchesHome);
            Assert.Null(hop.FromHandle);
            Assert.Null(hop.ToHandle);
        }

        [Fact]
        public void LegCarriesItsOpaqueHandles()
        {
            var from = new object();
            var to = new object();
            var hop = new Hop(1.0, fromHandle: from, toHandle: to);

            Assert.True(ReferenceEquals(from, hop.FromHandle));
            Assert.True(ReferenceEquals(to, hop.ToHandle));
        }

        [Fact]
        public void JourneyToReturnsASingleLegForEveryScalarWrite()
        {
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(10.0);
            network.SetNodeDelay("fleet.near", 2.0);
            network.SetDelay("KSC", "fleet.near", 99.0);

            AssertSingleLeg(network.JourneyTo("KSC", "fleet.near"), 99.0);
            AssertSingleLeg(network.JourneyTo("other-connection", "fleet.near"), 2.0);
            AssertSingleLeg(network.JourneyTo("KSC", "system"), 10.0);
        }

        [Fact]
        public void JourneyToComposesWithScale()
        {
            var network = new StubNetwork(delay: 100);
            network.SetScale(0.5);

            AssertSingleLeg(network.JourneyTo("KSC", "system"), 50.0);
        }

        /// <summary>
        /// <see cref="StubNetwork.DelayTo"/> must return exactly what
        /// <see cref="StubNetwork.JourneyTo"/>'s total does, for every tier:
        /// the derivation this whole slice exists to prove.
        /// </summary>
        [Fact]
        public void DelayToIsExactlyJourneyToTotalSeconds()
        {
            var network = new StubNetwork(delay: 7);
            network.SetDefaultDelay(240.0);
            network.SetNodeDelay("fleet.G", 5.0);
            network.SetDelay("vessel:G", "system", 1.0);
            network.SetScale(0.25);

            foreach (var (vantage, node) in new[]
            {
                ("KSC", "system"),
                ("KSC", "fleet.G"),
                ("vessel:G", "system"),
                ("anywhere", "unset-node"),
            })
            {
                Assert.Equal(network.DelayTo(vantage, node), network.JourneyTo(vantage, node).TotalSeconds);
            }
        }

        private static void AssertSingleLeg(Journey journey, double expectedSeconds)
        {
            Assert.Single(journey.Hops);
            Assert.Equal(expectedSeconds, journey.Hops[0].Seconds);
            Assert.Equal(expectedSeconds, journey.TotalSeconds);
        }

        /// <summary>
        /// <see cref="StubNetwork.SetNodeJourney"/> is the writer a routed,
        /// multi-hop capture (the fleet vessel-home read) uses instead of the
        /// scalar-only <see cref="StubNetwork.SetNodeDelay"/>: the ledger
        /// hands its legs straight back, and stays in exact agreement with
        /// <see cref="StubNetwork.DelayTo"/> the same way every other tier
        /// does.
        /// </summary>
        [Fact]
        public void SetNodeJourneyMakesJourneyToReturnItsLegsVerbatim()
        {
            var network = new StubNetwork(delay: 0);
            var journey = new Journey(new[]
            {
                new Hop(1.0, distanceMeters: 100, touchesHome: false),
                new Hop(2.5, distanceMeters: 200, touchesHome: true),
            });

            network.SetNodeJourney("fleet.near", journey);

            var resolved = network.JourneyTo("KSC", "fleet.near");
            Assert.Equal(2, resolved.Hops.Count);
            Assert.Equal(3.5, resolved.TotalSeconds);
            Assert.Equal(network.DelayTo("KSC", "fleet.near"), resolved.TotalSeconds);
        }

        [Fact]
        public void SetNodeDelayAfterSetNodeJourneyRetiresTheJourney()
        {
            var network = new StubNetwork(delay: 0);
            network.SetNodeJourney("fleet.near", new Journey(new[] { new Hop(1.0), new Hop(2.0) }));

            network.SetNodeDelay("fleet.near", 9.0);

            var resolved = network.JourneyTo("KSC", "fleet.near");
            Assert.Single(resolved.Hops);
            Assert.Equal(9.0, resolved.TotalSeconds);
        }

        [Fact]
        public void ExplicitPairOutranksANodeJourney_ButOnlyForItsOwnVantage()
        {
            var network = new StubNetwork(delay: 0);
            network.SetNodeJourney("fleet.near", new Journey(new[] { new Hop(1.0), new Hop(2.0) }));
            network.SetDelay("KSC", "fleet.near", 42.0);

            Assert.Equal(42.0, network.JourneyTo("KSC", "fleet.near").TotalSeconds);
            Assert.Equal(3.0, network.JourneyTo("other-vantage", "fleet.near").TotalSeconds);
        }
    }
}
