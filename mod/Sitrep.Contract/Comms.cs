#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/*
 * The comms.* wire contract. Two axes govern every channel here: a PROVIDER
 * axis (the elected backend, stock CommNet or a replacement an Uplink
 * provides, sources the shared channels; a replacement's own detail rides its
 * own channels) and a PRESENCE axis (always-present vs provider-dependent).
 *
 * The DELAY classification splits this family rather than covering it: what
 * KSC can establish about the link from its own end (connectivity, signal
 * strength, control state, the network graph, the occluding geometry) is
 * TRUE-NOW, and what describes the far end of the link (comms.delay,
 * comms.path, comms.degrade) is DELAYED, because a fact about where the craft
 * was travels home at the same speed the telemetry does. Delaying comms.delay
 * is not circular: the reveal gate and the command scheduler read the engine's
 * delay LEDGER, which the capture pass writes directly, never this channel.
 *
 * Every payload carries PayloadMeta; absence is a nullable, never a NaN/0/-1
 * sentinel.
 */

/// <summary>
/// The degree of control a vessel currently has, the <c>controlSource</c> axis
/// of <see cref="CommsConnectivity"/>. The game's control level collapsed to
/// three tiers: partial covers both crewed and uncrewed partial control, and
/// whether a crew is aboard shows on
/// <see cref="CommsConnectivity.HasLocalControl"/> instead.
/// </summary>
/// <category>Comms</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum CommsControlSource
{
    /// <summary>A measurement: the craft has no control source.</summary>
    None,
    /// <summary>Partial control, crewed or uncrewed: stock's <c>PARTIAL_MANNED</c> or <c>PARTIAL_UNMANNED</c> level.</summary>
    Partial,
    /// <summary>Full control.</summary>
    Full,
    /// <summary>
    /// The game reported a control level this build does not name. Not
    /// <see cref="None"/>: nothing was measured to be absent, the level simply
    /// has no tier here yet. <see cref="CommsConnectivity.HasLocalControl"/> is
    /// false alongside it and says nothing.
    /// </summary>
    Unknown,
}

/// <summary>
/// The <c>comms.connectivity</c> payload: always present, sourced from the
/// elected comms backend. Ground-side truth about whether the active vessel
/// has a control link home right now. All three fields describe the same tick.
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.connectivity")]
public class CommsConnectivity
{
    /// <summary>
    /// True when the backend resolved a control path home for the active
    /// vessel. False when it has none, and also when no link state could be
    /// read (then <see cref="ControlSource"/> is
    /// <see cref="CommsControlSource.None"/>).
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool Connected { get; set; }
    /// <summary>The degree of control the vessel has.</summary>
    [SitrepUnit(Units.Enumeration)]
    public CommsControlSource ControlSource { get; set; }
    /// <summary>
    /// True when the vessel's control level is crewed partial control or full
    /// control. Independent of <see cref="Connected"/>: a crewed craft can be
    /// flown with no link home. Full control sets it too, including full control
    /// an uncrewed probe has over its link. False alongside
    /// <see cref="CommsControlSource.Unknown"/>.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool HasLocalControl { get; set; }
    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c> or <c>"game"</c>) and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The <c>comms.signal</c> payload: always present, sourced from the elected
/// comms backend. A strength from 0 to 1 whose meaning depends on the backend:
/// stock CommNet reports a coarse range fraction, RealAntennas a
/// link-budget-derived value.
///
/// <para>A save with the stock CommNet difficulty option off models no link
/// budget at all and reports 1 here: nothing attenuates a link that is not
/// modelled. A reader that needs to know this is not a grading has
/// <see cref="CommsDelaySource.NoCommsModel"/> on <c>comms.delay</c>, which is
/// the one discriminator for the whole family rather than a second one per
/// field.</para>
/// <internal>
/// The honest value in that case is an ABSENCE, and this field cannot carry
/// one: nullable would be a retype, which the contract shape gate refuses
/// without a Major bump. Of the two things a non-nullable double can say, 1 is
/// the one that does not lie, because 0 is what the app's own
/// SignalLossIndicator keys its "Lost" verdict on.
/// <para>RealAntennas' value is a headroom fraction on its data-rate ladder
/// (<c>CommsLinkState.SignalStrength</c>), so the two backends put different
/// curves behind one field.</para>
/// </internal>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.signal")]
public class CommsSignal
{
    /// <summary>
    /// Link strength from 0 to 1, in the backend's own terms (see this type's
    /// summary), so compare values only within one install. 0 when no link
    /// state could be read.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double Strength { get; set; }
    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c> or <c>"game"</c>) and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// What the active vessel can be commanded to do, for
/// <see cref="CommsControl"/>. The game's control level collapsed to three
/// tiers, crewed and uncrewed partial control sharing one.
/// </summary>
/// <category>Comms</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum CommsControlStateKind
{
    /// <summary>A measurement: the craft cannot be commanded.</summary>
    None,
    /// <summary>Partial control, crewed or uncrewed: stock's <c>PARTIAL_MANNED</c> or <c>PARTIAL_UNMANNED</c> level.</summary>
    PartialManoeuvre,
    /// <summary>Full control.</summary>
    Full,
    /// <summary>
    /// The game reported a control level this build does not name, so whether
    /// the craft can be commanded is not known. Not <see cref="None"/>.
    /// </summary>
    Unknown,
}

/// <summary>
/// The <c>comms.control</c> payload: always present, sourced from the elected
/// comms backend. What the active vessel can be commanded to do right now,
/// which is a different question from whether it is connected.
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.control")]
public class CommsControl
{
    /// <summary>The vessel's control level. <see cref="CommsControlStateKind.None"/> when no link state could be read.</summary>
    [SitrepUnit(Units.Enumeration)]
    public CommsControlStateKind Level { get; set; }
    /// <summary>
    /// A human-readable annotation on the control state, or null for none
    /// (never an empty string). The shipped backends set
    /// <c>"no connection to a command source"</c> when the vessel has no link
    /// home, and null when it is connected.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Reason { get; set; }
    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c> or <c>"game"</c>) and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// Whether a comms node is a ground station, or whether a hop touches one.
/// Carried by <see cref="CommsHop.Kind"/> and
/// <see cref="CommsNetworkNode.Kind"/>.
/// </summary>
/// <category>Comms</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum CommsHopKind
{
    /// <summary>A ground station, or a hop with a ground station at either end.</summary>
    Home,
    /// <summary>A vessel node (the active craft included), or a hop between two vessels.</summary>
    Relay,
    /// <summary>Not reported by the shipped backends: vessel nodes, the active craft included, arrive as <see cref="Relay"/>.</summary>
    Vessel,
}

/// <summary>
/// One ordered hop toward home in the control path. Per-hop RealAntennas
/// facts are not fields on this shared shape: the forward band rate rides the
/// RealAntennas Uplink's own <c>realantennas.hopRates</c> channel (a per-hop
/// annotation keyed by these same node ids, joined onto the route
/// client-side), and the other RealAntennas per-hop facts ride
/// <see cref="Extensions"/> under <c>"realantennas"</c>.
///
/// <para>Ground stations carry their OWN name in <see cref="From"/> and
/// <see cref="To"/> (RSS/RealAntennas fly a dozen of them), not a single
/// shared "home" label: two consecutive samples both showing a one-hop direct
/// link, one to Kourou and one to Canberra, are a STATION HANDOFF, not one
/// station whose range changed.</para>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsHop
{
    /// <summary>
    /// The node id at the end of the hop nearer the vessel, in the same id space as
    /// <see cref="CommsNetworkNode.Id"/>: a vessel's persistent id for a craft,
    /// the station's own name for a ground station.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string From { get; set; } = "";
    /// <summary>The node id at the end of the hop nearer home, in the same id space as <see cref="From"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string To { get; set; } = "";
    /// <summary>True when the <see cref="From"/> end is a ground station.</summary>
    [SitrepUnit(Units.Flag)]
    public bool FromIsHome { get; set; }
    /// <summary>True when the <see cref="To"/> end is a ground station.</summary>
    [SitrepUnit(Units.Flag)]
    public bool ToIsHome { get; set; }
    /// <summary>
    /// <see cref="CommsHopKind.Home"/> when either end is a ground station,
    /// otherwise <see cref="CommsHopKind.Relay"/>. One value for the whole hop,
    /// so read <see cref="FromIsHome"/> and <see cref="ToIsHome"/> for which end.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public CommsHopKind Kind { get; set; }
    /// <summary>
    /// Straight-line distance between the two endpoints, in metres: the
    /// geometry the signal delay's light-time is computed over. Null when the
    /// backend cannot supply per-hop geometry, never 0.
    /// </summary>
    [SitrepUnit(Units.Metres)]
    public double? DistanceMeters { get; set; }

    /// <summary>
    /// The provider-namespaced extension bag: how the elected comms backend
    /// carries per-hop facts this shared shape does not declare (see
    /// <see cref="ProviderExtensionBagAttribute"/> for the whole mechanism).
    /// Absent under the stock CommNet backend, which has nothing stock does not
    /// already say; a RealAntennas install fills
    /// <c>Extensions["realantennas"]</c> with band, tech level, modulation,
    /// encoder, required Eb/N0, beamwidth, EC draw and the reverse-direction
    /// rate, typed by the RealAntennas client's own <c>RealAntennasHopExt</c>.
    /// It rides <c>comms.path</c>, so it is Delayed like that channel.
    /// </summary>
    // The key is omitted when no provider filled a bag, so a payload no provider
    // extended carries no trace of the mechanism.
    [SitrepOmittedWhenNull]
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// The <c>comms.path</c> payload: always present, sourced from the elected
/// comms backend. Ordered hops from the active vessel home. An empty
/// <see cref="Hops"/> means no path home, a real control-loss state rather than
/// missing data.
///
/// <para>DELAYED, and NEVER RECKONABLE. The route is the one the arriving
/// signal took, so it reveals with the telemetry that came down it. It carries
/// no forward model and cannot be given one: a route changes DISCRETELY (a
/// relay drops below the horizon and the whole chain re-solves to different
/// hops), and every reckoning basis moves a continuous quantity. What you are
/// shown is the topology as observed; nothing may extrapolate it
/// forward.</para>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.path")]
public class CommsPath
{
    /// <summary>The hops in order, the first starting at the active vessel and the last ending at home. Empty when there is no path home, never null.</summary>
    public IReadOnlyList<CommsHop> Hops { get; set; } = new List<CommsHop>();
    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c> or <c>"game"</c>) and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// One node in the <see cref="CommsNetwork"/> relay graph.
/// <see cref="DisplayName"/> carries the label and <see cref="Kind"/> carries
/// home-ness, so nothing has to read meaning out of <see cref="Id"/>.
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsNetworkNode
{
    /// <summary>
    /// A unique, stable join key in the same id space
    /// <see cref="CommsHop.From"/> and <see cref="CommsHop.To"/> use: a vessel's
    /// persistent id for a craft, the station's own name for a ground station.
    /// Never a vessel's display name, which two craft can share.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";
    /// <summary>The node's human-facing name: the vessel's name, or the ground station's.</summary>
    [SitrepUnit(Units.Text)]
    public string DisplayName { get; set; } = "";
    /// <summary><see cref="CommsHopKind.Home"/> for a ground station, <see cref="CommsHopKind.Relay"/> for a vessel.</summary>
    [SitrepUnit(Units.Enumeration)]
    public CommsHopKind Kind { get; set; }
}

/// <summary>One edge in the <see cref="CommsNetwork"/> relay graph, joining two <see cref="CommsNetworkNode.Id"/> values.</summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsNetworkEdge
{
    /// <summary>The <see cref="CommsNetworkNode.Id"/> of the end nearer the vessel.</summary>
    [SitrepUnit(Units.Id)]
    public string A { get; set; } = "";
    /// <summary>The <see cref="CommsNetworkNode.Id"/> of the end nearer home.</summary>
    [SitrepUnit(Units.Id)]
    public string B { get; set; } = "";
    /// <summary>
    /// True when the edge carries the vessel's current control path. The
    /// shipped backends report only the control path's edges, so every edge
    /// they emit is true.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool Active { get; set; }
}

/// <summary>
/// The <c>comms.network</c> payload: always emitted, the network as the
/// elected comms backend sees it from the active vessel. The shipped backends
/// report the nodes and edges of the vessel's control path, so the graph is
/// empty when there is no path home.
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.network")]
public class CommsNetwork
{
    /// <summary>Every node in the graph, each <see cref="CommsNetworkNode.Id"/> once. Never null.</summary>
    public IReadOnlyList<CommsNetworkNode> Nodes { get; set; } = new List<CommsNetworkNode>();
    /// <summary>Every edge in the graph. Never null.</summary>
    public IReadOnlyList<CommsNetworkEdge> Edges { get; set; } = new List<CommsNetworkEdge>();
    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c> or <c>"game"</c>) and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>Why <see cref="CommsDelay.OneWaySeconds"/> has the value it has.</summary>
/// <category>Comms</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum CommsDelaySource
{
    /// <summary>No delay measured: either there is no measurable path (the value is null) or delay is switched off (the value is 0).</summary>
    None,
    /// <summary>A light-time computed over the route's hop geometry.</summary>
    SignalDelay,

    /// <summary>
    /// Zero, because this save models no comms network AT ALL: the stock
    /// CommNet difficulty option is off, so there are no ground stations, no
    /// relay graph and no path to measure a light-time over. Control reaches a
    /// craft directly, from anywhere, instantly.
    ///
    /// <para>A POSITIVE FACT, and the reason it is a member here rather than a
    /// null <see cref="CommsDelay.OneWaySeconds"/>: null means "there is a
    /// comms model and it can measure nothing right now", which is a permanent
    /// blackout and the exact opposite prognosis. This is what distinguishes
    /// the two ON THE WIRE. A save with no comms model reports this alongside
    /// <c>connected:true</c>, so the channel keeps arriving with nothing held
    /// back, where a real blackout reports null and stops.</para>
    /// </summary>
    NoCommsModel,
}

/// <summary>
/// The <c>comms.delay</c> payload: the one-way signal delay to the active
/// vessel, gated by the <c>comms.signalDelay.enabled</c> setting.
/// <see cref="OneWaySeconds"/> distinguishes two DIFFERENT "no delay" cases
/// by value, never by one overloaded sentinel:
/// <list type="bullet">
/// <item><description><b>null</b>: no measurable <see cref="CommsPath"/>
/// (no path home, or incomplete hop geometry). There is nothing to measure,
/// so nothing is reported. <see cref="Source"/> is
/// <see cref="CommsDelaySource.None"/>.</description></item>
/// <item><description><b>0</b>: the delay feature is disabled
/// (<c>comms.signalDelay.enabled = false</c>). A genuine "zero delay
/// applied", not an absence. <see cref="Source"/> is also
/// <see cref="CommsDelaySource.None"/> here: the two cases share the same
/// <c>Source</c> and are told apart only by whether the value is
/// null.</description></item>
/// <item><description>a real number: <see cref="Source"/> is
/// <see cref="CommsDelaySource.SignalDelay"/>, a light-time computed over
/// the elected backend's hop geometry.</description></item>
/// </list>
/// One zero names its own reason instead of sharing
/// <see cref="CommsDelaySource.None"/>:
/// <see cref="CommsDelaySource.NoCommsModel"/>, which is what tells a
/// client that a board showing no path and no relay graph is a save with the
/// CommNet difficulty option off, not a craft in a permanent blackout: the
/// blackout reports <c>null</c> here and <c>connected:false</c> on
/// <see cref="CommsLink"/>, and this reports <c>0</c> and
/// <c>connected:true</c>.
///
/// <para>DELAYED, like the telemetry it describes. A light-time is measured
/// over the route a signal actually took, so the figure that reaches an
/// operator is the delay as it WAS when the light left, and a craft whose delay
/// has grown says so one light-time after it grew. Read it as an observation
/// rather than as the current state of the link.
/// <internal>
/// Delaying it is not circular. What releases every other Delayed channel is the engine's delay LEDGER
/// (<c>INetwork.DelayTo</c>), fed by <c>ChannelEngine.CaptureSignalDelay</c> and
/// the per-vessel/per-centre writes, all of which run on the ungated capture
/// path. This channel is a readout published from the same computation. The SDK
/// side is the same shape: <c>DelayAuthority</c> subscribes to the raw stream,
/// so the value it hands <c>ViewClock</c> is never itself gated by a view time.
/// </internal></para>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.delay")]
public class CommsDelay
{
    /// <summary>
    /// The one-way light-time to the command centre, seconds. See this type's
    /// own summary for the null/zero split, which is the whole discriminator:
    /// null is "nothing measurable", 0 is a measured or applied zero.
    ///
    /// <para><b>Carried forward by re-measuring ONE leg of the route.</b> A
    /// delay is the whole route's length over the speed light travels at, and
    /// almost none of that route changes between the instant the light left and
    /// the instant it is read: every hop except the first joins two ground
    /// stations, or a station and a relay, or two relays, none of which move
    /// appreciably against each other on a telemetry timescale. So their
    /// measured lengths carry forward as the sum they already were, and only
    /// the FIRST hop, the one with the craft on one end, is re-derived:
    /// <c>(route - firstHop + |craft - peer|) / c</c>, the craft propagated on
    /// <c>@vessel.orbit</c> and its peer placed from
    /// <c>@commandCentre.roster</c>, whose latitude and longitude are
    /// body-fixed and so need the rotation phase on <c>@system.bodies</c>.</para>
    ///
    /// <para>Declared for a route whose first hop ends at a GROUND STATION,
    /// which is the direct link and the common case. A first hop ending at a
    /// RELAY needs that relay's own elements, which ride the per-vessel
    /// <c>fleet.&lt;guid&gt;.orbit</c> channel under a guid not known until the
    /// route arrives; an input here is a Topic id resolved against the declared
    /// set, so there is no way to name it and no promise made about it. A
    /// client reading a relayed route gets an honest refusal naming that
    /// channel rather than a modelled number.</para>
    ///
    /// <para>The <see cref="Source"/> is an input because two of its three
    /// members are a zero that means something other than "no distance": delay
    /// is switched off, or the save models no comms network. Neither stops
    /// being true as the craft moves, so only
    /// <see cref="CommsDelaySource.SignalDelay"/> is carried forward.</para>
    /// <internal>
    /// The client divides the OBSERVED delay by the OBSERVED route rather than
    /// by a light-speed constant, which recovers whatever
    /// <c>SignalDelay.EffectiveC</c> used, <c>LightSpeedScale</c> included,
    /// without that setting reaching the wire. It also makes the model reproduce the observation exactly at
    /// its own instant, so the reckoned value leaves the measured one
    /// continuously.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    [SitrepReckonable(
        ReckoningBases.KeplerPropagation,
        "source",
        "@comms.path",
        "@vessel.orbit",
        "@system.bodies",
        "@commandCentre.roster")]
    public double? OneWaySeconds { get; set; }

    /// <summary>Why <see cref="OneWaySeconds"/> has the value it has; see <see cref="CommsDelaySource"/>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public CommsDelaySource Source { get; set; }
    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c> or <c>"game"</c>) and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The <c>comms.link</c> payload: the one statement a client should read for
/// "is there a control link home right now?". Read <c>comms.link.connected</c>
/// for that question rather than any raw <c>comms.*</c> observation such as
/// <see cref="CommsConnectivity"/>.
///
/// <para><b>Delayed, and exempt from the freeze.</b> The link state is what
/// reports a signal-loss freeze, so it cannot be frozen by it. It reveals a
/// disconnect at <c>T+delay</c> (you learn of the outage one light-time after
/// it happens) and keeps reporting <c>connected:false</c> through the
/// blackout, so a "no signal" indicator flips at the correct delayed instant.
/// The <see cref="VesselComms"/> observations (signal strength, control
/// state) are Delayed and DO freeze: they hold their last value through the
/// outage.</para>
/// <internal>
/// Published by <c>ChannelEngine.ConnectivityMetaTopic</c>. Its readers include
/// the app's SignalLossIndicator and CameraFeed and the kOS terminal's
/// line-mode gate.
/// </internal>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.link")]
public class CommsLink
{
    /// <summary>True while the active vessel has a control link home, as of one light-time ago; false through a blackout.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Connected { get; set; }
    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c> or <c>"game"</c>) and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The <c>comms.commandCentre</c> payload: WHICH command centre the active
/// vessel's control path currently terminates at, a ground station or a
/// crewed control-source vessel (the stock "command center" mechanic), so a
/// client can show its own stats against the right name instead of assuming
/// KSC. Shares its id and kind scheme with <see cref="CommandCentreEntry"/>
/// (the <c>commandCentre.roster</c> entries): it names ONE entry from that
/// same set, whichever one the vessel's control path resolved to this tick.
/// A ground station is preferred when the last hop touches both.
///
/// <para>Every field is null when there is no live remote centre right now (no
/// connection, or the last hop touches neither a ground station nor a crewed
/// control source); <c>comms.link</c> already reports that case as no
/// signal.</para>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.commandCentre")]
public class CommsCommandCentre
{
    /// <summary>
    /// Stable centre key, same scheme as <see cref="CommandCentreEntry.Id"/>:
    /// <c>"ground:&lt;name&gt;"</c> or <c>"vessel:&lt;guid&gt;"</c>. Null when no
    /// remote centre resolved.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }
    /// <summary>The centre's human-facing name. Null when no remote centre resolved.</summary>
    [SitrepUnit(Units.Text)]
    public string? DisplayName { get; set; }
    /// <summary>
    /// One of <c>GroundStation</c>, <c>CrewedVessel</c>, <c>Colony</c> or
    /// <c>Custom</c>, same as <see cref="CommandCentreEntry.Kind"/>. Null when
    /// no remote centre resolved.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Kind { get; set; }
    /// <summary>
    /// Index into <c>system.bodies</c> of the body this centre sits on. Null
    /// when unknown, not surface-anchored, or the centre is a moving vessel.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public int? BodyIndex { get; set; }
    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c> or <c>"game"</c>) and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}

/*
 * What belongs in this file, and what does not.
 *
 * The boundary is the PROVIDER axis this file's own header describes, never a
 * filename: an elected backend fills the shared shapes, so those shapes are
 * core no matter which backend is winning today. A payload only ONE backend
 * could ever source is NOT core, and is declared in that backend's own
 * contract slice instead. Its producer flattens it itself, so core's serializer
 * needs no case for it either.
 *
 * A provider-only nullable field on a shared type is still a core change an
 * out-of-tree comms provider cannot land. A per-provider fact rides either
 * that provider's own channel, keyed by these same node ids and joined onto
 * the route client-side, or CommsHop.Extensions under the provider's
 * namespace.
 */

/// <summary>
/// One hop of a route a backend has solved: the geometry between its two
/// endpoints, whether either end is a ground station, and the two endpoints'
/// own opaque node handles.
///
/// <para>Not a <see cref="CommsHop"/>: it carries no node ids, only the
/// backend's own node handles, which a caller resolves to a name only when it
/// needs one.</para>
///
/// <para><see cref="FromHandle"/> and <see cref="ToHandle"/> are the same
/// opaque terms <see cref="CommsNodeView.Handle"/> and
/// <see cref="ICommsBackend.RouteBetween"/> use: a live object,
/// reference-matched by whoever asked for it, never dereferenced and never
/// resolved to a name by this struct. They are optional because a hop built
/// outside a live backend walk (a test fixture, a synthesised route) may have
/// none to give.</para>
///
/// <para>Carries no KSP type, so arithmetic built on it runs with no KSP
/// reference assemblies at all.</para>
/// <internal>
/// Naming a node costs a walk over every vessel in the game, which the
/// centre-to-centre delay matrix (centres squared, every tick) cannot pay.
/// </internal>
/// </summary>
/// <category>Uplink API</category>
public readonly struct CommsRouteHop
{
    /// <summary>A hop with no node handles.</summary>
    /// <param name="distanceMeters">Straight-line distance between the two endpoints, in metres.</param>
    /// <param name="touchesHome">True when either endpoint is a ground station.</param>
    public CommsRouteHop(double distanceMeters, bool touchesHome)
        : this(distanceMeters, touchesHome, fromHandle: null, toHandle: null)
    {
    }

    /// <summary>A hop carrying the backend's own handles for its two endpoints.</summary>
    /// <param name="distanceMeters">Straight-line distance between the two endpoints, in metres.</param>
    /// <param name="touchesHome">True when either endpoint is a ground station.</param>
    /// <param name="fromHandle">The live object behind the origin endpoint, or null.</param>
    /// <param name="toHandle">The live object behind the destination endpoint, or null.</param>
    public CommsRouteHop(double distanceMeters, bool touchesHome, object? fromHandle, object? toHandle)
    {
        DistanceMeters = distanceMeters;
        TouchesHome = touchesHome;
        FromHandle = fromHandle;
        ToHandle = toHandle;
    }

    /// <summary>Straight-line distance between the hop's two endpoints, in metres.</summary>
    public double DistanceMeters { get; }

    /// <summary>True when EITHER endpoint is a ground station.</summary>
    public bool TouchesHome { get; }

    /// <summary>The live object behind this hop's origin endpoint, or null when
    /// the caller had none to give.</summary>
    public object? FromHandle { get; }

    /// <summary>The live object behind this hop's destination endpoint, or null
    /// when the caller had none to give.</summary>
    public object? ToHandle { get; }
}

/// <summary>
/// The pure, KSP-free object the exclusive <c>"comms"</c> capability resolves
/// to: exactly the readouts every comms backend can honestly supply.
/// RealAntennas-only richness (link margin, data rate) is not on this
/// interface and lives on RealAntennas' own channels instead.
///
/// <para>Each accessor returns a wire payload that the core comms
/// registration publishes to its channel after resolving the elected backend
/// via <c>host.Kernel.Query&lt;ICommsBackend&gt;("comms")</c>. Implementations
/// read live KSP and mod state and MUST be called only where such reads are
/// safe (on the main thread, during capture): the interface itself is
/// pure.</para>
///
/// <para>Every accessor that reads a ROUTE takes the craft it is asked about,
/// as <c>vessel</c>, and none of them assumes the one on screen: the active
/// craft is simply the vessel its caller passes. <c>vessel</c> is an OPAQUE
/// handle on the same terms as <see cref="RouteBetween"/>'s node handles. Both
/// shipped backends read it as a KSP <c>Vessel</c>, and a handle a backend does
/// not recognise, or a null one, is treated as a craft with no route.</para>
/// </summary>
/// <category>Uplink API</category>
public interface ICommsBackend : ISitrepProvider
{
    /// <summary>
    /// Whether the active vessel is connected right now, and on which axis.
    /// Live read, main thread only, like every accessor here.
    /// </summary>
    /// <returns>The <c>comms.connectivity</c> payload.</returns>
    CommsConnectivity Connectivity();

    /// <summary>
    /// How good the active vessel's link is right now. A backend that models
    /// no signal strength still returns a value, saying so through it rather
    /// than by throwing: a caller cannot tell a thrown accessor from a broken
    /// one.
    /// </summary>
    /// <returns>The <c>comms.signal</c> payload.</returns>
    CommsSignal SignalStrength();

    /// <summary>
    /// What the active vessel can be commanded to do right now, which is not the
    /// same question as <see cref="Connectivity"/>: a probe with no crew and no
    /// link is connected to nothing AND uncontrollable, a crewed vessel out of
    /// contact is uncontrollable remotely and fully controllable locally.
    /// </summary>
    /// <returns>The <c>comms.control</c> payload.</returns>
    CommsControl ControlState();

    /// <summary>
    /// <paramref name="vessel"/>'s ordered hops home: the geometry the signal
    /// delay's light-time is computed over. Empty when it has no route.
    /// </summary>
    /// <param name="vessel">The craft to route from, as an opaque handle.</param>
    /// <returns>The <c>comms.path</c> payload.</returns>
    CommsPath Path(object? vessel);

    /// <summary>
    /// The network as this backend sees it from <paramref name="vessel"/>: the
    /// nodes and links a client draws. Live read; the shape changes as craft move
    /// and ground stations rotate, so a caller reads it per frame rather than
    /// caching it.
    /// </summary>
    /// <param name="vessel">The craft to view the network from, as an opaque handle.</param>
    /// <returns>The <c>comms.network</c> payload.</returns>
    CommsNetwork Network(object? vessel);

    /// <summary>
    /// The route THIS backend's own router finds between two nodes, as ordered
    /// hop geometry, or null when it will not route between them.
    ///
    /// <para>It is on the interface for the same reason
    /// <see cref="OcclusionModel"/> is: routing is a rule the elected backend
    /// owns, not a stock method core can call on its behalf. RealAntennas
    /// overrides <c>CommNetwork.FindClosestWhere</c> and leaves
    /// <c>FindPath</c> alone, so calling stock <c>FindPath</c> directly quotes
    /// light-times over routes RealAntennas refuses to carry.</para>
    ///
    /// <para><paramref name="from"/> and <paramref name="to"/> are OPAQUE node
    /// handles on the same terms as <see cref="IActiveVessel.Reported"/>: both
    /// shipped backends read them as a KSP <c>CommNet.CommNode</c>, and a
    /// backend handed something it does not recognise returns null rather than
    /// guessing. Null is also the result for a missing handle, the same node at
    /// both ends (a path to yourself is not a route), and an unreachable end: a
    /// caller that wants "no delay because it is the same place" says so itself,
    /// because a route that does not exist has no light-time and a zero would
    /// claim one.</para>
    ///
    /// <para>An EMPTY list is a different result again: routed, with nothing to
    /// measure. Live read, so main thread only, like every accessor
    /// above.</para>
    /// </summary>
    /// <param name="from">The start node, as an opaque handle.</param>
    /// <param name="to">The end node, as an opaque handle.</param>
    /// <returns>The hops in order, or null when there is no route.</returns>
    IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to);

    /// <summary>
    /// Whether this backend can still carry a signal from
    /// <paramref name="vessel"/> to <paramref name="nodeId"/>, a node that
    /// vessel's route was recently running THROUGH. <c>null</c> means it cannot
    /// say.
    ///
    /// <para>It exists to tell two things apart that <see cref="Path"/> alone
    /// cannot, and the difference decides whether telemetry already in flight
    /// ever lands. A relay leaving the route because a cheaper one appeared is
    /// an ordinary reroute: the old relay is still there, still forwarding, and
    /// the tail crossing it arrives. A relay leaving the route because it was
    /// destroyed, or because a body moved in front of it, is a BREAK: nothing
    /// retransmits the tail and it is lost. Both look identical in a before and
    /// after comparison of <see cref="Path"/>, because both are simply a
    /// different list of hops.</para>
    ///
    /// <para><c>null</c> rather than a guess when the backend has no opinion,
    /// on the same terms as <see cref="CommsReachModels.Unknown"/>. A caller
    /// that cannot establish a break must do what it does with no break at all,
    /// which is deliver, because a wrongly-declared break deletes telemetry that
    /// physically arrived.</para>
    ///
    /// <para>Live read, so main thread only, like every accessor above.</para>
    /// </summary>
    /// <param name="vessel">The craft whose route is in question, as an opaque handle.</param>
    /// <param name="nodeId">The node id, as <see cref="CommsHop.From"/> and <see cref="CommsHop.To"/> carry it.</param>
    /// <returns>True when the signal still reaches the node, false when it does not, null when the backend cannot say.</returns>
    bool? StillCarriesTo(object? vessel, string nodeId);

    /// <summary>
    /// The reach rule this backend applies between two nodes: how far apart
    /// they can be and still carry a link (see <see cref="ICommsReachModel"/>
    /// for the whole rule, and why core cannot supply it for any backend).
    ///
    /// <para>It is on the interface for the same reason
    /// <see cref="OcclusionModel"/> and <see cref="RouteBetween"/> are. Without
    /// a declared reach, a contact prediction models the geometry and nothing
    /// else, and promises reacquisition on line of sight alone. That is a
    /// PREDICTION an operator plans against rather than a readout they can
    /// check against the game, which makes it worse than a wrong number on
    /// screen.</para>
    ///
    /// <para><paramref name="from"/> and <paramref name="to"/> are OPAQUE node
    /// handles on exactly the terms <see cref="RouteBetween"/> established: both
    /// shipped backends read them as a KSP <c>CommNet.CommNode</c>, and a
    /// backend handed something it does not recognise declares nothing rather
    /// than guessing.</para>
    ///
    /// <para>NEVER null: a backend that cannot rate the pair returns
    /// <see cref="CommsReachModels.Unknown"/>, whose maximum is ABSENT. Absent
    /// asserts no limit and leaves the consumer predicting what it can, which is
    /// the only honest fallback here (<see cref="CommsReachModels.Unknown"/>
    /// carries the argument for why there is no conservative guess to make).
    /// Live read to BUILD the rule, so main thread only, like every accessor
    /// above; the model it returns is thereafter pure arithmetic and safe
    /// anywhere, including a sweep evaluating it at thousands of future
    /// instants off-thread.</para>
    /// </summary>
    /// <param name="from">One node, as an opaque handle.</param>
    /// <param name="to">The other node, as an opaque handle.</param>
    /// <returns>The reach rule for the pair, never null.</returns>
    ICommsReachModel ReachModel(object? from, object? to);

    /// <summary>
    /// How degraded this backend grades the active vessel's link home right now
    /// (see <see cref="ICommsDegradeModel"/> for the scale, and why core cannot
    /// grade it for any backend).
    ///
    /// <para>It is on the interface for the same reason
    /// <see cref="OcclusionModel"/> and <see cref="ReachModel"/> are. A quality
    /// derived as <c>1 - comms.signal.strength</c> is a different curve per
    /// install, because that field carries a range fraction under stock and a
    /// rate-ladder headroom fraction under RealAntennas, with nothing saying
    /// so. Asking the backend gets a rating that arrives with its rule
    /// attached.</para>
    ///
    /// <para>NEVER null: a backend that will not grade the link returns
    /// <see cref="CommsDegradeModels.Unknown"/>, whose rating is ABSENT, and
    /// that is the one-line implementation a backend with no opinion should
    /// give rather than inventing one. Absent leaves a consumer doing exactly
    /// what it would do with no rating, which is the only honest fallback on a
    /// scale whose every value is an instruction.</para>
    ///
    /// <para>Live read to BUILD the rating, so main thread only, like every
    /// accessor above; the model it returns is thereafter just a number and
    /// safe anywhere.</para>
    /// </summary>
    /// <returns>The degrade rating for the active vessel's link, never null.</returns>
    ICommsDegradeModel DegradeModel();

    /// <summary>
    /// The node <paramref name="vessel"/>'s control path, as this backend solved
    /// it, terminates at, as an opaque handle, or null when it terminates
    /// nowhere (no connection, or a last hop that touches neither a ground
    /// station nor a crewed control source).
    ///
    /// <para><b>A handle, not a <see cref="CommsCommandCentre"/>.</b> Naming
    /// the centre takes two things and only one of them is the backend's: WHICH
    /// node the path ended at is a fact about the path, and the path is the
    /// backend's; matching that node against the live centre registry, and
    /// shaping the payload, is core's, and the registry is a core type an Uplink
    /// may not reference. So the backend supplies the half it owns and core does
    /// the rest, once, for whichever backend won. The terminal-node rule itself
    /// is shared (both shipped backends inherit stock's <c>isHome</c> and
    /// <c>isControlSource</c> unchanged).</para>
    ///
    /// <para>Live read, main thread only. The handle it returns is a live KSP
    /// object and MUST NOT cross a thread boundary or outlive the capture that
    /// produced it; core resolves it to a payload on the same thread.</para>
    /// </summary>
    /// <param name="vessel">The craft whose control path is read, as an opaque handle.</param>
    /// <returns>The terminal node's handle, or null.</returns>
    object? ControlPathTerminus(object? vessel);

    /// <summary>
    /// The occlusion geometry this backend applies: which radius of a body
    /// actually blocks a radio path through it (see
    /// <see cref="ICommsOcclusionModel"/>). Stock CommNet shrinks the body by
    /// its occlusion multipliers, RealAntennas does not, and that difference is
    /// worth minutes of predicted blackout, so it is DECLARED here rather than
    /// inferred by a consumer branching on which mod is installed.
    ///
    /// <para>Unlike the accessors above this returns a rule, not a reading. It
    /// may perform a live read to BUILD the rule (stock's multipliers are a
    /// difficulty setting), so it is called on the main thread during capture;
    /// the model it returns is thereafter pure arithmetic and safe
    /// anywhere.</para>
    /// </summary>
    /// <returns>The occlusion rule, never null.</returns>
    ICommsOcclusionModel OcclusionModel();
}
