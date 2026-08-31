using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// One tick's reading of RP-1's crew bookkeeping, as plain self-contained
    /// data: no live RP-1 or KSP object anywhere in the graph, so the engine can
    /// carry it from the main thread to the Courier thread and the mapper that
    /// turns it into wire dicts is unit-testable with no game at all.
    /// </summary>
    /// <remarks>
    /// Same shape as <see cref="Rp1ScRaw"/> and for the same reason. Every
    /// derived date is computed here rather than in the mapper, because deriving
    /// it needs the tick's UT, which only the capture has.
    /// </remarks>
    public sealed class Rp1CrewRaw
    {
        public double Ut;

        public List<Rp1CrewMemberRaw> Crew = new List<Rp1CrewMemberRaw>();

        public Rp1CrewProgramRaw? Program;

        /// <summary>
        /// The courses RP-1 holds. Null when its crew handler is not live, which
        /// is a different answer from an empty roster of courses.
        /// </summary>
        public List<Rp1TrainingCourseRaw>? Courses;
    }

    /// <summary>One kerbal RP-1 has a record of.</summary>
    public sealed class Rp1CrewMemberRaw
    {
        public string? Name;
        public bool Retired;
        public double? RetiresAtUt;
        public double? LatestRetiresAtUt;
        public double? RetirementExtensionUsedSeconds;

        public string? TrainingCourse;
        public string? TrainingType;
        public string? TrainingTarget;
        public bool? TrainingStarted;
        public double? TrainingFractionComplete;
        public double? TrainingFinishesAtUt;

        public double? NextTrainingExpiryUt;
        public string? NextTrainingExpiryTarget;
        public int TrainingExpiryCount;
    }

    /// <summary>The career-wide rules the schedule runs under.</summary>
    /// <summary>
    /// One training course as RP-1 holds it. Course-level, beside the per-kerbal
    /// training fields: the seat bounds live here and decide which control an
    /// operator is offered, and a course with nobody on it has no kerbal row.
    /// </summary>
    public sealed class Rp1TrainingCourseRaw
    {
        public string? Id;
        public string? Name;
        public string? Description;
        public string? Type;
        public string? Target;
        public List<string> Students = new List<string>();
        public int? SeatMin;
        public int? SeatMax;
        public bool? Started;
        public bool? Completed;
        public double? CompletesAtUt;

        /// <summary>The last student's inactive window, which outlasts the course itself.</summary>
        public double? StudentsAvailableAtUt;

        public bool? IsTemporary;
    }

    public sealed class Rp1CrewProgramRaw
    {
        public bool? RetirementEnabled;
        public bool? CrewRnREnabled;
        public bool? MissionTrainingEnabled;
        public double? ProficiencyTrainingRate;
        public double? MissionTrainingRate;
        public double? RetirementExtensionCapSeconds;
        public int Courses;
        public int CoursesStarted;
        public int CrewInTraining;
    }

    /// <summary>
    /// One reading of RP-1's enrolable trainings. Its own raw rather than a field
    /// on <see cref="Rp1CrewRaw"/> because it is read on its own cadence: a null
    /// <see cref="Templates"/> is an install whose crew handler is not live, and
    /// the reader returns no raw at all when the previous reading still stands.
    /// </summary>
    public sealed class Rp1TrainingCatalogueRaw
    {
        public double Ut;

        public List<Rp1TrainingTemplateRaw>? Templates;
    }

    /// <summary>One training RP-1 could be asked to run, as RP-1 holds it.</summary>
    public sealed class Rp1TrainingTemplateRaw
    {
        public string? Id;
        public string? Name;
        public string? Description;
        public string? Type;
        public string? Target;
        public double? BaseTime;
        public int? SeatMin;
        public int? SeatMax;

        /// <summary>Absent, not false, when RP-1's own getter could not be asked.</summary>
        public bool? Unlocked;

        public bool? IsTemporary;
    }
}
