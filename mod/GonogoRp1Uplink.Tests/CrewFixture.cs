using System.Collections.Generic;

// A stand-in for RP-1's crew object graph, declared in RP-1's own namespace with
// RP-1's own type and member names, so the production reflection walk resolves it
// exactly as it resolves the real thing: same FindType lookup, same private-field
// reads, same enumeration of collections as bare IEnumerable.
//
// Every name, accessibility and shape below was taken from an ilspycmd
// disassembly of the SHIPPED RP-1 v4.6.0.0 RP0.dll. The accessibilities are the
// load-bearing part and are copied deliberately: _retirees, _retireTimes,
// _retireIncreases and _expireTimes are PRIVATE on CrewHandler and
// TrainingCourse.progress / .BP are private with _buildRate protected, so a walk
// that only reads public members would resolve nothing here and nothing in a
// running game either.
//
// What this CANNOT do, stated rather than implied: it proves the walk reads the
// members it claims to and derives what the arithmetic says. It proves nothing
// about the VALUES a running RP-1 would hold; there is no RP-1 install on this
// machine or the test rig.

/// <summary>
/// KSP's own crew member, stood in for so the training-course walk can read a
/// student's name. Only <c>name</c> is needed, and it is a read-only property on
/// the real type (<c>public string name => _name;</c>), so it is one here too: a
/// settable field would let the walk pass against a shape KSP does not have.
/// </summary>
public class ProtoCrewMember
{
    private readonly string _name;

    public ProtoCrewMember(string name)
    {
        _name = name;
    }

    public string name => _name;

    /// <summary>
    /// Stock's ground-until date. RP-1 WRITES it at course start, for 120% of the
    /// course's base time, so it outlasts the course and is the date a crew member
    /// can actually fly again.
    /// </summary>
    public double inactiveTimeEnd { get; set; }

    /// <summary>
    /// Stock's grounded flag, which RP-1 sets at course start and clears on every
    /// way out of one. Here so a test can hold the thing an operator actually
    /// cares about after a cancel: that the crew can fly again.
    /// </summary>
    public bool inactive { get; set; }

    /// <summary>
    /// RP-1's own grounding call, as RP-1 makes it: <c>SetInactive(seconds,
    /// true)</c> at course start. Both effects, because the two dates it sets are
    /// different answers and the walk publishes both.
    /// </summary>
    public void SetInactive(double seconds, bool fromTraining)
    {
        inactive = true;
        inactiveTimeEnd = Ut + seconds;
    }

    /// <summary>
    /// The clock <see cref="SetInactive"/> counts from. Stock reads
    /// <c>Planetarium.GetUniversalTime()</c>; a stand-in for that static is more
    /// machinery than one date is worth.
    /// </summary>
    public static double Ut;
}

namespace RP0
{
    /// <summary>
    /// RP-1's crew settings. <c>retireIncreaseCap</c> is the career-wide ceiling on
    /// how far one kerbal's retirement can be pushed; the default is RP-1's own
    /// (15 Julian years).
    /// </summary>
    public sealed class CrewSettings
    {
        public double retireIncreaseCap = 473040000.0;
    }
}

namespace RP0.Crew
{
    /// <summary>One entry of a kerbal's career log that training keys off.</summary>
    public class TrainingFlightEntry
    {
        public string? type;
        public string? target;
    }

    /// <summary>
    /// RP-1's training template. Only the <c>TrainingType</c> enum and the fields
    /// <c>TrainingCourse</c> projects through are needed: the walk reads the course's
    /// computed <c>Type</c> and <c>Target</c>, both of which fall back through the
    /// template on the real type.
    /// </summary>
    public class TrainingTemplate
    {
        public enum TrainingType
        {
            Proficiency,
            Mission,
        }

        public string? id;
        public string? name;
        public string? description;
        public TrainingType type;
        public TrainingFlightEntry? training;

        /// <summary>Below one seat there is no course; RP-1's own default is 1.</summary>
        public int seatMin = 1;

        /// <summary>Zero means RP-1 sets no maximum.</summary>
        public int seatMax;

        public bool isTemporary;

        /// <summary>
        /// The persisted base time. Read as a FIELD by the catalogue walk, because
        /// <c>GetBaseTime</c> returns exactly this for an empty student list and
        /// reaches a mutating shared static for a non-empty one.
        /// </summary>
        public double time;

        /// <summary>
        /// A computed property on the real type, over <c>partsCovered</c> and the
        /// research queue. A settable stand-in here: what the walk has to get right
        /// is that it reads a bool off this name, and reproducing RP-1's tech
        /// lookup would prove only that the reproduction agrees with itself.
        /// </summary>
        public bool IsUnlocked { get; set; }

        /// <summary>
        /// The Astronaut Complex tier this training demands. Computed on the real
        /// type, through the shared-static tracker that keeps it off the wire, and
        /// settable here because the enrolment command's gate is the one thing that
        /// reads it.
        /// </summary>
        public int ACLevelRequirement { get; set; }
    }

    /// <summary>
    /// One perishable training and when it lapses. <c>expiration</c> is a UT.
    /// </summary>
    public class TrainingExpiration
    {
        public string? pcmName;
        public TrainingFlightEntry training = new TrainingFlightEntry();
        public double expiration;
    }

    /// <summary>
    /// One training course. The accessibilities mirror RP-1's: <c>progress</c> and
    /// <c>BP</c> private, <c>_buildRate</c> protected and defaulted to -1, which is
    /// the "not rated yet" state an unstarted course sits in and the reason the
    /// finish date is absent rather than infinite.
    /// </summary>
    public class TrainingCourse
    {
        public string? id;
        public List<ProtoCrewMember> Students = new List<ProtoCrewMember>();
        public bool Started;
        public bool Completed;

        /// <summary>RP-1's own display name, off the template.</summary>
        public string Name => _template?.name ?? "Unknown training course";

        public string? Description => _template?.description;

        /// <summary>
        /// The seat bounds, which decide whether an operator gets Cancel (the
        /// whole course) or Remove (one student). Defaulted as RP-1 defaults them.
        /// </summary>
        public int SeatMin => _template?.seatMin ?? 1;

        public int SeatMax => _template?.seatMax ?? 0;

        public bool IsTemporary => _template?.isTemporary ?? false;

        private double progress;
        private double BP;
        protected double _buildRate = -1.0;

        private TrainingTemplate? _template;

        public TrainingTemplate.TrainingType Type => _template?.type ?? TrainingTemplate.TrainingType.Proficiency;

        public string Target => _template?.training?.target ?? string.Empty;

        /// <summary>Test-side setter for the three private/protected numbers, so no test reaches into them by reflection of its own.</summary>
        public TrainingCourse Costed(double progress, double totalPoints, double buildRate)
        {
            this.progress = progress;
            BP = totalPoints;
            _buildRate = buildRate;
            return this;
        }

        public TrainingCourse FromTemplate(TrainingTemplate template)
        {
            _template = template;
            return this;
        }

        /// <summary>
        /// RP-1's own three constructors, and the two single-argument ones are the
        /// point: both are public, so a production lookup matching on arity alone
        /// would build a course out of a template it then read as a save node. The
        /// ConfigNode overload exists here to make that mistake FAIL rather than
        /// pass by luck of declaration order.
        /// </summary>
        public TrainingCourse()
        {
        }

        public TrainingCourse(TrainingTemplate template)
        {
            id = template.id;
            _template = template;
            BP = template.time;
        }

        public TrainingCourse(ConfigNode node) => LoadedFromNode = true;

        /// <summary>Set by the persistence constructor, so a test can say which one ran.</summary>
        public bool LoadedFromNode { get; }

        public int ACLevelRequirement => _template?.ACLevelRequirement ?? 0;

        /// <summary>
        /// RP-1's student gate, in RP-1's order. Not a full copy: the real one also
        /// reads a kerbal's type, roster status and career log, and what the
        /// command has to get right is that it ASKS this before adding rather than
        /// what the answer is made of.
        /// </summary>
        public bool MeetsStudentReqs(ProtoCrewMember student)
        {
            if (student.inactive || Students.Contains(student))
            {
                return false;
            }
            return _template == null || _template.seatMax <= 0 || Students.Count < _template.seatMax;
        }

        /// <summary>
        /// RP-1's own pair, and the string overload is declared for the reason the
        /// ConfigNode constructor is: it goes through the roster indexer and ADDS
        /// THE NULL it gets back for a name nobody holds, so a command that
        /// resolved by arity alone would enrol nobody and report success.
        /// </summary>
        public void AddStudent(ProtoCrewMember student)
        {
            if ((_template == null || _template.seatMax <= 0 || Students.Count < _template.seatMax)
                && !Students.Contains(student))
            {
                Students.Add(student);
            }
        }

        public void AddStudent(string student) => AddedByName.Add(student);

        /// <summary>Names handed to the string overload, which nothing should reach.</summary>
        public static readonly List<string> AddedByName = new List<string>();

        public void RemoveStudent(ProtoCrewMember student)
        {
            if (!Students.Contains(student))
            {
                return;
            }
            Students.Remove(student);
            if (!Started)
            {
                return;
            }
            student.inactive = false;
            if (Students.Count == 0)
            {
                CompleteCourse();
            }
        }

        public void RemoveStudent(string student) => RemovedByName.Add(student);

        public static readonly List<string> RemovedByName = new List<string>();

        /// <summary>
        /// RP-1's start, including the grounding that is the whole reason nothing
        /// may fail after it: every student is marked unavailable for 120% of the
        /// base time, and a course that started and was then not kept would leave
        /// them grounded against nothing.
        /// </summary>
        public bool StartCourse()
        {
            if (Started)
            {
                return true;
            }
            if (_template == null || Students.Count < _template.seatMin)
            {
                return false;
            }
            if (_template.seatMax > 0 && Students.Count > _template.seatMax)
            {
                return false;
            }
            Started = true;
            foreach (var student in Students)
            {
                student.SetInactive(_template.time * 1.2, true);
            }
            return true;
        }

        /// <summary>
        /// RP-1's completion, and the short-circuit is the load-bearing half: with
        /// <c>Completed</c> still false the reward block does not run at all and
        /// the method is purely an un-grounding, which is exactly what makes it
        /// RP-1's own Cancel.
        /// </summary>
        public void CompleteCourse()
        {
            if (Completed)
            {
                Rewarded++;
            }
            foreach (var student in Students)
            {
                student.inactive = false;
            }
        }

        /// <summary>
        /// How many times the reward path ran. A cancel must never reach it: it
        /// grants a retirement extension and, in the game, opens a dialog.
        /// </summary>
        public static int Rewarded;
    }

    /// <summary>
    /// RP-1's crew handler. A ScenarioModule on the real type, so its
    /// <c>Instance</c> is live only inside a save RP-1 manages, which is the state
    /// a null here stands for.
    /// </summary>
    public class CrewHandler
    {
        public static CrewHandler? Instance;

        private Dictionary<string, double> _retireTimes = new Dictionary<string, double>();
        private Dictionary<string, double> _retireIncreases = new Dictionary<string, double>();
        // Declared `object` so a test can put a BARE IEnumerable behind it. The
        // declared type is invisible to reflection, which reads the runtime
        // object, so this changes nothing about the normal case: RP-1's real
        // _retirees is a PersistentHashSetValueType<string> deriving from
        // HashSet<string>, and that is what sits here by default.
        private object _retirees = new HashSet<string>();
        private List<TrainingExpiration> _expireTimes = new List<TrainingExpiration>();

        public List<TrainingCourse> TrainingCourses = new List<TrainingCourse>();

        /// <summary>
        /// The enrolable catalogue: one entry per crewed part in the install, and
        /// the list the enrolment command resolves a template id against.
        /// </summary>
        public List<TrainingTemplate> TrainingTemplates = new List<TrainingTemplate>();

        public bool RetirementEnabled = true;
        public bool CrewRnREnabled = true;
        public bool IsMissionTrainingEnabled;
        public double ProfTrainRate;
        public double MissionTrainRate;

        public CrewHandler Retires(string name, double atUt, double increaseUsed = 0.0)
        {
            _retireTimes[name] = atUt;
            if (increaseUsed != 0.0)
            {
                _retireIncreases[name] = increaseUsed;
            }
            return this;
        }

        public CrewHandler Retired(string name)
        {
            ((HashSet<string>)_retirees).Add(name);
            return this;
        }

        /// <summary>
        /// Replaces the retiree set with a collection that implements ONLY
        /// <see cref="IEnumerable{T}"/>, standing in for a future RP-1 whose
        /// persistence type no longer derives from <c>HashSet&lt;string&gt;</c>.
        /// The reader's fast path is a <see cref="ICollection{T}"/> probe, and a
        /// fallback nothing exercises is a fallback that silently reports every
        /// retiree as a fatality the day the fast path stops matching.
        /// </summary>
        public CrewHandler RetireesAsBareEnumerable()
        {
            _retirees = new BareEnumerable((HashSet<string>)_retirees);
            return this;
        }

        private sealed class BareEnumerable : IEnumerable<string>
        {
            private readonly List<string> _names;

            public BareEnumerable(IEnumerable<string> names)
            {
                _names = new List<string>(names);
            }

            public IEnumerator<string> GetEnumerator() => _names.GetEnumerator();

            System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
        }

        public CrewHandler Expires(string pcmName, string target, double atUt)
        {
            _expireTimes.Add(new TrainingExpiration
            {
                pcmName = pcmName,
                expiration = atUt,
                training = new TrainingFlightEntry { type = "TRAINING_mission", target = target },
            });
            return this;
        }
    }
}
