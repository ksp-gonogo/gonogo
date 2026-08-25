using System;
using GonogoRp1Uplink;
using Xunit;

/// <summary>
/// The §2.4 arithmetic, and in particular the three places RP-1's own version
/// produces a value no client can render.
/// </summary>
public class Rp1ScMathTests
{
    [Fact]
    public void Progress_ratio_is_absent_rather_than_NaN_at_zero_points()
    {
        // RP-1's GetFractionComplete divides with no zero guard, so a project
        // with no build points is NaN there.
        Assert.Null(Rp1ScMath.ProgressRatio(0.0, 0.0));
    }

    [Fact]
    public void Progress_ratio_counts_down_for_a_reversed_operation()
    {
        // A rollback runs progress DOWN to zero, so a quarter of the way back is
        // three quarters done.
        Assert.Equal(0.75, Rp1ScMath.ProgressRatio(25.0, 100.0, reversed: true)!.Value, 6);
        Assert.Equal(0.25, Rp1ScMath.ProgressRatio(25.0, 100.0)!.Value, 6);
    }

    [Fact]
    public void Vessel_rate_is_absent_until_RP1_has_costed_the_project()
    {
        // _buildRate is -1 until RP-1 computes it, and "not costed yet" is not
        // "going nowhere".
        Assert.Null(Rp1ScMath.VesselRate(-1.0, efficiency: 0.5, rushRate: 1.0, canIntegrate: true));
    }

    [Fact]
    public void Vessel_rate_is_absent_when_the_complex_has_no_efficiency_record()
    {
        Assert.Null(Rp1ScMath.VesselRate(10.0, efficiency: null, rushRate: 1.0, canIntegrate: true));
    }

    [Fact]
    public void Vessel_rate_is_zero_and_stalled_when_the_complex_cannot_integrate()
    {
        var rate = Rp1ScMath.VesselRate(10.0, efficiency: 0.5, rushRate: 1.0, canIntegrate: false);
        Assert.Equal(0.0, rate!.Value);
        Assert.True(Rp1ScMath.IsStalled(rate));
    }

    [Fact]
    public void An_absent_rate_is_not_stalled()
    {
        // The distinction the whole payload rests on: null is "ask again next
        // tick", stalled is "costed and going nowhere". Only the second is worth
        // telling an operator about.
        Assert.False(Rp1ScMath.IsStalled(null));
    }

    [Fact]
    public void Vessel_rate_applies_efficiency_and_the_rush_multiplier()
    {
        var rate = Rp1ScMath.VesselRate(10.0, efficiency: 0.5, rushRate: 1.5, canIntegrate: true);
        Assert.Equal(7.5, rate!.Value, 6);
    }

    [Fact]
    public void Operation_rate_takes_its_share_when_another_blocking_project_runs()
    {
        // IncrementProgress scales a blocking operation by its portion of the
        // complex's blocking work: 400 of 1000 build points is 40% of the rate.
        var rate = Rp1ScMath.OperationRate(
            baseRate: 10.0, efficiency: 1.0, rushRate: 1.0,
            reversed: false, blocking: true, totalPoints: 400.0, projectBpTotal: 1000.0);
        Assert.Equal(4.0, rate!.Value, 6);
    }

    [Fact]
    public void Operation_rate_is_negative_for_a_reversed_operation()
    {
        var rate = Rp1ScMath.OperationRate(
            baseRate: 10.0, efficiency: 1.0, rushRate: 1.0,
            reversed: true, blocking: false, totalPoints: 400.0, projectBpTotal: 0.0);
        Assert.Equal(-10.0, rate!.Value, 6);
    }

    [Fact]
    public void Time_left_is_absent_at_a_zero_rate_where_RP1_returns_infinity()
    {
        Assert.Null(Rp1ScMath.BaseTimeLeft(0.0, 100.0, 0.0));
        Assert.Null(Rp1ScMath.BaseTimeLeft(0.0, 100.0, null));
    }

    [Fact]
    public void Time_left_counts_the_distance_a_reversed_operation_still_has_to_fall()
    {
        // Rolling back from 25 of 100 means 25 points to undo, at 10 a second.
        var seconds = Rp1ScMath.BaseTimeLeft(25.0, 100.0, -10.0, reversed: true);
        Assert.Equal(2.5, seconds!.Value, 6);
    }

    [Fact]
    public void The_ramp_shortens_a_long_build_the_way_RP1_displays_it()
    {
        // Half efficiency now, improving towards the ceiling: 40 days of work at
        // the current rate finishes sooner than the current rate says.
        var seconds = Rp1ScMath.RampedTimeLeft(
            baseSeconds: 40.0 * 86400.0,
            efficiency: 0.5,
            maxEfficiency: 1.0,
            isRushing: false,
            engineers: 50,
            maxEngineers: 100,
            predictWeightedEfficiency: _ => 0.55);

        Assert.True(seconds < 40.0 * 86400.0);
        // baseSeconds * efficiency / weighted, which is the arithmetic both RP-1
        // callers spell out in their own different ways.
        Assert.Equal(40.0 * 86400.0 * 0.5 / 0.55, seconds, 6);
    }

    [Fact]
    public void The_ramp_iterates_four_times_like_RP1_does()
    {
        var calls = 0;
        Rp1ScMath.RampedTimeLeft(
            baseSeconds: 40.0 * 86400.0,
            efficiency: 0.5,
            maxEfficiency: 1.0,
            isRushing: false,
            engineers: 50,
            maxEngineers: 100,
            predictWeightedEfficiency: _ => { calls++; return 0.55; });

        Assert.Equal(4, calls);
    }

    [Fact]
    public void The_ramp_does_not_apply_to_a_rushing_complex()
    {
        // The defect this guards: RP-1's PredictWeightedEfficiency returns its
        // tdelta argument (a TIME) from the rushing early-out, while both callers
        // divide by it as though it were an efficiency, which collapses a
        // month-long estimate to a number of seconds equal to the efficiency.
        var called = false;
        var seconds = Rp1ScMath.RampedTimeLeft(
            baseSeconds: 40.0 * 86400.0,
            efficiency: 0.5,
            maxEfficiency: 1.0,
            isRushing: true,
            engineers: 50,
            maxEngineers: 100,
            predictWeightedEfficiency: t => { called = true; return t; });

        Assert.Equal(40.0 * 86400.0, seconds, 6);
        Assert.False(called);
    }

    [Fact]
    public void The_ramp_does_not_apply_below_a_day_at_the_ceiling_or_with_no_engineers()
    {
        Func<double, double> shouldNotRun = _ => throw new InvalidOperationException("ramp applied");

        Assert.Equal(3600.0, Rp1ScMath.RampedTimeLeft(3600.0, 0.5, 1.0, false, 50, 100, shouldNotRun), 6);
        Assert.Equal(9e6, Rp1ScMath.RampedTimeLeft(9e6, 1.0, 1.0, false, 50, 100, shouldNotRun), 6);
        Assert.Equal(9e6, Rp1ScMath.RampedTimeLeft(9e6, 0.5, 1.0, false, 0, 100, shouldNotRun), 6);
    }

    [Fact]
    public void A_ramp_that_will_not_evaluate_leaves_the_un_ramped_estimate_standing()
    {
        // Too long is a defensible answer. Absent, or a number derived from a
        // NaN, is not.
        var seconds = Rp1ScMath.RampedTimeLeft(9e6, 0.5, 1.0, false, 50, 100, _ => double.NaN);
        Assert.Equal(9e6, seconds, 6);
    }

    [Fact]
    public void Research_rate_is_absent_until_costed_and_scales_by_the_operator_throttle()
    {
        Assert.Null(Rp1ScMath.ResearchRate(-1.0, 1.0));
        Assert.Equal(2.5, Rp1ScMath.ResearchRate(5.0, 0.5)!.Value, 6);
    }
}
