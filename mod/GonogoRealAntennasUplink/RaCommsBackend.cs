using System.Collections.Generic;
using CommNet;
using Sitrep.Contract;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// The RealAntennas <see cref="ICommsBackend"/> — the higher-priority
    /// backend elected for the exclusive <c>"comms"</c> capability when RA is
    /// loaded (comms-uplink-design.md §2.2). Connectivity/strength/control-state
    /// and hop GEOMETRY come from the SAME stock CommNet graph CommNet uses
    /// (§4.3: <c>RACommLink : CommNet.CommLink</c>, <c>RACommNode : CommNet.CommNode</c>,
    /// so <c>precisePosition</c>/<c>ControlPath</c> are stock reads under either
    /// backend) — NO RA reflection is needed for those. The one RA-specific
    /// enrichment here is per-hop <c>BandRateBitsPerSec</c>, read via
    /// <see cref="RaReflection"/> off the live RACommLink (typed absence when
    /// unreadable, never 0).
    ///
    /// <para>Main-thread only (live KSP reads) — called from the RA uplink's
    /// capture-on-main sampler.</para>
    /// </summary>
    public sealed class RaCommsBackend : ICommsBackend
    {
        public const string Id = "realantennas";

        private readonly RaReflection _ra;

        public RaCommsBackend(RaReflection ra) => _ra = ra;

        public string BackendId => Id;

        private static CommNetVessel? Connection() => FlightGlobals.ActiveVessel?.connection;

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
                        Kind = link.b.isHome || link.a.isHome ? CommsHopKind.Home : CommsHopKind.Relay,
                        DistanceMeters = (link.a.precisePosition - link.b.precisePosition).magnitude,
                        // RA enrichment: per-hop forward data rate off the live
                        // RACommLink (§1 "path hops gain RA band/rate annotations").
                        BandRateBitsPerSec = _ra.ForwardDataRate(link),
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

        private static void AddNode(List<CommsNetworkNode> nodes, HashSet<string> seen, CommNode node)
        {
            var id = NodeId(node);
            if (seen.Add(id))
            {
                nodes.Add(new CommsNetworkNode { Id = id, Kind = node.isHome ? CommsHopKind.Home : CommsHopKind.Relay });
            }
        }

        private static string NodeId(CommNode node)
        {
            if (node == null) return "unknown";
            if (node.isHome) return "home";
            return string.IsNullOrEmpty(node.displayName) ? node.name ?? "node" : node.displayName;
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

        private static PayloadMeta Meta()
        {
            var vessel = FlightGlobals.ActiveVessel;
            return new PayloadMeta
            {
                Source = vessel != null ? "vessel:" + vessel.id : "game",
                Quality = vessel != null && vessel.loaded ? Quality.Loaded : Quality.OnRails,
            };
        }
    }
}
