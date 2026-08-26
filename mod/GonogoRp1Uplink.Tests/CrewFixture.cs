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
        public TrainingType type;
        public TrainingFlightEntry? training;
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
