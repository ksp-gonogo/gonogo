// The two standing targets: a hire instruction and a warp's fund stop-condition.
//
// Both spend or stop something while nobody is watching, and both are cleared by
// RP-1 without saying so, which is why ABSENCE and INACTIVITY have to arrive
// looking different. A client that cannot tell "no target set" from "I could not
// read the target" will show a blank where a commitment is running.
//
// What these cannot prove is what no fixture-backed test here can: these
// stand-ins carry RP-1's names, so a rename stops production resolving while
// they go on passing. Rp1ReflectionTargets holds that line against the shipped
// binary, and it pins every member read below.
using System;
using GonogoRp1Uplink;
using RP0;
using Xunit;

[Collection("rp0-static-graph")]
public class Rp1TargetsTests : IDisposable
{
    public Rp1TargetsTests() => Reset();

    public void Dispose() => Reset();

    private static void Reset()
    {
        SpaceCenterManagement.Instance = null;
        Confidence.Instance = null;
        MaintenanceHandler.Instance = null;
        KSCSwitcherInterop.Sites = null;
    }

    /// <summary>A managed career with both targets present and unset, as RP-1 constructs them.</summary>
    private static SpaceCenterManagement Career()
    {
        var scm = new SpaceCenterManagement();
        SpaceCenterManagement.Instance = scm;
        return scm;
    }

    private static Rp1ScRaw Read() => new Rp1ScReflection().Read(ut: 100.0);

    // ── Absence is not inactivity ───────────────────────────────────────────

    /// <summary>
    /// No RP-1 at all. The channel must say nothing rather than report that no
    /// target is set, because those are different claims and only one of them is
    /// true here.
    /// </summary>
    [Fact]
    public void Says_nothing_about_either_target_when_there_is_no_career()
    {
        var raw = Read();

        Assert.Null(raw.HireTarget);
        Assert.Null(raw.FundTarget);
    }

    /// <summary>
    /// The project objects always exist, so a readable career with nothing
    /// scheduled reports INACTIVE rather than absent. This is the reading that
    /// makes RP-1's silent clear survivable: the operator watches a target go.
    /// </summary>
    [Fact]
    public void Reports_an_unset_target_as_inactive_rather_than_as_absent()
    {
        Career();

        var raw = Read();

        Assert.NotNull(raw.HireTarget);
        Assert.False(raw.HireTarget!.Active);
        Assert.NotNull(raw.FundTarget);
        Assert.False(raw.FundTarget!.Active);
    }

    /// <summary>An inactive target carries no figures to be mistaken for a commitment.</summary>
    [Fact]
    public void An_inactive_target_carries_no_numbers()
    {
        Career();

        var raw = Read();

        Assert.Null(raw.HireTarget!.TargetCount);
        Assert.Null(raw.HireTarget.LeftToHire);
        Assert.Null(raw.HireTarget.TimeLeftSeconds);
        Assert.Null(raw.FundTarget!.TargetFunds);
    }

    // ── The hire target ─────────────────────────────────────────────────────

    /// <summary>
    /// The headcount is DERIVED from the two public readings rather than taken
    /// from the private field behind them, so it cannot disagree with the other
    /// two numbers on the same row.
    /// </summary>
    [Fact]
    public void Derives_the_target_headcount_from_what_is_left_and_what_is_there()
    {
        var scm = Career();
        scm.staffTarget = new HireStaffProject
        {
            targetCrewCount = 12,
            CurrentAmount = 5,
            LCID = Guid.NewGuid(),
            TimeLeft = 86_400.0,
        };

        var target = Read().HireTarget!;

        Assert.True(target.Active);
        Assert.Equal(7, target.LeftToHire);
        Assert.Equal(5, target.CurrentCount);
        Assert.Equal(12, target.TargetCount);
        Assert.Equal(86_400.0, target.TimeLeftSeconds);
    }

    /// <summary>
    /// RP-1 stores no kind field: a target that names no complex hires
    /// researchers. So the complex is absent on a research target rather than
    /// carrying an empty GUID that a client would have to know to ignore.
    /// </summary>
    [Fact]
    public void A_research_target_names_no_complex()
    {
        var scm = Career();
        scm.staffTarget = new HireStaffProject { targetCrewCount = 3, CurrentAmount = 1 };

        var target = Read().HireTarget!;

        Assert.True(target.IsResearch);
        Assert.Null(target.LcId);
    }

    /// <summary>An engineer target names the complex it staffs, in the key every other row uses.</summary>
    [Fact]
    public void An_engineer_target_names_its_complex()
    {
        var scm = Career();
        var lc = Guid.NewGuid();
        scm.staffTarget = new HireStaffProject { targetCrewCount = 4, CurrentAmount = 0, LCID = lc };

        var target = Read().HireTarget!;

        Assert.False(target.IsResearch);
        // The shared GUID reader's format, which is what every other LcId on the
        // wire carries: a target naming its complex in a different shape from the
        // complex rows would not join to anything.
        Assert.Equal(lc.ToString(), target.LcId);
    }

    // ── The fund target ─────────────────────────────────────────────────────

    /// <summary>
    /// Both figures are read, including the balance the target was set at: it is
    /// the other end of RP-1's own progress measure, and the reason a figure
    /// equal to it counts as no target.
    /// </summary>
    [Fact]
    public void Reads_both_ends_of_the_fund_target()
    {
        var scm = Career();
        scm.fundTarget.Set(target: 250_000.0, original: 100_000.0);
        scm.fundTarget.TimeLeft = 3_600.0;

        var target = Read().FundTarget!;

        Assert.True(target.Active);
        Assert.Equal(250_000.0, target.TargetFunds);
        Assert.Equal(100_000.0, target.OriginalFunds);
        Assert.Equal(3_600.0, target.TimeLeftSeconds);
    }

    /// <summary>
    /// RP-1's own validity rule, which is not "the number is non-zero": a target
    /// equal to the balance it was set at is not a target. Asserted because a
    /// client reading only the figure would show a live commitment here.
    /// </summary>
    [Fact]
    public void A_fund_target_equal_to_the_balance_it_was_set_at_is_no_target()
    {
        var scm = Career();
        scm.fundTarget.Set(target: 100_000.0, original: 100_000.0);

        var target = Read().FundTarget!;

        Assert.False(target.Active);
        Assert.Null(target.TargetFunds);
    }

    // ── The bug that must not be imported ───────────────────────────────────

    /// <summary>
    /// NO PROGRESS FRACTION on the wire, for either target.
    ///
    /// <para>RP-1's <c>HireStaffProject.GetFractionComplete()</c> divides two
    /// ints and widens afterwards, confirmed at IL as <c>div</c> then
    /// <c>conv.r8</c>, so it reads zero for the whole hire and snaps to one at
    /// the end. Its crew R&amp;R equivalent returns a literal zero. Publishing a
    /// fraction at all invites a client to draw the bar RP-1 draws, so the
    /// capture is asserted not to offer one.</para>
    /// </summary>
    [Fact]
    public void Publishes_no_progress_fraction_for_either_target()
    {
        var scm = Career();
        scm.staffTarget = new HireStaffProject { targetCrewCount = 10, CurrentAmount = 9 };
        scm.fundTarget.Set(target: 250_000.0, original: 100_000.0);
        var raw = Read();

        var hire = Rp1ScCapture.BuildHireTarget(raw.HireTarget)!;
        var funds = Rp1ScCapture.BuildFundTarget(raw)!;

        Assert.DoesNotContain(hire.Keys, k => k.Contains("fraction", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(funds.Keys, k => k.Contains("fraction", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(hire.Keys, k => k.Contains("progress", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// The honest reading in the case RP-1's fraction gets most wrong: nine of
    /// ten hired still reports zero from RP-1's own arithmetic, while the count
    /// left says exactly where the career is.
    /// </summary>
    [Fact]
    public void Says_one_hire_remains_where_RP1s_own_fraction_would_say_none_of_it_is_done()
    {
        var scm = Career();
        scm.staffTarget = new HireStaffProject { targetCrewCount = 10, CurrentAmount = 9 };

        var target = Read().HireTarget!;

        Assert.Equal(1, target.LeftToHire);
        Assert.Equal(10, target.TargetCount);
    }

    // ── The capture ─────────────────────────────────────────────────────────

    /// <summary>
    /// The hire target rides the personnel Topic, so a client reading staffing
    /// sees the standing instruction beside the headcount it acts on.
    /// </summary>
    [Fact]
    public void The_hire_target_rides_the_personnel_topic()
    {
        var scm = Career();
        scm.staffTarget = new HireStaffProject { targetCrewCount = 6, CurrentAmount = 2 };

        var personnel = Rp1ScCapture.BuildPersonnel(Read())!;

        Assert.True(personnel.ContainsKey("hireTarget"));
        var target = Assert.IsAssignableFrom<System.Collections.Generic.Dictionary<string, object?>>(personnel["hireTarget"]);
        Assert.Equal(4, target["leftToHire"]);
    }

    /// <summary>Unreadable stays unreadable through the capture, rather than becoming an empty row.</summary>
    [Fact]
    public void The_capture_says_nothing_when_the_target_could_not_be_read()
    {
        Assert.Null(Rp1ScCapture.BuildHireTarget(null));
        Assert.Null(Rp1ScCapture.BuildFundTarget(new Rp1ScRaw()));
    }
}
