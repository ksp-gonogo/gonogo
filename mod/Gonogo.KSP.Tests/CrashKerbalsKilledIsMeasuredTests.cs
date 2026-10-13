using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The kerbals-killed figure on a crash's flight statistics is a count of what the
    /// game reported, so the crash uplink has to listen for the game's crew-killed event.
    ///
    /// <para>Source text, not behaviour: the uplink reads live KSP and cannot be compiled
    /// into this project. The count itself is tested in <c>FlightStatsTrackerTests</c>.</para>
    /// </summary>
    public class CrashKerbalsKilledIsMeasuredTests
    {
        [Fact]
        public void the_crew_killed_event_feeds_the_tracker()
        {
            var source = CurrencyDelaySourceText.ReadRelative("CrashUplink.cs");

            Assert.Contains("GameEvents.onCrewKilled.Add(OnCrewKilled);", source, StringComparison.Ordinal);
            var body = CurrencyDelaySourceText.MethodBody(source, "private void OnCrewKilled(EventReport report)");
            Assert.Contains("_tracker.RecordKerbalsKilled(", body, StringComparison.Ordinal);
        }
    }
}
