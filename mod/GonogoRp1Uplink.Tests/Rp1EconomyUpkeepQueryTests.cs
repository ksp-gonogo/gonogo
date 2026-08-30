using System;
using GonogoRp1Uplink;
using RP0;
using Xunit;

/// <summary>
/// The main-thread half of the upkeep reading: RP-1's own per-line currency
/// query, and the change-gate that keeps it from broadcasting every tick.
/// </summary>
/// <remarks>
/// Split from <c>Rp1EconomyBackendTests</c> because it is about cost and cadence
/// rather than about the shape of a reading. The query fires
/// <c>GameEvents.Modifiers.OnCurrencyModifierQuery</c> at every modifier in the
/// save, and this source is registered UNGATED (it feeds core's career.status, so
/// a subscription gate would starve it silently). The gate below is therefore the
/// only thing between one broadcast an in-game hour and six every physics frame,
/// and nothing else in the tree would notice it going away.
/// </remarks>
[Collection("rp0-static-graph")]
public class Rp1EconomyUpkeepQueryTests : IDisposable
{
    public Rp1EconomyUpkeepQueryTests()
    {
        MaintenanceHandler.Instance = null;
        CurrencyUtils.Reset();
    }

    public void Dispose()
    {
        MaintenanceHandler.Instance = null;
        CurrencyUtils.Reset();
    }

    private static MaintenanceHandler Costed() => new MaintenanceHandler
    {
        FacilityUpkeepValue = 100.0,
        LCsCostPerDay = 200.0,
        ResearchSalaryPerDay = 300.0,
        TrainingUpkeepPerDay = 400.0,
        NautBaseUpkeepPerDay = 500.0,
        NautInFlightUpkeepPerDay = 600.0,
        IntegrationSalaryValue = 700.0,
    };

    private static Rp1UpkeepLines? Capture(Rp1EconomyUpkeepQuery query) =>
        query.CaptureOnMain(null) as Rp1UpkeepLines;

    [Fact]
    public void An_unchanged_career_is_priced_once_and_not_again()
    {
        MaintenanceHandler.Instance = Costed();
        var query = new Rp1EconomyUpkeepQuery();

        Capture(query);
        var afterFirst = CurrencyUtils.Queries;
        for (var i = 0; i < 20; i++)
        {
            Capture(query);
        }

        Assert.Equal(7, afterFirst);
        Assert.Equal(afterFirst, CurrencyUtils.Queries);
    }

    [Fact]
    public void A_cost_that_moved_is_repriced()
    {
        var handler = Costed();
        MaintenanceHandler.Instance = handler;
        var query = new Rp1EconomyUpkeepQuery();
        Capture(query);

        handler.ResearchSalaryPerDay = 900.0;
        var lines = Capture(query);

        Assert.Equal(900.0, lines!.ResearchSalary!.Value, 6);
    }

    [Fact]
    public void A_leader_taken_on_without_moving_a_cost_is_still_picked_up()
    {
        // The gate's second half, and the one that is not obvious. A leader
        // changes what the six queries answer while every raw cost stands still,
        // so a gate on the costs alone would hold the old prices for as long as
        // the career sat still. RP-1 rebuilds UpkeepPerDayForDisplay from those
        // same six queries on its own hourly tick, so watching it is watching the
        // modifiers without asking them.
        var handler = Costed();
        handler.UpdateUpkeep();
        MaintenanceHandler.Instance = handler;
        var query = new Rp1EconomyUpkeepQuery();
        Capture(query);

        CurrencyUtils.Multipliers[TransactionReasonsRP0.SalaryCrew] = 0.5;
        handler.UpdateUpkeep();
        var lines = Capture(query);

        Assert.Equal(250.0, lines!.CrewBase!.Value, 6);
        Assert.Equal(300.0, lines.CrewInFlight!.Value, 6);
    }

    [Fact]
    public void A_save_RP1_stops_managing_drops_the_prices_rather_than_holding_them()
    {
        // Back to the main menu and into another career. Holding the last save's
        // prices would put one career's leaders on another career's ledger, and
        // the change-gate would see nothing to recompute.
        var handler = Costed();
        MaintenanceHandler.Instance = handler;
        var query = new Rp1EconomyUpkeepQuery();
        Capture(query);

        MaintenanceHandler.Instance = null;
        Assert.Null(Capture(query));

        MaintenanceHandler.Instance = Costed();
        Assert.NotNull(Capture(query));
    }

    [Fact]
    public void A_career_costing_nothing_prices_at_zero_rather_than_negative_zero()
    {
        // Negating a zero is how a wire field ends up carrying -0, which survives
        // JSON and prints as "-0" in front of an operator.
        MaintenanceHandler.Instance = new MaintenanceHandler();

        var lines = Capture(new Rp1EconomyUpkeepQuery())!;

        Assert.Equal(0.0, lines.Facilities!.Value, 6);
        Assert.False(double.IsNegative(lines.Facilities.Value));
    }

    [Fact]
    public void One_line_that_cannot_be_priced_takes_all_seven()
    {
        // A breakdown with a hole in it does not sum to the total, and the hole
        // would be invisible beside six numbers that look fine.
        MaintenanceHandler.Instance = Costed();
        CurrencyUtils.ThrowOnQuery = true;

        Assert.Null(Capture(new Rp1EconomyUpkeepQuery()));
    }

    [Fact]
    public void The_crew_line_is_priced_the_way_RP1s_own_budget_tab_prices_it()
    {
        // RP-1 disagrees with itself here: UpdateUpkeep runs ONE SalaryCrew query
        // on base + in-flight, its Budget tab runs TWO and adds them. GetTotal is
        // affine, so the two differ by one copy of any post-multiplier delta. We
        // follow the Budget tab, because that is the screen an operator checks us
        // against and because the wire carries the two lines separately.
        CurrencyUtils.PostDeltas[TransactionReasonsRP0.SalaryCrew] = -10.0;
        MaintenanceHandler.Instance = Costed();

        var lines = Capture(new Rp1EconomyUpkeepQuery())!;

        Assert.Equal(510.0, lines.CrewBase!.Value, 6);
        Assert.Equal(610.0, lines.CrewInFlight!.Value, 6);
    }
}
