using System;
using System.Collections.Generic;
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

    [Fact]
    public void A_lone_blocking_operation_finishes_at_its_own_full_rate()
    {
        // Sole occupant, so its share is the whole complex and the sequence
        // collapses to the plain division.
        var seconds = Rp1ScMath.SequencedTimeLeft(new List<Rp1ScMath.BlockingOp>
        {
            new Rp1ScMath.BlockingOp { Points = 1000.0, Remaining = 500.0, Rate = 10.0 },
        });

        Assert.Equal(50.0, seconds!.Value, 6);
    }

    [Fact]
    public void A_shared_complex_finishes_later_than_the_share_division_says()
    {
        // Two equal projects, so each runs at half rate. The subject has 500
        // points left at 10/s: the share division answers 100s, and it is wrong,
        // because the peer finishes first (250 left) and the subject speeds up.
        //
        // Peer done at 250/(10*0.5) = 50s, by which time the subject has 250
        // left; alone at 10/s that is another 25s. 75s, not 100s.
        var ops = new List<Rp1ScMath.BlockingOp>
        {
            new Rp1ScMath.BlockingOp { Points = 1000.0, Remaining = 500.0, Rate = 10.0 },
            new Rp1ScMath.BlockingOp { Points = 1000.0, Remaining = 250.0, Rate = 10.0 },
        };

        var seconds = Rp1ScMath.SequencedTimeLeft(ops);

        Assert.Equal(75.0, seconds!.Value, 6);
        // The number this replaces, spelled out so the regression is legible: the
        // share division alone is optimistic by 25 seconds here, and by more as
        // the queue grows.
        var shareDivision = 500.0 / (10.0 * 0.5);
        Assert.Equal(100.0, shareDivision, 6);
        Assert.True(seconds.Value < shareDivision);
    }

    [Fact]
    public void The_subject_finishing_first_ends_the_sequence_at_its_own_interval()
    {
        // Subject has 100 left, the peer 10000: the subject is out first, so the
        // answer is its own interval and the peer never enters the arithmetic.
        var seconds = Rp1ScMath.SequencedTimeLeft(new List<Rp1ScMath.BlockingOp>
        {
            new Rp1ScMath.BlockingOp { Points = 1000.0, Remaining = 100.0, Rate = 10.0 },
            new Rp1ScMath.BlockingOp { Points = 1000.0, Remaining = 10_000.0, Rate = 10.0 },
        });

        Assert.Equal(100.0 / (10.0 * 0.5), seconds!.Value, 6);
    }

    [Fact]
    public void An_uncosted_peer_makes_the_whole_sequence_absent()
    {
        // A peer RP-1 has not costed yet has no rate we can honestly use, so the
        // sequence is unknowable. Absent, never the optimistic figure: the caller
        // publishes the peer COUNT instead, which is a fact rather than a guess.
        var seconds = Rp1ScMath.SequencedTimeLeft(new List<Rp1ScMath.BlockingOp>
        {
            new Rp1ScMath.BlockingOp { Points = 1000.0, Remaining = 500.0, Rate = 10.0 },
            new Rp1ScMath.BlockingOp { Points = 1000.0, Remaining = 250.0, Rate = 0.0 },
        });

        Assert.Null(seconds);
    }

    [Fact]
    public void An_operation_with_no_points_cannot_hold_a_share_and_is_absent()
    {
        Assert.Null(Rp1ScMath.SequencedTimeLeft(new List<Rp1ScMath.BlockingOp>
        {
            new Rp1ScMath.BlockingOp { Points = 0.0, Remaining = 500.0, Rate = 10.0 },
        }));
        Assert.Null(Rp1ScMath.SequencedTimeLeft(new List<Rp1ScMath.BlockingOp>()));
    }

    [Fact]
    public void A_part_finished_move_has_only_the_unmade_progress_left_to_pay()
    {
        // RP-1 draws a rollout's price down as it proceeds, so a move 40% of the
        // way there has paid 40% of its price and a press that resumes it commits
        // to the other 60%. Quoting the total would overstate what the press
        // costs by everything already spent.
        Assert.Equal(600.0, Rp1ScMath.UnbilledCost(1000.0, progress: 400.0, totalPoints: 1000.0)!.Value, 6);
        Assert.Equal(1000.0, Rp1ScMath.UnbilledCost(1000.0, progress: 0.0, totalPoints: 1000.0)!.Value, 6);
        Assert.Equal(0.0, Rp1ScMath.UnbilledCost(1000.0, progress: 1000.0, totalPoints: 1000.0)!.Value, 6);
    }

    [Fact]
    public void An_uncosted_project_has_an_absent_remainder_rather_than_a_free_one()
    {
        // The same absence ProgressRatio gives, for the same reason: RP-1 has not
        // costed the project, which is not the project being free.
        Assert.Null(Rp1ScMath.UnbilledCost(1000.0, progress: 0.0, totalPoints: 0.0));
        Assert.Null(Rp1ScMath.UnbilledCost(1000.0, progress: 0.0, totalPoints: double.NaN));
    }

    /// <summary>
    /// RP-1's own effective-head expression, so these tests feed the recovery
    /// the shape it claims to invert rather than a number chosen to satisfy it.
    /// </summary>
    /// <remarks>
    /// <c>SpaceCenterManagement.GetEffectiveEngineersForSalary(LaunchComplex)</c>
    /// in one line: the working part of a crew draws at the rush rate, the rest
    /// at the idle fraction. Its four arms differ only in how many are working.
    /// </remarks>
    private static double Heads(int working, int engineers, double rushSalary, double idleMult) =>
        working * rushSalary + (engineers - working) * idleMult;

    [Fact]
    public void Rushing_a_fully_working_crew_costs_the_whole_crew_over_again()
    {
        // The ordinary complex: everyone is working, so RP-1 charges every head
        // at the rush rate and the extra is one full crew's salary.
        var quiet = Heads(working: 10, engineers: 10, rushSalary: 1.0, idleMult: 0.25);

        Assert.Equal(
            10.0,
            Rp1ScMath.RushSalaryDelta(quiet, 10, idleMult: 0.25, rushMult: 2.0, isRushing: false)!.Value,
            9);
    }

    [Fact]
    public void The_extra_reads_the_same_from_inside_a_rush_as_from_outside_it()
    {
        // One figure answers both presses, which is the whole point of publishing
        // the DELTA rather than a rushed total: what starting a rush would add is
        // what stopping one would save, and the count it is recovered from is
        // taken in different modes on either side of the press.
        var quiet = Heads(working: 6, engineers: 9, rushSalary: 1.0, idleMult: 0.25);
        var rushing = Heads(working: 6, engineers: 9, rushSalary: 2.0, idleMult: 0.25);

        var fromOutside = Rp1ScMath.RushSalaryDelta(quiet, 9, 0.25, 2.0, isRushing: false);
        var fromInside = Rp1ScMath.RushSalaryDelta(rushing, 9, 0.25, 2.0, isRushing: true);

        Assert.Equal(6.0, fromOutside!.Value, 9);
        Assert.Equal(6.0, fromInside!.Value, 9);
    }

    [Fact]
    public void A_part_idle_crew_is_charged_for_the_working_part_only()
    {
        // The hangar and the human-rated-complex-on-an-uncrewed-vehicle arms:
        // RP-1 multiplies the working part and leaves the rest at the idle
        // fraction, so salary * rushMult is not the answer. Six of the ten are
        // working, so rushing adds six salaries and not ten, and not the 7.0 the
        // effective count times (mult - 1) would give.
        var heads = Heads(working: 6, engineers: 10, rushSalary: 1.0, idleMult: 0.25);

        Assert.Equal(7.0, heads, 9);
        Assert.Equal(
            6.0,
            Rp1ScMath.RushSalaryDelta(heads, 10, idleMult: 0.25, rushMult: 2.0, isRushing: false)!.Value,
            9);
    }

    [Fact]
    public void Rushing_a_complex_with_nothing_active_costs_nothing()
    {
        // RP-1's !IsActive arm pays the whole crew at the idle fraction, and
        // IsRushing does not enter it. Zero is the honest answer and the one a
        // client cannot reach on its own: a salary times the multiplier would
        // quote an increase for a complex where rushing changes nothing.
        var idleCrew = Heads(working: 0, engineers: 8, rushSalary: 1.0, idleMult: 0.25);

        Assert.Equal(
            0.0,
            Rp1ScMath.RushSalaryDelta(idleCrew, 8, idleMult: 0.25, rushMult: 2.0, isRushing: false)!.Value,
            9);
    }

    [Fact]
    public void A_complex_with_no_crew_and_one_RP1_charges_nothing_for_both_cost_nothing_to_rush()
    {
        // Two different states with the same true answer: nobody to pay more, and
        // a complex that is not operational, which RP-1 bills at zero whatever
        // its roster says.
        Assert.Equal(0.0, Rp1ScMath.RushSalaryDelta(0.0, 0, 0.25, 2.0, isRushing: false)!.Value);
        Assert.Equal(0.0, Rp1ScMath.RushSalaryDelta(0.0, 12, 0.25, 2.0, isRushing: false)!.Value);
    }

    [Fact]
    public void An_unreadable_term_leaves_the_extra_absent_rather_than_free()
    {
        // Each of the three inputs on its own, because a zero here would read as
        // "rushing this complex is free", which is the one answer that would have
        // an operator press it.
        Assert.Null(Rp1ScMath.RushSalaryDelta(null, 10, 0.25, 2.0, isRushing: false));
        Assert.Null(Rp1ScMath.RushSalaryDelta(10.0, 10, null, 2.0, isRushing: false));
        Assert.Null(Rp1ScMath.RushSalaryDelta(10.0, 10, 0.25, null, isRushing: false));
    }

    [Fact]
    public void A_preset_that_pays_idle_and_working_crew_alike_leaves_the_split_unrecoverable()
    {
        // The divisor is what separates the two rates, and RP-1's settings are
        // config rather than constants. Absent, not an infinity.
        Assert.Null(Rp1ScMath.RushSalaryDelta(10.0, 10, idleMult: 1.0, rushMult: 2.0, isRushing: false));
    }
}
