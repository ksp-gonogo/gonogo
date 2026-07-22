using System.Collections.Generic;
using Gonogo.KerbalismUplink;
using Sitrep.Contract;
using Xunit;

public class KerbalismCaptureTests
{
    // All values grounded in local_docs/kerbalism-fixtures/kerbalism-fixture-baseline-crp.json.

    [Fact]
    public void BuildSpaceWeather_maps_baseline_crp_fixture()
    {
        var snap = new KerbalismSnapshot
        {
            Radiation = 3.979330252466535e-06,
            HabitatRadiation = 3.979330252466535e-06,
            Magnetosphere = true,
            InnerBelt = false,
            OuterBelt = false,
            StormIncoming = false,
            StormInProgress = false,
            Blackout = false,
            InSunlight = true,
            ShieldingAmount = 0,
            ShieldingCapacity = 3.308449424001643,
        };
        var sw = KerbalismCapture.BuildSpaceWeather(snap);
        Assert.Equal(3.979330252466535e-06, (double)sw["radiationRadPerSecond"]!, 12);
        Assert.Equal(true, sw["magnetosphere"]);
        Assert.Equal(false, sw["innerBelt"]);
        Assert.Equal(3.308449424001643, (double)sw["shieldingCapacity"]!, 12);
    }

    [Fact]
    public void BuildLifeSupport_maps_food_consumable_and_processes()
    {
        var snap = new KerbalismSnapshot
        {
            FoodAmount = 1.35,
            FoodCapacity = 1.35,
            FoodRate = -1.2035471250352793e-05,
        };
        var processes = new List<ProcessRaw>
        {
            new() { Resource = "_Scrubber", Title = "Scrubber", Capacity = 1.67, Running = true, Broken = false },
        };
        var ls = KerbalismCapture.BuildLifeSupport(snap, processes);
        var food = (Dictionary<string, object?>)ls["food"]!;
        Assert.Equal(1.35, (double)food["amount"]!, 6);
        Assert.Equal(-1.2035471250352793e-05, (double)food["rate"]!, 12);

        var procs = (List<object>)ls["processes"]!;
        var scrubber = (Dictionary<string, object?>)procs[0];
        Assert.Equal("Scrubber", scrubber["title"]);
        Assert.Equal(true, scrubber["running"]);
    }

    [Fact]
    public void BuildFeatures_reports_reliability_off_under_ro()
    {
        var f = KerbalismCapture.BuildFeatures(new Dictionary<string, bool>
        {
            ["Reliability"] = false,
            ["Radiation"] = true,
        });
        Assert.Equal(false, f["reliability"]);
        Assert.Equal(true, f["radiation"]);
    }

    [Fact]
    public void BuildCrew_merges_accumulator_value_with_profile_degen_constants()
    {
        var crew = new[]
        {
            new KerbalRulesRaw
            {
                Name = "Valentina Kerman", Trait = "Pilot",
                Rules = new() { ["radiation"] = 0.00014101834111076338, ["stress"] = 4.937349288767713e-05 },
            },
        };
        var constants = new Dictionary<string, RuleConstants>
        {
            ["radiation"] = new RuleConstants { DegenPerSec = 1.0e-05, FatalThreshold = 1.0 },
        };
        var built = KerbalismCapture.BuildCrew(crew, constants);
        var kerbal = (Dictionary<string, object?>)built[0];
        Assert.Equal("Valentina Kerman", kerbal["name"]);

        var rules = (List<object>)kerbal["rules"]!;
        var radiation = (Dictionary<string, object?>)rules[0];
        Assert.Equal("radiation", radiation["name"]);
        Assert.Equal(0.00014101834111076338, (double)radiation["value"]!, 12);
        // degen comes from Profile.rules, NOT the accumulator
        Assert.Equal(1.0e-05, (double)radiation["degenPerSec"]!, 12);
        Assert.Equal(1.0, (double)radiation["fatalThreshold"]!, 6);

        // a rule with no constant entry defaults to 0, never throws
        var stress = (Dictionary<string, object?>)rules[1];
        Assert.Equal(0.0, (double)stress["degenPerSec"]!, 12);
    }
}

public class KerbalismReliabilityMapTests
{
    [Fact]
    public void Summary_reports_kerbalism_source_and_modeled_state()
    {
        var raw = new ReliabilityRaw { Malfunction = false, Critical = false };
        var s = KerbalismReliabilityMap.Summary(raw, modeled: true);
        Assert.Equal(false, s.Unmodeled);
        Assert.Equal("kerbalism", s.Source);
        Assert.Null(s.WorstReliabilityFraction);   // TestFlight-only field stays null
    }

    [Fact]
    public void Summary_reports_unmodeled_when_feature_off()
    {
        var raw = new ReliabilityRaw { Malfunction = true, Critical = true };
        var s = KerbalismReliabilityMap.Summary(raw, modeled: false);
        Assert.Equal(true, s.Unmodeled);
        // unmodeled -> the malfunction/critical bools are suppressed (not authoritative)
        Assert.Equal(false, s.Malfunction);
        Assert.Equal(false, s.Critical);
    }

    [Fact]
    public void Parts_maps_consumed_fractions_and_leaves_testflight_fields_null()
    {
        var raw = new ReliabilityRaw();
        raw.Parts.Add(new ReliabilityPartRaw
        {
            PartId = "7", Title = "LV-909", Group = "engine", Broken = false, Critical = false,
            Mtbf = 100, IgnitionsConsumed = 0.25, DurationConsumed = 0.4, NeedsRepair = false,
        });
        var parts = KerbalismReliabilityMap.Parts(raw, modeled: true);
        Assert.Single(parts);
        Assert.Equal(0.25, parts[0].IgnitionsConsumed);
        Assert.Equal(0.4, parts[0].DurationConsumed);
        Assert.Null(parts[0].ReliabilityFraction);
        Assert.Null(parts[0].RemainingRatedBurn);
    }

    [Fact]
    public void Parts_are_empty_when_unmodeled()
    {
        var raw = new ReliabilityRaw();
        raw.Parts.Add(new ReliabilityPartRaw { PartId = "7", Title = "LV-909" });
        Assert.Empty(KerbalismReliabilityMap.Parts(raw, modeled: false));
    }
}
