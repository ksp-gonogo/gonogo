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
    /// into this project. The count itself is tested in <c>CrashPayloadTests</c>.</para>
    /// </summary>
    public class CrashKerbalsKilledIsMeasuredTests
    {
        [Fact]
        public void the_crew_killed_event_feeds_the_tracker()
        {
            var source = CurrencyDelaySourceText.ReadRelative("CrashUplink.cs");

            Assert.Contains("GameEvents.onCrewKilled.Add(OnCrewKilled);", source, StringComparison.Ordinal);
            var body = CurrencyDelaySourceText.MethodBody(source, "private void OnCrewKilled(EventReport report)");
            Assert.Contains("_tracker.RecordKerbalKilled(", body, StringComparison.Ordinal);
        }

        [Fact]
        public void a_kill_after_the_crash_was_built_amends_and_republishes_it()
        {
            var source = CurrencyDelaySourceText.ReadRelative("CrashUplink.cs");

            var body = CurrencyDelaySourceText.MethodBody(source, "private void OnCrewKilled(EventReport report)");
            Assert.Contains("AmendRecentCrash(", body, StringComparison.Ordinal);
            var amend = CurrencyDelaySourceText.MethodBody(source, "private void AmendRecentCrash(string vesselId, string name)");
            Assert.Contains("capture.NoteKilled(", amend, StringComparison.Ordinal);
            Assert.Contains("PublishCrash(capture)", amend, StringComparison.Ordinal);
        }
    }
}
