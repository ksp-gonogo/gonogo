using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The stock ΔV simulation is off when the player has switched ΔV calculations off or
    /// a mod has replaced it. Reading <c>dv.stages</c> must not turn it back on, and must
    /// not ask it to recalculate on every sample while it works.
    ///
    /// <para>Source text, not behaviour: the read walks the live simulation and cannot be
    /// compiled into this project.</para>
    /// </summary>
    public class DeltaVSimIsLeftAsFoundTests
    {
        private static string Body() => CurrencyDelaySourceText.MethodBody(
            CurrencyDelaySourceText.ReadRelative("KspHost.cs"),
            "private static Dictionary<string, object?>? BuildDeltaV(Vessel vessel)");

        [Fact]
        public void a_switched_off_simulation_stays_off()
        {
            Assert.DoesNotContain("EnableStockSimluation", Body(), StringComparison.Ordinal);
        }

        [Fact]
        public void a_calculation_is_asked_for_once_per_craft()
        {
            Assert.Contains("if (dv.DoStockSimulation && vessel.id != _deltaVAskedFor)", Body(), StringComparison.Ordinal);
        }
    }
}
