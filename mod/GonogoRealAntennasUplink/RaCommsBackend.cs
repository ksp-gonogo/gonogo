using System.Collections.Generic;
using CommNet;
using Sitrep.Contract;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// The RealAntennas <see cref="ICommsBackend"/>: the higher-priority
    /// backend elected for the exclusive <c>"comms"</c> capability when RA is
    /// loaded (comms-uplink-design.md §2.2). Connectivity/strength/control-state
    /// and hop GEOMETRY come from the SAME stock CommNet graph CommNet uses
    /// (§4.3: <c>RACommLink : CommNet.CommLink</c>, <c>RACommNode : CommNet.CommNode</c>,
    /// so <c>precisePosition</c>/<c>ControlPath</c> are stock reads under either
    /// backend): NO RA reflection is needed for those. The one RA-specific
    /// enrichment here is the per-hop <c>Extensions["realantennas"]</c> bag (band,
    /// tech level, modulation, reverse rate, ...), read via
    /// <see cref="RaReflection"/> off the live RACommLink. The FORWARD band rate is
    /// no longer set on the hop: it rides this Uplink's own
    /// <c>realantennas.hopRates</c> channel instead, keyed by the same
    /// <see cref="NodeId"/>s these hops carry.
    ///
    /// <para>Main-thread only (live KSP reads), called from the RA uplink's
    /// capture-on-main sampler.</para>
    /// </summary>
    public sealed class RaCommsBackend : CommsBackendBase
    {
        public const string Id = "realantennas";

        private readonly RaReflection _ra;
        private readonly Kernel? _kernel;

        /// <param name="kernel">
        /// Core's capability registry, for the <c>activeVessel</c> resolution
        /// described on <see cref="ScopedVessel"/>. Optional, and null resolves
        /// no vessel at all: this backend then reports a link it could not see,
        /// which is the honest degradation, rather than the wrong craft's.
        /// </param>
        public RaCommsBackend(RaReflection ra, Kernel? kernel = null)
        {
            _ra = ra;
            _kernel = kernel;
        }

        public override string ProviderId => Id;

        /// <summary>
        /// The craft this backend answers for, from core's <c>activeVessel</c>
        /// capability rather than from KSP.
        ///
        /// <para>KSP's answer during an EVA is the kerbal, whose
        /// <c>connection</c> is the suit's: no antenna, a control path that is
        /// not the ship's, and a signal strength that has nothing to do with the
        /// craft the operator is watching. Queried per call, as
        /// <see cref="IActiveVessel"/> requires: the answer changes on a vessel
        /// switch, a dock, an undock, and on both ends of an EVA.</para>
        /// </summary>
        private Vessel? ScopedVessel() => _kernel.ReportedVessel() as Vessel;

        private CommNetVessel? Connection() => ScopedVessel()?.connection;

        // ── What CommsBackendBase cannot read for itself ────────────────────

        /// <summary>
        /// The craft this backend answers for. Same question the stock backend
        /// answers, reached by a different route: core's <c>activeVessel</c>
        /// capability through the kernel, since an Uplink has no
        /// <c>ActiveVesselScope</c> to read. Both resolve to
        /// <c>KspActiveVessel</c>, so they agree.
        /// </summary>
        protected override CommsSubject Subject()
        {
            var vessel = ScopedVessel();
            return vessel == null
                ? CommsSubject.None
                : new CommsSubject(vessel.id.ToString(), vessel.loaded);
        }

        /// <summary>
        /// The three live readings off the link.
        ///
        /// <para>All three are STOCK reads even here, and deliberately so:
        /// <c>RACommNetVessel</c> sets <c>IsConnected</c> from RA's own gates
        /// (canComm, an explicit electric-charge <c>powered</c> flag, occlusion,
        /// and a positive data rate BOTH ways) and <c>FindClosestWhere</c>'s
        /// <c>minRelayTL</c>, and it overrides neither <c>GetControlLevel</c> nor
        /// <c>UpdateControlState</c>. So the DETERMINATION differs wildly and the
        /// reported value is the same stock accessor, which is exactly the case
        /// for reading it through the shared half rather than reimplementing
        /// it.</para>
        ///
        /// <para>The strength is the one reading that means something different
        /// here (RA fills it with a rate-ladder headroom fraction, stock with a
        /// range fraction). That is a defect in the wire field rather than in
        /// this read, and it is carried through unchanged rather than papered
        /// over: see <see cref="CommsLinkState.SignalStrength"/>.</para>
        /// </summary>
        protected override CommsLinkState? LinkState()
        {
            var conn = Connection();
            if (conn == null)
            {
                return null;
            }
            return new CommsLinkState(conn.IsConnected, GradeOf(conn.GetControlLevel()), conn.SignalStrength);
        }

        /// <summary>
        /// The control path as KSP-free link views. Stock reads throughout,
        /// because <c>RACommLink : CommNet.CommLink</c> and
        /// <c>RACommNode : CommNet.CommNode</c>: the objects RA solves over ARE
        /// stock's, so <c>ControlPath</c> and <c>precisePosition</c> need no RA
        /// reflection at all.
        /// </summary>
        protected override IReadOnlyList<CommsLinkView>? ControlPath()
        {
            var path = Connection()?.ControlPath;
            if (path == null)
            {
                return null;
            }

            var links = new List<CommsLinkView>();
            foreach (var link in path)
            {
                if (link?.a == null || link.b == null)
                {
                    continue;
                }
                links.Add(new CommsLinkView(View(link.a), View(link.b), link));
            }
            return links;
        }

        /// <summary>
        /// The one genuinely RA-specific thing on a hop: the per-hop extras
        /// (band, tech level, modulation, encoder, required Eb/N0, beamwidth, EC
        /// draw, reverse rate) under this provider's own namespace, typed
        /// client-side by <c>RealAntennasHopExt</c>. The FORWARD band rate is
        /// deliberately absent: it rides this Uplink's own
        /// <c>realantennas.hopRates</c> channel, keyed by the same
        /// <see cref="NodeId"/>s these hops carry.
        ///
        /// <para>Read back off <see cref="CommsLinkView.Handle"/>, which is
        /// what that handle is for: a link-level fact has no home on either
        /// node, so the view carries the link itself. Main-thread only, on the
        /// capture that produced the view.</para>
        /// </summary>
        protected override Dictionary<string, object?>? HopExtensions(CommsLinkView link)
            => link.Handle is CommLink raLink ? RaHopExtensions.ForHop(_ra, raLink) : null;

        /// <summary>
        /// Stock's <c>Vessel.ControlLevel</c> in the contract's vocabulary; the
        /// collapse to the three states the wire carries happens once, in
        /// <see cref="CommsBackendBase"/>.
        /// </summary>
        private static CommsControlGrade GradeOf(Vessel.ControlLevel level) => level switch
        {
            Vessel.ControlLevel.FULL => CommsControlGrade.Full,
            Vessel.ControlLevel.PARTIAL_MANNED => CommsControlGrade.PartialManned,
            Vessel.ControlLevel.PARTIAL_UNMANNED => CommsControlGrade.PartialUnmanned,
            _ => CommsControlGrade.None,
        };

        /// <summary>One node as the base's view of it, positions converted into the contract's own vector.</summary>
        private static CommsNodeView View(CommNode node)
        {
            var p = node.precisePosition;
            return new CommsNodeView(
                node,
                NodeId(node),
                NodeDisplayName(node),
                node.isHome,
                node.isControlSource,
                new Sitrep.Contract.Vector3d(p.x, p.y, p.z));
        }

        /// <summary>
        /// RA's own route between two nodes (see <see cref="RaRouting"/> for why
        /// that is a different question from stock's, and what it costs to get
        /// wrong).
        /// </summary>
        public override IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to)
            => RaRouting.Between(from, to);

        /// <summary>
        /// RA's own reach rule between two nodes (see <see cref="RaReach"/> for
        /// why stock's rule silently reports zero reach for every craft on an RA
        /// install, which is what asking the seam instead of core fixes).
        /// </summary>
        public override ICommsReachModel ReachModel(object? from, object? to)
            => RaReach.Between(_ra, from, to);

        /// <summary>
        /// RA's occlusion geometry: the bare body radius, no multiplier (see
        /// <see cref="RaOcclusion"/>). Nothing live to read, unlike the stock
        /// backend whose multipliers are a per-save difficulty setting, so this
        /// is a constant.
        /// </summary>
        public override ICommsOcclusionModel OcclusionModel() => RaOcclusion.Model;

        /// <summary>
        /// A node's UNIQUE join key, matching CommNetBackend.NodeId (that
        /// backend's own doc comment carries the full rationale): the owning
        /// vessel's persistent id for a vessel node, since two craft can share
        /// a name and merging them into one node loses a link; the station's
        /// own name for a ground station, which RSS/RA fly a dozen of and which
        /// must stay distinguishable.
        ///
        /// <para>Internal rather than private so this Uplink's
        /// <c>realantennas.hopRates</c> capture keys its per-hop entries by
        /// exactly this derivation, which is what guarantees the client can join
        /// a rate onto the route <c>comms.path</c> already published.</para>
        /// </summary>
        internal static string NodeId(CommNode node)
        {
            if (node == null) return "unknown";
            var vessel = ResolveOwningVessel(node);
            if (vessel != null) return vessel.id.ToString();
            if (!string.IsNullOrEmpty(node.displayName)) return node.displayName;
            if (!string.IsNullOrEmpty(node.name)) return node.name;
            return node.isHome ? "home" : "node";
        }

        /// <summary>The human label, independent of the (now unique) id.</summary>
        private static string NodeDisplayName(CommNode node)
        {
            if (node == null) return "unknown";
            if (!string.IsNullOrEmpty(node.displayName)) return node.displayName;
            if (!string.IsNullOrEmpty(node.name)) return node.name;
            return node.isHome ? "home" : "node";
        }

        /// <summary>
        /// The vessel owning <paramref name="node"/>, recovered by
        /// reference-comparing against every known vessel's own CommNet node:
        /// stock <see cref="CommNode"/> has no vessel back-reference.
        /// </summary>
        private static Vessel? ResolveOwningVessel(CommNode node)
        {
            var vessels = FlightGlobals.Vessels;
            if (vessels == null) return null;
            foreach (var candidate in vessels)
            {
                var conn = candidate?.connection;
                if (conn != null && ReferenceEquals(conn.Comm, node))
                {
                    return candidate;
                }
            }
            return null;
        }

    }
}
