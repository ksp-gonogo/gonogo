using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>A node that no longer exists leaves nothing behind in the delay ledger.</summary>
    public class StubNetworkForgetNodeTests
    {
        [Fact]
        public void AForgottenNodeReadsAtTheDefaultsAgain()
        {
            var network = new StubNetwork(delay: 1.0);
            network.SetNodeDelay("craft", 40.0);
            network.SetDelay("KSC", "craft", 55.0);
            network.SetReachable("KSC", "craft", false);
            Assert.Equal(55.0, network.DelayTo("KSC", "craft"));

            network.ForgetNode("craft");

            Assert.Equal(1.0, network.DelayTo("KSC", "craft"));
            Assert.Equal(1.0, network.StampFor("craft").For("KSC"));
            Assert.True(network.Reachable("KSC", "craft"));
        }

        [Fact]
        public void ForgettingOneNodeLeavesTheOthersAlone()
        {
            var network = new StubNetwork(delay: 1.0);
            network.SetNodeDelay("a", 10.0);
            network.SetNodeDelay("b", 20.0);

            network.ForgetNode("a");

            Assert.Equal(20.0, network.DelayTo("KSC", "b"));
        }
    }
}
