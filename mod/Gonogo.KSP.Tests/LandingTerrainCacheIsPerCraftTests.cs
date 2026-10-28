using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The landing site grid and the skyline are retaken at most once a second and sent
    /// again in between. A grid taken for one craft, or over one body, must never be sent
    /// for another.
    ///
    /// <para>Source text, not behaviour: both samples read live PQS terrain and cannot be
    /// compiled into this project.</para>
    /// </summary>
    public class LandingTerrainCacheIsPerCraftTests
    {
        private static readonly string Source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");

        [Theory]
        [InlineData("private static void SampleSiteGrid(", "siteGrid", "siteGridHeights = null;")]
        [InlineData("private static void SampleHorizon(", "horizon", "horizonAngles = null;")]
        public void a_cache_or_a_sweep_from_another_craft_or_body_is_dropped(string method, string prefix, string drop)
        {
            var body = CurrencyDelaySourceText.MethodBody(Source, method);

            Assert.Contains("if (vessel.id != " + prefix + "Vessel || !ReferenceEquals(body, " + prefix + "Body))", body, StringComparison.Ordinal);
            Assert.Contains(drop, body, StringComparison.Ordinal);
            Assert.Contains(
                "if (" + prefix + "Sweep != null && (vessel.id != " + prefix + "SweepVessel || !ReferenceEquals(body, " + prefix + "SweepBody)))",
                body,
                StringComparison.Ordinal);
            Assert.Contains(prefix + "Sweep = null;", body, StringComparison.Ordinal);

            // A sweep is started for the craft and body in hand, and the cache takes both from the sweep it finished.
            Assert.Contains(prefix + "SweepVessel = vessel.id;", body, StringComparison.Ordinal);
            Assert.Contains(prefix + "SweepBody = body;", body, StringComparison.Ordinal);
            Assert.Contains(prefix + "Vessel = " + prefix + "SweepVessel;", body, StringComparison.Ordinal);
            Assert.Contains(prefix + "Body = " + prefix + "SweepBody;", body, StringComparison.Ordinal);
        }

        [Theory]
        [InlineData("private static void SampleSiteGrid(", "siteGridSweep.Heights is { } heights", "siteGridHeights = heights;")]
        [InlineData("private static void SampleHorizon(", "horizonSweep.Angles is { } angles", "horizonAngles = angles;")]
        public void only_a_finished_sweep_is_sent(string method, string finished, string published)
        {
            var body = CurrencyDelaySourceText.MethodBody(Source, method);

            var gate = body.IndexOf(finished, StringComparison.Ordinal);
            Assert.True(gate >= 0 && body.IndexOf(published, StringComparison.Ordinal) > gate, "a sweep's values must be sent only once it has finished");
        }
    }
}
