using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Unit tests for <see cref="Journey"/>, <see cref="Leg"/> and
    /// <see cref="StubNetwork.JourneyTo"/>. Cross-language conformance for
    /// the scalar surface stays with <see cref="StubNetworkGoldenFixtureTests"/>;
    /// these lock the C#-only journey shape, which has no TS reference.
    /// </summary>
    public class StubNetworkJourneyTests
    {
        [Fact]
        public void JourneyTotalSecondsSumsItsLegs()
        {
            var journey = new Journey(new[]
            {
                new Leg(2.0, distanceMeters: 100, touchesHome: true),
                new Leg(3.5),
                new Leg(0.5),
            });

            Assert.Equal(6.0, journey.TotalSeconds);
            Assert.Equal(3, journey.Legs.Count);
            Assert.Equal(100, journey.Legs[0].DistanceMeters);
            Assert.True(journey.Legs[0].TouchesHome);
        }

        [Fact]
        public void LegDefaultsGeometryAndHandlesWhenNotGiven()
        {
            var leg = new Leg(1.5);

            Assert.Equal(1.5, leg.Seconds);
            Assert.Equal(0, leg.DistanceMeters);
            Assert.False(leg.TouchesHome);
            Assert.Null(leg.FromHandle);
            Assert.Null(leg.ToHandle);
        }

        [Fact]
        public void LegCarriesItsOpaqueHandles()
        {
            var from = new object();
            var to = new object();
            var leg = new Leg(1.0, fromHandle: from, toHandle: to);

            Assert.True(ReferenceEquals(from, leg.FromHandle));
            Assert.True(ReferenceEquals(to, leg.ToHandle));
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
            Assert.Single(journey.Legs);
            Assert.Equal(expectedSeconds, journey.Legs[0].Seconds);
            Assert.Equal(expectedSeconds, journey.TotalSeconds);
        }
    }
}
