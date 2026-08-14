using System.Linq;
using Gonogo.KSP.CurrencyDelay;
using Xunit;

public class CurrencyDelayLedgerPersistenceTests
{
    private static PendingCreditRow Row(string originVesselId, double revealUt) =>
        new PendingCreditRow(DelayedCurrency.Science, baseAmount: 12.5, revealUt, originVesselId, "test row");

    [Fact]
    public void Save_then_Load_restores_every_row_into_the_target_ledger()
    {
        var source = new PendingCreditLedger();
        source.Enqueue(Row("vessel-1", 100));
        source.Enqueue(Row("vessel-2", 200));

        var node = new ConfigNode("SCENARIO");
        CurrencyDelayLedgerPersistence.Save(source, node);

        var target = new PendingCreditLedger();
        CurrencyDelayLedgerPersistence.Load(target, node);

        Assert.Equal(new[] { "vessel-1", "vessel-2" }, target.Pending.Select(r => r.OriginVesselId).ToList());
    }

    [Fact]
    public void Load_merges_into_the_SAME_ledger_instance_rather_than_replacing_it()
    {
        // The whole point of CurrencyDelayLedgerPersistence: CurrencyDelayScenario hands this
        // exact ledger reference to the interceptor/applier before OnLoad runs, so Load must
        // mutate it in place, not return a different object those consumers never see.
        var target = new PendingCreditLedger();
        target.Enqueue(Row("pre-existing", 50));

        var source = new PendingCreditLedger();
        source.Enqueue(Row("loaded", 150));
        var node = new ConfigNode("SCENARIO");
        CurrencyDelayLedgerPersistence.Save(source, node);

        var sameInstance = target;
        CurrencyDelayLedgerPersistence.Load(target, node);

        Assert.Same(sameInstance, target);
        Assert.Equal(new[] { "pre-existing", "loaded" }, target.Pending.Select(r => r.OriginVesselId).ToList());
    }

    [Fact]
    public void Load_of_a_node_with_no_ledger_child_leaves_the_target_ledger_untouched()
    {
        // A brand-new game, or a save from before this subsystem existed, has no
        // PENDING_CREDIT_LEDGER node at all.
        var target = new PendingCreditLedger();
        target.Enqueue(Row("kept", 10));

        var node = new ConfigNode("SCENARIO");
        CurrencyDelayLedgerPersistence.Load(target, node);

        var row = Assert.Single(target.Pending);
        Assert.Equal("kept", row.OriginVesselId);
    }

    [Fact]
    public void Save_preserves_every_field_through_the_nested_node()
    {
        var source = new PendingCreditLedger();
        source.Enqueue(new PendingCreditRow(
            DelayedCurrency.Reputation,
            baseAmount: -18.72,
            revealUt: 5000.5,
            originVesselId: "vessel-rep",
            originDescription: "crew loss"));

        var node = new ConfigNode("SCENARIO");
        CurrencyDelayLedgerPersistence.Save(source, node);

        var target = new PendingCreditLedger();
        CurrencyDelayLedgerPersistence.Load(target, node);

        var row = Assert.Single(target.Pending);
        Assert.Equal(DelayedCurrency.Reputation, row.Currency);
        Assert.Equal(-18.72, row.BaseAmount);
        Assert.Equal(5000.5, row.RevealUt);
        Assert.Equal("vessel-rep", row.OriginVesselId);
        Assert.Equal("crew loss", row.OriginDescription);
    }
}
