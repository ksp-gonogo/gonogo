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
    public sealed class RaCommsBackend : ICommsBackend
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

        public string ProviderId => Id;

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

        public CommsConnectivity Connectivity()
        {
            var conn = Connection();
            var meta = Meta();
            if (conn == null)
            {
                return new CommsConnectivity { ControlSource = CommsControlSource.None, Meta = meta };
            }
            var level = conn.GetControlLevel();
            return new CommsConnectivity
            {
                Connected = conn.IsConnected,
                ControlSource = MapSource(level),
                HasLocalControl = level == Vessel.ControlLevel.PARTIAL_MANNED || level == Vessel.ControlLevel.FULL,
                Meta = meta,
            };
        }

        public CommsSignalStrength SignalStrength()
            => new CommsSignalStrength { Value = Connection()?.SignalStrength ?? 0.0, Meta = Meta() };

        public CommsControlState ControlState()
        {
            var conn = Connection();
            if (conn == null)
            {
                return new CommsControlState { State = CommsControlStateKind.None, Meta = Meta() };
            }
            return new CommsControlState
            {
                State = MapStateKind(conn.GetControlLevel()),
                Reason = conn.IsConnected ? null : "no connection to a command source",
                Meta = Meta(),
            };
        }

        public CommsPath Path()
        {
            var conn = Connection();
            var hops = new List<CommsHop>();
            var path = conn?.ControlPath;
            if (path != null)
            {
                foreach (var link in path)
                {
                    if (link?.a == null || link.b == null)
                    {
                        continue;
                    }
                    hops.Add(new CommsHop
                    {
                        From = NodeId(link.a),
                        To = NodeId(link.b),
                        FromIsHome = link.a.isHome,
                        ToIsHome = link.b.isHome,
                        Kind = link.b.isHome || link.a.isHome ? CommsHopKind.Home : CommsHopKind.Relay,
                        DistanceMeters = (link.a.precisePosition - link.b.precisePosition).magnitude,
                        // The RA-only per-hop extras (band, tech level, modulation,
                        // encoder, required Eb/N0, beamwidth, EC draw, reverse rate)
                        // ride the provider extension bag under "realantennas",
                        // typed client-side by RealAntennasHopExt. Null under bare
                        // CommNet, where this backend is not even elected.
                        Extensions = RaHopExtensions.ForHop(_ra, link),
                    });
                }
            }
            return new CommsPath { Hops = hops, Meta = Meta() };
        }

        public CommsNetwork Network()
        {
            var conn = Connection();
            var nodes = new List<CommsNetworkNode>();
            var edges = new List<CommsNetworkEdge>();
            var seen = new HashSet<string>();
            var path = conn?.ControlPath;
            if (path != null)
            {
                foreach (var link in path)
                {
                    if (link?.a == null || link.b == null)
                    {
                        continue;
                    }
                    AddNode(nodes, seen, link.a);
                    AddNode(nodes, seen, link.b);
                    edges.Add(new CommsNetworkEdge { A = NodeId(link.a), B = NodeId(link.b), Active = true });
                }
            }
            return new CommsNetwork { Nodes = nodes, Edges = edges, Meta = Meta() };
        }

        /// <summary>
        /// RA's occlusion geometry: the bare body radius, no multiplier (see
        /// <see cref="RaOcclusion"/>). Nothing live to read, unlike the stock
        /// backend whose multipliers are a per-save difficulty setting, so this
        /// is a constant.
        /// </summary>
        public ICommsOcclusionModel OcclusionModel() => RaOcclusion.Model;

        private static void AddNode(List<CommsNetworkNode> nodes, HashSet<string> seen, CommNode node)
        {
            var id = NodeId(node);
            if (seen.Add(id))
            {
                nodes.Add(new CommsNetworkNode
                {
                    Id = id,
                    DisplayName = NodeDisplayName(node),
                    Kind = node.isHome ? CommsHopKind.Home : CommsHopKind.Relay,
                });
            }
        }

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

        private static CommsControlSource MapSource(Vessel.ControlLevel level) => level switch
        {
            Vessel.ControlLevel.FULL => CommsControlSource.Full,
            Vessel.ControlLevel.PARTIAL_MANNED => CommsControlSource.Partial,
            Vessel.ControlLevel.PARTIAL_UNMANNED => CommsControlSource.Partial,
            _ => CommsControlSource.None,
        };

        private static CommsControlStateKind MapStateKind(Vessel.ControlLevel level) => level switch
        {
            Vessel.ControlLevel.FULL => CommsControlStateKind.Full,
            Vessel.ControlLevel.PARTIAL_MANNED => CommsControlStateKind.PartialManoeuvre,
            Vessel.ControlLevel.PARTIAL_UNMANNED => CommsControlStateKind.PartialManoeuvre,
            _ => CommsControlStateKind.None,
        };

        private PayloadMeta Meta()
        {
            var vessel = ScopedVessel();
            return new PayloadMeta
            {
                Source = vessel != null ? "vessel:" + vessel.id : "game",
                Quality = vessel != null && vessel.loaded ? Quality.Loaded : Quality.OnRails,
            };
        }
    }
}
