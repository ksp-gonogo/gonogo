using System;
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

        /// <summary>
        /// The active vessel's stock CommNet connection, or null when there is
        /// no LIVE comms to read — no vessel, not in flight, OR the active vessel
        /// is transiently UNLOADED (scene load/settle). An unloaded vessel has no
        /// valid CommNet control graph: its <c>connection</c>/<c>ControlPath</c>/
        /// <see cref="CommNet.CommNode"/> getters can dereference torn-down state
        /// and throw an NRE deep inside stock code (the "Vessel … has been
        /// unloaded" transient). Gating on <c>vessel.loaded</c> here — plus the
        /// per-method try/catch below — makes the whole read path NULL-SAFE:
        /// a settling/no-control-path vessel yields a graceful "disconnected /
        /// no delay" result, which is ALSO the correct real-world meaning (no
        /// live link ⇒ no hop geometry ⇒ no computable delay), never an exception
        /// that would trip the engine's fail-soft and kill comms for the session.
        /// </summary>
        private static CommNetVessel? Connection()
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null || !vessel.loaded)
            {
                return null;
            }
            return vessel.connection;
        }

        public CommsConnectivity Connectivity()
        {
            var meta = Meta();
            var disconnected = new CommsConnectivity
            {
                Connected = false,
                ControlSource = CommsControlSource.None,
                HasLocalControl = false,
                Meta = meta,
            };
            try
            {
                var conn = Connection();
                if (conn == null)
                {
                    return disconnected;
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
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] CommNetBackend.Connectivity read failed (treating as disconnected): " + ex.Message);
                return disconnected;
            }
        }

        public CommsSignalStrength SignalStrength()
        {
            try
            {
                var conn = Connection();
                return new CommsSignalStrength
                {
                    Value = conn?.SignalStrength ?? 0.0,
                    Meta = Meta(),
                };
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] CommNetBackend.SignalStrength read failed (treating as zero): " + ex.Message);
                return new CommsSignalStrength { Value = 0.0, Meta = Meta() };
            }
        }

        public CommsControlState ControlState()
        {
            try
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
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] CommNetBackend.ControlState read failed (treating as no control): " + ex.Message);
                return new CommsControlState { State = CommsControlStateKind.None, Meta = Meta() };
            }
        }

        public CommsPath Path()
        {
            var hops = new List<CommsHop>();
            try
            {
                var conn = Connection();
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
            }
            catch (Exception ex)
            {
                // A torn-down node/path mid-enumeration ⇒ surface whatever hops
                // were read cleanly (typically none) as an empty/partial path.
                // Empty path ⇒ SignalDelay.None ⇒ no delay authority, the correct
                // graceful meaning for a vessel with no live control path.
                Debug.LogWarning("[Gonogo] CommNetBackend.Path read failed (treating as no path): " + ex.Message);
                hops.Clear();
            }
            return new CommsPath { Hops = hops, Meta = Meta() };
        }

        public CommsNetwork Network()
        {
            // Bare CommNet does not cheaply enumerate the whole relay graph;
            // per §1 ("backend-dependent detail") we surface the control-path
            // nodes/edges as the minimal graph. RA overrides with a richer one.
            var nodes = new List<CommsNetworkNode>();
            var edges = new List<CommsNetworkEdge>();
            var seen = new HashSet<string>();
            try
            {
                var conn = Connection();
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
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] CommNetBackend.Network read failed (treating as empty graph): " + ex.Message);
                nodes.Clear();
                edges.Clear();
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
