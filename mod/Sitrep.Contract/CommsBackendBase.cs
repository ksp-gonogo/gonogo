using System.Collections.Generic;
using System.Runtime.CompilerServices;

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
/// costs, how far it reaches, how badly it is degraded, and which rock blocks
/// it are not touched: those stay abstract, or off this class entirely, because
/// they are the questions the backends genuinely treat differently.</para>
///
/// <para><b>The one error contract, and it is to THROW.</b> A read that fails
/// (a torn-down vessel, a comms graph mid-rebuild) must throw, and must NOT be
/// turned into a disconnect. A disconnected craft is treated as a real
/// blackout: every delayed <c>vessel.*</c> channel of that craft freezes, even
/// while the link is in fact up. A propagating throw is caught by the engine,
/// which treats a thrown connectivity read as CONNECTED, drops the tick, leaves
/// the last reading standing and retries next tick. Nothing in this class
/// catches. A GENUINE disconnect arrives as a clean
/// <see cref="CommsLinkState.Connected"/> of false, with no throw, and freezes
/// as intended. A backend that wants to GUARD against a torn read (stock gates
/// on <c>vessel.loaded</c>) does so where it reads, which is a guard and not a
/// swallow.</para>
///
/// <para><b>Threading.</b> Every abstract member below reads live game state, so
/// the whole class is main-thread only, during capture. The views it returns
/// carry live handles that must not outlive the capture.</para>
///
/// <para>Inheriting is optional. A backend with a reason to shape a payload
/// differently implements <see cref="ICommsBackend"/> directly and owns the
/// consequences; both shipped backends inherit, which is what makes them a
/// working example rather than a special case.</para>
/// <internal>
/// <para>The throw rule matters because <c>connected:false</c> is a freeze
/// lever: <c>ChannelEngine.RevealDelayFor</c> returns <c>+Inf</c> for every
/// Delayed topic of a disconnected subject, whether or not signal delay is
/// enabled, so a try/catch that turned a throw into <c>connected:false</c>
/// froze the whole board on one transient scene settle.
/// <c>CommsCoreUplink.ComputeConnectedOnMain</c> reasons this out at length;
/// <c>CommsCoreUplink.CaptureOnMain</c> is what drops the tick.</para>
/// </internal>
/// </summary>
/// <category>Uplink API</category>
public abstract class CommsBackendBase : ICommsBackend
{
    /// <summary>
    /// The annotation on <see cref="CommsControl.Reason"/> when there is no
    /// link home.
    ///
    /// <para>It describes the CONTRACT's own None state, not any game's rule for
    /// reaching it. A backend with a more specific reason overrides
    /// <see cref="DisconnectedReason"/>.</para>
    /// </summary>
    public const string NoCommandSourceReason = "no connection to a command source";

    /// <summary>
    /// This backend's stable provider id, e.g. <c>"stock"</c>: the same string it
    /// registers under, and the namespace its <see cref="HopExtensions"/> ride
    /// under. See <see cref="ISitrepProvider.ProviderId"/>.
    /// </summary>
    public abstract string ProviderId { get; }

    /// <inheritdoc />
    public abstract IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to);

    /// <inheritdoc />
    public abstract ICommsReachModel ReachModel(object? from, object? to);

    /// <inheritdoc />
    public abstract ICommsOcclusionModel OcclusionModel();

    /// <inheritdoc />
    public abstract ICommsDegradeModel DegradeModel();

    /// <summary>
    /// The craft this backend is reporting on this tick, or
    /// <see cref="CommsSubject.None"/> when there is none.
    ///
    /// <para>WHICH craft is a real per-backend decision and not a formality:
    /// KSP's own active vessel during an EVA is the kerbal, whose connection is the
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
    /// The links of <paramref name="vessel"/>'s control path toward home, in
    /// order, or null when it has no path. <paramref name="vessel"/> is the
    /// opaque handle every route accessor on <see cref="ICommsBackend"/> takes,
    /// and a handle this backend does not recognise has no path.
    ///
    /// <para>The PATH is the backend's: which route the game solved, under whose
    /// gates, is the backend's own question. What the shared code
    /// does with it is fixed here, so hop geometry, node identity, home-ness,
    /// graph de-duplication and the terminus are derived once from whatever the
    /// winner solved.</para>
    /// </summary>
    protected abstract IReadOnlyList<CommsLinkView>? ControlPath(object? vessel);

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
    /// The backend's own strength, carried through unchanged, or <c>0</c> when
    /// there is no live link to read. See
    /// <see cref="CommsLinkState.SignalStrength"/> for what this value means,
    /// which differs across backends; that is a wire question rather than a
    /// derivation one, so it is not smoothed over here.
    /// </summary>
    public CommsSignal SignalStrength() =>
        new CommsSignal { Strength = LinkState()?.SignalStrength ?? 0.0, Meta = Meta() };

    /// <inheritdoc cref="ICommsBackend.ControlState" />
    public CommsControl ControlState()
    {
        var state = LinkState();
        if (state == null)
        {
            return new CommsControl { Level = CommsControlStateKind.None, Meta = Meta() };
        }
        return new CommsControl
        {
            Level = KindOf(state.Value.Grade),
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
    public CommsPath Path(object? vessel)
    {
        var hops = new List<CommsHop>();
        var path = ControlPath(vessel);
        // Every tick's ordinary path read is what keeps StillCarriesTo able to
        // reach a node the route has since dropped: once it is off the route
        // there is nowhere else to get a handle for it.
        Remember(vessel, path);
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

    /*
     * Per vessel: the node views seen on its control path most recently, by id,
     * plus the vessel's own end of it. Retained so StillCarriesTo can still
     * reach a node the route has since stopped using: its handle is what
     * RouteBetween needs, and once the node is off the route there is nowhere
     * else to get one.
     *
     * Keyed by the vessel handle ITSELF, compared by reference and held weakly,
     * so one vessel's route can never stand in for another's, and a destroyed
     * vessel's memory goes when the vessel does. A hash of the handle is never
     * the key: two handles can share one, and a route memory handed to the
     * wrong vessel names a break that did not happen.
     *
     * Handles are held across ticks and never dereferenced here. A held handle
     * to a destroyed node is safe by RouteBetween's own contract, which returns
     * null for a missing handle, and that is exactly what a destroyed relay
     * should give.
     */
    private sealed class RouteMemory
    {
        public readonly Dictionary<string, CommsNodeView> Seen =
            new Dictionary<string, CommsNodeView>();
        public CommsNodeView? Origin;
    }

    private readonly ConditionalWeakTable<object, RouteMemory> _routes =
        new ConditionalWeakTable<object, RouteMemory>();

    /// <inheritdoc cref="ICommsBackend.StillCarriesTo" path="/summary"/>
    public bool? StillCarriesTo(object? vessel, string nodeId)
    {
        if (vessel == null || string.IsNullOrEmpty(nodeId))
        {
            return null;
        }

        var path = ControlPath(vessel);
        Remember(vessel, path);

        if (path != null)
        {
            foreach (var link in path)
            {
                if (link.A.Id == nodeId || link.B.Id == nodeId)
                {
                    // On the route this very tick, so it is carrying by
                    // demonstration rather than by inference.
                    return true;
                }
            }
        }

        if (!_routes.TryGetValue(vessel, out var memory) || memory.Origin == null)
        {
            // Never seen this vessel on a route, so there is nothing to have lost.
            return null;
        }

        // The craft's own transmitter. RouteBetween returns null for the same
        // node at both ends, which would read as a break at zero light-seconds
        // and doom every sample ever sent.
        if (memory.Origin.Value.Id == nodeId)
        {
            return true;
        }

        if (!memory.Seen.TryGetValue(nodeId, out var node))
        {
            // Never on this vessel's route, so there is nothing for it to have lost.
            return null;
        }

        // Null is "will not route between them": a missing handle, or an end it
        // cannot reach. Both mean the same thing here. An EMPTY list is routed
        // with nothing to measure, which is still carrying.
        return RouteBetween(memory.Origin.Value.Handle, node.Handle) != null;
    }

    private void Remember(object? vessel, IReadOnlyList<CommsLinkView>? path)
    {
        if (vessel == null || path == null || path.Count == 0)
        {
            return;
        }
        var memory = _routes.GetOrCreateValue(vessel);
        memory.Origin = path[0].A;
        foreach (var link in path)
        {
            memory.Seen[link.A.Id] = link.A;
            memory.Seen[link.B.Id] = link.B;
        }
    }

    /// <summary>
    /// <inheritdoc cref="ICommsBackend.Network" path="/summary"/>
    ///
    /// <para>De-duplicated by <see cref="CommsNodeView.Id"/>, which is why that
    /// id has to be unique: a display name two craft can share would merge them
    /// into one node and lose a link. Both shipped backends' graphs are the
    /// control path's nodes and edges, so <see cref="CommsNetworkEdge.Active"/>
    /// is true for every edge under both. The field stays on the wire because a
    /// richer graph is a change to what a backend SUPPLIES here, and this shape
    /// already carries it.</para>
    /// </summary>
    /// <param name="vessel">The craft to view the network from, as an opaque handle.</param>
    /// <returns>The <c>comms.network</c> payload.</returns>
    public CommsNetwork Network(object? vessel)
    {
        var nodes = new List<CommsNetworkNode>();
        var edges = new List<CommsNetworkEdge>();
        var seen = new HashSet<string>();
        var path = ControlPath(vessel);
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
    /// rule here rather than a copy per backend.</para>
    /// </summary>
    public object? ControlPathTerminus(object? vessel)
    {
        var path = ControlPath(vessel);
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
    ///
    /// <para>Both collapses name every grade and have no discard, so a grade
    /// added to the enum is a compile error (CS8509 is an error across the mod)
    /// until someone decides what it means on the wire. A value cast
    /// from an integer the enum does not declare throws, which is this seam's
    /// failed read: the tick is dropped and last-known stands, where any member
    /// returned instead would be a reading nobody took.</para>
    /// </summary>
#pragma warning disable CS8524
    private static CommsControlSource SourceOf(CommsControlGrade grade) => grade switch
    {
        CommsControlGrade.None => CommsControlSource.None,
        CommsControlGrade.PartialUnmanned or CommsControlGrade.PartialManned => CommsControlSource.Partial,
        CommsControlGrade.Full => CommsControlSource.Full,
        CommsControlGrade.Unknown => CommsControlSource.Unknown,
    };

    /// <summary>The same collapse in <c>comms.control</c>'s own vocabulary.</summary>
    private static CommsControlStateKind KindOf(CommsControlGrade grade) => grade switch
    {
        CommsControlGrade.None => CommsControlStateKind.None,
        CommsControlGrade.PartialUnmanned or CommsControlGrade.PartialManned => CommsControlStateKind.PartialManoeuvre,
        CommsControlGrade.Full => CommsControlStateKind.Full,
        CommsControlGrade.Unknown => CommsControlStateKind.Unknown,
    };
#pragma warning restore CS8524
}
