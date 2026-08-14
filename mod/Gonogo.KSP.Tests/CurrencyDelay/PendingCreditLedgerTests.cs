using System.Collections.Generic;
using Gonogo.KSP.CurrencyDelay;
using Xunit;

public class PendingCreditLedgerTests
{
    private static PendingCreditRow Row(
        DelayedCurrency currency = DelayedCurrency.Funds,
        double baseAmount = 100,
        double revealUt = 1000,
        string originVesselId = "vessel-1",
        string originDescription = "Mun science transmission")
    {
        return new PendingCreditRow(currency, baseAmount, revealUt, originVesselId, originDescription);
    }

    [Fact]
    public void Enqueue_adds_to_pending()
    {
        var ledger = new PendingCreditLedger();
        ledger.Enqueue(Row(revealUt: 500));

        Assert.Single(ledger.Pending);
        Assert.Equal(500, ledger.Pending[0].RevealUt);
    }

    [Fact]
    public void PopMatured_returns_rows_in_enqueue_order_and_removes_them_from_pending()
    {
        var ledger = new PendingCreditLedger();
        ledger.Enqueue(Row(revealUt: 100, originVesselId: "first"));
        ledger.Enqueue(Row(revealUt: 200, originVesselId: "second"));
        ledger.Enqueue(Row(revealUt: 300, originVesselId: "third"));

        var matured = ledger.PopMatured(250);

        Assert.Equal(new[] { "first", "second" }, matured.ConvertAll(r => r.OriginVesselId));
        Assert.Single(ledger.Pending);
        Assert.Equal("third", ledger.Pending[0].OriginVesselId);
    }

    [Fact]
    public void PopMatured_at_a_warp_jump_returns_every_matured_row_in_one_call()
    {
        // Time-warp can jump UT past many reveals at once - PopMatured must
        // never require one call per row.
        var ledger = new PendingCreditLedger();
        for (int i = 0; i < 25; i++)
        {
            ledger.Enqueue(Row(revealUt: i * 10, originVesselId: $"vessel-{i}"));
        }

        var matured = ledger.PopMatured(1_000_000);

        Assert.Equal(25, matured.Count);
        Assert.Empty(ledger.Pending);
    }

    [Fact]
    public void PopMatured_with_nothing_matured_returns_empty_and_leaves_pending_untouched()
    {
        var ledger = new PendingCreditLedger();
        ledger.Enqueue(Row(revealUt: 500));
        ledger.Enqueue(Row(revealUt: 600));

        var matured = ledger.PopMatured(100);

        Assert.Empty(matured);
        Assert.Equal(2, ledger.Pending.Count);
    }

    [Fact]
    public void PopMatured_uses_less_than_or_equal_so_a_row_due_exactly_now_matures()
    {
        var ledger = new PendingCreditLedger();
        ledger.Enqueue(Row(revealUt: 500));

        var matured = ledger.PopMatured(500);

        Assert.Single(matured);
        Assert.Empty(ledger.Pending);
    }

    [Fact]
    public void ConfigNode_round_trip_preserves_every_field()
    {
        var ledger = new PendingCreditLedger();
        ledger.Enqueue(new PendingCreditRow(
            DelayedCurrency.Science,
            baseAmount: 42.5,
            revealUt: 123456.75,
            originVesselId: "vessel-abc",
            originDescription: "mysteryGoo@Mun transmission"));
        ledger.Enqueue(new PendingCreditRow(
            DelayedCurrency.Funds,
            baseAmount: 10000,
            revealUt: 999,
            originVesselId: "vessel-def",
            originDescription: "recovered craft"));

        var node = ledger.ToConfigNode();
        var restored = PendingCreditLedger.FromConfigNode(node);

        Assert.Equal(2, restored.Pending.Count);

        var science = restored.Pending[0];
        Assert.Equal(DelayedCurrency.Science, science.Currency);
        Assert.Equal(42.5, science.BaseAmount);
        Assert.Equal(123456.75, science.RevealUt);
        Assert.Equal("vessel-abc", science.OriginVesselId);
        Assert.Equal("mysteryGoo@Mun transmission", science.OriginDescription);

        var funds = restored.Pending[1];
        Assert.Equal(DelayedCurrency.Funds, funds.Currency);
        Assert.Equal(10000, funds.BaseAmount);
        Assert.Equal(999, funds.RevealUt);
        Assert.Equal("vessel-def", funds.OriginVesselId);
        Assert.Equal("recovered craft", funds.OriginDescription);
    }

    [Fact]
    public void ConfigNode_round_trip_preserves_the_reputation_base_amount_not_a_clamped_delta()
    {
        // Reputation must store+replay the BASE requested amount (pre-clamp),
        // never the applied/clamped delta - see the feasibility study's
        // clamp-drift correction. A base amount larger than what could ever
        // land as an applied delta (RepRange is +-1000) proves this ledger
        // does not silently clamp on the way through ConfigNode.
        var ledger = new PendingCreditLedger();
        ledger.Enqueue(new PendingCreditRow(
            DelayedCurrency.Reputation,
            baseAmount: 1500,
            revealUt: 42,
            originVesselId: "vessel-rep",
            originDescription: "far-side contract completion"));

        var restored = PendingCreditLedger.FromConfigNode(ledger.ToConfigNode());

        var row = Assert.Single(restored.Pending);
        Assert.Equal(DelayedCurrency.Reputation, row.Currency);
        Assert.Equal(1500, row.BaseAmount);
    }

    [Fact]
    public void ConfigNode_round_trip_of_an_empty_ledger_stays_empty()
    {
        var ledger = new PendingCreditLedger();

        var restored = PendingCreditLedger.FromConfigNode(ledger.ToConfigNode());

        Assert.Empty(restored.Pending);
    }

    [Fact]
    public void FromConfigNode_of_a_null_node_returns_an_empty_ledger()
    {
        var restored = PendingCreditLedger.FromConfigNode(null!);

        Assert.Empty(restored.Pending);
    }
}
