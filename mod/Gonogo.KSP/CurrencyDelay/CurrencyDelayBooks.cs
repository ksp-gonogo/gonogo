using System;
using UnityEngine;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// One save's currency-delay state and its lifecycle: the shared
    /// <see cref="CurrencyDelayGuard"/>, <see cref="PendingCreditLedger"/> and
    /// <see cref="VesselScienceAggregator"/>, the stock interceptor and the reveal
    /// applier wired onto that same trio, the ledger's save and load, and the
    /// per-frame tick that settles, drains and reveals. <see cref="CurrencyDelayScenario"/>
    /// owns one and forwards its scenario callbacks to it.
    /// </summary>
    internal sealed class CurrencyDelayBooks
    {
        private readonly CurrencyDelayGuard _guard = new CurrencyDelayGuard();
        private readonly VesselScienceAggregator _aggregator = new VesselScienceAggregator();
        private readonly StockCurrencyInterceptor _interceptor;
        private readonly RevealApplier _reveal;

        internal CurrencyDelayBooks()
        {
            _interceptor = new StockCurrencyInterceptor(Ledger, _aggregator, _guard);
            _reveal = new RevealApplier(Ledger, _aggregator, _guard);
        }

        /// <summary>The credits waiting for their reveal time.</summary>
        internal PendingCreditLedger Ledger { get; } = new PendingCreditLedger();

        /// <summary>
        /// Subscribes the interceptor's game events, which also seeds its shadow
        /// balances from the live career, and binds the aggregator and ledger onto
        /// <see cref="DelayedScienceSink"/> for an outside per-increment science source.
        /// </summary>
        internal void Start()
        {
            _interceptor.Subscribe();
            DelayedScienceSink.Bind(_aggregator, Ledger);
            CommsCoreUplink.DelayShortened += BringForward;
        }

        /// <summary>
        /// A shortened or switched-off signal delay releases what is held: every
        /// credit still waiting is due that much sooner, and the open science
        /// windows reveal with the shorter delay. The next tick reveals what has
        /// become due, in the order the credits were taken in.
        /// </summary>
        internal void BringForward(double remainingFactor)
        {
            try
            {
                Ledger.BringForward(Planetarium.GetUniversalTime(), remainingFactor);
                _aggregator.ScaleLightTimes(remainingFactor);
            }
            catch (Exception ex)
            {
                GonogoLog.Error("bringing held credits forward failed", ex);
            }
        }

        /// <summary>
        /// Merges any persisted rows into this ledger rather than replacing it, since
        /// the interceptor and applier already hold it. A save with no ledger node
        /// leaves it empty.
        /// </summary>
        internal void Load(ConfigNode node) => CurrencyDelayLedgerPersistence.Load(Ledger, node);

        internal void Save(ConfigNode node) => CurrencyDelayLedgerPersistence.Save(Ledger, node);

        /// <summary>
        /// Settles any currency change still deferred past its attribution window,
        /// flushes any vessel science window gone quiet past its cadence, lands each
        /// held change home has now heard of, then replays every matured credit onto
        /// the live balances. Each step handles a UT jump past
        /// several windows or reveals in one call, so one call per frame is enough at
        /// any warp rate.
        ///
        /// <para>The settle runs here and only here: a change that defers waiting for
        /// a vessel event that never fires is followed by nothing that could settle it.
        /// See <see cref="StockCurrencyInterceptor.SettleStaleDefers"/>.</para>
        /// </summary>
        internal void Tick()
        {
            try
            {
                var nowUt = Planetarium.GetUniversalTime();
                _interceptor.NoteCrewAboard();
                _interceptor.SettleStaleDefers(nowUt);
                _reveal.DrainAggregator(nowUt);
                Ledger.ReleaseHeld(nowUt, row =>
                {
                    var home = HomeCraftViews.Of(row.OriginVesselId);
                    // Science is never landed on a declaration, so none of it is owed back when one is withdrawn.
                    var lostSeq = row.Currency == DelayedCurrency.Science ? 0 : HeldCreditRelease.DeclarationOf(home);
                    return (HeldCreditRelease.Outcome(row.Currency, row.HeldSinceUt!.Value, home), lostSeq);
                });
                _reveal.ApplyMatured(nowUt);
            }
            catch (Exception ex)
            {
                GonogoLog.Error("CurrencyDelayScenario tick failed", ex);
            }
        }

        internal void Stop()
        {
            CommsCoreUplink.DelayShortened -= BringForward;
            _interceptor.Unsubscribe();
            DelayedScienceSink.Unbind();
            CrewDeathTies.Clear();
        }
    }
}
