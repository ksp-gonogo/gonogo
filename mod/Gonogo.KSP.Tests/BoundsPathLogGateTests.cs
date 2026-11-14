using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class BoundsPathLogGateTests
    {
        [Fact]
        public void TwoCraftScannedInTurnEachLogOnce()
        {
            var gate = new BoundsPathLogGate();

            Assert.True(gate.ShouldLog("aeris", 40));
            Assert.True(gate.ShouldLog("bowser", 12));
            for (var scan = 0; scan < 5; scan++)
            {
                Assert.False(gate.ShouldLog("aeris", 40));
                Assert.False(gate.ShouldLog("bowser", 12));
            }
        }

        [Fact]
        public void ACraftThatChangesItsPartCountLogsAgain()
        {
            var gate = new BoundsPathLogGate();
            Assert.True(gate.ShouldLog("aeris", 40));

            Assert.True(gate.ShouldLog("aeris", 38));
            Assert.False(gate.ShouldLog("aeris", 38));
        }
    }
}
