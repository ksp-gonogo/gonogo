// The enrolable catalogue, and the three writes that put a crew through one of
// its trainings and take them back off.
//
// What these hold is the SEQUENCE, because that is where this work can go wrong
// in a way nothing else notices. RP-1's enrolment grounds every student partway
// through, so a refusal that arrives late leaves kerbals unavailable against a
// course nobody holds; and RP-1's Cancel is a CompleteCourse on a course whose
// completed flag is still false, so a guard that let a completed one through
// would grant a second retirement extension and open a dialog nobody asked for.
//
// What these cannot prove is what no fixture-backed test here can: the stand-ins
// carry RP-1's names, so a rename stops production resolving while these go on
// passing. Rp1ReflectionTargets holds that line against the shipped binary, and
// it pins every member and method reached below.
using System;
using System.Collections.Generic;
using System.Linq;
using GonogoRp1Uplink;
using RP0;
using RP0.Crew;
using Sitrep.Contract;
using Xunit;

[Collection("rp0-static-graph")]
public class Rp1TrainingTests : IDisposable
{
    public Rp1TrainingTests() => Reset();

    public void Dispose() => Reset();

    private static void Reset()
    {
        CrewHandler.Instance = null;
        MaintenanceHandler.Instance = null;
        KCTUtilities.FacilityLevels.Clear();
        TrainingCourse.AddedByName.Clear();
        TrainingCourse.RemovedByName.Clear();
        TrainingCourse.Rewarded = 0;
        ProtoCrewMember.Ut = 0.0;
        HighLogic.Reset();
    }

    private static TrainingTemplate Template(
        string id = "prof-capsule",
        int seatMin = 1,
        int seatMax = 0,
        double time = 100.0,
        int acLevel = 0) => new TrainingTemplate
        {
            id = id,
            name = "Capsule proficiency",
            description = "Learn the capsule",
            type = TrainingTemplate.TrainingType.Proficiency,
            training = new TrainingFlightEntry { type = "TRAINING_proficiency", target = "capsule" },
            time = time,
            seatMin = seatMin,
            seatMax = seatMax,
            ACLevelRequirement = acLevel,
        };

    /// <summary>A managed career with a crew handler, a maintenance handler and a roster.</summary>
    private static CrewHandler Career(params ProtoCrewMember[] roster)
    {
        var handler = new CrewHandler();
        CrewHandler.Instance = handler;
        MaintenanceHandler.Instance = new MaintenanceHandler();
        HighLogic.CurrentGame.CrewRoster = new KerbalRoster().With(roster);
        return handler;
    }

    private static List<object?>? Catalogue() =>
        Rp1CrewCapture.BuildCatalogue(new Rp1TrainingCatalogueReflection().Read(ut: 100.0));

    private static Dictionary<string, object?> Row(List<object?>? rows, int index) =>
        (Dictionary<string, object?>)rows![index]!;

    // ── The catalogue ───────────────────────────────────────────────────────

    /// <summary>
    /// No RP-1 career at all. The channel must say NOTHING rather than an empty
    /// list, because an empty catalogue would claim the install has no crewed part
    /// that can be trained on, which RP-1 never means.
    /// </summary>
    [Fact]
    public void Publishes_nothing_when_there_is_no_crew_handler()
    {
        Assert.Null(Catalogue());
    }

    [Fact]
    public void Publishes_every_field_an_operator_picks_a_training_by()
    {
        var handler = Career();
        handler.TrainingTemplates.Add(Template(seatMin: 2, seatMax: 4, time: 86400.0));
        handler.TrainingTemplates[0].IsUnlocked = true;

        var row = Row(Catalogue(), 0);

        Assert.Equal("prof-capsule", row["id"]);
        Assert.Equal("Capsule proficiency", row["name"]);
        Assert.Equal("Learn the capsule", row["description"]);
        Assert.Equal("Proficiency", row["type"]);
        Assert.Equal("capsule", row["target"]);
        Assert.Equal(86400.0, row["baseTime"]);
        Assert.Equal(2, row["seatMin"]);
        Assert.Equal(4, row["seatMax"]);
        Assert.Equal(true, row["unlocked"]);
        Assert.Equal(false, row["isTemporary"]);
    }

    /// <summary>
    /// RP-1 stores -1 for "no seat maximum", and it goes on the wire as it stands.
    /// Folding it into a zero or an absence would leave a client unable to tell
    /// unlimited from unreadable, and the seat bounds are what decide which control
    /// an operator is offered.
    /// </summary>
    [Fact]
    public void Carries_RP1s_own_minus_one_for_a_training_with_no_seat_maximum()
    {
        var handler = Career();
        handler.TrainingTemplates.Add(Template(seatMax: -1));

        Assert.Equal(-1, Row(Catalogue(), 0)["seatMax"]);
    }

    /// <summary>
    /// The second read inside the window returns nothing at all, and that is not
    /// the same as reporting an empty catalogue: the channel retains what it last
    /// said. A publish on the null would blank a client's list every other tick.
    /// </summary>
    [Fact]
    public void Says_no_news_rather_than_no_catalogue_while_the_last_reading_stands()
    {
        var handler = Career();
        handler.TrainingTemplates.Add(Template());
        var reader = new Rp1TrainingCatalogueReflection();

        Assert.NotNull(reader.Read(ut: 100.0));
        Assert.Null(reader.Read(ut: 101.0));
    }

    /// <summary>
    /// A scene with no live handler is re-asked on the very next tick rather than
    /// held behind the throttle. The window is there because the ANSWER is slow to
    /// change; "which save is loaded" is not, and it changes the moment one loads.
    /// </summary>
    [Fact]
    public void Re_asks_immediately_after_a_reading_it_could_not_take()
    {
        var reader = new Rp1TrainingCatalogueReflection();
        Assert.Null(reader.Read(ut: 100.0)?.Templates);

        var handler = Career();
        handler.TrainingTemplates.Add(Template());

        Assert.Single(reader.Read(ut: 101.0)!.Templates!);
    }

    // ── Enrolling ───────────────────────────────────────────────────────────

    [Fact]
    public void Enrols_a_crew_by_starting_a_course_and_putting_it_on_the_roster()
    {
        var bob = new ProtoCrewMember("Bob");
        var handler = Career(bob);
        handler.TrainingTemplates.Add(Template(time: 100.0));

        var result = new Rp1TrainingCommands().Enrol(
            new Rp1TrainingEnrolArgs { TemplateId = "prof-capsule", Crew = new List<string> { "Bob" } });

        Assert.True(result.Success);
        var course = Assert.Single(handler.TrainingCourses);
        Assert.True(course.Started);
        Assert.Equal(new[] { bob }, course.Students);
        // 120% of the base time, RP-1's own multiplier, which is why the date a
        // kerbal can fly again outlasts the course.
        Assert.True(bob.inactive);
        Assert.Equal(120.0, bob.inactiveTimeEnd);
        Assert.Equal(1, MaintenanceHandler.Instance!.UpkeepUpdatesScheduled);
    }

    /// <summary>
    /// RP-1 declares <c>AddStudent(string)</c> beside the one this reaches, and
    /// that overload indexes the roster itself and adds the NULL it gets back for
    /// a name nobody holds. Taking it would enrol nobody and report success.
    /// </summary>
    [Fact]
    public void Never_reaches_the_string_overload_that_would_enrol_a_null()
    {
        var handler = Career(new ProtoCrewMember("Bob"));
        handler.TrainingTemplates.Add(Template());

        new Rp1TrainingCommands().Enrol(
            new Rp1TrainingEnrolArgs { TemplateId = "prof-capsule", Crew = new List<string> { "Bob" } });

        Assert.Empty(TrainingCourse.AddedByName);
    }

    [Fact]
    public void Refuses_a_kerbal_the_roster_does_not_hold_and_names_them()
    {
        var handler = Career(new ProtoCrewMember("Bob"));
        handler.TrainingTemplates.Add(Template());

        var result = new Rp1TrainingCommands().Enrol(
            new Rp1TrainingEnrolArgs { TemplateId = "prof-capsule", Crew = new List<string> { "Jeb" } });

        Assert.False(result.Success);
        Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
        Assert.Contains("Jeb", result.Detail);
        Assert.Empty(handler.TrainingCourses);
    }

    /// <summary>
    /// The refusal RP-1's own <c>AddStudent</c> would not give: it checks nothing
    /// but a seat maximum and a duplicate, so a grounded kerbal would be enrolled
    /// silently. The whole command refuses rather than the one kerbal being
    /// dropped, because a course quietly starting a seat short is the failure an
    /// operator cannot see.
    /// </summary>
    [Fact]
    public void Refuses_the_whole_enrolment_when_RP1_will_not_take_one_of_the_crew()
    {
        var bob = new ProtoCrewMember("Bob");
        var jeb = new ProtoCrewMember("Jeb") { inactive = true };
        var handler = Career(bob, jeb);
        handler.TrainingTemplates.Add(Template(seatMin: 2, seatMax: 2));

        var result = new Rp1TrainingCommands().Enrol(
            new Rp1TrainingEnrolArgs { TemplateId = "prof-capsule", Crew = new List<string> { "Bob", "Jeb" } });

        Assert.False(result.Success);
        Assert.Contains("Jeb", result.Detail);
        Assert.Empty(handler.TrainingCourses);
        Assert.False(bob.inactive);
    }

    /// <summary>
    /// The gate RP-1 applies in its UI and NOT in <c>StartCourse</c>, so declining
    /// to ask it would quietly start a course RP-1's own screen refuses to create.
    /// The refusal states the tier the way RP-1 does, one above the index.
    /// </summary>
    [Fact]
    public void Refuses_a_training_the_astronaut_complex_is_too_small_for()
    {
        var handler = Career(new ProtoCrewMember("Bob"));
        handler.TrainingTemplates.Add(Template(acLevel: 2));
        KCTUtilities.FacilityLevels[SpaceCenterFacility.AstronautComplex] = 1;

        var result = new Rp1TrainingCommands().Enrol(
            new Rp1TrainingEnrolArgs { TemplateId = "prof-capsule", Crew = new List<string> { "Bob" } });

        Assert.False(result.Success);
        Assert.Contains("level 3", result.Detail);
        Assert.Empty(handler.TrainingCourses);
    }

    [Fact]
    public void Refuses_a_crew_too_small_for_the_training_and_says_the_minimum()
    {
        var handler = Career(new ProtoCrewMember("Bob"));
        handler.TrainingTemplates.Add(Template(seatMin: 3));

        var result = new Rp1TrainingCommands().Enrol(
            new Rp1TrainingEnrolArgs { TemplateId = "prof-capsule", Crew = new List<string> { "Bob" } });

        Assert.False(result.Success);
        Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
        Assert.Contains("needs 3 students", result.Detail);
    }

    /// <summary>
    /// Over the maximum, RP-1 refuses by SILENTLY not adding, and the gate that
    /// fires first is the student check, whose answer is about the kerbal. Asking
    /// the bound first is what makes the refusal say "this training seats two".
    /// </summary>
    [Fact]
    public void Refuses_a_crew_too_large_for_the_training_and_says_the_maximum()
    {
        var handler = Career(
            new ProtoCrewMember("Bob"), new ProtoCrewMember("Jeb"), new ProtoCrewMember("Val"));
        handler.TrainingTemplates.Add(Template(seatMax: 2));

        var result = new Rp1TrainingCommands().Enrol(new Rp1TrainingEnrolArgs
        {
            TemplateId = "prof-capsule",
            Crew = new List<string> { "Bob", "Jeb", "Val" },
        });

        Assert.False(result.Success);
        Assert.Contains("seats 2", result.Detail);
        Assert.Empty(handler.TrainingCourses);
    }

    [Fact]
    public void Refuses_a_training_id_RP1_does_not_hold()
    {
        Career(new ProtoCrewMember("Bob"));

        var result = new Rp1TrainingCommands().Enrol(
            new Rp1TrainingEnrolArgs { TemplateId = "nope", Crew = new List<string> { "Bob" } });

        Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
    }

    // ── Cancel: the whole course ────────────────────────────────────────────

    /// <summary>
    /// RP-1's Cancel, and the assertion that matters is <c>Rewarded</c>: cancelling
    /// must run CompleteCourse's UN-GROUNDING and not its reward block, which is
    /// precisely what RP-1's confirmation warns about.
    /// </summary>
    [Fact]
    public void Cancelling_takes_the_whole_course_off_and_grants_nothing()
    {
        var bob = new ProtoCrewMember("Bob");
        var jeb = new ProtoCrewMember("Jeb");
        var handler = Career(bob, jeb);
        handler.TrainingTemplates.Add(Template(seatMin: 2, seatMax: 2));
        Enrol("Bob", "Jeb");

        var result = new Rp1TrainingCommands().Cancel(new Rp1TrainingLeaveArgs { CrewName = "Jeb" });

        Assert.True(result.Success);
        Assert.Empty(handler.TrainingCourses);
        Assert.False(bob.inactive);
        Assert.False(jeb.inactive);
        Assert.Equal(0, TrainingCourse.Rewarded);
        Assert.Equal(2, MaintenanceHandler.Instance!.UpkeepUpdatesScheduled);
    }

    /// <summary>
    /// The guard RP-1's own screen does not need, because a command can arrive at
    /// any moment: CompleteCourse on an already-completed course runs the reward
    /// path a second time and, in the game, spawns a dialog nobody opened. It is
    /// the course WALK that refuses, which is what makes the property structural
    /// rather than a check that could be skipped down some other path.
    /// </summary>
    [Fact]
    public void Refuses_a_course_that_has_already_finished_rather_than_rewarding_it_twice()
    {
        var bob = new ProtoCrewMember("Bob");
        var handler = Career(bob);
        handler.TrainingTemplates.Add(Template());
        Enrol("Bob");
        handler.TrainingCourses[0].Completed = true;

        var result = new Rp1TrainingCommands().Cancel(new Rp1TrainingLeaveArgs { CrewName = "Bob" });

        Assert.False(result.Success);
        Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
        Assert.Equal(0, TrainingCourse.Rewarded);
        Assert.Single(handler.TrainingCourses);
    }

    /// <summary>
    /// The other half of skipping a completed course, and the reason it is a walk
    /// rather than a guard: CompleteCourse leaves the student list in place, so a
    /// kerbal who finished one training and started another is on two of them. The
    /// live one has to be the one a cancel reaches.
    /// </summary>
    [Fact]
    public void Reaches_the_live_course_when_a_finished_one_still_lists_the_kerbal()
    {
        var bob = new ProtoCrewMember("Bob");
        var handler = Career(bob);
        handler.TrainingTemplates.Add(Template());
        Enrol("Bob");
        // RP-1's own completion, both halves: the flag and the call it makes,
        // which is what un-grounds the kerbal and leaves the student list standing.
        var finished = handler.TrainingCourses[0];
        finished.Completed = true;
        finished.CompleteCourse();
        Enrol("Bob");
        var live = handler.TrainingCourses[1];

        Assert.True(new Rp1TrainingCommands().Cancel(new Rp1TrainingLeaveArgs { CrewName = "Bob" }).Success);

        Assert.Equal(new[] { finished }, handler.TrainingCourses);
        Assert.DoesNotContain(live, handler.TrainingCourses);
    }

    [Fact]
    public void Refuses_to_cancel_for_a_kerbal_who_is_not_training()
    {
        Career(new ProtoCrewMember("Bob"));

        var result = new Rp1TrainingCommands().Cancel(new Rp1TrainingLeaveArgs { CrewName = "Bob" });

        Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
        Assert.Contains("Bob", result.Detail);
    }

    // ── Remove: one student ─────────────────────────────────────────────────

    [Fact]
    public void Removing_takes_one_student_off_and_leaves_the_course_running()
    {
        var bob = new ProtoCrewMember("Bob");
        var jeb = new ProtoCrewMember("Jeb");
        var handler = Career(bob, jeb);
        handler.TrainingTemplates.Add(Template(seatMin: 1, seatMax: 2));
        Enrol("Bob", "Jeb");

        var result = new Rp1TrainingCommands().Remove(new Rp1TrainingLeaveArgs { CrewName = "Jeb" });

        Assert.True(result.Success);
        var course = Assert.Single(handler.TrainingCourses);
        Assert.Equal(new[] { bob }, course.Students);
        Assert.False(jeb.inactive);
        Assert.True(bob.inactive);
    }

    /// <summary>
    /// RP-1 drops a course its last student just left, and this is the one place
    /// RemoveStudent reaches CompleteCourse itself. It runs with the completed flag
    /// still false, so it grants nothing here either.
    /// </summary>
    [Fact]
    public void Dropping_the_last_student_takes_the_course_off_the_roster_too()
    {
        var bob = new ProtoCrewMember("Bob");
        var handler = Career(bob);
        handler.TrainingTemplates.Add(Template());
        Enrol("Bob");

        Assert.True(new Rp1TrainingCommands().Remove(new Rp1TrainingLeaveArgs { CrewName = "Bob" }).Success);

        Assert.Empty(handler.TrainingCourses);
        Assert.False(bob.inactive);
        Assert.Equal(0, TrainingCourse.Rewarded);
    }

    /// <summary>
    /// RP-1 expresses this refusal by not drawing the button: above the seat
    /// minimum the only control is Cancel, because taking one student out leaves
    /// the rest in a course that can no longer legally run. A command surface has
    /// to say it in words.
    /// </summary>
    [Fact]
    public void Refuses_to_strand_the_rest_of_a_course_that_needs_more_than_one_seat()
    {
        var bob = new ProtoCrewMember("Bob");
        var jeb = new ProtoCrewMember("Jeb");
        var handler = Career(bob, jeb);
        handler.TrainingTemplates.Add(Template(seatMin: 2, seatMax: 2));
        Enrol("Bob", "Jeb");

        var result = new Rp1TrainingCommands().Remove(new Rp1TrainingLeaveArgs { CrewName = "Jeb" });

        Assert.False(result.Success);
        Assert.Equal(CommandErrorCode.WrongState, result.ErrorCode);
        Assert.Contains("Cancel the whole course", result.Detail);
        Assert.Equal(2, handler.TrainingCourses[0].Students.Count);
        Assert.True(jeb.inactive);
    }

    /// <summary>
    /// The same overload hazard as the enrolment's: RemoveStudent(string) indexes
    /// the roster itself, and a lookup by arity alone could take it.
    /// </summary>
    [Fact]
    public void Never_reaches_the_string_overload_when_removing()
    {
        var handler = Career(new ProtoCrewMember("Bob"));
        handler.TrainingTemplates.Add(Template());
        Enrol("Bob");

        new Rp1TrainingCommands().Remove(new Rp1TrainingLeaveArgs { CrewName = "Bob" });

        Assert.Empty(TrainingCourse.RemovedByName);
    }

    // ── The two commands' shared refusals ───────────────────────────────────

    [Fact]
    public void Both_leave_commands_refuse_without_a_kerbal_named()
    {
        Career();
        var commands = new Rp1TrainingCommands();

        Assert.Equal(CommandErrorCode.Range, commands.Cancel(new Rp1TrainingLeaveArgs()).ErrorCode);
        Assert.Equal(CommandErrorCode.Range, commands.Remove(new Rp1TrainingLeaveArgs()).ErrorCode);
    }

    [Fact]
    public void Every_command_refuses_when_RP1_is_not_managing_the_save()
    {
        var commands = new Rp1TrainingCommands();

        Assert.Equal(
            CommandErrorCode.ModeUnavailable,
            commands.Enrol(new Rp1TrainingEnrolArgs { TemplateId = "x", Crew = new List<string> { "Bob" } }).ErrorCode);
        Assert.Equal(
            CommandErrorCode.ModeUnavailable,
            commands.Cancel(new Rp1TrainingLeaveArgs { CrewName = "Bob" }).ErrorCode);
        Assert.Equal(
            CommandErrorCode.ModeUnavailable,
            commands.Remove(new Rp1TrainingLeaveArgs { CrewName = "Bob" }).ErrorCode);
    }

    private static void Enrol(params string[] crew)
    {
        var result = new Rp1TrainingCommands().Enrol(
            new Rp1TrainingEnrolArgs { TemplateId = "prof-capsule", Crew = crew.ToList() });
        Assert.True(result.Success, result.Detail);
    }
}
