using System;
using UnityEngine;

namespace Gonogo.KSP.CurrencyDelay
{
    // This file references Funding/ResearchAndDevelopment/Reputation/TransactionReasons types
    // that only resolve against the real KSP reference DLLs, so a worktree without KspManaged
    // configured cannot compile it standalone; it builds as part of Gonogo.KSP.csproj wherever
    // those DLLs are available, same treatment as StockCurrencyInterceptor.cs and KscLightTime.cs.
    // Which rows to replay, in what order, is delegated to RevealDecision.cs, which has no such
    // dependency and is unit-tested unconditionally.

    /// <summary>
    /// The shared reveal path for every delayed currency credit, stock interception and buffered
    /// science crediting alike: pops matured rows off the <see cref="PendingCreditLedger"/> and
    /// re-applies each via
    /// AddFunds/AddScience/AddReputation(BaseAmount) - the base amount, never whatever was
    /// neutralised at earn time, so the game re-clamps and (for reputation) re-normalises against
    /// the reveal-time balance, exactly as StockCurrencyDecision.BuildCredit's own doc comment
    /// requires.
    ///
    /// Every AddX call here runs under the same <see cref="CurrencyDelayGuard"/> instance
    /// StockCurrencyInterceptor's neutralise path uses (constructed once by their owner and passed
    /// to both). Without that shared guard, a reveal's AddX
    /// would look to the interceptor like a brand-new remote-origin change: it would neutralise the
    /// reveal right back into the ledger and it would never actually land - an infinite defer.
    /// </summary>
    public sealed class RevealApplier
    {
        private readonly PendingCreditLedger _ledger;
        private readonly VesselScienceAggregator _scienceAggregator;
        private readonly CurrencyDelayGuard _guard;

        public RevealApplier(PendingCreditLedger ledger, VesselScienceAggregator scienceAggregator, CurrencyDelayGuard guard)
        {
            _ledger = ledger ?? throw new ArgumentNullException(nameof(ledger));
            _scienceAggregator = scienceAggregator ?? throw new ArgumentNullException(nameof(scienceAggregator));
            _guard = guard ?? throw new ArgumentNullException(nameof(guard));
        }

        /// <summary>
        /// Flushes any vessel science window that has exceeded the aggregator's cadence with no new
        /// increment to trigger it inline - the case a vessel that stopped transmitting (or was
        /// recovered/destroyed) mid-window needs, so its final partial chunk still reaches the
        /// ledger instead of being stranded in the aggregator forever. Intended to be called once
        /// per tick, alongside <see cref="ApplyMatured"/>, from the owning ScenarioModule.
        /// </summary>
        public void DrainAggregator(double nowUt)
        {
            foreach (var chunk in _scienceAggregator.Drain(nowUt))
            {
                _ledger.Enqueue(ScienceChunkCredit.ToPendingCreditRow(chunk, "aggregator drain"));
            }
        }

        /// <summary>
        /// Pops every row whose RevealUt has passed and replays it onto the live balance. Safe to
        /// call every frame/tick regardless of warp rate - PendingCreditLedger.PopMatured already
        /// matures every eligible row in one call, not just the earliest, so a warp jump past
        /// several reveals at once is handled for free.
        /// </summary>
        public void ApplyMatured(double nowUt)
        {
            var matured = _ledger.PopMatured(nowUt);
            if (matured.Count == 0)
            {
                return;
            }

            foreach (var application in RevealDecision.Plan(matured))
            {
                try
                {
                    _guard.RunGuarded(() =>
                    {
                        var before = Balance(application.Currency);
                        Apply(application);
                        if (application.Row.LostSeq != 0 && before is double was && Balance(application.Currency) is double now)
                        {
                            _ledger.NoteApplied(application.Row, now - was);
                        }
                    });
                }
                catch (Exception ex)
                {
                    GonogoLog.Warn("currency", "RevealApplier.ApplyMatured failed for " + application.Currency + ": " + ex.Message);
                }
            }
        }

        /// <summary>
        /// Reverses what each change that landed on a Lost declaration actually did to its
        /// balance, now that the declaration is withdrawn. The amount reversed is the one the
        /// balance took when the change was replayed, not its base amount, so the game's clamp
        /// and reputation curve do not leave a remainder; the write sets the balance directly so
        /// that curve is not applied a second time.
        /// </summary>
        public void ApplyRefunds(System.Collections.Generic.IEnumerable<LandedOnLost> refunds)
        {
            foreach (var refund in refunds)
            {
                if (refund.AppliedDelta is not double applied || applied == 0.0)
                {
                    continue;
                }
                try
                {
                    _guard.RunGuarded(() => Reverse(refund.Currency, applied));
                }
                catch (Exception ex)
                {
                    GonogoLog.Warn("currency", "RevealApplier.ApplyRefunds failed for " + refund.Currency + ": " + ex.Message);
                }
            }
        }

        private static void Reverse(DelayedCurrency currency, double applied)
        {
            switch (currency)
            {
                case DelayedCurrency.Funds:
                    Funding.Instance?.AddFunds(-applied, TransactionReasons.None);
                    break;
                case DelayedCurrency.Reputation:
                    Reputation.Instance?.SetReputation(Reputation.CurrentRep - (float)applied, TransactionReasons.None);
                    break;
                case DelayedCurrency.Science:
                    ResearchAndDevelopment.Instance?.AddScience(-(float)applied, TransactionReasons.None);
                    break;
            }
        }

        private static double? Balance(DelayedCurrency currency)
        {
            switch (currency)
            {
                case DelayedCurrency.Funds:
                    return Funding.Instance?.Funds;
                case DelayedCurrency.Reputation:
                    return Reputation.Instance != null ? Reputation.CurrentRep : (double?)null;
                case DelayedCurrency.Science:
                    return ResearchAndDevelopment.Instance != null ? ResearchAndDevelopment.Instance.Science : (double?)null;
                default:
                    return null;
            }
        }

        private static void Apply(RevealApplication application)
        {
            switch (application.Currency)
            {
                case DelayedCurrency.Funds:
                    Funding.Instance?.AddFunds(application.BaseAmount, TransactionReasons.None);
                    break;
                case DelayedCurrency.Science:
                    ResearchAndDevelopment.Instance?.AddScience((float)application.BaseAmount, TransactionReasons.None);
                    break;
                case DelayedCurrency.Reputation:
                    Reputation.Instance?.AddReputation((float)application.BaseAmount, TransactionReasons.None);
                    break;
            }
        }
    }
}
