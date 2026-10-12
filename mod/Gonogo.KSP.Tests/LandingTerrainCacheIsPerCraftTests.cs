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
        [InlineData("private static void SampleSiteGrid(", "siteGridVessel", "siteGridBody", "siteGridHeights = null;")]
        [InlineData("private static void SampleHorizon(", "horizonVessel", "horizonBody", "horizonAngles = null;")]
        public void a_cache_from_another_craft_or_body_is_dropped(string method, string vesselField, string bodyField, string drop)
        {
            var body = CurrencyDelaySourceText.MethodBody(Source, method);

            Assert.Contains("if (vessel.id != " + vesselField + " || !ReferenceEquals(body, " + bodyField + "))", body, StringComparison.Ordinal);
            Assert.Contains(drop, body, StringComparison.Ordinal);
            Assert.Contains(vesselField + " = vessel.id;", body, StringComparison.Ordinal);
            Assert.Contains(bodyField + " = body;", body, StringComparison.Ordinal);
        }
    }
}
