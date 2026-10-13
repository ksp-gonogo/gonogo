using System.Linq;
using Gonogo.KSP.CurrencyDelay;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.CurrencyDelay
{
    /// <summary>
    /// What a credit already held at home does when the signal delay switch is
    /// flipped. The release time is fixed when the credit is taken in, from the
    /// choice in force then, so a flip never strands a held credit and never
    /// brings one forward; a credit taken in after the flip is released by the
    /// new choice, which can put it ahead of one taken in before.
    /// </summary>
    public class SignalDelayFlipHeldCreditTests
    {
        private static readonly SignalDelayConfig On = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };
        private static readonly SignalDelayConfig Off = new SignalDelayConfig { Enabled = false };

        private static PendingCreditRow Held(string origin, double eventUt, SignalDelayConfig choice)
        {
            var credit = StockCurrencyDecision.BuildCredit(
                CurrencyKind.Funds, 100, 0, origin, KscDelay.Routed(60), eventUt, choice)!.Value;
            return new PendingCreditRow(DelayedCurrency.Funds, credit.BaseAmount, credit.RevealUt, origin, credit.OriginDescription);
        }

        [Fact]
        public void ACreditHeldBeforeSwitchingDelayOffIsStillReleasedAtItsOriginalTime()
        {
            var ledger = new PendingCreditLedger();
            ledger.Enqueue(Held("before", eventUt: 0, On));

            // The switch is flipped off at UT 10: nothing re-times what is held.
            var afterFlip = ledger.PopMatured(10);

            Assert.Empty(afterFlip);
            var released = Assert.Single(ledger.PopMatured(60));
            Assert.Equal("before", released.OriginVesselId);
            Assert.Empty(ledger.Pending);
        }

        [Fact]
        public void ACreditTakenInAfterSwitchingDelayOffIsReleasedAtOnceAheadOfOneHeldBefore()
        {
            var ledger = new PendingCreditLedger();
            ledger.Enqueue(Held("before", eventUt: 0, On));
            ledger.Enqueue(Held("after", eventUt: 10, Off));

            var atTen = ledger.PopMatured(10);

            Assert.Equal(new[] { "after" }, atTen.ConvertAll(r => r.OriginVesselId));
            Assert.Equal(new[] { "before" }, ledger.Pending.Select(r => r.OriginVesselId));
        }

        [Fact]
        public void ACreditHeldWhileDelayWasOffIsNotHeldAtAllWhenSwitchedBackOn()
        {
            var ledger = new PendingCreditLedger();
            ledger.Enqueue(Held("whileOff", eventUt: 0, Off));

            Assert.Single(ledger.PopMatured(0));

            ledger.Enqueue(Held("afterOn", eventUt: 5, On));
            Assert.Empty(ledger.PopMatured(5));
            Assert.Single(ledger.PopMatured(65));
        }
    }
}
