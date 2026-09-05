using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// The shared half of <see cref="ICommsBackend"/>, implemented ONCE, in the
/// contract: every readout that is the same fact under every backend, derived
/// from the small set of things only a backend can read.
///
/// <para><b>The rule this file exists to enforce: the contract forces the
/// SHAPE, the backend keeps the JUDGEMENT.</b> The shape of a relay graph, a
/// hop, a control state, a payload's meta, and which node a path terminates at
/// are all fixed here. What constitutes a successful connection, what a link
/// costs, how far it reaches, and which rock blocks it are not touched: those
/// stay abstract, or off this class entirely, because they are the questions
/// the backends genuinely answer differently.</para>
///
/// <para><b>Why it is not merely tidier.</b> Before this class, five accessors
/// were the same code twice in two assemblies, down to the shared
/// <c>"no connection to a command source"</c> string. The copies had already
/// drifted, and not decoratively: the stock copy wrapped every read in a
/// try/catch that turned a throw into an authoritative <c>connected:false</c>,
/// and the RealAntennas copy let it propagate. <c>connected:false</c> is a
/// freeze lever (<c>ChannelEngine.RevealDelayFor</c> returns <c>+Inf</c> for
/// every Delayed topic of a disconnected subject, regardless of whether signal
/// delay is even enabled), so one transient scene settle froze the whole board
/// under stock and was a one-tick hold under RealAntennas. The duplication was
/// carrying a divergence that decided whether the operator's screen stopped
/// updating.</para>
///
/// <para><b>The one error contract, and it is to THROW.</b>
/// <c>CommsCoreUplink.ComputeConnectedOnMain</c> already reasons this out at
/// length and its conclusion is adopted here rather than restated: a read that
/// throws on a torn-down vessel must NOT become an authoritative disconnect,
/// because the reveal gate treats that as a real blackout and freezes every
/// <c>vessel.*</c> channel while the link is in fact up. A propagating throw is
/// caught by the engine's own fail-soft, which treats a thrown connectivity
/// source as CONNECTED and retries next tick, and by
/// <c>CommsCoreUplink.CaptureOnMain</c>, which drops the tick and leaves
/// last-known standing. Nothing here catches. A GENUINE disconnect still
/// arrives as a clean <see cref="CommsLinkState.Connected"/> of false, with no
/// throw, and still freezes, as intended. A backend that wants to GUARD against
/// a torn read (stock gates on <c>vessel.loaded</c>) does so where it reads,
/// which is a guard and not a swallow.</para>
///
/// <para><b>Threading.</b> Every abstract member below reads live game state, so
/// the whole class is main-thread only, on the capture-on-main seam. The views
/// it is answered in carry live handles that must not outlive the capture.</para>
///
/// <para>Inheriting is optional. A backend with a reason to shape a payload
/// differently implements <see cref="ICommsBackend"/> directly and owns the
/// consequences; both shipped backends inherit, which is what makes them a
/// working example rather than a special case.</para>
/// </summary>
public abstract class CommsBackendBase : ICommsBackend
{
    /// <summary>
    /// The annotation on <see cref="CommsControlState.Reason"/> when there is no
    /// link home.
    ///
    /// <para>Byte-identical in both backends before this constant existed, which
    /// is the tell that it was never a backend fact: it describes the CONTRACT's
    /// own None state, not any game's rule for reaching it. A backend with a
    /// more specific reason overrides <see cref="DisconnectedReason"/>.</para>
    /// </summary>
    public const string NoCommandSourceReason = "no connection to a command source";

    public abstract string ProviderId { get; }

    // ── The judgement, left entirely alone ──────────────────────────────────

    /// <inheritdoc />
    public abstract IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to);

    /// <inheritdoc />
    public abstract ICommsReachModel ReachModel(object? from, object? to);

    /// <inheritdoc />
    public abstract ICommsOcclusionModel OcclusionModel();

    // ── What only the backend can read ──────────────────────────────────────

    /// <summary>
    /// The craft this backend is answering for this tick, or
    /// <see cref="CommsSubject.None"/> when there is none.
    ///
    /// <para>WHICH craft is a real per-backend decision and not a formality:
    /// KSP's own answer during an EVA is the kerbal, whose connection is the
    /// suit's, so a backend that reads the game directly reports a link that has
    /// nothing to do with the ship on screen. Both shipped backends resolve it
    /// through core's <c>activeVessel</c> capability instead, by different
    /// routes.</para>
    /// </summary>
    protected abstract CommsSubject Subject();

    /// <summary>
    /// The three readings off the live link, or null when there is no live link
    /// to read: no craft, not in flight, or a craft whose comms graph is not
    /// safe to touch this tick.
    ///
    /// <para>Null is the ONLY way to say "nothing to read", and it produces a
    /// clean disconnected payload. It is not the way to report a failed read:
    /// see the error contract above, where a throw is what a failed read
    /// does.</para>
    /// </summary>
    protected abstract CommsLinkState? LinkState();

    /// <summary>
    /// The links of the control path from the craft toward home, in order, or
    /// null when there is no path.
    ///
    /// <para>The PATH is the backend's: which route the game solved, under whose
    /// gates, is the question <c>RaRouting</c> exists for. What the shared code
    /// does with it is fixed here, so hop geometry, node identity, home-ness,
    /// graph de-duplication and the terminus are derived once from whatever the
    /// winner solved.</para>
    /// </summary>
    protected abstract IReadOnlyList<CommsLinkView>? ControlPath();

    /// <summary>
    /// This backend's per-hop extras, under its own provider namespace, or null
    /// when it has none to add.
    ///
    /// <para>The extension bag is the sanctioned way a backend carries a fact
    /// the shared hop does not declare, without a change to core (see
    /// <see cref="CommsHop.Extensions"/>). Virtual rather than abstract because
    /// having nothing to add is the ordinary case.</para>
    /// </summary>
    protected virtual Dictionary<string, object?>? HopExtensions(CommsLinkView link) => null;

    /// <summary>
    /// The annotation for a disconnected control state. Virtual so a backend
    /// with a sharper reason can say it; the default is
    /// <see cref="NoCommandSourceReason"/>, and null is a legitimate override
    /// meaning "no annotation" (the field is a nullable annotation, never an
    /// empty-string sentinel).
    /// </summary>
    protected virtual string? DisconnectedReason => NoCommandSourceReason;

    // ── The shape, derived once ─────────────────────────────────────────────

    /// <summary>
    /// <inheritdoc cref="ICommsBackend.Connectivity" path="/summary"/>
    ///
    /// <para>All three fields come off one <see cref="CommsLinkState"/>, so they
    /// cannot disagree about which tick they describe.
    /// <see cref="CommsConnectivity.HasLocalControl"/> is true for a crewed pod
    /// or full control and is deliberately independent of
    /// <see cref="CommsConnectivity.Connected"/>: a manned craft can be flown
    /// with no link home.</para>
    /// </summary>
    public CommsConnectivity Connectivity()
    {
        var meta = Meta();
        var state = LinkState();
        if (state == null)
        {
            return new CommsConnectivity { ControlSource = CommsControlSource.None, Meta = meta };
        }
        var grade = state.Value.Grade;
        return new CommsConnectivity
        {
            Connected = state.Value.Connected,
            ControlSource = SourceOf(grade),
            HasLocalControl = grade == CommsControlGrade.PartialManned || grade == CommsControlGrade.Full,
            Meta = meta,
        };
    }

    /// <summary>
    /// The backend's own strength, carried through unchanged. See
    /// <see cref="CommsLinkState.SignalStrength"/> for the known defect in what
    /// this field MEANS across backends, which is a wire question rather than a
    /// derivation one and is deliberately not papered over here.
    /// </summary>
    public CommsSignalStrength SignalStrength() =>
        new CommsSignalStrength { Value = LinkState()?.SignalStrength ?? 0.0, Meta = Meta() };

    /// <inheritdoc cref="ICommsBackend.ControlState" />
    public CommsControlState ControlState()
    {
        var state = LinkState();
        if (state == null)
        {
            return new CommsControlState { State = CommsControlStateKind.None, Meta = Meta() };
        }
        return new CommsControlState
        {
            State = KindOf(state.Value.Grade),
            Reason = state.Value.Connected ? null : DisconnectedReason,
            Meta = Meta(),
        };
    }

    /// <summary>
    /// <inheritdoc cref="ICommsBackend.Path" path="/summary"/>
    ///
    /// <para>Hop geometry is a straight subtraction of the two endpoint
    /// positions, and it lives here rather than in either backend because it is
    /// identical arithmetic over identical fields. That is the same reason
    /// <c>SignalDelay</c> is core: light-time over shared geometry is physics,
    /// not a modelling choice, and a backend that could shorten a hop could
    /// shorten a delay.</para>
    /// </summary>
    public CommsPath Path()
    {
        var hops = new List<CommsHop>();
        var path = ControlPath();
        if (path != null)
        {
            foreach (var link in path)
            {
                hops.Add(new CommsHop
                {
                    From = link.A.Id,
                    To = link.B.Id,
                    FromIsHome = link.A.IsHome,
                    ToIsHome = link.B.IsHome,
                    Kind = link.A.IsHome || link.B.IsHome ? CommsHopKind.Home : CommsHopKind.Relay,
                    DistanceMeters = (link.A.Position - link.B.Position).Magnitude(),
                    Extensions = HopExtensions(link),
                });
            }
        }
        return new CommsPath { Hops = hops, Meta = Meta() };
    }

    /// <summary>
    /// <inheritdoc cref="ICommsBackend.Network" path="/summary"/>
    ///
    /// <para>De-duplicated by <see cref="CommsNodeView.Id"/>, which is why that
    /// id has to be unique: a display name two craft can share merged them into
    /// one node and lost a link. Both backends' graphs are the control path's
    /// nodes and edges today, so <see cref="CommsNetworkEdge.Active"/> is true
    /// for every edge under both. That is a field with one value, and it stays
    /// on the wire rather than being quietly derived away, because a richer
    /// graph is a change to what a backend SUPPLIES here and this shape is
    /// already the one that would carry it.</para>
    /// </summary>
    public CommsNetwork Network()
    {
        var nodes = new List<CommsNetworkNode>();
        var edges = new List<CommsNetworkEdge>();
        var seen = new HashSet<string>();
        var path = ControlPath();
        if (path != null)
        {
            foreach (var link in path)
            {
                AddNode(nodes, seen, link.A);
                AddNode(nodes, seen, link.B);
                edges.Add(new CommsNetworkEdge { A = link.A.Id, B = link.B.Id, Active = true });
            }
        }
        return new CommsNetwork { Nodes = nodes, Edges = edges, Meta = Meta() };
    }

    /// <summary>
    /// <inheritdoc cref="ICommsBackend.ControlPathTerminus" path="/summary"/>
    ///
    /// <para>Home first, then a crewed control source, because stock always
    /// prefers home: <c>CreateControlConnection</c> tries a route home and only
    /// falls back to the nearest control source when none is reachable, so a
    /// home-reachable path's last hop can in principle also touch a
    /// control-source relay. Both shipped backends inherit <c>isHome</c> and
    /// <c>isControlSource</c> from stock unchanged, which is why this is one
    /// rule here rather than two copies: it was a UNIVERSAL question made
    /// backend-specific purely by living on a concrete class, and the
    /// consequence was <c>comms.commandCentre</c> going all-null forever on a
    /// RealAntennas install.</para>
    /// </summary>
    public object? ControlPathTerminus()
    {
        var path = ControlPath();
        if (path == null || path.Count == 0)
        {
            return null;
        }

        var last = path[path.Count - 1];
        if (last.A.IsHome) return last.A.Handle;
        if (last.B.IsHome) return last.B.Handle;
        if (last.A.IsControlSource) return last.A.Handle;
        if (last.B.IsControlSource) return last.B.Handle;
        return null;
    }

    /// <summary>
    /// The payload meta every accessor above stamps, from
    /// <see cref="Subject"/>. The <c>"vessel:&lt;id&gt;"</c> / <c>"game"</c>
    /// vocabulary is a client fact, so it is derived in one place rather than
    /// spelled out per backend.
    ///
    /// <para>Protected so a backend can stamp its OWN payloads (an RA-only
    /// channel, say) with the same meta the shared ones carry, rather than
    /// building a second one that could disagree.</para>
    /// </summary>
    protected PayloadMeta Meta()
    {
        var subject = Subject();
        return new PayloadMeta
        {
            Source = subject.VesselId != null ? "vessel:" + subject.VesselId : "game",
            Quality = subject.VesselId != null && subject.Loaded ? Quality.Loaded : Quality.OnRails,
        };
    }

    private static void AddNode(List<CommsNetworkNode> nodes, HashSet<string> seen, CommsNodeView node)
    {
        if (!seen.Add(node.Id))
        {
            return;
        }
        nodes.Add(new CommsNetworkNode
        {
            Id = node.Id,
            DisplayName = node.DisplayName,
            Kind = node.IsHome ? CommsHopKind.Home : CommsHopKind.Relay,
        });
    }

    /// <summary>
    /// The wire's three-state collapse of <see cref="CommsControlGrade"/>.
    /// Partial is partial whether or not there is a crew; the crew shows up in
    /// <see cref="CommsConnectivity.HasLocalControl"/> instead.
    /// </summary>
    private static CommsControlSource SourceOf(CommsControlGrade grade)
    {
        switch (grade)
        {
            case CommsControlGrade.Full:
                return CommsControlSource.Full;
            case CommsControlGrade.PartialManned:
            case CommsControlGrade.PartialUnmanned:
                return CommsControlSource.Partial;
            default:
                return CommsControlSource.None;
        }
    }

    /// <summary>The same collapse in <c>comms.controlState</c>'s own vocabulary.</summary>
    private static CommsControlStateKind KindOf(CommsControlGrade grade)
    {
        switch (grade)
        {
            case CommsControlGrade.Full:
                return CommsControlStateKind.Full;
            case CommsControlGrade.PartialManned:
            case CommsControlGrade.PartialUnmanned:
                return CommsControlStateKind.PartialManoeuvre;
            default:
                return CommsControlStateKind.None;
        }
    }
}
