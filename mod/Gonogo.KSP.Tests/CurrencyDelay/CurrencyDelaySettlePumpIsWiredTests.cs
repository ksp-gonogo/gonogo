using System;
using Xunit;

namespace Gonogo.KSP.Tests.CurrencyDelay
{
    /// <summary>
    /// The stale-defer settle has to be driven by the passage of time, from the
    /// scenario's per-frame tick, and from nowhere else.
    ///
    /// <para><b>The defect this sits in.</b> A science or reputation change under
    /// a vessel-bearing reason that never gets a vessel is DEFERRED, and Deferred
    /// is the one outcome that deliberately leaves the shadow behind. Settling it
    /// is what catches the shadow back up. It shipped reachable only from inside
    /// the next <c>On*Changed</c> of the same currency, so a change nothing ever
    /// explained, and that nothing followed, stranded the shadow for the rest of
    /// the session: measured on the rig as science 38 -> 63 with the shadow
    /// still reading 38. Every later neutralise restores to that number.</para>
    ///
    /// <para><b>And why not from a change handler.</b> Settling resyncs the shadow
    /// to the live total, and inside <c>On*Changed</c> the live total has already
    /// moved to the change being classified. Settling there hands the shadow the
    /// POST-change total, so the very change that triggered the settle then
    /// resolves Away with a neutralise target equal to what the balance already
    /// holds: nothing is clawed back, a credit is enqueued anyway, and the reveal
    /// pays it a second time. The tick is the only moment no change is in flight.</para>
    ///
    /// <para><b>Source text, not behaviour</b>, and deliberately so. Every unit
    /// test of the settle can call it itself, which proves the settle works and
    /// says nothing about whether the shipped game ever reaches it - the exact
    /// blindness that let this ship. <c>CurrencyDelayScenario</c> and
    /// <c>StockCurrencyInterceptor</c> need a live scene and are not compiled into
    /// this project at all, so a text scan is the only instrument that can see
    /// them. Same discipline, and the same reason, as
    /// <c>Sitrep.Core.Tests.SeamIsWiredTests</c>.</para>
    /// </summary>
    public class CurrencyDelaySettlePumpIsWiredTests
    {
        [Fact]
        public void the_scenario_tick_pumps_the_stale_defer_settle()
        {
            var update = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.Read("CurrencyDelayScenario.cs"), "private void Update()");

            Assert.Contains("SettleStaleDefers", update, StringComparison.Ordinal);
        }

        [Fact]
        public void the_interceptor_settles_only_through_the_combined_pump()
        {
            var interceptor = CurrencyDelaySourceText.Read("StockCurrencyInterceptor.cs");

            Assert.Contains("SettleStaleDefers", interceptor, StringComparison.Ordinal);

            // The two per-currency settles take a live total. Called from a change
            // handler they are handed the post-change one, which is the double-credit
            // above; only the tick knows a settled total.
            Assert.DoesNotContain("SettleStaleScienceDefers", interceptor, StringComparison.Ordinal);
            Assert.DoesNotContain("SettleStaleReputationDefers", interceptor, StringComparison.Ordinal);
        }
    }
}
