using System;
using GonogoRp1Uplink;
using RP0;
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
    }

    public void Dispose()
    {
        MaintenanceHandler.Instance = null;
    }

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

    [Fact]
    public void The_upkeep_total_is_RP1s_own_figure_and_the_breakdown_is_the_parts()
    {
        MaintenanceHandler.Instance = new MaintenanceHandler
        {
            UpkeepPerDayForDisplay = -1234.5,
            FacilityUpkeepValue = 100.0,
            LCsCostPerDay = 200.0,
            ResearchSalaryPerDay = 300.0,
            TrainingUpkeepPerDay = 400.0,
            NautBaseUpkeepPerDay = 500.0,
            NautInFlightUpkeepPerDay = 600.0,
            IntegrationSalaryValue = 700.0,
        };

        var reading = new Rp1EconomyBackend().Interpret(ut: 0.0, reputation: null);

        // RP-1's own total, not our sum of the parts: if the two ever disagree the
        // operator should see the game's figure rather than ours. Published as a
        // COST, the same direction as the parts beside it, because RP-1 stores
        // that total signed the other way from every field it is built out of.
        Assert.Equal(1234.5, reading!.UpkeepPerDay!.Value, 6);
        var parts = reading.UpkeepBreakdown!;
        Assert.Equal(100.0, parts.Facilities!.Value, 6);
        Assert.Equal(200.0, parts.LaunchComplexes!.Value, 6);
        Assert.Equal(300.0, parts.ResearchSalary!.Value, 6);
        Assert.Equal(400.0, parts.Training!.Value, 6);
        Assert.Equal(500.0, parts.CrewBase!.Value, 6);
        Assert.Equal(600.0, parts.CrewInFlight!.Value, 6);
        Assert.Equal(700.0, parts.IntegrationSalary!.Value, 6);
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

        var reading = new Rp1EconomyBackend().Interpret(ut: 0.0, reputation: null);

        Assert.Equal(2100.0, reading!.UpkeepPerDay!.Value, 6);
        Assert.Equal(2100.0, reading.UpkeepBreakdown!.LaunchComplexes!.Value, 6);
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
}
