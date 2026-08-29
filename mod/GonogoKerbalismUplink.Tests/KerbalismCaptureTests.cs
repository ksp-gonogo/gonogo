using System.Collections.Generic;
using System.Linq;
using Gonogo.KerbalismUplink;
using GonogoKerbalismUplink;
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

    /// <summary>
    /// A CME slot names its target, so the client can say who the storm is
    /// inbound TO: the SOI body for a vessel around a body, the vessel itself
    /// for one in solar orbit (Kerbalism rolls those per-vessel). The kind rides
    /// as its integer ordinal, like every other contract enum on the wire.
    /// </summary>
    [Fact]
    public void BuildSpaceWeather_names_the_storm_target_for_a_body_and_a_vessel()
    {
        var storms = new[]
        {
            new StormEntryRaw
            {
                Star = "Kerbol",
                StormState = 1,
                StormTime = 149549,
                StormDuration = 300,
                Dist = 13599840256,
                TargetKind = KerbalismStormTargetKind.Body,
                TargetName = "Kerbin",
            },
            new StormEntryRaw
            {
                Star = "Kerbol",
                StormState = 1,
                StormTime = 152000,
                StormDuration = 620,
                Dist = 41000000000,
                TargetKind = KerbalismStormTargetKind.Vessel,
                TargetName = "Jool Transfer Probe",
            },
        };
        var sw = KerbalismCapture.BuildSpaceWeather(new KerbalismSnapshot(), storms: storms);
        var mapped = ((List<object>)sw["storms"]!)
            .Cast<Dictionary<string, object?>>()
            .ToList();

        Assert.Equal((int)KerbalismStormTargetKind.Body, mapped[0]["targetKind"]);
        Assert.Equal("Kerbin", mapped[0]["targetName"]);
        Assert.Equal((int)KerbalismStormTargetKind.Vessel, mapped[1]["targetKind"]);
        Assert.Equal("Jool Transfer Probe", mapped[1]["targetName"]);
        // The rest of the slot rides through unchanged.
        Assert.Equal("Kerbol", mapped[1]["star"]);
        Assert.Equal(152000d, (double)mapped[1]["stormTime"]!, 6);
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

    [Fact]
    public void BuildLifeSupport_omits_the_process_list_rather_than_emitting_an_empty_one()
    {
        // A background craft's parts are gone, so the per-part process detail
        // cannot be read while the supplies alongside it are real. An empty
        // list would say "nothing is running", which is a claim about the
        // craft rather than about our reading of it.
        var ls = KerbalismCapture.BuildLifeSupport(new KerbalismSnapshot(), processes: null);
        Assert.Null(ls["processes"]);
        Assert.True(ls.ContainsKey("processes"));
    }

    [Fact]
    public void BuildLifeSupport_stamps_the_ut_the_values_were_last_recomputed_at()
    {
        var ls = KerbalismCapture.BuildLifeSupport(
            new KerbalismSnapshot(), new List<ProcessRaw>(), asOfUt: 12_340.5);
        Assert.Equal(12_340.5, (double)ls["asOfUt"]!, 6);

        // Unknown stays unknown: never the read time standing in for a
        // freshness nobody measured.
        var unstamped = KerbalismCapture.BuildLifeSupport(new KerbalismSnapshot(), new List<ProcessRaw>());
        Assert.Null(unstamped["asOfUt"]);
    }

    [Fact]
    public void BuildCrew_carries_the_deadline_per_kerbal_and_null_where_there_is_none()
    {
        var crew = new[]
        {
            new KerbalRulesRaw { Name = "Jebediah Kerman", Trait = "Pilot" },
            new KerbalRulesRaw { Name = "Bill Kerman", Trait = "Engineer" },
        };
        var deadlines = new Dictionary<string, double?>
        {
            ["Jebediah Kerman"] = 3_600.0,
            // Bill's is not derivable, and must arrive as null rather than as a
            // large number: "cannot tell you" and "years of supplies" have to
            // render differently.
            ["Bill Kerman"] = null,
        };

        const double asOfUt = 500_000.0;
        var built = KerbalismCapture.BuildCrew(
            crew, new Dictionary<string, RuleConstants>(), asOfUt, deadlines);

        // Published as the INSTANT the deadline lands on, so the anchor is part
        // of the value rather than something a consumer has to remember to
        // subtract: asOfUt + remaining.
        Assert.Equal(asOfUt + 3_600.0, (double)((Dictionary<string, object?>)built[0])["deathClockUt"]!, 6);
        Assert.Null(((Dictionary<string, object?>)built[1])["deathClockUt"]);
    }

    /// <summary>
    /// An instant needs an anchor, so a derivable remaining-time with NO
    /// <c>asOfUt</c> publishes nothing rather than an unanchored figure.
    /// </summary>
    ///
    /// <remarks>
    /// This is stricter than the old remaining-seconds field, deliberately.
    /// That field was published unanchored whenever Kerbalism's own
    /// last-evaluation marker could not be read, and every consumer rendered it
    /// as though it were measured from now, which is the bug the instant exists
    /// to make unrepresentable. Losing the readout in that case is the honest
    /// outcome: a duration whose origin is unknown cannot become a countdown.
    /// </remarks>
    [Fact]
    public void BuildCrew_publishes_no_deadline_when_it_has_no_anchor_to_hang_it_on()
    {
        var crew = new[] { new KerbalRulesRaw { Name = "Val Kerman", Trait = "Pilot" } };
        var deadlines = new Dictionary<string, double?> { ["Val Kerman"] = 120.0 };

        var built = KerbalismCapture.BuildCrew(
            crew, new Dictionary<string, RuleConstants>(), asOfUt: null, deadlines);

        Assert.Null(((Dictionary<string, object?>)built[0])["deathClockUt"]);
    }

    [Fact]
    public void BuildCrew_stamps_each_kerbal_with_the_ut_their_rules_last_advanced_at()
    {
        var crew = new[]
        {
            new KerbalRulesRaw { Name = "Bob Kerman", Trait = "Engineer", Rules = new() { ["radiation"] = 0.5 } },
        };
        var built = KerbalismCapture.BuildCrew(crew, new Dictionary<string, RuleConstants>(), asOfUt: 8_800.25);
        var kerbal = (Dictionary<string, object?>)built[0];
        Assert.Equal(8_800.25, (double)kerbal["asOfUt"]!, 6);

        var unstamped = (Dictionary<string, object?>)KerbalismCapture.BuildCrew(
            crew, new Dictionary<string, RuleConstants>())[0];
        Assert.Null(unstamped["asOfUt"]);
    }
}

public class KerbalismReliabilityMapTests
{
    private static readonly ReliabilityPreferencesRaw Prefs = new()
    {
        MtbfFailures = true,
        CriticalChance = 0.25,
        SafeModeChance = 0.5,
        RequireRepairKits = true,
        IncentiveRedundancy = true,
    };

    private static ReliabilityRaw Captured(params ReliabilityPartRaw[] parts)
    {
        var raw = new ReliabilityRaw { Ut = 1_000_000 };
        raw.Parts.AddRange(parts);
        return raw;
    }

    [Fact]
    public void Summary_names_the_source_and_carries_the_coverage_verbatim()
    {
        var s = KerbalismReliabilityMap.Summary(Captured(), Prefs, ReliabilityCoverage.Modeled);
        Assert.Equal("kerbalism", s.Source);
        Assert.Equal(ReliabilityCoverage.Modeled, s.Coverage);
    }

    /// <summary>
    /// "Off" and "could not tell" reach the wire as different strings. The boolean
    /// they replace could only ever say the reassuring one.
    /// </summary>
    [Theory]
    [InlineData("disabled")]
    [InlineData("indeterminate")]
    public void Summary_carries_a_non_modelling_coverage_and_rolls_up_nothing(string coverage)
    {
        var s = KerbalismReliabilityMap.Summary(
            Captured(new ReliabilityPartRaw { PartId = "7", Broken = true }), Prefs, coverage);
        Assert.Equal(coverage, s.Coverage);
        // Nothing is rolled up about a craft nobody is watching.
        Assert.Null(s.Extensions);
    }

    [Fact]
    public void Parts_grade_a_broken_critical_part_and_keep_kerbalisms_own_word()
    {
        var parts = KerbalismReliabilityMap.Parts(
            Captured(new ReliabilityPartRaw
            {
                PartId = "7", Title = "LV-909", Broken = true, Critical = true,
            }),
            ReliabilityCoverage.Modeled);

        Assert.Single(parts);
        Assert.Equal("failed-critical", parts[0].Condition);
        Assert.Equal("busted", parts[0].ConditionDetail);
    }

    /// <summary>
    /// The state Kerbalism calls "needs service": preventive, NOT yet broken. The
    /// old shape carried it in a field named NeedsRepair, so the roster printed the
    /// word "repair" for a part that wanted an inspection.
    /// </summary>
    [Fact]
    public void Parts_call_the_preventive_state_service_rather_than_repair()
    {
        var parts = KerbalismReliabilityMap.Parts(
            Captured(new ReliabilityPartRaw { PartId = "7", Title = "Antenna", NeedsService = true }),
            ReliabilityCoverage.Modeled);

        Assert.Equal("service-due", parts[0].Condition);
        Assert.Equal("needs service", parts[0].ConditionDetail);
    }

    /// <summary>
    /// Kerbalism has no per-part probability of any kind, so filling one would be
    /// inventing data. The whole numeric contribution is the service clock.
    /// </summary>
    [Fact]
    public void Parts_never_claim_a_survival_probability()
    {
        var parts = KerbalismReliabilityMap.Parts(
            Captured(new ReliabilityPartRaw
            {
                PartId = "7", MtbfSeconds = 21_600_000, LastInspection = 400_000,
            }),
            ReliabilityCoverage.Modeled);

        Assert.Null(parts[0].Survival);
        Assert.Null(parts[0].SurvivalHorizonSeconds);
    }

    [Fact]
    public void Parts_emit_the_service_budget_against_half_an_effective_mtbf()
    {
        var parts = KerbalismReliabilityMap.Parts(
            Captured(new ReliabilityPartRaw
            {
                PartId = "7", MtbfSeconds = 1_000_000, LastInspection = 600_000,
            }),
            ReliabilityCoverage.Modeled);

        var budget = Assert.Single(parts[0].Budgets!);
        Assert.Equal("service", budget.Id);
        Assert.Equal("schedule", budget.Kind);
        Assert.Equal(500_000, budget.LimitSeconds);
        Assert.Equal(400_000, budget.UsedSeconds);
        Assert.Equal(0.8, budget.Consumed!.Value, 6);
    }

    /// <summary>
    /// A service-due part whose clock cannot be read carries NO budget rather than a
    /// made-up one: NeedsMaintenance() has a second, unrelated source (an EVA
    /// inspection's wear flag), so a part can be due now with its clock far away.
    /// </summary>
    [Fact]
    public void Parts_omit_the_service_budget_when_either_input_is_missing()
    {
        var parts = KerbalismReliabilityMap.Parts(
            Captured(new ReliabilityPartRaw { PartId = "7", NeedsService = true, MtbfSeconds = 1_000_000 }),
            ReliabilityCoverage.Modeled);

        Assert.Equal("service-due", parts[0].Condition);
        Assert.Null(parts[0].Budgets);
    }

    /// <summary>
    /// Two entries sharing a raw id is the NORMAL case, not a corner: the proto
    /// constructor sets partId = 0 for every part on an unloaded vessel, and
    /// BuildList iterates MODULES, so one probe core with two redundancy blocks
    /// yields two entries with the same flightID.
    /// </summary>
    [Fact]
    public void Parts_disambiguate_a_repeated_raw_id()
    {
        var parts = KerbalismReliabilityMap.Parts(
            Captured(
                new ReliabilityPartRaw { PartId = "0", Title = "Communication" },
                new ReliabilityPartRaw { PartId = "0", Title = "Attitude Control" },
                new ReliabilityPartRaw { PartId = "0", Title = "Communication" }),
            ReliabilityCoverage.Modeled);

        Assert.Equal(new[] { "0:0", "0:1", "0:2" }, parts.ConvertAll(p => p.PartId).ToArray());
    }

    [Fact]
    public void Parts_are_empty_when_the_backend_is_not_modelling()
    {
        var raw = Captured(new ReliabilityPartRaw { PartId = "7", Title = "LV-909" });
        Assert.Empty(KerbalismReliabilityMap.Parts(raw, ReliabilityCoverage.Disabled));
        Assert.Empty(KerbalismReliabilityMap.Parts(raw, ReliabilityCoverage.Indeterminate));
    }
}
