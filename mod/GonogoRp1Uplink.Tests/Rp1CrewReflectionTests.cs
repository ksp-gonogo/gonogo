using System.Collections.Generic;
using System.Linq;
using GonogoRp1Uplink;
using RP0.Crew;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Xunit;

/// <summary>
/// The crew walk against RP-1's own member names, and the sentinels it refuses to
/// pass on.
///
/// <para>Read <see cref="CrewFixture"/>'s header for what a fixture-backed
/// reflection test can and cannot prove. The short of it: these pin that the walk
/// reads the members it claims to, at the accessibilities RP-1 declares them at,
/// and that RP-1's three "no record" sentinels (0.0 from a failed TryGetValue on
/// either retirement dictionary, -1.0 from an unrated build rate) become ABSENT
/// rather than dates and rates.</para>
/// </summary>
[Collection("rp0-static-graph")]
public class Rp1CrewReflectionTests : System.IDisposable
{
    public Rp1CrewReflectionTests() => CrewHandler.Instance = null;

    public void Dispose() => CrewHandler.Instance = null;

    /// <summary>
    /// No handler is the main menu and any save RP-1 does not manage. Nothing is
    /// published there, because an empty crew list would say "RP-1 is scheduling
    /// nobody" about a game not running RP-1's rules at all.
    /// </summary>
    [Fact]
    public void ReadsNothingWhenTheHandlerIsNotLive()
    {
        Assert.Null(new Rp1CrewReflection().Read(1000.0));
        Assert.Null(Rp1CrewCapture.BuildCrew(null));
        Assert.Null(Rp1CrewCapture.BuildProgram(null));
    }

    /// <summary>The type resolves off the fixture, which is what every other case here depends on.</summary>
    [Fact]
    public void ResolvesRp1sCrewHandlerType()
    {
        Assert.True(new Rp1CrewReflection().IsAvailable);
    }

    [Fact]
    public void ReadsARetirementDateAndItsCeiling()
    {
        CrewHandler.Instance = new CrewHandler().Retires("Jebediah Kerman", atUt: 100_000.0, increaseUsed: 40_000.0);

        var row = Single(new Rp1CrewReflection().Read(1000.0));

        Assert.Equal("Jebediah Kerman", row.Name);
        Assert.Equal(100_000.0, row.RetiresAtUt);
        Assert.Equal(40_000.0, row.RetirementExtensionUsedSeconds);
        // 473040000 cap, 40000 spent, so the date can still move by the rest.
        Assert.Equal(100_000.0 + (473_040_000.0 - 40_000.0), row.LatestRetiresAtUt);
        Assert.False(row.Retired);
    }

    /// <summary>
    /// THE sentinel that matters most on this channel. RP-1's GetRetireTime is a
    /// TryGetValue that returns 0.0 on a miss, so a kerbal RP-1 holds no
    /// retirement date for is indistinguishable from one retiring at UT zero if
    /// the getter is trusted. A kerbal whose retirement date is unknown is not a
    /// kerbal retiring today.
    /// </summary>
    [Fact]
    public void ARetirementDateOfZeroIsNoRecordRatherThanADateOfZero()
    {
        CrewHandler.Instance = new CrewHandler().Retires("Bill Kerman", atUt: 0.0).Expires("Bill Kerman", "Mun", 5_000.0);

        var row = Single(new Rp1CrewReflection().Read(1000.0));

        Assert.Null(row.RetiresAtUt);
        Assert.Null(row.LatestRetiresAtUt);
        // And no extension figure either: zero spent against a cap that does not
        // apply would read as a kerbal who has earned nothing, which is a claim.
        Assert.Null(row.RetirementExtensionUsedSeconds);
    }

    /// <summary>
    /// Zero extension EARNED is a truthful reading and stays zero: a kerbal who
    /// has flown nothing interesting has pushed their date back by nothing. Only
    /// the absence of a retirement record at all makes it absent.
    /// </summary>
    [Fact]
    public void ZeroExtensionEarnedIsAReadingRatherThanAnAbsence()
    {
        CrewHandler.Instance = new CrewHandler().Retires("Bob Kerman", atUt: 90_000.0);

        var row = Single(new Rp1CrewReflection().Read(1000.0));

        Assert.Equal(0.0, row.RetirementExtensionUsedSeconds);
        Assert.Equal(90_000.0 + 473_040_000.0, row.LatestRetiresAtUt);
    }

    [Fact]
    public void ReadsARunningCourseThroughItsPrivateProgressAndProtectedRate()
    {
        var template = new TrainingTemplate
        {
            id = "TRAINING_mission-Mun",
            type = TrainingTemplate.TrainingType.Mission,
            training = new TrainingFlightEntry { type = "TRAINING_mission", target = "Mun" },
        };
        CrewHandler.Instance = new CrewHandler
        {
            TrainingCourses =
            {
                new TrainingCourse { id = "course-1", Started = true, Students = { new ProtoCrewMember("Valentina Kerman") } }
                    .FromTemplate(template)
                    .Costed(progress: 25.0, totalPoints: 100.0, buildRate: 0.5),
            },
        };

        var row = Single(new Rp1CrewReflection().Read(1000.0));

        Assert.Equal("course-1", row.TrainingCourse);
        Assert.Equal("Mission", row.TrainingType);
        Assert.Equal("Mun", row.TrainingTarget);
        Assert.Equal(true, row.TrainingStarted);
        Assert.Equal(0.25, row.TrainingFractionComplete);
        // 75 points left at 0.5/s is 150s from now.
        Assert.Equal(1150.0, row.TrainingFinishesAtUt);
    }

    /// <summary>
    /// RP-1 leaves <c>_buildRate</c> at -1 until a tick advances the course, and
    /// its own GetTimeLeft would divide by whatever CalculateBuildRate then
    /// returns, firing a GameEvents modifier query in the process. Read
    /// read-only, an unrated course has no finish date, which is the truth: an
    /// infinity is not a date and a zero is not a finish.
    /// </summary>
    [Fact]
    public void AnUnratedCourseHasNoFinishDateRatherThanAnInfiniteOne()
    {
        CrewHandler.Instance = new CrewHandler
        {
            TrainingCourses =
            {
                new TrainingCourse { id = "course-1", Started = true, Students = { new ProtoCrewMember("Val Kerman") } }
                    .Costed(progress: 0.0, totalPoints: 100.0, buildRate: -1.0),
            },
        };

        var row = Single(new Rp1CrewReflection().Read(1000.0));

        Assert.Null(row.TrainingFinishesAtUt);
        // The progress is still knowable, and still zero, which is a reading.
        Assert.Equal(0.0, row.TrainingFractionComplete);
    }

    /// <summary>
    /// An enrolled-but-unstarted course makes no progress. A finish date for it
    /// would be a promise nothing is keeping, and an operator who reads enrolment
    /// as progress will plan a mission around a crew that is not being trained.
    /// </summary>
    [Fact]
    public void AnUnstartedCourseHasNoFinishDateEvenWithARate()
    {
        CrewHandler.Instance = new CrewHandler
        {
            TrainingCourses =
            {
                new TrainingCourse { id = "course-1", Started = false, Students = { new ProtoCrewMember("Val Kerman") } }
                    .Costed(progress: 0.0, totalPoints: 100.0, buildRate: 1.0),
            },
        };

        var row = Single(new Rp1CrewReflection().Read(1000.0));

        Assert.Equal(false, row.TrainingStarted);
        Assert.Null(row.TrainingFinishesAtUt);
    }

    /// <summary>A completed course is not a course anybody is on, and does not hold a kerbal in training.</summary>
    [Fact]
    public void ACompletedCourseIsNotTraining()
    {
        CrewHandler.Instance = new CrewHandler
        {
            TrainingCourses =
            {
                new TrainingCourse { id = "done", Started = true, Completed = true, Students = { new ProtoCrewMember("Val Kerman") } }
                    .Costed(progress: 100.0, totalPoints: 100.0, buildRate: 1.0),
            },
        };

        var raw = new Rp1CrewReflection().Read(1000.0);

        Assert.NotNull(raw);
        Assert.Empty(raw!.Crew);
        Assert.Equal(0, raw.Program!.Courses);
        Assert.Equal(0, raw.Program.CrewInTraining);
    }

    /// <summary>
    /// The SOONEST lapse, plus a count, because that is the one an operator acts
    /// on: mission training expiring is what turns a qualified crew into an
    /// unqualified one while the vehicle is still being integrated.
    /// </summary>
    [Fact]
    public void FoldsPerishableTrainingToTheSoonestLapseAndACount()
    {
        CrewHandler.Instance = new CrewHandler()
            .Expires("Valentina Kerman", "Mun", atUt: 900_000.0)
            .Expires("Valentina Kerman", "Minmus", atUt: 300_000.0)
            .Expires("Valentina Kerman", "Duna", atUt: 700_000.0);

        var row = Single(new Rp1CrewReflection().Read(1000.0));

        Assert.Equal(3, row.TrainingExpiryCount);
        Assert.Equal(300_000.0, row.NextTrainingExpiryUt);
        Assert.Equal("Minmus", row.NextTrainingExpiryTarget);
    }

    /// <summary>
    /// The rules the dates run under. Without them a retirement date on a save
    /// with retirement switched off is a date nothing will act on, and a training
    /// ETA is a function of a rate visible nowhere else.
    /// </summary>
    [Fact]
    public void ReadsTheCareerWideRules()
    {
        CrewHandler.Instance = new CrewHandler
        {
            RetirementEnabled = false,
            CrewRnREnabled = true,
            IsMissionTrainingEnabled = true,
            ProfTrainRate = 1.5,
            MissionTrainRate = 0.75,
            TrainingCourses =
            {
                new TrainingCourse { id = "a", Started = true, Students = { new ProtoCrewMember("A Kerman") } },
                new TrainingCourse { id = "b", Started = false, Students = { new ProtoCrewMember("B Kerman"), new ProtoCrewMember("C Kerman") } },
            },
        };

        var program = new Rp1CrewReflection().Read(1000.0)!.Program;

        Assert.NotNull(program);
        Assert.Equal(false, program!.RetirementEnabled);
        Assert.Equal(true, program.CrewRnREnabled);
        Assert.Equal(true, program.MissionTrainingEnabled);
        Assert.Equal(1.5, program.ProficiencyTrainingRate);
        Assert.Equal(0.75, program.MissionTrainingRate);
        Assert.Equal(473_040_000.0, program.RetirementExtensionCapSeconds);
        Assert.Equal(2, program.Courses);
        Assert.Equal(1, program.CoursesStarted);
        // Three kerbals across two courses, counted per kerbal rather than per seat.
        Assert.Equal(3, program.CrewInTraining);
    }

    /// <summary>
    /// A row appears for every kerbal RP-1 has ANY record of, and the order is
    /// stable: a channel whose change-gate compares payloads must not report a
    /// change because a dictionary walk came back in a different order.
    /// </summary>
    [Fact]
    public void CarriesEveryNameRp1KnowsInAStableOrder()
    {
        CrewHandler.Instance = new CrewHandler()
            .Retires("Zeb Kerman", 10.0)
            .Retired("Adley Kerman")
            .Expires("Mun Kerman", "Mun", 20.0);

        var names = new Rp1CrewReflection().Read(1000.0)!.Crew.Select(c => c.Name).ToArray();

        Assert.Equal(new[] { "Adley Kerman", "Mun Kerman", "Zeb Kerman" }, names);
    }

    // ── The retiree read the crew-standing backend depends on ──────────────

    [Fact]
    public void IsRetiredAnswersOffRp1sOwnSet()
    {
        CrewHandler.Instance = new CrewHandler().Retired("Wernher Kerman");
        var crew = new Rp1CrewReflection();

        Assert.True(crew.IsRetired("Wernher Kerman"));
        Assert.False(crew.IsRetired("Jebediah Kerman"));
    }

    /// <summary>
    /// The fast path is an <c>ICollection&lt;string&gt;</c> probe, which RP-1's own
    /// persistence type satisfies today by deriving from <c>HashSet&lt;string&gt;</c>.
    /// The day it stops, the fallback is the difference between a retiree reading
    /// as retired and a retiree reading as killed, so it is exercised.
    /// </summary>
    [Fact]
    public void IsRetiredStillAnswersWhenTheSetIsOnlyEnumerable()
    {
        CrewHandler.Instance = new CrewHandler().Retired("Wernher Kerman").RetireesAsBareEnumerable();
        var crew = new Rp1CrewReflection();

        Assert.True(crew.IsRetired("Wernher Kerman"));
        Assert.False(crew.IsRetired("Jebediah Kerman"));
    }

    /// <summary>
    /// No handler means no retirees, and that is not a guess: a save RP-1 does not
    /// manage has no retirees by construction. It is also the case that decides
    /// whether a STOCK install is affected by any of this, so it is asserted
    /// rather than assumed.
    /// </summary>
    [Fact]
    public void IsRetiredIsFalseWithNoHandlerLive()
    {
        Assert.False(new Rp1CrewReflection().IsRetired("Wernher Kerman"));
        Assert.False(new Rp1CrewReflection().IsRetired(""));
    }

    // ── The backend the capability elects ──────────────────────────────────

    /// <summary>
    /// The whole defect, end to end on this side: RP-1 wrote stock's Dead into the
    /// roster status, and the backend hands back Retired for that name and NOTHING
    /// for anybody else, leaving core's map to answer for the rest of the roster.
    /// </summary>
    [Fact]
    public void TheBackendCorrectsARetireeAndDeclinesForEveryoneElse()
    {
        CrewHandler.Instance = new CrewHandler().Retired("Wernher Kerman");
        var backend = new Rp1CrewStandingBackend(new Rp1CrewReflection());

        var retiree = backend.Read(CrewStandingQueries.Crew("Wernher Kerman", KspRosterStatus.Dead));
        Assert.NotNull(retiree);
        Assert.Equal(CrewStanding.Retired, retiree!.Standing);

        Assert.Null(backend.Read(CrewStandingQueries.Crew("Jebediah Kerman", KspRosterStatus.Available)));
        Assert.Null(backend.Read(CrewStandingQueries.Applicant("")));
        Assert.Equal("rp1", backend.ProviderId);
    }

    /// <summary>
    /// A genuine fatality on an RP-1 save is still a fatality. The correction is
    /// keyed on RP-1's retiree set and nothing else, so a kerbal who really died
    /// is not quietly retired: that would be worse than the bug it fixes.
    /// </summary>
    [Fact]
    public void TheBackendLeavesARealFatalityAlone()
    {
        CrewHandler.Instance = new CrewHandler().Retired("Wernher Kerman").Retires("Jebediah Kerman", 100.0);
        var backend = new Rp1CrewStandingBackend(new Rp1CrewReflection());

        Assert.Null(backend.Read(CrewStandingQueries.Crew("Jebediah Kerman", KspRosterStatus.Dead)));
    }

    /// <summary>
    /// A kerbal on a STARTED course is <see cref="CrewStanding.Training"/>, dated
    /// by the course's own ETA, and carries their retirement date beside it.
    /// </summary>
    /// <remarks>
    /// The defect this fixes is the retiree's, one axis over. KSP's roster status
    /// for a kerbal mid-course is <c>Available</c>, so without this the trainee
    /// reached the wire free to fly and a widget would have offered them for a
    /// mission RP-1 will refuse to crew.
    ///
    /// <para>Both dates, because both are live: the course ends long before the
    /// career does.</para>
    /// </remarks>
    [Fact]
    public void TheBackendMakesAStartedCourseAStandingWithItsOwnEta()
    {
        CrewHandler.Instance = new CrewHandler { TrainingCourses = { StartedCourse("Valentina Kerman") } }
            .Retires("Valentina Kerman", 500_000.0);
        var backend = new Rp1CrewStandingBackend(new Rp1CrewReflection());

        var reading = backend.Read(CrewStandingQueries.Crew(
            "Valentina Kerman", KspRosterStatus.Available, ut: 1000.0));

        Assert.NotNull(reading);
        Assert.Equal(CrewStanding.Training, reading!.Standing);
        // 75 points left at 0.5/s is 150s from now.
        Assert.Equal(1150.0, reading.StandingEndsAtUt);
        Assert.Equal(500_000.0, reading.RetiresAtUt);
    }

    /// <summary>
    /// Enrolment is not training. A course RP-1 has not STARTED makes no progress
    /// and has no finish date, so the kerbal keeps whatever standing stock gives
    /// them and this backend adds only the retirement date.
    /// </summary>
    /// <remarks>
    /// Reporting an unstarted enrolment as a standing would tell an operator a
    /// crew is being trained when it is queued behind something, and would date
    /// it with nothing.
    /// </remarks>
    [Fact]
    public void TheBackendDoesNotCallAnEnrolmentTraining()
    {
        var queued = StartedCourse("Valentina Kerman");
        queued.Started = false;
        CrewHandler.Instance = new CrewHandler { TrainingCourses = { queued } }
            .Retires("Valentina Kerman", 500_000.0);
        var backend = new Rp1CrewStandingBackend(new Rp1CrewReflection());

        var reading = backend.Read(CrewStandingQueries.Crew("Valentina Kerman", KspRosterStatus.Available));

        Assert.NotNull(reading);
        Assert.Null(reading!.Standing);
        Assert.Null(reading.StandingEndsAtUt);
        Assert.Equal(500_000.0, reading.RetiresAtUt);
    }

    /// <summary>
    /// Retirement outranks a course. RP-1 can hold both for one name, and a course
    /// a retiree is enrolled on is a course nobody will finish.
    /// </summary>
    [Fact]
    public void ARetirementOutranksACourseAndCarriesNoScheduleOfItsOwn()
    {
        CrewHandler.Instance = new CrewHandler { TrainingCourses = { StartedCourse("Wernher Kerman") } }
            .Retired("Wernher Kerman")
            .Retires("Wernher Kerman", 500_000.0);
        var backend = new Rp1CrewStandingBackend(new Rp1CrewReflection());

        var reading = backend.Read(CrewStandingQueries.Crew("Wernher Kerman", KspRosterStatus.Dead));

        Assert.NotNull(reading);
        Assert.Equal(CrewStanding.Retired, reading!.Standing);
        Assert.Null(reading.StandingEndsAtUt);
        // The date has passed. Quoting it reads as one still to come.
        Assert.Null(reading.RetiresAtUt);
    }

    /// <summary>
    /// A genuine casualty gets no schedule. RP-1 keeps a dead kerbal's row in its
    /// retirement dictionary, so without this the backend would date the
    /// retirement of a career that ended in an explosion.
    /// </summary>
    [Fact]
    public void TheBackendDatesNoRetirementForAKerbalWhoIsAlreadyOffTheBooks()
    {
        CrewHandler.Instance = new CrewHandler().Retires("Jebediah Kerman", 500_000.0);
        var backend = new Rp1CrewStandingBackend(new Rp1CrewReflection());

        Assert.Null(backend.Read(CrewStandingQueries.Crew("Jebediah Kerman", KspRosterStatus.Dead)));
        Assert.Null(backend.Read(CrewStandingQueries.Crew("Jebediah Kerman", KspRosterStatus.Missing)));
    }

    /// <summary>
    /// R&amp;R is NOT this backend's answer. RP-1's post-flight rest sets KSP's own
    /// <c>ProtoCrewMember.inactive</c>, which core reads into
    /// <see cref="CrewStanding.Resting"/>, so this backend declines the standing
    /// and contributes only the date it owns.
    /// </summary>
    /// <remarks>
    /// Correcting it here would be a second derivation of a value core already
    /// has, which is the mistake the whole capability exists to undo.
    /// </remarks>
    [Fact]
    public void TheBackendLeavesAStandDownToCore()
    {
        CrewHandler.Instance = new CrewHandler().Retires("Bill Kerman", 500_000.0);
        var backend = new Rp1CrewStandingBackend(new Rp1CrewReflection());

        var reading = backend.Read(CrewStandingQueries.Crew(
            "Bill Kerman", KspRosterStatus.Available, inactive: true, inactiveUntilUt: 8_000.0));

        Assert.NotNull(reading);
        Assert.Null(reading!.Standing);
        Assert.Equal(500_000.0, reading.RetiresAtUt);
    }

    /// <summary>One started, costed course with a single student, so the cases above name only the axis they are about.</summary>
    private static TrainingCourse StartedCourse(string student) =>
        new TrainingCourse
        {
            id = "course-1",
            Started = true,
            Students = { new ProtoCrewMember(student) },
        }.Costed(progress: 25.0, totalPoints: 100.0, buildRate: 0.5);

    /// <summary>
    /// With no handler live the backend declines for everybody, so a stock install
    /// reads exactly as it did before this class existed. The RP-1-must-stay-
    /// optional half of the change, asserted rather than argued.
    /// </summary>
    [Fact]
    public void TheBackendSaysNothingAtAllOnASaveRp1DoesNotManage()
    {
        var backend = new Rp1CrewStandingBackend(new Rp1CrewReflection());

        Assert.Null(backend.Read(CrewStandingQueries.Crew("Wernher Kerman", KspRosterStatus.Dead)));
        Assert.Null(backend.Read(CrewStandingQueries.Crew("Jebediah Kerman", KspRosterStatus.Available)));
    }

    private static Rp1CrewMemberRaw Single(Rp1CrewRaw? raw)
    {
        Assert.NotNull(raw);
        return Assert.Single<Rp1CrewMemberRaw>(raw!.Crew);
    }
}

/// <summary>
/// The pure arithmetic, without a fixture: the two RP-1 defects it exists to turn
/// into absences, and the cap edge.
/// </summary>
public class Rp1CrewMathTests
{
    [Fact]
    public void FractionCompleteIsAbsentOnAZeroPointCourseRatherThanNaN()
    {
        Assert.Null(Rp1CrewMath.FractionComplete(0.0, 0.0));
        Assert.Null(Rp1CrewMath.FractionComplete(10.0, 0.0));
        Assert.Null(Rp1CrewMath.FractionComplete(null, 100.0));
        Assert.Null(Rp1CrewMath.FractionComplete(10.0, null));
    }

    /// <summary>A course that overran its points is finished, not 103% done.</summary>
    [Fact]
    public void FractionCompleteClampsToTheUnitRange()
    {
        Assert.Equal(1.0, Rp1CrewMath.FractionComplete(103.0, 100.0));
        Assert.Equal(0.0, Rp1CrewMath.FractionComplete(-1.0, 100.0));
        Assert.Equal(0.5, Rp1CrewMath.FractionComplete(50.0, 100.0));
    }

    [Fact]
    public void FinishesAtUtIsAbsentAtEveryRateRp1CanLeaveBehind()
    {
        Assert.Null(Rp1CrewMath.FinishesAtUt(100.0, true, 0.0, 100.0, -1.0));
        Assert.Null(Rp1CrewMath.FinishesAtUt(100.0, true, 0.0, 100.0, 0.0));
        Assert.Null(Rp1CrewMath.FinishesAtUt(100.0, true, 0.0, 100.0, null));
    }

    /// <summary>A course already past its points finishes now rather than in the past.</summary>
    [Fact]
    public void FinishesAtUtIsNowForACourseAlreadyPastItsPoints()
    {
        Assert.Equal(100.0, Rp1CrewMath.FinishesAtUt(100.0, true, 120.0, 100.0, 1.0));
    }

    /// <summary>
    /// A kerbal whose extension cap is spent has a ceiling equal to their date.
    /// Stated rather than left absent, because "cannot be pushed further" is a
    /// planning fact and an absent ceiling reads as an unknown one.
    /// </summary>
    [Fact]
    public void ASpentExtensionCapMakesTheCeilingTheDateItself()
    {
        Assert.Equal(500.0, Rp1CrewMath.LatestRetiresAtUt(500.0, 1000.0, 1000.0));
        Assert.Equal(500.0, Rp1CrewMath.LatestRetiresAtUt(500.0, 2000.0, 1000.0));
    }

    /// <summary>
    /// An unreadable cap leaves the ceiling ABSENT rather than equal to the date:
    /// a ceiling nobody could read is not a ceiling at today's date.
    /// </summary>
    [Fact]
    public void AnUnreadableCapLeavesTheCeilingAbsent()
    {
        Assert.Null(Rp1CrewMath.LatestRetiresAtUt(500.0, 0.0, null));
        Assert.Null(Rp1CrewMath.LatestRetiresAtUt(null, 0.0, 1000.0));
    }
}

/// <summary>The wire keys, which are the contract this Uplink's client reads.</summary>
public class Rp1CrewCaptureTests
{
    [Fact]
    public void CarriesEveryDeclaredCrewKey()
    {
        var raw = new Rp1CrewRaw
        {
            Ut = 1000.0,
            Crew =
            {
                new Rp1CrewMemberRaw
                {
                    Name = "Wernher Kerman",
                    Retired = true,
                    RetiresAtUt = 900.0,
                    LatestRetiresAtUt = 1900.0,
                    RetirementExtensionUsedSeconds = 50.0,
                    TrainingCourse = "course-1",
                    TrainingType = "Mission",
                    TrainingTarget = "Mun",
                    TrainingStarted = true,
                    TrainingFractionComplete = 0.25,
                    TrainingFinishesAtUt = 1150.0,
                    NextTrainingExpiryUt = 5000.0,
                    NextTrainingExpiryTarget = "Minmus",
                    TrainingExpiryCount = 2,
                },
            },
        };

        var row = Assert.IsType<Dictionary<string, object?>>(Assert.Single(Rp1CrewCapture.BuildCrew(raw)!));

        Assert.Equal("Wernher Kerman", row["name"]);
        Assert.Equal(true, row["retired"]);
        Assert.Equal(900.0, row["retiresAtUt"]);
        Assert.Equal(1900.0, row["latestRetiresAtUt"]);
        Assert.Equal(50.0, row["retirementExtensionUsedSeconds"]);
        Assert.Equal("course-1", row["trainingCourse"]);
        Assert.Equal("Mission", row["trainingType"]);
        Assert.Equal("Mun", row["trainingTarget"]);
        Assert.Equal(true, row["trainingStarted"]);
        Assert.Equal(0.25, row["trainingFractionComplete"]);
        Assert.Equal(1150.0, row["trainingFinishesAtUt"]);
        Assert.Equal(5000.0, row["nextTrainingExpiryUt"]);
        Assert.Equal("Minmus", row["nextTrainingExpiryTarget"]);
        Assert.Equal(2, row["trainingExpiryCount"]);
    }

    [Fact]
    public void CarriesEveryDeclaredProgramKey()
    {
        var program = Rp1CrewCapture.BuildProgram(new Rp1CrewRaw
        {
            Program = new Rp1CrewProgramRaw
            {
                RetirementEnabled = true,
                CrewRnREnabled = false,
                MissionTrainingEnabled = true,
                ProficiencyTrainingRate = 1.5,
                MissionTrainingRate = 0.5,
                RetirementExtensionCapSeconds = 473_040_000.0,
                Courses = 3,
                CoursesStarted = 2,
                CrewInTraining = 4,
            },
        });

        Assert.NotNull(program);
        Assert.Equal(true, program!["retirementEnabled"]);
        Assert.Equal(false, program["crewRnREnabled"]);
        Assert.Equal(true, program["missionTrainingEnabled"]);
        Assert.Equal(1.5, program["proficiencyTrainingRate"]);
        Assert.Equal(0.5, program["missionTrainingRate"]);
        Assert.Equal(473_040_000.0, program["retirementExtensionCapSeconds"]);
        Assert.Equal(3, program["courses"]);
        Assert.Equal(2, program["coursesStarted"]);
        Assert.Equal(4, program["crewInTraining"]);
    }
}
