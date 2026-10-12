using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A facility at its top tier has no upgrade to price. Stock's <c>GetUpgradeCost</c>
    /// answers 0 there, which a client would show as a free upgrade, so the cost is null.
    ///
    /// <para>Source text, not behaviour: the facility capture reads live components and
    /// cannot be compiled into this project. The ladder's own null at the top is
    /// <c>FacilityLadder.NextTierCost</c>.</para>
    /// </summary>
    public class TopTierHasNoUpgradeCostTests
    {
        private static readonly string Source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");

        [Fact]
        public void a_live_facility_at_its_top_tier_has_no_cost()
        {
            Assert.Contains(
                "[\"upgradeCost\"] = live.FacilityLevel >= live.MaxLevel ? null : (double?)live.GetUpgradeCost(),",
                Source,
                StringComparison.Ordinal);
        }

        [Fact]
        public void an_off_scene_facility_never_invents_a_cost()
        {
            var body = CurrencyDelaySourceText.MethodBody(Source, "private static Dictionary<string, object?>? OffSceneFacilityEntry(");

            Assert.DoesNotContain("NextTierCost(rungs, tier) ?? 0f", body, StringComparison.Ordinal);
            Assert.Contains("[\"upgradeCost\"] = raw.HasValue ? raw.Value * multiplier : (double?)null,", body, StringComparison.Ordinal);
        }
    }
}
