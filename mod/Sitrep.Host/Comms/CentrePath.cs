using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation.Contacts;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What one command centre believes of the active craft's path right now:
    /// the <c>comms.path</c>, <c>comms.network</c> and
    /// <c>comms.commandCentre</c> payloads it is sent.
    /// </summary>
    public sealed class CentrePathView
    {
        public CentrePathView(CommsPath path, CommsNetwork network, CommsCommandCentre commandCentre)
        {
            Path = path;
            Network = network;
            CommandCentre = commandCentre;
        }

        public CommsPath Path { get; }

        public CommsNetwork Network { get; }

        public CommsCommandCentre CommandCentre { get; }

        /// <summary>
        /// Everything about the view but its hop lengths, which move every
        /// second with the craft: two views with the same shape name the same
        /// nodes in the same order and end at the same centre.
        /// </summary>
        public string Shape { get; set; } = "";

        /// <summary>What the whole path is worth, worked out from its hops, or null when it could not be.</summary>
        public double? Strength { get; set; }
    }

    /// <summary>
    /// Works out the active craft's path as one command centre believes it to
    /// stand, from that centre's own contact plan and nothing else.
    ///
    /// <para>The plan is made of what the centre has heard of each craft, so a
    /// hop far from the centre changes here only once the news of it has
    /// crossed to the centre. The game's own solved control path is not read:
    /// it is every hop's state at this instant, and a centre shown it would
    /// learn of a relay near home dropping out after only its own light-time
    /// to the craft.</para>
    ///
    /// <para>The home centre hears whatever any ground station hears, so it is
    /// shown the craft's path to whichever station its plan says the signal
    /// reaches first, as telemetry is delivered to it. Every other centre is
    /// shown the path to itself, and the centre that is the active craft the
    /// path from itself to the ground.</para>
    ///
    /// <para>Only a path that is open all the way now is a path. One that would
    /// have a signal wait at a node is shown as none, as a craft with no link
    /// home is; where it would wait is on <c>comms.route</c>.</para>
    /// </summary>
    public static class CentrePath
    {
        /// <param name="plan">The centre's own plan, or null when it has none.</param>
        /// <param name="activeCraft">The active craft's node id, or null when there is none.</param>
        /// <param name="centre">The centre the view is for.</param>
        /// <param name="isHome">Whether that centre is the home centre.</param>
        /// <param name="stations">Every ground station, as the plan names them.</param>
        /// <param name="nameOf">The name the centre last heard a craft go by, or null.</param>
        /// <param name="ut">Now.</param>
        /// <param name="lightFactor">What a real light time is multiplied by: see <see cref="DeliveryInputs.LightFactor"/>.</param>
        /// <param name="strengths">What the centre can work out about hop strengths, or null to state none.</param>
        public static CentrePathView For(
            ContactPlan? plan,
            string? activeCraft,
            string centre,
            bool isHome,
            IReadOnlyList<ContactGameNode> stations,
            Func<string, string?> nameOf,
            double ut,
            double lightFactor = 1.0,
            PathStrengths? strengths = null)
        {
            var source = activeCraft == null ? "game" : activeCraft;
            var none = new CentrePathView(
                new CommsPath(),
                new CommsNetwork { Meta = new PayloadMeta { Source = source } },
                new CommsCommandCentre())
            {
                Shape = source,
            };
            if (plan == null || activeCraft == null)
            {
                return none;
            }

            var ground = new Dictionary<string, ContactGameNode>(StringComparer.Ordinal);
            foreach (var station in stations)
            {
                ground[station.Id] = station;
            }
            var toGround = isHome || string.Equals(centre, activeCraft, StringComparison.Ordinal);
            var route = toGround
                ? ContactRouter.EarliestArrivalAtAny(plan, activeCraft, new List<string>(ground.Keys), ut, null, lightFactor)
                : ContactRouter.EarliestArrival(plan, activeCraft, centre, ut, null, lightFactor);
            if (route == null || !route.Live || route.Hops.Count == 0)
            {
                return none;
            }
            if (toGround && strengths != null)
            {
                route = StrongestOfTheEarliest(plan, activeCraft, ground.Keys, route, ut, lightFactor, strengths);
            }

            var hops = new List<CommsHop>(route.Hops.Count);
            var nodes = new List<CommsNetworkNode>(route.Hops.Count + 1) { Node(activeCraft, ground, nameOf) };
            var edges = new List<CommsNetworkEdge>(route.Hops.Count);
            var shape = new System.Text.StringBuilder(source);
            foreach (var hop in route.Hops)
            {
                var fromHome = ground.ContainsKey(hop.From);
                var toHome = ground.ContainsKey(hop.To);
                var from = WireId(hop.From, ground);
                var to = WireId(hop.To, ground);
                var facts = strengths?.FactsOf(hop.From, hop.To, ut, hop.DistanceMeters);
                hops.Add(new CommsHop
                {
                    From = from,
                    To = to,
                    FromIsHome = fromHome,
                    ToIsHome = toHome,
                    Kind = fromHome || toHome ? CommsHopKind.Home : CommsHopKind.Relay,
                    // Where the receiver will be when the light lands, which is the length the light crosses.
                    DistanceMeters = hop.DistanceMeters,
                    Strength = facts?.HopStrength,
                    Quantity = facts?.Quantity,
                    Extensions = facts?.Extensions,
                });
                nodes.Add(Node(hop.To, ground, nameOf));
                edges.Add(new CommsNetworkEdge { A = from, B = to, Active = true });
                shape.Append('\u0001').Append(to).Append('\u0001').Append(nodes[nodes.Count - 1].DisplayName);
            }

            return new CentrePathView(
                new CommsPath { Hops = hops },
                new CommsNetwork { Nodes = nodes, Edges = edges, Meta = new PayloadMeta { Source = source } },
                Terminus(route.Destination, ground, nameOf))
            {
                Shape = shape.ToString(),
                Strength = strengths?.Of(hops.ConvertAll(h => h.Strength)),
            };
        }

        /// <summary>
        /// Of the routes to each station that arrive no later than the plan
        /// can tell apart from the earliest, the one the backend holds
        /// strongest. Stations in sight of one craft differ by milliseconds
        /// of light, and a backend that routes for strength picks among them
        /// by strength, so this is the path the game itself is most likely
        /// on. A route with no strength to state loses to one with any, and
        /// with nothing to choose by the earliest stands.
        /// </summary>
        private static ContactRoute StrongestOfTheEarliest(
            ContactPlan plan,
            string activeCraft,
            IEnumerable<string> stations,
            ContactRoute earliest,
            double ut,
            double lightFactor,
            PathStrengths strengths)
        {
            var best = earliest;
            var bestStrength = StrengthOf(earliest, ut, strengths);
            var latest = earliest.ArrivalUt + (ContactPlanSchedule.EdgeToleranceSeconds * Math.Max(lightFactor, 0.0));
            foreach (var station in stations)
            {
                if (station == earliest.Destination)
                {
                    continue;
                }
                strengths.RoutesWeighed++;
                var route = ContactRouter.EarliestArrival(plan, activeCraft, station, ut, null, lightFactor);
                if (route == null || !route.Live || route.Hops.Count == 0 || route.ArrivalUt > latest)
                {
                    continue;
                }
                var strength = StrengthOf(route, ut, strengths);
                if (strength != null && (bestStrength == null || strength.Value > bestStrength.Value))
                {
                    best = route;
                    bestStrength = strength;
                }
            }
            return best;
        }

        private static double? StrengthOf(ContactRoute route, double ut, PathStrengths strengths)
        {
            var hops = new List<double?>(route.Hops.Count);
            foreach (var hop in route.Hops)
            {
                hops.Add(strengths.FactsOf(hop.From, hop.To, ut, hop.DistanceMeters)?.HopStrength);
            }
            return strengths.Of(hops);
        }

        /// <summary>
        /// A node's id as <c>comms.path</c> carries it: a craft's bare guid, a
        /// ground station's own name.
        /// </summary>
        private static string WireId(string nodeId, Dictionary<string, ContactGameNode> ground)
        {
            if (ground.TryGetValue(nodeId, out var station))
            {
                return station.DisplayName ?? nodeId;
            }
            return nodeId.StartsWith(CraftStateRecorder.VesselPrefix, StringComparison.Ordinal)
                ? CraftStateRecorder.GuidOf(nodeId)
                : nodeId;
        }

        private static CommsNetworkNode Node(string nodeId, Dictionary<string, ContactGameNode> ground, Func<string, string?> nameOf)
        {
            var id = WireId(nodeId, ground);
            var station = ground.ContainsKey(nodeId);
            return new CommsNetworkNode
            {
                Id = id,
                DisplayName = station ? id : nameOf(nodeId) ?? id,
                Kind = station ? CommsHopKind.Home : CommsHopKind.Relay,
            };
        }

        private static CommsCommandCentre Terminus(
            string nodeId, Dictionary<string, ContactGameNode> ground, Func<string, string?> nameOf)
        {
            if (ground.TryGetValue(nodeId, out var station))
            {
                return new CommsCommandCentre
                {
                    Id = nodeId,
                    DisplayName = station.DisplayName ?? nodeId,
                    Kind = nameof(CommandCentreKind.GroundStation),
                    BodyIndex = station.BodyIndex,
                };
            }
            return new CommsCommandCentre
            {
                Id = nodeId,
                DisplayName = nameOf(nodeId) ?? nodeId,
                Kind = nameof(CommandCentreKind.CrewedVessel),
            };
        }
    }
}
