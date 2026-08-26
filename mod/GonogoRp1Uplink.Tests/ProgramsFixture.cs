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

    public class ProgramHandler
    {
        public static ProgramHandler? Instance { get; set; }

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
