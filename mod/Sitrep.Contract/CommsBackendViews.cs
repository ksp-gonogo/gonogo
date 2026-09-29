using System.Collections.Generic;

namespace Sitrep.Contract;

/*
 * The KSP-free vocabulary a comms backend hands CommsBackendBase what only it
 * can read in, so everything derivable from it is derived once. None of these
 * is a wire payload or carries [SitrepContract].
 *
 * Every one is a view rather than a KSP object: Sitrep.Contract compiles with
 * no KSP reference assemblies and must keep doing so, because it is the one
 * project an out-of-tree Uplink may reference, and a CommNet type on any
 * signature here would put KSP in the published surface and make the shared
 * logic unreachable from a headless test.
 */

/// <summary>
/// Degree of vessel control a link affords, in the four states KSP's
/// <c>Vessel.ControlLevel</c> distinguishes, which a comms backend reports in
/// <see cref="CommsLinkState.Grade"/>.
///
/// <para>Four rather than the three of <see cref="CommsControlSource"/>,
/// because <see cref="CommsConnectivity.HasLocalControl"/> turns on crewed
/// versus uncrewed: a crewed pod can be flown with no link home, an uncrewed
/// one cannot. <see cref="CommsBackendBase"/> derives
/// <see cref="CommsControlSource"/>, the <c>comms.control</c> state and
/// <see cref="CommsConnectivity.HasLocalControl"/> all from this one value, so
/// they cannot disagree.</para>
/// </summary>
/// <category>Uplink API</category>
public enum CommsControlGrade
{
    /// <summary>A measurement: the craft has no control source.</summary>
    None,

    /// <summary>Partial control of an uncrewed craft: KSP's <c>PARTIAL_UNMANNED</c>.</summary>
    PartialUnmanned,

    /// <summary>Partial control of a crewed craft: KSP's <c>PARTIAL_MANNED</c>. Counts as local control.</summary>
    PartialManned,

    /// <summary>Full control: KSP's <c>FULL</c>. Counts as local control.</summary>
    Full,

    /// <summary>
    /// The game reported a control level the backend does not name. Not
    /// <see cref="None"/>: nothing was measured to be absent, so every derived
    /// field reads it as unknown rather than as an uncontrolled craft.
    /// </summary>
    Unknown,
}

/// <summary>
/// One endpoint of a link, as a comms backend reports it: an opaque handle
/// back to the live object, the id that goes on the wire, and a position.
///
/// <para><see cref="Handle"/> is the live object the backend read this from, on
/// the same opaque terms as <see cref="ICommsBackend.RouteBetween"/> and
/// <see cref="IActiveVessel.Reported"/>. Gonogo uses it only to match a node
/// against its own registries by reference (which is how
/// <c>comms.commandCentre</c> names a centre). It is a live handle: it must not
/// cross a thread boundary or outlive the capture that produced it.</para>
///
/// <para><see cref="Id"/> is a unique, stable join key, and the backend derives
/// it because doing so needs the game (a vessel node's owning craft is not
/// reachable from the node). It is the only thing the shared shapes key on, so
/// a per-hop annotation on a provider's own channel joins onto the published
/// route. See <see cref="CommsHop"/> and <see cref="CommsNetworkNode"/> for why
/// a display name could not serve.</para>
/// </summary>
/// <category>Uplink API</category>
public readonly struct CommsNodeView
{
    /// <summary>A node view.</summary>
    /// <param name="handle">The live node object, for reference matching only; may be null.</param>
    /// <param name="id">The unique, stable join key. Null reads as empty.</param>
    /// <param name="displayName">The human label. Null reads as empty.</param>
    /// <param name="isHome">Whether the node is a ground station.</param>
    /// <param name="isControlSource">Whether the node is a crewed control source.</param>
    /// <param name="position">Position, in the same frame as every other node the backend reports this capture.</param>
    public CommsNodeView(
        object? handle,
        string id,
        string displayName,
        bool isHome,
        bool isControlSource,
        Vector3d position)
    {
        Handle = handle;
        Id = id ?? "";
        DisplayName = displayName ?? "";
        IsHome = isHome;
        IsControlSource = isControlSource;
        Position = position;
    }

    /// <summary>The live object, for reference-matching only. Never dereferenced by shared code.</summary>
    public object? Handle { get; }

    /// <summary>The join key that reaches the wire as <see cref="CommsHop.From"/> / <see cref="CommsNetworkNode.Id"/>.</summary>
    public string Id { get; }

    /// <summary>The human label, independent of the id.</summary>
    public string DisplayName { get; }

    /// <summary>A ground station.</summary>
    public bool IsHome { get; }

    /// <summary>A crewed control source, stock's "command center" mechanic.</summary>
    public bool IsControlSource { get; }

    /// <summary>
    /// Position, in metres, in whatever one frame the backend reads both
    /// endpoints in. Only differences between positions are ever taken, so the
    /// frame's origin and orientation are the backend's choice; what it must not
    /// do is mix frames between the two ends of a link.
    /// </summary>
    public Vector3d Position { get; }
}

/// <summary>
/// One link of a path the backend has solved, as its two endpoint views.
///
/// <para>Ordered: <see cref="A"/> is the near end and <see cref="B"/> the far
/// one, in the direction the path runs. That order is kept onto
/// <see cref="CommsHop.From"/> and <see cref="CommsHop.To"/>, which is what
/// makes a station handoff readable.</para>
/// </summary>
/// <category>Uplink API</category>
public readonly struct CommsLinkView
{
    /// <summary>A link view.</summary>
    /// <param name="a">The near end, in the direction the path runs.</param>
    /// <param name="b">The far end.</param>
    /// <param name="handle">The live link object, or null when the backend has no link-level fact to come back for.</param>
    public CommsLinkView(CommsNodeView a, CommsNodeView b, object? handle = null)
    {
        A = a;
        B = b;
        Handle = handle;
    }

    /// <summary>The near end of the link, in the direction the path runs; published as <see cref="CommsHop.From"/>.</summary>
    public CommsNodeView A { get; }

    /// <summary>The far end of the link; published as <see cref="CommsHop.To"/>.</summary>
    public CommsNodeView B { get; }

    /// <summary>
    /// The live link object, on the same opaque terms as
    /// <see cref="CommsNodeView.Handle"/>, or null when the backend has no
    /// link-level fact to come back for.
    ///
    /// <para>A link-level fact has no home on either node: RealAntennas'
    /// per-hop extras are properties of the link (the band and modulation it
    /// negotiated, the rate each way), so
    /// <see cref="CommsBackendBase.HopExtensions"/> is handed the link view and
    /// reaches the live link through this.</para>
    ///
    /// <para>The same rules as a node handle: never dereferenced by shared
    /// code, never crosses a thread, never outlives the capture.</para>
    /// <internal>
    /// The alternative, matching a view back to its link by position in the
    /// list, is an identity comparison on a struct and breaks the moment a link
    /// is skipped.
    /// </internal>
    /// </summary>
    public object? Handle { get; }
}

/// <summary>
/// The craft a comms backend is reporting for, and how well it can see it: the
/// two facts every <see cref="PayloadMeta"/> in the comms family is built from.
/// A subject with a craft becomes a source of <c>"vessel:&lt;guid&gt;"</c>, and
/// one without becomes <c>"game"</c>; <see cref="Loaded"/> becomes a quality of
/// <c>Loaded</c> or <c>OnRails</c>.
/// <internal>
/// Derived once in CommsBackendBase so two backends cannot drift on the meta
/// vocabulary a client branches on.
/// </internal>
/// </summary>
/// <category>Uplink API</category>
public readonly struct CommsSubject
{
    /// <summary>No craft to report for: not in flight, or the backend could not resolve one.</summary>
    public static readonly CommsSubject None = default;

    /// <summary>A subject.</summary>
    /// <param name="vesselId">The craft's persistent id, or null when there is no craft.</param>
    /// <param name="loaded">Whether the craft is loaded in the scene rather than on rails.</param>
    public CommsSubject(string? vesselId, bool loaded)
    {
        VesselId = vesselId;
        Loaded = loaded;
    }

    /// <summary>The craft's persistent id, or null when there is no craft.</summary>
    public string? VesselId { get; }

    /// <summary>Whether the craft is loaded in the scene, as opposed to on rails.</summary>
    public bool Loaded { get; }
}

/// <summary>
/// What a backend read off a live link: the three readings the
/// <c>comms.connectivity</c>, <c>comms.signal</c> and <c>comms.control</c>
/// payloads are derived from, and nothing else.
///
/// <para>One struct rather than three accessors because those channels describe
/// one tick of one link. Read separately, a scene change between reads could
/// publish a connected flag beside a control level from the previous
/// craft.</para>
/// </summary>
/// <category>Uplink API</category>
public readonly struct CommsLinkState
{
    /// <summary>A link state.</summary>
    /// <param name="connected">Whether the backend resolved a control path home.</param>
    /// <param name="grade">The control the link affords.</param>
    /// <param name="signalStrength">The backend's own signal strength, 0 to 1.</param>
    public CommsLinkState(bool connected, CommsControlGrade grade, double signalStrength)
    {
        Connected = connected;
        Grade = grade;
        SignalStrength = signalStrength;
    }

    /// <summary>Whether the backend's own gates resolved a control path home.</summary>
    public bool Connected { get; }

    /// <summary>Control the link affords, in the four-state grade; <see cref="CommsControlSource"/> is derived from it.</summary>
    public CommsControlGrade Grade { get; }

    /// <summary>
    /// The backend's own signal strength, 0 to 1, published unchanged on
    /// <see cref="CommsSignal"/>. Its meaning depends on the backend: under
    /// stock CommNet it is a range fraction, under RealAntennas a fraction of
    /// data-rate headroom.
    /// <internal>
    /// Two meanings behind one field is a defect of CommsSignal, not of this
    /// struct. Fixing it means one normalised quantity or two honest fields,
    /// either a wire change with client work behind it.
    /// </internal>
    /// </summary>
    public double SignalStrength { get; }
}

/// <summary>
/// One observed break in a subject's route home: whose route it was, when it
/// happened, and how far out along the route it sat.
///
/// <para>Returned from the source registered with
/// <see cref="IUplinkHost.SetPathBreakSource"/>, on the main thread, by
/// whoever can see the hop geometry. A break never reaches the wire; a client
/// sees only the silence it produces.</para>
/// <internal>
/// Carried to the engine as two plain doubles and spent on INetwork.DropPath.
/// </internal>
/// </summary>
/// <category>Uplink API</category>
public readonly struct PathBreak
{
    /// <summary>A path break.</summary>
    /// <param name="node">Whose route broke: see <see cref="Node"/>. Null reads as empty.</param>
    /// <param name="atUt">The universal time the break was observed, in seconds.</param>
    /// <param name="lightSecondsOut">How far out from the subject the break sat, in light-seconds along the route.</param>
    public PathBreak(string node, double atUt, double lightSecondsOut)
    {
        Node = node ?? "";
        AtUt = atUt;
        LightSecondsOut = lightSecondsOut;
    }

    /// <summary>
    /// Whose route broke: the active craft's node or a
    /// <c>fleet.&lt;vesselId&gt;</c> one. Only samples sent from that subject
    /// are lost to the break.
    /// </summary>
    public string Node { get; }

    /// <summary>The universal time the break was observed, in seconds.</summary>
    public double AtUt { get; }

    /// <summary>
    /// How far out from the subject the break sat, in light-seconds along the
    /// route it was using. This decides whether a sample arrives rather than
    /// when: signal already past this point is on the far leg and arrives
    /// normally.
    /// </summary>
    public double LightSecondsOut { get; }
}
