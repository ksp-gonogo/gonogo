using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// Stock raises <c>onCrash</c> and <c>onCrashSplashdown</c> once per part that breaks,
    /// so a craft that loses a landing leg and flies on raises them too. The crash and
    /// flight producers may only note them as the cause of a death; publishing a crash or
    /// ending a flight from them reports a living craft destroyed.
    ///
    /// <para>Source text, not behaviour: these uplinks read live KSP and cannot be compiled
    /// into this project. The pairing itself is tested in <c>VesselDeathsTests</c>.</para>
    /// </summary>
    public class CrashImpactIsNoDeathTests
    {
        [Theory]
        [InlineData("CrashUplink.cs")]
        [InlineData("FlightUplink.cs")]
        public void a_part_impact_is_only_noted(string file)
        {
            var source = CurrencyDelaySourceText.ReadRelative(file);

            Assert.Contains("private void OnCrash(EventReport report) => NoteImpact(", source, StringComparison.Ordinal);
            Assert.Contains("private void OnCrashSplashdown(EventReport report) => NoteImpact(", source, StringComparison.Ordinal);

            var note = CurrencyDelaySourceText.MethodBody(source, "private void NoteImpact(");
            Assert.Contains("_deaths.Impact(", note, StringComparison.Ordinal);
            Assert.DoesNotContain("Publish(", note, StringComparison.Ordinal);
            Assert.DoesNotContain("SignalEnd(", note, StringComparison.Ordinal);
            Assert.DoesNotContain("_deaths.Death(", note, StringComparison.Ordinal);
        }

        [Theory]
        [InlineData("CrashUplink.cs")]
        [InlineData("FlightUplink.cs")]
        public void only_the_vessel_dying_is_a_death(string file)
        {
            var source = CurrencyDelaySourceText.ReadRelative(file);
            var destroy = CurrencyDelaySourceText.MethodBody(source, "private void OnVesselWillDestroy(Vessel vessel)");

            Assert.Contains("_deaths.Death(", destroy, StringComparison.Ordinal);
        }
    }
}
