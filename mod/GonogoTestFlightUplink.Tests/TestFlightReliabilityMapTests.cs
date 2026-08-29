using GonogoTestFlightUplink;
using Sitrep.Contract;
using Xunit;

public class TestFlightReliabilityMapTests
{
    [Fact]
    public void Summary_names_the_source_and_carries_the_coverage_verbatim()
    {
        var s = TestFlightReliabilityMap.Summary(ReliabilityCoverage.Modeled);
        Assert.Equal("testflight", s.Source);
        Assert.Equal(ReliabilityCoverage.Modeled, s.Coverage);
    }

    /// <summary>
    /// The case the previous suite could not reach, and the one the shipped
    /// binary was permanently in: the reflection layer read nothing at all.
    ///
    /// <para>The old tests exercised the pure mapper with hand-written raw values
    /// and stayed green for months while the layer underneath returned nothing,
    /// because the raw type's non-null defaults filled every gap. An all-null raw
    /// must now map to "unknown", never to a nominal part.</para>
    /// </summary>
    [Fact]
    public void Parts_report_a_wholly_unread_engine_as_unknown_not_nominal()
    {
        var parts = TestFlightReliabilityMap.Parts(new[] { new EngineReliabilityRaw { PartId = "42" } });

        var p = Assert.Single(parts);
        Assert.Equal("unknown", p.Condition);
        Assert.Null(p.ConditionDetail);
        Assert.Null(p.Survival);
        Assert.Null(p.SurvivalHorizonSeconds);
        Assert.Null(p.Budgets);
    }

    [Fact]
    public void Parts_read_the_condition_off_TestFlights_own_part_status()
    {
        var nominal = TestFlightReliabilityMap.Parts(
            new[] { new EngineReliabilityRaw { PartId = "1", PartStatus = 0 } })[0];
        var failed = TestFlightReliabilityMap.Parts(
            new[]
            {
                new EngineReliabilityRaw
                {
                    PartId = "1", PartStatus = 1, FailureTitles = "Turbopump Failure",
                },
            })[0];

        Assert.Equal("nominal", nominal.Condition);
        Assert.Equal("failed", failed.Condition);
        Assert.Equal("Turbopump Failure", failed.ConditionDetail);
        // TestFlight has no two-tier failure grade to read, so it never claims one.
        Assert.NotEqual("failed-critical", failed.Condition);
    }

    /// <summary>
    /// The two ratings are INDEPENDENT and diverge by an order of magnitude under
    /// RO, so each is its own budget and each names its scope in the label. A
    /// single "remaining rated burn" slot had to pick one and be wrong about the
    /// other.
    /// </summary>
    [Fact]
    public void Parts_emit_both_burn_budgets_when_the_two_ratings_differ()
    {
        var p = TestFlightReliabilityMap.Parts(
            new[]
            {
                new EngineReliabilityRaw
                {
                    PartId = "1", PartStatus = 0,
                    RatedCumulativeSeconds = 36_000, RunCumulativeSeconds = 3_600,
                    RatedContinuousSeconds = 3_600, RunContinuousSeconds = 3_240,
                },
            })[0];

        Assert.Equal(2, p.Budgets!.Count);
        Assert.Equal("burn.continuous", p.Budgets[0].Id);
        Assert.Equal("continuous rated burn", p.Budgets[0].Label);
        Assert.Equal(0.9, p.Budgets[0].Consumed!.Value, 6);
        Assert.Equal("burn.cumulative", p.Budgets[1].Id);
        Assert.Equal("cumulative rated burn", p.Budgets[1].Label);
        Assert.Equal(0.1, p.Budgets[1].Consumed!.Value, 6);
        Assert.All(p.Budgets, b => Assert.Equal("risk-ramp", b.Kind));
    }

    /// <summary>Equal ratings collapse to one row, which is what TestFlight's own GUI does.</summary>
    [Fact]
    public void Parts_collapse_to_one_budget_when_the_two_ratings_are_equal()
    {
        var p = TestFlightReliabilityMap.Parts(
            new[]
            {
                new EngineReliabilityRaw
                {
                    PartId = "1", PartStatus = 0,
                    RatedCumulativeSeconds = 255, RunCumulativeSeconds = 26,
                    RatedContinuousSeconds = 255, RunContinuousSeconds = 26,
                },
            })[0];

        var budget = Assert.Single(p.Budgets!);
        Assert.Equal("burn.cumulative", budget.Id);
        Assert.Equal("rated burn", budget.Label);
    }

    /// <summary>
    /// An unread run time is never substituted with 0: zero used reads as a
    /// brand-new part. The rating is still carried, with no Consumed, so it can
    /// never select a row.
    /// </summary>
    [Fact]
    public void Parts_carry_a_rating_with_no_run_time_but_claim_no_consumption()
    {
        var p = TestFlightReliabilityMap.Parts(
            new[]
            {
                new EngineReliabilityRaw
                {
                    PartId = "1", PartStatus = 0, RatedCumulativeSeconds = 255,
                },
            })[0];

        var budget = Assert.Single(p.Budgets!);
        Assert.Equal(255, budget.LimitSeconds);
        Assert.Null(budget.UsedSeconds);
        Assert.Null(budget.Consumed);
    }

    /// <summary>A survival fraction without its horizon is uninterpretable, so the two travel together or not at all.</summary>
    [Fact]
    public void Parts_never_carry_a_survival_fraction_without_its_horizon()
    {
        var withHorizon = TestFlightReliabilityMap.Parts(
            new[]
            {
                new EngineReliabilityRaw
                {
                    PartId = "1", PartStatus = 0, Survival = 0.82, SurvivalHorizonSeconds = 255,
                },
            })[0];
        var withoutSurvival = TestFlightReliabilityMap.Parts(
            new[]
            {
                new EngineReliabilityRaw { PartId = "1", PartStatus = 0, SurvivalHorizonSeconds = 255 },
            })[0];

        Assert.Equal(0.82, withHorizon.Survival);
        Assert.Equal(255, withHorizon.SurvivalHorizonSeconds);
        Assert.Null(withoutSurvival.Survival);
        Assert.Null(withoutSurvival.SurvivalHorizonSeconds);
    }

    /// <summary>A part can carry more than one active core, and a bare flightID would merge the rows.</summary>
    [Fact]
    public void Parts_disambiguate_a_repeated_flight_id()
    {
        var parts = TestFlightReliabilityMap.Parts(
            new[]
            {
                new EngineReliabilityRaw { PartId = "42", PartStatus = 0 },
                new EngineReliabilityRaw { PartId = "42", PartStatus = 0 },
                new EngineReliabilityRaw { PartId = "43", PartStatus = 0 },
            });

        Assert.Equal(new[] { "42:0", "42:1", "43:0" }, parts.ConvertAll(p => p.PartId).ToArray());
    }

    /// <summary>
    /// The provenance record. An install that regresses the binder is visible in a
    /// debug surface without another decompile, which is what was missing when
    /// three non-existent method names shipped and nothing said so.
    /// </summary>
    [Fact]
    public void Parts_carry_what_the_binder_resolved_in_the_providers_namespace()
    {
        var p = TestFlightReliabilityMap.Parts(
            new[] { new EngineReliabilityRaw { PartId = "1", PartStatus = 0 } },
            new TestFlightBindingReport
            {
                Bound = new[] { "ITestFlightCore.GetPartStatus" },
                Unbound = new[] { "ITestFlightReliability.GetRatedTime(RatingScope)" },
            })[0];

        var ns = Assert.IsType<System.Collections.Generic.Dictionary<string, object?>>(
            p.Extensions!["testflight"]);
        Assert.Equal(new[] { "ITestFlightCore.GetPartStatus" }, ns["boundMembers"]);
        Assert.Equal(
            new[] { "ITestFlightReliability.GetRatedTime(RatingScope)" }, ns["unboundMembers"]);
    }
}
