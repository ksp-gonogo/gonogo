using System;
using System.Collections.Generic;
using System.Linq;
using GonogoRp1Uplink;
using RP0;
using Xunit;

/// <summary>
/// The facility reading, against the stand-in RP-1 graph in <c>Rp0Fixture.cs</c>.
///
/// <para>These are about SHAPE, the same as every other reflection suite here:
/// that the walk reads the members it says it does, does RP-1's arithmetic where
/// it claims to, and answers absent rather than a default where it cannot. They
/// say nothing about the values a running RP-1 holds. What DOES check this
/// reading against a running game is a rig observation, listed as such: the whole
/// claim it rests on is that a tier read this way answers outside the space
/// centre, and no headless test can see a scene.</para>
///
/// <para>The one thing the fixture cannot reproduce is the branch this reading
/// exists for. <c>ProtoUpgradeable.GetLevel()</c> falls back to the save's own
/// <c>lvl</c> when the scene has instantiated no facility, and the stand-in
/// <c>KCTUtilities.GetFacilityLevel</c> answers from a dictionary a test sets. So
/// what these pin is that nothing in the walk reaches a live facility at all,
/// which is the property that makes the fallback reachable, not the fallback
/// itself.</para>
/// </summary>
[Collection("rp0-static-graph")]
public class Rp1FacilitiesReflectionTests : IDisposable
{
    public Rp1FacilitiesReflectionTests() => Reset();

    public void Dispose() => Reset();

    private static void Reset()
    {
        Database.FacilityLevelCosts.Clear();
        Database.LockedFacilities.Clear();
        KCTUtilities.FacilityLevels.Clear();
        HighLogic.Reset();
    }

    /// <summary>
    /// RP-1's shipped Administration table, and the reason it is this one: the
    /// running career reported "Administration tier 0 of 8, upgrade 40,000f" at
    /// the space centre, and these are the numbers RP-1's own CustomBarnKit.cfg
    /// declares for it. So the arithmetic below is checked against a reading
    /// somebody took, rather than against itself.
    /// </summary>
    private static void SeedAdministration(int tier = 0)
    {
        Database.FacilityLevelCosts[SpaceCenterFacility.Administration] =
            new List<int> { 25000, 40000, 140000, 250000, 400000, 500000, 500000, 500000, 500000 };
        KCTUtilities.FacilityLevels[SpaceCenterFacility.Administration] = tier;
    }

    [Fact]
    public void Reports_the_tier_the_ceiling_and_the_next_step_from_RP1s_own_table()
    {
        SeedAdministration();

        var row = Assert.Single(new Rp1FacilitiesReflection().Read());

        Assert.Equal("Administration", row.Facility);
        Assert.Equal(0, row.CurrentTier);
        // The CEILING, one less than the table's length, which is how an operator
        // counts it and how career.status states it.
        Assert.Equal(8, row.MaxTier);
        Assert.Equal(40000.0, row.UpgradeCost);
    }

    [Fact]
    public void Prices_the_step_from_wherever_the_building_stands()
    {
        SeedAdministration(tier: 2);

        var row = Assert.Single(new Rp1FacilitiesReflection().Read());

        Assert.Equal(2, row.CurrentTier);
        Assert.Equal(250000.0, row.UpgradeCost);
    }

    /// <summary>
    /// A building at its ceiling has no next step, and a zero price would read as
    /// a free upgrade rather than as no upgrade.
    /// </summary>
    [Fact]
    public void A_building_at_its_ceiling_carries_no_price()
    {
        SeedAdministration(tier: 8);

        var row = Assert.Single(new Rp1FacilitiesReflection().Read());

        Assert.Equal(8, row.CurrentTier);
        Assert.Null(row.UpgradeCost);
    }

    /// <summary>
    /// The career's own multiplier, applied exactly where
    /// <c>UpgradeableFacility.GetUpgradeCost</c> applies it. Without this the
    /// figure would be right on a default career and silently wrong on an easy or
    /// a hard one, which are 0.5 and 1.5 on KSP's own presets.
    /// </summary>
    [Fact]
    public void The_price_carries_the_careers_funds_multiplier()
    {
        SeedAdministration();
        HighLogic.CurrentGame.Parameters.Career.FundsLossMultiplier = 1.5f;

        var row = Assert.Single(new Rp1FacilitiesReflection().Read());

        Assert.Equal(60000.0, row.UpgradeCost);
    }

    /// <summary>
    /// No multiplier, no price. The tier and the ceiling still go out: they are
    /// the half an operator can act on, and withholding them because a third
    /// figure is missing would blank a section that has something to say.
    /// </summary>
    [Fact]
    public void An_unreadable_multiplier_withholds_the_price_and_nothing_else()
    {
        SeedAdministration();

        var row = Assert.Single(new Rp1FacilitiesReflection(
            typeof(Database), typeof(KCTUtilities), highLogic: null).Read());

        Assert.Equal(0, row.CurrentTier);
        Assert.Equal(8, row.MaxTier);
        Assert.Null(row.UpgradeCost);
    }

    /// <summary>
    /// The five RP-1 prices at a single fund under its own "cosmetic only"
    /// comment. It drives their tier itself from the mean of the ones it does
    /// upgrade, so a project queued against one would finish at once and then be
    /// overwritten, and a client offering the row would be offering nothing.
    /// </summary>
    [Fact]
    public void Says_which_buildings_RP1_does_not_upgrade_as_buildings()
    {
        SeedAdministration();
        Database.FacilityLevelCosts[SpaceCenterFacility.LaunchPad] = new List<int> { 1, 1, 1 };
        KCTUtilities.FacilityLevels[SpaceCenterFacility.LaunchPad] = 0;
        Database.LockedFacilities.Add(SpaceCenterFacility.LaunchPad);

        var rows = new Rp1FacilitiesReflection().Read();

        Assert.True(rows.Single(r => r.Facility == "Administration").UpgradedByRp1);
        Assert.False(rows.Single(r => r.Facility == "LaunchPad").UpgradedByRp1);
    }

    /// <summary>
    /// An install whose cost table has not loaded publishes an empty list, which
    /// is what a stock game sits at permanently. Not a partial reading and not a
    /// row per facility at tier zero: zero is where a career starts, so a
    /// defaulted row and a real one would look identical.
    /// </summary>
    [Fact]
    public void No_cost_table_publishes_nothing()
    {
        Assert.Empty(new Rp1FacilitiesReflection().Read());
    }

    [Fact]
    public void A_missing_RP1_reports_unavailable_and_reads_nothing()
    {
        var reader = new Rp1FacilitiesReflection(database: null, kctUtilities: null, highLogic: null);

        Assert.False(reader.Available);
        Assert.Empty(reader.Read());
    }

    /// <summary>
    /// A building with an empty cost list is left out rather than published with
    /// a ceiling of -1. RP-1's own <c>GetFacilityLevelCount</c> answers 1 for a
    /// facility it has no table for, and carrying that arithmetic through would
    /// put a negative ceiling on the wire.
    /// </summary>
    [Fact]
    public void A_building_with_no_tiers_is_left_out()
    {
        SeedAdministration();
        Database.FacilityLevelCosts[SpaceCenterFacility.Runway] = new List<int>();
        KCTUtilities.FacilityLevels[SpaceCenterFacility.Runway] = 0;

        var rows = new Rp1FacilitiesReflection().Read();

        Assert.Equal(new[] { "Administration" }, rows.Select(r => r.Facility));
    }

    /// <summary>
    /// The mapper carries every field, keyed the way the contract declares them.
    /// Its own test because the wire is the dictionary and not the POCO: a key
    /// spelt differently here reaches the client as a missing field and nothing
    /// in the C# would notice.
    /// </summary>
    [Fact]
    public void The_mapper_carries_every_field_under_its_wire_key()
    {
        var raw = new Rp1ScRaw();
        raw.Facilities.Add(new Rp1FacilityRaw
        {
            Facility = "Administration",
            CurrentTier = 1,
            MaxTier = 8,
            UpgradeCost = 140000.0,
            UpgradedByRp1 = true,
        });

        var row = Assert.IsType<Dictionary<string, object?>>(
            Assert.Single(Rp1ScCapture.BuildFacilities(raw)));

        Assert.Equal("Administration", row["facility"]);
        Assert.Equal(1, row["currentTier"]);
        Assert.Equal(8, row["maxTier"]);
        Assert.Equal(140000.0, row["upgradeCost"]);
        Assert.Equal(true, row["upgradedByRp1"]);
    }
}
