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
