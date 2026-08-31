// What a launch will cost in FUNDS, and what RP-1 recorded as having happened.
//
// The two tests worth reading first are the ones about numbers that are NOT what
// they appear to be, because both were found by reading the producer rather than
// by reasoning about it:
//
//   the untooled surcharge is ALREADY INSIDE the vehicle cost, so it is an
//   "of which" and adding it would charge the operator twice
//
//   a career log that is switched OFF is not an empty log, and the two must not
//   arrive looking the same
using System;
using System.Collections.Generic;
using GonogoRp1Uplink;
using RP0;
using Xunit;

[Collection("rp0-static-graph")]
public class Rp1CareerCostTests : IDisposable
{
    public Rp1CareerCostTests() => Reset();

    public void Dispose() => Reset();

    private static void Reset()
    {
        SpaceCenterManagement.Instance = null;
        SpaceCenterManagement.EditorToolingCosts = 0.0;
        SpaceCenterManagement.EditorUnlockCosts = 0.0;
        SpaceCenterManagement.EditorRolloutCost = 0.0;
        SpaceCenterManagement.EditorRequiredTechs = new List<string>();
        CareerLog.Instance = null;
    }

    private static SpaceCenterManagement Career()
    {
        var scm = new SpaceCenterManagement();
        SpaceCenterManagement.Instance = scm;
        return scm;
    }

    private static Dictionary<string, object?>? Cost() =>
        Rp1CareerCostCapture.BuildCost(new Rp1CareerCostReflection().ReadCost(ut: 100.0));

    private static Dictionary<string, object?>? Events() =>
        Rp1CareerCostCapture.BuildEvents(new Rp1CareerCostReflection().ReadEvents(ut: 100.0));

    // ── The funds breakdown ─────────────────────────────────────────────────

    /// <summary>
    /// No vehicle being designed publishes NOTHING, not a breakdown of zeros. A
    /// payload of zeros reads as a vehicle that costs nothing to fly.
    /// </summary>
    [Fact]
    public void Says_nothing_when_no_vehicle_is_being_designed()
    {
        Career();

        Assert.Null(Cost());
    }

    [Fact]
    public void Publishes_every_line_a_launch_is_paid_for_in()
    {
        var scm = Career();
        scm.EditorVessel = new VesselProject { cost = 45_000f };
        SpaceCenterManagement.EditorToolingCosts = 12_000.0;
        SpaceCenterManagement.EditorUnlockCosts = 3_000.0;
        SpaceCenterManagement.EditorRolloutCost = 900.0;
        SpaceCenterManagement.EditorRequiredTechs = new List<string> { "earlyRocketry" };

        var cost = Cost();

        Assert.Equal(45_000.0, cost!["vehicleCost"]);
        Assert.Equal(12_000.0, cost["toolingCost"]);
        Assert.Equal(3_000.0, cost["unlockCost"]);
        Assert.Equal(900.0, cost["rolloutCost"]);
        Assert.Equal(new[] { "earlyRocketry" }, (List<string>)cost["requiredTechs"]!);
    }

    /// <summary>
    /// A spaceplane has no rollout, and RP-1 says so by leaving the figure at
    /// zero. Absent rather than 0 on the wire, because "does not apply" and "free"
    /// are different answers and only one of them invites an operator to wonder
    /// where the charge went.
    /// </summary>
    [Fact]
    public void A_rollout_that_does_not_apply_is_absent_rather_than_free()
    {
        var scm = Career();
        scm.EditorVessel = new VesselProject { cost = 45_000f };
        SpaceCenterManagement.EditorRolloutCost = 0.0;

        Assert.Null(Cost()!["rolloutCost"]);
    }

    /// <summary>
    /// An unpriced vehicle reads as absent rather than free. RP-1 fills its cost
    /// lazily and leaves it at zero until something asks, and the method that would
    /// fill it also releases a buffer, so the field is read and a zero is reported
    /// as no answer.
    /// </summary>
    [Fact]
    public void An_unpriced_vehicle_reports_no_cost_rather_than_a_free_one()
    {
        var scm = Career();
        scm.EditorVessel = new VesselProject { cost = 0f };

        Assert.Null(Cost()!["vehicleCost"]);
    }

    // ── The career log ──────────────────────────────────────────────────────

    /// <summary>
    /// The distinction the channel exists to preserve. A log switched OFF has no
    /// history and never will; a log switched on with nothing in it has a history
    /// that is empty so far. Both would be an empty array to a client shown only
    /// the rows, and one of them would have it report a quiet career when the
    /// career is merely unrecorded.
    /// </summary>
    [Fact]
    public void A_log_that_is_switched_off_is_not_an_empty_log()
    {
        CareerLog.Instance = new CareerLog { IsEnabled = false };

        var off = Events();

        Assert.Equal(false, off!["enabled"]);
        Assert.Empty((List<object?>)off["events"]!);

        CareerLog.Instance = new CareerLog { IsEnabled = true };
        var quiet = Events();

        Assert.Equal(true, quiet!["enabled"]);
        Assert.Empty((List<object?>)quiet["events"]!);
    }

    /// <summary>And the third state: the handler could not be read at all.</summary>
    [Fact]
    public void Says_nothing_when_RP1s_log_handler_is_not_live()
    {
        Assert.Null(Events());
    }

    /// <summary>
    /// The join a career log exists for. A failure and the launch it happened on
    /// share a LaunchID, and pairing them is the question an operator opens the log
    /// to answer; a shape that dropped the id would carry both rows and be unable
    /// to say they were the same flight.
    /// </summary>
    [Fact]
    public void A_failure_and_its_launch_can_be_paired_by_launch_id()
    {
        var log = new CareerLog { IsEnabled = true };
        log.AddLaunch(ut: 1000.0, vesselName: "Ares I", launchId: "L-7");
        log.AddFailure(ut: 1200.0, launchId: "L-7", part: "engine-1", type: "ignitionFail");
        CareerLog.Instance = log;

        var rows = (List<object?>)Events()!["events"]!;
        var launch = (Dictionary<string, object?>)rows[0]!;
        var failure = (Dictionary<string, object?>)rows[1]!;

        Assert.Equal("launch", launch["kind"]);
        Assert.Equal("Ares I", launch["name"]);
        Assert.Equal("failure", failure["kind"]);
        Assert.Equal("engine-1", failure["part"]);
        Assert.Equal(launch["launchId"], failure["launchId"]);
    }

    /// <summary>
    /// Six lists become one timeline, ordered by when things happened rather than
    /// by which list they came from. A log grouped by kind is six logs.
    /// </summary>
    [Fact]
    public void The_six_lists_arrive_as_one_timeline_in_time_order()
    {
        var log = new CareerLog { IsEnabled = true };
        log.AddLeader(ut: 3000.0, name: "Von Braun", cost: 5000.0);
        log.AddLaunch(ut: 1000.0, vesselName: "Ares I", launchId: "L-7");
        log.AddContract(ut: 2000.0, displayName: "First Orbit", repChange: 12.5);
        CareerLog.Instance = log;

        var rows = (List<object?>)Events()!["events"]!;

        var instants = new List<double>();
        foreach (var row in rows)
        {
            instants.Add((double)((Dictionary<string, object?>)row!)["ut"]!);
        }
        Assert.Equal(new[] { 1000.0, 2000.0, 3000.0 }, instants);
        Assert.Equal("contract", ((Dictionary<string, object?>)rows[1]!)["kind"]);
        Assert.Equal(12.5, ((Dictionary<string, object?>)rows[1]!)["repChange"]);
        Assert.Equal(5000.0, ((Dictionary<string, object?>)rows[2]!)["cost"]);
    }

    /// <summary>
    /// A field a kind does not carry is ABSENT rather than zero. A launch has no
    /// reputation change; publishing 0 would say the flight earned nothing, which
    /// is a claim rather than a gap.
    /// </summary>
    [Fact]
    public void A_field_a_kind_does_not_have_is_absent_rather_than_zero()
    {
        var log = new CareerLog { IsEnabled = true };
        log.AddLaunch(ut: 1000.0, vesselName: "Ares I", launchId: "L-7");
        CareerLog.Instance = log;

        var launch = (Dictionary<string, object?>)((List<object?>)Events()!["events"]!)[0]!;

        Assert.Null(launch["repChange"]);
        Assert.Null(launch["cost"]);
        Assert.Null(launch["part"]);
    }
}
