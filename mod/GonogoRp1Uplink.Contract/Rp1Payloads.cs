#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using Sitrep.Contract;

namespace GonogoRp1Uplink;

// ─────────────────────────────────────────────────────────────────────────────
// The rp1.* Topic payloads: RP-1's space-centre model, read at KSC cadence.
//
// Every channel here is DelayRole.TrueNow, matching the stock spaceCenter.* /
// career.* ground-fact convention: this is state at a space centre, not a
// reading taken from a craft.
//
// Two conventions run through the whole file and are the reason it reads the
// way it does.
//
// ABSENCE IS A FIRST-CLASS ANSWER. A rate RP-1 has not computed yet is null,
// never zero, because zero is a legitimate reading that means something else
// entirely. `Rate` and `Stalled` on a queue item are separate facts for exactly
// that reason: null rate is "not costed yet, ask again next tick", stalled is
// "costed, and going nowhere". Only the second is worth telling an operator.
//
// EVERY DERIVED NUMBER MIRRORS THE CODE THAT ADVANCES PROGRESS, not RP-1's own
// display helper. The helpers are unusable from a sampled capture: they reach
// LaunchComplex.Efficiency, whose getter constructs and PERSISTS an LCEfficiency
// on a cache miss. The arithmetic is reproduced from IncrementProgress instead,
// off data read read-only, and the two RP-1 defects it carries (an infinite
// time-left at zero rate, a NaN fraction at zero build points) come out as
// absent here rather than as numbers no client can render.
//
// These are TS-shape-only typing/codegen markers: the Uplink hand-builds the
// dicts and JsonWriter walks that live tree, so none of these POCOs serialize.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// One RP-1 space centre. RP-1 supports several (KSCSwitcher), each with its own
/// engineer pool and its own launch complexes, so every payload in this
/// namespace carries <see cref="KscName"/> as its centre key.
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.centres", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1CentreEntry
{
    /// <summary>The centre's own name, and the join key every other rp1.* payload carries.</summary>
    [SitrepUnit(Units.Id)]
    public string? KscName { get; set; }

    /// <summary>This is the centre RP-1 currently considers active.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? IsActive { get; set; }

    /// <summary>Engineers hired at this centre, assigned and unassigned together.</summary>
    [SitrepUnit(Units.Count)]
    public int? Engineers { get; set; }

    /// <summary>Engineers not currently assigned to any launch complex, so idle.</summary>
    [SitrepUnit(Units.Count)]
    public int? UnassignedEngineers { get; set; }

    /// <summary>Operational launch complexes at this centre.</summary>
    [SitrepUnit(Units.Count)]
    public int? LaunchComplexCount { get; set; }

    /// <summary>
    /// At least one launch complex BEYOND the hangar is operational, mirroring
    /// RP-1's own reading: its loop deliberately skips index 0, which is always
    /// the hangar, so this answers "is there a pad-side complex to work with"
    /// rather than "does this centre exist".
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? AnyOperational { get; set; }

    /// <summary>
    /// The ground station this centre is associated with, for a future join
    /// against the command-centre roster. Null when KSCSwitcher is not
    /// installed, which is RP-1's own answer, and also when the lookup could not
    /// be made.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? GroundStation { get; set; }
}

/// <summary>
/// One launch complex: the layer stock KSP and standalone KCT have no
/// counterpart for, and the reason a (centre, "VAB"|"SPH") key cannot express
/// RP-1's model. A complex has its own engineers, its own mass and size
/// envelope, its own efficiency that grows as its crew works, and its own queue.
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.complexes", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1ComplexEntry
{
    [SitrepUnit(Units.Id)]
    public string? KscName { get; set; }

    /// <summary>The complex's stable GUID, and the key its queue, pads and operations carry.</summary>
    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    /// <summary>RP-1's <c>LaunchComplexType</c> name: "Pad" or "Hangar".</summary>
    [SitrepUnit(Units.Enumeration)]
    public string? LcType { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? IsOperational { get; set; }

    /// <summary>Rushing: work goes faster and salaries cost more, set per COMPLEX under RP-1.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? IsRushing { get; set; }

    [SitrepUnit(Units.Count)]
    public int? Engineers { get; set; }

    [SitrepUnit(Units.Count)]
    public int? MaxEngineers { get; set; }

    /// <summary>
    /// How good this complex's crew currently is, 0..1. Null when RP-1 has no
    /// efficiency record for the complex yet: it builds one the first time the
    /// complex is worked, and a miss is a genuine "not established", never a
    /// zero-rated crew.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? Efficiency { get; set; }

    /// <summary>
    /// Integration can proceed: no blocking rollout, rollback or repair is
    /// occupying the complex. False here is why a queue item's rate is zero.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? CanIntegrate { get; set; }

    /// <summary>The complex's base build rate before efficiency and rushing are applied.</summary>
    [SitrepUnit(Contract.Units.BuildPointsPerSecond)]
    public double? Rate { get; set; }

    /// <summary>Rated to build crewed vehicles, which costs more and caps the engineer count differently.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? HumanRated { get; set; }

    [SitrepUnit(Units.Tonnes)]
    public double? MassMin { get; set; }

    /// <summary>Upper mass limit, or null for a complex with no limit (the hangar).</summary>
    [SitrepUnit(Units.Tonnes)]
    public double? MassMax { get; set; }
}

/// <summary>
/// One vehicle being integrated, from a launch complex's build list. The rate
/// and time-left are derived per the arithmetic that advances progress, not read
/// from RP-1's display helper.
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.buildQueue", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1BuildItemEntry
{
    [SitrepUnit(Units.Id)]
    public string? KscName { get; set; }

    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }

    [SitrepUnit(Units.Text)]
    public string? ShipName { get; set; }

    [SitrepUnit(Contract.Units.BuildPoints)]
    public double? Progress { get; set; }

    [SitrepUnit(Contract.Units.BuildPoints)]
    public double? TotalPoints { get; set; }

    /// <summary>Null rather than NaN on a project with no build points at all.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? ProgressRatio { get; set; }

    /// <summary>
    /// Effective rate: base rate, efficiency and the rush multiplier together,
    /// zero while the complex cannot integrate. Null until RP-1 has costed the
    /// project, which it does the first time the item progresses.
    /// </summary>
    [SitrepUnit(Contract.Units.BuildPointsPerSecond)]
    public double? Rate { get; set; }

    /// <summary>
    /// Seconds to completion at the current rate, adjusted for the crew getting
    /// better during a long build the way RP-1's own estimate is. Null at an
    /// absent or zero rate, where RP-1's own answer is an infinity.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? TimeLeftSeconds { get; set; }

    /// <summary>
    /// The rate resolved and is zero: this is costed and going nowhere. A
    /// different fact from a null <see cref="Rate"/>, and the only one of the
    /// two worth raising with an operator.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Stalled { get; set; }

    [SitrepUnit(Units.Funds)]
    public double? Cost { get; set; }

    [SitrepUnit(Units.Tonnes)]
    public double? Mass { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? HumanRated { get; set; }

    /// <summary>The launch site the vehicle is destined for, joining <c>rp1.pads[].launchSiteName</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string? LaunchSite { get; set; }

    /// <summary>RP-1's <c>ProjectType</c> name, e.g. "VAB", "SPH", "AirLaunch".</summary>
    [SitrepUnit(Units.Enumeration)]
    public string? ProjectType { get; set; }
}

/// <summary>
/// One finished vehicle sitting in a complex's warehouse. This is the honest
/// "ready to launch" set under RP-1: a craft file the editor can open is not a
/// vehicle that exists.
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.warehouse", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1WarehouseItemEntry
{
    [SitrepUnit(Units.Id)]
    public string? KscName { get; set; }

    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }

    [SitrepUnit(Units.Text)]
    public string? ShipName { get; set; }

    [SitrepUnit(Units.Funds)]
    public double? Cost { get; set; }

    [SitrepUnit(Units.Tonnes)]
    public double? Mass { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? HumanRated { get; set; }

    [SitrepUnit(Units.Id)]
    public string? LaunchSite { get; set; }

    [SitrepUnit(Units.Enumeration)]
    public string? ProjectType { get; set; }
}

/// <summary>
/// One launch pad. <see cref="State"/> is the direct answer to "may I launch
/// from here", which is why this payload subsumes what a separate rollout queue
/// used to be read for.
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.pads", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1PadEntry
{
    [SitrepUnit(Units.Id)]
    public string? KscName { get; set; }

    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }

    [SitrepUnit(Units.Id)]
    public string? PadId { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    /// <summary>Joins <c>spaceCenter.launchSites[].name</c> client-side.</summary>
    [SitrepUnit(Units.Id)]
    public string? LaunchSiteName { get; set; }

    [SitrepUnit(Units.Count)]
    public int? Level { get; set; }

    [SitrepUnit(Units.Ratio)]
    public double? FractionalLevel { get; set; }

    /// <summary>
    /// RP-1's <c>LaunchPadState</c> name: "Destroyed", "Nonoperational",
    /// "Rollout", "Rollback", "Reconditioning", "Free", or "None". Anything but
    /// "Free" means a launch aimed here will not work.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public string? State { get; set; }
}

/// <summary>
/// One rollout, rollback, reconditioning or air-launch operation on a complex:
/// how far along the thing the pad state is reporting actually is.
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.operations", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1OperationEntry
{
    [SitrepUnit(Units.Id)]
    public string? KscName { get; set; }

    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }

    /// <summary>The pad this operation is for, matching <c>rp1.pads[].name</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string? LaunchPadId { get; set; }

    /// <summary>
    /// RP-1's <c>RolloutReconType</c> name. SEVEN arms, not the five a KCT-shaped
    /// client would map: "Reconditioning", "Rollout", "Rollback", "Recovery",
    /// "None", "AirlaunchMount", "AirlaunchUnmount". A table missing the last two
    /// renders an air-launched programme as unknown.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public string? Type { get; set; }

    [SitrepUnit(Contract.Units.BuildPoints)]
    public double? Progress { get; set; }

    [SitrepUnit(Contract.Units.BuildPoints)]
    public double? TotalPoints { get; set; }

    /// <summary>
    /// Fraction done, counting the right way round for a reversed operation: a
    /// rollback and an air-launch unmount run progress DOWN to zero.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? ProgressRatio { get; set; }

    /// <summary>
    /// Effective rate, including this operation's share of the complex when
    /// several blocking operations run at once. Negative for a reversed
    /// operation, because that is the direction progress moves.
    /// </summary>
    [SitrepUnit(Contract.Units.BuildPointsPerSecond)]
    public double? Rate { get; set; }

    [SitrepUnit(Units.Seconds)]
    public double? TimeLeftSeconds { get; set; }

    /// <summary>The rate resolved and is zero, as distinct from not yet costed.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Stalled { get; set; }

    [SitrepUnit(Units.Funds)]
    public double? Cost { get; set; }

    /// <summary>The vehicle this operation is moving, or null for reconditioning.</summary>
    [SitrepUnit(Units.Id)]
    public string? AssociatedVesselId { get; set; }
}

/// <summary>
/// One node on RP-1's research queue. Global across centres, so no centre key:
/// researchers are hired once for the programme, not per space centre.
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.research", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1ResearchEntry
{
    [SitrepUnit(Units.Id)]
    public string? TechId { get; set; }

    [SitrepUnit(Units.Text)]
    public string? TechName { get; set; }

    [SitrepUnit(Units.Count)]
    public int? ScienceCost { get; set; }

    [SitrepUnit(Units.Count)]
    public double? Progress { get; set; }

    [SitrepUnit(Units.Ratio)]
    public double? ProgressRatio { get; set; }

    /// <summary>The operator's own throttle on this node, 0..1.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? WorkRate { get; set; }

    /// <summary>Science points per second. Null until RP-1 has costed the node.</summary>
    [SitrepUnit(Units.Count)]
    public double? Rate { get; set; }

    [SitrepUnit(Units.Seconds)]
    public double? TimeLeftSeconds { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? Stalled { get; set; }

    /// <summary>
    /// The calendar year this node's technology becomes cheap to research, from
    /// RP-1's era-based rate model. Absent in stock and in standalone KCT.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? StartYear { get; set; }

    [SitrepUnit(Units.Count)]
    public int? EndYear { get; set; }
}

/// <summary>
/// RP-1's labour model: who is on the payroll. No stock or KCT counterpart, and
/// the number an operator plans hiring against.
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.personnel")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1Personnel
{
    /// <summary>Engineers across every centre.</summary>
    [SitrepUnit(Units.Count)]
    public int? TotalEngineers { get; set; }

    [SitrepUnit(Units.Count)]
    public int? Researchers { get; set; }

    /// <summary>Applicants waiting to be hired.</summary>
    [SitrepUnit(Units.Count)]
    public int? Applicants { get; set; }
}

/// <summary>
/// RP-1's Confidence. A different quantity from reputation rather than a
/// replacement for it: RP-1 shows both, side by side, because they answer
/// different questions. Reputation is your income; Confidence is permission to
/// commit to a faster programme.
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.confidence")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1Confidence
{
    /// <summary>Confidence available to spend now.</summary>
    [SitrepUnit(Contract.Units.Confidence)]
    public double? Confidence { get; set; }

    /// <summary>Confidence earned over the whole career, which never falls.</summary>
    [SitrepUnit(Contract.Units.Confidence)]
    public double? Earned { get; set; }
}
