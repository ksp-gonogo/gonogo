using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// One tick's reading of RP-1's space centre, as plain self-contained data:
    /// no live RP-1 or KSP object anywhere in the graph, so the engine can carry
    /// it from the main thread to the Courier thread and the mapper that turns it
    /// into wire dicts can be unit-tested with no game at all.
    /// </summary>
    /// <remarks>
    /// Every derived number (rate, time-left, progress ratio) is already computed
    /// here rather than left to the mapper, because deriving it needs one RP-1
    /// call that is only legal on the main thread: the efficiency ramp reads a
    /// settings curve through <c>LCEfficiency.PredictWeightedEfficiency</c>. The
    /// arithmetic itself lives in <see cref="Rp1ScMath"/> and is pure.
    /// </remarks>
    public sealed class Rp1ScRaw
    {
        public double Ut;

        /// <summary>
        /// RP-1 resolved, its scenario module is live, and this save is one RP-1
        /// manages. False publishes presence as false and every other channel as
        /// empty, which is the state a stock install sits in permanently.
        /// </summary>
        public bool Available;

        public List<Rp1CentreRaw> Centres = new List<Rp1CentreRaw>();
        public List<Rp1ComplexRaw> Complexes = new List<Rp1ComplexRaw>();
        public List<Rp1BuildItemRaw> BuildQueue = new List<Rp1BuildItemRaw>();
        public List<Rp1BuildItemRaw> Warehouse = new List<Rp1BuildItemRaw>();
        public List<Rp1PadRaw> Pads = new List<Rp1PadRaw>();
        public List<Rp1OperationRaw> Operations = new List<Rp1OperationRaw>();
        public List<Rp1ConstructionRaw> Constructions = new List<Rp1ConstructionRaw>();
        public List<Rp1ResearchRaw> Research = new List<Rp1ResearchRaw>();

        /// <summary>
        /// The save's craft files and what each complex would make of them. Empty
        /// when this install has no craft catalogue, which publishes an empty
        /// channel rather than nothing: an install whose core cannot open craft
        /// files has genuinely nothing to start a build from, and that is data.
        /// </summary>
        public List<Rp1BuildableRaw> Buildable = new List<Rp1BuildableRaw>();

        public Rp1PersonnelRaw? Personnel;

        /// <summary>
        /// Null when RP-1's Confidence scenario module is not live. Deliberately
        /// not a zero: <c>Confidence.CurrentConfidence</c> answers 0 for an absent
        /// instance, and zero confidence is a real reading a new career starts
        /// near, so the two must never arrive looking the same.
        /// </summary>
        public Rp1ConfidenceRaw? Confidence;

        public Rp1RushTermsRaw? RushTerms;
        public Rp1LcPricingRaw? LcPricing;

        /// <summary>
        /// The standing hire instruction, null when RP-1's space centre could not
        /// be read. An instruction that is merely unset arrives with
        /// <see cref="Rp1HireTargetRaw.Active"/> false, because an operator needs
        /// to tell "nothing scheduled" from "I cannot see the schedule": RP-1
        /// clears this silently when the complex it hires for is modified.
        /// </summary>
        public Rp1HireTargetRaw? HireTarget;

        /// <summary>The warp's fund stop-condition, null on the same terms as <see cref="HireTarget"/>.</summary>
        public Rp1FundTargetRaw? FundTarget;
    }

    public sealed class Rp1CentreRaw
    {
        public string? KscName;
        public string? KscDisplayName;
        public bool IsActive;
        public int Engineers;
        public int UnassignedEngineers;
        public int LaunchComplexCount;
        public bool AnyOperational;
        public string? GroundStation;
        public double? SalaryPerDay;
        public double? IdleSalaryPerDay;
        public double? UpkeepPerDay;
    }

    /// <summary>
    /// One fluid a complex can be built to handle, priced per unit of capacity.
    /// Null on an axis means that kind of complex does not offer the resource.
    /// </summary>
    public sealed class Rp1LcResourcePriceRaw
    {
        public string? Name;
        public double? PadCostPerUnit;
    }

    public sealed class Rp1ComplexRaw
    {
        public string? KscName;
        public string? KscDisplayName;
        public string? LcId;
        public string? Name;
        public string? LcType;
        public bool IsOperational;
        public bool IsRushing;
        public int Engineers;
        public int MaxEngineers;
        public double? Efficiency;
        public List<string>? EfficiencySharedWith;
        public bool CanIntegrate;
        public double? Rate;
        public bool HumanRated;
        public int? LaunchPadCount;
        public double? MassMin;
        public double? MassMax;
        public double? MassOrig;
        public double? SizeMaxHeight;
        public double? SizeMaxWidth;
        public double? SizeMaxDepth;
        public List<string>? ResourcesHandled;

        /// <summary>
        /// The identity RP-1 groups complexes by for crew rating. Two complexes
        /// carrying the same key are on ONE efficiency record, so work at either
        /// moves the rating at both; a different key is a different record.
        /// Derived mod-side because RP-1 compares resource amounts this payload
        /// does not carry.
        /// </summary>
        public string? EfficiencyGroupKey;
        public double? SalaryPerDay;
        public double? UpkeepPerDay;
        public double? NewPadCost;

        /// <summary>
        /// The complex's size envelope per axis in metres, or null per axis for
        /// no limit. Read for the buildable preview: a craft that fits the mass
        /// limit and not the height is the commonest refusal RP-1 gives, and an
        /// unread axis makes no comparison rather than a comparison against zero.
        /// </summary>
        public double? SizeMaxX;

        public double? SizeMaxY;

        public double? SizeMaxZ;
    }

    /// <summary>
    /// One saved craft file measured against every launch complex, as the
    /// <c>rp1.buildable</c> preview publishes it. Plain data like the rest of
    /// this file: the craft measurements arrive from core's craft catalogue and
    /// the complex limits from the walk above, and the comparison between them
    /// is pure.
    /// </summary>
    public sealed class Rp1BuildableRaw
    {
        public string? CraftFile;
        public string? ShipName;

        /// <summary>KSP's EditorFacility ordinal, carried rather than named because the client sends it back.</summary>
        public int? FacilityOrdinal;

        public int? PartCount;
        public double? Mass;
        public double? Cost;
        public string[]? MissingParts;
        public string[]? LockedParts;
        public string[]? UnpurchasedParts;

        public List<Rp1BuildableComplexRaw> Complexes = new List<Rp1BuildableComplexRaw>();
    }

    /// <summary>One complex's verdict on one craft.</summary>
    public sealed class Rp1BuildableComplexRaw
    {
        public string? LcId;
        public string? Name;
        public string? KscName;
        public string? KscDisplayName;
        public bool Eligible;
        public string[] Refusals = new string[0];
    }

    /// <summary>
    /// One vehicle, in the build list or the warehouse. One type for both:
    /// warehouse entries are the same object with the progress fields left absent,
    /// which is what "finished" means in RP-1's own model.
    /// </summary>
    public sealed class Rp1BuildItemRaw
    {
        /// <summary>RP-1's KCTPersistentID: what a command addresses, since names repeat by design.</summary>
        public string? Id;

        /// <summary>
        /// RP-1's shipID, which is a DIFFERENT id from <see cref="Id"/> and the
        /// one <see cref="Rp1OperationRaw.AssociatedVesselId"/> carries. Both are
        /// on the wire because both are needed: one addresses a vehicle, the
        /// other joins it to the rollout moving it.
        /// </summary>
        public string? ShipId;

        public string? KscName;
        public string? LcId;
        public string? ShipName;
        public double Progress;
        public double TotalPoints;
        public double? ProgressRatio;
        public double? Rate;
        public double? TimeLeftSeconds;
        public bool Stalled;
        public double Cost;
        public double Mass;
        public bool HumanRated;
        public string? LaunchSite;
        public string? ProjectType;

        /// <summary>
        /// RP-1's reasons this vehicle cannot leave its complex, or null when it
        /// has none. Only ever populated for a WAREHOUSE row: a vehicle still
        /// being integrated cannot roll out for a reason that has nothing to do
        /// with its envelope.
        /// </summary>
        public string[]? RolloutRefusals;
    }

    public sealed class Rp1PadRaw
    {
        public string? KscName;
        public string? LcId;
        public string? PadId;
        public string? Name;
        public string? LaunchSiteName;
        public int Level;
        public double? FractionalLevel;
        public string? State;

        /// <summary>
        /// The pad is in service, as opposed to still being built.
        ///
        /// <para>Published because <see cref="State"/> cannot substitute for it and
        /// the launch-complex dismantle rule turns on it: RP-1 will not remove a
        /// pad unless the complex keeps another OPERATIONAL one, and
        /// <c>LCLaunchPad.State</c> reports <c>Destroyed</c> BEFORE it consults
        /// <c>isOperational</c>, so a destroyed pad's service flag is unreadable
        /// from the state alone. Without this a client cannot tell whether a
        /// dismantle is offerable at all.</para>
        ///
        /// <para>Nullable, because the three answers are distinct: in service, not
        /// in service, and "the question could not be asked".</para>
        /// </summary>
        public bool? IsOperational;

        /// <summary>
        /// A craft is standing on the pad in PRELAUNCH. Nullable because the
        /// three answers are distinct: true, false, and "the question could not
        /// be asked", and only the first should stop a client offering the pad.
        /// </summary>
        public bool? HasVesselWaiting;

        public string? WaitingVesselName;
    }

    public sealed class Rp1OperationRaw
    {
        public string? KscName;
        public string? LcId;
        public string? LaunchPadId;
        public string? Type;
        public double Progress;
        public double TotalPoints;
        public double? ProgressRatio;
        public double? Rate;
        public double? TimeLeftSeconds;
        public bool Stalled;
        public int BlockingPeers;
        public double Cost;
        public string? AssociatedVesselId;
    }

    /// <summary>
    /// One construction at a space centre: a facility upgrade, a launch complex,
    /// or a pad. One type for all three, with the fields only one kind has left
    /// absent on the others, which is what the wire shape carries too.
    /// </summary>
    public sealed class Rp1ConstructionRaw
    {
        public string? KscName;
        public string? LcId;
        public string? Kind;
        public string? Name;
        public string? FacilityType;
        public int? CurrentLevel;
        public int? TargetLevel;
        public bool? IsModify;
        public int? EngineersToReadd;
        public string? PadId;
        public double Progress;
        public double TotalPoints;
        public double? ProgressRatio;
        public double WorkRate;
        public double? Rate;
        public double? TimeLeftSeconds;
        public bool Stalled;
        public double Cost;
        public double SpentCost;
        public double SpentRushCost;
    }

    public sealed class Rp1ResearchRaw
    {
        public string? TechId;
        public string? TechName;
        public int ScienceCost;
        public double Progress;
        public double? ProgressRatio;
        public double WorkRate;
        public double? Rate;
        public double? TimeLeftSeconds;
        public bool Stalled;
        public int? StartYear;
        public int? EndYear;
    }

    /// <summary>
    /// RP-1's standing hire instruction, read rather than derived.
    ///
    /// <para>No fraction is carried: RP-1's own <c>GetFractionComplete()</c>
    /// divides two ints before widening, so it reads zero until the last hire
    /// lands. <see cref="LeftToHire"/> is the honest reading.</para>
    /// </summary>
    public sealed class Rp1HireTargetRaw
    {
        /// <summary>False when no instruction stands, which is not the same as unreadable.</summary>
        public bool Active;

        public int? TargetCount;
        public int? CurrentCount;
        public int? LeftToHire;
        public bool? IsResearch;
        public string? LcId;
        public double? TimeLeftSeconds;
    }

    /// <summary>The balance a warp is running toward, and how far off it is.</summary>
    public sealed class Rp1FundTargetRaw
    {
        public bool Active;

        public double? TargetFunds;
        public double? OriginalFunds;
        public double? TimeLeftSeconds;
    }

    public sealed class Rp1PersonnelRaw
    {
        public int TotalEngineers;
        public int Researchers;
        public int Applicants;
        public double? EngineerSalaryPerDay;
        public double? ResearcherSalaryPerDay;
        public double? EngineerSalaryPerYear;
        public double? ResearcherSalaryPerYear;
        public double? IdleSalaryMult;
    }

    /// <summary>
    /// What rushing costs, read from RP-1's settings rather than assumed. Null
    /// when the settings could not be read, which is how a client learns to say
    /// nothing about the price instead of quoting a default.
    /// </summary>
    /// <summary>
    /// What building a complex costs, for a client pricing one that does not exist
    /// yet. See the contract's Rp1LcPricing for why this half is sent and the other
    /// half is computed.
    /// </summary>
    public sealed class Rp1LcPricingRaw
    {
        public double? AdditionalPadCostMult;
        public List<Rp1LcResourcePriceRaw>? Resources;
    }

    public sealed class Rp1RushTermsRaw
    {
        public double? RateMult;
        public double? SalaryMult;
    }

    public sealed class Rp1ConfidenceRaw
    {
        public double Confidence;
        public double Earned;
    }
}
