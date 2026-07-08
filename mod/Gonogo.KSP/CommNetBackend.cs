using System.Collections.Generic;
using CommNet;
using Sitrep.Contract;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The stock-CommNet <see cref="ICommsBackend"/> — the always-present
    /// vanilla backend the exclusive <c>"comms"</c> capability falls back to
    /// (comms-uplink-design.md §2.2). Reads the SAME stock object graph
    /// (<c>Vessel.connection</c> / <see cref="CommNet.CommPath"/> /
    /// <see cref="CommNet.CommNode"/>) that RealAntennas layers onto — so
    /// connectivity/strength/control-state and hop geometry come from stock
    /// members regardless of which backend won the election (§4.3).
    ///
    /// <para><b>THREADING:</b> every accessor here reads live KSP state, so it
    /// MUST be called only on the Unity main thread — the comms core
    /// registration calls it exclusively from its capture-on-main sampler
    /// (<see cref="CommsCoreUplink"/>). It is a stateless view over
    /// <c>FlightGlobals.ActiveVessel</c>, not a cached snapshot.</para>
    /// </summary>
    public sealed class CommNetBackend : ICommsBackend
    {
        public const string Id = "commnet";

        public string BackendId => Id;

        /// <summary>The active vessel's stock CommNet connection, or null (no vessel / not in flight).</summary>
        private static CommNetVessel? Connection()
        {
            return FlightGlobals.ActiveVessel?.connection;
        }

        public CommsConnectivity Connectivity()
        {
            var conn = Connection();
            var meta = Meta();
            if (conn == null)
            {
                return new CommsConnectivity
                {
                    Connected = false,
                    ControlSource = CommsControlSource.None,
                    HasLocalControl = false,
                    Meta = meta,
                };
            }

            var level = conn.GetControlLevel();
            return new CommsConnectivity
            {
                Connected = conn.IsConnected,
                ControlSource = MapControlSource(level),
                // A manned pod (or FULL) can be controlled without a link home.
                HasLocalControl = level == Vessel.ControlLevel.PARTIAL_MANNED
                                  || level == Vessel.ControlLevel.FULL,
                Meta = meta,
            };
        }

        public CommsSignalStrength SignalStrength()
        {
            var conn = Connection();
            return new CommsSignalStrength
            {
                Value = conn?.SignalStrength ?? 0.0,
                Meta = Meta(),
            };
        }

        public CommsControlState ControlState()
        {
            var conn = Connection();
            if (conn == null)
            {
                return new CommsControlState { State = CommsControlStateKind.None, Meta = Meta() };
            }

            var level = conn.GetControlLevel();
            return new CommsControlState
            {
                State = MapControlStateKind(level),
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
                        // CommNet has no per-hop RF rate — RA annotates this (§1).
                        BandRateBitsPerSec = null,
                    });
                }
            }
            return new CommsPath { Hops = hops, Meta = Meta() };
        }

        public CommsNetwork Network()
        {
            // Bare CommNet does not cheaply enumerate the whole relay graph;
            // per §1 ("backend-dependent detail") we surface the control-path
            // nodes/edges as the minimal graph. RA overrides with a richer one.
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
                nodes.Add(new CommsNetworkNode
                {
                    Id = id,
                    Kind = node.isHome ? CommsHopKind.Home : CommsHopKind.Relay,
                });
            }
        }

        private static string NodeId(CommNode node)
        {
            if (node == null)
            {
                return "unknown";
            }
            if (node.isHome)
            {
                return "home";
            }
            return string.IsNullOrEmpty(node.displayName) ? node.name ?? "node" : node.displayName;
        }

        private static CommsControlSource MapControlSource(Vessel.ControlLevel level)
        {
            switch (level)
            {
                case Vessel.ControlLevel.FULL:
                    return CommsControlSource.Full;
                case Vessel.ControlLevel.PARTIAL_MANNED:
                case Vessel.ControlLevel.PARTIAL_UNMANNED:
                    return CommsControlSource.Partial;
                default:
                    return CommsControlSource.None;
            }
        }

        private static CommsControlStateKind MapControlStateKind(Vessel.ControlLevel level)
        {
            switch (level)
            {
                case Vessel.ControlLevel.FULL:
                    return CommsControlStateKind.Full;
                case Vessel.ControlLevel.PARTIAL_MANNED:
                case Vessel.ControlLevel.PARTIAL_UNMANNED:
                    return CommsControlStateKind.PartialManoeuvre;
                default:
                    return CommsControlStateKind.None;
            }
        }

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
