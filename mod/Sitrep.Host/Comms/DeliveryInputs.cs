using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Core.StoreAndForward;
using Sitrep.Propagation.Contacts;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The live link graph the backend reports this tick: which nodes have a
    /// direct link right now, and its light time. A live path is the fastest
    /// chain of live links.
    /// </summary>
    public sealed class LiveLinkGraph
    {
        private readonly Dictionary<string, Dictionary<string, double>> _links;

        public LiveLinkGraph(IEnumerable<(string A, string B, double LightSeconds)> links)
        {
            _links = new Dictionary<string, Dictionary<string, double>>(StringComparer.Ordinal);
            foreach (var (a, b, light) in links)
            {
                Add(a, b, light);
                Add(b, a, light);
            }
        }

        /// <summary>A graph with no links.</summary>
        public static LiveLinkGraph Empty { get; } = new LiveLinkGraph(new (string, string, double)[0]);

        public double? LiveLink(string from, string to) =>
            _links.TryGetValue(from, out var near) && near.TryGetValue(to, out var light) ? light : (double?)null;

        /// <summary>The light time of the fastest chain of live links from one node to another, or null when none joins them.</summary>
        public double? LivePath(string from, string to)
        {
            if (string.Equals(from, to, StringComparison.Ordinal))
            {
                return 0.0;
            }
            var best = new Dictionary<string, double>(StringComparer.Ordinal) { [from] = 0.0 };
            var done = new HashSet<string>(StringComparer.Ordinal);
            while (true)
            {
                string? current = null;
                foreach (var entry in best)
                {
                    if (!done.Contains(entry.Key) && (current == null || entry.Value < best[current]))
                    {
                        current = entry.Key;
                    }
                }
                if (current == null)
                {
                    return null;
                }
                if (string.Equals(current, to, StringComparison.Ordinal))
                {
                    return best[current];
                }
                done.Add(current);
                if (!_links.TryGetValue(current, out var near))
                {
                    continue;
                }
                foreach (var link in near)
                {
                    var through = best[current] + link.Value;
                    if (!best.TryGetValue(link.Key, out var known) || through < known)
                    {
                        best[link.Key] = through;
                    }
                }
            }
        }

        private void Add(string from, string to, double light)
        {
            if (!_links.TryGetValue(from, out var near))
            {
                near = new Dictionary<string, double>(StringComparer.Ordinal);
                _links[from] = near;
            }
            near[to] = light;
        }
    }

    /// <summary>
    /// What store-and-forward delivery reads of the live game: the link graph,
    /// which decides whether light that was sent lands, and how light time is
    /// scaled. Written by the link capture, read by the engine, so each value is
    /// swapped whole.
    /// </summary>
    public sealed class DeliveryInputs
    {
        private LiveLinkGraph _links = LiveLinkGraph.Empty;
        private double _lightFactor = 1.0;
        private int _noNetwork;

        /// <summary>The live link graph from the latest capture.</summary>
        public LiveLinkGraph Links => Volatile.Read(ref _links);

        /// <summary>
        /// What a real light time is multiplied by to get the delay the game is
        /// set to model: one at real light speed, less for a faster light, zero
        /// with signal delay off.
        /// </summary>
        public double LightFactor => Volatile.Read(ref _lightFactor);

        /// <summary>
        /// Whether the game models a comms network at all. With it switched off
        /// every craft is in contact at no delay, there is nothing to plan, and a
        /// command is sent as it always was. True until told otherwise.
        /// </summary>
        public bool NetworkModelled => Volatile.Read(ref _noNetwork) == 0;

        public void SetLinks(LiveLinkGraph links) => Volatile.Write(ref _links, links ?? LiveLinkGraph.Empty);

        public void SetNetworkModelled(bool modelled) => Volatile.Write(ref _noNetwork, modelled ? 0 : 1);

        public void SetLightFactor(double factor) =>
            Volatile.Write(ref _lightFactor, double.IsNaN(factor) || double.IsInfinity(factor) || factor < 0.0 ? 1.0 : factor);
    }

    /// <summary>
    /// The home centre and the ground stations. Home hears whatever any ground
    /// station hears, and speaks through whichever of them can reach the
    /// craft, so each station is one of home's own antennas: its telemetry
    /// path, its command route and whether its light lands all run through
    /// any of them. Every other centre has its own antenna and no more.
    /// </summary>
    public static class GroundNetwork
    {
        /// <summary>The nodes a message for <paramref name="node"/> may leave from or land at: every antenna when it is home, itself otherwise.</summary>
        public static IReadOnlyCollection<string> EndsOf(string node, string? home, IReadOnlyCollection<string>? antennas)
        {
            if (home == null || antennas == null || antennas.Count == 0 || node != home)
            {
                return new[] { node };
            }
            var ends = new HashSet<string>(antennas, System.StringComparer.Ordinal) { home };
            return ends;
        }

        /// <summary>
        /// The shortest of <paramref name="lightBetween"/> over every pairing
        /// of the two nodes' ends, or null when none of them has a link.
        /// </summary>
        public static double? Shortest(
            string from, string to, string? home, IReadOnlyCollection<string>? antennas, System.Func<string, string, double?> lightBetween)
        {
            double? shortest = null;
            foreach (var a in EndsOf(from, home, antennas))
            {
                foreach (var b in EndsOf(to, home, antennas))
                {
                    var light = lightBetween(a, b);
                    if (light != null && (shortest == null || light.Value < shortest.Value))
                    {
                        shortest = light;
                    }
                }
            }
            return shortest;
        }
    }

    /// <summary>
    /// One contact plan's routes, for store-and-forward delivery: what the
    /// command centre that held the plan believed, fixed as it stood.
    /// </summary>
    public sealed class PlanRoutes : IDeliveryRoutes
    {
        private readonly ContactPlan? _plan;
        private readonly double _lightFactor;
        private readonly string? _home;
        private readonly IReadOnlyCollection<string>? _antennas;
        private readonly RetargetRouting? _retarget;

        /// <param name="plan">The plan, or null for no plan at all, which predicts no route.</param>
        /// <param name="lightFactor">What each hop's real light time is multiplied by: see <see cref="DeliveryInputs.LightFactor"/>.</param>
        /// <param name="home">The home centre, when the plan is its own, or null.</param>
        /// <param name="antennas">Every ground station, each of which is the home centre's own antenna: see <see cref="GroundNetwork"/>.</param>
        /// <param name="retarget">How a route may use the plan's retarget windows, or null to route on the dishes' own aims alone.</param>
        public PlanRoutes(ContactPlan? plan, double lightFactor = 1.0, string? home = null, IReadOnlyCollection<string>? antennas = null, RetargetRouting? retarget = null)
        {
            _retarget = retarget;
            _plan = plan;
            _lightFactor = lightFactor;
            _home = home;
            _antennas = antennas;
        }

        public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt)
        {
            if (_plan == null)
            {
                return null;
            }
            // Chosen and admitted on the light times the game models, so the
            // route that is taken is the one that arrives first under them, and
            // every hop lands inside its window.
            var route = ContactRouter.EarliestArrivalBetween(
                _plan,
                GroundNetwork.EndsOf(from, _home, _antennas),
                GroundNetwork.EndsOf(to, _home, _antennas),
                readyUt,
                double.IsInfinity(deadlineUt) ? (double?)null : deadlineUt,
                _lightFactor,
                _retarget);
            if (route == null)
            {
                return null;
            }
            var hops = new List<PlannedHop>(route.Hops.Count);
            for (var i = 0; i < route.Hops.Count; i++)
            {
                var hop = route.Hops[i];
                // Light that lands at any of home's antennas has landed at home.
                var landsAt = i == route.Hops.Count - 1 && to == _home ? to : hop.To;
                hops.Add(new PlannedHop(landsAt, hop.DepartUt, hop.ArriveUt, hop.FromDish, hop.ToDish, hop.RetargetDish, hop.TurnUt));
            }
            return hops;
        }
    }
}
