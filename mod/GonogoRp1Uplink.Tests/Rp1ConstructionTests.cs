using System;
using System.Collections.Generic;
using System.Linq;
using GonogoRp1Uplink;
using RP0;
using Xunit;

/// <summary>
/// The construction walk: the half of an RP-1 schedule that is not vehicle
/// integration. Three project kinds, one row shape, against the stand-in graph in
/// <c>Rp0Fixture.cs</c>.
/// </summary>
/// <remarks>
/// Same limit as every other test in this assembly: these prove the walk reads
/// the members it claims and derives what the arithmetic says, and prove nothing
/// about the values a running RP-1 would hold.
/// </remarks>
[Collection("rp0-static-graph")]
public class Rp1ConstructionTests : IDisposable
{
    public Rp1ConstructionTests()
    {
        SpaceCenterManagement.Instance = null;
    }

    public void Dispose()
    {
        SpaceCenterManagement.Instance = null;
    }

    [Fact]
    public void A_facility_upgrade_carries_the_facility_and_the_two_levels()
    {
        var upgrade = new FacilityUpgradeProject
        {
            name = "VehicleAssemblyBuilding",
            currentLevel = 2,
            upgradeLevel = 3,
            BP = 1_000.0,
            progress = 250.0,
            cost = 40_000.0,
            spentCost = 10_000.0,
        };
        upgrade.SetFacility(SpaceCenterFacility.VehicleAssemblyBuilding);
        upgrade.SetBuildRate(2.0);
        Install(ksc => ksc.FacilityUpgrades.Add(upgrade));

        var row = Single(new Rp1ScReflection().Read(1.0).Constructions);

        Assert.Equal("Cape", row.KscName);
        Assert.Equal("FacilityUpgrade", row.Kind);
        Assert.Equal("VehicleAssemblyBuilding", row.Name);
        Assert.Equal("VehicleAssemblyBuilding", row.FacilityType);
        Assert.Equal(2, row.CurrentLevel);
        Assert.Equal(3, row.TargetLevel);
        Assert.Equal(0.25, row.ProgressRatio);
        Assert.Equal(2.0, row.Rate);
        Assert.Equal(375.0, row.TimeLeftSeconds);
        Assert.Equal(40_000.0, row.Cost);
        Assert.Equal(10_000.0, row.SpentCost);
        // A facility upgrade belongs to the centre, not to any one complex.
        Assert.Null(row.LcId);
        Assert.Null(row.PadId);
    }

    [Fact]
    public void A_launch_complex_construction_carries_the_complex_it_builds()
    {
        var lcId = Guid.NewGuid();
        var construction = new LCConstructionProject
        {
            name = "LC-2",
            lcID = lcId,
            isModify = true,
            engineersToReadd = 14,
            BP = 500.0,
        };
        construction.SetBuildRate(1.0);
        Install(ksc => ksc.LCConstructions.Add(construction));

        var row = Single(new Rp1ScReflection().Read(1.0).Constructions);

        Assert.Equal("LaunchComplex", row.Kind);
        Assert.Equal("LC-2", row.Name);
        Assert.Equal(lcId.ToString(), row.LcId);
        Assert.True(row.IsModify);
        Assert.Equal(14, row.EngineersToReadd);
        // RP-1's base project answers LaunchPad here as its transaction category.
        // Publishing that would say a launch complex was a pad upgrade.
        Assert.Null(row.FacilityType);
        Assert.Null(row.CurrentLevel);
    }

    [Fact]
    public void A_pad_construction_carries_the_pad_and_the_complex_gaining_it()
    {
        var pad = new PadConstructionProject { name = "Pad B", BP = 200.0, progress = 50.0 };
        pad.SetBuildRate(0.5);
        var lc = new LaunchComplex { Name = "LC-1", PadConstructions = { pad } };
        Install(ksc => ksc.LaunchComplexes.Add(lc));

        var row = Single(new Rp1ScReflection().Read(1.0).Constructions);

        Assert.Equal("Pad", row.Kind);
        Assert.Equal("Pad B", row.Name);
        Assert.Equal(pad.id.ToString(), row.PadId);
        Assert.Equal(lc.ID.ToString(), row.LcId);
        Assert.Equal(0.25, row.ProgressRatio);
        Assert.Equal(300.0, row.TimeLeftSeconds);
    }

    [Fact]
    public void An_uncosted_construction_reports_an_absent_rate_and_no_eta()
    {
        // RP-1 leaves _buildRate at -1 until it recalculates, which it does not do
        // as part of loading a save. A construction on a freshly loaded career is
        // genuinely un-costed, and that is not the same fact as a stalled one.
        var upgrade = new FacilityUpgradeProject { name = "Runway", BP = 100.0 };
        Install(ksc => ksc.FacilityUpgrades.Add(upgrade));

        var row = Single(new Rp1ScReflection().Read(1.0).Constructions);

        Assert.Null(row.Rate);
        Assert.Null(row.TimeLeftSeconds);
        Assert.False(row.Stalled);
    }

    [Fact]
    public void A_construction_throttled_to_zero_is_stalled_rather_than_uncosted()
    {
        var upgrade = new FacilityUpgradeProject { name = "Runway", BP = 100.0, workRate = 0.0 };
        upgrade.SetBuildRate(3.0);
        Install(ksc => ksc.FacilityUpgrades.Add(upgrade));

        var row = Single(new Rp1ScReflection().Read(1.0).Constructions);

        Assert.Equal(0.0, row.Rate);
        Assert.True(row.Stalled);
        Assert.Null(row.TimeLeftSeconds);
    }

    [Fact]
    public void The_throttle_scales_the_rate_and_is_published_as_read()
    {
        var upgrade = new FacilityUpgradeProject { name = "Runway", BP = 300.0, workRate = 1.5 };
        upgrade.SetBuildRate(2.0);
        Install(ksc => ksc.FacilityUpgrades.Add(upgrade));

        var row = Single(new Rp1ScReflection().Read(1.0).Constructions);

        Assert.Equal(1.5, row.WorkRate);
        Assert.Equal(3.0, row.Rate);
        Assert.Equal(100.0, row.TimeLeftSeconds);
    }

    [Fact]
    public void A_construction_with_no_build_points_has_no_progress_fraction()
    {
        // RP-1's own GetFractionComplete divides by BP with no guard and answers
        // NaN, which is not a number JSON carries or a bar can render.
        var upgrade = new FacilityUpgradeProject { name = "Runway", BP = 0.0 };
        upgrade.SetBuildRate(1.0);
        Install(ksc => ksc.FacilityUpgrades.Add(upgrade));

        Assert.Null(Single(new Rp1ScReflection().Read(1.0).Constructions).ProgressRatio);
    }

    [Fact]
    public void Every_kind_arrives_on_one_channel_with_the_keys_it_does_not_have_left_absent()
    {
        var upgrade = new FacilityUpgradeProject { name = "Runway" };
        upgrade.SetFacility(SpaceCenterFacility.Runway);
        var lcc = new LCConstructionProject { name = "LC-2" };
        var padc = new PadConstructionProject { name = "Pad B" };
        var lc = new LaunchComplex { Name = "LC-1", PadConstructions = { padc } };
        Install(ksc =>
        {
            ksc.FacilityUpgrades.Add(upgrade);
            ksc.LCConstructions.Add(lcc);
            ksc.LaunchComplexes.Add(lc);
        });

        var rows = Rp1ScCapture.BuildConstructions(new Rp1ScReflection().Read(1.0))
            .Cast<Dictionary<string, object?>>()
            .ToList();

        Assert.Equal(3, rows.Count);
        // Every key on every row, whichever kind it is: a client reading
        // currentLevel off a pad row must find an absence, not a missing key.
        foreach (var row in rows)
        {
            Assert.True(row.ContainsKey("currentLevel"));
            Assert.True(row.ContainsKey("padId"));
            Assert.True(row.ContainsKey("isModify"));
        }
        Assert.Equal(
            new[] { "Pad", "FacilityUpgrade", "LaunchComplex" },
            rows.Select(r => r["kind"] as string).ToArray());
    }

    /// <summary>
    /// One centre, shaped by the caller. The launch-complex list is left to the
    /// caller too, because a pad construction only exists on a complex.
    /// </summary>
    private static void Install(Action<LCSpaceCenter> shape)
    {
        var ksc = new LCSpaceCenter { KSCName = "Cape", Engineers = 20 };
        shape(ksc);
        SpaceCenterManagement.Instance = new SpaceCenterManagement { KSCs = { ksc }, ActiveSC = ksc };
    }

    private static T Single<T>(List<T> list) => Assert.Single(list.AsEnumerable());
}
