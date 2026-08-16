using System;
using UnityEngine;

namespace Gonogo.KSP.CurrencyDelay
{
    // References ProtoVessel/Planetarium and (through KscLightTime) live CommNet types, so it only
    // resolves against the real KSP reference DLLs and builds as part of Gonogo.KSP.csproj wherever
    // KspManaged is configured, same treatment as RevealApplier.cs and StockCurrencyInterceptor.cs.

    /// <summary>
    /// The public, source-agnostic entry point an external per-increment science source hands its
    /// raw crediting events to, so a delayed credit can be produced without the source knowing
    /// anything about the aggregator, ledger, or how a reveal-UT is derived. It owns no state of its
    /// own: <see cref="CurrencyDelayScenario"/> binds the live
    /// <see cref="VesselScienceAggregator"/> + <see cref="PendingCreditLedger"/> for the current
    /// game through <see cref="Bind"/>, and clears them on scene teardown through
    /// <see cref="Unbind"/>. Every increment recorded while unbound (no active scenario, e.g. at the
    /// main menu) is a silent no-op.
    ///
    /// The static binding is a pointer to the scenario-owned instances, never pending state itself -
    /// so the "all pending state lives in the persisted scenario module, never a static" invariant
    /// still holds, exactly as the previous in-core hook's own <c>_active</c> pointer did.
    /// </summary>
    public static class DelayedScienceSink
    {
        private static VesselScienceAggregator? _aggregator;
        private static PendingCreditLedger? _ledger;

        public static void Bind(VesselScienceAggregator aggregator, PendingCreditLedger ledger)
        {
            _aggregator = aggregator ?? throw new ArgumentNullException(nameof(aggregator));
            _ledger = ledger ?? throw new ArgumentNullException(nameof(ledger));
        }

        public static void Unbind()
        {
            _aggregator = null;
            _ledger = null;
        }

        /// <summary>
        /// Records one science increment earned by a vessel. The KSC-anchored one-way light-time is
        /// derived here from <paramref name="fromVessel"/> (a stock KSP handle), so a delayed
        /// credit's reveal-UT is computed the same way for every source: the caller supplies only
        /// the vessel identity, the raw amount, the earn-UT, and an opaque origin label. A null
        /// <paramref name="fromVessel"/> is fed through with zero light-time (instant reveal) rather
        /// than dropped. No-op while unbound, or for a non-positive amount.
        /// </summary>
        public static void RecordDelayedScienceIncrement(
            string vesselId, ProtoVessel? fromVessel, double amount, double ut, string originDescription = "")
        {
            var aggregator = _aggregator;
            var ledger = _ledger;
            if (aggregator == null || ledger == null || amount <= 0.0 || string.IsNullOrEmpty(vesselId))
            {
                return;
            }

            try
            {
                // Resolve the origin to a LIVE vessel: only a live vessel has a
                // CommNet connection to route through, and a route is now the
                // only thing that produces a delay. An origin that is not
                // loaded is unroutable, and an unroutable increment waits out
                // the silence-declaration deadline rather than landing free -
                // the zero here was the hole this subsystem's whole rule exists
                // to close.
                var config = CommsCoreUplink.SignalDelayConfig;
                var lightTime = KscDelayPolicy.DelaySeconds(ResolveLiveDelay(vesselId, config), config);

                var chunk = aggregator.Accept(vesselId, amount, ut, lightTime);
                if (chunk.HasValue)
                {
                    ledger.Enqueue(ScienceChunkCredit.ToPendingCreditRow(chunk.Value, originDescription));
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] DelayedScienceSink.RecordDelayedScienceIncrement failed: " + ex.Message);
            }
        }

        /// <summary>
        /// The routed delay for a vessel guid, by finding it live in
        /// <c>FlightGlobals</c>. Unroutable when it is not loaded: there is no
        /// second way to measure, and guessing from a saved position is the
        /// straight line this subsystem refuses.
        /// </summary>
        private static KscDelay ResolveLiveDelay(string vesselId, Sitrep.Host.Comms.SignalDelayConfig config)
        {
            var all = FlightGlobals.Vessels;
            if (all == null)
            {
                return KscDelay.Unroutable;
            }
            foreach (var vessel in all)
            {
                if (vessel != null && vessel.id.ToString() == vesselId)
                {
                    return KscLightTime.ForVessel(vessel, config);
                }
            }
            return KscDelay.Unroutable;
        }

    }
}
