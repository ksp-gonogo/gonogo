using System;
using UnityEngine;

namespace Gonogo.KSP.CurrencyDelay
{
    // Same treatment as StockCurrencyInterceptor.cs and RevealApplier.cs:
    // ScenarioModule/KSPScenario/GameScenes/Planetarium only resolve against the real KSP/Unity
    // reference DLLs, so this builds as part of Gonogo.KSP.csproj wherever KspManaged is
    // configured, not standalone in the test project. The one piece of this file with logic worth
    // testing headless - merging a loaded ledger's rows into the shared instance rather than
    // replacing it - is factored into CurrencyDelayLedgerPersistence.cs, which carries only
    // PendingCreditLedger.cs's own ConfigNode dependency and is unit-tested there.

    /// <summary>
    /// Owns the currency-delay subsystem's whole lifecycle: constructs the ONE shared
    /// <see cref="CurrencyDelayGuard"/>, <see cref="PendingCreditLedger"/>, and
    /// <see cref="VesselScienceAggregator"/>, injects that same trio into the stock interceptor and
    /// the reveal applier, binds the aggregator/ledger onto <see cref="DelayedScienceSink"/> so an
    /// external per-increment science source can feed delayed credits in, persists the ledger
    /// through <c>OnSave</c>/<c>OnLoad</c>, and drives the per-tick reveal check.
    ///
    /// All pending state lives here, in the persisted scenario module, never a static that
    /// survives scene reloads - so save/load/quicksave/quickload/revert are consistent by
    /// construction: a credit created after a save point simply isn't in the ledger a load
    /// restores.
    ///
    /// Registered for FLIGHT/SPACECENTER/TRACKSTATION - every scene a currency-change event this
    /// subsystem cares about can actually fire in (a vessel earning/transmitting science or funds
    /// in flight, an operator processing a recovery at the Space Center, a delayed credit
    /// maturing while parked at the Tracking Station).
    /// </summary>
    [KSPScenario(ScenarioCreationOptions.AddToAllGames, GameScenes.FLIGHT, GameScenes.SPACECENTER, GameScenes.TRACKSTATION)]
    public sealed class CurrencyDelayScenario : ScenarioModule
    {
        private CurrencyDelayGuard _guard = new CurrencyDelayGuard();
        private PendingCreditLedger _ledger = new PendingCreditLedger();
        private VesselScienceAggregator _aggregator = new VesselScienceAggregator();

        private StockCurrencyInterceptor? _interceptor;
        private RevealApplier? _reveal;

        /// <summary>
        /// Builds one fresh guard/ledger/aggregator and wires every consumer onto that same trio,
        /// subscribes the stock interceptor's GameEvents (which also seeds its shadow balances from
        /// the live Funding/ResearchAndDevelopment/Reputation instances - see
        /// StockCurrencyInterceptor.SeedShadowFromLiveBalances), and binds the aggregator/ledger
        /// onto DelayedScienceSink so an external per-increment science source hands its increments
        /// to this same instance. Always runs before OnLoad, so OnLoad below has a real ledger
        /// instance to merge rows into rather than racing its construction.
        /// </summary>
        public override void OnAwake()
        {
            base.OnAwake();

            _guard = new CurrencyDelayGuard();
            _ledger = new PendingCreditLedger();
            _aggregator = new VesselScienceAggregator();

            _interceptor = new StockCurrencyInterceptor(_ledger, _aggregator, _guard);
            _reveal = new RevealApplier(_ledger, _aggregator, _guard);

            _interceptor.Subscribe();
            DelayedScienceSink.Bind(_aggregator, _ledger);
        }

        /// <summary>
        /// Merges any persisted rows into the SAME ledger instance OnAwake already handed to the
        /// interceptor/applier (see CurrencyDelayLedgerPersistence's own doc comment for why a
        /// merge, not a reference swap). A brand-new game, or a save from before this subsystem
        /// existed, has no ledger node - the ledger simply stays empty, exactly as constructed.
        /// </summary>
        public override void OnLoad(ConfigNode node)
        {
            base.OnLoad(node);
            CurrencyDelayLedgerPersistence.Load(_ledger, node);
        }

        public override void OnSave(ConfigNode node)
        {
            base.OnSave(node);
            CurrencyDelayLedgerPersistence.Save(_ledger, node);
        }

        /// <summary>
        /// Once per frame: settle any currency change still deferred past its attribution window,
        /// flush any vessel science window that has gone quiet past its cadence, then replay every
        /// matured credit onto the live balances. Warp-safe: the settle, DrainAggregator and
        /// ApplyMatured all handle a UT jump past several windows/reveals in one call, so a plain
        /// per-frame Update - no separate warp handling - is enough.
        ///
        /// <para>The settle is here, and only here, because a change that defers waiting for a
        /// vessel event that never fires is followed by nothing that could settle it - see
        /// StockCurrencyInterceptor.SettleStaleDefers for what a stranded shadow then does to the
        /// next neutralise, and why a currency handler is the wrong place to do this.</para>
        /// </summary>
        private void Update()
        {
            if (_reveal == null)
            {
                return;
            }

            try
            {
                var nowUt = Planetarium.GetUniversalTime();
                _interceptor?.SettleStaleDefers(nowUt);
                _reveal.DrainAggregator(nowUt);
                _reveal.ApplyMatured(nowUt);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] CurrencyDelayScenario tick failed: " + ex);
            }
        }

        private void OnDestroy()
        {
            _interceptor?.Unsubscribe();
            DelayedScienceSink.Unbind();
        }
    }
}
