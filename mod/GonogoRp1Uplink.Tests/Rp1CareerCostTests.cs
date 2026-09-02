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
        // The blocking-node read reaches two KSP statics beside RP-1's, so both
        // are cleared here: a title left over from another test would make a
        // titleless node look titled, and a ship left standing would make an
        // absent parts list look empty.
        EditorLogic.fetch = null;
        ResearchAndDevelopment.Reset();
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
        Assert.Equal("earlyRocketry", TechRow(cost, 0)["id"]);
    }

    // ── The blocking tech nodes ─────────────────────────────────────────────

    /// <summary>One row of the requiredTechs list, as the wire carries it.</summary>
    private static Dictionary<string, object?> TechRow(
        Dictionary<string, object?> cost, int index) =>
        (Dictionary<string, object?>)((List<object?>)cost["requiredTechs"]!)[index]!;

    /// <summary>
    /// The node's TITLE travels beside its id, because `earlyRocketry` is an
    /// identifier and an identifier says neither what the node is called nor what
    /// is waiting for it.
    /// </summary>
    [Fact]
    public void A_blocking_node_carries_the_careers_own_title_for_it()
    {
        var scm = Career();
        scm.EditorVessel = new VesselProject { cost = 45_000f };
        SpaceCenterManagement.EditorRequiredTechs = new List<string> { "supersonicFlight" };
        ResearchAndDevelopment.Titles["supersonicFlight"] = "Supersonic Flight";

        var row = TechRow(Cost()!, 0);

        Assert.Equal("supersonicFlight", row["id"]);
        Assert.Equal("Supersonic Flight", row["title"]);
    }

    /// <summary>
    /// A node the tree has NO title for arrives with the title ABSENT, never the
    /// id and never a blank.
    ///
    /// <para>GetTechnologyTitle answers an unknown id with the empty string, and
    /// both of the obvious things to do with that are wrong: a blank renders as a
    /// nameless node, and substituting the id makes a field called title a lie
    /// about what it holds. The client already has the id.</para>
    /// </summary>
    [Fact]
    public void A_node_the_tree_cannot_title_is_absent_rather_than_blank_or_the_id()
    {
        var scm = Career();
        scm.EditorVessel = new VesselProject { cost = 45_000f };
        SpaceCenterManagement.EditorRequiredTechs = new List<string> { "someModdedNode" };

        var row = TechRow(Cost()!, 0);

        Assert.Null(row["title"]);
        // And the id is still there to fall back to, which is what makes absence
        // an answer a client can act on rather than a hole.
        Assert.Equal("someModdedNode", row["id"]);
    }

    /// <summary>
    /// The parts waiting on a node, gathered from the editor ship under the node
    /// each one names. This is the half that makes a row an ANSWER rather than a
    /// name: it is what an operator meant by "what is this tech needed FOR".
    /// </summary>
    [Fact]
    public void The_parts_waiting_on_a_node_are_gathered_under_it()
    {
        var scm = Career();
        scm.EditorVessel = new VesselProject { cost = 45_000f };
        SpaceCenterManagement.EditorRequiredTechs =
            new List<string> { "supersonicFlight", "heavyAerodynamics" };
        EditorLogic.fetch = new EditorLogic
        {
            ship = new ShipConstruct
            {
                Parts =
                {
                    Blocked("Ram Air Intake", "supersonicFlight"),
                    Blocked("XM-G50 Radial Intake", "supersonicFlight"),
                    Blocked("Swept Wings", "heavyAerodynamics"),
                    // Needs nothing, so it is gathered under no node at all
                    // rather than under an empty key.
                    Blocked("Mk1 Command Pod", ""),
                },
            },
        };

        var cost = Cost()!;

        Assert.Equal(
            new[] { "Ram Air Intake", "XM-G50 Radial Intake" },
            (List<string>)TechRow(cost, 0)["parts"]!);
        Assert.Equal(
            new[] { "Swept Wings" },
            (List<string>)TechRow(cost, 1)["parts"]!);
    }

    /// <summary>
    /// A part mounted several times is ONE thing waiting.
    ///
    /// <para>The question the row answers is what is waiting for this node, and a
    /// booster in six-fold symmetry is one part in six places. Six identical
    /// titles would read as six separate problems.</para>
    /// </summary>
    [Fact]
    public void A_part_mounted_repeatedly_is_named_once()
    {
        var scm = Career();
        scm.EditorVessel = new VesselProject { cost = 45_000f };
        SpaceCenterManagement.EditorRequiredTechs = new List<string> { "solidRockets" };
        EditorLogic.fetch = new EditorLogic
        {
            ship = new ShipConstruct
            {
                Parts =
                {
                    Blocked("Sepratron", "solidRockets"),
                    Blocked("Sepratron", "solidRockets"),
                    Blocked("Sepratron", "solidRockets"),
                },
            },
        };

        Assert.Equal(new[] { "Sepratron" }, (List<string>)TechRow(Cost()!, 0)["parts"]!);
    }

    /// <summary>
    /// A node NOTHING on the ship names arrives with an EMPTY parts list, and the
    /// row is not dropped.
    ///
    /// <para>A node can be required by something other than a part, so empty is a
    /// real answer: the ship was read and nothing on it is waiting for this. An
    /// operator who saw such a row vanish would go looking for a fault behind
    /// it.</para>
    /// </summary>
    [Fact]
    public void A_node_no_part_names_keeps_its_row_with_an_empty_list()
    {
        var scm = Career();
        scm.EditorVessel = new VesselProject { cost = 45_000f };
        SpaceCenterManagement.EditorRequiredTechs = new List<string> { "flightControl" };
        EditorLogic.fetch = new EditorLogic
        {
            ship = new ShipConstruct { Parts = { Blocked("Mk1 Command Pod", "") } },
        };

        var row = TechRow(Cost()!, 0);

        Assert.Equal("flightControl", row["id"]);
        Assert.Empty((List<string>)row["parts"]!);
    }

    /// <summary>
    /// NO READABLE SHIP leaves the parts list ABSENT, which is a different answer
    /// from the empty one above.
    ///
    /// <para>Outside the editor `EditorLogic.fetch` is null, so nothing is known
    /// about which parts are waiting. Empty would claim the ship was read and had
    /// none, which is a statement this reading is in no position to make.</para>
    /// </summary>
    [Fact]
    public void No_readable_ship_leaves_the_waiting_parts_absent_rather_than_empty()
    {
        var scm = Career();
        scm.EditorVessel = new VesselProject { cost = 45_000f };
        SpaceCenterManagement.EditorRequiredTechs = new List<string> { "supersonicFlight" };
        EditorLogic.fetch = null;

        var row = TechRow(Cost()!, 0);

        Assert.Null(row["parts"]);
        // The node itself still travels: the title and the id do not depend on
        // the ship, and losing the row would hide the blocker entirely.
        Assert.Equal("supersonicFlight", row["id"]);
    }

    /// <summary>A part with a title and the node it is waiting for.</summary>
    private static Part Blocked(string title, string techRequired) =>
        new Part { partInfo = new PartInfo { title = title, TechRequired = techRequired } };

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

        // The part IS the failure's name. Its class carries no display name, no
        // vessel name and no node name, so before this the row arrived with
        // nothing to call it.
        Assert.Equal("engine-1", failure["name"]);
        Assert.Equal("ignitionFail", failure["detail"]);
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
        Assert.Null(launch["isAdd"]);
    }

    /// <summary>
    /// Every kind arrives with something to call it. Four of RP-1's six event
    /// classes carry a name field and two do not, and the two that do not are the
    /// facility construction and the failure.
    /// </summary>
    /// <remarks>
    /// Written as a sweep over all six rather than as a case per kind on purpose:
    /// the defect was that two kinds were never checked at all, so a test shaped
    /// like the ones that already existed would have missed it the same way.
    /// </remarks>
    [Fact]
    public void No_kind_produces_a_row_with_nothing_to_call_it()
    {
        var log = new CareerLog { IsEnabled = true };
        log.AddLaunch(ut: 1000.0, vesselName: "Ares I", launchId: "L-7");
        log.AddContract(ut: 2000.0, displayName: "First Orbit", repChange: 12.5);
        log.AddFailure(ut: 3000.0, launchId: "L-7", part: "engine-1", type: "ignitionFail");
        log.AddFacilityConstruction(ut: 4000.0);
        log.AddTech(ut: 5000.0, nodeName: "supersonicFlight");
        log.AddLeader(ut: 6000.0, name: "Von Braun", cost: 5000.0);
        CareerLog.Instance = log;

        var rows = (List<object?>)Events()!["events"]!;
        Assert.Equal(6, rows.Count);

        foreach (var row in rows)
        {
            var e = (Dictionary<string, object?>)row!;
            Assert.False(
                string.IsNullOrWhiteSpace(e["name"] as string),
                $"the {e["kind"]} row arrived with no name"
            );
        }
    }

    /// <summary>
    /// A leader row says whether the leader was hired or dismissed. The name and
    /// the cost are identical either way, so a row without this reads as a hiring
    /// whichever it was.
    /// </summary>
    [Fact]
    public void A_leader_row_separates_a_hiring_from_a_dismissal()
    {
        var log = new CareerLog { IsEnabled = true };
        log.AddLeader(ut: 1000.0, name: "Von Braun", cost: 5000.0, isAdd: true);
        log.AddLeader(ut: 2000.0, name: "Von Braun", cost: 5000.0, isAdd: false);
        CareerLog.Instance = log;

        var rows = (List<object?>)Events()!["events"]!;
        var hired = (Dictionary<string, object?>)rows[0]!;
        var dismissed = (Dictionary<string, object?>)rows[1]!;

        Assert.Equal(hired["name"], dismissed["name"]);
        Assert.Equal(hired["cost"], dismissed["cost"]);
        Assert.Equal(true, hired["isAdd"]);
        Assert.Equal(false, dismissed["isAdd"]);
    }

    /// <summary>
    /// A facility construction is named by the FACILITY, with its state as the
    /// detail. Its state alone said something had started without saying what.
    /// </summary>
    [Fact]
    public void A_facility_row_names_what_was_built_not_only_its_state()
    {
        var log = new CareerLog { IsEnabled = true };
        log.AddFacilityConstruction(ut: 1000.0);
        CareerLog.Instance = log;

        var row = (Dictionary<string, object?>)((List<object?>)Events()!["events"]!)[0]!;

        Assert.Equal("LaunchPad", row["name"]);
        Assert.Equal("Started", row["detail"]);
    }
}
