using System.Collections.Generic;

// A stand-in for RP-1's Program object graph, declared in RP-1's own namespace
// with RP-1's own type and member names, so the production reflection walk
// resolves it exactly as it resolves the real thing: same FindType lookup, same
// private-field reads, same enumeration of collections as bare IEnumerable.
//
// Every name, accessibility and shape below was taken from an ilspycmd
// disassembly of the SHIPPED RP-1 v4.6.0.0 RP0.dll, cross-checked against the
// ProgramHandler node a live RP-1 career writes to persistent.sfs. A rename on
// RP-1's side makes these tests wrong in the same direction it makes production
// wrong.
//
// Where RP-1 computes a property this stands in with a settable one: the four
// predicates (AllRequirementsMet, AllObjectivesMet, CanAccept, CanComplete) are
// compiled expressions over live tech, contract and facility state, which no
// headless test can supply. What these tests prove is that the walk reads the
// members it claims to and maps them where it says; what a running RP-1 puts in
// them is not theirs to prove.
namespace RP0.Programs
{
    public class Program
    {
        public enum Speed
        {
            Slow,
            Normal,
            Fast,
            MAX,
        }

        public string? name;
        public string? title;
        public string? description;
        public string? requirementsPrettyText;
        public string? objectivesPrettyText;
        public bool isDisabled;
        public bool isHSF;
        public double nominalDurationYears;
        public double fracElapsed = -1.0;
        public double baseFunding;
        public string? fundingCurve;
        public double acceptedUT;
        public double deadlineUT;
        public double objectivesCompletedUT;
        public double completedUT;
        public double lastPaymentUT;
        public double totalFunding;
        public double fundsPaidOut;
        public double repPenaltyAssessed;
        public double repDeltaOnCompletePerYearEarly;
        public double repPenaltyPerYearLate;
        public int slots = 2;

        public List<string> programsToDisableOnAccept = new List<string>();

        /// <summary>Private on RP-1's side, and read as one: the walk must not need it public.</summary>
        private Speed speed = Speed.Normal;

        public Dictionary<Speed, float> confidenceCosts = new Dictionary<Speed, float>();

        /// <summary>
        /// The career's funds multiplier folded in, as
        /// <c>CalcTotalFunding</c> does, so a test can pin the ratio the program
        /// modifier overlay rescales through.
        /// </summary>
        public double FundsGainMultiplier = 1.0;

        public bool AllRequirementsMet { get; set; }

        public bool AllObjectivesMet { get; set; }

        public bool CanAccept { get; set; }

        public bool CanComplete { get; set; }

        public bool IsComplete => completedUT != 0.0;

        public bool IsActive => !IsComplete && acceptedUT != 0.0;

        public double TotalFunding => totalFunding > 0.0 ? totalFunding : baseFunding * FundsGainMultiplier;

        public void SetSpeed(Speed spd) => speed = spd;
    }

    public class ProgramModifier
    {
        public string? srcProgram;
        public string? tgtProgram;
        public double nominalDurationYears = -1.0;
        public double baseFunding = -1.0;
        public string? fundingCurve;
        public double repDeltaOnCompletePerYearEarly = -1.0;
        public double repPenaltyPerYearLate = -1.0;
        public float repToConfidence = -1f;
        public int slots = -1;

        public Dictionary<Program.Speed, float> confidenceCosts = new Dictionary<Program.Speed, float>();
    }

    /// <summary>
    /// RP-1's career-wide Program settings. Only the two members the walk reads
    /// are here; RP-1's own class carries the science-to-Confidence curve and the
    /// rep-to-Confidence rate as well, and neither is on this Uplink's wire.
    /// </summary>
    public class ProgramHandlerSettings
    {
        public string? defaultFundingCurve;

        /// <summary>
        /// RP-1 declares this as a
        /// <c>PersistentDictionaryValueTypeKey&lt;string, HermiteCurve&gt;</c>,
        /// which IS a <c>Dictionary&lt;string, HermiteCurve&gt;</c> by
        /// inheritance. A plain dictionary stands in because the walk reads it as
        /// a bare <c>IDictionary</c> and never names either type.
        /// </summary>
        public Dictionary<string, ROUtils.HermiteCurve> paymentCurves =
            new Dictionary<string, ROUtils.HermiteCurve>();
    }

    public class ProgramHandler
    {
        public static ProgramHandler? Instance { get; set; }

        /// <summary>
        /// RP-1's fresh-activation-vs-restore discriminator, not a UI flag. Read
        /// and branched on by the command, never assumed: with it true, RP-1's own
        /// OnRegister performs the program half, so a caller that also performs it
        /// accepts twice.
        /// </summary>
        public bool IsInAdmin { get; set; }

        /// <summary>
        /// The program half OnRegister skips when the screen is shut. Records the
        /// call and stamps the deadline Accept() would have assigned on the
        /// instance it returns, so a test can tell the accepted copy from the
        /// template.
        /// </summary>
        public Program ActivateProgram(Program p)
        {
            StrategyCallLog.Calls.Add("ActivateProgram");
            p.deadlineUT = 12345.0;
            ActivePrograms.Add(p);
            return p;
        }

        public static ProgramHandlerSettings? Settings { get; set; }

        public static List<Program> Programs { get; set; } = new List<Program>();

        public static List<ProgramModifier> ProgramModifiers { get; set; } = new List<ProgramModifier>();

        public List<Program> ActivePrograms { get; set; } = new List<Program>();

        public List<Program> CompletedPrograms { get; set; } = new List<Program>();

        public HashSet<string> DisabledPrograms { get; set; } = new HashSet<string>();

        /// <summary>
        /// Settable here, computed on RP-1's side from the Administration
        /// building's level. Nullable so a test can put it out of reach and prove
        /// the free-slot count goes absent rather than negative.
        /// </summary>
        public int? MaxProgramSlots { get; set; }

        public int ActiveProgramSlots
        {
            get
            {
                var total = 0;
                foreach (var p in ActivePrograms)
                {
                    total += p.slots;
                }
                return total;
            }
        }
    }
}

// ROUtils, the shared library RP-1's funding curves come from. Declared under
// its own namespace with its own member names for the same reason the RP0 graph
// above is: the walk enumerates a curve through IEnumerable<Key> and reads each
// key's fields by name, so a stand-in that spells them the same way is read by
// exactly the production code path.
namespace ROUtils
{
    /// <summary>
    /// A cubic Hermite curve. The stand-in carries the enumeration surface and
    /// the key shape, which is all the walk touches; RP-1's own class compiles
    /// polynomial coefficients and evaluates them, and the evaluation this
    /// Uplink needs is reproduced in <c>Rp1ProgramsMath.EvaluateCurve</c> rather
    /// than called.
    /// </summary>
    public class HermiteCurve : System.Collections.Generic.IEnumerable<HermiteCurve.Key>
    {
        public struct Key
        {
            public double time;
            public double value;
            public double inTangent;
            public double outTangent;

            public Key(double time, double value, double inTangent, double outTangent)
            {
                this.time = time;
                this.value = value;
                this.inTangent = inTangent;
                this.outTangent = outTangent;
            }
        }

        private readonly System.Collections.Generic.List<Key> _keys =
            new System.Collections.Generic.List<Key>();

        public HermiteCurve(params Key[] keys) => _keys.AddRange(keys);

        public int KeyCount => _keys.Count;

        public System.Collections.Generic.IEnumerator<Key> GetEnumerator() => _keys.GetEnumerator();

        System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() =>
            _keys.GetEnumerator();
    }
}
