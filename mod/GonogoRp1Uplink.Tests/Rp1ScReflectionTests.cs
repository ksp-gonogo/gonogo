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
    }

    public void Dispose()
    {
        SpaceCenterManagement.Instance = null;
        Confidence.Instance = null;
        MaintenanceHandler.Instance = null;
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
        Assert.Equal(5000.0, item.Cost, 6);
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

    private static T Single<T>(List<T> list) => Assert.Single(list.AsEnumerable());
}
