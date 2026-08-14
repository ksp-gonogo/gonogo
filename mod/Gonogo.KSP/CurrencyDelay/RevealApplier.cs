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
    /// AddFunds/AddScience/AddReputation(BaseAmount) - the BASE amount, never whatever was
    /// neutralised at earn time, so the game re-clamps and (for reputation) re-normalises against
    /// the reveal-time balance, exactly as StockCurrencyDecision.BuildCredit's own doc comment
    /// requires.
    ///
    /// Every AddX call here runs under the SAME <see cref="CurrencyDelayGuard"/> instance
    /// StockCurrencyInterceptor's neutralise path uses (constructed once by the owner - the future
    /// CurrencyDelayScenario - and passed to both). Without that shared guard, a reveal's AddX
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
                    _guard.RunGuarded(() => Apply(application));
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] RevealApplier.ApplyMatured failed for " + application.Currency + ": " + ex.Message);
                }
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
