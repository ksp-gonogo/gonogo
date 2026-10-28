using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// Pricing a saved craft with its modules loads every part of it, which is the longest
    /// frame a scan can make. Nothing is launched from a flight, so no craft is priced there,
    /// and a scan prices one at most.
    ///
    /// <para>Source text, not behaviour: the scan reads live KSP and cannot be compiled into
    /// this project.</para>
    /// </summary>
    public class CraftPricingWaitsOutTheFlightTests
    {
        private static readonly string Source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");

        [Fact]
        public void no_craft_is_priced_in_flight()
        {
            Assert.Contains("private static bool CanPriceNow => Funding.Instance != null && HighLogic.LoadedScene != GameScenes.FLIGHT;", Source, StringComparison.Ordinal);
            var apply = CurrencyDelaySourceText.MethodBody(Source, "private static void ApplyModulePrice(string file, long stamp, Dictionary<string, object?> entry, ref int budget)");
            Assert.True(
                apply.IndexOf("!CanPriceNow", StringComparison.Ordinal) >= 0
                    && apply.IndexOf("!CanPriceNow", StringComparison.Ordinal) < apply.IndexOf("CostWithModules", StringComparison.Ordinal),
                "the scene is checked before the craft is loaded");
        }

        [Fact]
        public void a_scan_prices_one_craft_at_most()
        {
            Assert.Contains("private const int ModulePricingsPerScan = 1;", Source, StringComparison.Ordinal);
        }
    }
}
