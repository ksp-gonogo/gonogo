// What the ship on the editor's table costs to tool, and the two verbs that close
// the gap.
//
// The half worth reading first is the ABSENCES. Two of them are easy to get wrong
// in the same direction, and both would tell an operator the vehicle is finished:
// RP-1's own tooling-level lookup short-circuits to "tooled" for everything when
// tooling is switched off, and a ship with no parts has nothing outstanding for a
// reason that has nothing to do with tooling. Neither may publish a payload.
//
// The other half is that the two verbs are different KINDS. Tool All spends money
// and Refit spends nothing; a suite that only checked "the command ran" would let
// the second grow the first's confirmation shape without anything going red.
using System;
using System.Collections.Generic;
using GonogoRp1Uplink;
using RP0;
using Sitrep.Contract;
using Xunit;

[Collection("rp0-static-graph")]
public class Rp1ToolingTests : IDisposable
{
    public Rp1ToolingTests() => Reset();

    public void Dispose() => Reset();

    private static void Reset()
    {
        ToolingManager.Instance = null;
        EditorLogic.fetch = null;
        SpaceCenterManagement.Instance = null;
        SpaceCenterManagement.EditorToolingCosts = 0.0;
        ModuleTooling.Purchased.Clear();
        ModuleTooling.ThrowOnPurchase = false;
        ModuleTooling.LastBatchWasSimulation = false;
        ToolingPartResizer.Resized.Clear();
    }

    /// <summary>A career in the editor with one part carrying one tooling module.</summary>
    private static ModuleToolingDiamLen Editor(
        bool tooled = false, double toolAllCost = 2500.0, uint craftId = 7, int counterparts = 0)
    {
        ToolingManager.Instance = new ToolingManager { toolingEnabled = true };
        SpaceCenterManagement.Instance = new SpaceCenterManagement();
        SpaceCenterManagement.EditorToolingCosts = toolAllCost;

        var module = new ModuleToolingDiamLen { Unlocked = tooled, Cost = 1000f, addedCost = 400f };
        var part = new Part { craftID = craftId, partInfo = new PartInfo { title = "Procedural Tank" } };
        part.Modules.Add(module);
        for (var i = 0; i < counterparts; i++)
        {
            part.symmetryCounterparts.Add(new Part());
        }

        var ship = new ShipConstruct();
        ship.Parts.Add(part);
        EditorLogic.fetch = new EditorLogic { ship = ship };
        return module;
    }

    private static Dictionary<string, object?>? Read() =>
        Rp1ToolingCapture.Build(new Rp1ToolingReflection().Read(ut: 100.0));

    private static Dictionary<string, object?> Row(Dictionary<string, object?>? payload) =>
        (Dictionary<string, object?>)((List<object?>)payload!["parts"]!)[0]!;

    // ── The absences, which are the ones that could lie ─────────────────────

    /// <summary>
    /// The one that matters most. RP-1's <c>GetToolingLevel</c> answers "tooled"
    /// for everything when tooling is switched off, so a payload built then would
    /// report a vehicle with nothing left to do. Silence is the only honest answer.
    /// </summary>
    [Fact]
    public void Says_nothing_at_all_when_RP1s_tooling_is_switched_off()
    {
        Editor();
        ToolingManager.Instance!.toolingEnabled = false;

        Assert.Null(Read());
    }

    [Fact]
    public void Says_nothing_when_there_is_no_ship_on_the_editors_table()
    {
        Editor();
        EditorLogic.fetch = null;

        Assert.Null(Read());
    }

    /// <summary>
    /// And the complement, which is what stops the two above passing vacuously: a
    /// live editor career DOES publish.
    /// </summary>
    [Fact]
    public void Publishes_when_there_is_a_ship_and_tooling_is_on()
    {
        Editor();

        Assert.NotNull(Read());
    }

    // ── The reading ─────────────────────────────────────────────────────────

    [Fact]
    public void Publishes_what_an_operator_decides_on()
    {
        Editor(toolAllCost: 2500.0, counterparts: 3);

        var payload = Read();
        var row = Row(payload);

        Assert.Equal(2500.0, payload!["toolAllCost"]);
        Assert.Equal(1, payload["untooledCount"]);
        Assert.Equal("Procedural Tank", row["partTitle"]);
        Assert.Equal("7", row["partId"]);
        Assert.Equal("Tank-Conventional", row["toolingType"]);
        Assert.Equal("3.000m x 5.000m", row["parameterSummary"]);
        Assert.Equal(false, row["tooled"]);
        Assert.Equal(1000.0, row["toolingCost"]);
        Assert.Equal(400.0, row["untooledSurcharge"]);
        Assert.Equal(3, row["symmetryCounterparts"]);
    }

    /// <summary>
    /// The total is RP-1's own CACHED figure and is deliberately not derived here.
    /// It is not the sum of the rows either: tooling one part can leave a neighbour
    /// free, because a tooling covers anything of its type within four per cent. A
    /// reading that added the column up would overstate, and this pins that we take
    /// the producer's number rather than compute one.
    /// </summary>
    [Fact]
    public void The_total_is_RP1s_own_figure_and_not_the_sum_of_the_rows()
    {
        Editor(toolAllCost: 1500.0);

        // One row at 1000, a total of 1500: a sum could not produce this, so a
        // reading that agreed with the sum would have to be deriving it.
        Assert.Equal(1500.0, Read()!["toolAllCost"]);
    }

    /// <summary>
    /// Tooled parts travel too. A roster of only what is outstanding cannot tell an
    /// operator that a part is covered, which is the half of the answer that says
    /// the money is already spent.
    /// </summary>
    [Fact]
    public void An_already_tooled_part_is_listed_rather_than_dropped()
    {
        Editor(tooled: true);

        var payload = Read();

        Assert.Single((List<object?>)payload!["parts"]!);
        Assert.Equal(0, payload["untooledCount"]);
        Assert.Equal(true, Row(payload)["tooled"]);
    }

    // ── Tool All: a purchase ────────────────────────────────────────────────

    [Fact]
    public void Tooling_the_vehicle_buys_every_outstanding_tooling()
    {
        var module = Editor();

        var result = new Rp1ToolingCommands().ToolAll(new Rp1ToolAllArgs());

        Assert.True(result.Success);
        Assert.Equal(new[] { (ModuleTooling)module }, ModuleTooling.Purchased);
        Assert.True(module.Unlocked);
    }

    /// <summary>
    /// The batch is asked for a REAL purchase and never a simulation.
    ///
    /// <para>RP-1's own window prices a ship by calling this same method with
    /// <c>isSimulation: true</c>, which saves the tooling database, performs every
    /// purchase for real, and reloads from the node. One throw between the save and
    /// the reload leaves the career's tooling bought. Nothing here may take that
    /// route, and this is the assertion that says so.</para>
    /// </summary>
    [Fact]
    public void The_purchase_never_asks_for_the_save_and_reload_pricing_path()
    {
        Editor();

        new Rp1ToolingCommands().ToolAll(new Rp1ToolAllArgs());

        Assert.False(ModuleTooling.LastBatchWasSimulation);
    }

    [Fact]
    public void Refuses_to_tool_a_vehicle_that_is_already_fully_tooled()
    {
        Editor(tooled: true);

        var result = new Rp1ToolingCommands().ToolAll(new Rp1ToolAllArgs());

        Assert.False(result.Success);
        Assert.Equal(CommandErrorCode.WrongState, result.ErrorCode);
        Assert.Empty(ModuleTooling.Purchased);
    }

    [Fact]
    public void Refuses_to_tool_when_there_is_no_ship_being_designed()
    {
        Editor();
        EditorLogic.fetch = null;

        var result = new Rp1ToolingCommands().ToolAll(new Rp1ToolAllArgs());

        Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        Assert.Empty(ModuleTooling.Purchased);
    }

    [Fact]
    public void A_purchase_that_throws_is_reported_rather_than_swallowed()
    {
        Editor();
        ModuleTooling.ThrowOnPurchase = true;

        var result = new Rp1ToolingCommands().ToolAll(new Rp1ToolAllArgs());

        Assert.False(result.Success);
        Assert.Contains("tooling purchase failed", result.Detail!);
    }

    // ── Refit: an edit ──────────────────────────────────────────────────────

    [Fact]
    public void Refitting_reshapes_the_part_that_was_named()
    {
        Editor(craftId: 42);

        var result = new Rp1ToolingCommands().Refit(new Rp1ToolingRefitArgs
        {
            PartId = "42",
            Diameter = 3.0,
            Length = 5.0,
            RfType = "Tank-Balloon",
        });

        Assert.True(result.Success, result.Detail);
        Assert.Equal(new[] { "42:3.000x5.000:Tank-Balloon" }, ToolingPartResizer.Resized);
    }

    /// <summary>
    /// A refit SPENDS NOTHING. It is an edit to the craft rather than a career
    /// transaction, and the assertion that it bought nothing is what stops it
    /// drifting into the purchase's shape.
    /// </summary>
    [Fact]
    public void Refitting_buys_no_tooling()
    {
        Editor(craftId: 42);

        new Rp1ToolingCommands().Refit(
            new Rp1ToolingRefitArgs { PartId = "42", Diameter = 3.0, Length = 5.0 });

        Assert.Empty(ModuleTooling.Purchased);
    }

    /// <summary>
    /// Omitting the material leaves it alone, which RP-1 calls a resize rather than
    /// a refit. Pinned because an absent material must not become some default one:
    /// switching a tank's material is not a thing to do by omission.
    /// </summary>
    [Fact]
    public void Omitting_the_material_reshapes_without_changing_it()
    {
        Editor(craftId: 42);

        new Rp1ToolingCommands().Refit(
            new Rp1ToolingRefitArgs { PartId = "42", Diameter = 3.0, Length = 5.0 });

        Assert.Equal(new[] { "42:3.000x5.000:(unchanged)" }, ToolingPartResizer.Resized);
    }

    [Fact]
    public void Refuses_a_part_that_is_not_on_this_vehicle()
    {
        Editor(craftId: 42);

        var result = new Rp1ToolingCommands().Refit(
            new Rp1ToolingRefitArgs { PartId = "99", Diameter = 3.0, Length = 5.0 });

        Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
        Assert.Empty(ToolingPartResizer.Resized);
    }

    /// <summary>
    /// A size is required in both dimensions. A refit moves a part TO a size, and
    /// there is no default size to move it to; guessing one would reshape somebody's
    /// craft to a number nobody chose.
    /// </summary>
    [Fact]
    public void Refuses_a_refit_with_no_size_to_refit_to()
    {
        Editor(craftId: 42);
        var commands = new Rp1ToolingCommands();

        Assert.Equal(
            CommandErrorCode.Range,
            commands.Refit(new Rp1ToolingRefitArgs { PartId = "42", Diameter = 3.0 }).ErrorCode);
        Assert.Equal(
            CommandErrorCode.Range,
            commands.Refit(new Rp1ToolingRefitArgs { PartId = "42", Length = 5.0 }).ErrorCode);
        Assert.Empty(ToolingPartResizer.Resized);
    }

    /// <summary>
    /// The part is NAMED, never taken from whichever part-action window happens to
    /// be open. RP-1's own control reads that window; its underlying Resize takes a
    /// part, and a verb whose subject depends on a panel being open is one an
    /// operator at another console cannot use.
    /// </summary>
    [Fact]
    public void Refuses_a_refit_that_names_no_part_rather_than_picking_one()
    {
        Editor(craftId: 42);

        var result = new Rp1ToolingCommands().Refit(
            new Rp1ToolingRefitArgs { Diameter = 3.0, Length = 5.0 });

        Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
        Assert.Empty(ToolingPartResizer.Resized);
    }
}
