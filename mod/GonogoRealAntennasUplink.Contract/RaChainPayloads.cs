#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using Sitrep.Contract;

namespace Gonogo.RealAntennasUplink;

// ====================================================================
// The FALLBACK CHAIN half of antenna targeting: an ordered list of targets for
// one antenna, walked by the craft when it has no link.
//
// Why the walk happens on the craft and not here. A chain exists to keep
// working while the link is DOWN, and anything that watched connectivity from
// the ground and sent a fresh target would be unable to act at exactly the
// moment it was needed: the command has nowhere to arrive. So the operator
// sends the chain ONCE, delayed like any other signal to the craft, and the
// craft then walks it with no delay at all.
//
// What "unreachable" can mean here, stated honestly. Nothing can say whether a
// target WOULD close a link without aiming at it first: the pointing loss a
// dish takes is a function of where it is currently aimed, so a chain is a
// TRIAL WALK rather than a lookup. The signal it walks on is the craft's own
// comms connectivity, which on a RealAntennas install is RealAntennas' answer,
// and which is already this Uplink's authority over its own geometric margin.
// That signal is per-CRAFT, so a chain answers "this craft has no link" and
// never "this target is occluded".
//
// R7 discipline as elsewhere in this slice: absence is a nullable (T?), never
// a NaN/0/-1 sentinel.
// ====================================================================

/// <summary>
/// One entry of a chain as the OPERATOR SENDS it: a target, and nothing about
/// when to use it. Position in the chain is what says when.
///
/// <para>This is the mode-and-parameters half of
/// <see cref="RealAntennasTargetArgs"/> with the antenna taken off, because an
/// entry names a place to aim and the chain names the antenna that aims there.
/// Which of the optional fields are read depends on <see cref="Mode"/>, and a
/// field the mode does not read is ignored rather than refused, exactly as for
/// the single-target command.</para>
///
/// <para><b>There is no "home" entry, and none is needed.</b>
/// <c>BodyCenter</c> with no <see cref="BodyName"/> is the home body's centre,
/// the same aim point <c>realantennas.antenna.targetHome</c> produces.</para>
///
/// <para><b>It has a read-side twin, <see cref="RealAntennasTargetStep"/>, and
/// the split is the same one the single-target command already makes.</b> A
/// write shape carries plain numbers, because a client builds it and it goes
/// straight onto the wire; a read shape carries each number with its unit,
/// because a client renders it. Which is why this pair reads exactly like
/// <see cref="RealAntennasTargetArgs"/> beside
/// <see cref="RealAntennasAntennaState"/>'s target fields.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class RealAntennasTargetStepArgs
{
    /// <summary>
    /// One of <c>Vessel</c>, <c>BodyCenter</c>, <c>BodyLatLonAlt</c>,
    /// <c>AzEl</c>, <c>OrbitRelative</c>. Anything else is refused, and it is
    /// refused for the WHOLE chain rather than for the entry: a chain accepted
    /// with one unusable entry in it would silently skip a fallback the
    /// operator is relying on.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string Mode { get; set; } = "";

    /// <summary>The vessel to point at, for <c>Vessel</c>. Ignored by every other mode.</summary>
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    /// <summary>
    /// The body, for <c>BodyCenter</c> and <c>BodyLatLonAlt</c>. Empty means the
    /// home body.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? BodyName { get; set; }

    /// <summary>Latitude (degrees, -90..90), for <c>BodyLatLonAlt</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Latitude { get; set; }

    /// <summary>Longitude (degrees, -180..360), for <c>BodyLatLonAlt</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Longitude { get; set; }

    /// <summary>Altitude above the surface (metres), for <c>BodyLatLonAlt</c>. Omitted means the surface.</summary>
    [SitrepUnit(Units.Metres)]
    public double? Altitude { get; set; }

    /// <summary>Azimuth (degrees, 0..360), for <c>AzEl</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Azimuth { get; set; }

    /// <summary>Elevation (degrees, -90..90), for <c>AzEl</c> and <c>OrbitRelative</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Elevation { get; set; }

    /// <summary>Deflection from prograde (degrees, -180..180), for <c>OrbitRelative</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Forward { get; set; }
}

/// <summary>
/// One entry of a chain as the CRAFT REPORTS it, on
/// <c>realantennas.antennaChains</c>. Field for field the same target as
/// <see cref="RealAntennasTargetStepArgs"/>, which is what the operator sent.
///
/// <para>Every number here arrives with its unit, because this side is read and
/// rendered. That is the only difference between the two, and it is why there
/// are two: see the write twin for the rule.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class RealAntennasTargetStep
{
    /// <summary>
    /// The target's mode: <c>Vessel</c>, <c>BodyCenter</c>,
    /// <c>BodyLatLonAlt</c>, <c>AzEl</c> or <c>OrbitRelative</c>.
    ///
    /// <para>It comes back as the operator sent it, including
    /// <c>BodyCenter</c>, which is NOT how RealAntennas stores the target it
    /// lowers to. This is the chain the craft is holding rather than a reading
    /// of the antenna, and a chain is what was asked for.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string Mode { get; set; } = "";

    /// <summary>The vessel to point at, for <c>Vessel</c>. Null for every other mode.</summary>
    [SitrepUnit(Units.Id)]
    public string? VesselId { get; set; }

    /// <summary>The body, for <c>BodyCenter</c> and <c>BodyLatLonAlt</c>. Null means the home body.</summary>
    [SitrepUnit(Units.Text)]
    public string? BodyName { get; set; }

    /// <summary>Latitude (degrees), for <c>BodyLatLonAlt</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Latitude { get; set; }

    /// <summary>Longitude (degrees), for <c>BodyLatLonAlt</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Longitude { get; set; }

    /// <summary>Altitude above the surface (metres), for <c>BodyLatLonAlt</c>.</summary>
    [SitrepUnit(Units.Metres)]
    public double? Altitude { get; set; }

    /// <summary>Azimuth (degrees), for <c>AzEl</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Azimuth { get; set; }

    /// <summary>Elevation (degrees), for <c>AzEl</c> and <c>OrbitRelative</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Elevation { get; set; }

    /// <summary>Deflection from prograde (degrees), for <c>OrbitRelative</c>.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Forward { get; set; }
}

/// <summary>
/// Args for <c>realantennas.antenna.targetChain</c>: hand one antenna an
/// ordered list of targets, to be tried in order whenever the craft has no
/// link.
///
/// <para>Sending an EMPTY list clears the chain, which is the only way to stop
/// a walk. There is no second command for it: a clear is the same operator
/// decision as a change, and a chain of no entries is not a chain.</para>
///
/// <para>Replaces whatever chain the antenna already held rather than appending
/// to it, so a client always sends the whole list it means.</para>
///
/// <para><b>The chain does not aim the antenna when it arrives.</b> It is
/// stored, and the first entry is applied on the first evaluation that finds
/// the craft without a link. An antenna already carrying traffic keeps carrying
/// it: a chain is a fallback, and arming one must not cost the operator the
/// link they still have.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("realantennas.antenna.targetChain")]
public class RealAntennasTargetChainArgs
{
    /// <summary>Which antenna, as <see cref="RealAntennasAntennaState.AntennaId"/> gives it.</summary>
    [SitrepUnit(Units.Id)]
    public string AntennaId { get; set; } = "";

    /// <summary>
    /// The targets, in the order they are to be tried. Empty clears the chain.
    ///
    /// <para>Every entry is validated against the antenna's tech level before
    /// any of them is stored, on the same gate the single-target command
    /// applies, so a chain cannot hold an entry the antenna has not earned.</para>
    /// </summary>
    public RealAntennasTargetStepArgs[] Steps { get; set; } = new RealAntennasTargetStepArgs[0];

    /// <summary>
    /// How long to leave an entry in place before judging it, in seconds of
    /// game time. Omitted takes the default the craft applies.
    ///
    /// <para>It exists because a link is not lost and regained instantly: an
    /// aim point takes a moment to be solved, and a craft crossing a terminator
    /// flickers. Too short and the chain walks past a target that was about to
    /// work; too long and a real outage lasts longer than it had to.</para>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? SettleSeconds { get; set; }
}

/// <summary>
/// One antenna's fallback chain as the craft currently holds it, on the
/// <c>realantennas.antennaChains</c> channel: the list, which entry is in
/// place, and why. The channel value is a bare ARRAY of these, one entry per
/// antenna of the reported craft that has a chain, so an empty array means the
/// craft has none.
///
/// <para>DELAYED, for the same reason <c>realantennas.antennas</c> is: this is
/// state held on the craft, and the walk that changes it happens there.</para>
///
/// <para>Scoped to the REPORTED craft, though the craft walks every chain it
/// holds. A chain set on another vessel keeps being evaluated and is simply not
/// described here, because a delayed channel is delayed by the reported
/// vessel's own light-time and cannot carry another craft's state at the right
/// age.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("realantennas.antennaChains", isArray: true)]
public class RealAntennasAntennaChain
{
    /// <summary>Which antenna, as <see cref="RealAntennasAntennaState.AntennaId"/> gives it.</summary>
    [SitrepUnit(Units.Id)]
    public string AntennaId { get; set; } = "";

    /// <summary>The chain, in the order the craft tries it.</summary>
    public RealAntennasTargetStep[] Steps { get; set; } = new RealAntennasTargetStep[0];

    /// <summary>
    /// Which entry the antenna is currently aimed at, as an index into
    /// <see cref="Steps"/>.
    ///
    /// <para><c>null</c> means the walk has not started: the craft has had a
    /// link for as long as it has held this chain, so no entry has ever been
    /// applied and the antenna is still aimed wherever it was. That is the
    /// normal resting state of a fallback, not a fault.</para>
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? ActiveStep { get; set; }

    /// <summary>
    /// What the walk is doing: <c>holding</c> (the craft has a link, nothing to
    /// do), <c>settling</c> (an entry was just applied and is being given its
    /// time), <c>walking</c> (no link, and entries are being tried), or
    /// <c>blocked</c> (there is no link and the chain cannot act, with
    /// <see cref="Detail"/> saying why).
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string State { get; set; } = "";

    /// <summary>
    /// Why the walk is in the state it is, in one sentence for an operator.
    /// Always present for <c>blocked</c>, because a chain that cannot act is
    /// the one case where the state alone is not enough to act on.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Detail { get; set; }

    /// <summary>The settle time in force for this chain (seconds of game time).</summary>
    [SitrepUnit(Units.Seconds)]
    public double SettleSeconds { get; set; }

    /// <summary>
    /// When the craft last aimed this antenna from the chain. <c>null</c> while
    /// <see cref="ActiveStep"/> is null, there being no such moment.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? LastAppliedUt { get; set; }

    /// <summary>
    /// How many times the walk has been all the way through the chain without
    /// the craft regaining a link. Zero on a chain that is holding.
    ///
    /// <para>It is the number that says a chain has stopped being a fallback and
    /// become a search: every entry has been tried and none of them worked, and
    /// the cause is not in the list.</para>
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int Laps { get; set; }

    /// <summary>
    /// Whether the craft holding this antenna has a comms link, which is the
    /// signal the whole walk turns on.
    ///
    /// <para><c>null</c> means nobody could read it, and the walk treats that as
    /// a reason NOT to act: advancing on an unreadable signal would slew a dish
    /// that may be carrying the link.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Connected { get; set; }

    /// <summary>
    /// Whether THIS antenna is an endpoint of one of the craft's live links,
    /// rather than a dish aimed somewhere that nothing is using.
    ///
    /// <para>It is not what the walk decides on, and it is what tells an
    /// operator whether the entry in place is the one doing the work: a craft
    /// can be connected through an omni while the chain's dish points at
    /// nothing. <c>null</c> when it could not be read.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Carrying { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
