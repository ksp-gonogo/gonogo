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

    /// <summary>
    /// What to CALL this centre. <see cref="KscName"/> is an id and reads like
    /// one (<c>us_cape_canaveral</c>); this is the name KSCSwitcher's own site
    /// config gives it, and the one a surface should render.
    ///
    /// <para>Null when KSCSwitcher is not installed, which is a whole class of
    /// RP-1 career rather than an edge case, and null when the site declares no
    /// display name of its own. A client falls back to <see cref="KscName"/> in
    /// both, which is what RP-1 does too.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? KscDisplayName { get; set; }

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

    /// <summary>
    /// What this centre's engineers draw per day, RP-1's own effective figure:
    /// an unassigned engineer counts at a fraction (see
    /// <see cref="Rp1Personnel.IdleSalaryMult"/>) and a rushing complex's crew
    /// counts double, so this is not headcount times a rate.
    /// </summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? SalaryPerDay { get; set; }

    /// <summary>
    /// The part of <see cref="SalaryPerDay"/> that buys no work: what this
    /// centre's unassigned engineers draw, at RP-1's idle fraction (see
    /// <see cref="Rp1Personnel.IdleSalaryMult"/>).
    /// </summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? IdleSalaryPerDay { get; set; }

    /// <summary>
    /// What this centre's launch complexes cost per day to keep, the sum of
    /// <see cref="Rp1ComplexEntry.UpkeepPerDay"/> across them. The facilities'
    /// own upkeep is not in it: those are one set per career rather than per
    /// centre.
    /// </summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? UpkeepPerDay { get; set; }
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

    /// <summary>
    /// The centre's display name, carried here as well as on
    /// <see cref="Rp1CentreEntry.KscDisplayName"/> for the same reason
    /// <see cref="KscName"/> is: a complex row is rendered on surfaces that never
    /// join to the centres channel, and those are exactly the ones that were
    /// printing an id at the operator. Absent on the same two conditions.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? KscDisplayName { get; set; }

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
    /// The OTHER complexes whose crew rating is the same record as this one's,
    /// by their <see cref="LcId"/>, sorted, this complex excluded.
    ///
    /// <para><see cref="Efficiency"/> alone is misleading and this is what fixes
    /// it. RP-1 does not rate a complex, it rates an <c>LCEfficiency</c> record
    /// and attaches similar complexes to the same one, so the number here is a
    /// figure two or three complexes SHARE: work done at any of them moves it at
    /// all of them, and a client that reads it as this complex's own crew will
    /// report a rating that climbed while nobody worked here.</para>
    ///
    /// <para>A list of the peers rather than an id for the record, because RP-1
    /// keeps no id on one and a synthetic key would be ours rather than the
    /// game's. Null when RP-1 holds no record: the hangar, which is rated at the
    /// ceiling and shares with nothing, and a pad complex nobody has worked yet,
    /// the same miss that leaves <see cref="Efficiency"/> null. EMPTY is the
    /// different, real answer that the record exists and covers this complex
    /// alone.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public List<string>? EfficiencySharedWith { get; set; }

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

    /// <summary>
    /// How many of this complex's pads are OPERATIONAL, RP-1's own
    /// <c>LaunchPadCount</c>, and the number the pad-dismantle rule is stated
    /// against: RP-1 will only delete a pad while the complex still has two.
    ///
    /// <para>Not derivable from the <c>rp1.pads</c> rows beside it, which is why
    /// it is here rather than left to a client. A pad's <c>state</c> tests
    /// destroyed FIRST, so a pad that has been wrecked reports <c>Destroyed</c>
    /// whatever its operational flag says, and counting rows that are not
    /// <c>Nonoperational</c> gets the wrong answer exactly when a launch has just
    /// gone badly.</para>
    ///
    /// <para>Zero is a REAL answer and never means absent: a pad complex still
    /// under construction has pads and none of them operational, which is the
    /// state that makes it unusable.</para>
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? LaunchPadCount { get; set; }

    /// <summary>
    /// The LIGHTEST vehicle this complex will accept, RP-1's
    /// <c>floor(massMax * lcMassMinFraction)</c>.
    ///
    /// <para>An eligibility floor, and NOT the bottom of the renovation envelope.
    /// That is <see cref="MassOrig"/>'s business, and confusing the two is the
    /// standing trap of this payload: three tonnage figures, one of which is
    /// about vehicles and two of which are about the complex.</para>
    /// </summary>
    [SitrepUnit(Units.Tonnes)]
    public double? MassMin { get; set; }

    /// <summary>Upper mass limit, or null for a complex with no limit (the hangar).</summary>
    [SitrepUnit(Units.Tonnes)]
    public double? MassMax { get; set; }

    /// <summary>
    /// The tonnage this complex was ORIGINALLY built at, and the only thing that
    /// bounds renovating it. RP-1 refuses a modify unless the new
    /// <see cref="MassMax"/> lands inside
    /// <c>max(3, floor(massOrig * 2))</c> and <c>max(1, ceil(massOrig * 0.5))</c>,
    /// so without this a client cannot compute either end of the envelope and
    /// cannot say whether a renovation it is about to offer is legal.
    ///
    /// <para><b><see cref="MassMax"/> is not a substitute for it.</b> MassMax is
    /// the value the envelope CONTAINS and the value a renovation moves; it
    /// equals this only on a complex nobody has renovated. <see cref="MassMin"/>
    /// is a third quantity again, about which vehicles fit rather than about
    /// renovation.</para>
    ///
    /// <para>Fixed for the life of the complex: RP-1 sets it once at creation and
    /// carries it across every modify, so one reading is enough and a stale one
    /// is still right.</para>
    ///
    /// <para>Null for the hangar, which RP-1 records at its no-limit sentinel and
    /// exempts from the margin check outright. Null rather than zero ALWAYS: a
    /// zero here computes an envelope of 3t to 1t, which is a confident wrong
    /// answer where absence is a readable one.</para>
    /// </summary>
    [SitrepUnit(Units.Tonnes)]
    public double? MassOrig { get; set; }

    /// <summary>
    /// The tallest vehicle this complex will take, RP-1's <c>sizeMax.y</c>. Null
    /// for an unlimited complex, on the same rule <see cref="MassMax"/> follows.
    /// </summary>
    [SitrepUnit(Units.Metres)]
    public double? SizeMaxHeight { get; set; }

    /// <summary>The complex's footprint limit across, RP-1's <c>sizeMax.x</c>.</summary>
    [SitrepUnit(Units.Metres)]
    public double? SizeMaxWidth { get; set; }

    /// <summary>
    /// The complex's footprint limit the other way, RP-1's <c>sizeMax.z</c>.
    ///
    /// <para>Three fields rather than one, because RP-1 keeps three and they are
    /// free to differ. Its own tooltip prints them depth, width, height.</para>
    /// </summary>
    [SitrepUnit(Units.Metres)]
    public double? SizeMaxDepth { get; set; }

    /// <summary>
    /// The resources this complex can load, by RP-1's own resource names, sorted.
    ///
    /// <para>An ELIGIBILITY fact and not a capacity: a vehicle needing a
    /// resource absent from this list cannot be built here at all, however the
    /// complex is staffed. Empty is a real answer for a complex that handles
    /// none, and null is RP-1 not having said.</para>
    ///
    /// <para>The CAPACITIES behind these names are
    /// <see cref="ResourceCapacities"/>, and a client renovating the complex
    /// needs those rather than these.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public List<string>? ResourcesHandled { get; set; }

    /// <summary>
    /// How much of each resource the complex is built to load, keyed by RP-1's
    /// own resource name, in units of that resource.
    ///
    /// <para><b>Carried because a renovation cannot be commanded without it.</b>
    /// <c>Rp1ComplexModifyArgs.Resources</c> is a SET and absent means NONE, so a
    /// client that renovates the tonnage and says nothing about resources strips
    /// every one of them: RP-1 would then price the removal, strand any vehicle
    /// that needed the fluid, and leave a complex that cannot fuel what it was
    /// built for. A client that means "keep these" has to send them, and it can
    /// only do that if it can read them.</para>
    ///
    /// <para><b>The unit IS established, and an earlier note here said
    /// otherwise.</b> RP-1 keeps
    /// <c>LCData.resourcesHandled</c> as a <c>Dictionary&lt;string, double&gt;</c>
    /// and prices it through <c>Formula.ResourceTankCost(name, amount, ...)</c>,
    /// which is linear in the amount and is the same expression
    /// <see cref="Rp1LcResourcePrice.PadCostPerUnit"/> is stated per unit of. So
    /// an entry here multiplied by that price is the resource half of a build,
    /// exactly.</para>
    ///
    /// <para>Not <see cref="SitrepUnitAttribute"/>-tagged, and it cannot be: the
    /// unit differs per KEY, because a unit of liquid oxygen and a unit of
    /// kerosene are different quantities. A per-resource number is what RP-1
    /// stores and what <c>Rp1ComplexNewArgs.Resources</c> already takes, so the
    /// reading matches the command's own shape.</para>
    ///
    /// <para>Null is RP-1 not having said. EMPTY is the real, different answer
    /// that the complex handles nothing, which is most early-career pads.</para>
    /// </summary>
    public Dictionary<string, double>? ResourceCapacities { get; set; }

    /// <summary>
    /// The identity RP-1 groups complexes by for crew rating: complexes sharing
    /// this key are on ONE efficiency record.
    ///
    /// <para>Efficiency is a MEMBERSHIP, not a relationship. RP-1 rates an
    /// <c>LCEfficiency</c> rather than a complex, and attaches a complex to an
    /// existing record only when its mass limit, size limits, type, human rating
    /// and handled resources are ALL equal, so the complexes carrying one key are
    /// an equivalence class. Group by this rather than by centre: two identical
    /// complexes at DIFFERENT space centres share a record, and two complexes at
    /// one centre with different mass limits do not.</para>
    ///
    /// <para>Derived by this Uplink rather than left to a client, because the
    /// equality RP-1 tests is over five things at once and getting it exactly
    /// right is the producer's job: a client comparing four of them would be
    /// right until two complexes differed only in the fifth. The amounts it
    /// compares are on the wire as <see cref="ResourceCapacities"/>, so a client
    /// COULD now reconstruct this; it should not, because the key is RP-1's
    /// equivalence and not an arithmetic result.</para>
    ///
    /// <para>It names a group and nothing else: it is not an RP-1 id, it is not
    /// stable across game versions, and it must never be shown to an operator.
    /// Null when the pieces could not be read, which is NOT "belongs to no
    /// group": every complex RP-1 can rate belongs to exactly one.</para>
    ///
    /// <para>Does not capture the whole model. Complexes that are merely SIMILAR
    /// still move each other's ratings: <c>IncreaseEfficiency(..., distribute)</c>
    /// pays every other record a share scaled by closeness, so a rating can climb
    /// where nobody worked. This key answers who shares a number, never what else
    /// moves it.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? EfficiencyGroupKey { get; set; }

    /// <summary>
    /// What this complex's crew draws per day, at RP-1's own effective count: a
    /// rushing complex pays double, and a complex nothing is active in pays its
    /// crew at the idle fraction.
    /// </summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? SalaryPerDay { get; set; }

    /// <summary>
    /// What the complex itself costs per day, crew aside: RP-1's launch-complex
    /// maintenance, scaled by the number of pads it has. A complex still being
    /// built pays it in proportion to how far the construction has got, which is
    /// RP-1's own rule and not a smoothing applied here.
    /// </summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? UpkeepPerDay { get; set; }

    /// <summary>
    /// What ONE more launch pad at this complex would cost, which is the price
    /// <c>rp1.pad.new</c> commits the career to.
    ///
    /// <para>A curve over the complex's own tonnage and envelope times RP-1's
    /// additional-pad multiplier, so it differs per complex and cannot be a
    /// constant in the client. It is published rather than derived because the
    /// curve has a second term above 350 t and a human-rating multiplier, and a
    /// reimplementation in TypeScript would agree with the transcription rather
    /// than with RP-1.</para>
    ///
    /// <para>ABSENT for a hangar, which has no pad to add, and whenever RP-1
    /// would not price one. Absent is NOT free: a control must refuse to quote
    /// rather than quote zero.</para>
    ///
    /// <para>Note the money does not leave at the press. RP-1 draws a
    /// construction down as it builds, and a career that cannot afford a tick
    /// gets a proportionally slower build rather than a refusal, so this is a
    /// total committed and not a debit.</para>
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? NewPadCost { get; set; }
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
    /// <summary>
    /// RP-1's own stable identity for this vehicle (<c>KCTPersistentID</c>), and
    /// the ONLY thing a command may address it by.
    ///
    /// <para>A name cannot do the job. The repeat-build loop that this Uplink's
    /// commands exist for produces several vehicles of the SAME name at the same
    /// complex on purpose, which is what building another one of a design means,
    /// so <see cref="ShipName"/> plus <see cref="LcId"/> stops identifying a row
    /// the moment the feature is used once.</para>
    ///
    /// <para>Null on a vehicle RP-1 has not stamped, which a save carried across
    /// an old KCT version can be. A row with no id is readable and not
    /// commandable, and the client must render it that way rather than guessing
    /// a target.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    /// <summary>
    /// RP-1's <c>shipID</c>, and the ONLY key that joins this vehicle to the
    /// rollout, rollback or recovery moving it.
    ///
    /// <para>A second id, and it has to be. <see cref="Id"/> is
    /// <c>KCTPersistentID</c>, which is what a command addresses; RP-1 stamps
    /// an operation's <c>associatedID</c> from <c>shipID</c> instead
    /// (<c>ReconRolloutProject.associatedID</c>, published here as
    /// <see cref="Rp1OperationEntry.AssociatedVesselId"/>). Without this field
    /// on the wire a client can read that a rollout is happening and cannot say
    /// WHICH vehicle it is happening to, which is precisely the fact that
    /// decides whether a row offers Roll Out or Roll Back.</para>
    ///
    /// <para>Not solved by making the operation carry the persistent id
    /// instead: <c>associatedID</c> is RP-1's own field, a reconditioning has
    /// no vehicle at all, and reporting something else under that name would be
    /// a lie about what RP-1 stores.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? ShipId { get; set; }

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
    /// <summary>
    /// RP-1's <c>KCTPersistentID</c>. See <see cref="Rp1BuildItemEntry.Id"/> for
    /// why a command addresses this and never a name; the warehouse is where the
    /// duplicate names pile up fastest, because a design flown twice was built
    /// twice.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    /// <summary>
    /// RP-1's <c>shipID</c>. See <see cref="Rp1BuildItemEntry.ShipId"/> for why
    /// a vehicle carries two ids; this is the list where it matters, because a
    /// rollout only ever moves a FINISHED vehicle and so every rollout on the
    /// wire joins to a row here.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? ShipId { get; set; }

    /// <summary>
    /// RP-1's own reasons this vehicle cannot be rolled out of the complex
    /// holding it, in its own words. Null when it has none, which is the
    /// eligible case.
    ///
    /// <para><b>Why this is on the wire rather than computed by the client.</b>
    /// Eligibility has two halves and they live at different levels. The pad half
    /// is per-pad and is <see cref="Rp1PadEntry.State"/> plus
    /// <see cref="Rp1PadEntry.HasVesselWaiting"/>. This is the VEHICLE half, and
    /// it is per-COMPLEX rather than per-pad: the same answer for every pad the
    /// complex owns, because what it measures is the vehicle against the
    /// complex's envelope. Publishing it per (vehicle, pad) pair would be an
    /// N-by-M matrix restating one fact.</para>
    ///
    /// <para>It could ALMOST be derived client-side, and that is the trap. Mass,
    /// the complex's ceiling and floor and its human rating are all already
    /// published, but the vehicle's SIZE is not, so an axis check is impossible
    /// there; and a client that reproduced the rest would be the third
    /// independent copy of RP-1's envelope rule in this repo, after the launch
    /// gate and the command. Copies of a rule drift, and a client copy would
    /// drift where nothing tests it.</para>
    ///
    /// <para>Null carries the same meaning an unreadable envelope has everywhere
    /// else here: OFFER the control and let the command refuse. The command
    /// re-checks at the moment of the press against the live object, so the worst
    /// case is a refusal one step later, against the certainty of hiding a
    /// control that would have worked.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string[]? RolloutRefusals { get; set; }

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

    /// <summary>
    /// The pad is in service, as opposed to still being built.
    ///
    /// <para><b>Not derivable from <see cref="State"/>, which is why it is here.</b>
    /// RP-1's <c>LaunchPadState</c> reports <c>Destroyed</c> BEFORE it consults the
    /// service flag, and a pad can be both destroyed and in service, and that is
    /// exactly the pad awaiting reconditioning after its own launch. So a pad
    /// reading "Destroyed" says nothing about whether it counts as one of the
    /// complex's working pads.</para>
    ///
    /// <para>That count is what the pad-dismantle rule turns on: RP-1 will not
    /// remove a pad unless the complex keeps another OPERATIONAL one, and it
    /// enforces that by silently doing nothing. A client without this field cannot
    /// tell whether <c>rp1.pad.dismantle</c> is offerable, which is what it was
    /// added for.</para>
    ///
    /// <para>Null when the question could not be asked, which is not false: the
    /// command re-checks it at the press.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? IsOperational { get; set; }

    /// <summary>
    /// A craft is already standing on this pad in <c>PRELAUNCH</c>, so nothing
    /// else may be rolled out to it.
    ///
    /// <para><b>The one condition <see cref="State"/> cannot express, and the
    /// reason this field had to exist.</b> That property derives its answer from
    /// the OPERATIONS on the pad, and a vehicle already sent to the launch site
    /// has no operation left: it simply sits there. So a pad in exactly this
    /// state reports "Free" and refuses a rollout, and a client choosing from
    /// state alone would offer a pad the mod can only reject. RP-1 asks the same
    /// question separately, through
    /// <c>LCLaunchPad.HasVesselWaitingToBeLaunched</c>.</para>
    ///
    /// <para>Null when the question could not be answered, which is not the same
    /// as false: an unreadable answer means the client should still offer the pad
    /// and let the command decide, because the mod re-checks it at the moment of
    /// the press.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? HasVesselWaiting { get; set; }

    /// <summary>
    /// The vessel already standing on the pad, by name, for a client that wants
    /// to say WHICH craft is in the way. Null whenever
    /// <see cref="HasVesselWaiting"/> is not true.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? WaitingVesselName { get; set; }
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
/// One thing being BUILT at a space centre, as opposed to one vehicle being
/// integrated inside it. Three RP-1 project kinds share this row shape: a
/// facility upgrade, a launch complex being built or modified, and a pad being
/// added to a complex.
///
/// <para>The other half of the schedule. <c>rp1.buildQueue</c> carries vehicle
/// integration, which is the half that moves in weeks; construction is the half
/// that moves in months and consumes the funds a Program pays out. An operator
/// reading only the queue sees the fast half of an RP-1 career's calendar.</para>
///
/// <para><b>Construction runs in PARALLEL, and integration does not.</b> RP-1
/// zeroes a vehicle's rate at any queue position but the head, and a research
/// node's likewise, so those two queues advance one item at a time. A
/// construction's rate does not depend on its queue position at all, so every
/// row here is moving at once. It does not depend on engineers either: a
/// construction rate is a per-day constant scaled by the career's own modifiers,
/// which is why no engineer count appears on this row.</para>
///
/// <para>ONE ROW SHAPE DISCRIMINATED BY <see cref="Kind"/>, the same choice
/// <see cref="Rp1ProgramEntry"/> argues for: the fields only one kind has are
/// absent on the others rather than split across three Topics that would have to
/// be read together to answer "what is being built here".</para>
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.constructions", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1ConstructionEntry
{
    [SitrepUnit(Units.Id)]
    public string? KscName { get; set; }

    /// <summary>
    /// The launch complex this construction concerns, joining
    /// <c>rp1.complexes[].lcId</c>: the complex being built for a
    /// <c>LaunchComplex</c> row, the complex gaining a pad for a <c>Pad</c> row.
    /// Absent on a facility upgrade, which belongs to the centre rather than to
    /// any complex.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }

    /// <summary>
    /// Which of RP-1's three construction projects this is:
    /// <c>FacilityUpgrade</c>, <c>LaunchComplex</c> or <c>Pad</c>. These are this
    /// contract's own names, not RP-1 enum members, because RP-1 draws the
    /// distinction with three separate types rather than one enum.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public string? Kind { get; set; }

    /// <summary>
    /// What is being built, in RP-1's own words: the facility's short name, the
    /// launch complex's name, or the new pad's name. Read from the project's
    /// stored name rather than through RP-1's display helper, which localises a
    /// facility name and walks the centre roster for a pad.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    /// <summary>
    /// The <c>SpaceCenterFacility</c> enum name being upgraded, e.g.
    /// "VehicleAssemblyBuilding". Present only on a <c>FacilityUpgrade</c> row:
    /// RP-1's base project answers "LaunchPad" for the other two kinds as its
    /// transaction category, which is not a claim about a facility and must not
    /// arrive looking like one.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public string? FacilityType { get; set; }

    /// <summary>The level the facility is at now. FacilityUpgrade rows only.</summary>
    [SitrepUnit(Units.Count)]
    public int? CurrentLevel { get; set; }

    /// <summary>The level it is being taken to. FacilityUpgrade rows only.</summary>
    [SitrepUnit(Units.Count)]
    public int? TargetLevel { get; set; }

    /// <summary>
    /// This is a MODIFICATION of an existing launch complex rather than a new
    /// one. LaunchComplex rows only, and the distinction is what an operator
    /// plans around: a modify takes the complex out of service while it runs.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? IsModify { get; set; }

    /// <summary>
    /// Engineers RP-1 will put back on the complex when the work finishes. They
    /// are off it for the duration, which is why the centre's unassigned count
    /// rises the moment a modify is queued. LaunchComplex rows only.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? EngineersToReadd { get; set; }

    /// <summary>The pad being built, joining <c>rp1.pads[].padId</c>. Pad rows only.</summary>
    [SitrepUnit(Units.Id)]
    public string? PadId { get; set; }

    [SitrepUnit(Contract.Units.BuildPoints)]
    public double? Progress { get; set; }

    [SitrepUnit(Contract.Units.BuildPoints)]
    public double? TotalPoints { get; set; }

    /// <summary>Null rather than NaN on a project with no build points at all.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? ProgressRatio { get; set; }

    /// <summary>
    /// The operator's own throttle on this construction, 0 to 1.5. Above 1 is
    /// RUSHING, which buys speed at a higher daily cost.
    ///
    /// <para>RP-1 shows the cost multiplier that buys beside this figure, and
    /// this contract does not carry it: the multiplier comes off a curve in an
    /// assembly whose body could not be read, and a fabricated cost on a
    /// months-long commitment is worse than an absent one. The throttle itself is
    /// a plain stored field and is the fact that says a construction is being
    /// rushed at all.</para>
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? WorkRate { get; set; }

    /// <summary>
    /// Effective rate: the costed base rate times the throttle. Null until RP-1
    /// has costed the project, which it does when the construction queue changes
    /// or the career's own rate modifiers move, so a freshly loaded save can
    /// legitimately answer nothing here.
    /// </summary>
    [SitrepUnit(Contract.Units.BuildPointsPerSecond)]
    public double? Rate { get; set; }

    /// <summary>
    /// Seconds to completion at the current rate. No efficiency ramp, unlike a
    /// vehicle: a construction's rate does not improve with the crew, because it
    /// has no crew.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? TimeLeftSeconds { get; set; }

    /// <summary>
    /// The rate resolved and is zero: costed and going nowhere, which under RP-1
    /// means the throttle is at zero. A different fact from a null
    /// <see cref="Rate"/>.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Stalled { get; set; }

    /// <summary>The whole price of the work, quoted when it was queued.</summary>
    [SitrepUnit(Units.Funds)]
    public double? Cost { get; set; }

    /// <summary>
    /// Paid so far. A construction is billed AS IT PROGRESSES rather than up
    /// front, so this and <see cref="Cost"/> together are the only place a
    /// part-paid commitment is visible: cancel at half done and half the money is
    /// gone.
    ///
    /// <para>RP-1's own remaining-cost figure is not carried, and the difference
    /// of these two is not it: RP-1 runs the outstanding balance through a
    /// currency query that broadcasts to every modifier in the save, so the
    /// number it shows includes leader effects this Uplink will not evaluate.
    /// What is here are the two stored quantities, unmodified.</para>
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? SpentCost { get; set; }

    /// <summary>
    /// Of what has been paid, how much went on rushing. Equal to
    /// <see cref="SpentCost"/> on a construction that was never rushed.
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? SpentRushCost { get; set; }
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

    /// <summary>
    /// What every engineer on the books draws per day, across all centres, at
    /// RP-1's own effective count. Higher than the sum of the assigned crews
    /// whenever engineers sit unassigned, and higher again while a complex
    /// rushes.
    /// </summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? EngineerSalaryPerDay { get; set; }

    /// <summary>
    /// What the researchers draw per day. Paid at the idle fraction while the
    /// research queue is empty, which is RP-1's rule and the reason this is not
    /// headcount times the yearly rate.
    /// </summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? ResearcherSalaryPerDay { get; set; }

    /// <summary>One engineer's full salary for a year, before any multiplier.</summary>
    [SitrepUnit(Units.Funds)]
    public double? EngineerSalaryPerYear { get; set; }

    /// <summary>One researcher's full salary for a year, before any multiplier.</summary>
    [SitrepUnit(Units.Funds)]
    public double? ResearcherSalaryPerYear { get; set; }

    /// <summary>
    /// The fraction of a full salary an engineer draws while assigned to nothing.
    /// The number that makes an idle pool a standing cost rather than a free
    /// reserve, so it is published even though a client could not derive it.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? IdleSalaryMult { get; set; }

    /// <summary>
    /// The standing instruction to hire up to a number, null when RP-1's state
    /// could not be read at all. Lives on the personnel Topic because it is a
    /// fact about staffing rather than about any one complex, even when it names
    /// one.
    ///
    /// <para>ONE slot, not one per kind: RP-1 holds a single target and
    /// <see cref="Rp1HireTarget.IsResearch"/> says which kind it hires, so
    /// setting a researcher target replaces an engineer one.</para>
    /// </summary>
    public Rp1HireTarget? HireTarget { get; set; }
}

/// <summary>
/// What it costs to BUILD here: the terms a client needs to price a complex the
/// operator is still describing.
///
/// <para><b>Why this exists at all, when a built complex's prices are published
/// on the complex.</b> A renovation or a new pad is priced against something that
/// already exists, so its figure can be computed where RP-1 lives and sent. A NEW
/// complex is priced against what the operator is typing, and there is no such
/// thing to hang a figure on. Asking the mod per keystroke is not an option: these
/// commands are delay-aware and a career commanding from a remote vantage would
/// wait minutes for each quote, so a form that could not price until a round trip
/// returned could not price at all.</para>
///
/// <para><b>So the split is by whether the arithmetic needs GAME DATA.</b> The pad
/// and integration halves of RP-1's price are a closed form over tonnage, envelope
/// and human rating, touching nothing but the numbers the operator entered; a
/// client computes those. The resource half needs a tank definition, a resource
/// definition and a settings multiplier per resource, none of which a client can
/// know, so it is sent. It is one number per resource because RP-1's own
/// expression is LINEAR in the amount: everything else in
/// <c>Formula.ResourceTankCost</c> is constant per resource, so a client
/// multiplies and is exactly right rather than approximately.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.lcPricing")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1LcPricing
{
    /// <summary>
    /// What every pad past the first costs, as a fraction of the pad price.
    ///
    /// <para>Applied ONCE when a pad is added to a complex. A renovation uses the
    /// same figure differently, as <c>1 + (pads - 1) * mult</c>, because that one
    /// reprices every pad the complex already has.</para>
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? AdditionalPadCostMult { get; set; }

    /// <summary>
    /// The fluids a complex can be built to handle, and what each costs per unit.
    ///
    /// <para>ABSENT means RP-1 would not say, which a form must refuse to price on
    /// rather than treat as an empty list: a complex quoted without its resources
    /// is quoted under its true cost.</para>
    /// </summary>
    public List<Rp1LcResourcePrice>? Resources { get; set; }
}

/// <summary>
/// One fluid a complex can be built to handle, and what a unit of it adds to the
/// build price.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1LcResourcePrice
{
    /// <summary>The KSP resource name, which is the key the command takes.</summary>
    [SitrepUnit(Units.Id)]
    public string? Name { get; set; }

    /// <summary>
    /// Funds per unit of capacity, for a PAD complex.
    ///
    /// <para>RP-1's own expression is linear in the amount, so this is the whole of
    /// it and a client multiplies. ABSENT where a pad complex ignores this resource,
    /// which is not the same as zero: ignored means the resource cannot be chosen,
    /// where zero would mean it is free.</para>
    ///
    /// <para><b>There is no hangar twin, and that is not an omission.</b> RP-1 keeps
    /// a separate ignore mask for hangars, so the figure would genuinely differ, but
    /// nothing can reach it: a career's one hangar is seeded from
    /// <c>LCData.StartingHangar</c> and can never be built, and
    /// <c>rp1.complex.new</c> assigns <c>Pad</c> unconditionally. The only path that
    /// would price a hangar's resources is a renovation, and there is no control for
    /// one. Publish the twin the day that control exists, not before.</para>
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? PadCostPerUnit { get; set; }
}

/// <summary>
/// What rushing a launch complex costs, career-wide.
///
/// <para>Published whether or not anything is currently rushing, and that is the
/// point: the operator decides at the moment nothing is, so the terms have to be
/// readable then. RP-1 takes them from its own settings, so they are not
/// constants a client may carry.</para>
///
/// <para>A third term is not a number and so is not here: a complex earns no
/// efficiency at all while it rushes, and efficiency is what makes a crew
/// cheaper over a career. That one is stated by the client.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.rushTerms")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1RushTerms
{
    /// <summary>How much faster a rushing complex works.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? RateMult { get; set; }

    /// <summary>How much more a rushing complex's crew draws.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? SalaryMult { get; set; }
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
    [SitrepUnit(Units.Id)]
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


// ─────────────────────────────────────────────────────────────────────────────
// RP-1's crew bookkeeping: the personnel-scheduling game an RP-1 career largely
// IS, and which reached an operator not at all.
//
// The two channels below are joined to the stock roster by NAME
// (spaceCenter.crewRoster[].name). They deliberately do NOT restate a kerbal's
// trait, rank, courage or standing: core already publishes all of that, RP-1
// does not own any of it, and a second copy is a second thing to disagree.
//
// The one place RP-1 does own an answer core cannot reach is whether a kerbal is
// RETIRED, and that does not appear here either. It rides the stock roster's own
// `standing` field, through the crewStanding capability, because a retiree must
// not read as a fatality to a widget that has never heard of RP-1. See
// Sitrep.Contract/CrewStanding.cs.
//
// SENTINELS. RP-1's crew getters answer 0 for "no record" (GetRetireTime,
// GetRetireIncreaseTime) and -1 for "not in a course" (GetTrainingFinishTime).
// A kerbal whose retirement date is unknown is not a kerbal retiring at UT
// zero, so every one of those becomes absent here.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// One kerbal's RP-1 schedule: when their career ends, what they are training on
/// now, and what training they are about to lose.
///
/// <para>The channel is a BARE ARRAY of these entries, one per kerbal RP-1 has
/// any record of, keyed by <see cref="Name"/>. That is deliberately NOT the
/// whole roster: RP-1 tracks a retirement date for crew it manages, and a kerbal
/// with no row is a kerbal RP-1 is not scheduling, which is a different answer
/// from one whose dates are all absent.</para>
///
/// <para>The whole payload is <c>null</c> when RP-1's CrewHandler is not live
/// (the main menu, and any save RP-1 does not manage). An empty array would say
/// "RP-1 is scheduling nobody", which is a claim about the career.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.crew", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1CrewEntry
{
    /// <summary>The kerbal's <c>ProtoCrewMember.name</c>: the join key to <c>spaceCenter.crewRoster</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string? Name { get; set; }

    /// <summary>
    /// Whether RP-1 counts this kerbal as a retiree. The SAME fact the
    /// crewStanding capability puts on the stock roster, carried here as well
    /// because this channel is read by a surface that is already looking at RP-1
    /// rows and should not have to join back to answer "did this schedule
    /// complete".
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Retired { get; set; }

    /// <summary>
    /// When this kerbal retires, as universal time. Absent when RP-1 holds no
    /// retirement date for them, which is a real state (a kerbal hired this tick,
    /// or a save where retirement is switched off) and NOT a retirement due now:
    /// RP-1's own getter answers 0 there, and 0 is a date.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? RetiresAtUt { get; set; }

    /// <summary>
    /// The furthest that date could still be pushed: the current date plus the
    /// extension this kerbal has not yet spent. RP-1 caps the total extension a
    /// career can earn per kerbal, so this is a CEILING rather than a forecast,
    /// and it is what makes <see cref="RetiresAtUt"/> actionable: a date three
    /// years out that can be pushed to fifteen is a different planning problem
    /// from one that cannot move.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? LatestRetiresAtUt { get; set; }

    /// <summary>
    /// Extension already earned and spent against the cap, in seconds. Zero is a
    /// truthful reading (a kerbal who has flown nothing interesting has earned
    /// nothing), so it is NOT folded to absent; absent means RP-1 has no
    /// retirement record for the kerbal at all.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? RetirementExtensionUsedSeconds { get; set; }

    /// <summary>Name of the training course this kerbal is enrolled on; absent when they are not training.</summary>
    [SitrepUnit(Units.Text)]
    public string? TrainingCourse { get; set; }

    /// <summary>
    /// Which kind of training: <c>"Proficiency"</c> (permanent, on a part) or
    /// <c>"Mission"</c> (perishable, and the reason
    /// <see cref="NextTrainingExpiryUt"/> exists). Absent when not training.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? TrainingType { get; set; }

    /// <summary>What the course trains on, RP-1's own target string (a part, or a mission profile). Absent when not training.</summary>
    [SitrepUnit(Units.Text)]
    public string? TrainingTarget { get; set; }

    /// <summary>
    /// Whether the course has actually begun. A course a kerbal is enrolled on
    /// but which has not started makes no progress and has no finish date, and an
    /// operator who reads enrolment as progress will plan a mission around a crew
    /// that is not getting trained.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? TrainingStarted { get; set; }

    /// <summary>
    /// Progress through the course, 0-1. Absent when RP-1 has costed the course
    /// at zero points, which makes its own fraction a NaN: a NaN is not a
    /// progress and must not reach a bar.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? TrainingFractionComplete { get; set; }

    /// <summary>
    /// When the course finishes, as universal time. Absent while RP-1 has not
    /// rated the course's build rate, which is the state a freshly queued course
    /// sits in for a tick: dividing by an unrated rate is how RP-1's own helper
    /// produces an infinite time-left, and an infinity is not a date.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? TrainingFinishesAtUt { get; set; }

    /// <summary>
    /// When this kerbal's SOONEST mission training lapses, as universal time.
    /// Absent when nothing they hold is perishable.
    ///
    /// <para>The soonest rather than the whole list, because that is the one an
    /// operator acts on: mission training expiring is what turns a qualified crew
    /// into an unqualified one while the vehicle is still being integrated.
    /// <see cref="TrainingExpiryCount"/> says how many more are behind it.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? NextTrainingExpiryUt { get; set; }

    /// <summary>What lapses at <see cref="NextTrainingExpiryUt"/>: RP-1's own target string for that training.</summary>
    [SitrepUnit(Units.Text)]
    public string? NextTrainingExpiryTarget { get; set; }

    /// <summary>How many perishable trainings this kerbal holds. Zero when none, so a client can say "none" rather than infer it from an absent date.</summary>
    [SitrepUnit(Units.Count)]
    public int? TrainingExpiryCount { get; set; }
}

/// <summary>
/// The <c>rp1.crewProgram</c> channel payload: the RULES this career's personnel
/// schedule runs under, as opposed to any one kerbal's place in it.
///
/// <para>A wrapper object, not an array: these are career-wide switches and
/// rates. They matter because every date on <see cref="Rp1CrewEntry"/> is
/// meaningless without them. A retirement date on a save with retirement
/// switched off is a date nothing will act on, and a training ETA is a function
/// of a rate an operator can see here and nowhere else.</para>
///
/// <para>The whole payload is <c>null</c> when RP-1's CrewHandler is not live.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.crewProgram")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1CrewProgram
{
    /// <summary>Whether crew retire at all on this save. False makes every retirement date inert rather than absent, which is why it is a field and not an omission.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? RetirementEnabled { get; set; }

    /// <summary>Whether crew stand down for rest after a flight. The switch behind the stock roster's <c>inactive</c> pair being populated at all.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? CrewRnREnabled { get; set; }

    /// <summary>Whether mission-specific training is required on this save. False leaves proficiency training as the only kind, and no training can lapse.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? MissionTrainingEnabled { get; set; }

    /// <summary>Career-wide multiplier on proficiency-training speed. A multiplier, not a rate: 1 is nominal.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? ProficiencyTrainingRate { get; set; }

    /// <summary>Career-wide multiplier on mission-training speed.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? MissionTrainingRate { get; set; }

    /// <summary>The most any one kerbal's retirement can ever be pushed back, in seconds. The cap behind <see cref="Rp1CrewEntry.LatestRetiresAtUt"/>.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? RetirementExtensionCapSeconds { get; set; }

    /// <summary>Training courses RP-1 currently holds, started or not.</summary>
    [SitrepUnit(Units.Count)]
    public int? Courses { get; set; }

    /// <summary>Courses that have actually begun. Below <see cref="Courses"/> means somebody is enrolled and waiting.</summary>
    [SitrepUnit(Units.Count)]
    public int? CoursesStarted { get; set; }

    /// <summary>Kerbals enrolled on a course. The crew a mission cannot draw on today.</summary>
    [SitrepUnit(Units.Count)]
    public int? CrewInTraining { get; set; }
}

/// <summary>
/// One saved craft file, and what each launch complex would make of it.
///
/// <para><b>Why this exists beside <c>spaceCenter.savedShips</c>.</b> That
/// channel is the stock craft-folder listing and answers a different question:
/// what could be LAUNCHED. It carries no craft-file address, no notion of a
/// launch complex, and stock's own cost rather than the one RP-1 charges. Under
/// RP-1 a craft is not launched from a folder at all: it is integrated at a
/// complex that decides what it may weigh and how large it may be, and a widget
/// offering to start a build has to know which complexes would take it BEFORE
/// the press or it is offering a control that can only refuse.</para>
///
/// <para><b>This is a PREVIEW, and the command is the authority.</b> Everything
/// here is measured from the craft FILE without loading it, because loading one
/// instantiates a part per PART node and a sampled capture must not do that
/// every tick. Two of RP-1's own arms cannot be answered that way: whether the
/// craft is human-rated, which RP-1 derives from part tags, and whether the
/// complex stocks the resources it needs. Both are therefore NOT applied here,
/// and the direction is deliberate: an unanswerable arm PERMITS, so the control
/// stays pressable and <c>rp1.build.start</c> gives RP-1's own refusal. A dark
/// control with a reason nobody could establish is the dead end this channel
/// exists to remove.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.buildable", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1BuildableCraftEntry
{
    /// <summary>
    /// The craft FILE's own name, without its extension, and what
    /// <c>rp1.build.start</c> is addressed with. See
    /// <see cref="Rp1BuildStartArgs.CraftFile"/> for why it is not the ship
    /// name.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? CraftFile { get; set; }

    /// <summary>The name inside the file, which is what the game shows and what an operator reads.</summary>
    [SitrepUnit(Units.Text)]
    public string? ShipName { get; set; }

    /// <summary>Which editor built it. Sent straight back as the command's <c>facility</c> argument.</summary>
    [SitrepUnit(Units.Enumeration)]
    public KspEditorFacility? Facility { get; set; }

    [SitrepUnit(Units.Count)]
    public int? PartCount { get; set; }

    /// <summary>
    /// Mass in tonnes with launch clamps left out, which is the figure RP-1
    /// measures against a complex's limits. Absent when it could not be
    /// measured, which makes no comparison at all rather than one against zero.
    /// </summary>
    [SitrepUnit(Units.Tonnes)]
    public double? Mass { get; set; }

    /// <summary>
    /// Stock's price for the craft, in funds.
    ///
    /// <para><b>Not what the career will be charged.</b> RP-1 prices a vessel
    /// purchase through its own currency query, which leaders and strategies
    /// move, and that query fires a game-wide event: running it once per craft
    /// per tick would broadcast to every mod listening, so it is asked once, at
    /// the press, by the command. This is the list price a widget can show
    /// beside a balance; the charge is settled when the operator commits.</para>
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? Cost { get; set; }

    /// <summary>
    /// Parts the craft names that this install does not have, so nothing can
    /// build it. An empty array when it is whole.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string[]? MissingParts { get; set; }

    /// <summary>Parts whose tech node is not researched yet. The remedy is the research queue.</summary>
    [SitrepUnit(Units.Text)]
    public string[]? LockedParts { get; set; }

    /// <summary>Parts researched but not bought. The remedy is money, spent at R&amp;D.</summary>
    [SitrepUnit(Units.Text)]
    public string[]? UnpurchasedParts { get; set; }

    /// <summary>
    /// What each launch complex would do with it, one entry per complex at every
    /// space centre. Empty when RP-1 has no complexes, which is a real state a
    /// new career starts in and is why a widget must not read an empty list as
    /// an outage.
    /// </summary>
    public Rp1BuildableComplex[]? Complexes { get; set; }
}

/// <summary>
/// One launch complex's answer about one craft: whether it would take it, and
/// what stops it.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1BuildableComplex
{
    /// <summary>The complex, by the GUID <c>rp1.complexes[].lcId</c> publishes and the command takes.</summary>
    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }

    /// <summary>Its name, so a control can be labelled without joining to another channel.</summary>
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    /// <summary>The space centre it stands at, because two centres may each have an LC-1.</summary>
    [SitrepUnit(Units.Id)]
    public string? KscName { get; set; }

    /// <summary>
    /// That centre's display name, travelling with the id for the reason the id
    /// travels here at all: a refusal is labelled from this row alone, and a
    /// label reading <c>us_cape_canaveral</c> names the place to nobody.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? KscDisplayName { get; set; }

    /// <summary>
    /// Nothing this preview can see stops the build.
    ///
    /// <para>True is not a promise. It means every arm that COULD be answered
    /// from the craft file passed, and the two that could not were not applied;
    /// see the type doc. False is firmer: <see cref="Refusals"/> names a reason
    /// RP-1 itself would give.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Eligible { get; set; }

    /// <summary>
    /// Why not, in sentences, or an empty array when nothing stops it. Never
    /// null for a complex that answered: an absent list and an empty one would
    /// read the same and only one of them means "no objection".
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string[]? Refusals { get; set; }
}

/// <summary>
/// What RP-1 charges for a leader, and what it costs to let one go.
/// </summary>
/// <remarks>
/// <para><b>Why this is not on <c>career.status.strategies</c>.</b> That entry is
/// built by core from plain stock <c>Strategy</c> getters, and every field here
/// lives on <c>StrategyConfigRP0</c>, which core may not reach. Publishing them
/// beside the stock entry would put an RP-1 type in core's walk; publishing them
/// here keeps the boundary and lets a client join on <see cref="StrategyId"/>.</para>
///
/// <para><b>Why it exists at all.</b> The stock entry carries
/// <c>initialCostFunds</c>, <c>initialCostScience</c> and
/// <c>initialCostReputation</c>, and RP-1 NEVER CHARGES THEM:
/// <c>PerformActivate</c> spends <c>ConfigRP0.SetupCosts</c> and nothing else.
/// Those stock fields are still a live GATE, because RP-1 leaves stock's
/// affordability arms in place, so both quantities matter and neither is dead.
/// They are simply different questions: one is what refuses you, the other is
/// what you pay.</para>
///
/// <para>On shipped content both are zero, so a control reading the stock fields
/// as "the price" is right by accident and would go on saying "no setup cost"
/// the moment a config set one. That is a fact about today's CONTENT standing in
/// for a fact about our CODE, which is the shape this Uplink keeps finding.</para>
/// </remarks>
[SitrepContract]
public class Rp1LeaderEntry
{
    /// <summary>
    /// The strategy this prices, by the id
    /// <c>career.status.strategies.all[].id</c> publishes.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? StrategyId { get; set; }

    /// <summary>Funds RP-1 charges to appoint, absent when it charges none.</summary>
    [SitrepUnit(Sitrep.Contract.Units.Funds)]
    public double? SetupFunds { get; set; }

    /// <summary>Science RP-1 charges to appoint.</summary>
    [SitrepUnit(Sitrep.Contract.Units.Science)]
    public double? SetupScience { get; set; }

    /// <summary>Reputation RP-1 charges to appoint.</summary>
    [SitrepUnit(Sitrep.Contract.Units.Reputation)]
    public double? SetupReputation { get; set; }

    /// <summary>Confidence RP-1 charges to appoint.</summary>
    [SitrepUnit(Contract.Units.Confidence)]
    public double? SetupConfidence { get; set; }

    /// <summary>
    /// The reputation dismissal costs RIGHT NOW.
    ///
    /// <para>Never funds and never a refund, and a fraction of CURRENT
    /// reputation rather than a fixed figure, so it moves as reputation does: a
    /// flat share for the first thirty days, decaying over ten years. A client
    /// must therefore show it at the moment of the decision rather than caching
    /// it.</para>
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Reputation)]
    public double? DeactivateReputation { get; set; }

    /// <summary>
    /// Whether dismissing starts a re-hire cooldown, i.e. whether this is a
    /// decision that cannot be undone by re-appointing.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? RemoveOnDeactivate { get; set; }

    /// <summary>
    /// How long that cooldown lasts. An INTERVAL, so seconds rather than a UT.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Seconds)]
    public double? ReactivateCooldown { get; set; }

    /// <summary>
    /// The instant dismissal becomes possible at all. An INSTANT, so a UT.
    /// </summary>
    [SitrepUnit("ut")]
    public double? CanRemoveFromUt { get; set; }

    /// <summary>
    /// The instant dismissal stops costing reputation. An INSTANT, so a UT.
    /// </summary>
    [SitrepUnit("ut")]
    public double? FreeToRemoveFromUt { get; set; }
}

/// <summary>
/// A standing instruction to keep hiring until the staff reaches a number, and
/// how far off it is.
///
/// <para>RP-1 runs this as a background project rather than a one-off purchase:
/// it spends funds on new hires as they become affordable, so the operator
/// commits once and the career keeps drawing down against it for as long as it
/// takes. That makes it a thing the operator must be able to SEE, because it
/// spends money when nobody is looking.</para>
///
/// <para>It is silently cleared when the complex it hires for is modified or
/// dismantled. Publishing whether it is <see cref="Active"/> is what makes that
/// survivable: the operator watches it disappear rather than believing in a
/// schedule that no longer exists.</para>
///
/// <para>NO PROGRESS FRACTION, deliberately. RP-1's own
/// <c>GetFractionComplete()</c> divides two ints and widens the result
/// afterwards, confirmed at IL as <c>div</c> then <c>conv.r8</c>, so it reads
/// zero for the whole hire and snaps to one at the end. Reproducing it would
/// import the bug; <see cref="LeftToHire"/> and <see cref="TimeLeft"/> answer
/// the same question truthfully. This is the same call made for crew R&amp;R,
/// whose fraction is an unconditional zero.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1HireTarget
{
    /// <summary>
    /// Whether an instruction is standing at all. False means no target, which
    /// is a different statement from a target of zero.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Flag)]
    public bool? Active { get; set; }

    /// <summary>The headcount being hired up to.</summary>
    [SitrepUnit(Sitrep.Contract.Units.Count)]
    public int? TargetCount { get; set; }

    /// <summary>Headcount now, against which the target is measured.</summary>
    [SitrepUnit(Sitrep.Contract.Units.Count)]
    public int? CurrentCount { get; set; }

    /// <summary>How many more must be hired. The honest progress reading.</summary>
    [SitrepUnit(Sitrep.Contract.Units.Count)]
    public int? LeftToHire { get; set; }

    /// <summary>
    /// Whether this hires researchers rather than engineers. RP-1 distinguishes
    /// them by whether a complex is named, not by a kind field.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Flag)]
    public bool? IsResearch { get; set; }

    /// <summary>
    /// The complex being staffed, absent when this hires researchers. The key
    /// <see cref="Rp1ComplexEntry.LcId"/> carries.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Id)]
    public string? LcId { get; set; }

    /// <summary>
    /// RP-1's estimate of how long until the target is met, which is really a
    /// forecast of when the funds will exist. An INTERVAL, so seconds.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Seconds)]
    public double? TimeLeft { get; set; }
}

/// <summary>
/// A standing instruction to stop time warp once the balance reaches a figure.
///
/// <para>A warp STOP CONDITION rather than a transaction, and it PERSISTS past
/// the warp it stopped: warping again resumes toward the same figure. An
/// operator who does not know it is set reads the next unexplained warp halt as
/// the game misbehaving.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.fundTarget")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1FundTarget
{
    /// <summary>
    /// Whether a target is standing. RP-1 treats a figure equal to the balance
    /// at the moment it was set as no target at all, so this is not simply
    /// "the number is non-zero".
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Flag)]
    public bool? Active { get; set; }

    /// <summary>The balance being warped toward.</summary>
    [SitrepUnit(Sitrep.Contract.Units.Funds)]
    public double? TargetFunds { get; set; }

    /// <summary>
    /// The balance when the target was set, which is the other end of RP-1's own
    /// progress measure and the reason a target equal to it counts as unset.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Funds)]
    public double? OriginalFunds { get; set; }

    /// <summary>
    /// RP-1's estimate of the wait, iterated against the income curve rather
    /// than divided out of it. An INTERVAL, so seconds.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Seconds)]
    public double? TimeLeft { get; set; }
}

/// <summary>
/// One training course RP-1 currently holds, started or not.
///
/// <para>A COURSE-level row, beside the per-kerbal training fields on
/// <see cref="Rp1CrewEntry"/> rather than instead of them. A client can group
/// those kerbal rows by course name and get most of this, but not two things it
/// needs: a course with nobody enrolled has no kerbal rows to group, and the seat
/// bounds live on the course rather than on any student.</para>
///
/// <para>The seat bounds decide which control an operator is offered, so they are
/// not decoration: RP-1 draws <b>Cancel</b> for the whole course when
/// <see cref="SeatMin"/> is above one, and <b>Remove</b> for a single student
/// otherwise, because dropping one student below the minimum would strand the
/// rest.</para>
///
/// <para>NO PER-COURSE COST, and it is not an omission. Training is a per-day
/// upkeep rather than a purchase, and RP-1's own formula needs
/// <c>TrainingDatabase.FillBools</c>, which fills and resets SHARED MUTABLE
/// STATIC arrays: a telemetry read must not move the game's scratch state. The
/// career-wide figure is already published on the economy capability, and
/// <see cref="Students"/> with <see cref="Started"/> are what drive it, since
/// only a STARTED course is paid for at all.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.training", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1TrainingCourseEntry
{
    /// <summary>RP-1's template id, and the key an enrolment names.</summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    /// <summary>The course's display name, RP-1's own.</summary>
    [SitrepUnit(Sitrep.Contract.Units.Text)]
    public string? Name { get; set; }

    [SitrepUnit(Sitrep.Contract.Units.Text)]
    public string? Description { get; set; }

    /// <summary>
    /// <c>Proficiency</c> or <c>Mission</c>. Proficiency training is on a part
    /// and lasts; mission training is for a flight and expires.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Enumeration)]
    public string? Type { get; set; }

    /// <summary>What the course trains on, RP-1's own target string.</summary>
    [SitrepUnit(Units.Id)]
    public string? Target { get; set; }

    /// <summary>
    /// The enrolled kerbals by name, joining to <c>spaceCenter.crewRoster</c>.
    /// Empty is a real answer: a course can exist with nobody on it.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public List<string>? Students { get; set; }

    /// <summary>
    /// The fewest students the course can run with. Above one, the only way out
    /// is cancelling the whole course.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Count)]
    public int? SeatMin { get; set; }

    /// <summary>The most it can take. Zero means RP-1 sets no maximum.</summary>
    [SitrepUnit(Sitrep.Contract.Units.Count)]
    public int? SeatMax { get; set; }

    /// <summary>
    /// Whether the course has begun. **This is the field that costs money**: an
    /// enrolled-but-unstarted course draws nothing.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Flag)]
    public bool? Started { get; set; }

    [SitrepUnit(Sitrep.Contract.Units.Flag)]
    public bool? Completed { get; set; }

    /// <summary>
    /// When the course itself finishes. An INSTANT, so a UT.
    ///
    /// <para>There is deliberately NO progress fraction beside it. RP-1's own is
    /// sound arithmetic, unlike its hire and R&amp;R fractions, but it already
    /// rides <c>rp1.crew</c> per kerbal and a course with no students has no
    /// progress to report, so a copy here would be duplication that also makes
    /// this date look like something a client could integrate toward.</para>
    ///
    /// <para>NOT when the crew can fly: see <see cref="StudentsAvailableAtUt"/>.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? CompletesAtUt { get; set; }

    /// <summary>
    /// When the last student becomes available again, which is LATER than
    /// <see cref="CompletesAtUt"/> and is the date a mission planner actually
    /// needs.
    ///
    /// <para>RP-1 marks each student inactive for <b>120%</b> of the course's base
    /// time at the moment it STARTS, so a kerbal stays grounded for roughly a
    /// fifth of the course again after it has finished. Read from the students'
    /// own inactive window rather than derived, so it stays right if RP-1 changes
    /// the multiplier.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? StudentsAvailableAtUt { get; set; }

    /// <summary>
    /// Whether RP-1 discards this course once it completes, rather than keeping it
    /// on the roster.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Flag)]
    public bool? IsTemporary { get; set; }
}

/// <summary>
/// One training RP-1 could be asked to run: a template, not a course.
///
/// <para>The ENROLABLE side of <see cref="Rp1TrainingCourseEntry"/>. A course row
/// exists because somebody started it; a template row exists because the install
/// has a crewed part that can be trained on, whether or not anyone ever will. An
/// operator picking a training reads this list; an operator watching one in
/// progress reads the other.</para>
///
/// <para><b>NO AC-LEVEL REQUIREMENT, and it is a refusal rather than an
/// oversight.</b> RP-1 gates each proficiency training on an Astronaut Complex
/// tier, and the getter that states it,
/// <c>TrainingTemplate.ACLevelRequirement</c>, reaches
/// <c>TrainingDatabase.GetACRequirement</c>, whose first statement is
/// <c>ClearTracker()</c> and which then fills the shared static
/// <c>unlockPathTracker</c>. A telemetry read taken every tick must not move the
/// game's own scratch state, the same ruling already taken on
/// <c>TrainingDatabase.FillBools</c> and <c>LCOpsProject.GetTimeLeftEstAll</c>.
/// The gate is not lost: <c>rp1.training.enrol</c> asks it at the moment of the
/// press, which is when RP-1's own UI asks it, and a refusal names the tier
/// required.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.trainingCatalogue", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1TrainingTemplateEntry
{
    /// <summary>RP-1's template id, and the key <c>rp1.training.enrol</c> names.</summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    /// <summary>The training's display name, RP-1's own.</summary>
    [SitrepUnit(Sitrep.Contract.Units.Text)]
    public string? Name { get; set; }

    [SitrepUnit(Sitrep.Contract.Units.Text)]
    public string? Description { get; set; }

    /// <summary>
    /// <c>Proficiency</c> or <c>Mission</c>. Proficiency training is on a part and
    /// lasts; mission training is for a flight and expires.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Enumeration)]
    public string? Type { get; set; }

    /// <summary>What the training is on, RP-1's own target string.</summary>
    [SitrepUnit(Units.Id)]
    public string? Target { get; set; }

    /// <summary>
    /// How long the course takes with nobody on it yet. An INTERVAL, so seconds.
    ///
    /// <para>The persisted field, read directly rather than through
    /// <c>GetBaseTime</c>. With an empty student list that method returns this
    /// number unchanged, and a fresh course's build points are exactly it; with
    /// students it reaches <c>TrainingDatabase.GetProficiencyTime</c>, which
    /// mutates the shared tracker described on this type. So the field is both the
    /// safe read and the right one.</para>
    ///
    /// <para>It is a FLOOR for a real enrolment, not a quote. RP-1 lengthens a
    /// proficiency course by each student's prior proficiency and a mission course
    /// by their stupidity, and the elapsed time then divides by a build rate the
    /// Astronaut Complex tier sets. The course's own
    /// <c>rp1.training[].completesAtUt</c> is the answer once it is running.</para>
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Seconds)]
    public double? BaseTime { get; set; }

    /// <summary>
    /// The fewest students the course can run with. Above one, the only control
    /// RP-1 offers a started course is cancelling the whole thing.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Count)]
    public int? SeatMin { get; set; }

    /// <summary>
    /// The most it can take. RP-1 stores <b>-1</b> for no maximum, and that is
    /// published as it stands rather than folded into a zero or an absence, so a
    /// client can tell "unlimited" from "a seat count nobody could read".
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Count)]
    public int? SeatMax { get; set; }

    /// <summary>
    /// Whether the career can train on this yet: RP-1 asks whether any part the
    /// training covers has its tech researched and out of the research queue.
    ///
    /// <para>A template with no parts at all reads as locked, which is RP-1's own
    /// answer rather than a substituted one.</para>
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Flag)]
    public bool? Unlocked { get; set; }

    /// <summary>
    /// A placeholder RP-1 generated for a part still being researched, and will
    /// withdraw again. Its courses are aborted when it goes.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Flag)]
    public bool? IsTemporary { get; set; }
}

/// <summary>
/// One tooling RP-1 would charge for on the ship currently in the editor.
///
/// <para><b>What tooling IS, because the row does not read without it.</b> RP-1
/// keeps a CAREER-GLOBAL database keyed on a tooling type and an ordered tuple of
/// parameters, not on a part. Two parts of different sizes share one tooling
/// whenever their type matches and every parameter is within FOUR PERCENT, so
/// paying for one part can leave a neighbour free. A row here is therefore a
/// tooling this part needs, not a thing this part owns.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1ToolingEntry
{
    /// <summary>The part carrying the module, by its display title.</summary>
    [SitrepUnit(Sitrep.Contract.Units.Text)]
    public string? PartTitle { get; set; }

    /// <summary>
    /// RP-1's own tooling-type key, and what makes two parts share a tooling.
    /// Rows with the same type and the same
    /// <see cref="ParameterSummary"/> are one purchase between them.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? ToolingType { get; set; }

    /// <summary>The type as RP-1 titles it for a human.</summary>
    [SitrepUnit(Sitrep.Contract.Units.Text)]
    public string? ToolingTypeTitle { get; set; }

    /// <summary>
    /// The tooling's parameters, as RP-1 renders them: <c>3.000m x 5.000m</c>, or
    /// <c>12.5 t x 3.000m x 5.000m</c> for a type that takes three.
    ///
    /// <para><b>A string, and deliberately not a number list.</b> The parameter
    /// count varies by tooling type and RP-1 exposes no uniform accessor for the
    /// tuple: each subclass builds its own inside its own cost function, and the
    /// third parameter of the avionics type comes off a private member.
    /// <c>GetToolingParameterInfo</c> is the one uniform reading, it is
    /// variable-length by construction, and it is the producer's own rendering.
    /// Reconstructing the numbers would mean mirroring RP-1's type hierarchy and
    /// would misreport silently the day a subclass adds a parameter.</para>
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Text)]
    public string? ParameterSummary { get; set; }

    /// <summary>
    /// Whether this tooling is already owned, which is RP-1's own
    /// <c>IsUnlocked</c> rather than anything derived here.
    ///
    /// <para><b>There is no level beside it, and that is an omission with a
    /// reason.</b> Tooling is genuinely PARTIAL: a diameter can be owned while a
    /// length is not. RP-1 answers the level only when handed the right parameter
    /// tuple, which is the thing above that cannot be read uniformly, and asking
    /// with the wrong tuple returns a confidently wrong level. The economics of a
    /// half-owned tooling still travel, in the field that matters:
    /// <see cref="ToolingCost"/> drops once the first parameter is owned.</para>
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Flag)]
    public bool? Tooled { get; set; }

    /// <summary>
    /// What finishing THIS tooling costs now. Lower on a partly-owned tooling,
    /// which is where the missing level shows itself.
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? ToolingCost { get; set; }

    /// <summary>
    /// What NOT tooling costs, per build, for ever.
    ///
    /// <para>This is the number the decision actually turns on and the reason the
    /// row exists. An untooled part carries a surcharge onto the vessel's cost
    /// every single time it is built, so the question is never "what does tooling
    /// cost" but "tool once, or pay this again on every copy". Read from RP-1's
    /// own cached <c>addedCost</c>, which is what its part-cost modifier actually
    /// charges, rather than from the formula behind it.</para>
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? UntooledSurcharge { get; set; }

    /// <summary>The part's craft id, and what <c>rp1.tooling.refit</c> names.</summary>
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    /// <summary>
    /// How many OTHER parts a refit of this one would take with it.
    ///
    /// <para>Carried so it can be said BEFORE the press. RP-1's own refit resizes
    /// every symmetry counterpart and tells you how many afterwards, in a screen
    /// message; a console can put the number beside the control instead, which is
    /// the same disclosure at the moment it can still change the answer.</para>
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Count)]
    public int? SymmetryCounterparts { get; set; }

    /// <summary>
    /// Whether a refit could reshape this part at all. RP-1 resizes through
    /// <c>ModuleROTank</c> or <c>ProceduralPart</c> and silently does nothing on a
    /// part with neither, so a control can be dark rather than inert.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Flag)]
    public bool? Refittable { get; set; }

    /// <summary>
    /// The sizes this part could be REFITTED to: owned toolings it can be
    /// reshaped onto instead of buying a new one.
    ///
    /// <para><b>Why a list and not two numbers.</b> A refit moves a part TO a
    /// size, so it needs a size to move to, and there is no default one. The
    /// career's owned toolings are the only legal targets, and which of them a
    /// given part can take depends on the tank materials it has unlocked, so the
    /// answer is per part rather than per career.</para>
    ///
    /// <para><b>Every row here is one RP-1 itself would offer.</b> Its own window
    /// draws a Refit press only on a leaf of the owned-tooling tree, only for a
    /// type keyed on two parameters, and only when its material picker answers
    /// with something the part can use; all three are applied before a row
    /// reaches this list.</para>
    ///
    /// <para><b>It is a true SUBSET of what RP-1's window offers, deliberately.</b>
    /// The rows are the sizes owned for the part's OWN tooling type. RP-1 merges a
    /// whole bucket of related types, which also lets it offer a refit onto
    /// another material's tooling, and the bucketing is a ten-branch private over
    /// type-name prefixes inside its GUI. Narrowing loses options; transcribing a
    /// GUI private would risk offering an illegal one.</para>
    ///
    /// <para>NULL where the question does not apply: a part already tooled, a part
    /// nothing can reshape (see <see cref="Refittable"/>), or a tooling type RP-1
    /// offers no refit for. EMPTY is the real, different answer that the career
    /// owns nothing this part could move to.</para>
    /// </summary>
    public List<Rp1ToolingRefitTarget>? RefitTargets { get; set; }
}

/// <summary>
/// One owned tooling a part could be reshaped to fit, and the material the refit
/// would put it in.
/// </summary>
/// <remarks>
/// A refit reaches further than the part named, and both reaches are RP-1's own:
/// every symmetry counterpart is resized too (see
/// <see cref="Rp1ToolingEntry.SymmetryCounterparts"/>), and the material is
/// applied across the part's group. RP-1 discloses them afterwards in a screen
/// message; a console can say them first.
/// </remarks>
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1ToolingRefitTarget
{
    /// <summary>The diameter to reshape to, which is what the command carries.</summary>
    [SitrepUnit(Sitrep.Contract.Units.Metres)]
    public double Diameter { get; set; }

    /// <summary>The length to reshape to.</summary>
    [SitrepUnit(Sitrep.Contract.Units.Metres)]
    public double Length { get; set; }

    /// <summary>
    /// The tank material this row would put the part in, chosen by RP-1's own
    /// picker rather than by the client.
    ///
    /// <para>Never absent on a published row: a part that can use no material the
    /// tooling covers is one RP-1 refuses to refit, and the row is dropped rather
    /// than offered with nothing to move to. Pass it as
    /// <c>Rp1ToolingRefitArgs.rfType</c> unchanged.</para>
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Id)]
    public string? RfType { get; set; }
}

/// <summary>
/// The <c>rp1.tooling</c> channel: what the ship on the editor's table would cost
/// to tool, and what it costs not to.
///
/// <para><b>A singleton with the rows nested rather than a bare array</b>, because
/// the total is not a property of any row and is not the sum of them either. Both
/// figures have to arrive together or a client is left to add up a column that
/// gives the wrong answer.</para>
///
/// <para><b>Absence is a real answer and is not "everything is tooled".</b> No
/// sample means no ship in the editor, or RP-1's tooling switched off. That second
/// case is the one worth the care: RP-1's own level lookup short-circuits to
/// "tooled" for everything when tooling is disabled, so a reading taken then would
/// report a ship with nothing left to do. The channel says nothing instead.</para>
///
/// <para>EDITOR ONLY. The whole reading comes off the ship on the editor's table,
/// so there is no sample from anywhere else and none is implied.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.tooling")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1Tooling
{
    /// <summary>
    /// RP-1's own price for tooling everything untooled on this ship.
    ///
    /// <para><b>NOT the sum of the rows.</b> Tooling one part can leave another
    /// free, because a tooling matches any part of the same type within four per
    /// cent, so adding the column up overstates. This is RP-1's own deduplicated
    /// figure, taken off the field it caches it in rather than by asking its window
    /// to price the ship, which it does by performing every purchase for real and
    /// rolling the database back.</para>
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? ToolAllCost { get; set; }

    /// <summary>How many of the rows below are not yet tooled.</summary>
    [SitrepUnit(Sitrep.Contract.Units.Count)]
    public int? UntooledCount { get; set; }

    /// <summary>
    /// Every tooling module on the ship, tooled or not.
    ///
    /// <para>The tooled ones travel too. A roster that showed only what is
    /// outstanding could not tell an operator that a part is covered, which is the
    /// half of the answer that says the money has already been spent.</para>
    /// </summary>
    public Rp1ToolingEntry[]? Parts { get; set; }
}

/// <summary>
/// The <c>rp1.buildCost</c> channel: what putting the vehicle on the editor's
/// table into the sky will actually cost, in FUNDS, line by line.
///
/// <para><b>This is deliberately not RP-1's own "Cost Breakdown".</b> That tab
/// shows <c>effectiveCost</c>, which is the input to
/// <c>Formula.GetVesselBuildPoints</c> and therefore decides how LONG integration
/// takes. It is a dimensionless comparability metric that the producer's own
/// tooltip describes as being for comparing rockets against each other, and it
/// buys nothing. A number that looks like money, is labelled like money and is not
/// money is the one thing this wire refuses to carry, whatever the producer calls
/// it. Integration effort is a real question and belongs on a channel of its own,
/// named for what it drives.</para>
///
/// <para>EDITOR ONLY, like <c>rp1.tooling</c> beside it: every figure is read off
/// the vehicle being designed.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.buildCost")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1BuildCost
{
    /// <summary>
    /// The vehicle itself: what its parts and propellant cost.
    ///
    /// <para><b>This already contains <see cref="UntooledSurcharge"/>.</b> The
    /// surcharge reaches the vessel through <c>IPartCostModifier</c>, which the
    /// game persists onto each part as <c>modCost</c> and folds into the part cost
    /// before anyone here sees it. So the surcharge below is an OF WHICH, never an
    /// addend, and a client that adds the two has charged the operator twice for
    /// the same thing.</para>
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? VehicleCost { get; set; }

    /// <summary>
    /// How much of <see cref="VehicleCost"/> is the penalty for flying untooled
    /// parts, and therefore how much of it would go away if the tooling were
    /// bought.
    ///
    /// <para>A SUBSET of the line above, not a line of its own. It is also the
    /// number that makes <see cref="ToolingCost"/> a decision rather than an
    /// expense: the surcharge is paid on every copy of this vehicle ever built,
    /// and the tooling is paid once.</para>
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? UntooledSurcharge { get; set; }

    /// <summary>
    /// Tooling for every untooled part, once, RP-1's own deduplicated figure. The
    /// same number <c>rp1.tooling.toolAllCost</c> carries, and it is here as well
    /// rather than only there because a breakdown missing a line is not a
    /// breakdown: a client should not have to join two channels to render one
    /// column.
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? ToolingCost { get; set; }

    /// <summary>
    /// Entry costs for parts on this vehicle the career has not yet paid for.
    /// Distinct from researching the tech: RP-1 charges to unlock the NODE and
    /// again to buy the part.
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? UnlockCost { get; set; }

    /// <summary>
    /// Rolling the finished vehicle out to a pad.
    ///
    /// <para>Absent for a spaceplane: RP-1 computes it only when the editor is the
    /// VAB, and a hangar vehicle does not roll out. Absent is therefore "does not
    /// apply here" rather than "free".</para>
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? RolloutCost { get; set; }

    /// <summary>
    /// Tech nodes this vehicle needs that the career has not researched, each with
    /// what it is called and what on this vehicle is waiting for it.
    ///
    /// <para>Not a cost, and here anyway, because it is the reason a vehicle that
    /// prices fine still cannot be built. A breakdown that showed only money would
    /// let an operator budget for something they cannot fly.</para>
    ///
    /// <para><b>It used to be a flat list of node ids and that was not readable.</b>
    /// `supersonicFlight` is an identifier, and an identifier on its own says
    /// neither what the node is called nor what about the vehicle is blocked by it.
    /// Both are answerable and both are here.</para>
    /// </summary>
    public List<Rp1RequiredTechEntry>? RequiredTechs { get; set; }
}

/// <summary>
/// One tech node the editor vehicle needs and the career has not researched.
///
/// <para>RP-1 names the node and nothing else: its
/// <c>SpaceCenterManagement.EditorRequiredTechs</c> is a flat list of ids with no
/// titles and no link to the parts waiting on them. Both of the other two fields
/// are read from KSP directly, beside it.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1RequiredTechEntry
{
    /// <summary>
    /// The node's id, as RP-1 named it, and the stable key for this row.
    ///
    /// <para>Carried even though <see cref="Title"/> is the readable half, because
    /// an id is what survives a locale and a tree revision: it is what a player
    /// searches a tech tree for and what any other surface would join on. A title
    /// is a display string and is not a key.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    /// <summary>
    /// The node as the career's own tech tree titles it, e.g. "Supersonic Flight".
    ///
    /// <para>KSP's <c>ResearchAndDevelopment.GetTechnologyTitle</c>, which is a
    /// title dictionary keyed on node id and consults researched state NOWHERE, so
    /// it answers for an unresearched node. It loads from
    /// <c>Parameters.Career.TechTreeUrl</c>, so under RP-1 these are RP-1's own
    /// titles rather than stock's, by construction and not by arrangement.</para>
    ///
    /// <para><b>ABSENT rather than the id when the tree has no title.</b>
    /// <c>GetTechnologyTitle</c> answers an unknown id with the EMPTY STRING, and
    /// two wrong things could be done with that: publish the blank, which renders
    /// as a nameless node, or substitute the id, which makes this field a lie about
    /// what it is. A client already holds <see cref="Id"/> and can fall back to it
    /// itself, so absence is the honest answer and the only one it can act on.</para>
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Text)]
    public string? Title { get; set; }

    /// <summary>
    /// The parts on the editor's table that are waiting for this node, by their
    /// display titles.
    ///
    /// <para>This is the half that makes the row an answer rather than a name. KSP
    /// keeps a part's blocking node on <c>AvailablePart.TechRequired</c>, so the
    /// link is stock and needs nothing from RP-1; the editor ship is walked and its
    /// parts gathered under the node each one names.</para>
    ///
    /// <para><b>Three states, and the middle one is the one worth the care.</b>
    /// ABSENT means the editor ship could not be read at all, so nothing is claimed
    /// about which parts are waiting. EMPTY means the ship WAS read and nothing on
    /// it names this node, which is a real answer and happens: a node can be
    /// required by something other than a part. A populated list is the parts
    /// themselves. An empty list is therefore never suppressed, because an operator
    /// who saw the row vanish would go looking for a fault behind it.</para>
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Text)]
    public List<string>? Parts { get; set; }
}

/// <summary>
/// One thing RP-1 recorded as having happened in the career, with the instant it
/// happened at.
///
/// <para>Six of RP-1's kinds flattened onto one row, because a log is read down a
/// column of time rather than across six lists. <see cref="Kind"/> says which, and
/// the fields a kind does not use are absent rather than zero: a launch has no
/// reputation change and a contract has no part that failed.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1CareerEventEntry
{
    /// <summary>When it happened. An INSTANT, so a UT.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? Ut { get; set; }

    /// <summary>
    /// Which of RP-1's six logs this came from: <c>contract</c>, <c>launch</c>,
    /// <c>failure</c>, <c>facilityConstruction</c>, <c>techResearch</c> or
    /// <c>leader</c>.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Enumeration)]
    public string? Kind { get; set; }

    /// <summary>
    /// What happened, in RP-1's own words: a contract's display name, a vessel's
    /// name, a tech node, a leader, a facility, or the PART that failed.
    ///
    /// <para>Six kinds, six sources, and the last two were added after four of them
    /// were found to have no name at all. A facility construction carries only its
    /// facility, its state and an id; a failure carries only a vessel uid, a launch
    /// id, a part and a failure mode. Neither has a display name, a vessel name, a
    /// node name or a leader name, so both used to arrive nameless.</para>
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Text)]
    public string? Name { get; set; }

    /// <summary>
    /// The kind's own sub-type where it has one: a contract's accepted / completed
    /// / failed, a failure's failure mode, a construction's state. Passed through
    /// as the producer's own value rather than mapped, because the sets are its
    /// vocabulary and a stale mapping here would mislabel history.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Enumeration)]
    public string? Detail { get; set; }

    /// <summary>
    /// The launch this row belongs to, on the two kinds that carry one.
    ///
    /// <para><b>The join is the point.</b> A failure and the launch it happened on
    /// share a <c>LaunchID</c>, and pairing them is the question an operator opens
    /// a career log to answer. A shape that dropped this would carry both rows and
    /// be unable to say they were the same flight.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? LaunchId { get; set; }

    /// <summary>Reputation gained or lost, on a contract. Absent elsewhere.</summary>
    [SitrepUnit(Units.Reputation)]
    public double? RepChange { get; set; }

    /// <summary>What it cost, on a leader appointment. Absent elsewhere.</summary>
    [SitrepUnit(Units.Funds)]
    public double? Cost { get; set; }

    /// <summary>
    /// Whether a leader was HIRED (<c>true</c>) or dismissed. Absent on every other
    /// kind.
    ///
    /// <para>Without it the row is a name and a price that read identically either
    /// way, and a cost with no direction is worse than no cost: it invites the
    /// reader to assume the commoner case. RP-1's own export writes the row as
    /// <c>"&lt;name&gt;: add"</c> or <c>"&lt;name&gt;: remove"</c>, so the name was
    /// never sufficient even to its author.</para>
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Flag)]
    public bool? IsAdd { get; set; }

    /// <summary>
    /// Which editor a launch was built in, VAB or SPH. Absent on every other kind.
    /// One word, and it is the only thing on the row that separates a rocket from a
    /// spaceplane.
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Enumeration)]
    public string? BuiltAt { get; set; }
}

/// <summary>
/// The <c>rp1.careerEvents</c> channel: RP-1's own record of what has happened in
/// this career, as a timeline.
///
/// <para><b>Only half of RP-1's career log is here, and that is deliberate.</b> Its
/// <c>CareerLog</c> holds two unrelated things: six lists of dated events, and a
/// monthly FINANCIAL LEDGER of about thirty figures per period. The ledger is a
/// balance sheet and belongs on a budget surface; putting twelve rows a year of
/// accounts onto an event timeline would make both worse.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.careerEvents")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1CareerEvents
{
    /// <summary>
    /// Whether RP-1 is keeping the log at all.
    ///
    /// <para><b>False is not an empty log</b>, and the distinction is the whole
    /// reason this field exists. A career with logging switched off has no history
    /// to show and never will; a career with it on and nothing yet recorded has a
    /// history that is genuinely empty so far. An operator told "no events" about
    /// the first has been told the career is quiet when it is in fact unrecorded.
    /// A third state, "could not be read", is the channel publishing nothing at
    /// all.</para>
    /// </summary>
    [SitrepUnit(Sitrep.Contract.Units.Flag)]
    public bool? Enabled { get; set; }

    /// <summary>Everything recorded, oldest first.</summary>
    public Rp1CareerEventEntry[]? Events { get; set; }
}

/// <summary>
/// One of the space centre's buildings, as RP-1 knows it: the tier it is at, the
/// tier it can reach, and what the next step costs.
///
/// <para><b>This channel exists because it answers OUTSIDE the space centre and
/// <c>career.status.facilities</c> does not.</b> Core reads a tier off the live
/// <c>UpgradeableFacility</c> MonoBehaviours, which KSP only puts in the
/// SPACECENTER scene, so every tier and price on that payload is absent from the
/// editor, from flight and from the tracking station. RP-1 does not read them
/// that way. <c>KCTUtilities.GetFacilityLevel</c> denormalises the level KSP
/// PERSISTS in the save against a tier count RP-1 loads from config, and RP-1's
/// own <c>MaintenanceHandler.UpdateUpkeep</c> calls it for every facility in all
/// four scenes to bill the career for them. So on an RP-1 install these three
/// facts are readable wherever the operator is standing, and this channel
/// carries them there.</para>
///
/// <para>Not a replacement for the stock payload: it carries no tier
/// DESCRIPTIONS, because those come off the live facility and are genuinely
/// scene-bound. What it carries is the tier, the ceiling and the price.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("rp1.facilities", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class Rp1FacilityEntry
{
    /// <summary>
    /// The <c>SpaceCenterFacility</c> enum name, e.g. "VehicleAssemblyBuilding".
    /// The same key <c>career.status.facilities</c> is indexed by, so a client
    /// can read one where the other is silent.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public string? Facility { get; set; }

    /// <summary>
    /// The tier it is at now, zero-based, the same counting
    /// <c>career.status.facilities[].currentTier</c> uses.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? CurrentTier { get; set; }

    /// <summary>The highest tier it has, zero-based. A one-tier building answers 0.</summary>
    [SitrepUnit(Units.Count)]
    public int? MaxTier { get; set; }

    /// <summary>
    /// What raising it one tier costs, in funds, with the career's own funds-loss
    /// multiplier already applied. Absent at the ceiling, and absent rather than
    /// unmultiplied when that multiplier could not be read: an unmultiplied price
    /// is the right number on a normal career and the wrong one on every other,
    /// which is the shape of a figure nobody can check.
    ///
    /// <para><b>Nothing is charged when an upgrade is queued.</b> RP-1 bills a
    /// construction as it advances, so this is what the project will draw in
    /// total, not what leaves the balance at the press.</para>
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? UpgradeCost { get; set; }

    /// <summary>
    /// RP-1 upgrades this building as a building. False for the ones its config
    /// prices at a single fund under the comment "cosmetic only": RP-1 drives
    /// their tier itself from the mean of the ones it does upgrade, so a project
    /// queued against one would finish at once and then be overwritten.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? UpgradedByRp1 { get; set; }
}
