using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Unit tests for <see cref="StubNetwork.SetDefaultDelay"/>: the host-driven
    /// whole-network delay used by the ledger migration (Plan 1). Cross-language
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
        public void SetDefaultDelayClampsNegativeAndNonFiniteToZero()
        {
            var network = new StubNetwork(delay: 100);

            network.SetDefaultDelay(-5.0);
            Assert.Equal(0.0, network.DelayTo("KSC", "system"));

            network.SetDefaultDelay(double.NaN);
            Assert.Equal(0.0, network.DelayTo("KSC", "system"));

            network.SetDefaultDelay(double.PositiveInfinity);
            Assert.Equal(0.0, network.DelayTo("KSC", "system"));
        }
    }
}
