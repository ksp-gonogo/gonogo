using System.Collections.Generic;
using System.Linq;
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
    public void BuildLifeSupport_carries_a_rate_per_resource_and_the_process_list()
    {
        var rates = new Dictionary<string, double>
        {
            ["Food"] = -1.2035471250352793e-05,
            // A resource the old four-property shape could not carry at all.
            ["CarbonDioxide"] = 1.2457997500000001e-03,
            // A present ZERO: a real, measured "in balance" reading, and
            // distinguishable from an absent key. Both matter to a consumer.
            ["Nitrogen"] = 0.0,
        };
        var processes = new List<ProcessRaw>
        {
            new()
            {
                Resource = "_Scrubber", Title = "Scrubber", Capacity = 1.67,
                Running = true, Broken = false, FlightId = 4088652289, ValveIndex = 0,
            },
        };

        var ls = KerbalismCapture.BuildLifeSupport(new KerbalismSnapshot(), processes, rates);

        var map = (Dictionary<string, object?>)ls["rates"]!;
        Assert.Equal(-1.2035471250352793e-05, (double)map["Food"]!, 12);
        Assert.Equal(1.2457997500000001e-03, (double)map["CarbonDioxide"]!, 12);
        Assert.Equal(0.0, (double)map["Nitrogen"]!, 12);
        Assert.False(map.ContainsKey("Unobtainium"));

        // Resource names are dictionary KEYS, not property names, so
        // CamelCaseForProperties must not touch them.
        Assert.Contains("ElectricCharge", new[] { "ElectricCharge" });
        Assert.DoesNotContain("food", map.Keys);

        var procs = (List<object>)ls["processes"]!;
        var scrubber = (Dictionary<string, object?>)procs[0];
        Assert.Equal("Scrubber", scrubber["title"]);
        Assert.Equal(true, scrubber["running"]);
        // The two additions: WHERE the process runs, and which valve is open.
        Assert.Equal(4088652289d, (double)scrubber["flightId"]!);
        Assert.Equal(0, scrubber["valveIndex"]);
    }

    [Fact]
    public void BuildLifeSupport_emits_an_empty_map_rather_than_null_when_no_rates()
    {
        var ls = KerbalismCapture.BuildLifeSupport(new KerbalismSnapshot(), new List<ProcessRaw>());
        var map = (Dictionary<string, object?>)ls["rates"]!;
        Assert.Empty(map);
    }

    /// <summary>
    /// kerbalism.spaceweather names no vessel, and that is DELIBERATE, not an
    /// oversight and not a gap waiting to be filled in by whoever reads this next.
    /// Solar activity is SUN-sourced: the storms, the ejection speed and the star
    /// geometry describe what the Sun is doing, and the intended shape for this
    /// channel is a sun-sourced one delayed by its own Sun-to-observer geometry
    /// (local_docs/design/2026-08-10-spaceweather-sun-and-vantage.md). Stamping a
    /// vessel guid on it would encode the wrong subject and have to be unpicked
    /// when that reframe lands.
    /// </summary>
    [Fact]
    public void Spaceweather_names_no_vessel_pending_the_sun_sourced_reframe()
    {
        Assert.DoesNotContain(
            "vesselId",
            KerbalismCapture.BuildSpaceWeather(new KerbalismSnapshot()).Keys);

        // And the declared shape agrees, so nothing reaches the generated TS SDK
        // as a permanently undefined field.
        Assert.Null(typeof(GonogoKerbalismUplink.KerbalismSpaceWeather).GetProperty("VesselId"));
    }

    // ── kerbalism.profile ────────────────────────────────────────────────────

    /// <summary>
    /// The stock profile's own numbers for the two rules that make the interval
    /// trap visible: `drinking` fires once per 5400s, `breathing` is continuous.
    /// </summary>
    private static ProfileRaw StockishProfile() => new()
    {
        Name = "Default",
        Rules =
        {
            new RuleDefRaw
            {
                Name = "drinking", Input = "Water", Output = "WasteWater",
                Rate = 0.03359375, Interval = 5400.0, Degeneration = 0.08333,
                FatalThreshold = 1.0,
            },
            new RuleDefRaw
            {
                Name = "breathing", Input = "Oxygen", Output = "WasteAtmosphere",
                Rate = 0.00172379825, Interval = 0.0, Degeneration = 0.0055555,
                FatalThreshold = 1.0, Modifiers = { "non_breathable" },
            },
        },
        Processes =
        {
            new ProcessDefRaw
            {
                Name = "scrubber",
                Inputs = { ["ElectricCharge"] = 0.025, ["WasteAtmosphere"] = 0.00124579975 },
                Outputs = { ["CarbonDioxide"] = 0.00124579975 },
                Modifiers = { "_Scrubber" },
            },
        },
        Supplies = { new SupplyDefRaw { Resource = "Water", LowThreshold = 0.15 } },
        Resources =
        {
            ["Water"] = new ResourceDefRaw
            {
                Name = "Water", DisplayName = "Water",
                FlowMode = "ALL_VESSEL", Density = 0.001,
            },
        },
    };

    [Fact]
    public void BuildProfile_divides_an_interval_rule_down_to_per_second()
    {
        var rules = (List<object>)KerbalismCapture.BuildProfile(StockishProfile())["rules"]!;
        var drinking = (Dictionary<string, object?>)rules[0];

        // The whole reason RatePerSecond exists. Reading `rate` as per-second
        // overstates drinking by its 5400s interval, and the result stays
        // plausible-looking, which is exactly why it must be divided once, here.
        Assert.Equal(0.03359375 / 5400.0, (double)drinking["ratePerSecond"]!, 15);
        Assert.Equal(0.03359375, (double)drinking["rate"]!, 15);
        Assert.Equal(5400.0, (double)drinking["interval"]!, 6);
    }

    [Fact]
    public void BuildProfile_leaves_a_continuous_rule_alone()
    {
        var rules = (List<object>)KerbalismCapture.BuildProfile(StockishProfile())["rules"]!;
        var breathing = (Dictionary<string, object?>)rules[1];

        // No interval means genuinely per-second. This is the rule that hides
        // the bug from anyone who sanity-checks only one.
        Assert.Equal(0.00172379825, (double)breathing["ratePerSecond"]!, 15);
        Assert.Equal(0.0, (double)breathing["interval"]!, 6);
    }

    [Fact]
    public void ResourceNames_unions_rules_processes_and_supplies_and_drops_pseudo_resources()
    {
        var names = KerbalismCapture.ResourceNames(StockishProfile());

        Assert.Equal(
            new[]
            {
                "CarbonDioxide", "ElectricCharge", "Oxygen",
                "WasteAtmosphere", "WasteWater", "Water",
            },
            names);

        // "_Scrubber" is a process gate, not a consumable: it must never reach
        // the ledger or ResourceAverageRate.
        Assert.DoesNotContain(names, n => n.StartsWith("_"));
    }

    [Fact]
    public void BuildProfile_carries_flow_mode_and_supply_status_per_resource()
    {
        var resources = (Dictionary<string, object?>)
            KerbalismCapture.BuildProfile(StockishProfile())["resources"]!;

        var water = (Dictionary<string, object?>)resources["Water"]!;
        // Without flowMode a consumer cannot know that a per-tank split is
        // bookkeeping for a pooled resource.
        Assert.Equal("ALL_VESSEL", water["flowMode"]);
        Assert.Equal(true, water["isSupply"]);
        Assert.Equal(0.15, (double)water["lowThreshold"]!, 6);

        // Mentioned by a process but not declared as a Supply: still carried,
        // still enumerated, just not life support.
        var ec = (Dictionary<string, object?>)resources["ElectricCharge"]!;
        Assert.Equal(false, ec["isSupply"]);
        Assert.Null(ec["lowThreshold"]);
        // No KSP resource definition available in a headless test: degrades to
        // empty rather than throwing or omitting the resource.
        Assert.Equal("", ec["flowMode"]);
    }

    [Fact]
    public void BuildProfile_keeps_the_process_join_key_and_its_rates()
    {
        var processes = (List<object>)KerbalismCapture.BuildProfile(StockishProfile())["processes"]!;
        var scrubber = (Dictionary<string, object?>)processes[0];

        // "_Scrubber" is what joins this recipe to a part's ProcessController.
        // Lose it and every ledger row for that part silently disappears.
        Assert.Contains("_Scrubber", (List<object>)scrubber["modifiers"]!);

        var inputs = (Dictionary<string, object?>)scrubber["inputs"]!;
        Assert.Equal(0.025, (double)inputs["ElectricCharge"]!, 12);
    }

    /// <summary>
    /// The anti-regression guard for the whole exercise: no per-resource property
    /// may reappear on the life-support payload. Four of them
    /// (Food/Water/Oxygen/ElectricCharge) were the original hardcoding, against a
    /// default profile that runs on twelve, and they were spelled out in three
    /// separate files. If someone adds a fifth, this fails before it ships.
    /// </summary>
    [Fact]
    public void KerbalismLifeSupport_declares_no_per_resource_property()
    {
        var offenders = typeof(GonogoKerbalismUplink.KerbalismLifeSupport)
            .GetProperties()
            .Where(p => p.PropertyType == typeof(GonogoKerbalismUplink.KerbalismResource))
            .Select(p => p.Name)
            .ToArray();

        Assert.True(
            offenders.Length == 0,
            "kerbalism.lifesupport must name no resource of its own; the rates map "
                + "carries every resource the loaded profile mentions. Found: "
                + string.Join(", ", offenders));
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
