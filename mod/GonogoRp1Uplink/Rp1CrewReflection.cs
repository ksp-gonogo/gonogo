// RP-1's crew bookkeeping, read by reflection. No compile-time reference to
// RP0.dll, same arm's-length pattern as Rp1ScReflection, whose header carries the
// provenance rules this file follows.
//
// PROVENANCE. Every member below was read out of an ilspycmd disassembly of the
// SHIPPED RP-1 v4.6.0.0 RP0.dll at GameData/RP-1/Plugins/RP0.dll.
// RP0.Crew.CrewHandler is a ScenarioModule, so its Instance is live only inside a
// save RP-1 manages.
//
// WHY THE PRIVATE FIELDS RATHER THAN THE PUBLIC GETTERS. CrewHandler exposes
// IsRetired(pcm), GetRetireTime(name), GetRetireIncreaseTime(name) and
// GetTrainingFinishTime(pcm), and three of the four are read here as the private
// collections behind them instead:
//
//   _retirees       IsRetired is `_retirees.Contains(pcm.name)`. The set is read
//                   ONCE per tick and every kerbal answered from it, rather than
//                   one reflected invoke per kerbal per tick. It also needs no
//                   ProtoCrewMember, so this file stays KSP-free.
//   _retireTimes    GetRetireTime is a TryGetValue that returns 0.0 on a miss, so
//                   the getter cannot distinguish "no record" from "retires at UT
//                   zero". Reading the dictionary keeps the distinction.
//   _retireIncreases  same shape, same reason.
//   _expireTimes    has no public getter at all: GetExpiration is private and
//                   GetTrainingString formats it into prose.
//
// TrainingCourses is public and is read as itself.
//
// MEMBERS DELIBERATELY NOT CALLED, and why:
//
//   CrewHandler.GetTrainingFinishTime, TrainingCourse.GetTimeLeft /
//   .GetBuildRate / .CalculateBuildRate
//       the chain ends in CurrencyUtils.Rate, whose body FIRES
//       GameEvents.Modifiers.OnCurrencyModifierQuery at every modifier in the
//       save. The same fence Rp1EconomyBackend and Rp1ProgramsReflection stand
//       behind. The rate is read off TrainingCourse._buildRate, the cache those
//       getters populate, and an unrated course reports an absent date.
//   TrainingCourse.GetFractionComplete
//       pure, but a one-line divide, and RP-1 leaves it a NaN on a zero-point
//       course. Reproduced in Rp1CrewMath so the NaN becomes absent.
//   CrewHandler.GetTrainingString, GetPrettyCourseName
//       build display prose with embedded dates. A dashboard formats its own
//       dates from a UT; prose on the wire is a date nothing can convert.
//   CrewHandler.IncreaseRetireTime, AddExpiration, RemoveExpiration
//       writers. A telemetry read must not move a player's retirement date.
//   CrewHandler.RnRProjects
//       a property whose getter REBUILDS a list on a dirty flag, so reading it
//       from a capture is a write. It carries nothing new either: an R&R project
//       is a wrapper over ProtoCrewMember.inactive / inactiveTimeEnd, which are
//       STOCK fields and now ride the stock roster entry.
using System;
using System.Collections;
using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Resolves RP-1's crew model by reflection and reads one tick of it into
    /// <see cref="Rp1CrewRaw"/>. Nothing in this file touches KSP or Unity, so it
    /// compiles and runs headless against a stand-in object graph.
    /// </summary>
    public sealed class Rp1CrewReflection
    {
        private const string HandlerTypeName = "RP0.Crew.CrewHandler";
        private const string DatabaseTypeName = "RP0.Database";

        private readonly Type? _handler;
        private readonly Type? _database;

        /// <summary>RP-1's crew handler type resolved. Gated on the TYPE, never on an assembly name.</summary>
        public bool IsAvailable => _handler != null;

        public Rp1CrewReflection()
        {
            _handler = Rp1Types.Find(HandlerTypeName);
            _database = Rp1Types.Find(DatabaseTypeName);
        }

        /// <summary>
        /// Whether RP-1 counts this name as a retiree, asked of RP-1's LIVE set.
        ///
        /// <para>Answered independently of <see cref="Read"/> because the
        /// crew-standing backend is asked for every kerbal on every space-centre
        /// capture, and that capture is core's rather than this Uplink's: a retiree
        /// must not read as a fatality on a dashboard watching no <c>rp1.*</c>
        /// topic at all.</para>
        ///
        /// <para>The live collection is queried rather than copied into a set per
        /// call. RP-1's <c>_retirees</c> is a field whose collection mutates in
        /// place when somebody retires, so holding no copy means there is no
        /// staleness to reason about, and a roster of thirty costs thirty
        /// dictionary probes rather than thirty set rebuilds. Preferring
        /// <see cref="ICollection{T}"/> keeps that cheap without ever casting to
        /// RP-1's own persistence type, which comes from an assembly this file
        /// deliberately cannot see.</para>
        ///
        /// <para>False when RP-1 is absent or the handler is not live, which is not
        /// a guess: a save RP-1 does not manage has no retirees by construction.</para>
        /// </summary>
        public bool IsRetired(string name)
        {
            var instance = Instance();
            if (instance == null || string.IsNullOrEmpty(name))
            {
                return false;
            }
            var retirees = Rp1Types.Member(instance, "_retirees");
            if (retirees is ICollection<string> set)
            {
                return set.Contains(name);
            }
            foreach (var retiree in Strings(retirees))
            {
                if (string.Equals(retiree, name, StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>
        /// One kerbal's LIVE standing facts, for the crew-standing backend: the
        /// course they are on and its ETA, and the date their career ends.
        ///
        /// <para>Its own read for the reason <see cref="IsRetired"/> is its own
        /// read. The backend is asked for every kerbal on every space-centre
        /// capture, and that capture is core's, which runs whether or not anything
        /// of ours is subscribed. Answering from state <see cref="Read"/> stashed
        /// would starve the whole correction on a dashboard watching the roster and
        /// no <c>rp1.*</c> topic: the gated-capture starvation shape three channels
        /// have already shipped with.</para>
        ///
        /// <para>Costed for that call pattern rather than for elegance. The
        /// retirement date is one dictionary probe. The course walk is over
        /// <c>TrainingCourses</c>, which holds COURSES and not kerbals, so a
        /// roster of thirty against a handful of live courses is a low hundreds of
        /// iterations per capture, and it stops at the first course this kerbal is
        /// enrolled on.</para>
        ///
        /// <para>Every field absent when RP-1 is absent, the handler is not live,
        /// or RP-1 holds no record for the name: a save RP-1 does not manage
        /// schedules nobody, which is an answer rather than a guess.</para>
        /// </summary>
        public Rp1StandingFacts StandingFacts(string name, double ut)
        {
            var instance = Instance();
            if (instance == null || string.IsNullOrEmpty(name))
            {
                return default;
            }

            var course = CourseFor(instance, name, ut);
            return new Rp1StandingFacts(
                retiresAtUt: Rp1CrewMath.ZeroAsAbsent(RetireTime(instance, name)),
                trainingStarted: course?.Started ?? false,
                trainingFinishesAtUt: course?.FinishesAtUt);
        }

        /// <summary>
        /// What RP-1 schedules for one kerbal, as plain data: the two facts the
        /// crew-standing capability needs and nothing else.
        /// </summary>
        /// <remarks>
        /// A struct with no <c>Standing</c> on it, deliberately. Deciding that an
        /// enrolled kerbal is <c>Training</c> is the BACKEND's job; this type's job
        /// is to say what RP-1 holds. Reflection that decides a standing is
        /// reflection a headless test cannot exercise without also asserting the
        /// policy.
        /// </remarks>
        public readonly struct Rp1StandingFacts
        {
            public Rp1StandingFacts(double? retiresAtUt, bool trainingStarted, double? trainingFinishesAtUt)
            {
                RetiresAtUt = retiresAtUt;
                TrainingStarted = trainingStarted;
                TrainingFinishesAtUt = trainingFinishesAtUt;
            }

            /// <summary>When RP-1 retires this kerbal, or null when it holds no date.</summary>
            public double? RetiresAtUt { get; }

            /// <summary>
            /// The kerbal is enrolled on a course that has STARTED. Enrolment
            /// alone is not this: a course RP-1 has not begun makes no progress
            /// and has no finish date, and reporting an unstarted enrolment as a
            /// standing would tell an operator a crew is being trained when it is
            /// queued behind something.
            /// </summary>
            public bool TrainingStarted { get; }

            /// <summary>The course's ETA, or null when RP-1 has not rated its build rate yet.</summary>
            public double? TrainingFinishesAtUt { get; }
        }

        /// <summary>RP-1's own retirement date for one name: a probe of <c>_retireTimes</c>, not a materialised copy of it.</summary>
        private static double? RetireTime(object instance, string name)
        {
            var times = Rp1Types.Member(instance, "_retireTimes");
            if (times is IDictionary<string, double> typed)
            {
                return typed.TryGetValue(name, out var value) ? value : (double?)null;
            }
            if (times is IDictionary loose)
            {
                foreach (DictionaryEntry entry in loose)
                {
                    if (entry.Key is string key && string.Equals(key, name, StringComparison.Ordinal))
                    {
                        return Rp1Types.ToDouble(entry.Value);
                    }
                }
            }
            return null;
        }

        /// <summary>
        /// The live course this kerbal is enrolled on, or null. Stops at the first
        /// match: a kerbal on two courses at once is a state RP-1 refuses to
        /// produce (<c>MeetsStudentReqs</c>), so a second would be a state neither
        /// side has a policy for.
        /// </summary>
        private static CourseRaw? CourseFor(object instance, string name, double ut)
        {
            foreach (var course in Materialise(Rp1Types.Member(instance, "TrainingCourses")))
            {
                if (ReadBool(course, "Completed") == true || !HasStudent(course, name))
                {
                    continue;
                }
                var started = ReadBool(course, "Started") == true;
                var progress = Rp1Types.ReadDouble(course, "progress");
                var totalPoints = Rp1Types.ReadDouble(course, "BP");
                return new CourseRaw(
                    course: ReadString(course, "id"),
                    type: EnumName(Rp1Types.Member(course, "Type")),
                    target: EmptyAsAbsent(ReadString(course, "Target")),
                    started: started,
                    fractionComplete: Rp1CrewMath.FractionComplete(progress, totalPoints),
                    finishesAtUt: Rp1CrewMath.FinishesAtUt(
                        ut, started, progress, totalPoints, Rp1Types.ReadDouble(course, "_buildRate")));
            }
            return null;
        }

        /// <summary>Whether one course's student list holds this name.</summary>
        private static bool HasStudent(object? course, string name)
        {
            foreach (var student in Materialise(Rp1Types.Member(course, "Students")))
            {
                if (string.Equals(ReadString(student, "name"), name, StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>
        /// Reads one tick, or nothing. Null when RP-1's crew handler is not live,
        /// which is the main menu and any save RP-1 does not manage: publishing an
        /// empty crew list there would say "RP-1 is scheduling nobody" about a
        /// game that is not running RP-1's rules at all.
        /// </summary>
        public Rp1CrewRaw? Read(double ut)
        {
            var instance = Instance();
            if (instance == null)
            {
                return null;
            }

            var raw = new Rp1CrewRaw { Ut = ut };
            var retirees = new HashSet<string>(StringComparer.Ordinal);
            foreach (var name in Strings(Rp1Types.Member(instance, "_retirees")))
            {
                retirees.Add(name);
            }

            var retireTimes = Doubles(Rp1Types.Member(instance, "_retireTimes"));
            var retireIncreases = Doubles(Rp1Types.Member(instance, "_retireIncreases"));
            var capSeconds = RetirementExtensionCapSeconds();
            var expiries = ReadExpiries(instance);
            var read = ReadCourses(instance, ut);
            var courses = read.ByStudent;

            foreach (var name in Names(retirees, retireTimes, expiries, courses))
            {
                var retiresAt = Rp1CrewMath.ZeroAsAbsent(Lookup(retireTimes, name));
                var extensionUsed = retiresAt == null ? (double?)null : (Lookup(retireIncreases, name) ?? 0.0);
                var member = new Rp1CrewMemberRaw
                {
                    Name = name,
                    Retired = retirees.Contains(name),
                    RetiresAtUt = retiresAt,
                    RetirementExtensionUsedSeconds = extensionUsed,
                    LatestRetiresAtUt = Rp1CrewMath.LatestRetiresAtUt(retiresAt, extensionUsed, capSeconds),
                };

                if (courses.TryGetValue(name, out var course))
                {
                    member.TrainingCourse = course.Course;
                    member.TrainingType = course.Type;
                    member.TrainingTarget = course.Target;
                    member.TrainingStarted = course.Started;
                    member.TrainingFractionComplete = course.FractionComplete;
                    member.TrainingFinishesAtUt = course.FinishesAtUt;
                }

                if (expiries.TryGetValue(name, out var lapsing))
                {
                    member.TrainingExpiryCount = lapsing.Count;
                    member.NextTrainingExpiryUt = lapsing.SoonestUt;
                    member.NextTrainingExpiryTarget = lapsing.SoonestTarget;
                }

                raw.Crew.Add(member);
            }

            raw.Courses = read.Rows;

            raw.Program = new Rp1CrewProgramRaw
            {
                RetirementEnabled = ReadBool(instance, "RetirementEnabled"),
                CrewRnREnabled = ReadBool(instance, "CrewRnREnabled"),
                MissionTrainingEnabled = ReadBool(instance, "IsMissionTrainingEnabled"),
                ProficiencyTrainingRate = Rp1Types.ReadDouble(instance, "ProfTrainRate"),
                MissionTrainingRate = Rp1Types.ReadDouble(instance, "MissionTrainRate"),
                RetirementExtensionCapSeconds = capSeconds,
                Courses = read.Courses,
                CoursesStarted = read.CoursesStarted,
                // Counted off the per-student index, so a two-seat course with one
                // student is one kerbal in training rather than two.
                CrewInTraining = courses.Count,
            };
            return raw;
        }

        /// <summary>The live handler instance, or null when RP-1 is absent or the scenario module is not loaded.</summary>
        private object? Instance() =>
            _handler == null ? null : Rp1Types.StaticValue(_handler, "Instance");

        /// <summary>
        /// The career-wide cap on how far one kerbal's retirement can be pushed:
        /// <c>Database.SettingsCrew.retireIncreaseCap</c>. Absent when either hop
        /// is unreadable, which leaves <see cref="Rp1CrewEntry.LatestRetiresAtUt"/>
        /// absent rather than equal to the date, because a ceiling nobody could
        /// read is not a ceiling at the current date.
        /// </summary>
        private double? RetirementExtensionCapSeconds()
        {
            if (_database == null)
            {
                return null;
            }
            var settings = Rp1Types.StaticValue(_database, "SettingsCrew");
            return settings == null ? null : Rp1Types.ReadDouble(settings, "retireIncreaseCap");
        }

        /// <summary>
        /// One kerbal's course, as plain data. The per-student index rather than a
        /// course list, because every consumer's question is "what is THIS kerbal
        /// doing"; a kerbal on two courses at once is not a state RP-1 produces
        /// (<c>MeetsStudentReqs</c> refuses it), and if one ever appeared the last
        /// course wins and no row is dropped.
        /// </summary>
        private readonly struct CourseRaw
        {
            public CourseRaw(string? course, string? type, string? target, bool started, double? fractionComplete, double? finishesAtUt)
            {
                Course = course;
                Type = type;
                Target = target;
                Started = started;
                FractionComplete = fractionComplete;
                FinishesAtUt = finishesAtUt;
            }

            public string? Course { get; }
            public string? Type { get; }
            public string? Target { get; }
            public bool Started { get; }
            public double? FractionComplete { get; }
            public double? FinishesAtUt { get; }
        }

        /// <summary>
        /// The course walk's whole answer: the per-kerbal index, the two
        /// programme-level counts, and the course-level rows, so the list is
        /// walked ONCE. A completed course is not a course RP-1 still holds and is
        /// excluded from all four.
        /// </summary>
        private readonly struct CoursesRaw
        {
            public CoursesRaw(
                Dictionary<string, CourseRaw> byStudent,
                int courses,
                int coursesStarted,
                List<Rp1TrainingCourseRaw> rows)
            {
                ByStudent = byStudent;
                Courses = courses;
                CoursesStarted = coursesStarted;
                Rows = rows;
            }

            public Dictionary<string, CourseRaw> ByStudent { get; }
            public int Courses { get; }
            public int CoursesStarted { get; }

            /// <summary>One row per live course, carrying what no kerbal row can: the seat bounds, and a course with nobody on it.</summary>
            public List<Rp1TrainingCourseRaw> Rows { get; }
        }

        /// <summary>Every kerbal enrolled on a live course, keyed by name, and the counts behind them.</summary>
        private static CoursesRaw ReadCourses(object instance, double ut)
        {
            var byStudent = new Dictionary<string, CourseRaw>(StringComparer.Ordinal);
            var rows = new List<Rp1TrainingCourseRaw>();
            var courses = 0;
            var coursesStarted = 0;
            foreach (var course in Materialise(Rp1Types.Member(instance, "TrainingCourses")))
            {
                if (ReadBool(course, "Completed") == true)
                {
                    continue;
                }

                var started = ReadBool(course, "Started") == true;
                courses++;
                if (started)
                {
                    coursesStarted++;
                }
                var progress = Rp1Types.ReadDouble(course, "progress");
                var totalPoints = Rp1Types.ReadDouble(course, "BP");
                var row = new CourseRaw(
                    course: ReadString(course, "id"),
                    type: EnumName(Rp1Types.Member(course, "Type")),
                    target: EmptyAsAbsent(ReadString(course, "Target")),
                    started: started,
                    fractionComplete: Rp1CrewMath.FractionComplete(progress, totalPoints),
                    finishesAtUt: Rp1CrewMath.FinishesAtUt(
                        ut, started, progress, totalPoints, Rp1Types.ReadDouble(course, "_buildRate")));

                // The course-level row is built from the SAME walk rather than a
                // second one: the students are already in hand here, and the
                // latest inactive window among them is the date a mission planner
                // needs. RP-1 grounds each student for 120% of the course's base
                // time at the moment it starts, so that date outlasts the course.
                var studentNames = new List<string>();
                double? availableAt = null;
                foreach (var student in Materialise(Rp1Types.Member(course, "Students")))
                {
                    var name = ReadString(student, "name");
                    if (name != null)
                    {
                        byStudent[name] = row;
                        studentNames.Add(name);
                    }

                    var inactiveUntil = Rp1Types.ReadDouble(student, "inactiveTimeEnd");
                    if (inactiveUntil != null && (availableAt == null || inactiveUntil > availableAt))
                    {
                        availableAt = inactiveUntil;
                    }
                }

                rows.Add(new Rp1TrainingCourseRaw
                {
                    Id = row.Course,
                    Name = EmptyAsAbsent(ReadString(course, "Name")),
                    Description = EmptyAsAbsent(ReadString(course, "Description")),
                    Type = row.Type,
                    Target = row.Target,
                    Students = studentNames,
                    SeatMin = SeatCount(course, "SeatMin"),
                    SeatMax = SeatCount(course, "SeatMax"),
                    Started = started,
                    Completed = false,
                    CompletesAtUt = row.FinishesAtUt,
                    StudentsAvailableAtUt = availableAt,
                    IsTemporary = ReadBool(course, "IsTemporary"),
                });
            }
            return new CoursesRaw(byStudent, courses, coursesStarted, rows);
        }

        /// <summary>
        /// A seat bound as an int. RP-1 declares both as plain ints on the course,
        /// and this file has no int reader of its own because nothing else here
        /// needed one.
        /// </summary>
        private static int? SeatCount(object course, string name) =>
            Rp1Types.Member(course, name) is int seats ? seats : (int?)null;

        /// <summary>One kerbal's perishable trainings, folded to the soonest plus a count.</summary>
        private readonly struct ExpiryRaw
        {
            public ExpiryRaw(int count, double? soonestUt, string? soonestTarget)
            {
                Count = count;
                SoonestUt = soonestUt;
                SoonestTarget = soonestTarget;
            }

            public int Count { get; }
            public double? SoonestUt { get; }
            public string? SoonestTarget { get; }
        }

        /// <summary>
        /// Every kerbal with mission training that lapses, keyed by name. Folded
        /// here rather than in the mapper because the fold is a min over a list
        /// only this side can read.
        /// </summary>
        private static Dictionary<string, ExpiryRaw> ReadExpiries(object instance)
        {
            var counts = new Dictionary<string, int>(StringComparer.Ordinal);
            var soonest = new Dictionary<string, double>(StringComparer.Ordinal);
            var targets = new Dictionary<string, string?>(StringComparer.Ordinal);

            foreach (var expiry in Materialise(Rp1Types.Member(instance, "_expireTimes")))
            {
                var name = ReadString(expiry, "pcmName");
                var at = Rp1Types.ReadDouble(expiry, "expiration");
                if (name == null || at == null)
                {
                    continue;
                }
                counts[name] = counts.TryGetValue(name, out var seen) ? seen + 1 : 1;
                if (!soonest.TryGetValue(name, out var best) || at.Value < best)
                {
                    soonest[name] = at.Value;
                    targets[name] = EmptyAsAbsent(ReadString(Rp1Types.Member(expiry, "training"), "target"));
                }
            }

            var byName = new Dictionary<string, ExpiryRaw>(StringComparer.Ordinal);
            foreach (var pair in counts)
            {
                byName[pair.Key] = new ExpiryRaw(
                    pair.Value,
                    soonest.TryGetValue(pair.Key, out var at) ? at : (double?)null,
                    targets.TryGetValue(pair.Key, out var target) ? target : null);
            }
            return byName;
        }

        /// <summary>
        /// Every name RP-1 has a record of, in a stable order so a channel whose
        /// change-gate compares payloads does not report a change on a reordered
        /// dictionary walk.
        /// </summary>
        private static List<string> Names(
            HashSet<string> retirees,
            Dictionary<string, double> retireTimes,
            Dictionary<string, ExpiryRaw> expiries,
            Dictionary<string, CourseRaw> courses)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var name in retirees) names.Add(name);
            foreach (var name in retireTimes.Keys) names.Add(name);
            foreach (var name in expiries.Keys) names.Add(name);
            foreach (var name in courses.Keys) names.Add(name);

            var ordered = new List<string>(names);
            ordered.Sort(StringComparer.Ordinal);
            return ordered;
        }

        private static double? Lookup(Dictionary<string, double> map, string name) =>
            map.TryGetValue(name, out var value) ? value : (double?)null;

        // ── Reflection primitives ────────────────────────────────────────────

        /// <summary>
        /// The strings in one of RP-1's collections, walked as a bare
        /// <see cref="IEnumerable"/> and never cast: RP-1's persistence types
        /// (<c>PersistentHashSetValueType&lt;string&gt;</c> here) come from a
        /// separate assembly and change between releases.
        /// </summary>
        private static IEnumerable<string> Strings(object? collection)
        {
            if (!(collection is IEnumerable e) || collection is string)
            {
                yield break;
            }
            foreach (var item in e)
            {
                if (item is string s)
                {
                    yield return s;
                }
            }
        }

        /// <summary>
        /// One of RP-1's name-keyed double dictionaries, materialised so the whole
        /// tick reads it once. Walked as <see cref="IDictionary"/> rather than
        /// cast, for the reason <see cref="Strings"/> gives.
        /// </summary>
        private static Dictionary<string, double> Doubles(object? dictionary)
        {
            var map = new Dictionary<string, double>(StringComparer.Ordinal);
            if (!(dictionary is IDictionary d))
            {
                return map;
            }
            try
            {
                foreach (DictionaryEntry entry in d)
                {
                    var key = entry.Key as string;
                    var value = Rp1Types.ToDouble(entry.Value);
                    if (key != null && value != null)
                    {
                        map[key] = value.Value;
                    }
                }
            }
            catch (Exception)
            {
                // fail-soft: an unreadable dictionary costs its own fields, never the tick
            }
            return map;
        }

        private static List<object> Materialise(object? collection)
        {
            var list = new List<object>();
            if (!(collection is IEnumerable e) || collection is string)
            {
                return list;
            }
            foreach (var item in e)
            {
                if (item != null)
                {
                    list.Add(item);
                }
            }
            return list;
        }

        private static bool? ReadBool(object? target, string name) =>
            Rp1Types.Member(target, name) is bool b ? b : (bool?)null;

        private static string? ReadString(object? target, string name) =>
            Rp1Types.Member(target, name) as string;

        /// <summary>
        /// An enum member read as its NAME. RP-1's ordinals are its own business
        /// and shift between releases; a name is stable and is what a client maps.
        /// </summary>
        private static string? EnumName(object? value)
        {
            if (value == null)
            {
                return null;
            }
            try
            {
                var type = value.GetType();
                return type.IsEnum ? Enum.GetName(type, value) : null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static string? EmptyAsAbsent(string? value) =>
            string.IsNullOrEmpty(value) ? null : value;
    }
}
