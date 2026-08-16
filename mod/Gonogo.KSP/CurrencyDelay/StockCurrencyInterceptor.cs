using System;
using System.Collections.Generic;
using KSP.UI.Screens;
using UnityEngine;

namespace Gonogo.KSP.CurrencyDelay
{
    // This file references Vessel/ProtoVessel/TransactionReasons/
    // CurrencyModifierQuery/GameEvents types that only resolve against the
    // real KSP/Unity reference DLLs, so a worktree without KspManaged
    // configured cannot compile it standalone; it builds as part of
    // Gonogo.KSP.csproj wherever those DLLs are available, same as
    // KscLightTime.cs. Every decision this glue makes (which reasons delay,
    // what a neutralised change turns into as a pending credit, which
    // vessel a recovery/lab transmission/crew-killing destruction
    // attributes to) is decompile-confirmed and delegated to
    // StockCurrencyDecision.cs and StockCurrencyStateMachine.cs, neither of
    // which has such a dependency, so both are unit-tested unconditionally.

    /// <summary>
    /// Subscribes to the stock KSP currency events, neutralises any change
    /// attributable to a vessel away from KSC, and enqueues it into a
    /// <see cref="PendingCreditLedger"/> to reveal at that vessel's KSC
    /// light-time. Live-confirmed origin data (currency-delay-feasibility.md
    /// + its followups doc): <c>OnScienceRecieved</c> carries the
    /// transmitting/recovered vessel for ordinary science, stock lab
    /// transmission credits with no <c>OnScienceRecieved</c> at all but is
    /// attributable via <c>OnTriggeredDataTransmission</c>'s lab vessel, and
    /// vessel-recovery funds/science/reputation are attributable via
    /// <c>onVesselRecoveryProcessing</c>'s ProtoVessel. The crew-death
    /// reputation penalty (<c>TransactionReasons.VesselLoss</c>) carries no
    /// vessel of its own on either <c>Reputation.OnCrewKilled</c> or the
    /// <c>onCrewKilled</c> EventReport it reacts to (decompile-confirmed:
    /// <c>ProtoCrewMember.Die()</c> fires it with a null origin) - it is
    /// attributed instead by correlating with <c>onVesselWillDestroy</c>,
    /// which always fires at the start of the dying vessel's <c>Die()</c>
    /// call with the vessel still fully intact. Everything else reveals
    /// instantly - see <see cref="StockCurrencyDecision"/>.
    ///
    /// All shadow-balance tracking, deferred-science/deferred-reputation
    /// bookkeeping, and recovery/lab/death vessel correlation lives in
    /// <see cref="StockCurrencyStateMachine"/>; this class is thin glue that
    /// reads event primitives, calls into that state machine, and applies
    /// whatever decision comes back via the live SetX/AddX calls and
    /// <see cref="KscLightTime"/>/<see cref="PendingCreditLedger"/>.
    ///
    /// <para><b>Base amount.</b> <c>GameEvents.Modifiers.OnCurrencyModifierQuery</c>
    /// fires inside every <c>AddFunds</c>/<c>AddScience</c>/<c>AddReputation</c>
    /// call, synchronously and immediately before the matching
    /// <c>On*Changed</c>, carrying the pre-clamp base input for whichever one
    /// currency that call touches. This is the base <see cref="StockCurrencyDecision.BuildCredit"/>
    /// stores; the query is consumed by name+reason match in the following
    /// <c>On*Changed</c>, single-slot, since the pairing is always 1:1 within
    /// one mutator call. <c>OnScienceRecieved</c> is used as the base instead
    /// for ordinary transmission/recovery science, since it carries the
    /// exact credited value directly alongside the vessel, with no need to
    /// correlate a separate query.</para>
    ///
    /// <para><b>Neutralise.</b> <c>SetFunds</c>/<c>SetScience</c>/<c>SetReputation</c>
    /// (decompile-confirmed: each just clamps and fires its matching
    /// <c>On*Changed</c> directly) never trigger <c>OnCurrencyModifierQuery</c>,
    /// so restoring the shadowed pre-change value is exact and cannot
    /// re-trigger a second clamp/normalisation pass. The shared
    /// <see cref="CurrencyDelayGuard"/> below stops that restoring write from
    /// being reprocessed as a new change; <see cref="OnCurrencyModifierQuery"/>
    /// also skips under it, defensively, in case a future stock build changes
    /// that. The SAME guard instance is passed to <c>RevealApplier</c> so its
    /// reveal-time AddFunds/AddScience/AddReputation calls are recognised
    /// here too - without that sharing, a reveal would look like a brand-new
    /// remote-origin change and get neutralised right back into the ledger.</para>
    /// </summary>
    public sealed class StockCurrencyInterceptor
    {
        private readonly PendingCreditLedger _ledger;
        private readonly VesselScienceAggregator _scienceAggregator;
        private readonly CurrencyDelayGuard _guard;
        private readonly StockCurrencyStateMachine _state = new StockCurrencyStateMachine();

        private bool _subscribed;

        // Single-slot capture of the most recent OnCurrencyModifierQuery,
        // consumed by the On*Changed call it immediately precedes. Safe as
        // a single slot (unlike the vessel-correlation state below) because
        // the query and its matching On*Changed fire synchronously back to
        // back within one mutator call, with nothing else able to interleave.
        private bool _haveQuery;
        private TransactionReasons _queryReason;
        private double _queryFunds;
        private double _queryScience;
        private double _queryRep;

        // Live object references for vessel ids the state machine has
        // pushed, so a decision naming a vesselId string can still resolve
        // the actual ProtoVessel/Vessel for KscLightTime lookups. Populated
        // in lockstep with every push into the state machine; never pruned
        // (recoveries/lab transmissions are infrequent enough per session
        // that unbounded growth here isn't a practical concern).
        private readonly Dictionary<string, ProtoVessel> _recoveryVesselsById = new Dictionary<string, ProtoVessel>();
        private readonly Dictionary<string, Vessel> _labVesselsById = new Dictionary<string, Vessel>();

        // Light-time captured AT PUSH TIME (onVesselWillDestroy, while the
        // vessel is still fully intact), keyed by vessel id - unlike the
        // dictionaries above, a destroyed vessel's own object degrades over
        // the rest of its Die() call (components torn down, possibly the
        // GameObject destroyed), so it cannot be resolved lazily at claim
        // time the way a recovery ProtoVessel or a still-loaded lab vessel
        // can. Never pruned, same reasoning as the two dictionaries above.
        private readonly Dictionary<string, KscDelay> _deathLightTimesById = new Dictionary<string, KscDelay>();

        public StockCurrencyInterceptor(PendingCreditLedger ledger, VesselScienceAggregator scienceAggregator, CurrencyDelayGuard guard)
        {
            _ledger = ledger ?? throw new ArgumentNullException(nameof(ledger));
            _scienceAggregator = scienceAggregator ?? throw new ArgumentNullException(nameof(scienceAggregator));
            _guard = guard ?? throw new ArgumentNullException(nameof(guard));
        }

        public void Subscribe()
        {
            if (_subscribed)
            {
                return;
            }
            _subscribed = true;

            SeedShadowFromLiveBalances();

            GameEvents.OnScienceRecieved.Add(OnScienceReceived);
            GameEvents.onVesselRecoveryProcessing.Add(OnVesselRecoveryProcessing);
            GameEvents.OnTriggeredDataTransmission.Add(OnTriggeredDataTransmission);
            GameEvents.onVesselWillDestroy.Add(OnVesselWillDestroy);
            GameEvents.Modifiers.OnCurrencyModifierQuery.Add(OnCurrencyModifierQuery);
            GameEvents.OnFundsChanged.Add(OnFundsChanged);
            GameEvents.OnScienceChanged.Add(OnScienceChanged);
            GameEvents.OnReputationChanged.Add(OnReputationChanged);
        }

        public void Unsubscribe()
        {
            if (!_subscribed)
            {
                return;
            }
            _subscribed = false;

            GameEvents.OnScienceRecieved.Remove(OnScienceReceived);
            GameEvents.onVesselRecoveryProcessing.Remove(OnVesselRecoveryProcessing);
            GameEvents.OnTriggeredDataTransmission.Remove(OnTriggeredDataTransmission);
            GameEvents.onVesselWillDestroy.Remove(OnVesselWillDestroy);
            GameEvents.Modifiers.OnCurrencyModifierQuery.Remove(OnCurrencyModifierQuery);
            GameEvents.OnFundsChanged.Remove(OnFundsChanged);
            GameEvents.OnScienceChanged.Remove(OnScienceChanged);
            GameEvents.OnReputationChanged.Remove(OnReputationChanged);
        }

        private void SeedShadowFromLiveBalances()
        {
            _state.SeedShadow(
                Funding.Instance != null ? Funding.Instance.Funds : 0.0,
                ResearchAndDevelopment.Instance != null ? ResearchAndDevelopment.Instance.Science : 0f,
                Reputation.Instance != null ? Reputation.Instance.reputation : 0f);
        }

        private void OnCurrencyModifierQuery(CurrencyModifierQuery query)
        {
            if (_guard.Active || query == null)
            {
                return;
            }
            _haveQuery = true;
            _queryReason = query.reason;
            _queryFunds = query.GetInput(Currency.Funds);
            _queryScience = query.GetInput(Currency.Science);
            _queryRep = query.GetInput(Currency.Reputation);
        }

        /// <summary>Reads and clears the query-captured base for the given reason+currency, falling back to a shadow diff if no matching query was seen (should not happen in practice - the query always immediately precedes its On*Changed).</summary>
        private double ConsumeQueryBase(TransactionReasons reason, Currency currency, double fallback)
        {
            if (!_haveQuery || _queryReason != reason)
            {
                return fallback;
            }

            _haveQuery = false;
            switch (currency)
            {
                case Currency.Funds: return _queryFunds;
                case Currency.Science: return _queryScience;
                case Currency.Reputation: return _queryRep;
                default: return fallback;
            }
        }

        private void OnVesselRecoveryProcessing(ProtoVessel pv, MissionRecoveryDialog dialog, float recoveryScore)
        {
            if (pv == null)
            {
                return;
            }

            var vesselId = pv.vesselID.ToString();
            _recoveryVesselsById[vesselId] = pv;
            _state.PushRecoveryVessel(vesselId, Planetarium.GetUniversalTime());
        }

        /// <summary>Stock lab science: subjectID "sciencelab@..." with no matching OnScienceRecieved. Either claims a science change OnScienceChanged already deferred, or stashes the lab vessel for OnScienceChanged to claim when it runs.</summary>
        private void OnTriggeredDataTransmission(ScienceData data, Vessel origin, bool xmitAborted)
        {
            if (xmitAborted || origin == null || data?.subjectID == null
                || !data.subjectID.StartsWith("sciencelab@", StringComparison.Ordinal))
            {
                return;
            }

            var vesselId = origin.id.ToString();
            _labVesselsById[vesselId] = origin;

            var ut = Planetarium.GetUniversalTime();
            var decision = _state.PushLabVessel(vesselId, ut);
            if (decision.Outcome == ScienceChangeOutcome.Away)
            {
                ResolveScienceAway(decision.OriginVesselId, decision.BaseAmount, ut, decision.ShadowToRestore, liveOrigin: origin);
            }
        }

        /// <summary>
        /// Crew-death reputation attribution: <c>onVesselWillDestroy</c> fires at the very start of
        /// <c>Vessel.Die()</c>, while the vessel is still fully intact, so this is the last moment
        /// its position is reliable - captured here into <see cref="_deathLightTimesById"/> rather
        /// than resolved lazily, since the rest of Die() tears the vessel down (component
        /// destruction, possibly the GameObject itself) before any crew-kill reputation change this
        /// correlates with is guaranteed to have fired. Pushing into the state machine may
        /// immediately resolve one or more already-deferred VesselLoss changes (a loaded vessel's
        /// crew is killed BEFORE Die() runs, so their reputation changes arrive first) or simply
        /// stash for OnReputationChanged to claim as they arrive (an unloaded vessel's crew dies
        /// AFTER this fires, inside the rest of Die()).
        /// </summary>
        private void OnVesselWillDestroy(Vessel vessel)
        {
            if (vessel == null)
            {
                return;
            }

            try
            {
                var vesselId = vessel.id.ToString();
                _deathLightTimesById[vesselId] = KscLightTime.ForVessel(vessel, CommsCoreUplink.SignalDelayConfig);

                var ut = Planetarium.GetUniversalTime();
                foreach (var decision in _state.PushDeathVessel(vesselId, ut))
                {
                    ResolveReputationAway(decision, ut);
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] StockCurrencyInterceptor.OnVesselWillDestroy failed: " + ex.Message);
            }
        }

        /// <summary>Ordinary experiment transmission and recovered (non-lab) science both fire this with the exact credited value and the source vessel - self-contained, no correlation needed.</summary>
        private void OnScienceReceived(float amount, ScienceSubject subject, ProtoVessel source, bool reverseEngineered)
        {
            if (_guard.Active)
            {
                return;
            }

            try
            {
                var currentLiveScience = ResearchAndDevelopment.Instance != null ? ResearchAndDevelopment.Instance.Science : _state.ShadowScience;
                var vesselId = source != null ? source.vesselID.ToString() : "";

                var decision = _state.OnScienceReceived(amount, source != null, reverseEngineered, vesselId, currentLiveScience);
                if (decision.Outcome == ScienceChangeOutcome.Away)
                {
                    ResolveScienceAway(decision.OriginVesselId, decision.BaseAmount, Planetarium.GetUniversalTime(), decision.ShadowToRestore, protoOrigin: source);
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] StockCurrencyInterceptor.OnScienceReceived failed: " + ex.Message);
            }
        }

        private void OnScienceChanged(float newTotal, TransactionReasons reason)
        {
            if (_guard.Active)
            {
                // Our own write: either the neutralise SetScience(shadow) (a no-op resync) or
                // RevealApplier's AddScience(base) (a genuine advance) - either way the shadow
                // must track the observed new total, or a later neutralise restores to the
                // stale pre-reveal value and erases whatever this write just landed.
                _state.SyncShadowScience(newTotal);
                return;
            }

            try
            {
                var ut = Planetarium.GetUniversalTime();
                _state.SettleStaleScienceDefers(ut, newTotal);

                var baseAmount = ConsumeQueryBase(reason, Currency.Science, fallback: newTotal - _state.ShadowScience);
                var decision = _state.OnScienceChanged(ToStockReason(reason), newTotal, baseAmount, ut);

                if (decision.Outcome == ScienceChangeOutcome.Away)
                {
                    var protoOrigin = _recoveryVesselsById.TryGetValue(decision.OriginVesselId, out var pv) ? pv : null;
                    var liveOrigin = protoOrigin == null && _labVesselsById.TryGetValue(decision.OriginVesselId, out var v) ? v : null;
                    ResolveScienceAway(decision.OriginVesselId, decision.BaseAmount, ut, decision.ShadowToRestore, protoOrigin: protoOrigin, liveOrigin: liveOrigin);
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] StockCurrencyInterceptor.OnScienceChanged failed: " + ex.Message);
            }
        }

        /// <summary>Neutralises the live science balance back to the given shadow value and, via the aggregator, enqueues a pending credit once its window flushes. Called once per AWAY science increment regardless of whether this call happens to flush a chunk.</summary>
        private void ResolveScienceAway(string vesselId, double baseAmount, double ut, double shadowToRestore, ProtoVessel? protoOrigin = null, Vessel? liveOrigin = null)
        {
            if (string.IsNullOrEmpty(vesselId) || baseAmount == 0.0)
            {
                return;
            }

            var config = CommsCoreUplink.SignalDelayConfig;
            // Live vessel only. A ProtoVessel has no CommNet connection, so the
            // deleted ForProtoVessel could only ever have measured a straight
            // line; an unloaded origin is unroutable until it loads and proves
            // otherwise.
            var delay = liveOrigin != null ? KscLightTime.ForVessel(liveOrigin, config) : KscDelay.Unroutable;

            NeutraliseScience(shadowToRestore);

            var chunk = _scienceAggregator.Accept(
                vesselId, baseAmount, ut, DelaySecondsForAggregator(delay, config));
            if (!chunk.HasValue)
            {
                return;
            }

            // The aggregator already resolved its own reveal-UT (the
            // light-time of the increment that closed its window), so it is
            // passed straight through as nowUt with a zero light-time rather
            // than re-deriving it here.
            var credit = StockCurrencyDecision.BuildCredit(
                CurrencyKind.Science, chunk.Value.Amount, shadowToRestore, vesselId,
                // Already-resolved reveal UT: the aggregator applied the
                // increment's own delay when it closed its window.
                KscDelay.Instant, nowUt: chunk.Value.RevealUt, silenceDeclarationSeconds: 0.0);

            EnqueueCredit(credit);
        }

        private void NeutraliseScience(double shadowValue)
        {
            _guard.RunGuarded(() => ResearchAndDevelopment.Instance?.SetScience((float)shadowValue, TransactionReasons.None));
        }

        private void OnFundsChanged(double newTotal, TransactionReasons reason)
        {
            if (_guard.Active)
            {
                // Same reasoning as OnScienceChanged above: track our own write's new total
                // instead of leaving the shadow stale after a reveal.
                _state.SyncShadowFunds(newTotal);
                return;
            }

            try
            {
                var ut = Planetarium.GetUniversalTime();
                var baseAmount = ConsumeQueryBase(reason, Currency.Funds, fallback: newTotal - _state.ShadowFunds);
                var decision = _state.OnFundsChanged(ToStockReason(reason), newTotal, baseAmount, ut);

                if (!decision.IsAway || !_recoveryVesselsById.ContainsKey(decision.OriginVesselId))
                {
                    return;
                }

                _guard.RunGuarded(() => Funding.Instance?.SetFunds(decision.ShadowToRestore, TransactionReasons.None));

                // Recovery is INSTANT, not unroutable and not distance-timed.
                // Vessel.IsRecoverable is LandedOrSplashed &&
                // mainBody.isHomeWorld (decompile-confirmed), so a recovered
                // craft is physically in KSC's hands: its funds are not in
                // flight from anywhere and there is nothing to wait for. It
                // only ever looked like a distance problem because the deleted
                // straight-line fallback answered it with one.
                //
                // The consensus goes further and takes VesselRecovery out of
                // AwayReasons altogether, which also deletes the recovery
                // correlation. That is a separate cut: it lands against a
                // 615-line test file built on the current classification, and
                // rushing it would trade a real behaviour fix for a pile of
                // hastily-rewritten assertions.
                var credit = StockCurrencyDecision.BuildCredit(
                    CurrencyKind.Funds, decision.BaseAmount, decision.ShadowToRestore, decision.OriginVesselId,
                    KscDelay.Instant, ut, SilenceDeclarationSeconds());
                EnqueueCredit(credit);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] StockCurrencyInterceptor.OnFundsChanged failed: " + ex.Message);
            }
        }

        private void OnReputationChanged(float newTotal, TransactionReasons reason)
        {
            if (_guard.Active)
            {
                // Same reasoning as OnScienceChanged above: track our own write's new total
                // instead of leaving the shadow stale after a reveal. This also re-captures
                // reputation curve-normalisation for free, since newTotal is the post-clamp
                // stock value, not the base amount the reveal replayed.
                _state.SyncShadowReputation(newTotal);
                return;
            }

            try
            {
                var ut = Planetarium.GetUniversalTime();
                _state.SettleStaleReputationDefers(ut, newTotal);
                var baseAmount = ConsumeQueryBase(reason, Currency.Reputation, fallback: newTotal - _state.ShadowReputation);

                // VesselLoss (the crew-death reputation penalty) resolves
                // AWAY when OnVesselWillDestroy already claimed/pushed a
                // death vessel for it (see StockCurrencyStateMachine); the
                // vessel to resolve light-time against comes from
                // _deathLightTimesById below rather than a recovery
                // ProtoVessel.
                var decision = _state.OnReputationChanged(ToStockReason(reason), newTotal, baseAmount, ut);
                ResolveReputationAway(decision, ut);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] StockCurrencyInterceptor.OnReputationChanged failed: " + ex.Message);
            }
        }

        /// <summary>
        /// Shared neutralise-and-enqueue for every AWAY reputation decision, whichever of the two
        /// vessel-bearing reasons produced it: VesselRecovery resolves against the recovery
        /// ProtoVessel's light-time, VesselLoss against the light-time <see cref="OnVesselWillDestroy"/>
        /// captured for the correlated death vessel. A HOME decision (including a still-deferred
        /// VesselLoss change awaiting its destruction push) is a no-op here.
        /// </summary>
        private void ResolveReputationAway(CurrencyChangeDecision decision, double ut)
        {
            if (!decision.IsAway)
            {
                return;
            }

            KscDelay delay;
            if (_recoveryVesselsById.ContainsKey(decision.OriginVesselId))
            {
                // Recovered at KSC: instant, see the funds path above.
                delay = KscDelay.Instant;
            }
            else if (_deathLightTimesById.TryGetValue(decision.OriginVesselId, out var deathDelay))
            {
                // Captured at the moment of death, while the vessel still
                // existed and its route could still be read. If it had no route
                // then, the penalty blocks rather than landing free - which is
                // the kerbal-died-out-of-contact case this whole subsystem was
                // reopened for.
                delay = deathDelay;
            }
            else
            {
                return;
            }

            _guard.RunGuarded(() => Reputation.Instance?.SetReputation((float)decision.ShadowToRestore, TransactionReasons.None));

            var credit = StockCurrencyDecision.BuildCredit(
                CurrencyKind.Reputation, decision.BaseAmount, decision.ShadowToRestore, decision.OriginVesselId,
                delay, ut, SilenceDeclarationSeconds());
            EnqueueCredit(credit);
        }

        private static double SilenceDeclarationSeconds() =>
            CommsCoreUplink.SignalDelayConfig?.SilenceDeclarationSeconds ?? 86_400.0;

        /// <summary>
        /// The aggregator still takes a plain seconds offset. An unroutable
        /// increment contributes the policy deadline rather than zero, which is
        /// the whole point: late, never instant. Carrying the Blocked flag
        /// through the aggregator window (so a reacquisition can release it
        /// early) is the remaining half of this change.
        /// </summary>
        private static double DelaySecondsForAggregator(KscDelay delay, Sitrep.Host.Comms.SignalDelayConfig config) =>
            delay.IsUnroutable
                ? (config?.SilenceDeclarationSeconds ?? 86_400.0)
                : delay.Seconds;

        private void EnqueueCredit(StockCurrencyCredit? credit)
        {
            if (!credit.HasValue)
            {
                return;
            }
            _ledger.Enqueue(new PendingCreditRow(
                ToDelayedCurrency(credit.Value.Currency),
                credit.Value.BaseAmount,
                credit.Value.RevealUt,
                credit.Value.OriginVesselId,
                credit.Value.OriginDescription));
        }

        private static DelayedCurrency ToDelayedCurrency(CurrencyKind currency)
        {
            switch (currency)
            {
                case CurrencyKind.Funds: return DelayedCurrency.Funds;
                case CurrencyKind.Science: return DelayedCurrency.Science;
                default: return DelayedCurrency.Reputation;
            }
        }

        // Composite masks (Contracts/Vessels/Strategies/RnDs/Any) never fire
        // as a live single-event TransactionReasons value - stock always
        // fires one of the named members below them - so falling back to
        // None/Home for anything this parse can't match is safe: it only
        // ever catches genuinely-unnamed values, never a composite degrading
        // silently into the wrong bucket.
        private static StockTransactionReason ToStockReason(TransactionReasons reason)
        {
            return Enum.TryParse(reason.ToString(), out StockTransactionReason parsed)
                ? parsed
                : StockTransactionReason.None;
        }
    }
}
