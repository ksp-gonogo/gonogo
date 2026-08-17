using System.Collections.Generic;
using Gonogo.KerbalismUplink;
using Xunit;

/// <summary>
/// The two-stage deadline, against Kerbalism's own <c>Rule.Execute</c>: a rule
/// degenerates only once its input resource is gone, and then climbs
/// <c>degeneration * k * variance</c> per second (per INTERVAL, for an interval
/// rule) until <c>fatal_threshold</c>.
///
/// <para>Rule shapes here mirror Kerbalism's default profile: breathing is
/// continuous off Oxygen, eating is an interval rule off Food, radiation has no
/// input at all and so degenerates from the first tick, and stress is a
/// breakdown rule that never kills anyone.</para>
/// </summary>
public class KerbalismDeathClockTests
{
    private static RuleDefRaw Breathing() => new()
    {
        Name = "breathing", Input = "Oxygen", Rate = 0.00172379825,
        Degeneration = 0.005555555555555556, FatalThreshold = 1.0,
    };

    private static KerbalRulesRaw Kerbal(params (string Rule, double Value)[] problems)
    {
        var k = new KerbalRulesRaw { Name = "Jebediah Kerman", Trait = "Pilot" };
        foreach (var (rule, value) in problems)
        {
            k.Rules[rule] = value;
        }
        return k;
    }

    [Fact]
    public void CountsTheResourceRunningOutAndThenTheAccumulatorClimbing()
    {
        // 100 units of Oxygen draining at 0.001/s empties in 100_000 s, and the
        // accumulator then takes 1.0 / 0.005555... = 180 s to reach fatal.
        var deadline = KerbalismDeathClock.SoonestFatalSeconds(
            Kerbal(("breathing", 0.0)),
            new[] { Breathing() },
            null,
            new Dictionary<string, double> { ["Oxygen"] = 100.0 },
            new Dictionary<string, double> { ["Oxygen"] = -0.001 });

        Assert.NotNull(deadline);
        Assert.Equal(100_000.0 + 180.0, deadline!.Value, 3);
    }

    [Fact]
    public void AnAccumulatorAlreadyPartWayUpShortensTheSecondStage()
    {
        var deadline = KerbalismDeathClock.SoonestFatalSeconds(
            Kerbal(("breathing", 0.5)),
            new[] { Breathing() },
            null,
            new Dictionary<string, double> { ["Oxygen"] = 0.0 },
            new Dictionary<string, double> { ["Oxygen"] = -0.001 });

        // Resource already empty, so stage one is zero and half the threshold remains.
        Assert.Equal(90.0, deadline!.Value, 3);
    }

    [Fact]
    public void AResourceInBalanceIsNoDeadlineRatherThanAnUnknownOne()
    {
        // A recycling craft holding steady on oxygen: this rule is not closing
        // in on anyone, which is an answer, so it contributes nothing and the
        // result is "nothing is closing in".
        var deadline = KerbalismDeathClock.SoonestFatalSeconds(
            Kerbal(("breathing", 0.2)),
            new[] { Breathing() },
            null,
            new Dictionary<string, double> { ["Oxygen"] = 100.0 },
            new Dictionary<string, double> { ["Oxygen"] = 0.0 });

        Assert.Null(deadline);
    }

    [Fact]
    public void ARuleWithNoInputIsAlreadyCountingDown()
    {
        // Radiation has no input resource, so Rule.Execute degenerates it from
        // the first tick: no stage one at all.
        var radiation = new RuleDefRaw
        {
            Name = "radiation", Input = "", Degeneration = 1.0, FatalThreshold = 50.0,
        };

        var deadline = KerbalismDeathClock.SoonestFatalSeconds(
            Kerbal(("radiation", 20.0)),
            new[] { radiation },
            new Dictionary<string, double> { ["radiation"] = 0.5 },
            null,
            null);

        // (50 - 20) / (1.0 * k 0.5) = 60 s.
        Assert.Equal(60.0, deadline!.Value, 6);
    }

    [Fact]
    public void AnIntervalRuleDegeneratesPerIntervalNotPerSecond()
    {
        // Eating fires once per 3 hour interval, so the per-second climb is
        // degeneration / interval. Ignoring that overstates the rate by 10800x
        // and would report a deadline three hours away as one second away.
        var eating = new RuleDefRaw
        {
            Name = "eating", Input = "Food", Interval = 10_800.0,
            Degeneration = 0.0025, FatalThreshold = 1.0,
        };

        var deadline = KerbalismDeathClock.SoonestFatalSeconds(
            Kerbal(("eating", 0.0)),
            new[] { eating },
            null,
            new Dictionary<string, double> { ["Food"] = 0.0 },
            new Dictionary<string, double> { ["Food"] = -1.0 });

        Assert.Equal(1.0 / (0.0025 / 10_800.0), deadline!.Value, 3);
    }

    [Fact]
    public void ABreakdownRuleNeverContributesADeathClock()
    {
        // Kerbalism's own Rule.Execute triggers a breakdown and RESETS the
        // accumulator at the threshold for a breakdown rule; only a
        // non-breakdown rule kills. A stress deadline would be a deadline on
        // something that has never killed anyone.
        var stress = new RuleDefRaw
        {
            Name = "stress", Input = "", Degeneration = 1.0, FatalThreshold = 1.0, Breakdown = true,
        };

        Assert.Null(KerbalismDeathClock.SoonestFatalSeconds(
            Kerbal(("stress", 0.99)), new[] { stress }, null, null, null));
    }

    [Fact]
    public void TheSoonestOfSeveralRulesWins()
    {
        var radiation = new RuleDefRaw
        {
            Name = "radiation", Input = "", Degeneration = 1.0, FatalThreshold = 100.0,
        };

        var deadline = KerbalismDeathClock.SoonestFatalSeconds(
            Kerbal(("breathing", 0.0), ("radiation", 99.0)),
            new[] { Breathing(), radiation },
            null,
            new Dictionary<string, double> { ["Oxygen"] = 100.0 },
            new Dictionary<string, double> { ["Oxygen"] = -0.001 });

        // Radiation is 1 s away, oxygen is a day away.
        Assert.Equal(1.0, deadline!.Value, 6);
    }

    [Fact]
    public void AnUnreadableRuleMakesTheWholeAnswerUnknown()
    {
        // The value is the SOONEST, so a rule we cannot evaluate could be the
        // one that matters. Reporting the rest would overstate the time
        // available, which is the one direction a deadline must never err in.
        var deadline = KerbalismDeathClock.SoonestFatalSeconds(
            Kerbal(("breathing", 0.0)),
            new[] { Breathing() },
            null,
            new Dictionary<string, double>(),   // no amount for Oxygen: the read failed
            new Dictionary<string, double> { ["Oxygen"] = -0.001 });

        Assert.Null(deadline);
    }

    [Fact]
    public void APerKerbalVarianceWeCouldNotReadMakesTheAnswerUnknown()
    {
        var varying = new RuleDefRaw
        {
            Name = "breathing", Input = "", Degeneration = 1.0, FatalThreshold = 1.0, Variance = 0.1,
        };

        Assert.Null(KerbalismDeathClock.SoonestFatalSeconds(
            Kerbal(("breathing", 0.0)), new[] { varying }, null, null, null));

        // With the factor read from Kerbalism, it scales the climb.
        var kerbal = Kerbal(("breathing", 0.0));
        kerbal.RuleVarianceFactors["breathing"] = 1.25;
        Assert.Equal(
            1.0 / 1.25,
            KerbalismDeathClock.SoonestFatalSeconds(kerbal, new[] { varying }, null, null, null)!.Value,
            6);
    }

    [Fact]
    public void AnEnvironmentThatSwitchesARuleOffStopsItsClock()
    {
        // A breathable atmosphere zeroes the breathing modifier product, and
        // Rule.Execute skips degeneration entirely when k is 0.
        var deadline = KerbalismDeathClock.SoonestFatalSeconds(
            Kerbal(("breathing", 0.9)),
            new[] { Breathing() },
            new Dictionary<string, double> { ["breathing"] = 0.0 },
            new Dictionary<string, double> { ["Oxygen"] = 0.0 },
            new Dictionary<string, double> { ["Oxygen"] = -0.001 });

        Assert.Null(deadline);
    }

    [Fact]
    public void AnAccumulatorAlreadyAtTheThresholdIsZeroNotNegative()
    {
        var deadline = KerbalismDeathClock.SoonestFatalSeconds(
            Kerbal(("breathing", 1.5)),
            new[] { Breathing() },
            null,
            new Dictionary<string, double> { ["Oxygen"] = 0.0 },
            new Dictionary<string, double> { ["Oxygen"] = -0.001 });

        Assert.Equal(0.0, deadline!.Value, 6);
    }
}
