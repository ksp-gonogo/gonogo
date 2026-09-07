using System;
using System.Collections.Generic;
using System.Linq;
using GonogoRp1Uplink;
using RP0;
using Xunit;

/// <summary>
/// The reflection walk, against the stand-in RP-1 graph in <c>Rp0Fixture.cs</c>.
/// These tests are about SHAPE: that the walk reads the members it says it does,
/// derives what the arithmetic says, and degrades to absence rather than to a
/// default. They say nothing about the values a running RP-1 would hold, because
/// there is no RP-1 install to observe.
/// </summary>
[Collection("rp0-static-graph")]
public class Rp1ScReflectionTests : IDisposable
{
    public Rp1ScReflectionTests()
    {
        SpaceCenterManagement.Instance = null;
        Confidence.Instance = null;
        // Cleared as well as set, because the walk reads it for the money
        // figures: a handler another file in this collection left standing would
        // put that file's costs on this file's rows.
        MaintenanceHandler.Instance = null;
        LCEfficiency.MaxEfficiency = 1.0;
        // The default install: no KSCSwitcher, so no centre has a display name.
        // Every test that wants one says so.
        KSCSwitcherInterop.Sites = null;
        ClearUnreadableFlags();
    }

    public void Dispose()
    {
        SpaceCenterManagement.Instance = null;
        Confidence.Instance = null;
        MaintenanceHandler.Instance = null;
        KSCSwitcherInterop.Sites = null;
        ClearUnreadableFlags();
    }

    /// <summary>
    /// The static "this member cannot be read" switches, cleared at both ends. A
    /// test that left one standing would make every later file in the collection
    /// read absences it never asked for.
    /// </summary>
    private static void ClearUnreadableFlags()
    {
        Confidence.ThrowOnBalanceRead = false;
        ConstructionProject.ThrowOnBpRead = false;
        ConstructionProject.ThrowOnWorkRateRead = false;
        ConstructionProject.ThrowOnCostRead = false;
    }

    [Fact]
    public void The_type_probe_finds_the_space_centre_type_and_names_its_assembly()
    {
        var r = new Rp1ScReflection();
        Assert.True(r.IsAvailable);
        Assert.True(r.ConfidenceTypeResolved);
        Assert.NotNull(r.AssemblyIdentity);
    }

    [Fact]
    public void No_live_instance_publishes_unavailable_and_no_rows()
    {
        // The main menu, and every tick before RP-1's scenario module loads.
        var raw = new Rp1ScReflection().Read(ut: 100.0);
        Assert.False(raw.Available);
        Assert.Empty(raw.Centres);
        Assert.Null(raw.Personnel);
    }

    [Fact]
    public void A_save_RP1_does_not_manage_publishes_unavailable()
    {
        SpaceCenterManagement.Instance = new SpaceCenterManagement { enabledForSave = false };
        var raw = new Rp1ScReflection().Read(ut: 100.0);
        Assert.False(raw.Available);
        Assert.Empty(raw.Complexes);
    }

    [Fact]
    public void A_centre_reports_its_unassigned_engineers_and_its_pad_side_complexes()
    {
        var hangar = new LaunchComplex { Name = "Hangar", LcTypeValue = LaunchComplexType.Hangar, Engineers = 3 };
        var pad = new LaunchComplex { Name = "Pad A", Engineers = 5 };
        var ksc = new LCSpaceCenter
        {
            KSCName = "Cape",
            Engineers = 12,
            LaunchComplexes = { hangar, pad },
            GroundStation = "us_cape_canaveral",
        };
        SpaceCenterManagement.Instance = new SpaceCenterManagement { KSCs = { ksc }, ActiveSC = ksc };

        var centre = Single(new Rp1ScReflection().Read(1.0).Centres);

        Assert.Equal("Cape", centre.KscName);
        Assert.True(centre.IsActive);
        Assert.Equal(12, centre.Engineers);
        Assert.Equal(4, centre.UnassignedEngineers);
        Assert.Equal(2, centre.LaunchComplexCount);
        Assert.Equal("us_cape_canaveral", centre.GroundStation);
        // The hangar at index 0 does not count: the flag answers whether there is
        // a pad-side complex to work with, which is RP-1's own reading.
        Assert.True(centre.AnyOperational);
    }

    [Fact]
    public void A_centre_with_only_its_hangar_operational_is_not_any_operational()
    {
        var hangar = new LaunchComplex { Name = "Hangar", LcTypeValue = LaunchComplexType.Hangar };
        var ksc = new LCSpaceCenter { KSCName = "Cape", LaunchComplexes = { hangar } };
        SpaceCenterManagement.Instance = new SpaceCenterManagement { KSCs = { ksc }, ActiveSC = ksc };

        Assert.False(Single(new Rp1ScReflection().Read(1.0).Centres).AnyOperational);
    }

    [Fact]
    public void A_complex_with_no_efficiency_record_publishes_absent_efficiency_not_zero()
    {
        var pad = new LaunchComplex { Name = "Pad A" };
        Install(pad, efficiency: null);

        var complex = Single(new Rp1ScReflection().Read(1.0).Complexes);
        Assert.Null(complex.Efficiency);
    }

    [Fact]
    public void The_hangar_reads_the_efficiency_ceiling_rather_than_a_lookup()
    {
        var hangar = new LaunchComplex { Name = "Hangar", LcTypeValue = LaunchComplexType.Hangar };
        Install(hangar, efficiency: null);

        Assert.Equal(1.0, Single(new Rp1ScReflection().Read(1.0).Complexes).Efficiency!.Value, 6);
    }

    [Fact]
    public void An_unlimited_mass_limit_is_absent_rather_than_a_float_sentinel()
    {
        var pad = new LaunchComplex { Name = "Pad A", MassMaxValue = float.MaxValue, MassMinValue = 2f };
        Install(pad, efficiency: 0.5);

        var complex = Single(new Rp1ScReflection().Read(1.0).Complexes);
        Assert.Null(complex.MassMax);
        Assert.Equal(2.0, complex.MassMin!.Value, 6);
    }

    [Fact]
    public void An_uncosted_build_item_publishes_an_absent_rate_and_no_ETA()
    {
        var pad = new LaunchComplex { Name = "Pad A" };
        pad.BuildList.Add(new VesselProject { shipName = "Sputnik", buildPoints = 1000.0 });
        Install(pad, efficiency: 0.5);

        var item = Single(new Rp1ScReflection().Read(1.0).BuildQueue);
        Assert.Equal("Sputnik", item.ShipName);
        Assert.Null(item.Rate);
        Assert.Null(item.TimeLeftSeconds);
        Assert.False(item.Stalled);
    }

    [Fact]
    public void A_costed_build_item_derives_its_rate_and_ETA()
    {
        var vp = new VesselProject { shipName = "Vanguard", buildPoints = 1000.0, progress = 200.0, cost = 5000f, mass = 3f };
        vp.SetBuildRate(4.0);
        var pad = new LaunchComplex { Name = "Pad A", Engineers = 10 };
        pad.BuildList.Add(vp);
        Install(pad, efficiency: 0.5);

        var item = Single(new Rp1ScReflection().Read(1.0).BuildQueue);
        Assert.Equal(2.0, item.Rate!.Value, 6);          // 4.0 * 0.5 efficiency, no rush
        Assert.Equal(400.0, item.TimeLeftSeconds!.Value, 6); // 800 points left at 2/s, under a day so no ramp
        Assert.Equal(0.2, item.ProgressRatio!.Value, 6);
        Assert.Equal(5000.0, item.Cost!.Value, 6);
    }

    [Fact]
    public void A_rushing_complex_multiplies_the_rate_by_RP1s_own_rush_setting()
    {
        var vp = new VesselProject { shipName = "Redstone", buildPoints = 1000.0 };
        vp.SetBuildRate(4.0);
        var pad = new LaunchComplex { Name = "Pad A", IsRushing = true };
        pad.BuildList.Add(vp);
        Install(pad, efficiency: 1.0);

        Assert.Equal(4.0 * Database.SettingsSC.RushRateMult, Single(new Rp1ScReflection().Read(1.0).BuildQueue).Rate!.Value, 6);
    }

    [Fact]
    public void A_blocked_complex_publishes_a_zero_rate_and_says_stalled()
    {
        var vp = new VesselProject { shipName = "Atlas", buildPoints = 1000.0 };
        vp.SetBuildRate(4.0);
        var rollout = new ReconRolloutProject { BP = 500.0, progress = 100.0, RRType = ReconRolloutProject.RolloutReconType.Rollout };
        var pad = new LaunchComplex { Name = "Pad A" };
        pad.BuildList.Add(vp);
        pad.Recon_Rollout.Add(rollout);
        Install(pad, efficiency: 1.0);

        var raw = new Rp1ScReflection().Read(1.0);
        Assert.False(Single(raw.Complexes).CanIntegrate);
        var item = Single(raw.BuildQueue);
        Assert.Equal(0.0, item.Rate!.Value);
        Assert.True(item.Stalled);
        Assert.Null(item.TimeLeftSeconds);
    }

    [Fact]
    public void A_rollback_publishes_what_turning_it_round_would_still_cost()
    {
        // The one press that spends without a fresh price to quote: a rollback
        // resumed as a rollout finishes the move it half undid, and RP-1 bills
        // only the progress left to make. The vehicle's full rollout price would
        // overstate it by everything the first attempt already paid.
        var op = new ReconRolloutProject
        {
            BP = 1000.0,
            progress = 400.0,
            cost = 2500.0,
            RRType = ReconRolloutProject.RolloutReconType.Rollback,
            associatedID = "vessel-1",
        };
        op.SetBuildRate(2.0);
        var pad = new LaunchComplex { Name = "Pad A" };
        pad.Recon_Rollout.Add(op);
        Install(pad, efficiency: 1.0);

        var operation = Single(new Rp1ScReflection().Read(1.0).Operations);
        Assert.Equal(2500.0, operation.Cost!.Value, 6);
        Assert.Equal(1500.0, operation.CostRemaining!.Value, 6);
    }

    [Fact]
    public void An_uncosted_operation_has_no_remainder_rather_than_a_free_one()
    {
        var op = new ReconRolloutProject
        {
            BP = 0.0,
            cost = 2500.0,
            RRType = ReconRolloutProject.RolloutReconType.Rollout,
        };
        var pad = new LaunchComplex { Name = "Pad A" };
        pad.Recon_Rollout.Add(op);
        Install(pad, efficiency: 1.0);

        Assert.Null(Single(new Rp1ScReflection().Read(1.0).Operations).CostRemaining);
    }

    [Fact]
    public void A_reconditioning_operation_does_not_block_integration()
    {
        // IsBlocking is false for reconditioning alone, which is why the queue
        // keeps moving while a pad is being made good again.
        var pad = new LaunchComplex { Name = "Pad A" };
        pad.Recon_Rollout.Add(new ReconRolloutProject
        {
            BP = 500.0,
            RRType = ReconRolloutProject.RolloutReconType.Reconditioning,
        });
        Install(pad, efficiency: 1.0);

        Assert.True(Single(new Rp1ScReflection().Read(1.0).Complexes).CanIntegrate);
    }

    [Fact]
    public void An_air_launch_operation_publishes_its_own_name_rather_than_an_unknown()
    {
        // Two arms KCT never had. A client mapping five renders an air-launched
        // programme as unknown, which is why the name goes on the wire as read.
        var op = new ReconRolloutProject
        {
            BP = 100.0,
            progress = 40.0,
            RRType = ReconRolloutProject.RolloutReconType.AirlaunchUnmount,
            launchPadID = "Runway",
            associatedID = "vessel-1",
        };
        op.SetBuildRate(2.0);
        var pad = new LaunchComplex { Name = "Pad A" };
        pad.Recon_Rollout.Add(op);
        Install(pad, efficiency: 1.0);

        var operation = Single(new Rp1ScReflection().Read(1.0).Operations);
        Assert.Equal("AirlaunchUnmount", operation.Type);
        Assert.Equal("Runway", operation.LaunchPadId);
        Assert.Equal("vessel-1", operation.AssociatedVesselId);
        // Unmounting runs progress down to zero, so the rate is negative and the
        // fraction complete counts the other way.
        Assert.True(operation.Rate!.Value < 0.0);
        Assert.Equal(0.6, operation.ProgressRatio!.Value, 6);
        Assert.Equal(20.0, operation.TimeLeftSeconds!.Value, 6);
    }

    [Fact]
    public void Two_blocking_operations_sequence_rather_than_each_claiming_its_own_share()
    {
        // Both rolling out on one complex, equal build points, so each runs at
        // half rate. The subject has 500 points left at a base rate of 10: its
        // own share division says 100s, and that is EARLY, because the peer
        // finishes at 50s and the subject then has the complex to itself.
        var subject = new ReconRolloutProject
        {
            BP = 1000.0, progress = 500.0, RRType = ReconRolloutProject.RolloutReconType.Rollout,
            launchPadID = "LP-1",
        };
        subject.SetBuildRate(10.0);
        var peer = new ReconRolloutProject
        {
            BP = 1000.0, progress = 750.0, RRType = ReconRolloutProject.RolloutReconType.Rollout,
            launchPadID = "LP-2",
        };
        peer.SetBuildRate(10.0);

        var pad = new LaunchComplex { Name = "Pad A" };
        pad.Recon_Rollout.Add(subject);
        pad.Recon_Rollout.Add(peer);
        Install(pad, efficiency: 1.0);

        var ops = new Rp1ScReflection().Read(1.0).Operations;
        var first = ops[0];

        Assert.Equal(75.0, first.TimeLeftSeconds!.Value, 6);
        Assert.Equal(1, first.BlockingPeers);
        // The share-scaled rate is still published, because it is what progress
        // advances at right now. It is the ETA that must not be derived from it
        // alone.
        Assert.Equal(5.0, first.Rate!.Value, 6);
    }

    [Fact]
    public void A_blocking_operation_beside_an_uncosted_one_publishes_no_ETA_and_says_how_many_peers()
    {
        // RP-1 has not costed the peer, so the sequence is unknowable. The honest
        // answer is no ETA plus the peer count, never the optimistic share
        // division.
        var subject = new ReconRolloutProject
        {
            BP = 1000.0, progress = 500.0, RRType = ReconRolloutProject.RolloutReconType.Rollout,
        };
        subject.SetBuildRate(10.0);
        var uncosted = new ReconRolloutProject
        {
            BP = 1000.0, progress = 0.0, RRType = ReconRolloutProject.RolloutReconType.Rollout,
        };

        var pad = new LaunchComplex { Name = "Pad A" };
        pad.Recon_Rollout.Add(subject);
        pad.Recon_Rollout.Add(uncosted);
        Install(pad, efficiency: 1.0);

        var first = new Rp1ScReflection().Read(1.0).Operations[0];
        Assert.Null(first.TimeLeftSeconds);
        Assert.Equal(1, first.BlockingPeers);
    }

    [Fact]
    public void A_reconditioning_operation_has_no_peers_and_keeps_its_own_ETA()
    {
        // Reconditioning does not block, so it neither takes a share nor waits
        // for one: RP-1 routes it through the plain division and so do we.
        var op = new ReconRolloutProject
        {
            BP = 100.0, progress = 40.0, RRType = ReconRolloutProject.RolloutReconType.Reconditioning,
        };
        op.SetBuildRate(2.0);
        var pad = new LaunchComplex { Name = "Pad A" };
        pad.Recon_Rollout.Add(op);
        Install(pad, efficiency: 1.0);

        var operation = Single(new Rp1ScReflection().Read(1.0).Operations);
        Assert.Equal(0, operation.BlockingPeers);
        Assert.Equal(30.0, operation.TimeLeftSeconds!.Value, 6);
    }

    [Fact]
    public void A_warehouse_vehicle_carries_no_progress_rate_or_ETA()
    {
        var pad = new LaunchComplex { Name = "Pad A" };
        pad.Warehouse.Add(new VesselProject { shipName = "Ready One", buildPoints = 1000.0, progress = 1000.0 });
        Install(pad, efficiency: 1.0);

        var item = Single(new Rp1ScReflection().Read(1.0).Warehouse);
        Assert.Equal("Ready One", item.ShipName);
        Assert.Null(item.Rate);
        Assert.Null(item.TimeLeftSeconds);
        Assert.Null(item.ProgressRatio);
    }

    [Fact]
    public void A_warehouse_vehicle_is_priced_for_the_move_and_a_queued_one_is_not()
    {
        // The rollout price is RP-1's own, per vehicle, and it is a DIFFERENT
        // number from what the vehicle cost to build: the control an operator
        // presses spends this one.
        var pad = new LaunchComplex { Name = "Pad A" };
        pad.Warehouse.Add(new VesselProject { shipName = "Ready One", cost = 40_000f });
        // Nothing to quote for a vehicle that cannot be rolled out yet, for the
        // same reason the envelope refusals are warehouse-only.
        pad.BuildList.Add(new VesselProject { shipName = "Still Building", cost = 40_000f, buildPoints = 1000.0 });
        Install(pad, efficiency: 1.0);

        var raw = new Rp1ScReflection().Read(1.0);

        Assert.Equal(4_000.0, Single(raw.Warehouse).RolloutCost!.Value, 6);
        Assert.Null(Single(raw.BuildQueue).RolloutCost);
    }

    [Fact]
    public void A_rollout_RP1_prices_at_zero_is_published_as_absent_rather_than_free()
    {
        // Zero is what RP-1 answers outside a career, where the question does not
        // arise. Drawn as a price it would read as a free move.
        var pad = new LaunchComplex { Name = "Pad A" };
        pad.Warehouse.Add(new VesselProject { shipName = "Ready One", cost = 0f });
        Install(pad, efficiency: 1.0);

        Assert.Null(Single(new Rp1ScReflection().Read(1.0).Warehouse).RolloutCost);
    }

    [Fact]
    public void A_pad_publishes_its_state_and_hides_the_uninitialised_fractional_level()
    {
        var pad = new LaunchComplex { Name = "Pad A" };
        pad.LaunchPads.Add(new LCLaunchPad
        {
            name = "LP-1",
            launchSiteName = "Cape Canaveral",
            level = 2,
            StateValue = LaunchPadState.Reconditioning,
        });
        Install(pad, efficiency: 1.0);

        var lp = Single(new Rp1ScReflection().Read(1.0).Pads);
        Assert.Equal("Reconditioning", lp.State);
        Assert.Equal("Cape Canaveral", lp.LaunchSiteName);
        Assert.Equal(2, lp.Level);
        // -1 is RP-1's "never set", not a level below zero.
        Assert.Null(lp.FractionalLevel);
    }

    [Fact]
    public void Research_derives_its_rate_from_the_node_rate_and_the_work_throttle()
    {
        var node = new ResearchProject
        {
            techID = "start", techName = "Start", scienceCost = 100, progress = 20.0, workRate = 0.5,
            startYear = 1951, endYear = 1960,
        };
        node.SetBuildRate(4.0);
        SpaceCenterManagement.Instance = new SpaceCenterManagement { TechList = { node } };

        var research = Single(new Rp1ScReflection().Read(1.0).Research);
        Assert.Equal(2.0, research.Rate!.Value, 6);
        Assert.Equal(40.0, research.TimeLeftSeconds!.Value, 6);
        Assert.Equal(0.2, research.ProgressRatio!.Value, 6);
        Assert.Equal(1951, research.StartYear);
    }

    [Fact]
    public void An_uncosted_research_node_publishes_absent_rate_and_no_era()
    {
        SpaceCenterManagement.Instance = new SpaceCenterManagement
        {
            TechList = { new ResearchProject { techID = "start", scienceCost = 100 } },
        };

        var research = Single(new Rp1ScReflection().Read(1.0).Research);
        Assert.Null(research.Rate);
        Assert.Null(research.TimeLeftSeconds);
        // Year 0 is RP-1's "no era recorded", not the year zero.
        Assert.Null(research.StartYear);
        Assert.Null(research.EndYear);
    }

    [Fact]
    public void Personnel_sums_engineers_across_every_centre()
    {
        SpaceCenterManagement.Instance = new SpaceCenterManagement
        {
            Researchers = 7,
            Applicants = 3,
            KSCs =
            {
                new LCSpaceCenter { KSCName = "Cape", Engineers = 12 },
                new LCSpaceCenter { KSCName = "Baikonur", Engineers = 8 },
            },
        };

        var personnel = new Rp1ScReflection().Read(1.0).Personnel;
        Assert.Equal(20, personnel!.TotalEngineers);
        Assert.Equal(7, personnel.Researchers);
        Assert.Equal(3, personnel.Applicants);
    }

    [Fact]
    public void Confidence_is_absent_rather_than_zero_when_its_module_is_not_live()
    {
        SpaceCenterManagement.Instance = new SpaceCenterManagement();
        Assert.Null(new Rp1ScReflection().Read(1.0).Confidence);
    }

    [Fact]
    public void A_genuine_zero_confidence_is_published_as_a_zero()
    {
        // The reading a career that has spent everything actually has. It must
        // not look like the absent case above.
        SpaceCenterManagement.Instance = new SpaceCenterManagement();
        Confidence.Instance = new Confidence(0.0, 240.0);

        var confidence = new Rp1ScReflection().Read(1.0).Confidence;
        Assert.NotNull(confidence);
        Assert.Equal(0.0, confidence!.Confidence);
        Assert.Equal(240.0, confidence.Earned);
    }

    /// <summary>Installs one launch complex at one centre, with an optional efficiency record.</summary>
    private static void Install(LaunchComplex lc, double? efficiency)
    {
        var ksc = new LCSpaceCenter { KSCName = "Cape", Engineers = 20, LaunchComplexes = { lc } };
        var scm = new SpaceCenterManagement { KSCs = { ksc }, ActiveSC = ksc };
        if (efficiency != null)
        {
            scm.LCToEfficiency[lc] = new LCEfficiency(efficiency.Value);
        }
        SpaceCenterManagement.Instance = scm;
    }

    [Fact]
    public void A_complex_publishes_the_envelope_that_decides_what_can_be_built_there()
    {
        var pad = new LaunchComplex
        {
            Name = "LC-1",
            MassMinValue = 6f,
            MassMaxValue = 180f,
            SizeMaxValue = new UnityEngine.Vector3(9f, 40f, 12f),
        };
        pad.ResourcesHandledValue["LqdOxygen"] = 20_000.0;
        pad.ResourcesHandledValue["Kerosene"] = 8_000.0;
        Install(pad, efficiency: 0.5);

        var complex = Single(new Rp1ScReflection().Read(1.0).Complexes);

        Assert.Equal(6.0, complex.MassMin);
        Assert.Equal(180.0, complex.MassMax);
        // y is the vertical limit, and the three axes are separate because RP-1
        // keeps them separate and they are free to differ.
        Assert.Equal(40.0, complex.SizeMaxHeight);
        Assert.Equal(9.0, complex.SizeMaxWidth);
        Assert.Equal(12.0, complex.SizeMaxDepth);
        // Sorted, so a client's rendering does not move when the dictionary
        // rehashes.
        Assert.Equal(new[] { "Kerosene", "LqdOxygen" }, complex.ResourcesHandled);
    }

    [Fact]
    public void An_unlimited_complex_publishes_no_size_limit_rather_than_a_sentinel()
    {
        // float.MaxValue is RP-1's "no limit", and a client handed 3.4e38 metres
        // would render a number instead of the absence it means.
        var hangar = new LaunchComplex
        {
            Name = "Hangar",
            LcTypeValue = LaunchComplexType.Hangar,
            MassMaxValue = float.MaxValue,
            SizeMaxValue = new UnityEngine.Vector3(float.MaxValue, float.MaxValue, float.MaxValue),
        };
        Install(hangar, efficiency: null);

        var complex = Single(new Rp1ScReflection().Read(1.0).Complexes);

        Assert.Null(complex.MassMax);
        Assert.Null(complex.SizeMaxHeight);
        Assert.Null(complex.SizeMaxWidth);
        Assert.Null(complex.SizeMaxDepth);
    }

    [Fact]
    public void The_costs_are_published_at_all_three_layers_off_RP1s_own_figures()
    {
        var rushing = new LaunchComplex { Name = "LC-1", Engineers = 10, IsRushing = true };
        var quiet = new LaunchComplex { Name = "LC-2", Engineers = 4 };
        var ksc = new LCSpaceCenter
        {
            KSCName = "Cape",
            Engineers = 20,
            LaunchComplexes = { rushing, quiet },
        };
        SpaceCenterManagement.Instance = new SpaceCenterManagement { KSCs = { ksc }, ActiveSC = ksc };
        MaintenanceHandler.Instance = new MaintenanceHandler
        {
            IntegrationSalaryValue = 61.6,
            ResearchSalaryPerDay = 20.0,
            LcUpkeepValues = { [rushing] = 45.0, [quiet] = 30.0 },
        };

        var raw = new Rp1ScReflection().Read(1.0);
        var first = raw.Complexes[0];
        var second = raw.Complexes[1];
        var centre = Single(raw.Centres);

        // 1,000 a year each, 365.25 days: a rushing complex's ten draw double.
        Assert.Equal(10 * 2 * 1000 / 365.25, first.SalaryPerDay!.Value, 6);
        Assert.Equal(4 * 1000 / 365.25, second.SalaryPerDay!.Value, 6);
        Assert.Equal(45.0, first.UpkeepPerDay);
        Assert.Equal(30.0, second.UpkeepPerDay);

        // The centre's is NOT the sum of its complexes': the six engineers
        // assigned to nothing draw a quarter each, which is the fact an idle pool
        // exists to make visible.
        Assert.Equal((10 * 2 + 4 + 6 * 0.25) * 1000 / 365.25, centre.SalaryPerDay!.Value, 6);
        Assert.Equal(75.0, centre.UpkeepPerDay);

        // And that idle term on its own, which is the only part of the bill that
        // buys nothing. RP-1 answers for the total and never for this, so it is
        // published rather than left to a client that would need RP-1's year
        // length to work it out.
        Assert.Equal(6 * 0.25 * 1000 / 365.25, centre.IdleSalaryPerDay!.Value, 6);

        Assert.Equal(61.6, raw.Personnel!.EngineerSalaryPerDay);
        Assert.Equal(20.0, raw.Personnel!.ResearcherSalaryPerDay);
        Assert.Equal(1000.0, raw.Personnel!.EngineerSalaryPerYear);
        Assert.Equal(0.25, raw.Personnel!.IdleSalaryMult);

        // What rushing ADDS, on both complexes and signed the same way in both
        // modes: the one already rushing reports what stopping would save, and
        // the quiet one what starting would cost. It is the crew's own salary
        // over again here, because RP-1 charges every head of a working crew at
        // the rush rate.
        Assert.Equal(10 * 1000 / 365.25, first.RushSalaryDeltaPerDay!.Value, 6);
        Assert.Equal(4 * 1000 / 365.25, second.RushSalaryDeltaPerDay!.Value, 6);
    }

    [Fact]
    public void No_maintenance_handler_publishes_absent_costs_rather_than_free_ones()
    {
        // The main-menu and early-load state for RP-1's own upkeep module. A zero
        // here would tell an operator their complexes cost nothing to run.
        var pad = new LaunchComplex { Name = "LC-1", Engineers = 5 };
        Install(pad, efficiency: 0.5);
        MaintenanceHandler.Instance = null;

        var raw = new Rp1ScReflection().Read(1.0);

        Assert.Null(Single(raw.Complexes).UpkeepPerDay);
        Assert.Null(Single(raw.Centres).UpkeepPerDay);
        Assert.Null(raw.Personnel!.EngineerSalaryPerDay);
        // The salary figures do NOT come off the maintenance handler, so they
        // survive its absence: they are the space centre's own arithmetic.
        Assert.NotNull(Single(raw.Complexes).SalaryPerDay);
    }

    [Fact]
    public void The_rush_terms_come_off_RP1s_settings_rather_than_a_default()
    {
        Install(new LaunchComplex { Name = "LC-1" }, efficiency: 0.5);

        var terms = new Rp1ScReflection().Read(1.0).RushTerms;

        Assert.Equal(1.5, terms!.RateMult);
        Assert.Equal(2.0, terms!.SalaryMult);
    }

    [Fact]
    public void A_complex_publishes_the_tonnage_it_was_built_at_beside_the_one_it_takes_now()
    {
        // A complex renovated up from 60t: RP-1 moved massMax and left massOrig
        // alone, which is the whole reason both have to be on the wire. A client
        // holding massMax alone would compute the envelope off 180 and offer a
        // renovation to 360t that RP-1 refuses at 120.
        var pad = new LaunchComplex
        {
            Name = "LC-1",
            MassMinValue = 12f,
            MassMaxValue = 180f,
            MassOrigValue = 60f,
        };
        Install(pad, efficiency: 0.5);

        var complex = Single(new Rp1ScReflection().Read(1.0).Complexes);

        Assert.Equal(60.0, complex.MassOrig);
        Assert.Equal(180.0, complex.MassMax);
        // The third quantity, and about vehicles rather than about renovation.
        Assert.Equal(12.0, complex.MassMin);
    }

    [Fact]
    public void The_hangar_publishes_no_original_tonnage_rather_than_a_sentinel_or_a_zero()
    {
        // RP-1 records the hangar at its no-limit sentinel and exempts it from
        // the margin check outright. A zero here would compute an envelope of 3t
        // to 1t, which is a confident wrong answer where absence is a readable
        // one.
        var hangar = new LaunchComplex
        {
            Name = "Hangar",
            LcTypeValue = LaunchComplexType.Hangar,
            MassMaxValue = float.MaxValue,
            MassOrigValue = float.MaxValue,
        };
        Install(hangar, efficiency: null);

        Assert.Null(Single(new Rp1ScReflection().Read(1.0).Complexes).MassOrig);
    }

    [Fact]
    public void A_complex_publishes_its_OPERATIONAL_pad_count_not_the_length_of_its_pad_list()
    {
        // Three pads, one of them wrecked. RP-1's dismantle rule needs two
        // WORKING pads, and a client counting rows would say three and offer a
        // dismantle the game refuses.
        var pad = new LaunchComplex { Name = "LC-1" };
        pad.LaunchPads.Add(new LCLaunchPad { name = "Pad A" });
        pad.LaunchPads.Add(new LCLaunchPad { name = "Pad B" });
        pad.LaunchPads.Add(new LCLaunchPad
        {
            name = "Pad C",
            isOperational = false,
            DestroyedValue = true,
            StateValue = LaunchPadState.Destroyed,
        });
        Install(pad, efficiency: 0.5);

        var raw = new Rp1ScReflection().Read(1.0);

        Assert.Equal(2, Single(raw.Complexes).LaunchPadCount);
        // The rows are all three, and the wrecked one reports Destroyed rather
        // than Nonoperational, so the count is not recoverable from them.
        Assert.Equal(3, raw.Pads.Count);
        Assert.Contains(raw.Pads, p => p.State == "Destroyed");
        Assert.DoesNotContain(raw.Pads, p => p.State == "Nonoperational");
    }

    [Fact]
    public void A_complex_under_construction_publishes_zero_operational_pads_rather_than_absent()
    {
        // Zero is the state that makes the complex unusable, so it has to arrive
        // as a number an operator can read rather than as "not said".
        var pad = new LaunchComplex { Name = "LC-1", IsOperational = false };
        pad.LaunchPads.Add(new LCLaunchPad { name = "Pad A", isOperational = false });
        Install(pad, efficiency: 0.5);

        Assert.Equal(0, Single(new Rp1ScReflection().Read(1.0).Complexes).LaunchPadCount);
    }

    [Fact]
    public void Complexes_sharing_one_efficiency_record_each_name_the_others()
    {
        // The fact that makes a bare efficiency scalar honest: work at either of
        // these moves the number at both.
        var a = new LaunchComplex { Name = "LC-1" };
        var b = new LaunchComplex { Name = "LC-2" };
        var alone = new LaunchComplex { Name = "LC-3" };
        var shared = new LCEfficiency(0.5) { _lcs = { a, b } };
        var own = new LCEfficiency(0.7) { _lcs = { alone } };

        var ksc = new LCSpaceCenter { KSCName = "Cape", Engineers = 20, LaunchComplexes = { a, b, alone } };
        var scm = new SpaceCenterManagement { KSCs = { ksc }, ActiveSC = ksc };
        scm.LCToEfficiency[a] = shared;
        scm.LCToEfficiency[b] = shared;
        scm.LCToEfficiency[alone] = own;
        SpaceCenterManagement.Instance = scm;

        var complexes = new Rp1ScReflection().Read(1.0).Complexes;

        Assert.Equal(new[] { b.ID.ToString() }, ByName(complexes, "LC-1").EfficiencySharedWith);
        Assert.Equal(new[] { a.ID.ToString() }, ByName(complexes, "LC-2").EfficiencySharedWith);
        // A record covering one complex is a real answer and is EMPTY, which is
        // not the same as RP-1 holding no record at all.
        Assert.Empty(ByName(complexes, "LC-3").EfficiencySharedWith!);
    }

    [Fact]
    public void A_complex_RP1_has_not_rated_publishes_no_efficiency_peers_rather_than_an_empty_list()
    {
        var pad = new LaunchComplex { Name = "Pad A" };
        Install(pad, efficiency: null);

        var complex = Single(new Rp1ScReflection().Read(1.0).Complexes);
        Assert.Null(complex.Efficiency);
        Assert.Null(complex.EfficiencySharedWith);
    }

    [Fact]
    public void The_hangar_publishes_no_efficiency_peers_though_it_publishes_an_efficiency()
    {
        // Deliberately asymmetric, and the asymmetry is honest: RP-1 rates the
        // hangar at the ceiling without keeping a record for it, so there is a
        // number and there is nothing sharing it.
        var hangar = new LaunchComplex { Name = "Hangar", LcTypeValue = LaunchComplexType.Hangar };
        Install(hangar, efficiency: null);

        var complex = Single(new Rp1ScReflection().Read(1.0).Complexes);
        Assert.NotNull(complex.Efficiency);
        Assert.Null(complex.EfficiencySharedWith);
    }

    [Fact]
    public void A_centre_and_its_complexes_publish_the_name_the_site_config_gives_it()
    {
        KSCSwitcherInterop.Sites = new List<(string, string)>
        {
            ("us_cape_canaveral", "Cape Canaveral"),
            ("ru_baikonur", "Baikonur"),
        };
        var pad = new LaunchComplex { Name = "LC-1" };
        var ksc = new LCSpaceCenter { KSCName = "us_cape_canaveral", Engineers = 5, LaunchComplexes = { pad } };
        SpaceCenterManagement.Instance = new SpaceCenterManagement { KSCs = { ksc }, ActiveSC = ksc };

        var raw = new Rp1ScReflection().Read(1.0);

        Assert.Equal("Cape Canaveral", Single(raw.Centres).KscDisplayName);
        // Carried on the complex too, because the surfaces that render a complex
        // row do not all join to the centres channel.
        Assert.Equal("Cape Canaveral", Single(raw.Complexes).KscDisplayName);
        Assert.Equal("us_cape_canaveral", Single(raw.Centres).KscName);
    }

    [Fact]
    public void No_KSCSwitcher_publishes_no_display_name_rather_than_the_id_again()
    {
        // The commonest install of all: RP-1 answers null, and so must we. A
        // client falls back to the id, which is what the game shows.
        KSCSwitcherInterop.Sites = null;
        var ksc = new LCSpaceCenter { KSCName = "Stock", Engineers = 5 };
        SpaceCenterManagement.Instance = new SpaceCenterManagement { KSCs = { ksc }, ActiveSC = ksc };

        Assert.Null(Single(new Rp1ScReflection().Read(1.0).Centres).KscDisplayName);
    }

    [Fact]
    public void A_site_whose_display_name_is_its_own_id_publishes_nothing()
    {
        // RP-1's getter substitutes the id when a site declares no display name.
        // Republishing that would put us_cape_canaveral back on the screen under
        // a field claiming to be a name, which is the bug wearing the fix's name.
        KSCSwitcherInterop.Sites = new List<(string, string)> { ("us_cape_canaveral", "us_cape_canaveral") };
        var ksc = new LCSpaceCenter { KSCName = "us_cape_canaveral", Engineers = 5 };
        SpaceCenterManagement.Instance = new SpaceCenterManagement { KSCs = { ksc }, ActiveSC = ksc };

        Assert.Null(Single(new Rp1ScReflection().Read(1.0).Centres).KscDisplayName);
    }

    /// <summary>
    /// The balance is ABSENT rather than zero when the module is live and its
    /// field will not read. This is the one case the two tests above cannot
    /// reach between them: the instance probe says RP-1 is here, so a
    /// substituted zero arrives looking exactly like the spent career the test
    /// above pins, and it is the figure a client darkens an Accept button on.
    /// </summary>
    [Fact]
    public void A_live_module_with_an_unreadable_balance_publishes_no_confidence_rather_than_zero()
    {
        SpaceCenterManagement.Instance = new SpaceCenterManagement();
        Confidence.Instance = new Confidence(500.0, 900.0);
        Confidence.ThrowOnBalanceRead = true;

        var confidence = new Rp1ScReflection().Read(1.0).Confidence;

        // Present, because the module IS live: that half is what the probe says.
        Assert.NotNull(confidence);
        Assert.Null(confidence!.Confidence);
        Assert.Null(confidence.Earned);
    }

    /// <summary>
    /// An unreadable centre roster leaves the idle count ABSENT. Substituted, it
    /// went NEGATIVE: the complexes' crews still read, so the subtraction ran
    /// zero minus a real assignment and published "0 hired, 12 assigned, -12
    /// idle" on a fully staffed centre.
    /// </summary>
    [Fact]
    public void An_unreadable_centre_roster_publishes_no_idle_count_rather_than_a_negative_one()
    {
        var pad = new LaunchComplex { Name = "Pad A", Engineers = 12 };
        var ksc = new LCSpaceCenterWithUnreadableRoster { KSCName = "Cape", LaunchComplexes = { pad } };
        SpaceCenterManagement.Instance = new SpaceCenterManagement { KSCs = { ksc }, ActiveSC = ksc };

        var raw = new Rp1ScReflection().Read(1.0);
        var centre = Single(raw.Centres);

        Assert.Null(centre.Engineers);
        Assert.Null(centre.UnassignedEngineers);
        // The salary term derived from the same subtraction goes with it.
        Assert.Null(centre.IdleSalaryPerDay);
        // And the career total, which a centre nobody could count is not part of.
        Assert.Null(raw.Personnel!.TotalEngineers);
    }

    /// <summary>
    /// The other half of the same subtraction: a complex whose crew will not
    /// count leaves both the complex's own figure and the centre's idle pool
    /// absent, rather than reporting the centre's whole roster as idle.
    /// </summary>
    [Fact]
    public void An_unreadable_complex_crew_leaves_the_centres_idle_pool_absent()
    {
        var pad = new LaunchComplexWithUnreadableCrew { Name = "Pad A" };
        var ksc = new LCSpaceCenter { KSCName = "Cape", Engineers = 12, LaunchComplexes = { pad } };
        SpaceCenterManagement.Instance = new SpaceCenterManagement { KSCs = { ksc }, ActiveSC = ksc };

        var raw = new Rp1ScReflection().Read(1.0);

        Assert.Null(Single(raw.Complexes).Engineers);
        Assert.Equal(12, Single(raw.Centres).Engineers);
        Assert.Null(Single(raw.Centres).UnassignedEngineers);
    }

    /// <summary>
    /// An unreadable throttle takes the rate, the stall flag and the ETA with
    /// it. Assumed at 1.0 it did the opposite of what the uncosted guard exists
    /// for: it walked a costed base rate straight through and published a
    /// confident finish date for a project nobody could say was moving.
    /// </summary>
    [Fact]
    public void A_construction_with_an_unreadable_throttle_publishes_no_rate_or_ETA()
    {
        var project = new FacilityUpgradeProject { name = "LaunchPad", BP = 1000.0, progress = 200.0 };
        project.SetBuildRate(4.0);
        var ksc = new LCSpaceCenter { KSCName = "Cape", FacilityUpgrades = { project } };
        SpaceCenterManagement.Instance = new SpaceCenterManagement { KSCs = { ksc }, ActiveSC = ksc };
        ConstructionProject.ThrowOnWorkRateRead = true;

        var row = Single(new Rp1ScReflection().Read(1.0).Constructions);

        Assert.Null(row.WorkRate);
        Assert.Null(row.Rate);
        Assert.Null(row.TimeLeftSeconds);
        Assert.False(row.Stalled);
    }

    /// <summary>The research queue's copy of the same rule.</summary>
    [Fact]
    public void A_research_node_with_an_unreadable_throttle_publishes_no_rate_or_ETA()
    {
        var node = new ResearchProjectWithUnreadableWorkRate
        {
            techID = "start_rocketry",
            techName = "Start",
            scienceCost = 100,
            progress = 20.0,
        };
        node.SetBuildRate(4.0);
        SpaceCenterManagement.Instance = new SpaceCenterManagement { TechList = { node } };

        var row = Single(new Rp1ScReflection().Read(1.0).Research);

        Assert.Null(row.WorkRate);
        Assert.Null(row.Rate);
        Assert.Null(row.TimeLeftSeconds);
        Assert.False(row.Stalled);
    }

    /// <summary>
    /// A price nobody could read is not a free rocket. Vehicle, operation and
    /// construction together, because the three substitutions were the same one
    /// written three times.
    /// </summary>
    [Fact]
    public void An_unreadable_price_is_absent_rather_than_zero_on_every_priced_row()
    {
        var vp = new VesselProjectWithUnreadablePrice { shipName = "Vanguard", buildPoints = 1000.0 };
        var op = new ReconRolloutProjectWithUnreadablePrice
        {
            BP = 1000.0,
            progress = 400.0,
            RRType = ReconRolloutProject.RolloutReconType.Rollout,
        };
        var pad = new LaunchComplex { Name = "Pad A" };
        pad.BuildList.Add(vp);
        pad.Recon_Rollout.Add(op);
        var project = new FacilityUpgradeProject { name = "LaunchPad", BP = 1000.0 };
        var ksc = new LCSpaceCenter { KSCName = "Cape", LaunchComplexes = { pad }, FacilityUpgrades = { project } };
        SpaceCenterManagement.Instance = new SpaceCenterManagement { KSCs = { ksc }, ActiveSC = ksc };
        ConstructionProject.ThrowOnCostRead = true;

        var raw = new Rp1ScReflection().Read(1.0);

        var vehicle = Single(raw.BuildQueue);
        Assert.Null(vehicle.Cost);
        Assert.Null(vehicle.Mass);

        var operation = Single(raw.Operations);
        Assert.Null(operation.Cost);
        // What is left to pay of a price nobody read is not zero either.
        Assert.Null(operation.CostRemaining);

        var construction = Single(raw.Constructions);
        Assert.Null(construction.Cost);
        Assert.Null(construction.SpentCost);
        Assert.Null(construction.SpentRushCost);
    }

    /// <summary>
    /// A centre's upkeep is absent unless EVERY complex answered. Summed over
    /// the ones that did, it is a plausible bill in the right units that an
    /// operator cannot tell from a correct one.
    /// </summary>
    [Fact]
    public void A_centre_whose_complexes_are_only_partly_priced_publishes_no_upkeep()
    {
        var priced = new LaunchComplex { Name = "Pad A" };
        var unpriceable = new LaunchComplex { Name = "Pad B" };
        var ksc = new LCSpaceCenter { KSCName = "Cape", LaunchComplexes = { priced, unpriceable } };
        SpaceCenterManagement.Instance = new SpaceCenterManagement { KSCs = { ksc }, ActiveSC = ksc };
        var maintenance = new MaintenanceHandler();
        maintenance.LcUpkeepValues[priced] = 40.0;
        maintenance.UnpriceableComplexes.Add(unpriceable);
        MaintenanceHandler.Instance = maintenance;

        var raw = new Rp1ScReflection().Read(1.0);

        Assert.Equal(40.0, ByName(raw.Complexes, "Pad A").UpkeepPerDay);
        Assert.Null(ByName(raw.Complexes, "Pad B").UpkeepPerDay);
        Assert.Null(Single(raw.Centres).UpkeepPerDay);
    }

    /// <summary>The same centre with both complexes priced still totals them, so the guard above is not a blanket refusal.</summary>
    [Fact]
    public void A_centre_whose_complexes_all_answer_still_totals_them()
    {
        var first = new LaunchComplex { Name = "Pad A" };
        var second = new LaunchComplex { Name = "Pad B" };
        var ksc = new LCSpaceCenter { KSCName = "Cape", LaunchComplexes = { first, second } };
        SpaceCenterManagement.Instance = new SpaceCenterManagement { KSCs = { ksc }, ActiveSC = ksc };
        var maintenance = new MaintenanceHandler();
        maintenance.LcUpkeepValues[first] = 40.0;
        maintenance.LcUpkeepValues[second] = 60.0;
        MaintenanceHandler.Instance = maintenance;

        Assert.Equal(100.0, Single(new Rp1ScReflection().Read(1.0).Centres).UpkeepPerDay);
    }

    /// <summary>
    /// Research and applicant head counts are ABSENT rather than zero. A career
    /// with nobody in research genuinely sits at 0, so the substitution arrives
    /// looking exactly like a reading, and it is the figure the hire control
    /// counts a target up from.
    /// </summary>
    [Fact]
    public void An_unreadable_research_roster_publishes_no_head_count_rather_than_zero()
    {
        SpaceCenterManagement.Instance = new SpaceCenterManagementWithUnreadableStaff();

        var personnel = new Rp1ScReflection().Read(1.0).Personnel;

        Assert.NotNull(personnel);
        Assert.Null(personnel!.Researchers);
        Assert.Null(personnel.Applicants);
    }

    /// <summary>
    /// The crew CEILING, absent rather than zero. It sits directly beside the
    /// crew count and is read off the same object, so leaving it substituted was
    /// the adjacent-reads-treated-differently shape: a complex staffed past a
    /// cap of nobody, and a hire control darkened on a complex with room in it.
    ///
    /// <para>The ETA is asserted as UNCHANGED on purpose. The ramp needs the cap
    /// and now declines without it, but a substituted cap of zero already
    /// no-opped the ramp inside <c>RampedTimeLeft</c>, so the two agree on the
    /// clock and the published field is the whole of the difference. Asserting a
    /// shorter ETA here would be a test that passes either way.</para>
    /// </summary>
    [Fact]
    public void An_unreadable_crew_ceiling_publishes_no_maximum_rather_than_a_cap_of_nobody()
    {
        var vp = new VesselProject { shipName = "Titan", buildPoints = 4_000_000.0 };
        vp.SetBuildRate(1.0);
        var pad = new LaunchComplexWithUnreadableMaxCrew { Name = "Pad A", Engineers = 50 };
        pad.BuildList.Add(vp);
        Install(pad, efficiency: 0.5);

        var raw = new Rp1ScReflection().Read(1.0);

        Assert.Null(Single(raw.Complexes).MaxEngineers);
        // The crew still counts, which is what makes this the adjacent-read case.
        Assert.Equal(50, Single(raw.Complexes).Engineers);
        // Un-ramped, and therefore RP-1's plain division: 4e6 points at 0.5/s.
        Assert.Equal(8_000_000.0, Single(raw.BuildQueue).TimeLeftSeconds!.Value, 6);
    }

    /// <summary>
    /// A pad's tier, absent rather than zero. Tier 0 is a real pad flying small
    /// rockets, so the substitution is a tier an operator cannot tell from a
    /// read one.
    /// </summary>
    [Fact]
    public void An_unreadable_pad_tier_publishes_no_level_rather_than_tier_zero()
    {
        var pad = new LaunchComplex { Name = "Pad A" };
        pad.LaunchPads.Add(new LCLaunchPadWithUnreadableLevel { name = "Pad A-1" });
        Install(pad, efficiency: 1.0);

        Assert.Null(Single(new Rp1ScReflection().Read(1.0).Pads).Level);
    }

    /// <summary>
    /// A vehicle that will not say where it stands publishes no progress, no
    /// fraction and no ETA. Substituted, the two zeros made a vehicle that is
    /// half built read as one nobody has started, and the ETA divided a total of
    /// nothing.
    /// </summary>
    [Fact]
    public void An_unreadable_build_progress_publishes_no_fraction_or_ETA()
    {
        var vp = new VesselProjectWithUnreadableProgress { shipName = "Agena" };
        vp.SetBuildRate(4.0);
        var pad = new LaunchComplex { Name = "Pad A", Engineers = 10 };
        pad.BuildList.Add(vp);
        Install(pad, efficiency: 0.5);

        var item = Single(new Rp1ScReflection().Read(1.0).BuildQueue);

        Assert.Null(item.Progress);
        Assert.Null(item.TotalPoints);
        Assert.Null(item.ProgressRatio);
        Assert.Null(item.TimeLeftSeconds);
        // The RATE still reads, which is the point: this row has been costed, so
        // a client saying "not costed yet" here would be telling an operator to
        // wait for a recalculation that has already happened.
        Assert.Equal(2.0, item.Rate!.Value, 6);
    }

    /// <summary>
    /// A blocking move whose build points will not read stays IN the set and
    /// takes every ETA on the complex with it. Substituted, its points and its
    /// progress both came out at zero, which satisfied the completeness test and
    /// dropped it from the set outright: the survivors then divided a complex
    /// they did not have to themselves and every ETA answered EARLY.
    /// </summary>
    [Fact]
    public void An_unreadable_blocking_move_leaves_its_peers_without_an_early_ETA()
    {
        var unreadable = new ReconRolloutProjectWithUnreadablePoints
        {
            progress = 100.0,
            RRType = ReconRolloutProject.RolloutReconType.Rollout,
        };
        unreadable.SetBuildRate(4.0);
        var peer = new ReconRolloutProject
        {
            BP = 1000.0,
            progress = 500.0,
            RRType = ReconRolloutProject.RolloutReconType.Rollout,
        };
        peer.SetBuildRate(4.0);
        var pad = new LaunchComplex { Name = "Pad A" };
        pad.Recon_Rollout.Add(unreadable);
        pad.Recon_Rollout.Add(peer);
        Install(pad, efficiency: 0.5);

        var raw = new Rp1ScReflection().Read(1.0);

        // Both rows are still there, and the readable one still names its peer.
        Assert.Equal(2, raw.Operations.Count);
        Assert.All(raw.Operations, op => Assert.Null(op.TimeLeftSeconds));
        Assert.All(raw.Operations, op => Assert.Equal(1, op.BlockingPeers));

        // And the complex cannot say it is clear to integrate, because the sum
        // that decides it is missing a term.
        Assert.Null(Single(raw.Complexes).CanIntegrate);
    }

    /// <summary>
    /// The blocking total is absent, never a sum short by one unreadable
    /// operation, and the vehicles behind it get no rate. Zero is the value that
    /// CLEARS integration, so a total that quietly omits a blocking rollout does
    /// not read as a gap: it reads as a clear pad, and every vehicle on it
    /// publishes a confident full-speed rate.
    /// </summary>
    [Fact]
    public void An_unreadable_blocking_move_stops_the_complex_claiming_it_can_integrate()
    {
        var vp = new VesselProject { shipName = "Gemini", buildPoints = 1000.0 };
        vp.SetBuildRate(4.0);
        var unreadable = new ReconRolloutProjectWithUnreadablePoints
        {
            progress = 100.0,
            RRType = ReconRolloutProject.RolloutReconType.Rollout,
        };
        var pad = new LaunchComplex { Name = "Pad A" };
        pad.BuildList.Add(vp);
        pad.Recon_Rollout.Add(unreadable);
        Install(pad, efficiency: 0.5);

        var raw = new Rp1ScReflection().Read(1.0);

        Assert.Null(Single(raw.Complexes).CanIntegrate);
        Assert.Null(Single(raw.BuildQueue).Rate);
        Assert.False(Single(raw.BuildQueue).Stalled);
    }

    /// <summary>
    /// A construction that will not say how big it is publishes no fraction and
    /// no ETA, rather than a total of nothing to divide by.
    /// </summary>
    [Fact]
    public void An_unreadable_construction_size_publishes_no_fraction_or_ETA()
    {
        var project = new FacilityUpgradeProject { name = "LaunchPad", progress = 200.0 };
        project.SetBuildRate(4.0);
        var ksc = new LCSpaceCenter { KSCName = "Cape", FacilityUpgrades = { project } };
        SpaceCenterManagement.Instance = new SpaceCenterManagement { KSCs = { ksc }, ActiveSC = ksc };
        ConstructionProject.ThrowOnBpRead = true;

        var row = Single(new Rp1ScReflection().Read(1.0).Constructions);

        Assert.Null(row.TotalPoints);
        Assert.Null(row.ProgressRatio);
        Assert.Null(row.TimeLeftSeconds);
        // Costed, as above: the rate is what says so.
        Assert.Equal(4.0, row.Rate!.Value, 6);
    }

    /// <summary>
    /// A research node's science price, absent rather than zero. Science is the
    /// one currency RP-1 genuinely refuses a purchase over, so a substituted
    /// cost tells an operator the node is free and always affordable.
    /// </summary>
    [Fact]
    public void An_unreadable_science_price_publishes_no_cost_rather_than_a_free_node()
    {
        var node = new ResearchProjectWithUnreadableCost { techID = "start", techName = "Start" };
        node.SetBuildRate(4.0);
        SpaceCenterManagement.Instance = new SpaceCenterManagement { TechList = { node } };

        var research = Single(new Rp1ScReflection().Read(1.0).Research);

        Assert.Null(research.ScienceCost);
        Assert.Null(research.Progress);
        Assert.Null(research.ProgressRatio);
        Assert.Null(research.TimeLeftSeconds);
        Assert.Equal(4.0, research.Rate!.Value, 6);
    }

    /// <summary>
    /// One unreadable axis takes the whole efficiency group key, which is what
    /// this reading already promises. A substituted zero does not degrade the
    /// key, it makes a FALSE one: the axis collapses onto every other complex
    /// whose axis went unread, so two complexes RP-1 rates separately publish
    /// the same group and read as sharing a crew rating.
    /// </summary>
    [Fact]
    public void An_unreadable_envelope_axis_publishes_no_efficiency_group_key()
    {
        Install(new LaunchComplexWithUnreadableSizeAxis { Name = "Pad A" }, efficiency: 0.5);

        Assert.Null(Single(new Rp1ScReflection().Read(1.0).Complexes).EfficiencyGroupKey);
    }

    /// <summary>
    /// And an unreadable resource CAPACITY, on the same terms: RP-1 compares
    /// names and amounts, so "=0" is a capacity rather than a stand-in, and two
    /// complexes carrying different amounts of the same propellant would publish
    /// one group.
    /// </summary>
    [Fact]
    public void An_unreadable_resource_capacity_publishes_no_efficiency_group_key()
    {
        Install(new LaunchComplexWithUnreadableResourceAmount { Name = "Pad A" }, efficiency: 0.5);

        Assert.Null(Single(new Rp1ScReflection().Read(1.0).Complexes).EfficiencyGroupKey);
    }

    private static Rp1ComplexRaw ByName(List<Rp1ComplexRaw> complexes, string name) =>
        complexes.Single(c => c.Name == name);

    private static T Single<T>(List<T> list) => Assert.Single(list.AsEnumerable());
}
