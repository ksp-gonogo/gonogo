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

        public Rp1PersonnelRaw? Personnel;

        /// <summary>
        /// Null when RP-1's Confidence scenario module is not live. Deliberately
        /// not a zero: <c>Confidence.CurrentConfidence</c> answers 0 for an absent
        /// instance, and zero confidence is a real reading a new career starts
        /// near, so the two must never arrive looking the same.
        /// </summary>
        public Rp1ConfidenceRaw? Confidence;
    }

    public sealed class Rp1CentreRaw
    {
        public string? KscName;
        public bool IsActive;
        public int Engineers;
        public int UnassignedEngineers;
        public int LaunchComplexCount;
        public bool AnyOperational;
        public string? GroundStation;
    }

    public sealed class Rp1ComplexRaw
    {
        public string? KscName;
        public string? LcId;
        public string? Name;
        public string? LcType;
        public bool IsOperational;
        public bool IsRushing;
        public int Engineers;
        public int MaxEngineers;
        public double? Efficiency;
        public bool CanIntegrate;
        public double? Rate;
        public bool HumanRated;
        public double? MassMin;
        public double? MassMax;
    }

    /// <summary>
    /// One vehicle, in the build list or the warehouse. One type for both:
    /// warehouse entries are the same object with the progress fields left absent,
    /// which is what "finished" means in RP-1's own model.
    /// </summary>
    public sealed class Rp1BuildItemRaw
    {
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

    public sealed class Rp1PersonnelRaw
    {
        public int TotalEngineers;
        public int Researchers;
        public int Applicants;
    }

    public sealed class Rp1ConfidenceRaw
    {
        public double Confidence;
        public double Earned;
    }
}
