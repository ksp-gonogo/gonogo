using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A recovery in a save that awards nothing must still reach the wire. Stock raises its
    /// post-recovery summary event with no dialog there, so both producers hook the event
    /// stock fires first and for every game mode. Read as source for the same reason
    /// <c>UplinkGameEventLifetimeTests</c> is: the handlers cannot be driven without a game.
    /// </summary>
    public class SandboxRecoveryIsWiredTests
    {
        [Theory]
        [InlineData("RecoveryUplink.cs")]
        [InlineData("FlightUplink.cs")]
        public void the_producer_hooks_the_recovery_that_every_game_mode_raises(string file)
        {
            var source = CurrencyDelaySourceText.ReadRelative(file);
            var hook = CurrencyDelaySourceText.MethodBody(source, "private void HookGameEvents()");

            Assert.Contains("GameEvents.onVesselRecovered.Add(", hook, StringComparison.Ordinal);
        }

        [Fact]
        public void the_flight_end_does_not_wait_on_the_summary_dialog()
        {
            var source = CurrencyDelaySourceText.ReadRelative("FlightUplink.cs");

            Assert.DoesNotContain("onVesselRecoveryProcessingComplete", source, StringComparison.Ordinal);
        }
    }
}
