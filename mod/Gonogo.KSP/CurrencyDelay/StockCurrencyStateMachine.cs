using System;
using System.Collections.Generic;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>Which stage a science currency change resolved to.</summary>
    public enum ScienceChangeOutcome
    {
        /// <summary>Not a vessel-bearing reason (or degraded to one): shadow is already resynced to the live total.</summary>
        Home,

        /// <summary>No vessel context in hand yet: nothing to do until a later event claims it.</summary>
        Deferred,

        /// <summary>Attributed to a vessel: caller should neutralise to <see cref="ScienceChangeDecision.ShadowToRestore"/> and enqueue a credit.</summary>
        Away,
    }

    /// <summary>Which stage a funds/reputation change resolved to - mirrors <see cref="ScienceChangeOutcome"/>.</summary>
    public enum CurrencyChangeOutcome
    {
        /// <summary>Not a vessel-bearing reason (or degraded to one): shadow is already resynced to the live total.</summary>
        Home,

        /// <summary>No vessel context in hand yet: shadow is deliberately left untouched until a later push claims this change (or it settles stale). NOT the same as Home - the shadow has NOT been resynced.</summary>
        Deferred,

        /// <summary>Attributed to a vessel: caller should neutralise to <see cref="CurrencyChangeDecision.ShadowToRestore"/> and enqueue a credit.</summary>
        Away,
    }

    /// <summary>Result of feeding a funds or reputation change through the state machine.</summary>
    public readonly struct CurrencyChangeDecision
    {
        public CurrencyChangeOutcome Outcome { get; }

        /// <summary>Convenience for callers that only care about away-vs-not (funds, and reputation's non-deferred paths) - true only for <see cref="CurrencyChangeOutcome.Away"/>.</summary>
        public bool IsAway => Outcome == CurrencyChangeOutcome.Away;

        public string OriginVesselId { get; }
        public double BaseAmount { get; }
        public double ShadowToRestore { get; }

        private CurrencyChangeDecision(CurrencyChangeOutcome outcome, string originVesselId, double baseAmount, double shadowToRestore)
        {
            Outcome = outcome;
            OriginVesselId = originVesselId;
            BaseAmount = baseAmount;
            ShadowToRestore = shadowToRestore;
        }

        public static CurrencyChangeDecision Home() => new CurrencyChangeDecision(CurrencyChangeOutcome.Home, "", 0.0, 0.0);

        public static CurrencyChangeDecision Deferred() => new CurrencyChangeDecision(CurrencyChangeOutcome.Deferred, "", 0.0, 0.0);

        public static CurrencyChangeDecision Away(string originVesselId, double baseAmount, double shadowToRestore) =>
            new CurrencyChangeDecision(CurrencyChangeOutcome.Away, originVesselId ?? "", baseAmount, shadowToRestore);
    }

    /// <summary>Result of feeding a science change or receipt through the state machine.</summary>
    public readonly struct ScienceChangeDecision
    {
        public ScienceChangeOutcome Outcome { get; }
        public string OriginVesselId { get; }
        public double BaseAmount { get; }
        public double ShadowToRestore { get; }

        private ScienceChangeDecision(ScienceChangeOutcome outcome, string originVesselId, double baseAmount, double shadowToRestore)
        {
            Outcome = outcome;
            OriginVesselId = originVesselId;
            BaseAmount = baseAmount;
            ShadowToRestore = shadowToRestore;
        }

        public static ScienceChangeDecision Home() => new ScienceChangeDecision(ScienceChangeOutcome.Home, "", 0.0, 0.0);

        public static ScienceChangeDecision Deferred() => new ScienceChangeDecision(ScienceChangeOutcome.Deferred, "", 0.0, 0.0);

        public static ScienceChangeDecision Away(string originVesselId, double baseAmount, double shadowToRestore) =>
            new ScienceChangeDecision(ScienceChangeOutcome.Away, originVesselId ?? "", baseAmount, shadowToRestore);
    }

    /// <summary>
    /// The pure shadow-tracking, deferred-science, deferred-reputation, and vessel-correlation
    /// state machine behind stock currency interception. Owns the three shadow balances (what each
    /// balance legitimately is right now, per <c>StockCurrencyInterceptor</c>'s neutralise-to-shadow
    /// model) and every piece of timing-window bookkeeping the glue used to hold as loose,
    /// single-slot fields: which vessel a recovery, lab transmission, or crew-killing destruction in
    /// progress should attribute to, and which science/reputation changes are still waiting on one
    /// of those to land. No GameEvents, no KSP/Unity types, no live calls - same discipline as
    /// <see cref="StockCurrencyDecision"/>, just stateful where that one is stateless.
    ///
    /// The glue (<c>StockCurrencyInterceptor.cs</c>) owns the actual GameEvents subscriptions,
    /// live SetX/AddX calls, and light-time lookups; it feeds this machine primitives (reasons,
    /// totals, UT, vessel id strings) and applies whatever decision comes back.
    /// </summary>
    public sealed class StockCurrencyStateMachine
    {
        /// <summary>
        /// UT-second tolerance for correlating a vessel-context event (recovery, lab
        /// transmission) with the currency change it explains, when the two fire as separate
        /// GameEvents in the same tick and their relative order is not guaranteed.
        /// </summary>
        public const double AttributionWindowUt = 2.0;

        /// <summary>
        /// UT-second tolerance for matching a death-vessel push to the VesselLoss reputation defers
        /// it explains. A single destruction's onVesselWillDestroy push and every reputation change
        /// its MurderCrew burst produces all read Planetarium.GetUniversalTime() from within the SAME
        /// synchronous Vessel.Die() call, so in practice they carry the exact same UT - this epsilon
        /// only needs to absorb floating-point jitter between separate reads, not span any real
        /// elapsed time. Deliberately far tighter than AttributionWindowUt (which exists to bound how
        /// long an unmatched push/defer stays around at all, not to scope which destruction a claim
        /// belongs to) - see TryClaimDeathVessel's doc comment for why this distinction is load-bearing.
        /// </summary>
        private const double SameDestructionUtEpsilon = 0.001;

        private sealed class PendingVessel
        {
            public string VesselId = "";
            public double PushedUt;
            public bool ClaimedFunds;
            public bool ClaimedScience;
            public bool ClaimedReputation;
        }

        private sealed class PendingScienceDefer
        {
            public StockTransactionReason Reason;
            public double BaseAmount;
            public double Ut;
        }

        private sealed class PendingReputationDefer
        {
            public double BaseAmount;
            public double Ut;
        }

        // Each entry is a distinct in-flight recovery/lab transmission, not a single overwritten
        // slot - so two vessels recovering (or transmitting via a stock lab) within the same
        // attribution window each keep their own claimable record instead of the second
        // silently clobbering the first.
        private readonly List<PendingVessel> _recoveryVessels = new List<PendingVessel>();
        private readonly List<PendingVessel> _labVessels = new List<PendingVessel>();
        private readonly List<PendingVessel> _deathVessels = new List<PendingVessel>();
        private readonly List<PendingScienceDefer> _scienceDefers = new List<PendingScienceDefer>();
        private readonly List<PendingReputationDefer> _reputationDefers = new List<PendingReputationDefer>();

        public double ShadowFunds { get; private set; }
        public double ShadowScience { get; private set; }
        public double ShadowReputation { get; private set; }

        public void SeedShadow(double funds, double science, double reputation)
        {
            ShadowFunds = funds;
            ShadowScience = science;
            ShadowReputation = reputation;
        }

        // ---- Guarded-write shadow tracking ----
        //
        // The shadow model is only correct at rest when it equals the live balance. A write the
        // interceptor recognises as its own (CurrencyDelayGuard.Active) is either its own
        // neutralise SetX(shadow) - where newTotal already equals the shadow, so this is a
        // harmless no-op resync - or RevealApplier's reveal AddX(base) - where newTotal is the
        // shadow plus the just-applied credit, a genuine advance the shadow must track or a
        // later neutralise will restore to the stale pre-reveal value and erase the reveal.
        // StockCurrencyInterceptor's guarded glue calls these instead of bailing out entirely.

        public void SyncShadowFunds(double newTotal) => ShadowFunds = newTotal;

        public void SyncShadowScience(double newTotal) => ShadowScience = newTotal;

        public void SyncShadowReputation(double newTotal) => ShadowReputation = newTotal;

        // ---- Vessel-context pushes ----

        /// <summary>
        /// Records the vessel a recovery in progress is crediting. Never resolves anything
        /// itself - a recovery's currency changes always fire after this push (same recovery
        /// flow), unlike lab transmission below where the ordering isn't guaranteed.
        /// </summary>
        public void PushRecoveryVessel(string vesselId, double ut)
        {
            Prune(_recoveryVessels, ut);
            _recoveryVessels.Add(new PendingVessel { VesselId = vesselId ?? "", PushedUt = ut });
        }

        /// <summary>
        /// Records a stock-lab transmission's vessel. Handler order between the lab's own
        /// AddScience call and OnScienceChanged is not guaranteed, so this either claims a
        /// science change already deferred (lab named second) or stashes for OnScienceChanged
        /// to claim later (lab named first).
        /// </summary>
        public ScienceChangeDecision PushLabVessel(string vesselId, double ut)
        {
            Prune(_labVessels, ut);

            if (TryClaimScienceDefer(StockTransactionReason.ScienceTransmission, ut, out var baseAmount))
            {
                return ScienceChangeDecision.Away(vesselId, baseAmount, ShadowScience);
            }

            _labVessels.Add(new PendingVessel { VesselId = vesselId ?? "", PushedUt = ut });
            return ScienceChangeDecision.Deferred();
        }

        /// <summary>
        /// Records the vessel a destruction (<c>onVesselWillDestroy</c>) is about to explain a
        /// crew-death reputation hit for. Unlike recovery/lab, ordering between this push and the
        /// OnReputationChanged(VesselLoss) calls it correlates with is genuinely unguaranteed both
        /// ways: a loaded vessel destroyed mid-flight runs MurderCrew() (killing every crew member,
        /// each firing its own reputation change) BEFORE Die() fires this push, while an unloaded
        /// vessel's Die() fires this push first and kills its crew afterwards. So this claims every
        /// currently-deferred VesselLoss change AT THE SAME UT (there can be more than one -
        /// MurderCrew kills a whole crew roster in one synchronous burst, all sharing this call's
        /// exact UT since Planetarium time doesn't advance mid-frame) if any are waiting, or stashes
        /// itself for OnReputationChanged to claim as they arrive. Matching by UT rather than "any
        /// defer still inside the attribution window" is what keeps two different vessels destroyed
        /// within that window (different UTs) from cross-attributing to each other.
        /// </summary>
        public IReadOnlyList<CurrencyChangeDecision> PushDeathVessel(string vesselId, double ut)
        {
            Prune(_deathVessels, ut);

            var claimedAmounts = ClaimAllReputationDefers(ut);
            if (claimedAmounts.Count > 0)
            {
                var decisions = new List<CurrencyChangeDecision>(claimedAmounts.Count);
                foreach (var baseAmount in claimedAmounts)
                {
                    decisions.Add(CurrencyChangeDecision.Away(vesselId, baseAmount, ShadowReputation));
                }
                return decisions;
            }

            _deathVessels.Add(new PendingVessel { VesselId = vesselId ?? "", PushedUt = ut });
            return Array.Empty<CurrencyChangeDecision>();
        }

        // ---- Currency change handlers ----

        public CurrencyChangeDecision OnFundsChanged(StockTransactionReason reason, double newTotal, double baseAmount, double ut)
        {
            var vesselId = "";
            var hasVessel = reason == StockTransactionReason.VesselRecovery
                && TryClaimRecoveryVessel(CurrencyKind.Funds, ut, out vesselId);

            if (StockCurrencyDecision.ClassifyOrigin(reason, hasVessel) != CurrencyOrigin.Away)
            {
                ShadowFunds = newTotal;
                return CurrencyChangeDecision.Home();
            }

            return CurrencyChangeDecision.Away(vesselId, baseAmount, ShadowFunds);
        }

        public CurrencyChangeDecision OnReputationChanged(StockTransactionReason reason, double newTotal, double baseAmount, double ut)
        {
            if (reason == StockTransactionReason.VesselLoss)
            {
                var hasDeathVessel = TryClaimDeathVessel(ut, out var deathVesselId);
                if (StockCurrencyDecision.ClassifyOrigin(reason, hasDeathVessel) == CurrencyOrigin.Away)
                {
                    return CurrencyChangeDecision.Away(deathVesselId, baseAmount, ShadowReputation);
                }

                // No destroyed-vessel context claimed yet - defer (NOT Home: the shadow must stay
                // untouched, not resynced to newTotal) since the destruction event this correlates
                // with can fire either before or after this reputation change (see PushDeathVessel).
                // A later push at the SAME ut may still claim it; SettleStaleReputationDefers
                // resolves it Home once it ages past the attribution window with nothing claiming it.
                _reputationDefers.Add(new PendingReputationDefer { BaseAmount = baseAmount, Ut = ut });
                return CurrencyChangeDecision.Deferred();
            }

            var vesselId = "";
            var hasVessel = reason == StockTransactionReason.VesselRecovery
                && TryClaimRecoveryVessel(CurrencyKind.Reputation, ut, out vesselId);

            if (StockCurrencyDecision.ClassifyOrigin(reason, hasVessel) != CurrencyOrigin.Away)
            {
                ShadowReputation = newTotal;
                return CurrencyChangeDecision.Home();
            }

            return CurrencyChangeDecision.Away(vesselId, baseAmount, ShadowReputation);
        }

        /// <summary>
        /// A deferred VesselLoss reputation change nothing claims within the attribution window
        /// (its destroyed vessel's onVesselWillDestroy never fired - e.g. a debug/cheat kill, or a
        /// death path outside the two decompile-confirmed ones) is accepted as HOME rather than
        /// stranding the shadow, mirroring SettleStaleScienceDefers.
        /// </summary>
        private void SettleStaleReputationDefers(double ut, double currentLiveReputation)
        {
            var removed = _reputationDefers.RemoveAll(d => ut - d.Ut > AttributionWindowUt);
            if (removed > 0)
            {
                ShadowReputation = currentLiveReputation;
            }
        }

        /// <summary>
        /// Catches the shadows up on every defer the attribution window has run out
        /// on. The ONLY way a defer settles, and deliberately the only public one:
        /// settling resyncs a shadow to a live total, and the only moment a live
        /// total means anything is one with no currency change in flight.
        ///
        /// <para>Called every frame from the owning scenario's tick rather than from
        /// a currency handler, because a defer nothing ever explains is followed by
        /// nothing at all. Reachable only from inside the next change of the same
        /// currency, it never ran: a science change under an away-set reason with no
        /// vessel to claim it left the shadow stranded for the rest of the session,
        /// and every later neutralise restored the balance to that stranded value.</para>
        /// </summary>
        public void SettleStaleDefers(double nowUt, double liveScience, double liveReputation)
        {
            SettleStaleScienceDefers(nowUt, liveScience);
            SettleStaleReputationDefers(nowUt, liveReputation);
        }

        /// <summary>
        /// A deferred science change nothing has claimed within the attribution window is
        /// accepted as HOME rather than stranding the shadow out of sync with the real balance
        /// forever.
        /// </summary>
        private void SettleStaleScienceDefers(double ut, double currentLiveScience)
        {
            var removed = _scienceDefers.RemoveAll(d => ut - d.Ut > AttributionWindowUt);
            if (removed > 0)
            {
                ShadowScience = currentLiveScience;
            }
        }

        public ScienceChangeDecision OnScienceChanged(StockTransactionReason reason, double newTotal, double baseAmount, double ut)
        {
            if (reason != StockTransactionReason.ScienceTransmission && reason != StockTransactionReason.VesselRecovery)
            {
                ShadowScience = newTotal;
                return ScienceChangeDecision.Home();
            }

            // Recovered lab science credits directly via AddScience(VesselRecovery) with no
            // OnScienceRecieved - a recovery vessel push always precedes it (same recovery flow).
            if (reason == StockTransactionReason.VesselRecovery
                && TryClaimRecoveryVessel(CurrencyKind.Science, ut, out var recoveryVesselId))
            {
                return ScienceChangeDecision.Away(recoveryVesselId, baseAmount, ShadowScience);
            }

            // Transmitted lab science: PushLabVessel already named the vessel (it ran before
            // this call, in whichever order the two handlers happened to fire this tick).
            if (reason == StockTransactionReason.ScienceTransmission
                && TryClaimLabVessel(ut, out var labVesselId))
            {
                return ScienceChangeDecision.Away(labVesselId, baseAmount, ShadowScience);
            }

            // Neither vessel context is in hand yet: defer. Ordinary transmission/recovery
            // science resolves via the OnScienceReceived that follows this same call;
            // transmitted lab science resolves via the later PushLabVessel call.
            _scienceDefers.Add(new PendingScienceDefer { Reason = reason, BaseAmount = baseAmount, Ut = ut });
            return ScienceChangeDecision.Deferred();
        }

        /// <summary>
        /// Ordinary experiment transmission and recovered (non-lab) science both fire this with
        /// the exact credited value and the source vessel - self-contained, no correlation
        /// needed for the base amount. Every HOME path (nothing deferred behind the receipt, no
        /// usable amount/source, or a vessel-less degrade like a mod award or reverse-engineered
        /// recovery credit) resyncs the shadow to the live post-change total before returning,
        /// same as every other resolution path. Skipping that resync is what let a later AWAY
        /// neutralise silently erase a HOME earn that landed in between (the shadow stayed
        /// stale, so "restore to shadow" wiped out real currency the live balance already held).
        /// </summary>
        public ScienceChangeDecision OnScienceReceived(double amount, bool hasSourceVessel, bool reverseEngineered, string vesselId, double ut, double currentLiveScience)
        {
            // This event NARRATES a balance change; it never is one. Stock fires it from
            // SubmitScienceData fourteen lines after the AddScience it describes, so the receipt
            // that means something always finds that change already sitting in _scienceDefers,
            // and claiming it is what earns the right to attribute, neutralise and credit.
            //
            // A fire with nothing deferred behind it moved no balance, so treating it as an earn
            // manufactures a credit out of a notification AND neutralises against a shadow that
            // was never the point - which, if the shadow has been left behind, does not claw
            // anything back, it rewrites the career's science down to that stale number. Two
            // live sources fire exactly that: a science mod announcing a subject's first
            // completion, which credits incrementally under an unrelated reason and fires this
            // event as a bare notification carrying either a token 0.01 or the subject's whole
            // max value, with no AddScience behind either; and a vessel recovery, whose science
            // change OnScienceChanged already resolved AWAY off the recovery push, leaving no
            // defer for the receipt that follows to claim.
            if (!TryClaimOldestScienceDefer(ut, amount))
            {
                // The shadow is only meant to trail the balance while a change is deferred, so
                // with none in flight the two are supposed to agree and resyncing heals a shadow
                // something else stranded. With one in flight the gap is real and load-bearing:
                // it is the value that change's own neutralise will restore to, and closing it
                // here would leave that neutralise pointing at a balance already holding the
                // credit, which claws back nothing and reveals it a second time.
                if (!HasScienceDeferInFlight(ut))
                {
                    ShadowScience = currentLiveScience;
                }

                return ScienceChangeDecision.Home();
            }

            if (amount <= 0.0 || double.IsNaN(amount) || double.IsInfinity(amount) || !hasSourceVessel)
            {
                ShadowScience = currentLiveScience;
                return ScienceChangeDecision.Home();
            }

            var hasVessel = !reverseEngineered;
            if (StockCurrencyDecision.ClassifyOrigin(StockTransactionReason.ScienceTransmission, hasVessel) != CurrencyOrigin.Away)
            {
                ShadowScience = currentLiveScience;
                return ScienceChangeDecision.Home();
            }

            return ScienceChangeDecision.Away(vesselId, amount, ShadowScience);
        }

        // ---- Correlation helpers ----

        private static void Prune(List<PendingVessel> vessels, double ut)
        {
            vessels.RemoveAll(v => ut - v.PushedUt > AttributionWindowUt);
        }

        /// <summary>
        /// Claims the oldest recovery vessel not yet claimed for this specific currency - a
        /// single recovery can yield up to three separate currency changes (funds, science,
        /// reputation), all against the same vessel, so a claim marks only its own currency
        /// rather than consuming the whole entry. Concurrent recoveries of different vessels
        /// therefore each resolve against their own entry in push order, instead of a second
        /// recovery's push overwriting the first's.
        /// </summary>
        private bool TryClaimRecoveryVessel(CurrencyKind currency, double ut, out string vesselId)
        {
            Prune(_recoveryVessels, ut);

            foreach (var vessel in _recoveryVessels)
            {
                var alreadyClaimed = currency switch
                {
                    CurrencyKind.Funds => vessel.ClaimedFunds,
                    CurrencyKind.Science => vessel.ClaimedScience,
                    CurrencyKind.Reputation => vessel.ClaimedReputation,
                    _ => true,
                };
                if (alreadyClaimed)
                {
                    continue;
                }

                switch (currency)
                {
                    case CurrencyKind.Funds: vessel.ClaimedFunds = true; break;
                    case CurrencyKind.Science: vessel.ClaimedScience = true; break;
                    case CurrencyKind.Reputation: vessel.ClaimedReputation = true; break;
                }

                vesselId = vessel.VesselId;
                return true;
            }

            vesselId = "";
            return false;
        }

        /// <summary>
        /// Claims a death vessel pushed at THE SAME UT as <paramref name="ut"/> (within
        /// <see cref="SameDestructionUtEpsilon"/>) WITHOUT consuming it - unlike recovery/lab, one
        /// destroyed vessel's crew can produce several separate VesselLoss reputation changes
        /// (MurderCrew kills every crew member in one synchronous burst), and each one needs to
        /// attribute to the same vessel. Matching by UT rather than "any push still inside the
        /// attribution window" is what stops a reputation change from one destruction cross-claiming
        /// a DIFFERENT vessel's push that merely happens to still be sitting in the list from a
        /// moment earlier - two destructions in different frames always have different UTs, since
        /// Planetarium time only advances between frames, not within the synchronous Die() call
        /// either one fires from. Two vessels destroyed in the exact same frame (a simultaneous
        /// collision) DO share a UT and stay genuinely ambiguous here - acceptable, since same-frame
        /// destructions are also same-location-ish and so have similar light-time regardless of
        /// which one a stray claim lands on. The entry only ever leaves via Prune's time-based
        /// expiry, never a claim.
        /// </summary>
        private bool TryClaimDeathVessel(double ut, out string vesselId)
        {
            Prune(_deathVessels, ut);

            for (var i = _deathVessels.Count - 1; i >= 0; i--)
            {
                if (Math.Abs(ut - _deathVessels[i].PushedUt) <= SameDestructionUtEpsilon)
                {
                    vesselId = _deathVessels[i].VesselId;
                    return true;
                }
            }

            vesselId = "";
            return false;
        }

        /// <summary>
        /// Claims every deferred VesselLoss reputation change pushed at THE SAME UT as
        /// <paramref name="pushUt"/> (within <see cref="SameDestructionUtEpsilon"/>), in original
        /// enqueue order - the multi-crew counterpart to TryClaimScienceDefer's single claim, since
        /// one destroyed vessel's push can explain an entire crew roster's worth of deferred changes
        /// at once. See TryClaimDeathVessel's doc comment for why UT-matching (not "any defer still
        /// inside the attribution window") is what keeps two different destructions from
        /// cross-attributing to each other; a UT match is inherently fresh, so no separate staleness
        /// check is needed here (that's SettleStaleReputationDefers' job, for defers NO push ever
        /// claims).
        /// </summary>
        private List<double> ClaimAllReputationDefers(double pushUt)
        {
            var claimed = new List<double>();
            for (var i = _reputationDefers.Count - 1; i >= 0; i--)
            {
                var defer = _reputationDefers[i];
                if (Math.Abs(pushUt - defer.Ut) > SameDestructionUtEpsilon)
                {
                    continue;
                }

                claimed.Add(defer.BaseAmount);
                _reputationDefers.RemoveAt(i);
            }

            claimed.Reverse();
            return claimed;
        }

        /// <summary>Claims the oldest lab vessel push - lab correlation is science-only, so one claim fully consumes the entry (unlike recovery's per-currency claiming above).</summary>
        private bool TryClaimLabVessel(double ut, out string vesselId)
        {
            Prune(_labVessels, ut);

            if (_labVessels.Count == 0)
            {
                vesselId = "";
                return false;
            }

            vesselId = _labVessels[0].VesselId;
            _labVessels.RemoveAt(0);
            return true;
        }

        private bool TryClaimScienceDefer(StockTransactionReason reason, double ut, out double baseAmount)
        {
            for (var i = 0; i < _scienceDefers.Count; i++)
            {
                var defer = _scienceDefers[i];
                if (defer.Reason != reason || ut - defer.Ut > AttributionWindowUt)
                {
                    continue;
                }

                baseAmount = defer.BaseAmount;
                _scienceDefers.RemoveAt(i);
                return true;
            }

            baseAmount = 0.0;
            return false;
        }

        /// <summary>
        /// Claims the oldest science defer still inside the attribution window whose base amount
        /// this receipt's amount matches, whatever its reason - unlike
        /// <see cref="TryClaimScienceDefer"/>, an OnScienceRecieved carries its own amount and
        /// vessel and needs the defer only as proof that a balance actually moved. Defers are
        /// appended in UT order, so the first match is the oldest claimable.
        ///
        /// <para>Matching on the AMOUNT is what stops a notification-only fire from claiming a
        /// real change that happens to be in flight beside it. Stock passes the same
        /// <c>scienceValue</c> to <c>AddScience</c> and to the <c>OnScienceRecieved</c> it fires
        /// fourteen lines later, and the interceptor records the first as the defer's base off
        /// <c>OnCurrencyModifierQuery.GetInput</c>, so a genuine pair agrees exactly. Without
        /// this, a token 0.01 subject-completion fire landing inside a stock lab's two-second
        /// attribution window would claim the lab's deferred change, resolve AWAY against the
        /// lab's pre-change shadow, and neutralise the lab's whole credit away in exchange for a
        /// pending 0.01. The tolerance only absorbs a float round trip; it is far tighter than
        /// any two real credits are close.</para>
        ///
        /// <para>A stale defer is left where it is rather than consumed here: it is
        /// <see cref="SettleStaleDefers"/>'s to remove, and only that path also catches the
        /// shadow up to what the balance kept.</para>
        /// </summary>
        private bool TryClaimOldestScienceDefer(double ut, double amount)
        {
            for (var i = 0; i < _scienceDefers.Count; i++)
            {
                var defer = _scienceDefers[i];
                if (ut - defer.Ut > AttributionWindowUt || !SameCredit(defer.BaseAmount, amount))
                {
                    continue;
                }

                _scienceDefers.RemoveAt(i);
                return true;
            }

            return false;
        }

        private bool HasScienceDeferInFlight(double ut)
        {
            foreach (var defer in _scienceDefers)
            {
                if (ut - defer.Ut <= AttributionWindowUt)
                {
                    return true;
                }
            }

            return false;
        }

        private static bool SameCredit(double deferredBase, double receiptAmount) =>
            Math.Abs(deferredBase - receiptAmount) <= 1e-3 * Math.Max(1.0, Math.Abs(receiptAmount));
    }
}
