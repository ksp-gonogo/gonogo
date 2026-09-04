#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

// ====================================================================
// The comms.* wire contract (U2: comms trio).
//
// Two axes govern every channel here (comms-uplink-design.md §1): a
// PROVIDER axis (the elected backend: CommNet vanilla, or RealAntennas
// when present: sources the shared channels; RealAntennas alone sources
// its private link-budget channels) and a PRESENCE axis (always-present
// vs provider-dependent). All comms.* channels are TRUE-NOW: they describe
// the link AS KSC SEES IT, computed ground-side. comms.delay in particular
// is true-now sim-meta, the value that DRIVES the delay of every other
// channel, so it is itself never delay-gated (delaying it would be
// circular: §1 "delay classification").
//
// R7 discipline: every payload carries PayloadMeta; absence is a nullable
// (T?), never a NaN/0/-1 sentinel.
// ====================================================================

/// <summary>
/// Degree of vessel control the link currently affords, the
/// <c>controlSource</c> axis of <see cref="CommsConnectivity"/>. Mirrors
/// stock <c>CommNet.VesselControlState</c>'s partial/full distinction
/// without leaking a KSP enum onto the wire.
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum CommsControlSource
{
    None,
    Partial,
    Full,
}

/// <summary>
/// The <c>comms.connectivity</c> payload: always-present, sourced from the
/// elected backend. Ground-side truth about
/// whether the active vessel has a control link home right now.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.connectivity")]
public class CommsConnectivity
{
    [SitrepUnit(Units.Flag)]
    public bool Connected { get; set; }
    [SitrepUnit(Units.Enumeration)]
    public CommsControlSource ControlSource { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool HasLocalControl { get; set; }
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The <c>comms.signalStrength</c> payload: always-present, elected
/// backend. 0..1. CommNet gives a coarse range-fraction; RealAntennas gives
/// a link-budget-derived value.
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
/// </internal>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.signalStrength")]
public class CommsSignalStrength
{
    [SitrepUnit(Units.Ratio)]
    public double Value { get; set; }
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>Control-state kind for <see cref="CommsControlState"/>.</summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum CommsControlStateKind
{
    None,
    PartialManoeuvre,
    Full,
}

/// <summary>
/// The <c>comms.controlState</c> payload: always-present, elected backend.
/// <see cref="Reason"/> is a nullable annotation (absent = no annotation),
/// never an empty-string sentinel.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.controlState")]
public class CommsControlState
{
    [SitrepUnit(Units.Enumeration)]
    public CommsControlStateKind State { get; set; }
    [SitrepUnit(Units.Text)]
    public string? Reason { get; set; }
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>Kind of a node participating in a <see cref="CommsHop"/>.</summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum CommsHopKind
{
    Home,
    Relay,
    Vessel,
}

/// <summary>
/// One ordered hop toward KSC in the control path. <see cref="DistanceMeters"/>
/// is the geometry SignalDelay consumes for light-time; it is nullable,
/// absent when the backend cannot supply per-hop geometry (typed absence,
/// never 0). Per-hop RealAntennas rate is NOT a field on this shared shape: the
/// forward band rate rides the RA uplink's own <c>realantennas.hopRates</c>
/// channel (a thin per-hop annotation keyed by these same node ids, joined onto
/// the route client-side by a <c>comm-signal.hop-rates</c> contribution), and
/// the other RA per-hop facts ride <see cref="Extensions"/> under
/// <c>"realantennas"</c>. The core hop stays RA-agnostic.
///
/// <para><see cref="From"/>/<see cref="To"/> name the endpoints. Ground
/// stations carry their OWN name (RSS/RealAntennas fly a dozen of them), not a
/// single shared "home" label: two consecutive samples both showing a one-hop
/// direct link, one to Kourou and one to Canberra, are a STATION HANDOFF, and
/// under a shared label they were indistinguishable from one station whose
/// range simply changed. That ambiguity is what made a relay handoff readable
/// as an occlusion blackout.</para>
///
/// <para><see cref="FromIsHome"/>/<see cref="ToIsHome"/> carry that home-ness
/// per endpoint, so it survives without parsing a name. <see cref="Kind"/>
/// cannot serve: it is one value for the whole hop, so it says a ground
/// station is involved but never which end.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsHop
{
    [SitrepUnit(Units.Id)]
    public string From { get; set; } = "";
    [SitrepUnit(Units.Id)]
    public string To { get; set; } = "";
    [SitrepUnit(Units.Flag)]
    public bool FromIsHome { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool ToIsHome { get; set; }
    [SitrepUnit(Units.Enumeration)]
    public CommsHopKind Kind { get; set; }
    [SitrepUnit(Units.Metres)]
    public double? DistanceMeters { get; set; }

    /// <summary>
    /// The provider-namespaced extension bag: how the elected comms backend
    /// carries per-hop facts this shared shape does not declare, WITHOUT a PR
    /// against core (see <see cref="ProviderExtensionBagAttribute"/> for the
    /// whole mechanism). Null under the vanilla CommNet backend, which has
    /// nothing stock does not already say; a RealAntennas install fills
    /// <c>Extensions["realantennas"]</c> with band, tech level, modulation,
    /// encoder, required Eb/N0, beamwidth, EC draw and the reverse-direction
    /// rate, typed by the RA client's own <c>RealAntennasHopExt</c>. It rides
    /// <c>comms.path</c>, so it inherits that channel's TrueNow classification.
    /// </summary>
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// The <c>comms.path</c> payload: always-present, elected backend. Ordered
/// hops from the active vessel to KSC. Empty <see cref="Hops"/> = no path
/// home (a real, control-loss state, not absence-of-data).
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.path")]
public class CommsPath
{
    public IReadOnlyList<CommsHop> Hops { get; set; } = new List<CommsHop>();
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// One node in the <see cref="CommsNetwork"/> relay graph. <see cref="Id"/> is
/// a UNIQUE, stable join key in the same id space
/// <see cref="CommsHop.From"/>/<see cref="CommsHop.To"/> use: a vessel's
/// persistent id for a craft, the station's own name for a ground station.
/// Never a vessel's display name, which two craft can share, which made it
/// unsafe as a graph or roster key. <see cref="DisplayName"/> carries the
/// label, and <see cref="Kind"/> carries home-ness, so nothing has to read
/// meaning out of the id.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsNetworkNode
{
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";
    [SitrepUnit(Units.Text)]
    public string DisplayName { get; set; } = "";
    [SitrepUnit(Units.Enumeration)]
    public CommsHopKind Kind { get; set; }
}

/// <summary>One edge in the <see cref="CommsNetwork"/> relay graph.</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsNetworkEdge
{
    [SitrepUnit(Units.Id)]
    public string A { get; set; } = "";
    [SitrepUnit(Units.Id)]
    public string B { get; set; } = "";
    [SitrepUnit(Units.Flag)]
    public bool Active { get; set; }
}

/// <summary>
/// The <c>comms.network</c> payload: always-emitted, but its richness
/// tracks the elected backend (a "backend-dependent
/// detail"). Under bare CommNet this may be a single home-edge; under
/// RealAntennas it enumerates the relay graph.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.network")]
public class CommsNetwork
{
    public IReadOnlyList<CommsNetworkNode> Nodes { get; set; } = new List<CommsNetworkNode>();
    public IReadOnlyList<CommsNetworkEdge> Edges { get; set; } = new List<CommsNetworkEdge>();
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>Where a <see cref="CommsDelay"/> value came from.</summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum CommsDelaySource
{
    None,
    SignalDelay,

    /// <summary>
    /// Zero, because the flight on screen is a SIMULATION and the operator has
    /// not asked for delay during one. A rehearsal has no spacecraft, so it has
    /// no light-time, and modelling a distance to a craft that is not there is
    /// a fiction rather than a measurement.
    ///
    /// <para>Its own member rather than <see cref="None"/> because a live board
    /// is a claim, and an operator is entitled to know which claim it is: "no
    /// delay is configured" and "delay is off because this is a rehearsal" call
    /// for different reactions. See <c>flight.simulation</c>.</para>
    /// </summary>
    Simulation,

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
    /// the two ON THE WIRE, and <c>comms.delay</c> is true-now, so it says so
    /// even while a blackout would be freezing everything else.</para>
    /// </summary>
    NoCommsModel,
}

/// <summary>
/// The <c>comms.delay</c> payload: the CORE SignalDelay capability's output,
/// gated by the <c>comms.signalDelay.enabled</c>
/// config flag. <see cref="OneWaySeconds"/> distinguishes two DIFFERENT
/// "no delay" cases by value (R7: typed absence, never a single overloaded
/// sentinel):
/// <list type="bullet">
/// <item><description><b>null</b>: no measurable <see cref="CommsPath"/>
/// (no path home, or incomplete hop geometry). There is nothing to measure,
/// so nothing is reported. <see cref="Source"/> is
/// <see cref="CommsDelaySource.None"/>.</description></item>
/// <item><description><b>0</b>: the delay feature is disabled
/// (<c>comms.signalDelay.enabled = false</c>) but the vessel IS connected. A
/// genuine "zero delay applied", not an absence. <see cref="Source"/> is
/// also <see cref="CommsDelaySource.None"/> here: the two cases share the
/// same <c>Source</c> and are told apart only by whether the value is
/// null.</description></item>
/// <item><description>a real number: <see cref="Source"/> is
/// <see cref="CommsDelaySource.SignalDelay"/>; gonogo's own light-time math
/// over the elected backend's hop geometry.</description></item>
/// </list>
/// Two of the zeroes name their own reason instead of sharing
/// <see cref="CommsDelaySource.None"/>:
/// <see cref="CommsDelaySource.Simulation"/> and
/// <see cref="CommsDelaySource.NoCommsModel"/>. The second is what tells a
/// client that a board showing no path and no relay graph is a save with the
/// CommNet difficulty option off, not a craft in a permanent blackout: the
/// blackout reports <c>null</c> here and <c>connected:false</c> on
/// <see cref="CommsLink"/>, and this reports <c>0</c> and
/// <c>connected:true</c>.
/// TRUE-NOW sim-meta: this value drives the release of every other delayed
/// channel and is therefore never itself delay-gated.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.delay")]
public class CommsDelay
{
    [SitrepUnit(Units.Seconds)]
    public double? OneWaySeconds { get; set; }
    [SitrepUnit(Units.Enumeration)]
    public CommsDelaySource Source { get; set; }
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The <c>comms.link</c> connectivity MetaTopic: the ONE client-facing
/// answer to "is there a control link home right now?", carried as a
/// <b>Delayed, freeze-EXEMPT</b> channel (see
/// <c>ChannelEngine.ConnectivityMetaTopic</c>). It is the delayed successor to
/// the de-publicised TrueNow <see cref="CommsConnectivity"/> observation
/// channel: clients (the app's SignalLossIndicator/CameraFeed, the kOS
/// terminal's line-mode gate) read <c>comms.link.connected</c> instead of any
/// raw <c>comms.*</c> observation.
///
/// <para><b>Why its own topic, freeze-exempt:</b> the link state is what
/// REPORTS the freeze, so: exactly parallel to <c>comms.delay</c> being exempt
/// from its own delay: it must be exempt from the freeze it drives. It reveals
/// the disconnect edge at <c>T+delay</c> (you learn of the outage one light-time
/// after it happens) and keeps reporting <c>connected:false</c> through the
/// blackout, so the client's "NO SIGNAL" flips at the correct delayed instant.
/// The <see cref="VesselComms"/> observation struct (signalStrength/controlState)
/// stays Delayed AND freeze-gated: it freezes at last-known through the
/// outage.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.link")]
public class CommsLink
{
    [SitrepUnit(Units.Flag)]
    public bool Connected { get; set; }
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The <c>comms.commandCentre</c> payload:
/// identifies WHICH command centre the active vessel's control path currently
/// terminates at, vanilla KSC or a crewed control-source vessel (the stock
/// "6-kerbal command center" mechanic), so a client can show its own stats
/// against the right name instead of assuming KSC. Shares its id/kind scheme
/// with <see cref="CommandCentreEntry"/> (the <c>commandCentre.roster</c>
/// union): it names ONE entry from that same set, whichever one the vessel's
/// own <c>ControlPath</c> resolved to this tick. Every field is null when
/// there is no live remote centre right now (no connection, or the terminal
/// node matches neither a ground station nor a crewed control source), the
/// existing comms.link/comms.connectivity "No signal" case already covers
/// that for a reader.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.commandCentre")]
public class CommsCommandCentre
{
    /// <summary>Stable authority/vantage key, same scheme as <see cref="CommandCentreEntry.Id"/>: "ksc" | "ground:&lt;name&gt;" | "kk:&lt;site&gt;" | "vessel:&lt;guid&gt;". Null when no remote centre resolved.</summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }
    /// <summary>Human-facing name.</summary>
    [SitrepUnit(Units.Text)]
    public string? DisplayName { get; set; }
    /// <summary>One of <c>GroundStation</c> / <c>CrewedVessel</c> / <c>Colony</c> / <c>Custom</c> (the <c>CommandCentreKind</c> name), same as <see cref="CommandCentreEntry.Kind"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string? Kind { get; set; }
    /// <summary>Index into system.bodies of the body this centre sits on; null when unknown, not surface-anchored, or the centre is a moving vessel.</summary>
    [SitrepUnit(Units.Id)]
    public int? BodyIndex { get; set; }
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
 * The tempting counter-argument, that a nullable field on a shared type is not
 * the same as a private type, does not hold. A provider-only number sitting on
 * CommsHop is still a core change a future out-of-tree comms provider cannot
 * land, and it reads as jank. A per-provider fact rides either that provider's
 * own channel, keyed by these same node ids and joined onto the route
 * client-side, or CommsHop.Extensions under the provider's namespace.
 * Provider-only presence is not provider-only ownership.
 */

/// <summary>
/// One hop of a route a backend has solved, geometry only: the distance
/// between its two endpoints and whether either end is a ground station.
///
/// <para>Deliberately NOT a <see cref="CommsHop"/>. That shape is a wire
/// payload and carries node ids, and resolving one costs a walk over every
/// vessel in the game per node, which the centre-to-centre matrix (centres
/// squared, every tick) cannot pay for an answer nobody reads. What a routed
/// light-time consumes is the geometry and nothing else, so that is all this
/// carries.</para>
///
/// <para>Carries no KSP type, so the light-time arithmetic built on it
/// compiles and is exercised with no KSP reference assemblies at all.</para>
/// </summary>
public readonly struct CommsRouteHop
{
    public CommsRouteHop(double distanceMeters, bool touchesHome)
    {
        DistanceMeters = distanceMeters;
        TouchesHome = touchesHome;
    }

    /// <summary>Straight-line distance between the hop's two endpoints.</summary>
    public double DistanceMeters { get; }

    /// <summary>True when EITHER endpoint is a ground station.</summary>
    public bool TouchesHome { get; }
}

/// <summary>
/// The pure, KSP-free object the exclusive <c>"comms"</c> capability resolves
/// to. Exactly the readouts BOTH backends can
/// honestly supply: the minimal shape the parallel CommNet+RA build forces
/// (§6). RealAntennas-only richness (link margin, data rate) is deliberately
/// OUT of this interface and lives on RA's private channels instead.
///
/// <para>Each accessor returns a wire payload the shared core comms
/// registration publishes to its channel after resolving the elected backend
/// via <c>host.Kernel.Query&lt;ICommsBackend&gt;("comms")</c>. Implementations
/// read live KSP/mod state and MUST be called only where such reads are safe
/// (the capture-on-main seam): the interface itself is pure.</para>
/// </summary>
public interface ICommsBackend : ISitrepProvider
{
    CommsConnectivity Connectivity();
    CommsSignalStrength SignalStrength();
    CommsControlState ControlState();

    /// <summary>Ordered hops to KSC: the geometry SignalDelay reads for light-time (§3).</summary>
    CommsPath Path();

    CommsNetwork Network();

    /// <summary>
    /// The route THIS backend's own router finds between two nodes, as ordered
    /// hop geometry, or null when it will not route between them.
    ///
    /// <para>It is on the interface for the same reason
    /// <see cref="OcclusionModel"/> is: routing is a rule the elected backend
    /// owns, not a stock method core can call on its behalf. Core used to call
    /// <c>CommNetwork.FindPath</c> directly for the command-centre delay matrix
    /// and quoted light-times over routes RealAntennas refuses to carry, because
    /// RA overrides <c>FindClosestWhere</c> and leaves <c>FindPath</c> alone
    /// (see <c>FleetCommsReader.ReadNodePath</c> for the whole trap).</para>
    ///
    /// <para><paramref name="from"/> and <paramref name="to"/> are OPAQUE node
    /// handles on the same terms as <see cref="IActiveVessel.Reported"/>: both
    /// shipped backends read them as a KSP <c>CommNet.CommNode</c>, and a
    /// backend handed something it does not recognise answers null rather than
    /// guessing. Null is also the answer for a missing handle, the same node at
    /// both ends (a path to yourself is not a route), and an unreachable end: a
    /// caller that wants "no delay because it is the same place" says so itself,
    /// because a route that does not exist has no light-time and a zero would
    /// claim one.</para>
    ///
    /// <para>An EMPTY list is a different answer again: routed, with nothing to
    /// measure. Live read, so main thread only, on the same capture-on-main seam
    /// as every accessor above.</para>
    /// </summary>
    IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to);

    /// <summary>
    /// The reach rule this backend applies between two nodes: how far apart
    /// they can be and still carry a link (see <see cref="ICommsReachModel"/>
    /// for the whole rule, and <c>CommsReach.cs</c>'s header for why core
    /// cannot answer it for anybody).
    ///
    /// <para>It is on the interface for the same reason
    /// <see cref="OcclusionModel"/> and <see cref="RouteBetween"/> are, and the
    /// consequence of its absence was the worst of the three: nothing declared
    /// reach, so <c>Sitrep.Propagation.Visibility</c> modelled the geometry and
    /// nothing else, and every contact prediction promised reacquisition on
    /// line of sight alone. That is a PREDICTION an operator plans against
    /// rather than a readout they can check against the game, which is what
    /// makes it worse than a wrong number on screen.</para>
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
    /// Live read to BUILD the rule, so main thread only, on the same
    /// capture-on-main seam as every accessor above; the model it returns is
    /// thereafter pure arithmetic and safe anywhere, including a sweep
    /// evaluating it at thousands of future instants off-thread.</para>
    /// </summary>
    ICommsReachModel ReachModel(object? from, object? to);

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
    /// difficulty setting), so it is called on the same capture-on-main seam;
    /// the model it returns is thereafter pure arithmetic and safe anywhere.</para>
    /// </summary>
    ICommsOcclusionModel OcclusionModel();
}
