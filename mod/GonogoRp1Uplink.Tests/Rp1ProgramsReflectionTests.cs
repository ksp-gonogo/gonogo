using System;
using System.Collections.Generic;
using System.Linq;
using GonogoRp1Uplink;
using RP0.Programs;
using Xunit;

/// <summary>
/// The Program reflection walk against a stand-in RP-1 graph. What it proves is
/// that the walk reads the members RP-1 declares, discriminates the four states
/// the way RP-1's Administration building does, and keeps every accept-time
/// field absent on a Program nobody has accepted.
/// </summary>
[Collection("rp0-static-graph")]
public class Rp1ProgramsReflectionTests : IDisposable
{
    public Rp1ProgramsReflectionTests() => Reset();

    public void Dispose() => Reset();

    private static void Reset()
    {
        ProgramHandler.Instance = null;
        ProgramHandler.Programs = new List<Program>();
        ProgramHandler.ProgramModifiers = new List<ProgramModifier>();
    }

    private static Program Template(string name, string title = "A Program")
    {
        var p = new Program
        {
            name = name,
            title = title,
            isHSF = true,
            nominalDurationYears = 9,
            baseFunding = 800_000,
            fundingCurve = "BimodalBackloaded",
            repDeltaOnCompletePerYearEarly = 130,
            repPenaltyPerYearLate = 130,
            slots = 2,
            objectivesPrettyText = "Fly the X-Planes.",
        };
        p.confidenceCosts[Program.Speed.Slow] = 0f;
        p.confidenceCosts[Program.Speed.Normal] = 350f;
        p.confidenceCosts[Program.Speed.Fast] = 700f;
        return p;
    }

    private static Rp1ProgramsRaw ReadWith(Action<ProgramHandler> arrange)
    {
        var handler = new ProgramHandler();
        arrange(handler);
        ProgramHandler.Instance = handler;
        var raw = new Rp1ProgramsReflection().Read(1234.0);
        Assert.NotNull(raw);
        return raw!;
    }

    [Fact]
    public void An_absent_handler_reads_as_nothing_rather_than_an_empty_catalogue()
    {
        // The distinction the whole channel rests on. RP-1's catalogue is never
        // empty, so an empty list could only mean this career has been offered
        // nothing, which is a claim about the career rather than the install.
        ProgramHandler.Instance = null;
        Assert.Null(new Rp1ProgramsReflection().Read(0.0));
    }

    [Fact]
    public void An_unaccepted_Program_carries_no_accept_time_field()
    {
        var raw = ReadWith(_ => ProgramHandler.Programs.Add(Template("EarlyXPlanes")));

        var row = Assert.Single(raw.Programs);
        Assert.Equal(Rp1ProgramStates.Locked, row.State);
        Assert.Null(row.AcceptedUt);
        Assert.Null(row.DeadlineUt);
        Assert.Null(row.CompletedUt);
        Assert.Null(row.LastPaymentUt);
        Assert.Null(row.FundsPaidOut);
        Assert.Null(row.RepPenaltyAssessed);
        // -1 is RP-1's "never funded" sentinel, and a client rendering it as a
        // progress bar would draw one pointing backwards.
        Assert.Null(row.FracElapsed);
    }

    [Fact]
    public void Requirements_met_is_what_separates_an_offer_from_a_locked_Program()
    {
        var offerable = Template("EarlySatellites");
        offerable.AllRequirementsMet = true;
        var locked = Template("CrewedOrbit");

        var raw = ReadWith(_ =>
        {
            ProgramHandler.Programs.Add(offerable);
            ProgramHandler.Programs.Add(locked);
        });

        Assert.Equal(Rp1ProgramStates.Offerable, raw.Programs.Single(p => p.Name == "EarlySatellites").State);
        Assert.True(raw.Programs.Single(p => p.Name == "EarlySatellites").CanAccept);
        Assert.Equal(Rp1ProgramStates.Locked, raw.Programs.Single(p => p.Name == "CrewedOrbit").State);
        Assert.False(raw.Programs.Single(p => p.Name == "CrewedOrbit").CanAccept);
    }

    [Fact]
    public void A_disabled_Program_is_never_offerable_however_met_its_requirements_are()
    {
        // Accepting a rival Program closes this one off, and RP-1 records that
        // in a set on the handler rather than on the Program. Reading only the
        // requirements would offer the operator something the Administration
        // building refuses.
        var ruledOut = Template("CrewedOrbitEarly");
        ruledOut.AllRequirementsMet = true;

        var raw = ReadWith(h =>
        {
            ProgramHandler.Programs.Add(ruledOut);
            h.DisabledPrograms.Add("CrewedOrbitEarly");
        });

        var row = Assert.Single(raw.Programs);
        Assert.Equal(Rp1ProgramStates.Disabled, row.State);
        Assert.False(row.CanAccept);
        // The requirement reading itself is still reported: the operator can see
        // that the Program was closed off rather than merely out of reach.
        Assert.True(row.RequirementsMet);
    }

    [Fact]
    public void An_active_Program_reports_its_own_progress_and_never_the_catalogue_row()
    {
        var accepted = Template("EarlyXPlanes");
        accepted.acceptedUT = 1_000;
        accepted.deadlineUT = 285_000_000;
        accepted.lastPaymentUT = 40_000;
        accepted.fracElapsed = 0.25;
        accepted.totalFunding = 800_000;
        accepted.fundsPaidOut = 120_000;

        var raw = ReadWith(h =>
        {
            h.ActivePrograms.Add(accepted);
            // The catalogue still holds the un-accepted template, and it must
            // not produce a second row for the same Program.
            ProgramHandler.Programs.Add(Template("EarlyXPlanes"));
        });

        var row = Assert.Single(raw.Programs);
        Assert.Equal(Rp1ProgramStates.Active, row.State);
        Assert.Equal(1_000, row.AcceptedUt);
        Assert.Equal(285_000_000, row.DeadlineUt);
        Assert.Equal(0.25, row.FracElapsed);
        Assert.Equal(120_000, row.FundsPaidOut);
        Assert.Equal(800_000, row.TotalFunding);
        // Inside its deadline, so nothing lost: a reading, not an absence.
        Assert.Equal(0.0, row.RepPenaltyAssessed);
    }

    [Fact]
    public void A_completed_Program_is_reported_as_completed_rather_than_as_active()
    {
        var done = Template("EarlySatellites");
        done.acceptedUT = 1_000;
        done.completedUT = 200_000;

        var raw = ReadWith(h => h.CompletedPrograms.Add(done));

        var row = Assert.Single(raw.Programs);
        Assert.Equal(Rp1ProgramStates.Completed, row.State);
        Assert.Equal(200_000, row.CompletedUt);
    }

    [Fact]
    public void The_speed_is_read_from_RP1s_private_field_as_a_name()
    {
        var fast = Template("EarlyXPlanes");
        fast.SetSpeed(Program.Speed.Fast);

        var row = Assert.Single(ReadWith(_ => ProgramHandler.Programs.Add(fast)).Programs);

        // A name rather than an ordinal: RP-1's ordinals are its own business
        // and shift between releases.
        Assert.Equal("Fast", row.Speed);
        Assert.Equal(700.0, row.ConfidenceCost);
        // Fast costs half again as much for running late, which is the whole of
        // RepPenaltyPerYearLateCalc.
        Assert.Equal(195.0, row.RepPenaltyPerYearLate);
    }

    [Fact]
    public void A_Slow_Programs_free_Confidence_price_is_a_zero_and_not_an_absence()
    {
        // The shipped catalogue prices Slow at nothing, so zero here is a real
        // price. Reported as absent it would read as "we could not find out what
        // this costs", which is the opposite of the truth.
        var slow = Template("EarlyXPlanes");
        slow.SetSpeed(Program.Speed.Slow);

        var row = Assert.Single(ReadWith(_ => ProgramHandler.Programs.Add(slow)).Programs);
        Assert.Equal(0.0, row.ConfidenceCost);
    }

    [Fact]
    public void The_duration_reaches_the_wire_in_seconds_over_RP1s_own_Julian_year()
    {
        var row = Assert.Single(ReadWith(_ => ProgramHandler.Programs.Add(Template("EarlyXPlanes"))).Programs);

        // 31,557,600 s is 365.25 days, which is the divisor RP-1's own Program
        // arithmetic uses throughout. A game year would be wrong by a fifth.
        Assert.Equal(9 * 31_557_600.0, row.NominalDurationSeconds);
    }

    [Fact]
    public void A_program_modifier_whose_source_is_completed_rewrites_the_offer()
    {
        // RP-1 does not modify its catalogue in place: it overlays on a copy,
        // and the Administration building shows the overlaid figures. A row that
        // quoted the catalogue would offer funding the operator will not get.
        var target = Template("EarlyXPlanes");
        target.AllRequirementsMet = true;
        target.FundsGainMultiplier = 2.0;

        var source = Template("EarlySatellites");
        source.acceptedUT = 1;
        source.completedUT = 2;

        var modifier = new ProgramModifier
        {
            srcProgram = "EarlySatellites",
            tgtProgram = "EarlyXPlanes",
            nominalDurationYears = 5,
            baseFunding = 350_000,
            fundingCurve = "Flat",
            slots = 1,
        };
        modifier.confidenceCosts[Program.Speed.Normal] = 250f;

        var raw = ReadWith(h =>
        {
            h.CompletedPrograms.Add(source);
            ProgramHandler.Programs.Add(target);
            ProgramHandler.ProgramModifiers.Add(modifier);
        });

        var row = raw.Programs.Single(p => p.Name == "EarlyXPlanes");
        Assert.Equal(5 * 31_557_600.0, row.NominalDurationSeconds);
        Assert.Equal("Flat", row.FundingCurve);
        Assert.Equal(1, row.Slots);
        Assert.Equal(250.0, row.ConfidenceCost);
        // The career's funds multiplier survives the rescale: 350,000 at 2x.
        Assert.Equal(700_000.0, row.TotalFunding);
    }

    [Fact]
    public void A_program_modifier_whose_source_is_unaccepted_changes_nothing()
    {
        var target = Template("EarlyXPlanes");
        var modifier = new ProgramModifier
        {
            srcProgram = "EarlySatellites",
            tgtProgram = "EarlyXPlanes",
            baseFunding = 350_000,
        };

        var raw = ReadWith(_ =>
        {
            ProgramHandler.Programs.Add(target);
            ProgramHandler.ProgramModifiers.Add(modifier);
        });

        Assert.Equal(800_000.0, Assert.Single(raw.Programs).TotalFunding);
    }

    [Fact]
    public void The_slot_ceiling_is_absent_rather_than_guessed_when_RP1_cannot_answer()
    {
        // Outside a loaded career RP-1's ceiling comes back unreadable. A free
        // count derived from an assumed ceiling would tell the operator they can
        // start something they cannot.
        var raw = ReadWith(h =>
        {
            h.MaxProgramSlots = null;
            h.ActivePrograms.Add(Template("EarlyXPlanes"));
        });

        Assert.Null(raw.Slots.MaxSlots);
        Assert.Equal(2, raw.Slots.UsedSlots);
        Assert.Null(Rp1ProgramsCapture.BuildSlots(raw)!["freeSlots"]);
    }

    [Fact]
    public void Used_slots_are_summed_over_each_active_Programs_own_cost()
    {
        var one = Template("EarlyXPlanes");
        one.acceptedUT = 1;
        one.slots = 2;
        var two = Template("EarlySatellites");
        two.acceptedUT = 1;
        two.slots = 1;

        var raw = ReadWith(h =>
        {
            h.MaxProgramSlots = 4;
            h.ActivePrograms.Add(one);
            h.ActivePrograms.Add(two);
        });

        Assert.Equal(4, raw.Slots.MaxSlots);
        Assert.Equal(3, raw.Slots.UsedSlots);
        Assert.Equal(2, raw.Slots.ActiveCount);
        Assert.Equal(1, Rp1ProgramsCapture.BuildSlots(raw)!["freeSlots"]);
    }
}
