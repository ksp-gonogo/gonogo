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
}
