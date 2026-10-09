using System.Collections.Generic;
using System.Runtime.CompilerServices;

namespace Sitrep.Contract;

/// <summary>
/// A base class for an <see cref="ICommsBackend"/> that builds every payload
/// that is the same under every backend from the few things only a backend can
/// read. Inheriting it is optional.
///
/// <para><b>What it builds and what you supply.</b> The relay graph, each hop,
/// the control state, the payload meta and the node a path ends at are built
/// here. Whether a connection succeeds, what a link costs, how far it reaches,
/// how degraded it is and what blocks it are yours: the abstract members, and
/// the models <see cref="ICommsBackend"/> asks for.</para>
///
/// <para><b>Errors.</b> A read that fails, such as a torn-down vessel or a comms
/// graph mid-rebuild, must throw and must not be reported as a disconnect.
/// Gonogo drops that tick, keeps the last reading and tries again next tick.
/// A disconnect freezes every delayed <c>vessel.*</c> channel of that craft, so
/// a failed read reported as one blacks out a craft whose link is up. A real
/// disconnect is a <see cref="CommsLinkState.Connected"/> of false with no
/// throw. Nothing in this class catches. To guard against a torn read, check
/// where you read (for example that the vessel is loaded).</para>
///
/// <para><b>Threading.</b> Every abstract member reads live game state, so the
/// whole class is main-thread only, during capture. The views it returns carry
/// live handles that must not outlive the capture.</para>
/// <internal>
/// <para>Both shipped backends inherit, so they are a working example rather
/// than a special case. The engine treats a thrown connectivity read as
/// connected rather than as a disconnect.</para>
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
    /// <para>A backend with a more specific reason overrides
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
    public abstract IReadOnlyList<CommsRouteHop>? RouteBetween(CommsNodeHandle? from, CommsNodeHandle? to);

    /// <inheritdoc />
    public abstract ICommsReachModel ReachModel(CommsNodeHandle? from, CommsNodeHandle? to);

    /// <inheritdoc />
    public abstract ICommsOcclusionModel OcclusionModel();

    /// <inheritdoc />
    public abstract ICommsDegradeModel DegradeModel();

    /// <summary>
    /// The craft this backend is reporting on this tick, or
    /// <see cref="CommsSubject.None"/> when there is none.
    ///
    /// <para>During an EVA, KSP's own active vessel is the kerbal, whose link is
    /// the suit's rather than the ship's. Resolve the craft through
    /// <see cref="ActiveVesselCapability"/> rather than reading the game's active
    /// vessel directly.</para>
    /// </summary>
    protected abstract CommsSubject Subject();

    /// <summary>
    /// The three readings off the live link, or null when there is no live link
    /// to read: no craft, not in flight, or a craft whose comms graph is not
    /// safe to touch this tick.
    ///
    /// <para>Null is the only way to say there is nothing to read, and it
    /// produces a disconnected payload. A read that fails throws instead, as the
    /// class summary says.</para>
    /// </summary>
    protected abstract CommsLinkState? LinkState();

    /// <summary>
    /// The links of <paramref name="vessel"/>'s control path toward home, in
    /// order, or null when it has no path. <paramref name="vessel"/> is the
    /// opaque handle every route accessor on <see cref="ICommsBackend"/> takes,
    /// and a handle this backend does not recognise has no path.
    ///
    /// <para>Which route the game solved is yours to read. Hop distances, node
    /// identity, which end is home, the network graph and the path's terminus
    /// are all built from what this returns.</para>
    /// </summary>
    protected abstract IReadOnlyList<CommsLinkView>? ControlPath(object? vessel);

    /// <summary>
    /// This backend's per-hop extras, under its own provider namespace, or null
    /// when it has none to add.
    ///
    /// <para>Use it for a fact the shared hop does not declare; see
    /// <see cref="CommsHop.Extensions"/>. The default adds nothing.</para>
    /// </summary>
    protected virtual Dictionary<string, object?>? HopExtensions(CommsLinkView link) => null;

    /// <summary>
    /// The annotation for a disconnected control state. Override it with a more
    /// specific reason; the default is <see cref="NoCommandSourceReason"/>.
    /// Return null for no annotation, never an empty string.
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
        var state = LinkState();
        if (state == null)
        {
            return new CommsConnectivity { ControlSource = CommsControlSource.None };
        }
        var grade = state.Value.Grade;
        return new CommsConnectivity
        {
            Connected = state.Value.Connected,
            ControlSource = SourceOf(grade),
            HasLocalControl = grade == CommsControlGrade.PartialManned || grade == CommsControlGrade.Full,
        };
    }

    /// <summary>
    /// The backend's own strength, carried through unchanged, or <c>0</c> when
    /// there is no live link to read. Its meaning differs across backends; see
    /// <see cref="CommsLinkState.PathStrength"/>.
    /// </summary>
    public CommsSignal Signal() =>
        LinkState() is { } link
            ? new CommsSignal { Strength = link.PathStrength, Quantity = link.Quantity }
            : new CommsSignal { Strength = 0.0, Quantity = SignalQuantity.Unknown };

    /// <inheritdoc cref="ICommsBackend.ControlState" />
    public CommsControl ControlState()
    {
        var state = LinkState();
        if (state == null)
        {
            return new CommsControl { Level = CommsControlStateKind.None };
        }
        return new CommsControl
        {
            Level = KindOf(state.Value.Grade),
            Reason = state.Value.Connected ? null : DisconnectedReason,
        };
    }

    /// <summary>
    /// <inheritdoc cref="ICommsBackend.Path" path="/summary"/>
    ///
    /// <para>Each hop's <see cref="CommsHop.DistanceMeters"/> is the straight-line
    /// distance between its two endpoint positions.</para>
    /// <internal>
    /// Built here rather than per backend for the same reason signal delay is
    /// core: light-time over shared geometry is physics, and a backend that
    /// could shorten a hop could shorten a delay.
    /// </internal>
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
        return new CommsPath { Hops = hops };
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
    /// <para>The nodes and edges of the control path, de-duplicated by
    /// <see cref="CommsNodeView.Id"/>, so that id must be unique: two craft that
    /// shared one would merge into one node and lose a link. Every edge is
    /// <see cref="CommsNetworkEdge.Active"/>.</para>
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
    /// <para>Looks at the path's last hop: a home node if it touches one,
    /// otherwise a control source, otherwise null. Home wins because KSP only
    /// falls back to the nearest control source when no route home exists.</para>
    /// </summary>
    public CommsNodeHandle? ControlPathTerminus(object? vessel)
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
    /// The payload meta every payload above carries, from <see cref="Subject"/>:
    /// a source of <c>"vessel:&lt;id&gt;"</c> when there is a craft, otherwise
    /// <c>"game"</c>.
    ///
    /// <para>Use it to stamp a payload of your own backend's channels with the
    /// same meta.</para>
    /// </summary>
    protected PayloadMeta Meta()
    {
        var subject = Subject();
        return new PayloadMeta
        {
            Source = subject.VesselId != null ? "vessel:" + subject.VesselId : "game",
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
