using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// One tick's reading of RP-1's Programs, as plain self-contained data: no
    /// live RP-1 or KSP object anywhere in the graph, so the engine can carry it
    /// from the main thread to the Courier thread and the mapper that turns it
    /// into wire dicts can be unit-tested with no game at all. Same split, and
    /// for the same reason, as <see cref="Rp1ScRaw"/>.
    /// </summary>
    /// <remarks>
    /// A null root is a first-class answer and the reason this is not a bag of
    /// empty lists: RP-1 installed with no <c>ProgramHandler</c> live is the main
    /// menu or a save RP-1 does not manage, and "no Programs exist" is a
    /// different fact from "this career has accepted none".
    /// </remarks>
    public sealed class Rp1ProgramsRaw
    {
        public double Ut;

        public List<Rp1ProgramRaw> Programs = new List<Rp1ProgramRaw>();

        public Rp1ProgramSlotsRaw Slots = new Rp1ProgramSlotsRaw();

        /// <summary>
        /// RP-1's whole funding-curve table, read once per tick rather than per
        /// Program: a Program names a curve and thirty-seven of them share
        /// twelve curves between them.
        /// </summary>
        public List<Rp1FundingCurveRaw> Curves = new List<Rp1FundingCurveRaw>();

        /// <summary>
        /// The curve RP-1 falls back to, from <c>defaultFundingCurve</c>. Needed
        /// rather than decorative: <c>ProgramHandlerSettings.FundingCurve</c>
        /// returns it for a name it does not hold as well as for an empty one, so
        /// resolving a Program's curve without it gets the wrong answer on every
        /// Program that names none.
        /// </summary>
        public string? DefaultCurve;
    }

    /// <summary>
    /// One Program in whatever state RP-1 holds it. The fields only an accepted
    /// Program has are nullable and stay absent on the others, never zero: a
    /// Program that has paid nothing yet and one that cannot pay at all are two
    /// readings an operator acts on differently.
    /// </summary>
    public sealed class Rp1ProgramRaw
    {
        public string? Name;
        public string? Title;

        /// <summary>One of the <c>Rp1ProgramStates</c> constants.</summary>
        public string? State;

        /// <summary>RP-1's <c>Program.Speed</c> as its NAME, never its ordinal.</summary>
        public string? Speed;

        public int Slots;
        public bool IsHumanSpaceflight;
        public double? NominalDurationSeconds;

        public double? AcceptedUt;
        public double? DeadlineUt;
        public double? ObjectivesCompletedUt;
        public double? CompletedUt;
        public double? LastPaymentUt;
        public double? FracElapsed;

        /// <summary>
        /// RP-1's catalogue funding for this Program, before the career's funds
        /// multiplier. Carried alongside the total because a program modifier
        /// overwrites THIS field, and the total has to move with it.
        /// </summary>
        public double? BaseFunding;

        public double? TotalFunding;
        public double? FundsPaidOut;
        public string? FundingCurve;

        public double? ConfidenceCost;
        public double? RepDeltaOnCompletePerYearEarly;
        public double? RepPenaltyPerYearLate;
        public double? RepPenaltyAssessed;

        public bool RequirementsMet;
        public bool ObjectivesMet;
        public bool CanAccept;
        public bool CanComplete;

        public string? RequirementsText;
        public string? ObjectivesText;

        /// <summary>
        /// The whole per-speed Confidence table, keyed by speed NAME. Carried
        /// alongside the single price at the selected speed because the operator
        /// is choosing between the three, and a modifier can override any of
        /// them independently.
        /// </summary>
        public Dictionary<string, double> ConfidenceCostBySpeed = new Dictionary<string, double>();

        /// <summary>Programs this one closes off on accept, by RP-1's internal name.</summary>
        public List<string> ProgramsToDisableOnAccept = new List<string>();

        /// <summary>
        /// The duration in force, in seconds, derived from the persisted deadline
        /// on an accepted Program. Absent on a Program not yet accepted and on
        /// one already past its deadline, both of which leave the derivation
        /// nothing to read; the mapper falls back to the speed-scaled catalogue
        /// duration and the wire field says which it got.
        /// </summary>
        public double? DerivedDurationSeconds;

        /// <summary>Accepted and not yet completed, which decides where the payment schedule starts.</summary>
        public bool IsActive;

        /// <summary>Completed, which is why RP-1 shows no payment schedule at all.</summary>
        public bool IsComplete;
    }

    /// <summary>
    /// One named funding curve as RP-1 holds it: a Hermite curve's keys, read
    /// through the curve's own enumerator so the tangents are the ones it
    /// compiled rather than the ones the config file spelled.
    /// </summary>
    /// <remarks>
    /// Reading them post-compile matters for a curve whose config gives two or
    /// three values per key instead of four: RP-1 then derives the tangents
    /// itself, and the derived values are what it evaluates. The shipped table
    /// spells all four everywhere, so this is insurance rather than a
    /// correction, but it is insurance against a difference no test of ours
    /// would otherwise see.
    /// </remarks>
    public sealed class Rp1FundingCurveRaw
    {
        public string? Name;

        public List<Rp1FundingCurveKeyRaw> Keys = new List<Rp1FundingCurveKeyRaw>();
    }

    public sealed class Rp1FundingCurveKeyRaw
    {
        public double Frac;
        public double PaidFraction;
        public double InTangent;
        public double OutTangent;
    }

    /// <summary>The speed names RP-1's <c>Program.Speed</c> enum declares, in its own order.</summary>
    /// <remarks>
    /// Spelled here so the reader, the mapper and the tests share one
    /// vocabulary. The enum carries a fourth member, <c>MAX</c>, which is a count
    /// sentinel rather than a speed: RP-1's own accept loop runs <c>i &lt; 3</c>
    /// over it, and a row offering "MAX" as a choice would be offering nothing.
    /// </remarks>
    public static class Rp1ProgramSpeeds
    {
        public const string Slow = "Slow";
        public const string Normal = "Normal";
        public const string Fast = "Fast";

        public static readonly string[] All = { Slow, Normal, Fast };
    }

    public sealed class Rp1ProgramSlotsRaw
    {
        /// <summary>Absent when the Administration building's ceiling could not be read.</summary>
        public int? MaxSlots;

        public int UsedSlots;
        public int ActiveCount;
        public int CompletedCount;
    }

    /// <summary>
    /// The <c>state</c> values a program row carries. Named here rather than
    /// spelled at each site so the reader and the mapper cannot drift, and so
    /// the client has one place to read the vocabulary from.
    /// </summary>
    public static class Rp1ProgramStates
    {
        public const string Active = "active";
        public const string Completed = "completed";

        /// <summary>Requirements met and nothing in the way: acceptable now.</summary>
        public const string Offerable = "offerable";

        /// <summary>Requirements not met yet.</summary>
        public const string Locked = "locked";

        /// <summary>RP-1 has ruled it out, usually because a rival Program was accepted.</summary>
        public const string Disabled = "disabled";
    }
}
