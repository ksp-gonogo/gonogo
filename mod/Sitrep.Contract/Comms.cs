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
 * is not circular: the reveal gate and the command scheduler read the delay
 * the host keeps per vantage (INetwork.DelayTo), which ChannelEngine's capture
 * pass writes directly, never this channel.
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
    /// <summary>The craft has no control source. A reading, unlike <see cref="Unknown"/>.</summary>
    None,
    /// <summary>Partial control, crewed or uncrewed: stock's <c>PARTIAL_MANNED</c> or <c>PARTIAL_UNMANNED</c> level.</summary>
    Partial,
    /// <summary>Full control.</summary>
    Full,
    /// <summary>
    /// The game reported a control level this build does not name. Not
    /// <see cref="None"/>: the craft may well have control, but its level has
    /// no tier here. <see cref="CommsConnectivity.HasLocalControl"/> is
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
/// <categoryDescription>
/// The link between a craft and the ground, as the comms backend in force reports
/// it: whether there is control, how strong and how degraded the signal is, the
/// routed network and its contact windows, the command centres and their delays,
/// and the commands still on their way. Read here for anything that shows signal or
/// delay, or says whether a command can get through.
/// </categoryDescription>
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
}

/// <summary>
/// The <c>comms.signal</c> payload: the active vessel's own reading of its
/// link, from the elected comms backend. A strength from 0 to 1 whose meaning
/// depends on the backend: stock CommNet reports a coarse fraction of the
/// link's range, RealAntennas how much headroom the link has over its data
/// rate. <see cref="Quantity"/> says which, so a reader names the figure
/// correctly and never compares two that are different quantities.
///
/// <para>Each command centre is sent its own, the newest reading to have
/// reached it. A reading is of the vessel's whole path at one instant, so
/// it reaches a centre no sooner than light leaving the farthest node on that
/// path at that instant could: it never tells a centre what a relay's link is
/// doing before the relay's own light has. Absent until the first reading
/// arrives. The path it was measured over is the game's, which is not always
/// the path the centre believes in on <c>comms.path</c>.</para>
///
/// <para>A save with the stock CommNet difficulty option off models no link
/// budget at all and reports 1 here: nothing weakens a link that is not
/// modelled. To tell that case from a real full-strength link, read
/// <see cref="CommsDelaySource.NoCommsModel"/> on <c>comms.delay</c>, which
/// marks it for every <c>comms.*</c> channel.</para>
/// <internal>
/// The accurate value in that case is an absence, and this field cannot carry
/// one: nullable would be a retype, which the contract shape gate refuses
/// without a Major bump. Of the two things a non-nullable double can say, 1 is
/// the one that does not mislead, because 0 is what the app's own
/// SignalLossIndicator keys its "Lost" verdict on.
/// <para>RealAntennas' value is a headroom fraction on its data-rate ladder
/// (<c>CommsLinkState.PathStrength</c>), so the two backends put different
/// curves behind one field, and <see cref="Quantity"/> is what says which curve a
/// value is on.</para>
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

    /// <summary>
    /// Which quantity <see cref="Strength"/> is: a fraction of the link's range,
    /// a fraction of its data-rate headroom, or a stand-in where no link is
    /// modelled. A strength worked out for a path carries the quantity its hops
    /// were stated in, and <see cref="SignalQuantity.Unknown"/> where they disagree.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public SignalQuantity Quantity { get; set; }

    /// <summary>
    /// Whether <see cref="Strength"/> is worked out and not measured. A
    /// command centre is sent the strength of the path it believes in. Where
    /// the active vessel's radio last reported on that very path, the reported
    /// strength is sent and this is false. Where it reported on another path,
    /// or has not reported, the strength is what the backend works out for the
    /// believed path from what the centre has heard, and this is true. Where
    /// nothing can be worked out either, see <see cref="OtherPath"/>.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool Modelled { get; set; }

    /// <summary>
    /// Whether <see cref="Strength"/> was measured on a path other than the
    /// one the receiving command centre believes in. The active vessel's radio
    /// reports the strength of whatever path the game has it on. Where that is
    /// not the centre's believed path and the comms backend can work nothing
    /// out for the believed one, the reported strength is still sent, with
    /// this set, so it is never read as the believed path's own. False
    /// whenever <see cref="Modelled"/> is true, and false for a centre that
    /// believes in no path yet, which is sent the reported strength as it is.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool OtherPath { get; set; }

    /// <summary>
    /// The path <see cref="Strength"/> was measured on, where that is not the
    /// path the receiving command centre believes in. Set whenever
    /// <see cref="OtherPath"/> is true and null otherwise, so a reader can
    /// name the route the figure belongs to beside the mark that says it is
    /// of another path. It is as old as the strength beside it, and names
    /// each vessel as the receiving centre last heard it named.
    /// <internal>
    /// Read off the same heard ContactRadio as the strength, never off the
    /// game or a newer reading, so it is delivered under that reading's
    /// whole-path delay and cannot name a route the centre has not heard of.
    /// </internal>
    /// </summary>
    public CommsMeasuredPath? MeasuredPath { get; set; }
}

/// <summary>
/// Which quantity a signal strength from 0 to 1 is. Two backends that both
/// report "0 to 1" are not saying the same thing, and a figure is only
/// comparable with another of the same quantity.
/// <internal>
/// Declared by the comms backend on every strength it states
/// (<c>CommsLinkState.Quantity</c> for a whole path, <c>ContactHopFacts.Quantity</c>
/// for one hop) and carried from there: the heard radio, <c>comms.signal</c>,
/// each hop of <c>comms.path</c> and <c>vessel.comms</c>.
/// </internal>
/// </summary>
/// <category>Comms</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum SignalQuantity
{
    /// <summary>Nothing says which: the hops of a worked-out path disagree, or a read failed.</summary>
    Unknown,

    /// <summary>How far inside its range the link is, 0 at the edge of range and 1 at no distance: stock CommNet's.</summary>
    RangeFraction,

    /// <summary>How much headroom the link has over its data rate, 0 where the lowest rate fails and 1 at the top of the ladder: RealAntennas'.</summary>
    DataRateHeadroom,

    /// <summary>A stand-in: the save models no comms network, so there is no link to grade and the figure is 1.</summary>
    NoModel,
}

/// <summary>
/// A path a vessel's radio reported a strength on, as the nodes it runs
/// through. It is the path the game had the vessel on when the radio was read,
/// which a command centre may not believe in.
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsMeasuredPath
{
    /// <summary>
    /// The vessel first, then the far end of each hop in order. A ground
    /// station is named by its own name, and a vessel as the receiving command
    /// centre last heard it named. One node, the vessel alone, means the radio
    /// reported a strength and named no route.
    /// </summary>
    public IReadOnlyList<CommsNetworkNode> Nodes { get; set; } = new List<CommsNetworkNode>();
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
    /// <summary>The craft cannot be commanded. A reading, unlike <see cref="Unknown"/>.</summary>
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
/// One ordered hop toward home in the active vessel's path. Per-hop RealAntennas
/// facts are not fields on this shared shape: the forward band rate rides the
/// RealAntennas Uplink's own <c>realantennas.hopRates</c> channel (a per-hop
/// annotation keyed by these same node ids, joined onto the route
/// client-side), and the other RealAntennas per-hop facts ride
/// <see cref="Extensions"/> under <c>"realantennas"</c>.
///
/// <para>A ground station carries its own name in <see cref="From"/> and
/// <see cref="To"/>, not a shared "home" label, and an install with
/// RealAntennas can have a dozen of them. Two consecutive samples that each
/// show a one-hop direct link, one to Kourou and one to Canberra, are a
/// handoff between stations, not one station whose range changed.</para>
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
    /// Straight-line distance the signal crosses on this hop, in metres. Null
    /// when the hop's geometry is not known, never 0.
    /// </summary>
    [SitrepUnit(Units.Metres)]
    public double? DistanceMeters { get; set; }

    /// <summary>
    /// What this hop's link is worth at the distance it crosses, from 0 to 1,
    /// in the comms backend's own terms (see <see cref="CommsSignal"/>). On
    /// <c>comms.path</c> it is worked out for the receiving command centre's
    /// own believed hop, from what that centre has heard of the two ends'
    /// antennas, so it is a model and not a measurement. Null when the
    /// backend states no strength for the hop, or the centre has not heard
    /// enough to work one out.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? Strength { get; set; }

    /// <summary>
    /// Which quantity <see cref="Strength"/> is, as the comms backend stated it
    /// for this hop. Null exactly when <see cref="Strength"/> is.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public SignalQuantity? Quantity { get; set; }

    /// <summary>
    /// The provider-namespaced extension bag: how the elected comms backend
    /// carries per-hop facts this shared shape does not declare (see
    /// <see cref="ProviderExtensionBagAttribute"/> for the whole mechanism).
    /// A RealAntennas install fills <c>Extensions["realantennas"]</c> with
    /// band, tech level, modulation, encoder, required Eb/N0, beamwidth, EC
    /// draw and the reverse-direction rate, typed by the RealAntennas client's
    /// own <c>RealAntennasHopExt</c>.
    ///
    /// <para>On <c>comms.path</c> a hop carries the facts the active vessel's
    /// radio last reported of that same hop, as the receiving command centre
    /// heard them, and a report reaches a centre no sooner than light from the
    /// farthest node on the path it was measured over. A hop the centre
    /// believes in and has heard no report of carries the facts the backend
    /// works out for it, from what the centre has heard of the two ends'
    /// antennas, or none where the backend states none.</para>
    /// </summary>
    // The key is omitted when no provider filled a bag, so a payload no provider
    // extended carries no trace of the mechanism.
    [SitrepOmittedWhenNull]
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// The <c>comms.path</c> payload: the active vessel's path as the receiving
/// command centre believes it to stand now. Ordered hops from the active
/// vessel to the receiving centre itself, or, for the home centre, to
/// whichever ground station the signal reaches first. An empty
/// <see cref="Hops"/> means the centre knows of no path that is open all the
/// way now, which includes a path that would have the signal wait at a relay
/// (<c>comms.route</c> says where it would wait).
///
/// <para>Each command centre is sent its own, and no other centre's. It is
/// worked out from that centre's contact plan, which is made of what the
/// centre has heard of each craft, so a hop changes here only once the news of
/// it has reached the centre: a relay that drops out is still on the path
/// until its silence has crossed to you. Nothing is sent until the centre has
/// a contact plan, so the topic is absent, not empty, for the first moments of
/// a session.</para>
///
/// <para>Not reckonable: a route changes in steps (a relay drops below the
/// horizon and the whole chain re-solves to different hops), and every
/// reckoning basis moves a continuous quantity.</para>
/// <internal>
/// Published by Sitrep.Host.Comms.ContactPlanSource through CentrePath, with
/// comms.network and comms.commandCentre, from the same route. The elected
/// backend's ICommsBackend.Path is not published: it is every hop's state at
/// this instant, so a centre shown it would learn of a far hop's change after
/// only its own light-time to the craft. It is read for the delivery delay.
/// </internal>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.path")]
public class CommsPath
{
    /// <summary>The hops in order, the first starting at the active vessel and the last ending at the receiving centre, or at a ground station for the home centre. Empty when the centre knows of no open path, never null.</summary>
    public IReadOnlyList<CommsHop> Hops { get; set; } = new List<CommsHop>();
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
    /// <summary>The node's human-facing name: the vessel's name as the receiving centre last heard it, or the ground station's. The node's <see cref="Id"/> when no name is known.</summary>
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
    /// True when the edge carries the vessel's path. Only the path's own edges
    /// are sent, so every edge is true.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool Active { get; set; }
}

/// <summary>
/// The <c>comms.network</c> payload: the nodes and edges of the active
/// vessel's path as the receiving command centre believes it to stand now,
/// which is <c>comms.path</c> in graph form with each node named. The graph
/// is empty when the centre knows of no open path.
///
/// <para>As with <c>comms.path</c>, each command centre is sent its own,
/// made from what that centre has heard.</para>
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
    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c> or <c>"game"</c>).</summary>
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
    /// Zero, because this save models no comms network at all: the stock
    /// CommNet difficulty option is off, so there are no ground stations, no
    /// relay graph and no path to measure a light-time over. Control reaches a
    /// craft directly, from anywhere, instantly.
    ///
    /// <para>Not the same as a null <see cref="CommsDelay.OneWaySeconds"/>,
    /// which means there is a comms model and it can measure nothing right now:
    /// a blackout. A save with no comms model reports this alongside
    /// <c>connected:true</c>, and its channels keep arriving with nothing held
    /// back; a blackout reports null and they stop.</para>
    /// </summary>
    NoCommsModel,
}

/// <summary>
/// The <c>comms.delay</c> payload: the one-way signal delay to the active
/// vessel, gated by the <c>comms.signalDelay.enabled</c> setting.
/// <see cref="OneWaySeconds"/> tells two different "no delay" cases apart by
/// value:
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
/// <para>Each command centre is sent its own, and no other centre's. It is
/// the light-time of the active vessel's path as the receiving centre believes
/// it to stand, which is the path that centre is sent on <c>comms.path</c>, so
/// the two always agree. The path is worked out from what the centre has heard
/// of each craft, so the figure moves only once the news that moves it has
/// reached the centre: a relay that drops out goes on counting towards the
/// delay until its silence has crossed to you. A zero that is a setting (delay
/// switched off, or a save with no comms network) is sent at once.</para>
/// <internal>
/// Published by Sitrep.Host.Comms.ContactPlanSource through CentreDelay.
/// Deliveries are not timed by this figure but by <c>INetwork.DelayTo</c>, fed
/// by <c>ChannelEngine.CaptureSignalDelay</c> from the game's own links on the
/// ungated capture path, because that decides when light that was really sent
/// really lands. It is the centre's believed path and not the backend's solved
/// one, so a far hop re-routing reaches a centre only after its own light has.
/// </internal>
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
    /// The one-way light-time to the command centre, in seconds. Null when
    /// nothing is measurable, 0 for a measured or applied zero; this type's
    /// summary says which case is which.
    ///
    /// <para><b>Reckoning.</b> Between samples the value is carried forward
    /// by re-measuring only the route's first hop, the one with the craft on
    /// one end: <c>(route - firstHop + |craft - peer|) / c</c>. The other hops
    /// join ground stations and relays that barely move against each other in
    /// that time, so their lengths are kept as measured. The craft is
    /// propagated on <c>@vessel.orbit</c>, and its peer is placed from
    /// <c>@commandCentre.roster</c>, whose body-fixed latitude and longitude
    /// need the rotation phase on <c>@system.bodies</c>.</para>
    ///
    /// <para>This covers a route whose first hop ends at a ground station,
    /// the direct link and the common case. A first hop that ends at a relay
    /// needs that relay's orbit, on <c>fleet.&lt;guid&gt;.orbit</c> under a
    /// guid only the route names, so it cannot be declared as an input. A
    /// client reckoning a relayed route gets a refusal that names that channel
    /// rather than a modelled number.</para>
    ///
    /// <para><see cref="Source"/> is an input because two of its members are a
    /// zero that does not mean "no distance": delay switched off, or a save
    /// with no comms network. Neither changes as the craft moves, so only
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
    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c> or <c>"game"</c>).</summary>
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The <c>comms.link</c> payload: the one statement a client should read for
/// "is there a control link home right now?". Read <c>comms.link.connected</c>
/// for that question rather than any raw <c>comms.*</c> observation such as
/// <see cref="CommsConnectivity"/>.
///
/// <para><b>Delayed, and never frozen.</b> This channel is what reports a
/// signal-loss freeze, so it keeps arriving through one. It reports a
/// disconnect one light-time after it happens and goes on reporting
/// <c>connected:false</c> through the blackout, so a "no signal" indicator
/// changes at the right delayed instant. The <see cref="VesselComms"/>
/// readings (signal strength, control state) are delayed too, but do freeze:
/// they hold their last value through the outage.</para>
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
    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c> or <c>"game"</c>).</summary>
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The <c>comms.commandCentre</c> payload: which command centre the active
/// vessel's path ends at, as the receiving command centre believes it to
/// stand now, so a client can show its own stats against the right name
/// instead of assuming KSC. It is where <c>comms.path</c>'s last hop ends: the
/// receiving centre itself, or, for the home centre, whichever ground station
/// the signal reaches first. Shares its id and kind scheme with
/// <see cref="CommandCentreEntry"/> (the <c>commandCentre.roster</c>
/// entries).
///
/// <para>As with <c>comms.path</c>, each command centre is sent its own,
/// made from what that centre has heard.</para>
///
/// <para>Every field is null when the centre knows of no open path.</para>
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
    /// <c>GroundStation</c> or <c>CrewedVessel</c>, as
    /// <see cref="CommandCentreEntry.Kind"/> spells them. Null when
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
/// <para>Unlike a <see cref="CommsHop"/> it carries no node ids, only the
/// backend's own node handles, which a caller resolves to a name only when it
/// needs one.</para>
///
/// <para><see cref="FromHandle"/> and <see cref="ToHandle"/> are opaque handles
/// of the same kind as <see cref="CommsNodeView.Handle"/>: a live object,
/// matched by reference and never dereferenced here. They are optional, for a
/// hop built outside a live backend, such as in a test.</para>
///
/// <para>Carries no KSP type.</para>
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

    /// <summary>True when either endpoint is a ground station.</summary>
    public bool TouchesHome { get; }

    /// <summary>The live object behind this hop's origin endpoint, or null when
    /// the caller had none to give.</summary>
    public object? FromHandle { get; }

    /// <summary>The live object behind this hop's destination endpoint, or null
    /// when the caller had none to give.</summary>
    public object? ToHandle { get; }
}

/// <summary>
/// A comms backend: what the <c>"comms"</c> capability resolves to, supplying
/// the readouts every comms mod can honestly give. Facts only one mod has, such
/// as a RealAntennas link margin, belong on that mod's own channels.
///
/// <para>Gonogo resolves the elected backend through
/// <see cref="Kernel.Query{T}"/> and publishes what each accessor returns to
/// its channel. Implementations read live game state, so every accessor is
/// called on the main thread, during capture. Inherit
/// <see cref="CommsBackendBase"/> to have most of them built for you.</para>
///
/// <para>Every accessor about a route takes the craft it is asked about as
/// <c>vessel</c>, never assuming the one on screen. <c>vessel</c> is an opaque
/// handle, in practice a KSP <c>Vessel</c>; a null or unrecognised handle is a
/// craft with no route.</para>
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
    /// How good the active vessel's link is right now. A backend that models no
    /// signal strength still returns a value rather than throwing, since a throw
    /// reads as a failed read.
    /// </summary>
    /// <returns>The <c>comms.signal</c> payload.</returns>
    CommsSignal Signal();

    /// <summary>
    /// What the active vessel can be commanded to do right now. This differs
    /// from <see cref="Connectivity"/>: a crewed vessel out of contact cannot be
    /// commanded remotely but is fully controllable by its crew.
    /// </summary>
    /// <returns>The <c>comms.control</c> payload.</returns>
    CommsControl ControlState();

    /// <summary>
    /// <paramref name="vessel"/>'s ordered hops home, which signal delay is
    /// computed over. Empty when it has no route.
    /// </summary>
    /// <param name="vessel">The craft to route from, as an opaque handle.</param>
    /// <returns>The <c>comms.path</c> payload.</returns>
    CommsPath Path(object? vessel);

    /// <summary>
    /// The network as this backend sees it from <paramref name="vessel"/>: the
    /// nodes and links a client draws. It changes as craft move and ground
    /// stations rotate, so it is read every capture, never cached.
    /// </summary>
    /// <param name="vessel">The craft to view the network from, as an opaque handle.</param>
    /// <returns>The <c>comms.network</c> payload.</returns>
    CommsNetwork Network(object? vessel);

    /// <summary>
    /// The route this backend's own router finds between two nodes, as ordered
    /// hops, or null when it will not route between them.
    ///
    /// <para><paramref name="from"/> and <paramref name="to"/> are opaque node
    /// handles, in practice a KSP <c>CommNet.CommNode</c>. Returns null for an
    /// unrecognised or missing handle, for the same node at both ends, and for
    /// an unreachable end. An empty list means routed with nothing to
    /// measure. Main thread only.</para>
    /// <internal>
    /// On the interface because routing is the elected backend's rule, not a
    /// stock method core can call for it: RealAntennas overrides
    /// <c>CommNetwork.FindClosestWhere</c> and leaves <c>FindPath</c> alone, so
    /// stock <c>FindPath</c> quotes light-times over routes RealAntennas will not
    /// carry. Same-node is null because a route that does not exist has no
    /// light-time, and a zero would claim one.
    /// </internal>
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
    /// <para>It tells a reroute from a break, which <see cref="Path"/> alone
    /// cannot. A relay that leaves the route because a cheaper one appeared is
    /// still forwarding, so telemetry already crossing it arrives. A relay that
    /// was destroyed, or that a body moved in front of, is a break, and that
    /// telemetry is lost.</para>
    ///
    /// <para>Return <c>null</c> rather than guess. Gonogo treats null as no
    /// break and delivers, since a wrongly declared break deletes telemetry that
    /// did arrive. Main thread only.</para>
    /// </summary>
    /// <param name="vessel">The craft whose route is in question, as an opaque handle.</param>
    /// <param name="nodeId">The node id, as <see cref="CommsHop.From"/> and <see cref="CommsHop.To"/> carry it.</param>
    /// <returns>True when the signal still reaches the node, false when it does not, null when the backend cannot say.</returns>
    bool? StillCarriesTo(object? vessel, string nodeId);

    /// <summary>
    /// The reach rule this backend applies between two nodes: how far apart
    /// they can be and still carry a link. See <see cref="ICommsReachModel"/>.
    ///
    /// <para><paramref name="from"/> and <paramref name="to"/> are opaque node
    /// handles, as for <see cref="RouteBetween"/>. Never null: for a pair it
    /// cannot rate, or a handle it does not recognise, return
    /// <see cref="CommsReachModels.Unknown"/>, which asserts no limit.</para>
    ///
    /// <para>Called on the main thread, since building the rule may read the
    /// game. The model it returns is pure arithmetic and safe on any
    /// thread.</para>
    /// <internal>
    /// Without a declared reach a contact prediction models geometry alone and
    /// promises reacquisition on line of sight, which an operator plans against.
    /// </internal>
    /// </summary>
    /// <param name="from">One node, as an opaque handle.</param>
    /// <param name="to">The other node, as an opaque handle.</param>
    /// <returns>The reach rule for the pair, never null.</returns>
    ICommsReachModel ReachModel(object? from, object? to);

    /// <summary>
    /// How degraded this backend grades the active vessel's link home right now.
    /// See <see cref="ICommsDegradeModel"/> for the scale.
    ///
    /// <para>Never null: a backend with no opinion returns
    /// <see cref="CommsDegradeModels.Unknown"/>, whose rating is absent, rather
    /// than inventing one.</para>
    ///
    /// <para>Called on the main thread, since building the rating may read the
    /// game. The model it returns is safe on any thread.</para>
    /// <internal>
    /// A quality derived as <c>1 - comms.signal.strength</c> is a different
    /// curve per install: that field is a range fraction under stock and a
    /// rate-ladder headroom fraction under RealAntennas.
    /// </internal>
    /// </summary>
    /// <returns>The degrade rating for the active vessel's link, never null.</returns>
    ICommsDegradeModel DegradeModel();

    /// <summary>
    /// The node <paramref name="vessel"/>'s control path, as this backend solved
    /// it, terminates at, as an opaque handle, or null when it terminates
    /// nowhere (no connection, or a last hop that touches neither a ground
    /// station nor a crewed control source).
    ///
    /// <para>Return the node's handle, not a <see cref="CommsCommandCentre"/>:
    /// Gonogo matches it against its command centres and builds the payload.</para>
    ///
    /// <para>Main thread only. The handle is a live KSP object and must not cross
    /// a thread or outlive the capture that produced it.</para>
    /// </summary>
    /// <param name="vessel">The craft whose control path is read, as an opaque handle.</param>
    /// <returns>The terminal node's handle, or null.</returns>
    object? ControlPathTerminus(object? vessel);

    /// <summary>
    /// The occlusion geometry this backend applies: which radius of a body
    /// blocks a radio path through it. See <see cref="ICommsOcclusionModel"/>.
    /// Stock CommNet shrinks the body by its occlusion multipliers and
    /// RealAntennas does not, a difference worth minutes of predicted blackout.
    ///
    /// <para>Returns a rule, not a reading. Called on the main thread during
    /// capture, since building the rule may read a difficulty setting; the model
    /// it returns is pure arithmetic and safe on any thread.</para>
    /// </summary>
    /// <returns>The occlusion rule, never null.</returns>
    ICommsOcclusionModel OcclusionModel();
}
