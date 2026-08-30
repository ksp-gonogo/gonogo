using System;
using GonogoRp1Uplink;
using RP0;
using Sitrep.Contract;
using Xunit;

/// <summary>
/// RP-1's economy interpretation, against the stand-in maintenance handler.
///
/// <para>These are about SHAPE and about the two unit conversions, which are the
/// parts most likely to be silently wrong: a yearly subsidy published as a daily
/// one, and a decay PORTION published as an absolute loss. Neither error would
/// look like an error on screen.</para>
/// </summary>
[Collection("rp0-static-graph")]
public class Rp1EconomyBackendTests : IDisposable
{
    public Rp1EconomyBackendTests()
    {
        MaintenanceHandler.Instance = null;
        UnlockCreditHandler.Instance = null;
        CurrencyUtils.Reset();
    }

    public void Dispose()
    {
        MaintenanceHandler.Instance = null;
        UnlockCreditHandler.Instance = null;
        CurrencyUtils.Reset();
    }

    /// <summary>
    /// A backend with its upkeep pricing already run once, which is how it stands
    /// in production: the query is captured on the main thread and the reading is
    /// built from what that left behind.
    /// </summary>
    private static Rp1EconomyBackend Primed(out Rp1EconomyUpkeepQuery query)
    {
        query = new Rp1EconomyUpkeepQuery();
        var backend = new Rp1EconomyBackend(query);
        query.HandleOnCourier(query.CaptureOnMain(null));
        return backend;
    }

    private static Rp1EconomyBackend Primed() => Primed(out _);

    [Fact]
    public void It_offers_itself_as_the_rp1_provider()
    {
        var backend = new Rp1EconomyBackend();
        Assert.Equal("rp1", backend.ProviderId);
        Assert.True(backend.IsAvailable);
    }

    [Fact]
    public void Nothing_is_said_while_the_maintenance_module_is_not_live()
    {
        // The main menu, and a save RP-1 does not manage. A bag of zeros here
        // would state stock's answer in RP-1's name.
        Assert.Null(new Rp1EconomyBackend().Interpret(ut: 0.0, reputation: 100.0));
    }

    /// <summary>Seven distinct raw costs, so a line priced against the wrong reason is visible.</summary>
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

    private static double Sum(EconomyUpkeepBreakdown parts) =>
        parts.Facilities!.Value + parts.LaunchComplexes!.Value + parts.ResearchSalary!.Value
        + parts.Training!.Value + parts.CrewBase!.Value + parts.CrewInFlight!.Value
        + parts.IntegrationSalary!.Value;

    [Fact]
    public void The_breakdown_adds_up_to_the_total_while_a_leader_is_discounting_a_line()
    {
        // THE DEFECT. RP-1 states its per-source costs before its own currency
        // modifiers and its total after them, so publishing the raw fields under
        // the modified total gave an operator seven numbers that did not add up to
        // the eighth, and none of them agreed with RP-1's own Budget tab. Five of
        // the six upkeep transaction reasons are named by leaders RP-1 ships, so
        // this is the ordinary case rather than an edge one.
        CurrencyUtils.Multipliers[TransactionReasonsRP0.SalaryResearchers] = 0.75;
        var handler = Costed();
        handler.UpdateUpkeep();
        MaintenanceHandler.Instance = handler;

        var reading = Primed().Interpret(ut: 0.0, reputation: null)!;

        Assert.Equal(reading.UpkeepPerDay!.Value, Sum(reading.UpkeepBreakdown!), 6);
        Assert.Equal(225.0, reading.UpkeepBreakdown!.ResearchSalary!.Value, 6);
    }

    [Fact]
    public void Each_line_is_priced_against_its_own_reason()
    {
        // The pairing is read out of UpdateUpkeep rather than guessed from the
        // names, and two of the six are structure-repair variants: StructureRepair
        // is the buildings, StructureRepairLC the launch complexes. Swapping those
        // two would leave the total right and both lines wrong, which is the one
        // arrangement a sum check cannot see.
        CurrencyUtils.Multipliers[TransactionReasonsRP0.StructureRepairLC] = 0.5;
        MaintenanceHandler.Instance = Costed();

        var parts = Primed().Interpret(ut: 0.0, reputation: null)!.UpkeepBreakdown!;

        Assert.Equal(100.0, parts.Facilities!.Value, 6);
        Assert.Equal(100.0, parts.LaunchComplexes!.Value, 6);
        Assert.Equal(300.0, parts.ResearchSalary!.Value, 6);
        Assert.Equal(400.0, parts.Training!.Value, 6);
        Assert.Equal(500.0, parts.CrewBase!.Value, 6);
        Assert.Equal(600.0, parts.CrewInFlight!.Value, 6);
        Assert.Equal(700.0, parts.IntegrationSalary!.Value, 6);
    }

    [Fact]
    public void The_unmodified_costs_are_kept_beside_the_modified_ones()
    {
        // Both, because they answer different questions: what the programme is
        // reported to cost, and what it costs before the career's current
        // arrangements are applied. The difference between them is what those
        // arrangements are worth, and a reader that only had one could not tell.
        CurrencyUtils.Multipliers[TransactionReasonsRP0.CrewTraining] = 0.25;
        MaintenanceHandler.Instance = Costed();

        var reading = Primed().Interpret(ut: 0.0, reputation: null)!;

        Assert.Equal(100.0, reading.UpkeepBreakdown!.Training!.Value, 6);
        Assert.Equal(400.0, reading.UpkeepBeforeModifiers!.Training!.Value, 6);
        Assert.Equal(2800.0, Sum(reading.UpkeepBeforeModifiers), 6);
    }

    [Fact]
    public void An_unaskable_query_takes_the_breakdown_off_the_wire_rather_than_substituting_raw()
    {
        // Falling back to the raw figures under this key would restore the exact
        // bug, and restore it invisibly: seven plausible numbers that no longer
        // sum to the total beside them. The raw ones are still published, under
        // the key that says what they are.
        CurrencyUtils.ThrowOnQuery = true;
        var handler = Costed();
        handler.UpkeepPerDayForDisplay = -2800.0;
        MaintenanceHandler.Instance = handler;

        var reading = Primed().Interpret(ut: 0.0, reputation: null)!;

        Assert.Null(reading.UpkeepBreakdown);
        Assert.Equal(2800.0, Sum(reading.UpkeepBeforeModifiers!), 6);
        Assert.Equal(2800.0, reading.UpkeepPerDay!.Value, 6);
    }

    [Fact]
    public void The_breakdown_is_absent_until_the_main_thread_capture_has_run()
    {
        // The query fires a game event at every modifier in the save, so it runs
        // on the main thread and this reading is built on the Courier thread from
        // what it left behind. Before the first capture there is nothing to
        // report, and nothing is what it reports.
        MaintenanceHandler.Instance = Costed();

        var reading = new Rp1EconomyBackend(new Rp1EconomyUpkeepQuery())
            .Interpret(ut: 0.0, reputation: null)!;

        Assert.Null(reading.UpkeepBreakdown);
        Assert.NotNull(reading.UpkeepBeforeModifiers);
    }

    [Fact]
    public void The_decay_is_the_absolute_daily_loss_not_the_portion()
    {
        // RP-1 stores a PORTION and applies rep * portion once a day. Publishing
        // the portion would put 0.02 on a wire field declared rep/day, which reads
        // as a career losing a fiftieth of a reputation point rather than two.
        MaintenanceHandler.Instance = new MaintenanceHandler();

        var reading = new Rp1EconomyBackend().Interpret(ut: 0.0, reputation: 250.0);

        Assert.Equal(250.0 * 0.02, reading!.ReputationDecayPerDay!.Value, 6);
    }

    [Fact]
    public void The_decay_is_absent_rather_than_zero_when_the_reputation_could_not_be_read()
    {
        // A decay computed from an assumed reputation would be a fabrication about
        // the operator's income.
        MaintenanceHandler.Instance = new MaintenanceHandler();

        var reading = new Rp1EconomyBackend().Interpret(ut: 0.0, reputation: null);

        Assert.Null(reading!.ReputationDecayPerDay);
    }

    [Fact]
    public void The_subsidy_is_converted_from_RP1s_yearly_figure_to_a_daily_one()
    {
        // RP-1's subsidy curve is sampled over a JULIAN year: FillSubsidyDetails
        // divides ut by 31,557,600, which is 365.25 days. Not a game year and not
        // 365, and a wrong divisor here is a funding figure that looks plausible.
        MaintenanceHandler.Instance = new MaintenanceHandler();

        var reading = new Rp1EconomyBackend().Interpret(ut: 0.0, reputation: 0.0);

        Assert.Equal(MaintenanceHandler.MinSubsidyPerYear / 365.25, reading!.SubsidyPerDay!.Value, 6);
        Assert.Equal(MaintenanceHandler.MinSubsidyPerYear / 365.25, reading.SubsidyMinPerDay!.Value, 6);
        Assert.Equal(MaintenanceHandler.MaxSubsidyPerYear / 365.25, reading.SubsidyMaxPerDay!.Value, 6);
    }

    [Fact]
    public void A_reputation_at_the_ceiling_earns_the_maximum_subsidy()
    {
        MaintenanceHandler.Instance = new MaintenanceHandler();

        var reading = new Rp1EconomyBackend().Interpret(ut: 0.0, reputation: 1000.0);

        Assert.Equal(MaintenanceHandler.MaxSubsidyPerYear / 365.25, reading!.SubsidyPerDay!.Value, 6);
    }

    [Fact]
    public void The_subsidy_is_absent_without_a_reputation_while_the_upkeep_still_stands()
    {
        // The three subsidy fields go together: a subsidy with no range around it
        // does not answer the operator's question, which is how much of the range
        // their reputation has bought. The upkeep is independent and survives.
        MaintenanceHandler.Instance = new MaintenanceHandler { UpkeepPerDayForDisplay = -900.0 };

        var reading = new Rp1EconomyBackend().Interpret(ut: 0.0, reputation: null);

        Assert.Null(reading!.SubsidyPerDay);
        Assert.Null(reading.SubsidyMinPerDay);
        Assert.Null(reading.SubsidyMaxPerDay);
        Assert.Equal(900.0, reading.UpkeepPerDay!.Value, 6);
    }

    [Fact]
    public void The_upkeep_total_is_a_cost_the_same_way_round_as_its_parts()
    {
        // RP-1 stores its display total as a NEGATIVE funds delta and every part
        // it is built from as a positive cost. Carrying the total through
        // unchanged puts a credit beside seven charges, which reads as a career
        // being PAID its own salaries.
        MaintenanceHandler.Instance = new MaintenanceHandler
        {
            UpkeepPerDayForDisplay = -2100.0,
            LCsCostPerDay = 2100.0,
        };

        var reading = Primed().Interpret(ut: 0.0, reputation: null);

        Assert.Equal(2100.0, reading!.UpkeepPerDay!.Value, 6);
        Assert.Equal(2100.0, reading.UpkeepBreakdown!.LaunchComplexes!.Value, 6);
        Assert.Equal(2100.0, reading.UpkeepBeforeModifiers!.LaunchComplexes!.Value, 6);
    }

    [Fact]
    public void A_career_costing_nothing_publishes_a_zero_rather_than_a_negative_zero()
    {
        // Negating a zero is how a wire field ends up carrying -0, which survives
        // JSON and prints as "-0" in front of an operator.
        MaintenanceHandler.Instance = new MaintenanceHandler { UpkeepPerDayForDisplay = 0.0 };

        var reading = new Rp1EconomyBackend().Interpret(ut: 0.0, reputation: null);

        Assert.Equal(0.0, reading!.UpkeepPerDay!.Value, 6);
        Assert.False(double.IsNegative(reading.UpkeepPerDay.Value));
    }

    [Fact]
    public void The_unlock_credit_balance_is_read_straight_off_RP1s_handler()
    {
        MaintenanceHandler.Instance = new MaintenanceHandler();
        UnlockCreditHandler.Instance = new UnlockCreditHandler(50_000.0);

        var reading = new Rp1EconomyBackend().Interpret(ut: 0.0, reputation: null);

        // No conversion and no sign flip, unlike everything else on this reading:
        // the handler already holds a funds-denominated balance, and 50,000 is
        // what a career started on RP-1's Normal preset actually holds.
        Assert.Equal(50_000.0, reading!.UnlockCredit!.Value, 6);
    }

    [Fact]
    public void A_career_that_has_spent_its_whole_allowance_publishes_zero_not_absence()
    {
        // Zero credit is a real reading and the commonest one in a long career.
        // Absent here would say RP-1 has no such allowance, which would stop a
        // purchase surface showing the operator why their funds are about to take
        // the whole price.
        MaintenanceHandler.Instance = new MaintenanceHandler();
        UnlockCreditHandler.Instance = new UnlockCreditHandler(0.0);

        var reading = new Rp1EconomyBackend().Interpret(ut: 0.0, reputation: null);

        Assert.Equal(0.0, reading!.UnlockCredit!.Value, 6);
    }

    [Fact]
    public void The_unlock_credit_is_absent_rather_than_zero_when_its_handler_is_not_live()
    {
        // The upkeep is read off a different singleton, so one being live and the
        // other not is a state that happens, and it must not turn into a claim
        // that the allowance is exhausted.
        MaintenanceHandler.Instance = new MaintenanceHandler { UpkeepPerDayForDisplay = -900.0 };
        UnlockCreditHandler.Instance = null;

        var reading = new Rp1EconomyBackend().Interpret(ut: 0.0, reputation: null);

        Assert.Null(reading!.UnlockCredit);
        Assert.Equal(900.0, reading.UpkeepPerDay!.Value, 6);
    }
}
