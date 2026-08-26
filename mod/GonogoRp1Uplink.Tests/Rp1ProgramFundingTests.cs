using System;
using System.Collections.Generic;
using System.Linq;
using GonogoRp1Uplink;
using RP0.Programs;
using Xunit;

/// <summary>
/// RP-1's funding curve, the duration it is measured against, and the per-year
/// schedule that falls out of the two.
/// </summary>
/// <remarks>
/// Every expectation here is arithmetic taken from the SHIPPED RP-1 v4.6.0.0
/// RP0.dll rather than from a captured row, so a test that goes red says RP-1
/// changed its arithmetic and not that a save moved on:
///
/// <list type="bullet">
/// <item><c>Program.GetFundsAtFrac</c>: the named curve's value at the fraction,
/// times the Program's total funding.</item>
/// <item><c>HermiteCurve.EvaluateBetweenKeys</c>: the normalised cubic Hermite
/// basis, plus <c>Evaluate</c>'s clamp to the first and last key outside the
/// range.</item>
/// <item><c>Program.DurationYearsCalc</c>: 1.5 for Slow and 0.75 for Fast,
/// rounded to a quarter year.</item>
/// <item><c>Program.ProcessFunding</c>: the deadline it leaves behind, which is
/// what the duration is recovered from.</item>
/// <item><c>Program.GetDescription</c>'s Funding Summary loop.</item>
/// </list>
///
/// <para>The Flat curve is the one used for the arithmetic that has to be
/// checkable by hand: its keys make it exactly linear from 0 to 1, so a
/// four-year Program on it pays exactly a quarter of its total per year and any
/// deviation is the code's rather than the curve's.</para>
/// </remarks>
public class Rp1ProgramFundingTests
{
    /// <summary>RP-1's shipped <c>Flat</c> curve, key for key from ProgramHandlerSettings.cfg.</summary>
    private static List<Rp1FundingCurveKeyRaw> FlatCurve() => new List<Rp1FundingCurveKeyRaw>
    {
        new Rp1FundingCurveKeyRaw { Frac = 0.0, PaidFraction = 0.0, InTangent = 1.0, OutTangent = 1.0 },
        new Rp1FundingCurveKeyRaw { Frac = 1.0, PaidFraction = 1.0, InTangent = 1.0, OutTangent = 0.8 },
        new Rp1FundingCurveKeyRaw { Frac = 2.0, PaidFraction = 1.4, InTangent = 0.25, OutTangent = 0.25 },
    };

    private const double Year = 31557600.0;

    [Theory]
    [InlineData(0.0, 0.0)]
    [InlineData(0.25, 0.25)]
    [InlineData(0.5, 0.5)]
    [InlineData(0.75, 0.75)]
    [InlineData(1.0, 1.0)]
    public void The_Flat_curve_pays_in_proportion_to_elapsed_duration(double frac, double expected)
    {
        // Flat's first two keys are (0,0) and (1,1) with unit in/out tangents,
        // which is the Hermite spelling of a straight line. Any curvature here
        // is the basis functions being wrong, not the curve.
        Assert.Equal(expected, Rp1ProgramsMath.EvaluateCurve(FlatCurve(), frac)!.Value, 12);
    }

    [Fact]
    public void A_curve_clamps_to_its_end_keys_rather_than_extrapolating()
    {
        // HermiteCurve.Evaluate returns _firstValue below the range and
        // _lastValue above it. That is why a Program warped far past its
        // deadline stops accruing at 1.4 of its total instead of running off the
        // end of the table into money RP-1 will never pay.
        var curve = FlatCurve();
        Assert.Equal(0.0, Rp1ProgramsMath.EvaluateCurve(curve, -5.0)!.Value, 12);
        Assert.Equal(1.4, Rp1ProgramsMath.EvaluateCurve(curve, 40.0)!.Value, 12);
    }

    [Fact]
    public void A_curve_with_no_keys_reads_as_absent_rather_than_as_zero()
    {
        // A curve that pays nothing and a curve nobody could read are different
        // facts, and the second is the one that must not render as a flat line
        // along the bottom of a chart.
        Assert.Null(Rp1ProgramsMath.EvaluateCurve(new List<Rp1FundingCurveKeyRaw>(), 0.5));
        Assert.Null(Rp1ProgramsMath.EvaluateCurve(null, 0.5));
    }

    [Fact]
    public void An_infinite_tangent_holds_the_left_key_rather_than_interpolating()
    {
        // RP-1's step mode. ComputeRangeCoefficents zeroes the cubic and keeps
        // the left value when either tangent is infinite; the basis form has to
        // agree or a stepped curve becomes a NaN.
        var stepped = new List<Rp1FundingCurveKeyRaw>
        {
            new Rp1FundingCurveKeyRaw
            {
                Frac = 0.0, PaidFraction = 0.2,
                InTangent = double.PositiveInfinity, OutTangent = double.PositiveInfinity,
            },
            new Rp1FundingCurveKeyRaw { Frac = 1.0, PaidFraction = 1.0, InTangent = 0.0, OutTangent = 0.0 },
        };
        Assert.Equal(0.2, Rp1ProgramsMath.EvaluateCurve(stepped, 0.5)!.Value, 12);
    }

    [Theory]
    [InlineData(Rp1ProgramSpeeds.Normal, 9.0, 9.0)]
    [InlineData(Rp1ProgramSpeeds.Slow, 9.0, 13.5)]
    [InlineData(Rp1ProgramSpeeds.Fast, 9.0, 6.75)]
    public void Speed_scales_the_catalogue_duration_the_way_RP1_does(
        string speed, double nominalYears, double expectedYears)
    {
        var seconds = Rp1ProgramsMath.SpeedDurationSeconds(speed, nominalYears * Year);
        Assert.Equal(expectedYears * Year, seconds!.Value, 6);
    }

    [Fact]
    public void A_speed_scaled_duration_is_rounded_to_a_quarter_year()
    {
        // Program.DurationYearsCalc rounds years * factor to a quarter before
        // anything else touches it, so 1.1 years at Fast is 0.75 rather than
        // 0.825. The schedule lays years out against this number, so an
        // unrounded one would put the last payment in the wrong year.
        var seconds = Rp1ProgramsMath.SpeedDurationSeconds(Rp1ProgramSpeeds.Fast, 1.1 * Year);
        Assert.Equal(0.75 * Year, seconds!.Value, 6);
    }

    [Fact]
    public void An_unknown_speed_leaves_the_catalogue_duration_alone()
    {
        // A speed RP-1 adds after this build should read as the catalogue
        // duration rather than be silently treated as one of the three we know.
        var seconds = Rp1ProgramsMath.SpeedDurationSeconds("Breakneck", 8.0 * Year);
        Assert.Equal(8.0 * Year, seconds!.Value, 6);
    }

    [Fact]
    public void The_duration_in_force_is_recovered_from_the_deadline_RP1_left_behind()
    {
        // ProcessFunding writes deadlineUT = lastPaymentUT + (1 - fracElapsed) *
        // duration on every funding tick, so the three fields determine the
        // duration between them. This is the only route that carries whatever a
        // leader's modifier did to it, because RP-1 computes that by broadcasting
        // a query rather than by storing an answer.
        var duration = 7.0 * Year;
        var lastPayment = 12_345.0;
        var frac = 0.3;
        var deadline = lastPayment + (1.0 - frac) * duration;

        var recovered = Rp1ProgramsMath.DerivedDurationSeconds(deadline, lastPayment, frac);
        Assert.Equal(duration, recovered!.Value, 3);
    }

    [Fact]
    public void Past_the_deadline_the_duration_goes_absent_rather_than_wrong()
    {
        // RP-1 stops recomputing deadlineUT once fracElapsed reaches 1, so from
        // there the three fields no longer agree with each other and the
        // arithmetic would return a number about nothing.
        Assert.Null(Rp1ProgramsMath.DerivedDurationSeconds(9_000.0, 1_000.0, 1.0));
        Assert.Null(Rp1ProgramsMath.DerivedDurationSeconds(9_000.0, 1_000.0, 1.4));
        Assert.Null(Rp1ProgramsMath.DerivedDurationSeconds(null, 1_000.0, 0.5));
    }

    [Fact]
    public void A_whole_year_Program_on_Flat_pays_its_total_in_equal_years()
    {
        var schedule = Rp1ProgramsMath.FundingSchedule(
            FlatCurve(), 4.0 * Year, 400_000.0,
            fracElapsed: null, fundsPaidOut: null, isActive: false, isComplete: false);

        Assert.Equal(new[] { 1, 2, 3, 4 }, schedule.Select(p => p.Year));
        Assert.All(schedule, p => Assert.Equal(100_000.0, p.Funds, 6));
        Assert.Equal(400_000.0, schedule.Last().CumulativeFunds, 6);
    }

    [Fact]
    public void A_part_year_Program_pays_a_short_final_year()
    {
        // GetDescription clamps the sample to min(year, durationYears), which is
        // what makes the last year of a 3.25-year Program a quarter year long
        // and worth a quarter of a year's funding.
        var schedule = Rp1ProgramsMath.FundingSchedule(
            FlatCurve(), 3.25 * Year, 325_000.0,
            fracElapsed: null, fundsPaidOut: null, isActive: false, isComplete: false);

        Assert.Equal(new[] { 1, 2, 3, 4 }, schedule.Select(p => p.Year));
        Assert.Equal(100_000.0, schedule[0].Funds, 5);
        Assert.Equal(25_000.0, schedule[3].Funds, 5);
        Assert.Equal(325_000.0, schedule.Sum(p => p.Funds), 5);
    }

    [Fact]
    public void A_running_Program_schedules_from_where_it_has_got_to()
    {
        // The table answers "what is still coming", not "what was promised": the
        // years already paid are gone and the first row is measured from what has
        // actually been paid out rather than from the curve's own previous year.
        var schedule = Rp1ProgramsMath.FundingSchedule(
            FlatCurve(), 4.0 * Year, 400_000.0,
            fracElapsed: 0.5, fundsPaidOut: 200_000.0, isActive: true, isComplete: false);

        Assert.Equal(new[] { 3, 4 }, schedule.Select(p => p.Year));
        Assert.Equal(100_000.0, schedule[0].Funds, 6);
        Assert.Equal(300_000.0, schedule[0].CumulativeFunds, 6);
    }

    [Fact]
    public void A_completed_Program_has_no_schedule_at_all()
    {
        // RP-1's own rule: GetDescription gates the whole Funding Summary on
        // !IsComplete. A table of what a finished Program once would have paid
        // reads as money still coming.
        var schedule = Rp1ProgramsMath.FundingSchedule(
            FlatCurve(), 4.0 * Year, 400_000.0,
            fracElapsed: 1.0, fundsPaidOut: 400_000.0, isActive: false, isComplete: true);

        Assert.Empty(schedule);
    }

    [Fact]
    public void An_unreadable_duration_or_total_yields_no_schedule_rather_than_zeroes()
    {
        Assert.Empty(Rp1ProgramsMath.FundingSchedule(
            FlatCurve(), null, 400_000.0, null, null, false, false));
        Assert.Empty(Rp1ProgramsMath.FundingSchedule(
            FlatCurve(), 4.0 * Year, null, null, null, false, false));
        Assert.Empty(Rp1ProgramsMath.FundingSchedule(
            null, 4.0 * Year, 400_000.0, null, null, false, false));
    }
}

/// <summary>
/// The mapper's half: which curve a Program row is actually paid on, and the
/// three list fields that are absent rather than empty.
/// </summary>
public class Rp1ProgramFundingCaptureTests
{
    private const double Year = 31557600.0;

    private static Rp1ProgramsRaw WithCurves(params Rp1ProgramRaw[] programs)
    {
        var raw = new Rp1ProgramsRaw { Ut = 1000.0, DefaultCurve = "Flat" };
        raw.Programs.AddRange(programs);
        raw.Curves.Add(new Rp1FundingCurveRaw
        {
            Name = "Flat",
            Keys = new List<Rp1FundingCurveKeyRaw>
            {
                new Rp1FundingCurveKeyRaw { Frac = 0.0, PaidFraction = 0.0, InTangent = 1.0, OutTangent = 1.0 },
                new Rp1FundingCurveKeyRaw { Frac = 1.0, PaidFraction = 1.0, InTangent = 1.0, OutTangent = 0.8 },
            },
        });
        raw.Curves.Add(new Rp1FundingCurveRaw
        {
            Name = "AllUpFront",
            Keys = new List<Rp1FundingCurveKeyRaw>
            {
                new Rp1FundingCurveKeyRaw { Frac = 0.0, PaidFraction = 1.0, InTangent = 0.0, OutTangent = 0.0 },
                new Rp1FundingCurveKeyRaw { Frac = 1.0, PaidFraction = 1.0, InTangent = 0.0, OutTangent = 0.0 },
            },
        });
        return raw;
    }

    private static Rp1ProgramRaw Offer(string? curve) => new Rp1ProgramRaw
    {
        Name = "EarlyXPlanes",
        Title = "Early X-Planes",
        State = Rp1ProgramStates.Offerable,
        Speed = Rp1ProgramSpeeds.Normal,
        NominalDurationSeconds = 4.0 * Year,
        TotalFunding = 400_000.0,
        FundingCurve = curve,
    };

    private static Dictionary<string, object?> Row(Rp1ProgramsRaw raw) =>
        (Dictionary<string, object?>)Rp1ProgramsCapture.BuildPrograms(raw)![0]!;

    [Fact]
    public void A_Program_naming_no_curve_is_paid_on_the_default_one()
    {
        // ProgramHandlerSettings.FundingCurve falls back to defaultFundingCurve
        // for an empty name, so a row with none is genuinely paid on Flat. A
        // client that treated the absent name as "no curve" would show the
        // Program paying nothing.
        var payments = (List<object?>?)Row(WithCurves(Offer(null)))["fundingPayments"];
        Assert.NotNull(payments);
        Assert.Equal(4, payments!.Count);
    }

    [Fact]
    public void A_Program_naming_a_curve_RP1_does_not_hold_also_falls_back()
    {
        // The same fallback covers an unknown name, which is how a Program from
        // a config patch this install does not have still schedules.
        var payments = (List<object?>?)Row(WithCurves(Offer("NotAcurve")))["fundingPayments"];
        Assert.NotNull(payments);
        Assert.Equal(4, payments!.Count);
    }

    [Fact]
    public void The_named_curve_is_preferred_over_the_default()
    {
        var first = (Dictionary<string, object?>)
            ((List<object?>)Row(WithCurves(Offer("AllUpFront")))["fundingPayments"]!)[0]!;
        Assert.Equal(400_000.0, (double)first["funds"]!, 6);
    }

    [Fact]
    public void The_speed_table_carries_all_three_speeds_in_RP1s_own_order()
    {
        // A ladder read from cheapest-and-slowest upward. A dictionary's own
        // enumeration order is not that ladder, and an operator comparing prices
        // in an arbitrary order is comparing them wrong.
        var program = Offer("Flat");
        program.ConfidenceCostBySpeed["Slow"] = 0.0;
        program.ConfidenceCostBySpeed["Normal"] = 350.0;
        program.ConfidenceCostBySpeed["Fast"] = 700.0;

        var options = ((List<object?>)Row(WithCurves(program))["speedOptions"]!)
            .Cast<Dictionary<string, object?>>()
            .ToList();

        Assert.Equal(new[] { "Slow", "Normal", "Fast" }, options.Select(o => (string?)o["speed"]));
        Assert.Equal(new double?[] { 0.0, 350.0, 700.0 }, options.Select(o => (double?)o["confidenceCost"]));
        Assert.Equal(6.0 * Year, (double)options[0]["durationSeconds"]!, 6);
        Assert.Equal(3.0 * Year, (double)options[2]["durationSeconds"]!, 6);
    }

    [Fact]
    public void A_speed_the_table_does_not_price_reads_as_absent_not_free()
    {
        // RP-1 loads a missing CONFIDENCECOSTS key as zero itself, so a real
        // zero arrives as a zero. A row we could not read is a different fact and
        // must not be presented as the free option.
        var options = ((List<object?>)Row(WithCurves(Offer("Flat")))["speedOptions"]!)
            .Cast<Dictionary<string, object?>>()
            .ToList();
        Assert.All(options, o => Assert.Null(o["confidenceCost"]));
    }

    [Fact]
    public void A_Program_that_closes_nothing_off_publishes_absent_rather_than_empty()
    {
        Assert.Null(Row(WithCurves(Offer("Flat")))["programsToDisableOnAccept"]);
    }

    [Fact]
    public void The_Programs_an_accept_closes_off_travel_in_RP1s_own_order()
    {
        var program = Offer("Flat");
        program.ProgramsToDisableOnAccept.Add("CrewedOrbit");
        program.ProgramsToDisableOnAccept.Add("Munar");

        var closed = (List<object?>)Row(WithCurves(program))["programsToDisableOnAccept"]!;
        Assert.Equal(new object?[] { "CrewedOrbit", "Munar" }, closed);
    }

    [Fact]
    public void An_accepted_Program_measures_its_duration_from_the_deadline()
    {
        // The derived duration wins over the speed-scaled catalogue one, because
        // it is the one that carries whatever the career's leaders did to it.
        var program = Offer("Flat");
        program.State = Rp1ProgramStates.Active;
        program.IsActive = true;
        program.FracElapsed = 0.5;
        program.FundsPaidOut = 200_000.0;
        program.DerivedDurationSeconds = 6.0 * Year;

        var row = Row(WithCurves(program));
        Assert.Equal(6.0 * Year, (double)row["durationSeconds"]!, 6);
        // Six years at half elapsed: the table starts at year 4, not year 1.
        var payments = ((List<object?>)row["fundingPayments"]!)
            .Cast<Dictionary<string, object?>>()
            .ToList();
        Assert.Equal(new object?[] { 4, 5, 6 }, payments.Select(p => p["year"]));
    }

    [Fact]
    public void The_curve_catalogue_names_the_one_RP1_falls_back_to()
    {
        var curves = Rp1ProgramsCapture.BuildFundingCurves(WithCurves(Offer("Flat")))!
            .Cast<Dictionary<string, object?>>()
            .ToList();

        Assert.Equal(new object?[] { "Flat", "AllUpFront" }, curves.Select(c => c["name"]));
        Assert.Equal(new object?[] { true, false }, curves.Select(c => c["isDefault"]));
        Assert.Equal(2, ((List<object?>)curves[0]["keys"]!).Count);
    }

    [Fact]
    public void No_handler_publishes_no_curve_catalogue()
    {
        // Same rule the Program list follows: an empty table would say RP-1 pays
        // on no curve at all, about an install that ships twelve.
        Assert.Null(Rp1ProgramsCapture.BuildFundingCurves(null));
    }
}

/// <summary>
/// The reflection half of the funding read: RP-1's shared curve table and the
/// per-Program fields a detail surface needs, off a stand-in graph.
/// </summary>
[Collection("rp0-static-graph")]
public class Rp1ProgramFundingReflectionTests : IDisposable
{
    public Rp1ProgramFundingReflectionTests() => Reset();

    public void Dispose() => Reset();

    private static void Reset()
    {
        ProgramHandler.Instance = null;
        ProgramHandler.Settings = null;
        ProgramHandler.Programs = new List<Program>();
        ProgramHandler.ProgramModifiers = new List<ProgramModifier>();
    }

    private static Rp1ProgramsRaw Read()
    {
        ProgramHandler.Instance = new ProgramHandler();
        var raw = new Rp1ProgramsReflection().Read(5_000.0);
        Assert.NotNull(raw);
        return raw!;
    }

    [Fact]
    public void The_shared_curve_table_is_read_with_the_curve_RP1_falls_back_to()
    {
        ProgramHandler.Settings = new ProgramHandlerSettings
        {
            defaultFundingCurve = "Flat",
            paymentCurves =
            {
                ["Flat"] = new ROUtils.HermiteCurve(
                    new ROUtils.HermiteCurve.Key(0.0, 0.0, 1.0, 1.0),
                    new ROUtils.HermiteCurve.Key(1.0, 1.0, 1.0, 0.8)),
            },
        };

        var raw = Read();
        Assert.Equal("Flat", raw.DefaultCurve);
        var curve = Assert.Single(raw.Curves);
        Assert.Equal("Flat", curve.Name);
        Assert.Equal(2, curve.Keys.Count);
        Assert.Equal(1.0, curve.Keys[0].OutTangent, 12);
        Assert.Equal(0.8, curve.Keys[1].OutTangent, 12);
        Assert.Equal(1.0, curve.Keys[1].PaidFraction, 12);
    }

    [Fact]
    public void Absent_settings_leave_the_catalogue_empty_and_take_nothing_else_down()
    {
        // The Program rows have to survive an unreadable settings object: a
        // career whose curve table we cannot see still has Programs, deadlines
        // and Confidence prices worth showing.
        ProgramHandler.Programs.Add(new Program { name = "EarlyXPlanes", title = "Early X-Planes" });

        var raw = Read();
        Assert.Null(raw.DefaultCurve);
        Assert.Empty(raw.Curves);
        Assert.Single(raw.Programs);
    }

    [Fact]
    public void A_Programs_whole_Confidence_table_and_disable_list_are_read()
    {
        var program = new Program
        {
            name = "EarlyXPlanes",
            title = "Early X-Planes",
            nominalDurationYears = 4,
        };
        program.confidenceCosts[Program.Speed.Slow] = 0f;
        program.confidenceCosts[Program.Speed.Normal] = 150f;
        program.confidenceCosts[Program.Speed.Fast] = 300f;
        program.programsToDisableOnAccept.Add("CrewedOrbit");
        ProgramHandler.Programs.Add(program);

        var row = Assert.Single(Read().Programs);
        Assert.Equal(0.0, row.ConfidenceCostBySpeed["Slow"], 6);
        Assert.Equal(150.0, row.ConfidenceCostBySpeed["Normal"], 6);
        Assert.Equal(300.0, row.ConfidenceCostBySpeed["Fast"], 6);
        Assert.Equal(new[] { "CrewedOrbit" }, row.ProgramsToDisableOnAccept);
    }

    [Fact]
    public void An_active_Programs_duration_is_derived_and_a_templates_is_not()
    {
        const double year = 31557600.0;
        var accepted = new Program
        {
            name = "SuborbRocketDev",
            title = "Sounding Rockets",
            nominalDurationYears = 5,
            acceptedUT = 1_000.0,
            lastPaymentUT = 2_000.0,
            fracElapsed = 0.25,
            deadlineUT = 2_000.0 + 0.75 * 5.0 * year,
            baseFunding = 250_000,
        };
        ProgramHandler.Instance = new ProgramHandler();
        ProgramHandler.Instance.ActivePrograms.Add(accepted);
        ProgramHandler.Programs.Add(new Program { name = "EarlyXPlanes", nominalDurationYears = 5 });

        var raw = new Rp1ProgramsReflection().Read(5_000.0)!;
        var active = raw.Programs.Single(p => p.State == Rp1ProgramStates.Active);
        var template = raw.Programs.Single(p => p.State != Rp1ProgramStates.Active);

        Assert.Equal(5.0 * year, active.DerivedDurationSeconds!.Value, 3);
        Assert.True(active.IsActive);
        Assert.False(active.IsComplete);
        // No persisted deadline to read: the mapper falls back to the
        // speed-scaled catalogue duration and the wire says so on the field.
        Assert.Null(template.DerivedDurationSeconds);
        Assert.False(template.IsActive);
    }

    [Fact]
    public void A_modifier_that_discounts_Confidence_moves_every_speed_it_names()
    {
        // ProgramModifier.Apply overwrites the per-speed table, so a row showing
        // only the selected speed's discount would leave the other two quoting
        // prices the Administration building will not charge.
        var target = new Program { name = "EarlyXPlanes", nominalDurationYears = 4 };
        target.confidenceCosts[Program.Speed.Normal] = 150f;
        target.confidenceCosts[Program.Speed.Fast] = 300f;
        ProgramHandler.Programs.Add(target);

        var source = new Program { name = "SuborbRocketDev", acceptedUT = 10.0 };
        ProgramHandler.Instance = new ProgramHandler();
        ProgramHandler.Instance.ActivePrograms.Add(source);

        var modifier = new ProgramModifier { srcProgram = "SuborbRocketDev", tgtProgram = "EarlyXPlanes" };
        modifier.confidenceCosts[Program.Speed.Normal] = 75f;
        modifier.confidenceCosts[Program.Speed.Fast] = 150f;
        ProgramHandler.ProgramModifiers.Add(modifier);

        var raw = new Rp1ProgramsReflection().Read(5_000.0)!;
        var row = raw.Programs.Single(p => p.Name == "EarlyXPlanes");
        Assert.Equal(75.0, row.ConfidenceCostBySpeed["Normal"], 6);
        Assert.Equal(150.0, row.ConfidenceCostBySpeed["Fast"], 6);
    }
}
