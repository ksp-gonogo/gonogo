using Xunit;

namespace Gonogo.KSP.Tests
{
    public class RecentCrashWindowTests
    {
        [Fact]
        public void a_crash_ahead_of_the_clock_after_a_load_within_its_span_is_abandoned()
        {
            Assert.True(RecentCrashWindow.Abandoned(crashUt: 1000.0, nowUt: 990.0));
            Assert.False(RecentCrashWindow.Expired(crashUt: 1000.0, nowUt: 990.0));
        }

        [Fact]
        public void a_crash_behind_the_clock_is_not_abandoned()
        {
            Assert.False(RecentCrashWindow.Abandoned(crashUt: 1000.0, nowUt: 1000.0));
            Assert.False(RecentCrashWindow.Abandoned(crashUt: 1000.0, nowUt: 1010.0));
        }

        [Fact]
        public void a_crash_older_than_its_span_has_expired()
        {
            Assert.True(RecentCrashWindow.Expired(crashUt: 1000.0, nowUt: 1031.0));
        }

        [Fact]
        public void the_crash_uplink_drops_and_never_republishes_an_abandoned_crash()
        {
            var source = CurrencyDelay.CurrencyDelaySourceText.ReadRelative("CrashUplink.cs");

            var debris = CurrencyDelay.CurrencyDelaySourceText.MethodBody(source, "private void NoteDebrisDeath(");
            Assert.Contains("RecentCrashWindow.Abandoned(capture.Ut,", debris, System.StringComparison.Ordinal);

            var publish = CurrencyDelay.CurrencyDelaySourceText.MethodBody(source, "private void PublishDeaths(");
            Assert.Contains("RecentCrashWindow.Abandoned(entry.Value.Ut, nowUt)", publish, System.StringComparison.Ordinal);
        }
    }
}
