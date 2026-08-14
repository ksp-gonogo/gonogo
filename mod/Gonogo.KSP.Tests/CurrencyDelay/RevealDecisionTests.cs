using System.Collections.Generic;
using Gonogo.KSP.CurrencyDelay;
using Xunit;

public class RevealDecisionTests
{
    private static PendingCreditRow Row(DelayedCurrency currency, double baseAmount, string originVesselId = "vessel-1")
    {
        return new PendingCreditRow(currency, baseAmount, revealUt: 0, originVesselId, originDescription: "");
    }

    [Fact]
    public void Plan_applies_matured_rows_in_the_same_order_they_were_supplied()
    {
        var matured = new List<PendingCreditRow>
        {
            Row(DelayedCurrency.Science, 5.0, "first"),
            Row(DelayedCurrency.Funds, 1000.0, "second"),
            Row(DelayedCurrency.Reputation, -10.0, "third"),
        };

        var plan = RevealDecision.Plan(matured);

        Assert.Equal(3, plan.Count);
        Assert.Equal(DelayedCurrency.Science, plan[0].Currency);
        Assert.Equal(5.0, plan[0].BaseAmount);
        Assert.Equal(DelayedCurrency.Funds, plan[1].Currency);
        Assert.Equal(1000.0, plan[1].BaseAmount);
        Assert.Equal(DelayedCurrency.Reputation, plan[2].Currency);
        Assert.Equal(-10.0, plan[2].BaseAmount);
    }

    [Fact]
    public void Plan_preserves_the_base_amount_verbatim_including_negative_reputation_penalties()
    {
        var matured = new List<PendingCreditRow> { Row(DelayedCurrency.Reputation, -18.72) };

        var plan = RevealDecision.Plan(matured);

        Assert.Equal(-18.72, Assert.Single(plan).BaseAmount);
    }

    [Fact]
    public void Plan_drops_zero_amount_rows()
    {
        var matured = new List<PendingCreditRow>
        {
            Row(DelayedCurrency.Funds, 0.0),
            Row(DelayedCurrency.Science, 5.0),
        };

        var plan = RevealDecision.Plan(matured);

        var only = Assert.Single(plan);
        Assert.Equal(DelayedCurrency.Science, only.Currency);
    }

    [Fact]
    public void Plan_of_an_empty_list_is_empty()
    {
        Assert.Empty(RevealDecision.Plan(new List<PendingCreditRow>()));
    }

    [Fact]
    public void Plan_of_null_is_empty_not_a_throw()
    {
        Assert.Empty(RevealDecision.Plan(null!));
    }
}
