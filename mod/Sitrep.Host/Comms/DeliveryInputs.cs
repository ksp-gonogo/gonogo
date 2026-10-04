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
    /// One contact plan's routes, for store-and-forward delivery: what the
    /// command centre that held the plan believed, fixed as it stood.
    /// </summary>
    public sealed class PlanRoutes : IDeliveryRoutes
    {
        private readonly ContactPlan? _plan;
        private readonly double _lightFactor;

        /// <param name="plan">The plan, or null for no plan at all, which predicts no route.</param>
        /// <param name="lightFactor">What each hop's real light time is multiplied by: see <see cref="DeliveryInputs.LightFactor"/>.</param>
        public PlanRoutes(ContactPlan? plan, double lightFactor = 1.0)
        {
            _plan = plan;
            _lightFactor = lightFactor;
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
            var route = ContactRouter.EarliestArrival(
                _plan, from, to, readyUt, double.IsInfinity(deadlineUt) ? (double?)null : deadlineUt, _lightFactor);
            if (route == null)
            {
                return null;
            }
            var hops = new List<PlannedHop>(route.Hops.Count);
            foreach (var hop in route.Hops)
            {
                hops.Add(new PlannedHop(hop.To, hop.DepartUt, hop.ArriveUt));
            }
            return hops;
        }
    }
}
