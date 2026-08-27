using System.Linq;
using Gonogo.KSP.CurrencyDelay;
using Xunit;

public class StockCurrencyStateMachineTests
{
    private static StockCurrencyStateMachine Seeded(double funds = 1000.0, double science = 100.0, double reputation = 50.0)
    {
        var state = new StockCurrencyStateMachine();
        state.SeedShadow(funds, science, reputation);
        return state;
    }

    // The Critical bug this regresses: OnScienceReceived's two HOME
    // early-return paths (no usable amount/source, or a vessel-less
    // degrade like reverse-engineered recovery credit) must resync the
    // shadow to the live post-change total. Without that resync, the
    // shadow is left holding the value from BEFORE the home earn landed,
    // so the next AWAY science event's neutralise (restore-to-shadow)
    // silently erases the home earn along with the away credit it's
    // actually meant to neutralise.
    [Fact]
    public void OnScienceReceived_home_degrade_resyncs_shadow_so_a_later_away_neutralise_does_not_erase_it()
    {
        var state = Seeded(science: 100.0);

        // 1. An ordinary AWAY transmission: OnScienceChanged defers (no
        //    recovery/lab vessel in hand), then OnScienceReceived resolves
        //    it AWAY using its own vessel + amount. Shadow stays at 100 -
        //    the interceptor would neutralise the live balance back to it.
        state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 105.0, baseAmount: 5.0, ut: 0.0);
        var away1 = state.OnScienceReceived(amount: 5.0, hasSourceVessel: true, reverseEngineered: false, vesselId: "vessel-A", ut: 0.0, currentLiveScience: 105.0);
        Assert.Equal(ScienceChangeOutcome.Away, away1.Outcome);
        Assert.Equal(100.0, away1.ShadowToRestore);
        Assert.Equal(100.0, state.ShadowScience);

        // 2. A HOME degrade: a reverse-engineered recovery credit (no
        //    resolvable vessel) adds +8 science directly to the live
        //    balance (100 -> 108, post-neutralise from step 1).
        state.OnScienceChanged(StockTransactionReason.VesselRecovery, newTotal: 108.0, baseAmount: 8.0, ut: 1.0);
        var home = state.OnScienceReceived(amount: 8.0, hasSourceVessel: true, reverseEngineered: true, vesselId: "", ut: 1.0, currentLiveScience: 108.0);
        Assert.Equal(ScienceChangeOutcome.Home, home.Outcome);

        // The shadow MUST now reflect the home earn (108), not the stale
        // pre-earn value (100) - this is the fix under test.
        Assert.Equal(108.0, state.ShadowScience);

        // 3. A second AWAY transmission: +3 lands on top (108 -> 111).
        state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 111.0, baseAmount: 3.0, ut: 2.0);
        var away2 = state.OnScienceReceived(amount: 3.0, hasSourceVessel: true, reverseEngineered: false, vesselId: "vessel-C", ut: 2.0, currentLiveScience: 111.0);

        Assert.Equal(ScienceChangeOutcome.Away, away2.Outcome);
        Assert.Equal("vessel-C", away2.OriginVesselId);
        Assert.Equal(3.0, away2.BaseAmount);

        // The neutralise target must be 108 (preserving the home earn from
        // step 2), never 100 (which would silently erase it). Against the
        // old buggy logic (no resync in step 2) this asserts 100 and fails.
        Assert.Equal(108.0, away2.ShadowToRestore);
    }

    [Fact]
    public void OnScienceReceived_with_no_source_vessel_is_Home_and_resyncs_shadow()
    {
        var state = Seeded(science: 50.0);

        var decision = state.OnScienceReceived(amount: 4.0, hasSourceVessel: false, reverseEngineered: false, vesselId: "", ut: 0.0, currentLiveScience: 54.0);

        Assert.Equal(ScienceChangeOutcome.Home, decision.Outcome);
        Assert.Equal(54.0, state.ShadowScience);
    }

    [Fact]
    public void OnScienceReceived_with_a_non_positive_amount_is_Home_and_resyncs_shadow()
    {
        var state = Seeded(science: 20.0);

        var decision = state.OnScienceReceived(amount: 0.0, hasSourceVessel: true, reverseEngineered: false, vesselId: "vessel-x", ut: 0.0, currentLiveScience: 20.0);

        Assert.Equal(ScienceChangeOutcome.Home, decision.Outcome);
        Assert.Equal(20.0, state.ShadowScience);
    }

    [Fact]
    public void OnFundsChanged_of_a_home_reason_resyncs_shadow_to_the_new_total()
    {
        var state = Seeded(funds: 500.0);

        var decision = state.OnFundsChanged(StockTransactionReason.ContractReward, newTotal: 750.0, baseAmount: 250.0, ut: 0.0);

        Assert.False(decision.IsAway);
        Assert.Equal(750.0, state.ShadowFunds);
    }

    [Fact]
    public void OnReputationChanged_of_a_home_reason_resyncs_shadow_to_the_new_total()
    {
        var state = Seeded(reputation: 10.0);

        var decision = state.OnReputationChanged(StockTransactionReason.StrategyOutput, newTotal: -5.0, baseAmount: -15.0, ut: 0.0);

        Assert.False(decision.IsAway);
        Assert.Equal(-5.0, state.ShadowReputation);
    }

    [Fact]
    public void OnScienceChanged_of_a_home_reason_resyncs_shadow_to_the_new_total()
    {
        var state = Seeded(science: 30.0);

        var decision = state.OnScienceChanged(StockTransactionReason.RnDTechResearch, newTotal: 25.0, baseAmount: -5.0, ut: 0.0);

        Assert.Equal(ScienceChangeOutcome.Home, decision.Outcome);
        Assert.Equal(25.0, state.ShadowScience);
    }

    [Fact]
    public void OnFundsChanged_of_VesselRecovery_with_no_pending_vessel_degrades_Home()
    {
        var state = Seeded(funds: 100.0);

        var decision = state.OnFundsChanged(StockTransactionReason.VesselRecovery, newTotal: 300.0, baseAmount: 200.0, ut: 0.0);

        Assert.False(decision.IsAway);
        Assert.Equal(300.0, state.ShadowFunds);
    }

    [Fact]
    public void OnFundsChanged_of_VesselRecovery_with_a_pending_vessel_is_Away_and_does_not_move_shadow()
    {
        var state = Seeded(funds: 100.0);
        state.PushRecoveryVessel("vessel-r1", ut: 0.0);

        var decision = state.OnFundsChanged(StockTransactionReason.VesselRecovery, newTotal: 300.0, baseAmount: 200.0, ut: 0.5);

        Assert.True(decision.IsAway);
        Assert.Equal("vessel-r1", decision.OriginVesselId);
        Assert.Equal(200.0, decision.BaseAmount);
        Assert.Equal(100.0, decision.ShadowToRestore);
        Assert.Equal(100.0, state.ShadowFunds); // AWAY never mutates shadow directly - the caller neutralises to ShadowToRestore.
    }

    [Fact]
    public void a_single_recovery_can_claim_funds_science_and_reputation_from_the_same_pending_vessel()
    {
        var state = Seeded(funds: 100.0, science: 10.0, reputation: 5.0);
        state.PushRecoveryVessel("vessel-r1", ut: 0.0);

        var funds = state.OnFundsChanged(StockTransactionReason.VesselRecovery, newTotal: 150.0, baseAmount: 50.0, ut: 0.1);
        var science = state.OnScienceChanged(StockTransactionReason.VesselRecovery, newTotal: 16.0, baseAmount: 6.0, ut: 0.2);
        var rep = state.OnReputationChanged(StockTransactionReason.VesselRecovery, newTotal: 8.0, baseAmount: 3.0, ut: 0.3);

        Assert.True(funds.IsAway);
        Assert.Equal("vessel-r1", funds.OriginVesselId);
        Assert.Equal(ScienceChangeOutcome.Away, science.Outcome);
        Assert.Equal("vessel-r1", science.OriginVesselId);
        Assert.True(rep.IsAway);
        Assert.Equal("vessel-r1", rep.OriginVesselId);
    }

    // The Important interleaving fix: two vessels recovered within the
    // same attribution window must each attribute their own currency
    // changes to themselves, not to whichever vessel was pushed most
    // recently.
    [Fact]
    public void two_concurrent_vessel_recoveries_within_the_window_each_attribute_their_own_funds_correctly()
    {
        var state = Seeded(funds: 1000.0);
        state.PushRecoveryVessel("vessel-A", ut: 0.0);
        state.PushRecoveryVessel("vessel-B", ut: 0.5); // still within the 2s window of A

        var claimForA = state.OnFundsChanged(StockTransactionReason.VesselRecovery, newTotal: 1100.0, baseAmount: 100.0, ut: 0.6);
        var claimForB = state.OnFundsChanged(StockTransactionReason.VesselRecovery, newTotal: 1250.0, baseAmount: 150.0, ut: 0.7);

        Assert.Equal("vessel-A", claimForA.OriginVesselId);
        Assert.Equal("vessel-B", claimForB.OriginVesselId);
    }

    [Fact]
    public void two_concurrent_vessel_recoveries_within_the_window_each_attribute_science_and_reputation_correctly()
    {
        var state = Seeded(science: 10.0, reputation: 5.0);
        state.PushRecoveryVessel("vessel-A", ut: 0.0);
        state.PushRecoveryVessel("vessel-B", ut: 0.4);

        var scienceForA = state.OnScienceChanged(StockTransactionReason.VesselRecovery, newTotal: 15.0, baseAmount: 5.0, ut: 0.5);
        var scienceForB = state.OnScienceChanged(StockTransactionReason.VesselRecovery, newTotal: 22.0, baseAmount: 7.0, ut: 0.6);
        var repForA = state.OnReputationChanged(StockTransactionReason.VesselRecovery, newTotal: 8.0, baseAmount: 3.0, ut: 0.7);
        var repForB = state.OnReputationChanged(StockTransactionReason.VesselRecovery, newTotal: 9.0, baseAmount: 1.0, ut: 0.8);

        Assert.Equal("vessel-A", scienceForA.OriginVesselId);
        Assert.Equal("vessel-B", scienceForB.OriginVesselId);
        Assert.Equal("vessel-A", repForA.OriginVesselId);
        Assert.Equal("vessel-B", repForB.OriginVesselId);
    }

    [Fact]
    public void a_third_recovery_currency_claim_with_no_vessel_left_unclaimed_degrades_Home()
    {
        var state = Seeded(funds: 1000.0);
        state.PushRecoveryVessel("vessel-A", ut: 0.0);

        var first = state.OnFundsChanged(StockTransactionReason.VesselRecovery, newTotal: 1100.0, baseAmount: 100.0, ut: 0.1);
        Assert.True(first.IsAway);

        // A second funds change under the same reason with nothing left to
        // claim (only one recovery was pushed, and its funds claim is used)
        // must not wrongly re-claim vessel-A a second time for the same
        // currency - it degrades Home instead of misattributing.
        var second = state.OnFundsChanged(StockTransactionReason.VesselRecovery, newTotal: 1150.0, baseAmount: 50.0, ut: 0.2);
        Assert.False(second.IsAway);
    }

    [Fact]
    public void recovery_vessel_claims_expire_after_the_attribution_window()
    {
        var state = Seeded(funds: 1000.0);
        state.PushRecoveryVessel("vessel-A", ut: 0.0);

        var decision = state.OnFundsChanged(StockTransactionReason.VesselRecovery, newTotal: 1100.0, baseAmount: 100.0, ut: 10.0);

        Assert.False(decision.IsAway);
    }

    // Lab correlation: OnScienceChanged fires first (nothing to claim yet),
    // then the lab vessel push claims the deferred science.
    [Fact]
    public void a_deferred_science_change_is_claimed_by_a_later_lab_vessel_push()
    {
        var state = Seeded(science: 10.0);

        var deferred = state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 12.5, baseAmount: 2.5, ut: 0.0);
        Assert.Equal(ScienceChangeOutcome.Deferred, deferred.Outcome);

        var claim = state.PushLabVessel("lab-vessel-1", ut: 0.5);

        Assert.Equal(ScienceChangeOutcome.Away, claim.Outcome);
        Assert.Equal("lab-vessel-1", claim.OriginVesselId);
        Assert.Equal(2.5, claim.BaseAmount);
        Assert.Equal(10.0, claim.ShadowToRestore);
    }

    // Lab correlation the other direction: the lab vessel push fires first,
    // then OnScienceChanged claims it.
    [Fact]
    public void a_lab_vessel_pushed_before_its_science_change_is_claimed_by_OnScienceChanged()
    {
        var state = Seeded(science: 10.0);

        var pushResult = state.PushLabVessel("lab-vessel-1", ut: 0.0);
        Assert.Equal(ScienceChangeOutcome.Deferred, pushResult.Outcome);

        var claim = state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 12.5, baseAmount: 2.5, ut: 0.5);

        Assert.Equal(ScienceChangeOutcome.Away, claim.Outcome);
        Assert.Equal("lab-vessel-1", claim.OriginVesselId);
    }

    // The Important interleaving fix for labs: two stock labs on different
    // vessels transmitting within the same window must not cross-attribute.
    [Fact]
    public void two_concurrent_lab_transmissions_within_the_window_each_attribute_to_their_own_vessel()
    {
        var state = Seeded(science: 10.0);
        state.PushLabVessel("lab-A", ut: 0.0);
        state.PushLabVessel("lab-B", ut: 0.3);

        var claimForA = state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 14.0, baseAmount: 4.0, ut: 0.4);
        var claimForB = state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 20.0, baseAmount: 6.0, ut: 0.5);

        Assert.Equal("lab-A", claimForA.OriginVesselId);
        Assert.Equal("lab-B", claimForB.OriginVesselId);
    }

    // The exact event order a caller drives when it names a lab vessel and then
    // awards through AddScience: OnTriggeredDataTransmission first, the science
    // change second. OnScienceReceived plays no part - it is the ordinary
    // transmission path, a sibling of this one, not a prerequisite for it. Pinned
    // because a rig run whose science was never neutralised was read as evidence
    // that the lab push does not attribute without OnScienceReceived, and the
    // attribution half of that question is answerable headlessly.
    [Fact]
    public void a_lab_push_followed_by_a_science_change_resolves_Away_with_no_OnScienceReceived_involved()
    {
        var state = Seeded(science: 2.0);

        var push = state.PushLabVessel("V-2", ut: 100.0);
        Assert.Equal(ScienceChangeOutcome.Deferred, push.Outcome);

        var earn = state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 27.0, baseAmount: 25.0, ut: 100.0);

        Assert.Equal(ScienceChangeOutcome.Away, earn.Outcome);
        Assert.Equal("V-2", earn.OriginVesselId);
        Assert.Equal(25.0, earn.BaseAmount);

        // The interceptor neutralises to this, so a live run that leaves the
        // balance at 27 did not take this branch at all.
        Assert.Equal(2.0, earn.ShadowToRestore);
        Assert.Equal(2.0, state.ShadowScience);
    }

    // The counterfactual, and the signature to look for when a run does not
    // delay: with no vessel named, the change DEFERS rather than resolving Away,
    // so the interceptor never neutralises and the live balance keeps the whole
    // award. Once the attribution window passes, it settles HOME and the shadow
    // catches up to the balance - which is what a run showing "science landed at
    // once, shadow equals live, nothing pending" actually means.
    [Fact]
    public void a_science_change_with_no_vessel_named_defers_then_settles_home_with_the_award_still_on_the_balance()
    {
        var state = Seeded(science: 2.0);

        var earn = state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 27.0, baseAmount: 25.0, ut: 100.0);
        Assert.Equal(ScienceChangeOutcome.Deferred, earn.Outcome);

        // Deferred leaves the shadow alone: nothing has been neutralised yet.
        Assert.Equal(2.0, state.ShadowScience);

        state.SettleStaleDefers(nowUt: 103.0, liveScience: 27.0, liveReputation: 50.0);
        Assert.Equal(27.0, state.ShadowScience);
    }

    // A lab-vessel push names an origin for science and nothing else. It
    // matters because the lab push is the only origin a caller can supply
    // without firing a destructive vessel-lifecycle event (recovery,
    // destruction), so it bounds what can be attributed to a place at all:
    // funds and reputation stay HOME no matter which vessel is in hand.
    [Fact]
    public void a_pushed_lab_vessel_attributes_science_and_leaves_funds_and_reputation_home()
    {
        var state = Seeded(funds: 1000.0, science: 100.0, reputation: 50.0);
        state.PushLabVessel("lab-A", ut: 0.0);

        var funds = state.OnFundsChanged(StockTransactionReason.ScienceTransmission, newTotal: 1200.0, baseAmount: 200.0, ut: 0.1);
        Assert.Equal(CurrencyChangeOutcome.Home, funds.Outcome);
        Assert.Equal(1200.0, state.ShadowFunds);

        var reputation = state.OnReputationChanged(StockTransactionReason.ScienceTransmission, newTotal: 55.0, baseAmount: 5.0, ut: 0.2);
        Assert.Equal(CurrencyChangeOutcome.Home, reputation.Outcome);
        Assert.Equal(55.0, state.ShadowReputation);

        // The push is still unclaimed and still names the vessel for the one
        // currency it covers.
        var science = state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 125.0, baseAmount: 25.0, ut: 0.3);
        Assert.Equal(ScienceChangeOutcome.Away, science.Outcome);
        Assert.Equal("lab-A", science.OriginVesselId);
        Assert.Equal(25.0, science.BaseAmount);
        Assert.Equal(100.0, science.ShadowToRestore);
    }

    [Fact]
    public void a_stale_deferred_science_change_settles_as_home_and_resyncs_the_shadow()
    {
        var state = Seeded(science: 10.0);

        var deferred = state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 13.0, baseAmount: 3.0, ut: 0.0);
        Assert.Equal(ScienceChangeOutcome.Deferred, deferred.Outcome);

        // Nothing claims it within the attribution window; the next
        // science change (any reason) settles it stale first.
        state.SettleStaleDefers(nowUt: 3.0, liveScience: 13.0, liveReputation: 50.0);

        Assert.Equal(13.0, state.ShadowScience);
    }

    [Fact]
    public void settling_with_no_stale_defers_does_not_move_the_shadow()
    {
        var state = Seeded(science: 10.0);

        state.SettleStaleDefers(nowUt: 3.0, liveScience: 999.0, liveReputation: 999.0);

        Assert.Equal(10.0, state.ShadowScience);
    }

    // A science RECEIPT is a notification, not an earn. Stock only ever fires it
    // to narrate a balance change it has already made (SubmitScienceData calls
    // AddScience, then fires OnScienceRecieved fourteen lines later), so the
    // receipt that matters always finds the change it explains already deferred.
    // A science mod that credits incrementally under an unrelated reason fires
    // the same event to ANNOUNCE a subject's first completion, with no matching
    // AddScience at all: a token 0.01 where our science hook is attached, the
    // subject's whole max value where it is not. Read as a real away earn, that
    // becomes a neutralise the balance never asked for.
    [Fact]
    public void a_science_receipt_explaining_no_balance_change_is_home_and_never_neutralises()
    {
        var state = Seeded(science: 63.0);

        var decision = state.OnScienceReceived(
            amount: 0.01, hasSourceVessel: true, reverseEngineered: false,
            vesselId: "probe", ut: 500.0, currentLiveScience: 63.0);

        Assert.Equal(ScienceChangeOutcome.Home, decision.Outcome);
        Assert.Equal(63.0, state.ShadowScience);
    }

    // The damage that receipt does when the shadow has been left behind: the
    // interceptor's answer to an AWAY decision is SetScience(ShadowToRestore),
    // so a receipt resolving Away against a stale shadow does not neutralise
    // anything, it rewrites the career's science down to whatever the shadow
    // last happened to hold.
    [Fact]
    public void a_science_receipt_cannot_rewrite_the_balance_down_to_a_stranded_shadow()
    {
        var state = Seeded(science: 38.0);

        // A mod credits 25 under an away-set reason with no vessel anywhere:
        // deferred, so the shadow stays at 38 while the balance holds 63.
        state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 63.0, baseAmount: 25.0, ut: 100.0);
        Assert.Equal(38.0, state.ShadowScience);

        var decision = state.OnScienceReceived(
            amount: 0.01, hasSourceVessel: true, reverseEngineered: false,
            vesselId: "probe", ut: 500.0, currentLiveScience: 63.0);

        Assert.Equal(ScienceChangeOutcome.Home, decision.Outcome);
        Assert.Equal(63.0, state.ShadowScience);
    }

    // The narrow way a notification-only fire could still do damage: land inside
    // a real change's attribution window and claim ITS defer. The lab path holds
    // one open for up to two UT-seconds, so the collision is reachable, and the
    // consequence would be the worst outcome in this subsystem - the lab's whole
    // credit neutralised away against its own pre-change shadow, in exchange for
    // a pending 0.01.
    [Fact]
    public void a_notification_sized_receipt_cannot_claim_a_real_change_deferred_beside_it()
    {
        var state = Seeded(science: 100.0);

        // A stock lab transmits 25: deferred, waiting on its lab push.
        state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 125.0, baseAmount: 25.0, ut: 500.0);

        var decision = state.OnScienceReceived(
            amount: 0.01, hasSourceVessel: true, reverseEngineered: false,
            vesselId: "probe", ut: 500.5, currentLiveScience: 125.0);

        Assert.Equal(ScienceChangeOutcome.Home, decision.Outcome);

        // The gap between shadow and balance belongs to the lab's deferred change,
        // so the receipt must not close it either.
        Assert.Equal(100.0, state.ShadowScience);

        // And the defer is untouched, so the lab's own push still claims it, still
        // against the pre-change shadow its neutralise has to restore.
        var claim = state.PushLabVessel("lab-A", ut: 501.0);
        Assert.Equal(ScienceChangeOutcome.Away, claim.Outcome);
        Assert.Equal(25.0, claim.BaseAmount);
        Assert.Equal(100.0, claim.ShadowToRestore);
    }

    // A recovery's science change is attributed by OnScienceChanged itself, off
    // the recovery push, and resolves AWAY there. The OnScienceRecieved that
    // follows narrates that same credit, and must not neutralise and enqueue it
    // a second time.
    [Fact]
    public void the_receipt_following_an_already_attributed_recovery_does_not_resolve_away_twice()
    {
        var state = Seeded(science: 10.0);
        state.PushRecoveryVessel("recovered-1", ut: 0.0);

        var change = state.OnScienceChanged(StockTransactionReason.VesselRecovery, newTotal: 16.0, baseAmount: 6.0, ut: 0.1);
        Assert.Equal(ScienceChangeOutcome.Away, change.Outcome);

        var receipt = state.OnScienceReceived(
            amount: 6.0, hasSourceVessel: true, reverseEngineered: false,
            vesselId: "recovered-1", ut: 0.2, currentLiveScience: 16.0);

        Assert.Equal(ScienceChangeOutcome.Home, receipt.Outcome);
    }

    // The defect the rig isolated. Two runs differing only in reason: Progression
    // tracked the shadow 2 -> 38, ScienceTransmission left it at 38 while the
    // balance went to 63. ScienceTransmission is an away-set reason, so the
    // change defers waiting for a vessel that never arrives, and NOTHING ELSE
    // HAPPENS - no receipt, no lab push, no second currency event. The settle
    // has to be pumped by the passage of time on its own, or the shadow stays
    // stranded for the rest of the session and every later neutralise restores
    // to it.
    [Fact]
    public void a_deferred_science_change_nothing_ever_explains_settles_on_time_alone()
    {
        var state = Seeded(science: 38.0, reputation: 50.0);

        var earn = state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 63.0, baseAmount: 25.0, ut: 100.0);
        Assert.Equal(ScienceChangeOutcome.Deferred, earn.Outcome);
        Assert.Equal(38.0, state.ShadowScience);

        state.SettleStaleDefers(nowUt: 103.0, liveScience: 63.0, liveReputation: 50.0);

        Assert.Equal(63.0, state.ShadowScience);
    }

    [Fact]
    public void an_ordinary_transmission_deferred_by_OnScienceChanged_is_resolved_by_OnScienceReceived_not_by_a_lab_or_recovery_claim()
    {
        var state = Seeded(science: 10.0);

        var deferred = state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 14.0, baseAmount: 4.0, ut: 0.0);
        Assert.Equal(ScienceChangeOutcome.Deferred, deferred.Outcome);

        var resolved = state.OnScienceReceived(amount: 4.0, hasSourceVessel: true, reverseEngineered: false, vesselId: "vessel-ordinary", ut: 0.0, currentLiveScience: 14.0);

        Assert.Equal(ScienceChangeOutcome.Away, resolved.Outcome);
        Assert.Equal("vessel-ordinary", resolved.OriginVesselId);
        Assert.Equal(4.0, resolved.BaseAmount);
        Assert.Equal(10.0, resolved.ShadowToRestore);
    }

    // ---- VesselLoss (crew-death reputation) correlation ----

    // The unloaded-vessel destruction path: onVesselWillDestroy (the push)
    // fires BEFORE MurderCrew kills the crew, so the death vessel is
    // already claimable when the reputation change arrives.
    [Fact]
    public void OnReputationChanged_of_VesselLoss_with_an_already_pushed_death_vessel_is_Away_and_does_not_move_shadow()
    {
        var state = Seeded(reputation: 100.0);
        state.PushDeathVessel("vessel-dead", ut: 0.0);

        // Same ut as the push - both fire from within the SAME synchronous
        // Vessel.Die() call, so Planetarium UT is identical for both.
        var decision = state.OnReputationChanged(StockTransactionReason.VesselLoss, newTotal: 81.28, baseAmount: -10.0, ut: 0.0);

        Assert.True(decision.IsAway);
        Assert.Equal("vessel-dead", decision.OriginVesselId);
        Assert.Equal(-10.0, decision.BaseAmount); // base, not the curve-normalised -18.72-style applied delta
        Assert.Equal(100.0, decision.ShadowToRestore);
        Assert.Equal(100.0, state.ShadowReputation); // AWAY never mutates shadow directly - the caller neutralises to ShadowToRestore.
    }

    // The loaded-vessel destruction path: MurderCrew kills the crew (firing
    // the reputation change) BEFORE Die() fires onVesselWillDestroy, so the
    // change must defer and be claimed retroactively by the later push.
    [Fact]
    public void a_VesselLoss_reputation_change_deferred_before_its_death_vessel_push_is_claimed_by_that_push()
    {
        var state = Seeded(reputation: 50.0);

        var deferred = state.OnReputationChanged(StockTransactionReason.VesselLoss, newTotal: 45.0, baseAmount: -5.0, ut: 0.0);
        Assert.Equal(CurrencyChangeOutcome.Deferred, deferred.Outcome); // NOT Home - the shadow is deliberately left untouched, not resynced
        Assert.False(deferred.IsAway);
        Assert.Equal(50.0, state.ShadowReputation); // deferred, not resynced - a later push must still be able to restore the pre-loss shadow

        // Same ut as the deferred change - both fire from within the SAME
        // synchronous Vessel.Die() call (loaded-vessel path: MurderCrew then Die()).
        var claims = state.PushDeathVessel("vessel-dead", ut: 0.0);

        Assert.Single(claims);
        Assert.True(claims[0].IsAway);
        Assert.Equal("vessel-dead", claims[0].OriginVesselId);
        Assert.Equal(-5.0, claims[0].BaseAmount);
        Assert.Equal(50.0, claims[0].ShadowToRestore);
    }

    // A whole crew roster dying together (MurderCrew loops over every crew
    // member) produces N deferred reputation changes that a single push
    // must all resolve, not just the first.
    [Fact]
    public void PushDeathVessel_claims_every_deferred_VesselLoss_change_from_one_crew_roster()
    {
        var state = Seeded(reputation: 300.0);

        state.OnReputationChanged(StockTransactionReason.VesselLoss, newTotal: 290.0, baseAmount: -10.0, ut: 0.0);
        state.OnReputationChanged(StockTransactionReason.VesselLoss, newTotal: 279.0, baseAmount: -11.0, ut: 0.0);
        state.OnReputationChanged(StockTransactionReason.VesselLoss, newTotal: 267.0, baseAmount: -12.0, ut: 0.0);

        // Same ut as all three deferred changes - the whole crew roster and
        // the vessel's own onVesselWillDestroy push share one synchronous call.
        var claims = state.PushDeathVessel("vessel-crewed", ut: 0.0);

        Assert.Equal(3, claims.Count);
        Assert.All(claims, c => Assert.True(c.IsAway));
        Assert.All(claims, c => Assert.Equal("vessel-crewed", c.OriginVesselId));
        Assert.Equal(new[] { -10.0, -11.0, -12.0 }, claims.Select(c => c.BaseAmount));
        Assert.All(claims, c => Assert.Equal(300.0, c.ShadowToRestore));
    }

    // A death vessel push is never consumed by a claim (unlike recovery),
    // since more than one crew member can die from it: a second and third
    // reputation change after the push must each still resolve Away.
    [Fact]
    public void a_pushed_death_vessel_can_be_claimed_by_more_than_one_reputation_change()
    {
        var state = Seeded(reputation: 200.0);
        state.PushDeathVessel("vessel-dead", ut: 0.0);

        // Same ut as the push, same reasoning as the tests above.
        var first = state.OnReputationChanged(StockTransactionReason.VesselLoss, newTotal: 190.0, baseAmount: -10.0, ut: 0.0);
        var second = state.OnReputationChanged(StockTransactionReason.VesselLoss, newTotal: 179.0, baseAmount: -11.0, ut: 0.0);

        Assert.True(first.IsAway);
        Assert.True(second.IsAway);
        Assert.Equal("vessel-dead", first.OriginVesselId);
        Assert.Equal("vessel-dead", second.OriginVesselId);
    }

    // No destroyed vessel ever shows up (a debug/cheat kill, or a death path
    // outside the two decompile-confirmed ones): the deferred change settles
    // Home once it ages past the attribution window, same as science.
    [Fact]
    public void a_VesselLoss_change_with_no_death_vessel_ever_pushed_settles_Home_after_the_window()
    {
        var state = Seeded(reputation: 40.0);

        var deferred = state.OnReputationChanged(StockTransactionReason.VesselLoss, newTotal: 35.0, baseAmount: -5.0, ut: 0.0);
        Assert.Equal(CurrencyChangeOutcome.Deferred, deferred.Outcome);
        Assert.False(deferred.IsAway);

        state.SettleStaleDefers(nowUt: 3.0, liveScience: 100.0, liveReputation: 35.0);

        Assert.Equal(35.0, state.ShadowReputation);
    }

    [Fact]
    public void settling_reputation_defers_with_nothing_stale_does_not_move_the_shadow()
    {
        var state = Seeded(reputation: 40.0);

        state.SettleStaleDefers(nowUt: 3.0, liveScience: 999.0, liveReputation: 999.0);

        Assert.Equal(40.0, state.ShadowReputation);
    }

    // A death vessel push claim also expires past the attribution window,
    // same as recovery/lab.
    [Fact]
    public void death_vessel_claims_expire_after_the_attribution_window()
    {
        var state = Seeded(reputation: 100.0);
        state.PushDeathVessel("vessel-dead", ut: 0.0);

        var decision = state.OnReputationChanged(StockTransactionReason.VesselLoss, newTotal: 90.0, baseAmount: -10.0, ut: 10.0);

        Assert.False(decision.IsAway);
    }

    // Two vessels destroyed at different UTs (different frames), each one's
    // push resolving its own claim immediately (push-first ordering), must
    // not cross-attribute even though both fall inside the same 2s
    // attribution window.
    [Fact]
    public void two_vessel_destructions_at_different_uts_within_the_window_do_not_misattribute_reputation()
    {
        var state = Seeded(reputation: 500.0);

        state.PushDeathVessel("vessel-A", ut: 0.0);
        var claimForA = state.OnReputationChanged(StockTransactionReason.VesselLoss, newTotal: 490.0, baseAmount: -10.0, ut: 0.0);

        state.PushDeathVessel("vessel-B", ut: 0.5);
        var claimForB = state.OnReputationChanged(StockTransactionReason.VesselLoss, newTotal: 479.0, baseAmount: -11.0, ut: 0.5);

        Assert.Equal("vessel-A", claimForA.OriginVesselId);
        Assert.Equal("vessel-B", claimForB.OriginVesselId);
    }

    // The interleaving case the test above never creates: two vessels
    // destroyed at different UTs, both within the 2s window, but this time
    // the crew-kill-first ordering for BOTH - every reputation change defers
    // BEFORE either vessel's onVesselWillDestroy push resolves anything, and
    // the two vessels' defers interleave in the list. Each push must still
    // claim only the defers sharing its own UT.
    [Fact]
    public void two_interleaved_vessel_destructions_at_different_uts_each_claim_only_their_own_deferred_reputation_changes()
    {
        var state = Seeded(reputation: 1000.0);

        // Vessel A's first crew death (ut 0.0), then vessel B's only crew
        // death (ut 0.5), then vessel A's second crew death (still ut 0.0,
        // same synchronous MurderCrew burst as A's first) - all deferred,
        // no push has fired for either vessel yet.
        var aDefer1 = state.OnReputationChanged(StockTransactionReason.VesselLoss, newTotal: 990.0, baseAmount: -10.0, ut: 0.0);
        var bDefer1 = state.OnReputationChanged(StockTransactionReason.VesselLoss, newTotal: 970.0, baseAmount: -20.0, ut: 0.5);
        var aDefer2 = state.OnReputationChanged(StockTransactionReason.VesselLoss, newTotal: 959.0, baseAmount: -11.0, ut: 0.0);

        Assert.Equal(CurrencyChangeOutcome.Deferred, aDefer1.Outcome);
        Assert.Equal(CurrencyChangeOutcome.Deferred, bDefer1.Outcome);
        Assert.Equal(CurrencyChangeOutcome.Deferred, aDefer2.Outcome);

        var claimsForA = state.PushDeathVessel("vessel-A", ut: 0.0);
        var claimsForB = state.PushDeathVessel("vessel-B", ut: 0.5);

        Assert.Equal(2, claimsForA.Count);
        Assert.All(claimsForA, c => Assert.Equal("vessel-A", c.OriginVesselId));
        Assert.Equal(new[] { -10.0, -11.0 }, claimsForA.Select(c => c.BaseAmount));

        Assert.Single(claimsForB);
        Assert.Equal("vessel-B", claimsForB[0].OriginVesselId);
        Assert.Equal(-20.0, claimsForB[0].BaseAmount);
    }

    [Fact]
    public void ClassifyOrigin_reflects_VesselLoss_as_Away_only_once_a_death_vessel_is_claimed()
    {
        // The state-machine-level counterpart to
        // StockCurrencyDecisionTests' ClassifyOrigin coverage: VesselLoss
        // with no push claimed still degrades Home, exercised end to end
        // through the real correlation path rather than a bare bool.
        var state = Seeded(reputation: 20.0);

        var noPush = state.OnReputationChanged(StockTransactionReason.VesselLoss, newTotal: 15.0, baseAmount: -5.0, ut: 0.0);
        Assert.Equal(CurrencyChangeOutcome.Deferred, noPush.Outcome);
        Assert.False(noPush.IsAway);

        state.PushDeathVessel("vessel-dead", ut: 5.0);
        var withPush = state.OnReputationChanged(StockTransactionReason.VesselLoss, newTotal: 10.0, baseAmount: -5.0, ut: 5.0);
        Assert.True(withPush.IsAway);
    }

    // ---- Guarded-write shadow tracking: a reveal must advance the shadow ----
    //
    // The Critical bug this regresses: the interceptor's guarded glue used to bail out on every
    // one of its own writes (both the neutralise SetX and RevealApplier's reveal AddX), so a
    // reveal never advanced the shadow. The next AWAY neutralise then restored to the stale
    // pre-reveal shadow value, silently erasing whatever the reveal had just credited. These
    // tests drive the same sequence the fixed interceptor now produces - neutralise (via
    // SyncShadowX, standing in for the guarded SetX(shadow) resync) then reveal (via SyncShadowX
    // again, standing in for the guarded AddX(base) advance) - and assert the revealed amount
    // survives a second, unrelated AWAY credit.

    [Fact]
    public void a_reveal_advances_the_shadow_so_a_later_neutralise_does_not_erase_it_science()
    {
        var state = Seeded(science: 0.0);

        // exp1 transmits +10: OnScienceChanged defers, OnScienceReceived resolves it Away
        // against the current shadow (0).
        state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 10.0, baseAmount: 10.0, ut: 0.0);
        var away1 = state.OnScienceReceived(amount: 10.0, hasSourceVessel: true, reverseEngineered: false, vesselId: "exp1", ut: 0.0, currentLiveScience: 10.0);
        Assert.Equal(ScienceChangeOutcome.Away, away1.Outcome);
        Assert.Equal(0.0, away1.ShadowToRestore);

        // Neutralise: SetScience(0) fires OnScienceChanged(newTotal=0) under guard - the fixed
        // interceptor calls SyncShadowScience instead of bailing (harmless no-op here).
        state.SyncShadowScience(0.0);
        Assert.Equal(0.0, state.ShadowScience);

        // exp1 reveals: AddScience(10) fires OnScienceChanged(newTotal=10) under guard - the
        // fixed interceptor advances the shadow to track it.
        state.SyncShadowScience(10.0);
        Assert.Equal(10.0, state.ShadowScience);

        // exp2 transmits +10 on top of the revealed exp1 (live 10 -> 20).
        state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 20.0, baseAmount: 10.0, ut: 5.0);
        var away2 = state.OnScienceReceived(amount: 10.0, hasSourceVessel: true, reverseEngineered: false, vesselId: "exp2", ut: 5.0, currentLiveScience: 20.0);
        Assert.Equal(ScienceChangeOutcome.Away, away2.Outcome);

        // The neutralise target MUST be 10 (preserving exp1's revealed credit), never 0 (which
        // would erase it). Against the old buggy logic (no shadow advance on reveal) this
        // asserts 0 and fails.
        Assert.Equal(10.0, away2.ShadowToRestore);

        // Carrying the sequence through to completion: neutralise exp2, then reveal it, and
        // confirm both credits survive - science ends at 20, never regresses to 10.
        state.SyncShadowScience(away2.ShadowToRestore);
        state.SyncShadowScience(20.0);
        Assert.Equal(20.0, state.ShadowScience);
    }

    [Fact]
    public void a_reveal_advances_the_shadow_so_a_later_neutralise_does_not_erase_it_funds()
    {
        var state = Seeded(funds: 0.0);

        state.PushRecoveryVessel("recovery1", ut: 0.0);
        var away1 = state.OnFundsChanged(StockTransactionReason.VesselRecovery, newTotal: 100.0, baseAmount: 100.0, ut: 0.1);
        Assert.True(away1.IsAway);
        Assert.Equal(0.0, away1.ShadowToRestore);

        // Neutralise then reveal recovery1, same as the science case above.
        state.SyncShadowFunds(0.0);
        state.SyncShadowFunds(100.0);
        Assert.Equal(100.0, state.ShadowFunds);

        // recovery2 lands on top of the revealed recovery1 (live 100 -> 200).
        state.PushRecoveryVessel("recovery2", ut: 5.0);
        var away2 = state.OnFundsChanged(StockTransactionReason.VesselRecovery, newTotal: 200.0, baseAmount: 100.0, ut: 5.1);
        Assert.True(away2.IsAway);
        Assert.Equal(100.0, away2.ShadowToRestore); // never 0 - that would erase recovery1's revealed funds

        state.SyncShadowFunds(away2.ShadowToRestore);
        state.SyncShadowFunds(200.0);
        Assert.Equal(200.0, state.ShadowFunds);
    }

    [Fact]
    public void a_reveal_advances_the_shadow_so_a_later_neutralise_does_not_erase_it_reputation()
    {
        var state = Seeded(reputation: 0.0);

        state.PushRecoveryVessel("recovery1", ut: 0.0);
        var away1 = state.OnReputationChanged(StockTransactionReason.VesselRecovery, newTotal: 10.0, baseAmount: 10.0, ut: 0.1);
        Assert.True(away1.IsAway);
        Assert.Equal(0.0, away1.ShadowToRestore);

        state.SyncShadowReputation(0.0);
        state.SyncShadowReputation(10.0);
        Assert.Equal(10.0, state.ShadowReputation);

        state.PushRecoveryVessel("recovery2", ut: 5.0);
        var away2 = state.OnReputationChanged(StockTransactionReason.VesselRecovery, newTotal: 20.0, baseAmount: 10.0, ut: 5.1);
        Assert.True(away2.IsAway);
        Assert.Equal(10.0, away2.ShadowToRestore); // never 0 - that would erase recovery1's revealed reputation

        state.SyncShadowReputation(away2.ShadowToRestore);
        state.SyncShadowReputation(20.0);
        Assert.Equal(20.0, state.ShadowReputation);
    }

    // Three rig runs read the shadow as 2.000 at every sample while the live
    // balance walked 2 -> 27 -> 52 -> 82, with the interceptor reporting itself
    // subscribed. These two tests say that reading cannot be produced by a
    // machine that saw those events, whichever way it classified them, so it is
    // a measurement of an object that did NOT see them.
    //
    // ResearchAndDevelopment.AddScience fires OnScienceChanged unconditionally
    // (decompile-confirmed against the installed Assembly-CSharp: it mutates
    // science, fires OnCurrencyModifierQuery, OnCurrencyModified, then
    // OnScienceChanged), so a subscribed interceptor's handler necessarily ran
    // three times.
    [Fact]
    public void three_away_reason_science_changes_a_window_apart_never_leave_the_shadow_at_its_seed()
    {
        var state = Seeded(science: 2.0);

        // The interceptor's own glue order: settle stale defers against the new
        // total, then classify. No vessel is ever named, so each change defers
        // and the one after it settles that defer HOME.
        state.SettleStaleScienceDefers(ut: 100.0, currentLiveScience: 27.0);
        Assert.Equal(ScienceChangeOutcome.Deferred,
            state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 27.0, baseAmount: 25.0, ut: 100.0).Outcome);
        Assert.Equal(2.0, state.ShadowScience);

        state.SettleStaleScienceDefers(ut: 200.0, currentLiveScience: 52.0);
        Assert.Equal(ScienceChangeOutcome.Deferred,
            state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 52.0, baseAmount: 25.0, ut: 200.0).Outcome);

        // The second change is what makes the seed unreachable: its stale-defer
        // settle catches up to the live balance before anything else happens.
        Assert.Equal(52.0, state.ShadowScience);

        state.SettleStaleScienceDefers(ut: 300.0, currentLiveScience: 82.0);
        state.OnScienceChanged(StockTransactionReason.ScienceTransmission, newTotal: 82.0, baseAmount: 30.0, ut: 300.0);
        Assert.Equal(82.0, state.ShadowScience);
    }

    // The other branch, for completeness: a reason outside the away set resolves
    // HOME immediately and writes the shadow on the very first change. Between
    // this and the test above, every classification an AddScience award can land
    // in moves the shadow off its seed, so no run of three awards can report it
    // unmoved.
    [Fact]
    public void a_home_reason_science_change_writes_the_shadow_on_the_first_change()
    {
        var state = Seeded(science: 2.0);

        Assert.Equal(ScienceChangeOutcome.Home,
            state.OnScienceChanged(StockTransactionReason.None, newTotal: 27.0, baseAmount: 25.0, ut: 100.0).Outcome);
        Assert.Equal(27.0, state.ShadowScience);
    }
}
