using System.Linq;
using Gonogo.KSP.CurrencyDelay;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.CurrencyDelay
{
    /// <summary>
    /// What credits held at home do when the signal delay is shortened or
    /// switched off: each is due that much sooner, they are revealed in the order
    /// they were taken in, and a delay that grows leaves them as they were.
    /// </summary>
    public class SignalDelayFlipHeldCreditTests
    {
        private static readonly SignalDelayConfig On = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

        private static PendingCreditRow Held(string origin, double eventUt, double delaySeconds, SignalDelayConfig choice)
        {
            var credit = StockCurrencyDecision.BuildCredit(
                CurrencyKind.Funds, 100, 0, origin, KscDelay.Routed(delaySeconds), eventUt, choice)!.Value;
            return new PendingCreditRow(DelayedCurrency.Funds, credit.BaseAmount, credit.RevealUt, origin, credit.OriginDescription);
        }

        [Fact]
        public void SwitchingDelayOffReleasesEveryHeldCreditInTheOrderTakenIn()
        {
            var ledger = new PendingCreditLedger();
            ledger.Enqueue(Held("far", eventUt: 0, delaySeconds: 600, On));
            ledger.Enqueue(Held("near", eventUt: 5, delaySeconds: 30, On));
            Assert.Empty(ledger.PopMatured(10));

            ledger.BringForward(10, 0.0);

            Assert.Equal(new[] { "far", "near" }, ledger.PopMatured(10).Select(r => r.OriginVesselId));
            Assert.Empty(ledger.Pending);
        }

        [Fact]
        public void ACreditTakenInAfterSwitchingDelayOffIsReleasedAtOnceBehindTheOnesHeldBefore()
        {
            var ledger = new PendingCreditLedger();
            ledger.Enqueue(Held("before", eventUt: 0, delaySeconds: 60, On));
            ledger.BringForward(10, 0.0);
            ledger.Enqueue(Held("after", eventUt: 10, delaySeconds: 60, new SignalDelayConfig { Enabled = false }));

            Assert.Equal(new[] { "before", "after" }, ledger.PopMatured(10).Select(r => r.OriginVesselId));
        }

        [Fact]
        public void RaisingLightSpeedShortensWhatIsLeftAndKeepsTheOrder()
        {
            var ledger = new PendingCreditLedger();
            ledger.Enqueue(Held("first", eventUt: 0, delaySeconds: 60, On));
            ledger.Enqueue(Held("second", eventUt: 10, delaySeconds: 60, On));

            // At 20 the light speed doubles: 40 left on the first becomes 20, 50 on the second becomes 25.
            ledger.BringForward(20, 0.5);

            Assert.Equal(40.0, ledger.Pending[0].RevealUt);
            Assert.Equal(45.0, ledger.Pending[1].RevealUt);
            Assert.Empty(ledger.PopMatured(39));
            Assert.Equal(new[] { "first" }, ledger.PopMatured(40).Select(r => r.OriginVesselId));
        }

        [Theory]
        [InlineData(1.0)]
        [InlineData(2.0)]
        public void ADelayThatGrowsLeavesHeldCreditsAsTheyWere(double factor)
        {
            var ledger = new PendingCreditLedger();
            ledger.Enqueue(Held("held", eventUt: 0, delaySeconds: 60, On));

            ledger.BringForward(20, factor);

            Assert.Equal(60.0, ledger.Pending[0].RevealUt);
        }

        [Fact]
        public void AnOpenScienceWindowRevealsWithTheShorterDelay()
        {
            var aggregator = new VesselScienceAggregator();
            aggregator.Accept("probe", 0.01, nowUt: 0, lightTimeSeconds: 60);

            aggregator.ScaleLightTimes(0.0);
            var chunk = Assert.Single(aggregator.Drain(VesselScienceAggregator.FlushCadenceSeconds));

            Assert.Equal(0.0, chunk.RevealUt);
        }
    }
}
