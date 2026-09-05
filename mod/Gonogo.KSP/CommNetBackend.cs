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
    public sealed class CommNetBackend : CommsBackendBase
    {
        public const string Id = "commnet";

        public override string ProviderId => Id;

        /// <summary>
        /// The active vessel's stock CommNet connection, or null when there is
        /// no LIVE comms to read, no vessel, not in flight, OR the active vessel
        /// is transiently UNLOADED (scene load/settle). An unloaded vessel has no
        /// valid CommNet control graph: its <c>connection</c>/<c>ControlPath</c>/
        /// <see cref="CommNet.CommNode"/> getters can dereference torn-down state
        /// and throw an NRE deep inside stock code (the "Vessel ... has been
        /// unloaded" transient).
        ///
        /// <para>This gate is a GUARD, not a swallow, and that distinction is
        /// the whole of it. Declining to touch a torn graph yields a graceful
        /// "disconnected / no delay" result, which is ALSO the correct
        /// real-world meaning: no live link, no hop geometry, no computable
        /// delay. What used to sit behind it was a per-method try/catch that
        /// turned a read which DID throw into the same authoritative
        /// <c>connected:false</c>, and that is a freeze lever rather than a
        /// reading: see <see cref="CommsBackendBase"/>'s error contract, which
        /// this backend now inherits, and which lets a throw propagate to the
        /// engine's own fail-soft instead.</para>
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

        // ── What CommsBackendBase cannot read for itself ────────────────────

        /// <summary>
        /// The craft this backend answers for, from
        /// <see cref="ActiveVesselScope.Current"/> rather than from
        /// <c>FlightGlobals.ActiveVessel</c>: during an EVA KSP's own answer is
        /// the kerbal, whose connection is the suit's.
        /// </summary>
        protected override CommsSubject Subject()
        {
            var vessel = ActiveVesselScope.Current;
            return vessel == null
                ? CommsSubject.None
                : new CommsSubject(vessel.id.ToString(), vessel.loaded);
        }

        /// <summary>
        /// Stock's three live readings off the link, or null when there is no
        /// live comms graph to touch (see <see cref="Connection"/>).
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
        /// Stock's <c>ControlPath</c> as KSP-free link views.
        ///
        /// <para>A link with a torn-down endpoint is SKIPPED rather than
        /// contributing a degenerate view. That is the same rule
        /// <see cref="RouteHops"/> applies and for the same reason: a zero
        /// -length hop would shorten the route rather than fail it, and a view
        /// built from a null node would carry an empty id that de-duplicates
        /// against every other broken node in the graph.</para>
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
        /// One node as the base's view of it. The position converts from KSP's
        /// <c>Vector3d</c> to the contract's, which is what keeps the shared hop
        /// arithmetic compilable with no KSP reference assemblies; both ends of
        /// a link come from <c>precisePosition</c>, so they share a frame and
        /// the difference is meaningful.
        /// </summary>
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
        /// Stock's <c>Vessel.ControlLevel</c> in the contract's vocabulary. The
        /// only mapping this backend owns: the collapse to the three states the
        /// wire carries happens once, in <see cref="CommsBackendBase"/>.
        /// </summary>
        private static CommsControlGrade GradeOf(Vessel.ControlLevel level)
        {
            switch (level)
            {
                case Vessel.ControlLevel.FULL:
                    return CommsControlGrade.Full;
                case Vessel.ControlLevel.PARTIAL_MANNED:
                    return CommsControlGrade.PartialManned;
                case Vessel.ControlLevel.PARTIAL_UNMANNED:
                    return CommsControlGrade.PartialUnmanned;
                default:
                    return CommsControlGrade.None;
            }
        }

        /// <summary>
        /// Stock's own route between two nodes: <c>CommNetwork.FindPath</c>,
        /// which is where bare CommNet's router actually lives. It runs
        /// stock's Dijkstra (<c>CreateShortestPathTree</c>, maximising a product
        /// of per-link signal strength) from <paramref name="from"/> over the
        /// whole node list and walks back from <paramref name="to"/>, so it is
        /// not vessel-rooted and needs no special casing for a ground-station
        /// start.
        ///
        /// <para>Correct HERE and nowhere else. Under this backend stock's rules
        /// ARE the rules, so calling stock's router is not an assumption; under
        /// a network-replacing backend it is a different answer from the one the
        /// game is using, which is why routing is asked of the elected backend
        /// rather than solved by core (see <see cref="ICommsBackend.RouteBetween"/>).</para>
        ///
        /// <para>Stock's <c>FindPath</c> opens with <c>if (isDirty) Rebuild()</c>,
        /// so a telemetry read can drive a network rebuild. Accepted here, where
        /// it rebuilds stock's own graph; it is one more reason a
        /// network-replacing backend should not be routed through this method,
        /// since there the same line re-enters that mod's update chain mid-frame.</para>
        ///
        /// <para>Fail-soft: a torn-down node mid-solve yields null, the correct
        /// "no route" meaning, rather than an exception that would take comms
        /// down for the session.</para>
        /// </summary>
        public override IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to)
        {
            try
            {
                if (from is not CommNode start || to is not CommNode end || ReferenceEquals(start, end))
                {
                    return null;
                }

                var net = start.Net;
                if (net == null)
                {
                    return null;
                }

                var path = new CommPath();
                return net.FindPath(start, path, end) ? RouteHops(path) : null;
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] CommNetBackend.RouteBetween failed (treating as no route): " + ex.Message);
                return null;
            }
        }

        /// <summary>
        /// A solved path's links as measured hops. Links with a torn-down
        /// endpoint are skipped rather than contributing a zero-length hop,
        /// which would shorten the route rather than fail it.
        /// </summary>
        private static List<CommsRouteHop> RouteHops(CommPath path)
        {
            var hops = new List<CommsRouteHop>();
            foreach (var link in path)
            {
                if (link?.a == null || link.b == null)
                {
                    continue;
                }
                hops.Add(new CommsRouteHop(
                    (link.a.precisePosition - link.b.precisePosition).magnitude,
                    link.b.isHome || link.a.isHome));
            }
            return hops;
        }

        /// <summary>
        /// Stock's reach rule for a pair of nodes, from the LIVE range model and
        /// the two nodes' own antenna powers (see <see cref="CommNetReach"/> for
        /// the rule and where it was read from).
        ///
        /// <para><c>CommNetScenario.RangeModel</c> is asked rather than
        /// re-derived: stock ships more than one and a career can be running
        /// either, so this reports the rule in force instead of a guess at
        /// it.</para>
        ///
        /// <para>Fail-soft to <see cref="CommsReachModels.Unknown"/>, whose
        /// maximum is ABSENT, for a handle that is not a stock node, a range
        /// model the scenario has not stood up yet (main menu), or a read that
        /// threw on torn-down state. Absent, not zero: a zero would assert that
        /// nothing reaches and darken every prediction on the strength of a
        /// failed read, where absent leaves the consumer predicting exactly what
        /// it could before.</para>
        /// </summary>
        public override ICommsReachModel ReachModel(object? from, object? to)
        {
            try
            {
                if (from is not CommNode start || to is not CommNode end)
                {
                    return CommsReachModels.Unknown;
                }

                var rangeModel = CommNetScenario.RangeModel;
                if (rangeModel == null)
                {
                    return CommsReachModels.Unknown;
                }

                return CommNetReach.Model(
                    start.antennaRelay?.power ?? 0.0,
                    start.antennaTransmit?.power ?? 0.0,
                    end.antennaRelay?.power ?? 0.0,
                    end.antennaTransmit?.power ?? 0.0,
                    start.distanceOffset + end.distanceOffset,
                    rangeModel.GetMaximumRange);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] CommNetBackend.ReachModel failed (declaring no reach rule): " + ex.Message);
                return CommsReachModels.Unknown;
            }
        }

        /// <summary>
        /// Stock's own grading of the live link (see <see cref="CommNetDegrade"/>
        /// for the rule and for why it is not shared with the RealAntennas
        /// backend that computes the same expression over a different quantity).
        /// A tick with no readable link is UNRATED rather than rated unusable.
        /// </summary>
        public override ICommsDegradeModel DegradeModel() => CommNetDegrade.From(LinkState());

        /// <summary>
        /// Stock's occlusion geometry, built from the LIVE difficulty settings
        /// (see <see cref="CommNetOcclusion"/> for the rule itself). The two
        /// multipliers are per-save and player-settable, so they are read here
        /// rather than baked in; a game that hasn't loaded its parameters yet
        /// (main menu) falls back to the stock defaults instead of throwing,
        /// which is also what the game would apply.
        /// </summary>
        public override ICommsOcclusionModel OcclusionModel()
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

    }
}
