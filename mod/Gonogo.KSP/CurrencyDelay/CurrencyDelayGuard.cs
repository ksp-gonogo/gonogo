using System;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// Marks a currency-balance write as "ours" so the stock On*Changed events it fires get
    /// recognised and skipped, whichever of StockCurrencyInterceptor's neutralise path or
    /// RevealApplier's reveal-replay path is NOT the one currently writing. Both hold the same
    /// instance (constructed once by their owner and passed to each) rather than each keeping a
    /// private flag: a reveal's AddFunds/AddScience/AddReputation call re-fires the exact events
    /// the interceptor subscribes to, and without a guard shared between the two, the interceptor
    /// would treat its own reveal as a brand-new remote-origin change, neutralise it straight back
    /// into the ledger, and never let it land - an infinite defer.
    ///
    /// Pure: no GameEvents, no KSP/Unity types, unit-tested unconditionally.
    /// </summary>
    public sealed class CurrencyDelayGuard
    {
        public bool Active { get; private set; }

        /// <summary>Runs <paramref name="action"/> with <see cref="Active"/> set, clearing it afterwards even if the action throws.</summary>
        public void RunGuarded(Action action)
        {
            if (action == null)
            {
                return;
            }

            Active = true;
            try
            {
                action();
            }
            finally
            {
                Active = false;
            }
        }
    }
}
