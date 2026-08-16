using System;
using System.Collections.Generic;
using Gonogo.KSP.CurrencyDelay;
using Sitrep.Host.Comms;
using Xunit;

public class StockCurrencyDecisionTests
{
    // The reasons the currency-delay feasibility study and its live spike
    // confirmed carry (or, for VesselLoss, can be correlated with) a
    // resolvable vessel. Stock lab transmission also lands under
    // ScienceTransmission (a routing detail in the KSP glue, not a
    // different reason), so it needs no separate case here. VesselLoss
    // (the crew-death reputation penalty) carries no vessel on its own
    // event - "hasVessel" here means the state machine's
    // PushDeathVessel/TryClaimDeathVessel correlation resolved one.
    public static IEnumerable<object[]> AwayReasons => new[]
    {
        new object[] { StockTransactionReason.ScienceTransmission },
        new object[] { StockTransactionReason.VesselRecovery },
        new object[] { StockTransactionReason.VesselLoss },
    };

    // Every other named reason in the confirmed table, all HOME regardless
    // of whether a vessel happens to be resolvable.
    public static IEnumerable<object[]> HomeReasons => new[]
    {
        new object[] { StockTransactionReason.None },
        new object[] { StockTransactionReason.ContractAdvance },
        new object[] { StockTransactionReason.ContractReward },
        new object[] { StockTransactionReason.ContractPenalty },
        new object[] { StockTransactionReason.VesselRollout },
        new object[] { StockTransactionReason.StrategyInput },
        new object[] { StockTransactionReason.StrategyOutput },
        new object[] { StockTransactionReason.StrategySetup },
        new object[] { StockTransactionReason.StructureRepair },
        new object[] { StockTransactionReason.StructureCollapse },
        new object[] { StockTransactionReason.StructureConstruction },
        new object[] { StockTransactionReason.RnDTechResearch },
        new object[] { StockTransactionReason.RnDPartPurchase },
        new object[] { StockTransactionReason.Cheating },
        new object[] { StockTransactionReason.CrewRecruited },
        new object[] { StockTransactionReason.ContractDecline },
        new object[] { StockTransactionReason.Progression },
        new object[] { StockTransactionReason.Mission },
    };

    [Theory]
    [MemberData(nameof(AwayReasons))]
    public void ClassifyOrigin_is_Away_for_a_vessel_bearing_reason_with_a_resolved_vessel(StockTransactionReason reason)
    {
        Assert.Equal(CurrencyOrigin.Away, StockCurrencyDecision.ClassifyOrigin(reason, hasVessel: true));
    }

    [Theory]
    [MemberData(nameof(AwayReasons))]
    public void ClassifyOrigin_degrades_to_Home_when_the_vessel_bearing_reason_has_no_resolved_vessel(StockTransactionReason reason)
    {
        // The mod-award / reverse-engineered-recovery degrade case from the
        // feasibility study: a null source means no honest reveal clock, so
        // it falls back to instant rather than inventing an origin.
        Assert.Equal(CurrencyOrigin.Home, StockCurrencyDecision.ClassifyOrigin(reason, hasVessel: false));
    }

    [Theory]
    [MemberData(nameof(HomeReasons))]
    public void ClassifyOrigin_is_always_Home_for_every_other_reason_even_with_a_vessel(StockTransactionReason reason)
    {
        // Every reason in the confirmed table other than the two AWAY ones is
        // HOME regardless of hasVessel - a caller passing hasVessel: true for
        // e.g. RnDTechResearch (which never actually happens live) must not
        // accidentally delay it.
        Assert.Equal(CurrencyOrigin.Home, StockCurrencyDecision.ClassifyOrigin(reason, hasVessel: true));
        Assert.Equal(CurrencyOrigin.Home, StockCurrencyDecision.ClassifyOrigin(reason, hasVessel: false));
    }

    [Fact]
    public void HomeReasons_and_AwayReasons_cover_every_named_member_of_StockTransactionReason()
    {
        // Guards the two lists above against drifting out of sync with the
        // enum itself if a member is ever added or renamed.
        var covered = new HashSet<StockTransactionReason>();
        foreach (var row in AwayReasons) covered.Add((StockTransactionReason)row[0]);
        foreach (var row in HomeReasons) covered.Add((StockTransactionReason)row[0]);

        foreach (StockTransactionReason reason in Enum.GetValues(typeof(StockTransactionReason)))
        {
            Assert.Contains(reason, covered);
        }
    }

    [Fact]
    public void BuildCredit_reveals_at_nowUt_plus_lightTime()
    {
        var credit = StockCurrencyDecision.BuildCredit(
            CurrencyKind.Science, baseAmount: 12.5, shadowBalance: 100.0,
            originVesselId: "vessel-1", delay: KscDelay.Routed(42.0), config: new SignalDelayConfig { Enabled = true, SilenceDeclarationSeconds = 86_400.0 }, nowUt: 1000.0);

        Assert.NotNull(credit);
        Assert.Equal(1042.0, credit!.Value.RevealUt);
    }

    [Fact]
    public void BuildCredit_stores_the_base_amount_unmodified()
    {
        var credit = StockCurrencyDecision.BuildCredit(
            CurrencyKind.Funds, baseAmount: 340.75, shadowBalance: 9999.0,
            originVesselId: "vessel-1", delay: KscDelay.Routed(5.0), config: new SignalDelayConfig { Enabled = true, SilenceDeclarationSeconds = 86_400.0 }, nowUt: 0.0);

        Assert.Equal(340.75, credit!.Value.BaseAmount);
    }

    [Fact]
    public void BuildCredit_stores_the_reputation_base_not_a_shadow_derived_delta()
    {
        // The reputation-clamp-drift correction the feasibility study caught
        // itself getting backwards: a base of -10 rep applies as ~-18.7 live
        // (curve-normalised against the balance it lands on), so the ledger
        // must carry the BASE the query captured, never something computed
        // from the shadow balance (which would silently re-encode whatever
        // normalisation happened at earn time instead of leaving it for
        // reveal time). Proven here by holding baseAmount fixed and varying
        // shadowBalance across a wide range: the stored amount must not move.
        var atLowShadow = StockCurrencyDecision.BuildCredit(
            CurrencyKind.Reputation, baseAmount: -10.0, shadowBalance: 0.0,
            originVesselId: "vessel-1", delay: KscDelay.Routed(10.0), config: new SignalDelayConfig { Enabled = true, SilenceDeclarationSeconds = 86_400.0 }, nowUt: 500.0);
        var atHighShadow = StockCurrencyDecision.BuildCredit(
            CurrencyKind.Reputation, baseAmount: -10.0, shadowBalance: 995.0,
            originVesselId: "vessel-1", delay: KscDelay.Routed(10.0), config: new SignalDelayConfig { Enabled = true, SilenceDeclarationSeconds = 86_400.0 }, nowUt: 500.0);

        Assert.Equal(-10.0, atLowShadow!.Value.BaseAmount);
        Assert.Equal(-10.0, atHighShadow!.Value.BaseAmount);
        Assert.Equal(atLowShadow.Value.BaseAmount, atHighShadow.Value.BaseAmount);
    }

    [Fact]
    public void BuildCredit_passes_through_the_origin_vessel_id()
    {
        var credit = StockCurrencyDecision.BuildCredit(
            CurrencyKind.Science, baseAmount: 1.0, shadowBalance: 0.0,
            originVesselId: "abc-123", delay: KscDelay.Routed(0.0), config: new SignalDelayConfig { Enabled = true, SilenceDeclarationSeconds = 86_400.0 }, nowUt: 0.0);

        Assert.Equal("abc-123", credit!.Value.OriginVesselId);
    }

    [Fact]
    public void BuildCredit_with_a_null_origin_vessel_id_stores_empty_string_not_null()
    {
        var credit = StockCurrencyDecision.BuildCredit(
            CurrencyKind.Science, baseAmount: 1.0, shadowBalance: 0.0,
            originVesselId: null!, delay: KscDelay.Routed(0.0), config: new SignalDelayConfig { Enabled = true, SilenceDeclarationSeconds = 86_400.0 }, nowUt: 0.0);

        Assert.Equal("", credit!.Value.OriginVesselId);
    }

    [Fact]
    public void BuildCredit_of_a_zero_base_amount_is_null()
    {
        var credit = StockCurrencyDecision.BuildCredit(
            CurrencyKind.Funds, baseAmount: 0.0, shadowBalance: 500.0,
            originVesselId: "vessel-1", delay: KscDelay.Routed(10.0), config: new SignalDelayConfig { Enabled = true, SilenceDeclarationSeconds = 86_400.0 }, nowUt: 0.0);

        Assert.Null(credit);
    }

    [Fact]
    public void BuildCredit_zero_lightTime_reveals_immediately_at_nowUt()
    {
        // A credit earned at (or very near) KSC has zero light-time and
        // reveals at the same instant it was earned - the correct behaviour
        // for e.g. a recovery on the launchpad.
        var credit = StockCurrencyDecision.BuildCredit(
            CurrencyKind.Funds, baseAmount: 250.0, shadowBalance: 1000.0,
            originVesselId: "vessel-1", delay: KscDelay.Routed(0.0), config: new SignalDelayConfig { Enabled = true, SilenceDeclarationSeconds = 86_400.0 }, nowUt: 777.0);

        Assert.Equal(777.0, credit!.Value.RevealUt);
    }
}
