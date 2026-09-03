using System;
using System.Collections.Generic;
using CommNet;
using Gonogo.KSP.CommandCentres;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The stock-CommNet <see cref="ICommsBackend"/>: the always-present
    /// vanilla backend the exclusive <c>"comms"</c> capability falls back to
    /// (comms-uplink-design.md §2.2). Reads the SAME stock object graph
    /// (<c>Vessel.connection</c> / <see cref="CommNet.CommPath"/> /
    /// <see cref="CommNet.CommNode"/>) that RealAntennas layers onto: so
    /// connectivity/strength/control-state and hop geometry come from stock
    /// members regardless of which backend won the election (§4.3).
    ///
    /// <para><b>THREADING:</b> every accessor here reads live KSP state, so it
    /// MUST be called only on the Unity main thread, the comms core
    /// registration calls it exclusively from its capture-on-main sampler
    /// (<see cref="CommsCoreUplink"/>). It is a stateless view over
    /// <see cref="ActiveVesselScope.Current"/>, not a cached snapshot.</para>
    /// </summary>
    public sealed class CommNetBackend : ICommsBackend
    {
        public const string Id = "commnet";

        public string ProviderId => Id;

        /// <summary>
        /// The active vessel's stock CommNet connection, or null when there is
        /// no LIVE comms to read, no vessel, not in flight, OR the active vessel
        /// is transiently UNLOADED (scene load/settle). An unloaded vessel has no
        /// valid CommNet control graph: its <c>connection</c>/<c>ControlPath</c>/
        /// <see cref="CommNet.CommNode"/> getters can dereference torn-down state
        /// and throw an NRE deep inside stock code (the "Vessel ... has been
        /// unloaded" transient). Gating on <c>vessel.loaded</c> here (plus the
        /// per-method try/catch below) makes the whole read path NULL-SAFE:
        /// a settling/no-control-path vessel yields a graceful "disconnected /
        /// no delay" result, which is ALSO the correct real-world meaning (no
        /// live link ⇒ no hop geometry ⇒ no computable delay), never an exception
        /// that would trip the engine's fail-soft and kill comms for the session.
        /// </summary>
        private static CommNetVessel? Connection()
        {
            var vessel = ActiveVesselScope.Current;
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
                            FromIsHome = link.a.isHome,
                            ToIsHome = link.b.isHome,
                            Kind = link.b.isHome || link.a.isHome ? CommsHopKind.Home : CommsHopKind.Relay,
                            DistanceMeters = (link.a.precisePosition - link.b.precisePosition).magnitude,
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

        /// <summary>
        /// Stock's occlusion geometry, built from the LIVE difficulty settings
        /// (see <see cref="CommNetOcclusion"/> for the rule itself). The two
        /// multipliers are per-save and player-settable, so they are read here
        /// rather than baked in; a game that hasn't loaded its parameters yet
        /// (main menu) falls back to the stock defaults instead of throwing,
        /// which is also what the game would apply.
        /// </summary>
        public ICommsOcclusionModel OcclusionModel()
        {
            try
            {
                var parameters = HighLogic.CurrentGame?.Parameters?.CustomParams<CommNetParams>();
                if (parameters == null)
                {
                    return CommNetOcclusion.StockDefaults();
                }
                return CommNetOcclusion.Model(parameters.occlusionMultiplierVac, parameters.occlusionMultiplierAtm);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] CommNetBackend.OcclusionModel read failed (using stock defaults): " + ex.Message);
                return CommNetOcclusion.StockDefaults();
            }
        }

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
        /// A node's UNIQUE join key, the same id space
        /// <see cref="CommsHop.From"/>/<see cref="CommsHop.To"/> use. A vessel
        /// node resolves to its owning vessel's persistent id: two craft can
        /// share a player-chosen name, which made the display name unsafe as a
        /// graph or roster key and silently merged them into one node. A ground
        /// station keeps its own name, which is already unique per station and
        /// is what stops a handoff between two stations reading as one station
        /// at a changed range (see <see cref="CommsHop"/>); home-ness rides
        /// <c>FromIsHome</c>/<c>ToIsHome</c> and
        /// <see cref="CommsNetworkNode.Kind"/> rather than the id, so no
        /// consumer needs the literal "home". That literal survives only as the
        /// last fallback for a station with no name at all.
        /// <see cref="NodeDisplayName"/> carries the label.
        /// </summary>
        private static string NodeId(CommNode node)
        {
            if (node == null)
            {
                return "unknown";
            }
            var vessel = ResolveOwningVessel(node);
            if (vessel != null)
            {
                return vessel.id.ToString();
            }
            if (!string.IsNullOrEmpty(node.displayName))
            {
                return node.displayName;
            }
            if (!string.IsNullOrEmpty(node.name))
            {
                return node.name;
            }
            return node.isHome ? "home" : "node";
        }

        /// <summary>The human label for <paramref name="node"/>, independent of
        /// its (now unique) <see cref="NodeId"/>.</summary>
        private static string NodeDisplayName(CommNode node)
        {
            if (node == null)
            {
                return "unknown";
            }
            if (!string.IsNullOrEmpty(node.displayName))
            {
                return node.displayName;
            }
            if (!string.IsNullOrEmpty(node.name))
            {
                return node.name;
            }
            return node.isHome ? "home" : "node";
        }

        /// <summary>
        /// The <see cref="Vessel"/> that owns <paramref name="node"/>, found by
        /// reference-comparing it against every known vessel's own CommNet node
        /// (<c>Vessel.connection.Comm</c>): stock <see cref="CommNode"/> carries
        /// no back-reference to its owning vessel, so this is the only way to
        /// recover it. Null for a non-vessel node (a ground station) or one
        /// whose owning vessel has no live connection this tick.
        /// </summary>
        private static Vessel? ResolveOwningVessel(CommNode node)
        {
            var vessels = FlightGlobals.Vessels;
            if (vessels == null)
            {
                return null;
            }
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

        /// <summary>
        /// Identifies which command centre the active vessel's <c>ControlPath</c>
        /// currently terminates at. Stock
        /// <c>CreateControlConnection</c> tries a route home first and only falls
        /// back to the nearest crewed control source when no home is reachable
        /// (agent-2's command-centre-sources research), so the terminal node of
        /// an already-resolved <c>ControlPath</c> is exactly "the centre this
        /// stats readout is relative to": no separate routing decision needed
        /// here, only IDENTIFYING the node stock already picked. Matched by
        /// reference against the SAME live centres <c>commandCentre.roster</c>
        /// enumerates, so the two can never name the terminus differently. Not
        /// part of <see cref="ICommsBackend"/>: a RealAntennas backend has no
        /// obligation to implement this yet, so <see cref="CommsCoreUplink"/>
        /// downcasts and a backend that cannot answer yields "unknown".
        /// </summary>
        public CommsCommandCentre CommandCentre(CommandCentreRegistry? registry)
        {
            try
            {
                if (registry == null)
                {
                    return new CommsCommandCentre { Meta = Meta() };
                }

                var conn = Connection();
                var terminal = TerminalNode(conn?.ControlPath?.Last);
                if (terminal == null)
                {
                    return new CommsCommandCentre { Meta = Meta() };
                }

                foreach (var centre in registry.EnumerateActive())
                {
                    if (centre is KspCommandCentre ksp && ReferenceEquals(ksp.Node, terminal))
                    {
                        return new CommsCommandCentre
                        {
                            Id = ksp.Id,
                            DisplayName = ksp.DisplayName,
                            Kind = ksp.Kind.ToString(),
                            BodyIndex = ksp.BodyIndex,
                            Meta = Meta(),
                        };
                    }
                }

                return new CommsCommandCentre { Meta = Meta() };
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] CommNetBackend.CommandCentre read failed (treating as unknown): " + ex.Message);
                return new CommsCommandCentre { Meta = Meta() };
            }
        }

        /// <summary>
        /// The remote end of the path's last hop: whichever side is flagged
        /// <c>isHome</c> (a ground station reached via <c>FindHome</c>) or, when
        /// neither end is home, <c>isControlSource</c> (a crewed vessel reached
        /// via the no-home <c>FindClosestControlSource</c> fallback). Home is
        /// checked first because stock always prefers it: a home-reachable path's
        /// last hop can, in principle, also touch a control-source relay.
        /// </summary>
        private static CommNode? TerminalNode(CommLink? last)
        {
            if (last == null)
            {
                return null;
            }
            if (last.a != null && last.a.isHome)
            {
                return last.a;
            }
            if (last.b != null && last.b.isHome)
            {
                return last.b;
            }
            if (last.a != null && last.a.isControlSource)
            {
                return last.a;
            }
            if (last.b != null && last.b.isControlSource)
            {
                return last.b;
            }
            return null;
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
            var vessel = ActiveVesselScope.Current;
            return new PayloadMeta
            {
                Source = vessel != null ? "vessel:" + vessel.id : "game",
                Quality = vessel != null && vessel.loaded ? Quality.Loaded : Quality.OnRails,
            };
        }
    }
}
