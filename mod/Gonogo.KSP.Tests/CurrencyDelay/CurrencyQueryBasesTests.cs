using Gonogo.KSP.CurrencyDelay;
using Xunit;

/// <summary>
/// The per-currency modifier-query capture, and specifically the interleaving
/// that used to defeat it. Every case here is reachable with no KSP types at
/// all, which is the point: the shape it produces on a live install
/// (StockCurrencyInterceptor.cs, excluded from this project) is a change that
/// resolves AWAY, claims its vessel, and then does nothing whatever, leaving no
/// pending row, no defer and no correlation entry for anything to read.
/// </summary>
public class CurrencyQueryBasesTests
{
    private const double Ut = 1_000.0;

    [Fact]
    public void A_query_is_the_base_for_the_change_that_follows_it()
    {
        var bases = new CurrencyQueryBases();
        bases.Capture(StockTransactionReason.ScienceTransmission, funds: 0.0, science: 25.0, reputation: 0.0, ut: Ut);

        Assert.Equal(25.0, bases.Consume(StockTransactionReason.ScienceTransmission, CurrencyKind.Science, Ut, fallback: -1.0));
    }

    [Fact]
    public void A_base_is_claimable_once()
    {
        var bases = new CurrencyQueryBases();
        bases.Capture(StockTransactionReason.ScienceTransmission, 0.0, 25.0, 0.0, Ut);

        bases.Consume(StockTransactionReason.ScienceTransmission, CurrencyKind.Science, Ut, fallback: -1.0);

        Assert.Equal(-1.0, bases.Consume(StockTransactionReason.ScienceTransmission, CurrencyKind.Science, Ut, fallback: -1.0));
    }

    [Fact]
    public void A_query_under_a_different_reason_is_not_the_base()
    {
        var bases = new CurrencyQueryBases();
        bases.Capture(StockTransactionReason.ContractReward, 0.0, 25.0, 0.0, Ut);

        Assert.Equal(-1.0, bases.Consume(StockTransactionReason.ScienceTransmission, CurrencyKind.Science, Ut, fallback: -1.0));
    }

    /// <summary>
    /// The rig defect, request <c>away-arm-first-1</c> on 2026-08-27.
    /// <c>ResearchAndDevelopment.AddScience</c> (RP-1 replaces it wholesale via
    /// <c>PatchRnD.Prefix_AddScience</c>) fires the modifier query, then
    /// <c>OnCurrencyModified</c>, then <c>OnScienceChanged</c> - and in the
    /// middle of that, <c>RP0.Confidence.OnCurrenciesModified</c> prices the
    /// Confidence it is about to award through
    /// <c>CurrencyUtils.Conf(TransactionReasonsRP0.ScienceTransmission, ...)</c>,
    /// which runs a whole second query. That query's reason is 0x400, the same
    /// value as stock's ScienceTransmission, and its science input is zero
    /// because it is asking about Confidence.
    ///
    /// <para>In one shared slot it overwrote the real 25, the science change
    /// resolved with a base of zero, and the away arm returned without
    /// neutralising or crediting anything.</para>
    /// </summary>
    [Fact]
    public void A_zero_science_query_between_the_real_one_and_the_change_does_not_become_the_base()
    {
        var bases = new CurrencyQueryBases();

        bases.Capture(StockTransactionReason.ScienceTransmission, funds: 0.0, science: 25.0, reputation: 0.0, ut: Ut);
        bases.Capture(StockTransactionReason.ScienceTransmission, funds: 0.0, science: 0.0, reputation: 0.0, ut: Ut);

        Assert.Equal(25.0, bases.Consume(StockTransactionReason.ScienceTransmission, CurrencyKind.Science, Ut, fallback: -1.0));
    }

    [Fact]
    public void A_query_about_another_currency_leaves_this_ones_base_alone()
    {
        var bases = new CurrencyQueryBases();

        bases.Capture(StockTransactionReason.VesselRecovery, funds: 0.0, science: 25.0, reputation: 0.0, ut: Ut);
        bases.Capture(StockTransactionReason.VesselRecovery, funds: 900.0, science: 0.0, reputation: 0.0, ut: Ut);

        Assert.Equal(25.0, bases.Consume(StockTransactionReason.VesselRecovery, CurrencyKind.Science, Ut, fallback: -1.0));
        Assert.Equal(900.0, bases.Consume(StockTransactionReason.VesselRecovery, CurrencyKind.Funds, Ut, fallback: -1.0));
    }

    [Fact]
    public void One_recovery_can_carry_a_base_for_all_three_currencies_at_once()
    {
        var bases = new CurrencyQueryBases();
        bases.Capture(StockTransactionReason.VesselRecovery, funds: 900.0, science: 25.0, reputation: 3.0, ut: Ut);

        Assert.Equal(900.0, bases.Consume(StockTransactionReason.VesselRecovery, CurrencyKind.Funds, Ut, fallback: -1.0));
        Assert.Equal(25.0, bases.Consume(StockTransactionReason.VesselRecovery, CurrencyKind.Science, Ut, fallback: -1.0));
        Assert.Equal(3.0, bases.Consume(StockTransactionReason.VesselRecovery, CurrencyKind.Reputation, Ut, fallback: -1.0));
    }

    /// <summary>A query nothing follows is ordinary: pricing a purchase for display runs one. It must not become some later change's base.</summary>
    [Fact]
    public void A_base_no_change_claimed_expires_instead_of_waiting_for_one()
    {
        var bases = new CurrencyQueryBases();
        bases.Capture(StockTransactionReason.ScienceTransmission, 0.0, 25.0, 0.0, Ut);

        var later = Ut + CurrencyQueryBases.FreshnessWindowUt + 0.001;

        Assert.Equal(-1.0, bases.Consume(StockTransactionReason.ScienceTransmission, CurrencyKind.Science, later, fallback: -1.0));
    }

    [Fact]
    public void A_penalty_is_a_base_like_any_other()
    {
        var bases = new CurrencyQueryBases();
        bases.Capture(StockTransactionReason.VesselLoss, funds: 0.0, science: 0.0, reputation: -8.0, ut: Ut);

        Assert.Equal(-8.0, bases.Consume(StockTransactionReason.VesselLoss, CurrencyKind.Reputation, Ut, fallback: -1.0));
    }
}
