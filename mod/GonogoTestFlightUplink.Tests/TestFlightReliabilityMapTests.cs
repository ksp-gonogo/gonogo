using System.Collections.Generic;
using GonogoTestFlightUplink;
using Xunit;

public class TestFlightReliabilityMapTests
{
    [Fact]
    public void Summary_reports_testflight_modeled_and_carries_worst_fraction()
    {
        var s = TestFlightReliabilityMap.Summary(
            anyMalfunction: false,
            anyCritical: false,
            worstReliabilityFraction: 0.91);
        Assert.Equal(false, s["unmodeled"]);
        Assert.Equal("testflight", s["source"]);
        Assert.Equal(0.91, s["worstReliabilityFraction"]);
    }

    [Fact]
    public void Parts_maps_engine_reliability_to_shared_shape()
    {
        var engines = new[]
        {
            new EngineReliabilityRaw { PartId = "42", Title = "LR-79", CurrentReliability = 0.94, FlightData = 120, MomentaryFailureRate = 0.0003, RemainingRatedBurnSeconds = 165 },
        };
        var parts = TestFlightReliabilityMap.Parts(engines);
        var p = (Dictionary<string, object?>)parts[0];
        Assert.Equal("42", p["partId"]);
        Assert.Equal("LR-79", p["title"]);
        // TestFlight's headline signals surface directly.
        Assert.Equal(0.94, p["reliabilityFraction"]);
        Assert.Equal(165.0, p["remainingRatedBurn"]);
        // TestFlight has no ignition/duration fractions; those consumed-fraction
        // slots stay null (fallback-provider concepts, not applicable to TestFlight).
        Assert.Null(p["ignitionsConsumed"]);
        Assert.Null(p["durationConsumed"]);
    }

    [Fact]
    public void Parts_grounds_in_the_RO_fixture_values()
    {
        // Grounded in local_docs/ro-fixtures/ro-fixture-testflight.json: a healthy
        // engine well within rated burn time reads CurrentReliability ~1.0 with no
        // momentary failure rate, so it is neither broken nor critical, mtbf null.
        var engines = new[]
        {
            new EngineReliabilityRaw { PartId = "7", Title = "RD-108", CurrentReliability = 0.998, FlightData = 5000, MomentaryFailureRate = 0 },
        };
        var p = (Dictionary<string, object?>)TestFlightReliabilityMap.Parts(engines)[0];
        Assert.Equal(false, p["broken"]);
        Assert.Equal(false, p["critical"]);
        Assert.Null(p["mtbfHours"]);
        Assert.Equal(true, p["needsRepair"]); // reliability < 1.0 => has accrued wear
    }
}
