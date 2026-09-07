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
        /// The centre's buildings, read through RP-1's own denormalisation rather
        /// than through the scene, so they answer in the editor, in flight and in
        /// the tracking station as well as at the space centre. Filled by
        /// <see cref="Rp1FacilitiesReflection"/>, and empty on a stock install.
        /// </summary>
        public List<Rp1FacilityRaw> Facilities = new List<Rp1FacilityRaw>();

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

        /// <summary>
        /// Engineers hired here, and null when RP-1 would not say. Not a zero:
        /// a centre whose roster could not be read is not a centre with nobody
        /// on it, and the difference decides whether an operator thinks they
        /// have anyone to assign.
        /// </summary>
        public int? Engineers;

        /// <summary>
        /// <see cref="Engineers"/> less what the complexes hold, so absent the
        /// moment either half is. The two were read independently and a
        /// substituted zero on one side of the subtraction published a NEGATIVE
        /// idle count beside a staffed centre.
        /// </summary>
        public int? UnassignedEngineers;

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

        /// <summary>Crew on this complex, absent rather than zero when RP-1 would not say.</summary>
        public int? Engineers;

        /// <summary>
        /// The crew this complex can hold, absent rather than zero when RP-1
        /// would not say. It sits directly beside <see cref="Engineers"/> and is
        /// read off the same object, so a substituted zero here publishes a
        /// complex staffed past a cap of nobody, and darkens a hire control on a
        /// complex with room in it.
        /// </summary>
        public int? MaxEngineers;

        public double? Efficiency;
        public List<string>? EfficiencySharedWith;

        /// <summary>
        /// Whether integration can proceed, which is the absence of blocking
        /// work. Absent when the blocking total could not be summed: "nothing is
        /// blocking" and "nobody could say what is blocking" both leave the sum
        /// at zero, and only the first of them clears a vehicle to be built.
        /// </summary>
        public bool? CanIntegrate;

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
        /// The same resources with their capacities, which is what a renovation
        /// has to send back to keep them: <c>rp1.complex.modify</c> takes a SET
        /// and treats absent as none.
        /// </summary>
        public Dictionary<string, double>? ResourceCapacities;

        /// <summary>
        /// The identity RP-1 groups complexes by for crew rating. Two complexes
        /// carrying the same key are on ONE efficiency record, so work at either
        /// moves the rating at both; a different key is a different record.
        /// Derived mod-side because RP-1 compares resource amounts this payload
        /// does not carry.
        /// </summary>
        public string? EfficiencyGroupKey;
        public double? SalaryPerDay;

        /// <summary>What rushing adds to the daily crew bill, whichever mode the complex is in now.</summary>
        public double? RushSalaryDeltaPerDay;

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

        /// <summary>
        /// Build points banked so far, and null when RP-1 would not say. A
        /// substituted zero publishes a vehicle NOT STARTED, which is a claim
        /// about where the integration stands rather than a gap in the readout.
        /// </summary>
        public double? Progress;

        /// <summary>
        /// Build points the vehicle costs in total, absent rather than zero: a
        /// vehicle nobody could cost is not one that takes no work, and the
        /// fraction, the ETA and the stall flag all divide by this.
        /// </summary>
        public double? TotalPoints;

        public double? ProgressRatio;
        public double? Rate;
        public double? TimeLeftSeconds;
        public bool Stalled;

        /// <summary>
        /// What the vehicle cost to build, and null when RP-1 would not price
        /// it. A substituted zero here publishes a FREE ROCKET, which is a
        /// claim about the career's money rather than a missing readout.
        /// </summary>
        public double? Cost;

        /// <summary>Its mass, absent rather than zero when RP-1 would not weigh it.</summary>
        public double? Mass;

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

        /// <summary>
        /// RP-1's price for rolling this vehicle out, or null when it would not
        /// price one. Only ever populated for a WAREHOUSE row, for the same
        /// reason <see cref="RolloutRefusals"/> is: a vehicle still being
        /// integrated has no rollout to be quoted for.
        /// </summary>
        public double? RolloutCost;
    }

    public sealed class Rp1PadRaw
    {
        public string? KscName;
        public string? LcId;
        public string? PadId;
        public string? Name;
        public string? LaunchSiteName;

        /// <summary>
        /// The pad's tier, absent rather than zero when RP-1 would not say. Zero
        /// is a real tier a pad can sit at, so the substitution is
        /// indistinguishable from a reading, and it is the figure a client
        /// compares against an upgrade target.
        /// </summary>
        public int? Level;

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

        /// <summary>Work banked on the move, absent rather than not-started when unreadable.</summary>
        public double? Progress;

        /// <summary>What the move costs in build points, absent rather than free of work.</summary>
        public double? TotalPoints;

        public double? ProgressRatio;
        public double? Rate;
        public double? TimeLeftSeconds;
        public bool Stalled;
        public int BlockingPeers;

        /// <summary>What the move costs, absent rather than free when RP-1 would not price it.</summary>
        public double? Cost;

        /// <summary>What finishing the move still has to pay of <see cref="Cost"/>.</summary>
        public double? CostRemaining;

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

        /// <summary>Work banked on the build, absent rather than not-started when unreadable.</summary>
        public double? Progress;

        /// <summary>The build's size in build points, absent rather than no work at all.</summary>
        public double? TotalPoints;

        public double? ProgressRatio;

        /// <summary>
        /// The operator's throttle, and null when RP-1 would not say what it is.
        /// An assumed full throttle is not a neutral default: it fabricates a
        /// rate, a stall flag and a finish date on a project
        /// <see cref="Rp1ScMath.ConstructionRate"/> would otherwise have left
        /// uncosted, which is the one guard that exists here.
        /// </summary>
        public double? WorkRate;

        public double? Rate;
        public double? TimeLeftSeconds;
        public bool Stalled;

        /// <summary>The construction's price, absent rather than free when unreadable.</summary>
        public double? Cost;

        public double? SpentCost;
        public double? SpentRushCost;
    }

    public sealed class Rp1ResearchRaw
    {
        public string? TechId;
        public string? TechName;

        /// <summary>
        /// Science the node costs, absent rather than zero. This is the one
        /// currency RP-1 genuinely refuses a purchase over, so a substituted zero
        /// tells an operator a node is FREE and that they can always afford it.
        /// </summary>
        public int? ScienceCost;

        /// <summary>Science banked against it, absent rather than not-started when unreadable.</summary>
        public double? Progress;

        public double? ProgressRatio;

        /// <summary>
        /// The operator's throttle. Absent rather than 1.0 for the reason
        /// <see cref="Rp1ConstructionRaw.WorkRate"/> is.
        /// </summary>
        public double? WorkRate;
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
        /// <summary>
        /// Engineers across every centre, and absent the moment one centre would
        /// not answer: a total short by one centre's roster is a headcount the
        /// career does not have, and it reads exactly like a correct one.
        /// </summary>
        public int? TotalEngineers;

        /// <summary>
        /// Researchers hired, absent rather than zero on the terms
        /// <see cref="TotalEngineers"/> gives. A career with nobody in research
        /// genuinely sits at 0, so the substitution is indistinguishable from a
        /// reading, and it is the figure a hire control counts up from.
        /// </summary>
        public int? Researchers;

        /// <summary>Applicants waiting to be hired, absent on the same terms.</summary>
        public int? Applicants;

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
        /// <summary>
        /// Confidence available to spend, and null when the field could not be
        /// read. The same argument the instance probe makes one level up: a
        /// career that has spent its Confidence genuinely sits at 0, so a
        /// substituted zero is indistinguishable from a real broke career, and
        /// this is the figure a client compares a Program's price against.
        /// </summary>
        public double? Confidence;

        /// <summary>Career-total Confidence earned, absent on the same terms.</summary>
        public double? Earned;
    }
}
