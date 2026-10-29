using Gonogo.DevTools;
using Xunit;

namespace Gonogo.KSP.Tests.DevTools
{
    /// <summary>
    /// A warp request is judged by the rate changes the game made after it:
    /// reaching the rung and then being lowered is told apart from never
    /// reaching it, and the lowering carries when and why.
    /// </summary>
    public sealed class WarpTraceTests
    {
        [Fact]
        public void ARungReachedAndStillHeldIsOk()
        {
            var trace = new WarpTrace(7);
            trace.Record(0.1, 7, 100000f, null);

            var verdict = trace.Verdict(finalIndex: 7);

            Assert.True(verdict.Ok);
            Assert.Equal("held the requested rung", verdict.Message);
        }

        [Fact]
        public void ARungReachedThenLoweredSaysWhenAndWhy()
        {
            var trace = new WarpTrace(7);
            trace.Record(0.1, 7, 100000f, null);
            trace.Record(2.2, 0, 1f, "NOT_UNDER_ACCELERATION");

            var verdict = trace.Verdict(finalIndex: 0);

            Assert.False(verdict.Ok);
            Assert.Equal(
                "reached 7, held it 2.1s, then the game lowered it to 0 at 2.2s: the vessel is under acceleration",
                verdict.Message);
        }

        [Fact]
        public void ARungNeverReachedNamesTheLimitTheGameGave()
        {
            var trace = new WarpTrace(7);
            trace.Record(0.1, 5, 1000f, "NOT_WHILE_ABOUT_TO_CRASH");

            var verdict = trace.Verdict(finalIndex: 5);

            Assert.False(verdict.Ok);
            Assert.Equal(
                "never reached 7: the game ran at most 5, now 5: the altitude limit for that rung",
                verdict.Message);
        }

        [Fact]
        public void ALoweringWithNoReasonSaysSo()
        {
            var trace = new WarpTrace(7);
            trace.Record(0.1, 7, 100000f, null);
            trace.Record(2.0, 3, 50f, null);

            Assert.EndsWith(
                ", lowered by something other than the game's own limits (for example another mod)",
                trace.Verdict(finalIndex: 3).Message);
        }

        [Fact]
        public void ALoweringWithNoReasonReportsTheChargeAtRequestAndAtDrop()
        {
            var trace = new WarpTrace(7) { AtRequest = new WarpTrace.CraftState(700000, 600000, 530, 1000) };
            trace.Record(0.1, 7, 100000f, null);
            trace.Record(0.4, 0, 1f, null, new WarpTrace.CraftState(700000, 600000, 4.5, 1000));

            Assert.EndsWith(
                "; electric charge at request 530 of 1000, at drop 4.5 of 1000",
                trace.Verdict(finalIndex: 0).Message);
        }

        [Fact]
        public void AnAltitudeLimitNamesTheCraftAltitudeAndTheLimitOfTheRung()
        {
            var trace = new WarpTrace(7);
            trace.Record(0.1, 5, 1000f, "NOT_IN_ATMOSPHERE", new WarpTrace.CraftState(20000, 600000, null, null));

            Assert.Equal(
                "never reached 7: the game ran at most 5, now 5: the vessel is in or about to enter the atmosphere"
                + " (craft at 20000 m, limit for the requested rung 600000 m)",
                trace.Verdict(finalIndex: 5).Message);
        }

        [Fact]
        public void ADropWithNoRecordedChangeIsReportedAsUnexplained()
        {
            var trace = new WarpTrace(7);
            trace.Record(0.1, 7, 100000f, null);

            Assert.Equal(
                "reached 7 but the game now runs at 0 with no rate change recorded",
                trace.Verdict(finalIndex: 0).Message);
        }

        [Fact]
        public void TheDescriptionListsEveryChangeWithItsReason()
        {
            var trace = new WarpTrace(7);
            trace.Record(0.1, 7, 100000f, null);
            trace.Record(2.2, 0, 1f, "ORBIT_EVENT_IMMINENT");

            Assert.Equal("+0.1s 7 (100000x); +2.2s 0 (1x) ORBIT_EVENT_IMMINENT", trace.Describe());
        }
    }
}
