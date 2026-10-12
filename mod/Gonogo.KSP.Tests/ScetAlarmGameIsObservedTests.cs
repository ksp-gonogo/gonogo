using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// Alarms live for the process, and a later save's clock can stand anywhere relative
    /// to the one they were armed in, so the roster is told which game is loaded before
    /// the tick that would otherwise evaluate the previous game's alarms in it.
    ///
    /// <para>Source text, not behaviour: the uplink reads live KSP and cannot be compiled
    /// into this project. The roster's side is tested in <c>ScetAlarmRosterTests</c>.</para>
    /// </summary>
    public class ScetAlarmGameIsObservedTests
    {
        [Fact]
        public void the_game_is_observed_before_the_craft_and_the_tick()
        {
            var source = CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");
            var capture = CurrencyDelaySourceText.MethodBody(source, "private object? CaptureOnMain(KspSnapshot? snapshot)");

            var game = capture.IndexOf("_roster.ObserveGame(", StringComparison.Ordinal);
            var craft = capture.IndexOf("_roster.ObserveFlownCraft(", StringComparison.Ordinal);
            var tick = capture.IndexOf("_roster.BeginTick(", StringComparison.Ordinal);

            Assert.True(game >= 0, "CaptureOnMain never tells the roster which game is loaded");
            Assert.True(game < craft && game < tick, "the game must be observed before the craft and the tick");
            Assert.Contains("CommandDeliveryScenario.GameKey", capture, StringComparison.Ordinal);
        }
    }
}
