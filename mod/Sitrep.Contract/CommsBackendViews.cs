using System.Collections.Generic;

namespace Sitrep.Contract;

// ====================================================================
// The KSP-free vocabulary a comms backend answers CommsBackendBase in.
//
// These types exist so the shared half of ICommsBackend can live in the
// contract rather than twice in two assemblies. They are NOT wire
// payloads and carry no [SitrepContract]: nothing here reaches a client.
// They are the seam INSIDE the seam, the terms in which a backend hands
// over what only it can read so that everything derivable from it is
// derived once.
//
// Every one of them is deliberately a VIEW rather than a KSP object.
// Sitrep.Contract compiles with no KSP reference assemblies at all, and
// must keep doing so: it is the one project an out-of-tree Uplink is
// allowed to reference, so a CommNet type on any signature here would
// put KSP in the published surface and make the shared logic
// unreachable from a headless test.
// ====================================================================

/// <summary>
/// Degree of vessel control a link affords, in the four states KSP
/// distinguishes rather than the three the wire carries.
///
/// <para>Four rather than three because <see cref="CommsConnectivity.HasLocalControl"/>
/// turns on MANNED versus UNMANNED and the wire's
/// <see cref="CommsControlSource"/> does not: a crewed pod can be flown with no
/// link home, an uncrewed one cannot. Collapsing the two before the shared
/// derivation runs would lose exactly the distinction one of the three derived
/// fields needs, so the collapse happens after, in
/// <see cref="CommsBackendBase"/>, where all three come off one value and cannot
/// disagree.</para>
///
/// <para>Mirrors stock <c>Vessel.ControlLevel</c> without leaking a KSP enum
/// into the contract. Both shipped backends map their game's enum onto this and
/// nothing else.</para>
/// </summary>
public enum CommsControlGrade
{
    None,
    PartialUnmanned,
    PartialManned,
    Full,
}

/// <summary>
/// One endpoint of a link, as much of it as the shared shapes need: an opaque
/// handle back to the live object, the identity that goes on the wire, and a
/// position.
///
/// <para><see cref="Handle"/> is the live object the backend read this from, on
/// the same OPAQUE terms <see cref="ICommsBackend.RouteBetween"/> and
/// <see cref="IActiveVessel.Reported"/> established. It exists so core can
/// reference-match a node against its own registries (which is how
/// <c>comms.commandCentre</c> names a centre) without the contract having to
/// know what a node IS. It is a live handle: it MUST NOT cross a thread
/// boundary or outlive the capture that produced it, and nothing in the shared
/// derivation dereferences it.</para>
///
/// <para><see cref="Id"/> is a UNIQUE, stable join key, and the backend owns its
/// derivation because recovering it needs the game (a vessel node's owning
/// craft is not reachable from the node). What the contract can and does force
/// is that the id EXISTS and is the only thing the shared shapes key on, so a
/// per-hop annotation on a provider's own channel joins onto the route core
/// published. See <see cref="CommsHop"/> and <see cref="CommsNetworkNode"/> for
/// why a display name could not serve.</para>
/// </summary>
public readonly struct CommsNodeView
{
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
    /// Position in whatever ONE frame the backend reads both endpoints in. The
    /// shared derivation only ever takes differences, so the frame's origin and
    /// orientation are the backend's business and never travel; what it must not
    /// do is mix frames between the two ends of a link.
    /// </summary>
    public Vector3d Position { get; }
}

/// <summary>
/// One link of a path the backend has solved, as its two endpoint views.
///
/// <para>Ordered: <see cref="A"/> is the near end and <see cref="B"/> the far
/// one, in the direction the path runs. The shared derivation preserves that
/// order onto <see cref="CommsHop.From"/>/<see cref="CommsHop.To"/>, which is
/// what makes a station handoff readable.</para>
/// </summary>
public readonly struct CommsLinkView
{
    public CommsLinkView(CommsNodeView a, CommsNodeView b, object? handle = null)
    {
        A = a;
        B = b;
        Handle = handle;
    }

    public CommsNodeView A { get; }

    public CommsNodeView B { get; }

    /// <summary>
    /// The live link object, on the same OPAQUE terms as
    /// <see cref="CommsNodeView.Handle"/>, or null when the backend has no
    /// link-level fact to come back for.
    ///
    /// <para>It exists because a LINK-level provider fact has no home on either
    /// node. RealAntennas' per-hop extras are properties of the link (the band
    /// and modulation it negotiated, the rate each way), so
    /// <see cref="CommsBackendBase.HopExtensions"/> has to be able to reach the
    /// object the view was built from. The alternative, matching a view back to
    /// its link by position in the list, is an identity comparison on a struct
    /// and breaks the moment a link is skipped.</para>
    ///
    /// <para>Live handle, same rules: never dereferenced by shared code, never
    /// crosses a thread, never outlives the capture.</para>
    /// </summary>
    public object? Handle { get; }
}

/// <summary>
/// The craft a backend is answering for, and how well it can see it: the two
/// facts every <see cref="PayloadMeta"/> in the comms family is built from.
///
/// <para>Front-loaded because the meta VOCABULARY is a client fact. A source of
/// <c>"vessel:&lt;guid&gt;"</c> or <c>"game"</c>, and a quality of
/// <c>Loaded</c> or <c>OnRails</c>, is what a consumer branches on, and two
/// backends deriving it separately is two places for it to drift.</para>
/// </summary>
public readonly struct CommsSubject
{
    /// <summary>No craft to answer for: not in flight, or the backend could not resolve one.</summary>
    public static readonly CommsSubject None = default;

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
/// What a backend read off a live link: the three readings every shared comms
/// payload is derived from, and nothing else.
///
/// <para>One struct rather than three accessors because the three wire channels
/// that come out of it (<c>comms.connectivity</c>, <c>comms.signalStrength</c>,
/// <c>comms.controlState</c>) describe ONE tick of ONE link, and reading them
/// separately is three chances to straddle a scene change and publish a
/// connected flag beside a control level from the craft before it.</para>
/// </summary>
public readonly struct CommsLinkState
{
    public CommsLinkState(bool connected, CommsControlGrade grade, double signalStrength)
    {
        Connected = connected;
        Grade = grade;
        SignalStrength = signalStrength;
    }

    /// <summary>Whether the backend's own gates resolved a control path home.</summary>
    public bool Connected { get; }

    /// <summary>Control the link affords, before the wire's collapse to three states.</summary>
    public CommsControlGrade Grade { get; }

    /// <summary>
    /// The backend's own 0..1 strength. KNOWN to mean two different things
    /// (stock: a range fraction; RealAntennas: a rate-ladder headroom fraction)
    /// behind one field, which is a defect of <see cref="CommsSignalStrength"/>
    /// and not of this struct. It is carried through unchanged, deliberately:
    /// fixing it means either one normalised quantity or two honest fields, and
    /// either is a wire change with client work behind it.
    /// </summary>
    public double SignalStrength { get; }
}

/// <summary>
/// One observed break in a subject's route home: when it happened, and how far
/// out along the route it sat.
///
/// <para>Backend-facing, like every other view in this file, and deliberately
/// NOT a contract type: a break never reaches the wire. It is raised on the
/// main thread by whoever can see the hop geometry, carried to the engine as
/// two plain doubles, and spent on <c>INetwork.DropPath</c>. A client sees only
/// the silence it produces.</para>
/// </summary>
public readonly struct PathBreak
{
    public PathBreak(double atUt, double lightSecondsOut)
    {
        AtUt = atUt;
        LightSecondsOut = lightSecondsOut;
    }

    /// <summary>The UT the break was observed.</summary>
    public double AtUt { get; }

    /// <summary>
    /// How far out from the subject the break sat, in light-seconds along the
    /// route it was using. This is the quantity that decides WHETHER a sample
    /// arrives rather than when: light already past this point is a wavefront on
    /// the far leg and the break is behind it.
    /// </summary>
    public double LightSecondsOut { get; }
}
