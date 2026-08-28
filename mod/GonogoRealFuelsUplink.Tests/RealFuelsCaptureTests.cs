using System.Collections.Generic;
using GonogoRealFuelsUplink;
using Xunit;

/// <summary>
/// The ignition budget's three readings and the boiloff unit conversion, which
/// are the two places this Uplink can be wrong in a way an operator would act
/// on. Both are pure functions of the reflected reading, so both are asserted
/// here rather than on a rig.
/// </summary>
public class RealFuelsCaptureTests
{
    private static Dictionary<string, object?> FirstEngine(Dictionary<string, object?> payload)
    {
        var rows = Assert.IsType<List<Dictionary<string, object?>>>(payload["engines"]);
        return Assert.Single(rows);
    }

    private static Dictionary<string, object?> BuildOne(int? ignitions, bool? limited, bool? literalZero = null) =>
        FirstEngine(RealFuelsCapture.BuildEngines(new RealFuelsVesselRaw
        {
            IgnitionsLimited = limited,
            UllageSimulated = true,
            Engines = { new RealFuelsEngineRaw { Ignitions = ignitions, LiteralZeroIgnitions = literalZero } },
        }));

    [Fact]
    public void A_positive_budget_is_neither_unlimited_nor_ground_only()
    {
        var e = BuildOne(ignitions: 3, limited: true);
        Assert.Equal(3, e["ignitionsRemaining"]);
        Assert.Equal(false, e["ignitionsUnlimited"]);
        Assert.Equal(false, e["groundIgnitionOnly"]);
    }

    [Fact]
    public void The_negative_sentinel_reads_as_unlimited()
    {
        var e = BuildOne(ignitions: -1, limited: true);
        Assert.Equal(true, e["ignitionsUnlimited"]);
        Assert.Equal(false, e["groundIgnitionOnly"]);
    }

    [Fact]
    public void Zero_reads_as_ground_ignition_only_not_as_a_spent_budget()
    {
        var e = BuildOne(ignitions: 0, limited: true, literalZero: true);
        Assert.Equal(true, e["groundIgnitionOnly"]);
        Assert.Equal(false, e["ignitionsUnlimited"]);
        Assert.Equal(true, e["literalZeroIgnitions"]);
    }

    /// <summary>
    /// The game-wide switch is asked FIRST, mirroring
    /// <c>ModuleEnginesRF.GetUllageIgnition</c>: with ignition limits off, a
    /// budget of two is a limit nothing is enforcing, and reporting "2 left"
    /// would be a restriction the operator does not actually have.
    /// </summary>
    [Fact]
    public void Ignition_limits_switched_off_makes_every_budget_unlimited()
    {
        var e = BuildOne(ignitions: 2, limited: false);
        Assert.Equal(true, e["ignitionsUnlimited"]);
        Assert.Equal(false, e["groundIgnitionOnly"]);
    }

    /// <summary>
    /// An engine whose counter could not be read is not an engine with no
    /// ignitions left. Nothing may substitute a zero here.
    /// </summary>
    [Fact]
    public void An_unreadable_budget_yields_absence_and_never_a_zero()
    {
        var e = BuildOne(ignitions: null, limited: true);
        Assert.Null(e["ignitionsRemaining"]);
        Assert.Null(e["ignitionsUnlimited"]);
        Assert.Null(e["groundIgnitionOnly"]);
    }

    /// <summary>
    /// The switch is half the rule, so without it neither reading can be made.
    /// The raw count still travels, because it is a fact that was read.
    /// </summary>
    [Fact]
    public void An_unreadable_settings_switch_withholds_both_derived_readings()
    {
        var e = BuildOne(ignitions: 0, limited: null);
        Assert.Equal(0, e["ignitionsRemaining"]);
        Assert.Null(e["ignitionsUnlimited"]);
        Assert.Null(e["groundIgnitionOnly"]);
    }

    [Fact]
    public void An_engine_carries_its_ullage_and_rated_figures_through()
    {
        var e = FirstEngine(RealFuelsCapture.BuildEngines(new RealFuelsVesselRaw
        {
            IgnitionsLimited = true,
            UllageSimulated = true,
            Engines =
            {
                new RealFuelsEngineRaw
                {
                    PartId = 4242,
                    PartName = "AJ10-137",
                    Ignitions = 1,
                    UllageModelled = true,
                    UllageStability = 0.42,
                    IgnitionProbability = 0.974,
                    PressureFed = true,
                    FeedPressureOk = false,
                    RatedBurnTimeSeconds = 750.0,
                    PredictedMaximumResiduals = 0.0225,
                },
            },
        }));
        Assert.Equal(4242L, e["partId"]);
        Assert.Equal("AJ10-137", e["partName"]);
        Assert.Equal(0.42, e["ullageStability"]);
        Assert.Equal(0.974, e["ignitionProbability"]);
        Assert.Equal(false, e["feedPressureOk"]);
        Assert.Equal(750.0, e["ratedBurnTimeSeconds"]);
        Assert.Equal(0.0225, e["predictedMaximumResiduals"]);
        Assert.Null(e["ratedContinuousBurnTimeSeconds"]);
    }

    /// <summary>
    /// A vessel with no RealFuels engines and a vessel the Uplink could not read
    /// are different claims, and the payload keeps them different: an empty list
    /// against a null one.
    /// </summary>
    [Fact]
    public void No_engines_is_an_empty_list_and_no_reading_is_a_null_one()
    {
        var empty = RealFuelsCapture.BuildEngines(new RealFuelsVesselRaw { IgnitionsLimited = true });
        Assert.Empty(Assert.IsType<List<Dictionary<string, object?>>>(empty["engines"]));

        var unread = RealFuelsCapture.BuildEngines(null);
        Assert.Null(unread["engines"]);
        Assert.Null(unread["ignitionsLimited"]);
        Assert.Null(unread["ullageSimulated"]);
    }

    /// <summary>
    /// RealFuels' BoiloffMassRate is an accumulated MASS over the physics
    /// interval, not a rate: 0.5 kg lost over 20 ms is 25 kg/s.
    /// </summary>
    [Fact]
    public void Boiloff_mass_over_its_interval_becomes_a_true_rate()
    {
        var payload = RealFuelsCapture.BuildBoiloff(new RealFuelsBoiloffRaw
        {
            BoiloffMassTons = 0.0005,
            IntervalSeconds = 0.02,
            CryogenicTankCount = 3,
        });
        Assert.Equal(25.0, (double)payload["boiloffRate"]!, 9);
        Assert.Equal(3, payload["cryogenicTankCount"]);
    }

    [Fact]
    public void Boiloff_without_an_interval_is_absent_rather_than_zero()
    {
        foreach (var interval in new double?[] { null, 0.0, -1.0 })
        {
            var payload = RealFuelsCapture.BuildBoiloff(new RealFuelsBoiloffRaw
            {
                BoiloffMassTons = 0.0005,
                IntervalSeconds = interval,
                CryogenicTankCount = 3,
            });
            Assert.Null(payload["boiloffRate"]);
            Assert.Equal(3, payload["cryogenicTankCount"]);
        }
    }

    /// <summary>
    /// Zero cryogenic tanks is a real answer (a hypergolic stack never boils
    /// off) and is what makes the absent rate beside it readable.
    /// </summary>
    [Fact]
    public void A_vessel_with_no_cryogenic_tanks_reports_none_rather_than_failing()
    {
        var payload = RealFuelsCapture.BuildBoiloff(new RealFuelsBoiloffRaw
        {
            BoiloffMassTons = null,
            IntervalSeconds = 0.02,
            CryogenicTankCount = 0,
        });
        Assert.Null(payload["boiloffRate"]);
        Assert.Equal(0, payload["cryogenicTankCount"]);
    }

    [Fact]
    public void RealFuels_absent_yields_a_null_count_not_a_zero_one()
    {
        var payload = RealFuelsCapture.BuildBoiloff(null);
        Assert.Null(payload["boiloffRate"]);
        Assert.Null(payload["cryogenicTankCount"]);
    }
}
