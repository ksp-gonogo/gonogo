#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;
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

    /// <summary>
    /// Seconds to completion, SEQUENCED against the other blocking operations
    /// on this complex rather than divided out of this one's share: each
    /// survivor speeds up as its neighbours finish, so the share division alone
    /// answers early. Absent when the sequence cannot be computed, never the
    /// early figure.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? TimeLeftSeconds { get; set; }

    /// <summary>The rate resolved and is zero, as distinct from not yet costed.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Stalled { get; set; }

    /// <summary>
    /// How many OTHER blocking operations are sharing this complex. They run at
    /// once, each taking the fraction of the complex its build points earn it,
    /// so a peer is why this is slower than it looks and is what an operator
    /// reads when <see cref="TimeLeftSeconds"/> is absent.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? BlockingPeers { get; set; }

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

/// <summary>
/// One RP-1 Program, whether it is running, finished, or merely on offer.
///
/// <para>Programs are RP-1's commitment mechanic and the largest single source
/// of career funding: accepting one draws down a fixed total over a fixed
/// duration, on a curve, against a deadline that costs reputation once it
/// passes. They are a DIFFERENT mechanic from the reputation subsidy core
/// already publishes as <c>career.status.economy.subsidyPerDay</c>: the subsidy
/// is a floor that grows with the calendar and is lerped up by reputation, and
/// it arrives whether or not any Program is running. An operator reading only
/// the subsidy sees the smaller half of their income and none of the obligation
/// attached to the larger half.</para>
///
/// <para>ONE ROW SHAPE FOR EVERY STATE, discriminated by <see cref="State"/>,
/// rather than one Topic per state. RP-1's own Administration building shows
/// one list; the fields that only an accepted Program has are absent on the
/// others, which is the same distinction <see cref="Rp1WarehouseItemEntry"/>
/// already draws against a build-queue row.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.programs", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1ProgramEntry
{
    /// <summary>RP-1's internal program name, stable across releases and the join key for this row.</summary>
    [SitrepUnit(Units.Id)]
    public string? Name { get; set; }

    /// <summary>The name RP-1 shows an operator, e.g. "X-Plane Research".</summary>
    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    /// <summary>
    /// Where this Program sits: <c>active</c>, <c>completed</c>,
    /// <c>offerable</c> (requirements met, could be accepted now),
    /// <c>locked</c> (requirements not met) or <c>disabled</c> (RP-1 has ruled
    /// it out, usually because accepting a rival Program closed it off).
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public string? State { get; set; }

    /// <summary>
    /// RP-1's <c>Program.Speed</c> name: "Slow", "Normal" or "Fast". Speed is
    /// chosen at accept time and fixes both the duration and the Confidence
    /// price, so on an offerable row this is the speed currently selected in the
    /// Administration building rather than a commitment.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public string? Speed { get; set; }

    /// <summary>Program slots this occupies, against the ceiling in <see cref="Rp1ProgramSlots"/>.</summary>
    [SitrepUnit(Units.Count)]
    public int? Slots { get; set; }

    /// <summary>A crewed-spaceflight Program, which is RP-1's <c>isHSF</c> flag.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? IsHumanSpaceflight { get; set; }

    /// <summary>
    /// The catalogue duration BEFORE the speed multiplier and before the
    /// currency-modifier pass RP-1 runs over it. The duration actually in force
    /// is only observable through <see cref="DeadlineUt"/>, and only once a
    /// Program has been accepted, because RP-1 computes it by broadcasting a
    /// query to every modifier in the save and that is a thing to run rather
    /// than a thing to read.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? NominalDurationSeconds { get; set; }

    /// <summary>When this Program was accepted. Absent on anything not yet accepted.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? AcceptedUt { get; set; }

    /// <summary>
    /// When the funding runs out and the reputation penalty starts. RP-1
    /// recomputes this on every funding tick, so it tracks a Program that has
    /// been slowed or sped by a leader rather than staying at the accept-time
    /// estimate. Absent on anything not yet accepted.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? DeadlineUt { get; set; }

    /// <summary>
    /// When the objectives were met, which is when the Program becomes
    /// completable in the Administration building. Absent while they are not.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? ObjectivesCompletedUt { get; set; }

    /// <summary>When the Program was completed. Absent unless it was.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? CompletedUt { get; set; }

    /// <summary>The last funding tick. Absent on anything not yet accepted.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? LastPaymentUt { get; set; }

    /// <summary>
    /// How far through the funding curve this Program is, which is the fraction
    /// RP-1 advances rather than elapsed wall time: warping past the deadline
    /// carries it above 1. Absent on anything not yet accepted, where RP-1's own
    /// field holds -1 as its "never funded" sentinel.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? FracElapsed { get; set; }

    /// <summary>
    /// Everything this Program will pay over its whole life, at the career's
    /// funds multiplier. On a row not yet accepted this is the catalogue figure
    /// with any RP0_PROGRAM_MODIFIER already applied, matching what the
    /// Administration building offers.
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? TotalFunding { get; set; }

    /// <summary>Paid so far. Absent on anything not yet accepted.</summary>
    [SitrepUnit(Units.Funds)]
    public double? FundsPaidOut { get; set; }

    /// <summary>
    /// Still to come on this Program. Absent on anything not yet accepted rather
    /// than equal to the total, because an offer is not money owed.
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? FundsRemaining { get; set; }

    /// <summary>
    /// The named curve funding follows over the duration, e.g. "Flat" or
    /// "BimodalBackloaded". It decides whether the money arrives evenly or in
    /// the back half, which is what a payload schedule has to be planned
    /// around.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? FundingCurve { get; set; }

    /// <summary>
    /// Confidence this Program costs at <see cref="Speed"/>, read from RP-1's
    /// own per-speed table. This is the RAW cost: RP-1's Administration building
    /// shows it after a currency-modifier pass that a leader can shift, and that
    /// pass broadcasts to the whole save, so it is not run here.
    /// </summary>
    [SitrepUnit(Contract.Units.Confidence)]
    public double? ConfidenceCost { get; set; }

    /// <summary>Reputation gained per year this Program is completed early.</summary>
    [SitrepUnit(Units.Reputation)]
    public double? RepDeltaOnCompletePerYearEarly { get; set; }

    /// <summary>
    /// Reputation lost per year past the deadline, already scaled by speed:
    /// RP-1 charges a Fast Program half again as much for running late.
    /// </summary>
    [SitrepUnit(Units.Reputation)]
    public double? RepPenaltyPerYearLate { get; set; }

    /// <summary>
    /// Reputation this Program has already cost by overrunning. Absent on
    /// anything not yet accepted; zero on an accepted Program still inside its
    /// deadline, which is a real reading and not the same fact.
    /// </summary>
    [SitrepUnit(Units.Reputation)]
    public double? RepPenaltyAssessed { get; set; }

    /// <summary>
    /// The requirements to accept this Program are satisfied now. Evaluated
    /// against live game state (tech unlocked, contracts completed, facility
    /// levels, other Programs), so it moves without the row otherwise changing.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? RequirementsMet { get; set; }

    /// <summary>The objectives are satisfied, whether or not the Program is running.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? ObjectivesMet { get; set; }

    /// <summary>
    /// Accepting is possible right now on RP-1's own reading: not already
    /// active, not completed, not disabled, requirements met. It does NOT
    /// include the Confidence check, which RP-1 makes with a broadcast query;
    /// compare <see cref="ConfidenceCost"/> against <c>rp1.confidence</c> for
    /// that half.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? CanAccept { get; set; }

    /// <summary>Active, and its objectives are done, so it can be cashed in.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? CanComplete { get; set; }

    /// <summary>
    /// RP-1's own prose for what this Program needs before it can be accepted.
    /// Absent when the Program declares none. May carry KSP rich-text markup.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? RequirementsText { get; set; }

    /// <summary>
    /// RP-1's own prose for what this Program asks you to achieve. May carry KSP
    /// rich-text markup.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? ObjectivesText { get; set; }

    /// <summary>
    /// The duration actually in force, which is what the deadline, the funding
    /// curve and the payment schedule are all measured against.
    ///
    /// <para>TWO PROVENANCES, and the difference is worth knowing. On an
    /// accepted Program this is derived exactly from the state RP-1 persists:
    /// its own funding tick leaves <c>deadlineUT</c>, <c>lastPaymentUT</c> and
    /// <c>fracElapsed</c> consistent with each other, so the duration falls out
    /// of the three and carries every modifier a leader has applied. On a
    /// Program not yet accepted there is no persisted deadline to read, so this
    /// is <see cref="NominalDurationSeconds"/> scaled by the selected speed and
    /// rounded to RP-1's own quarter year: right on the shipped catalogue, and
    /// short of the truth by whatever a leader would shift it, because RP-1
    /// computes that pass by broadcasting a query to every modifier in the save
    /// and that is a thing to run rather than a thing to read.</para>
    ///
    /// <para>Absent when neither route is open: an accepted Program already past
    /// its deadline, where RP-1 stops recomputing the deadline once
    /// <c>fracElapsed</c> reaches 1 and the derivation has nothing left to
    /// divide by, and a catalogue row that declares no duration at all.</para>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? DurationSeconds { get; set; }

    /// <summary>
    /// Every speed this Program could be accepted at, with the price and the
    /// commitment each one carries. Present on an accepted row too, where it is
    /// the table the choice was made from rather than a choice still open: RP-1
    /// fixes speed at accept and <c>SetSpeed</c> refuses to move it afterwards.
    /// </summary>
    public List<Rp1ProgramSpeedOption>? SpeedOptions { get; set; }

    /// <summary>
    /// Programs accepting this one closes off, by RP-1's internal name. This is
    /// the cost that appears in neither currency: a rival Program taken off the
    /// table is funding the career can no longer ever draw. Absent rather than
    /// empty when the Program closes nothing off.
    /// </summary>
    public List<string>? ProgramsToDisableOnAccept { get; set; }

    /// <summary>
    /// The per-year funding schedule, as RP-1's own Administration building
    /// tabulates it: the funding curve sampled at each year boundary of
    /// <see cref="DurationSeconds"/> and differenced.
    ///
    /// <para>Absent on a completed Program, which is RP-1's own rule rather than
    /// a gap here: a Program that has finished paying has no schedule left, and
    /// a table of what it once would have paid reads as money still coming.</para>
    /// </summary>
    public List<Rp1ProgramPaymentEntry>? FundingPayments { get; set; }
}

/// <summary>
/// How much Program capacity the career has and how much of it is committed.
/// A singleton rather than a field on every row: the ceiling is a property of
/// the Administration building, not of any one Program.
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.programSlots")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1ProgramSlots
{
    /// <summary>
    /// Slots the Administration building's current level allows. Absent when
    /// RP-1 cannot answer, which it cannot outside a loaded career.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? MaxSlots { get; set; }

    /// <summary>Slots the active Programs occupy, summed over their own slot costs.</summary>
    [SitrepUnit(Units.Count)]
    public int? UsedSlots { get; set; }

    /// <summary>
    /// Slots left to commit. Absent when the ceiling is unknown, because a free
    /// count derived from an assumed ceiling is a fabrication about what the
    /// operator can afford to start.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? FreeSlots { get; set; }

    /// <summary>Programs currently running.</summary>
    [SitrepUnit(Units.Count)]
    public int? ActiveCount { get; set; }

    /// <summary>Programs finished over the whole career.</summary>
    [SitrepUnit(Units.Count)]
    public int? CompletedCount { get; set; }
}

/// <summary>
/// One speed a Program can be accepted at, with what that choice costs and how
/// long it commits the career for.
/// </summary>
/// <remarks>
/// RP-1's speed enum is <c>Slow, Normal, Fast</c> and the choice is made once,
/// at accept time. It is a genuine trade rather than a difficulty setting:
/// <c>Slow</c> stretches the duration by half again and is free under the
/// shipped catalogue (no <c>Slow</c> key in any CONFIDENCECOSTS node, so it
/// loads as zero), <c>Fast</c> compresses it to three quarters and charges
/// roughly double <c>Normal</c>, and running late costs reputation at a rate
/// that is itself half again higher on <c>Fast</c>. An operator choosing a
/// speed is choosing between Confidence now and calendar later, which is not a
/// decision that can be made from one row's worth of the table.
/// </remarks>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1ProgramSpeedOption
{
    /// <summary>RP-1's <c>Program.Speed</c> name: "Slow", "Normal" or "Fast".</summary>
    [SitrepUnit(Units.Enumeration)]
    public string? Speed { get; set; }

    /// <summary>
    /// Confidence this speed costs, straight out of RP-1's per-speed table.
    /// Zero is a real price and the shipped catalogue charges it for
    /// <c>Slow</c>; absent means the table could not be read.
    /// </summary>
    [SitrepUnit(Contract.Units.Confidence)]
    public double? ConfidenceCost { get; set; }

    /// <summary>
    /// How long the Program would run at this speed: the catalogue duration
    /// scaled by the speed factor and rounded to RP-1's own quarter year. It
    /// omits the currency-modifier pass a leader can shift the deadline with,
    /// for the reason given on <see cref="Rp1ProgramEntry.DurationSeconds"/>.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? DurationSeconds { get; set; }
}

/// <summary>
/// One nominal year's funding on a Program, as RP-1's own Administration
/// building tabulates it.
/// </summary>
/// <remarks>
/// The schedule is not a property of the Program alone: it is the funding curve
/// sampled at year boundaries and differenced, so it moves with the duration in
/// force and, on a running Program, starts from the year the career has already
/// reached rather than from year one. Carried as data because it is a figure
/// the game itself displays, and rebuilding it in each client is how two
/// clients come to disagree about what a career is owed.
/// </remarks>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1ProgramPaymentEntry
{
    /// <summary>
    /// The nominal year this payment lands in, counted from 1 at accept. The
    /// last year of a Program whose duration is not a whole number is short,
    /// and pays proportionally less.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? Year { get; set; }

    /// <summary>What this one year pays.</summary>
    [SitrepUnit(Units.Funds)]
    public double? Funds { get; set; }

    /// <summary>
    /// Cumulative funding through the end of this year, which is the curve's own
    /// reading rather than a running sum of the rows above: on a Program already
    /// part paid, the first row's <see cref="Funds"/> is measured from what has
    /// actually been paid out, so the two only agree from the second row on.
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? CumulativeFunds { get; set; }
}

/// <summary>
/// One key of one named funding curve, as RP-1 stores it.
/// </summary>
/// <remarks>
/// A Hermite key, not a sample: <see cref="Frac"/> and <see cref="PaidFraction"/>
/// with the two tangents that decide the shape between this key and its
/// neighbours. Twelve keys describe a whole curve, which is why the catalogue
/// travels as keys rather than as a sampled series: a resampling is a rendering
/// choice, and baking one into the wire fixes the resolution of every chart
/// drawn from it forever.
/// </remarks>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1FundingCurveKey
{
    /// <summary>
    /// How far through the Program's duration this key sits. The shipped curves
    /// run from 0 to 2, because RP-1 keeps paying past the deadline: the key at
    /// 1 is where the nominal duration ends and the key at 2 is where the curve
    /// stops, typically around 1.4 of the total.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? Frac { get; set; }

    /// <summary>
    /// The fraction of total funding paid out by this point. Cumulative, so it
    /// only ever climbs, and it is what RP-1 multiplies by the Program's total
    /// to get funds.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? PaidFraction { get; set; }

    /// <summary>Slope arriving at this key, in paid fraction per unit of elapsed fraction.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? InTangent { get; set; }

    /// <summary>Slope leaving this key, in the same units.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? OutTangent { get; set; }
}

/// <summary>
/// One of RP-1's named funding curves, keys and all.
/// </summary>
/// <remarks>
/// The catalogue is a career-wide table of twelve curves that a Program
/// references by name, so it travels once on its own Topic rather than repeated
/// on every one of thirty-seven Program rows. It changes only when the install
/// changes, which is the same cadence as the Program catalogue itself.
/// </remarks>
[SitrepContract]
[SitrepTopic("rp1.programFundingCurves", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1FundingCurveEntry
{
    /// <summary>
    /// The curve's name, which is what <see cref="Rp1ProgramEntry.FundingCurve"/>
    /// names, e.g. "Flat" or "BimodalBackloaded".
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Name { get; set; }

    /// <summary>
    /// This is the curve RP-1 falls back to. It matters because the fallback is
    /// not an error path: <c>ProgramHandlerSettings.FundingCurve</c> returns it
    /// for an empty name AND for a name it does not hold, so a Program whose
    /// <see cref="Rp1ProgramEntry.FundingCurve"/> is absent is genuinely paid on
    /// this curve rather than on none.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? IsDefault { get; set; }

    /// <summary>
    /// The keys, ascending by <see cref="Rp1FundingCurveKey.Frac"/>. Absent
    /// rather than empty when the curve could not be read: a curve with no keys
    /// pays nothing at all, which no Program in the catalogue does.
    /// </summary>
    public List<Rp1FundingCurveKey>? Keys { get; set; }
}
