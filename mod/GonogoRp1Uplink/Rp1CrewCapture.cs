using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Pure mapper: one tick of captured RP-1 crew data to the dicts the wire
    /// carries. KSP-free, RP-1-free and side-effect-free, so it is unit-tested
    /// headless.
    /// </summary>
    /// <remarks>
    /// Same contract as <see cref="Rp1ScCapture"/>: the Topic payload types in
    /// <c>GonogoRp1Uplink.Contract</c> are typing and codegen markers, the
    /// serializer walks a live value tree, so the keys below are the wire and this
    /// file is what keeps them in step with the declared shapes.
    /// </remarks>
    public static class Rp1CrewCapture
    {
        /// <summary>
        /// The crew rows, or NOTHING. Null rather than an empty list when RP-1's
        /// crew handler is not live: an empty array says "RP-1 is scheduling
        /// nobody", which is a claim about the career, and the channel is declared
        /// <c>absenceIsData</c> so a client is told there is none rather than left
        /// waiting for a value that is not coming.
        /// </summary>
        public static List<object?>? BuildCrew(Rp1CrewRaw? raw)
        {
            if (raw == null)
            {
                return null;
            }

            var list = new List<object?>();
            foreach (var c in raw.Crew)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["name"] = c.Name,
                    ["retired"] = c.Retired,
                    ["retiresAtUt"] = c.RetiresAtUt,
                    ["latestRetiresAtUt"] = c.LatestRetiresAtUt,
                    ["retirementExtensionUsedSeconds"] = c.RetirementExtensionUsedSeconds,
                    ["trainingCourse"] = c.TrainingCourse,
                    ["trainingType"] = c.TrainingType,
                    ["trainingTarget"] = c.TrainingTarget,
                    ["trainingStarted"] = c.TrainingStarted,
                    ["trainingFractionComplete"] = c.TrainingFractionComplete,
                    ["trainingFinishesAtUt"] = c.TrainingFinishesAtUt,
                    ["nextTrainingExpiryUt"] = c.NextTrainingExpiryUt,
                    ["nextTrainingExpiryTarget"] = c.NextTrainingExpiryTarget,
                    ["trainingExpiryCount"] = c.TrainingExpiryCount,
                });
            }
            return list;
        }

        /// <summary>
        /// The career-wide rules, or nothing. Null on the same condition as
        /// <see cref="BuildCrew"/>: without RP-1's handler there are no rules to
        /// report, and a bag of falses would say retirement and R&amp;R are
        /// switched OFF on a save that has never been told either way.
        /// </summary>
        /// <summary>
        /// The live courses, course-level. Null when RP-1's crew handler is not
        /// live; an empty list is a real answer meaning the career holds no
        /// courses, which is different from not being able to see them.
        /// </summary>
        public static List<object?>? BuildTraining(Rp1CrewRaw? raw)
        {
            if (raw?.Courses == null)
            {
                return null;
            }

            var list = new List<object?>();
            foreach (var c in raw.Courses)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["id"] = c.Id,
                    ["name"] = c.Name,
                    ["description"] = c.Description,
                    ["type"] = c.Type,
                    ["target"] = c.Target,
                    ["students"] = c.Students,
                    ["seatMin"] = c.SeatMin,
                    ["seatMax"] = c.SeatMax,
                    ["started"] = c.Started,
                    ["completed"] = c.Completed,
                    ["completesAtUt"] = c.CompletesAtUt,
                    ["studentsAvailableAtUt"] = c.StudentsAvailableAtUt,
                    ["isTemporary"] = c.IsTemporary,
                });
            }
            return list;
        }

        /// <summary>
        /// The enrolable trainings. Null when RP-1's crew handler is not live, on
        /// the same reasoning as the courses above; an empty list would say the
        /// install has no crewed parts at all, which RP-1 never means.
        /// </summary>
        public static List<object?>? BuildCatalogue(Rp1TrainingCatalogueRaw? raw)
        {
            if (raw?.Templates == null)
            {
                return null;
            }

            var list = new List<object?>();
            foreach (var t in raw.Templates)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["id"] = t.Id,
                    ["name"] = t.Name,
                    ["description"] = t.Description,
                    ["type"] = t.Type,
                    ["target"] = t.Target,
                    ["baseTime"] = t.BaseTime,
                    ["seatMin"] = t.SeatMin,
                    ["seatMax"] = t.SeatMax,
                    ["unlocked"] = t.Unlocked,
                    ["isTemporary"] = t.IsTemporary,
                });
            }
            return list;
        }

        public static Dictionary<string, object?>? BuildProgram(Rp1CrewRaw? raw)
        {
            var program = raw?.Program;
            if (program == null)
            {
                return null;
            }
            return new Dictionary<string, object?>
            {
                ["retirementEnabled"] = program.RetirementEnabled,
                ["crewRnREnabled"] = program.CrewRnREnabled,
                ["missionTrainingEnabled"] = program.MissionTrainingEnabled,
                ["proficiencyTrainingRate"] = program.ProficiencyTrainingRate,
                ["missionTrainingRate"] = program.MissionTrainingRate,
                ["retirementExtensionCapSeconds"] = program.RetirementExtensionCapSeconds,
                ["courses"] = program.Courses,
                ["coursesStarted"] = program.CoursesStarted,
                ["crewInTraining"] = program.CrewInTraining,
            };
        }
    }
}
