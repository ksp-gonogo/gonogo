using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Unit tests for <see cref="StubNetwork.SetDefaultDelay"/>: the host-driven
    /// whole-network delay used by the ledger migration. Cross-language
    /// parity against the TS reference is asserted separately by
    /// <see cref="StubNetworkGoldenFixtureTests"/> (the "set-default-delay-*"
    /// golden scenarios); this file locks the C#-side behaviour directly.
    /// </summary>
    public class StubNetworkDefaultDelayTests
    {
        [Fact]
        public void SetDefaultDelayChangesUnsetPairsButNotExplicitOverrides()
        {
            var network = new StubNetwork(delay: 0);
            network.SetDelay("meta", "system", 0.0); // explicit override stays 0

            network.SetDefaultDelay(240.0);

            // Any pair without an explicit SetDelay now returns the new default.
            Assert.Equal(240.0, network.DelayTo("KSC", "system"));
            Assert.Equal(240.0, network.DelayTo("any-connection-id", "system"));
            // The explicit meta override is unaffected by the default change.
            Assert.Equal(0.0, network.DelayTo("meta", "system"));
            // Scale still composes with the default.
            network.SetScale(0.5);
            Assert.Equal(120.0, network.DelayTo("KSC", "system"));
        }

        [Fact]
        public void SetNodeDelayIsPerNodeAcrossVantagesAndOverriddenByAnExplicitPair()
        {
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(10.0);
            network.SetNodeDelay("fleet.near", 2.0);
            network.SetNodeDelay("fleet.far", 6.0);

            // Node-default holds for ANY vantage (one KSC observer, many connections).
            Assert.Equal(2.0, network.DelayTo("KSC", "fleet.near"));
            Assert.Equal(2.0, network.DelayTo("other-connection", "fleet.near"));
            Assert.Equal(6.0, network.DelayTo("KSC", "fleet.far"));
            // A node with no node-default falls to the global default.
            Assert.Equal(10.0, network.DelayTo("KSC", "system"));

            // An explicit (vantage, node) pair overrides the node-default.
            network.SetDelay("KSC", "fleet.near", 99.0);
            Assert.Equal(99.0, network.DelayTo("KSC", "fleet.near"));
            Assert.Equal(2.0, network.DelayTo("other-connection", "fleet.near")); // other vantage still node-default

            // Scale composes with the node-default.
            network.SetScale(0.5);
            Assert.Equal(3.0, network.DelayTo("KSC", "fleet.far"));
        }

        [Fact]
        public void SetNodeDelayClampsNegativeAndNonFiniteToZero()
        {
            var network = new StubNetwork(delay: 100);
            network.SetNodeDelay("fleet.x", -3.0);
            Assert.Equal(0.0, network.DelayTo("KSC", "fleet.x"));
            network.SetNodeDelay("fleet.x", double.NaN);
            Assert.Equal(0.0, network.DelayTo("KSC", "fleet.x"));
        }

        [Fact]
        public void SetDefaultDelayClampsNegativeAndNonFiniteToZero()
        {
            var network = new StubNetwork(delay: 100);

            network.SetDefaultDelay(-5.0);
            Assert.Equal(0.0, network.DelayTo("KSC", "system"));

            network.SetDefaultDelay(double.NaN);
            Assert.Equal(0.0, network.DelayTo("KSC", "system"));

            network.SetDefaultDelay(double.NegativeInfinity);
            Assert.Equal(0.0, network.DelayTo("KSC", "system"));
        }

        [Fact]
        public void AnInfiniteDefaultIsUnknownRatherThanZero()
        {
            var network = new StubNetwork(delay: 100);

            network.SetDefaultDelay(double.PositiveInfinity);

            Assert.True(double.IsPositiveInfinity(network.DelayTo("KSC", "system")));
            Assert.True(double.IsPositiveInfinity(network.StampFor("system").For("KSC")));
            network.SetScale(0);
            Assert.True(double.IsPositiveInfinity(network.DelayTo("KSC", "system")));
        }

        [Fact]
        public void AVantageWithNoRowOfItsOwnIsUnknownOnceTheFallbackNamesWhoItAnswers()
        {
            var network = new StubNetwork(delay: double.PositiveInfinity);
            network.SetNodeDelay("fleet.G", 5.0);
            network.SetNodeDelay("system", 3.0);
            network.SetDelay("DSN", "system", 7.0);
            network.SetVantageDelay("meta", 0.0);

            network.SetFallbackVantages(new[] { "KSC", "" });

            Assert.Equal(5.0, network.DelayTo("KSC", "fleet.G"));
            Assert.Equal(3.0, network.DelayTo("", "system"));
            Assert.True(double.IsPositiveInfinity(network.DelayTo("DSN", "fleet.G")));
            Assert.Equal(7.0, network.DelayTo("DSN", "system"));
            Assert.Equal(0.0, network.DelayTo("meta", "fleet.G"));
            Assert.True(network.HasDelayFor("KSC", "fleet.G"));
            Assert.False(network.HasDelayFor("DSN", "fleet.G"));
            Assert.True(network.HasDelayFor("meta", "fleet.G"));
        }

        [Fact]
        public void AStampAgreesWithDelayToForEveryTierAndSurvivesASnapshotOfItsRows()
        {
            var network = new StubNetwork(delay: double.PositiveInfinity);
            network.SetNodeDelay("fleet.G", 5.0);
            network.SetDelay("DSN", "fleet.G", 9.0);
            network.SetVantageDelay("meta", 0.0);
            network.SetFallbackVantages(new[] { "KSC" });

            var stamp = network.StampFor("fleet.G");
            var copy = new DelayStamp(stamp.BaseSeconds, stamp.ByVantage());

            foreach (var vantage in new[] { "KSC", "DSN", "meta", "Stale" })
            {
                Assert.Equal(network.DelayTo(vantage, "fleet.G"), stamp.For(vantage));
                Assert.Equal(stamp.For(vantage), copy.For(vantage));
            }
        }

        [Fact]
        public void ClearDelayDropsOnlyThatPairBackToTheDefaults_AndRestampsTheNode()
        {
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(240.0);
            network.SetNodeDelay("fleet.G", 5.0);
            network.SetDelay("vessel:G", "system", 0.0);
            network.SetDelay("vessel:G", "fleet.G", 0.0);
            network.SetDelay("meta", "system", 0.0);
            Assert.Equal(0.0, network.StampFor("system").For("vessel:G"));

            network.ClearDelay("vessel:G", "system");
            network.ClearDelay("never-set", "system");

            Assert.Equal(240.0, network.DelayTo("vessel:G", "system"));
            Assert.Equal(240.0, network.StampFor("system").For("vessel:G"));
            Assert.Equal(0.0, network.DelayTo("vessel:G", "fleet.G"));
            Assert.Equal(0.0, network.DelayTo("meta", "system"));
        }
    }
}
