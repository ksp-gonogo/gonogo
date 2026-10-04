using System;
using System.Collections.Generic;

namespace Sitrep.Propagation.Contacts
{
    /// <summary>One hop of a route: light leaves one node and lands on the next.</summary>
    public sealed class RouteHop
    {
        public RouteHop(string from, string to, double departUt, double arriveUt, double windowCloseUt)
        {
            From = from;
            To = to;
            DepartUt = departUt;
            ArriveUt = arriveUt;
            WindowCloseUt = windowCloseUt;
        }

        public string From { get; }

        public string To { get; }

        /// <summary>When the message leaves <see cref="From"/>; later than its arrival there by the time it waits.</summary>
        public double DepartUt { get; }

        /// <summary>When it lands on <see cref="To"/>: departure plus the light time to where the receiver will be.</summary>
        public double ArriveUt { get; }

        /// <summary>When the window this hop uses closes, or the pair's horizon when it is still open there.</summary>
        public double WindowCloseUt { get; }
    }

    /// <summary>The earliest-arriving route from one node to another for a message sent at one instant.</summary>
    public sealed class ContactRoute
    {
        public ContactRoute(string source, string destination, double sentUt, IReadOnlyList<RouteHop> hops)
        {
            Source = source;
            Destination = destination;
            SentUt = sentUt;
            Hops = hops;
        }

        public string Source { get; }

        public string Destination { get; }

        public double SentUt { get; }

        /// <summary>Every hop in order; empty when the source is the destination.</summary>
        public IReadOnlyList<RouteHop> Hops { get; }

        /// <summary>When the message arrives.</summary>
        public double ArrivalUt => Hops.Count == 0 ? SentUt : Hops[Hops.Count - 1].ArriveUt;

        /// <summary>Whether every hop leaves the moment the message reaches its node, so nothing waits anywhere.</summary>
        public bool Live
        {
            get
            {
                var at = SentUt;
                foreach (var hop in Hops)
                {
                    if (hop.DepartUt > at + Tolerance)
                    {
                        return false;
                    }
                    at = hop.ArriveUt;
                }
                return true;
            }
        }

        private const double Tolerance = 1e-6;
    }

    /// <summary>
    /// Earliest-arrival routing over a contact plan, after CCSDS SABR's route
    /// selection with everything that needs a link's capacity left out.
    ///
    /// <para>Without capacity, a contact's only state is its window and its light
    /// time, and leaving later can never arrive sooner. So the search runs on
    /// NODES as a Dijkstra over earliest-arrival labels, with a message free to wait
    /// at a node for its next window. A hop is admitted only if it can land: it
    /// leaves inside a window of its pair, and arrives, one light time later at
    /// where the receiver will then be, before that window closes and before the
    /// message's own deadline.</para>
    ///
    /// <para>Ties go, in SABR's order, to the earlier arrival, then fewer hops, then
    /// the later route termination (the soonest a used window closes), then node id
    /// order, so the answer never depends on enumeration order.</para>
    /// </summary>
    public static class ContactRouter
    {
        private const double Tolerance = 1e-6;

        /// <summary>
        /// The earliest-arriving route from <paramref name="source"/> to
        /// <paramref name="destination"/> for a message sent at
        /// <paramref name="sentUt"/>, or null when the plan predicts none before
        /// its horizon, or before <paramref name="mustArriveByUt"/>.
        /// </summary>
        public static ContactRoute? EarliestArrival(
            ContactPlan plan, string source, string destination, double sentUt, double? mustArriveByUt = null) =>
            EarliestArrivalAtAny(plan, source, new[] { destination }, sentUt, mustArriveByUt);

        /// <summary>
        /// The earliest-arriving route from <paramref name="source"/> to
        /// whichever of <paramref name="destinations"/> a message sent at
        /// <paramref name="sentUt"/> reaches first, or null when the plan
        /// predicts none. For a message any of several nodes can take, as any
        /// station of a ground network can.
        /// </summary>
        public static ContactRoute? EarliestArrivalAtAny(
            ContactPlan plan, string source, IReadOnlyCollection<string> destinations, double sentUt, double? mustArriveByUt = null)
        {
            if (plan == null) throw new ArgumentNullException(nameof(plan));
            if (destinations == null) throw new ArgumentNullException(nameof(destinations));
            var ends = new HashSet<string>(destinations, StringComparer.Ordinal);
            if (ends.Contains(source))
            {
                return new ContactRoute(source, source, sentUt, new RouteHop[0]);
            }

            var adjacency = Adjacency(plan);
            ends.IntersectWith(adjacency.Keys);
            if (!adjacency.ContainsKey(source) || ends.Count == 0)
            {
                return null;
            }

            var best = new Dictionary<string, Label>(StringComparer.Ordinal)
            {
                [source] = new Label(sentUt, 0, double.PositiveInfinity, source, null, null),
            };
            var settled = new HashSet<string>(StringComparer.Ordinal);
            while (true)
            {
                string? current = null;
                foreach (var entry in best)
                {
                    if (!settled.Contains(entry.Key) && (current == null || Better(entry.Value, best[current])))
                    {
                        current = entry.Key;
                    }
                }
                if (current == null)
                {
                    return null;
                }
                if (ends.Contains(current))
                {
                    return Unwind(best, source, current, sentUt);
                }
                settled.Add(current);

                var at = best[current];
                foreach (var (pair, other) in adjacency[current])
                {
                    if (settled.Contains(other))
                    {
                        continue;
                    }
                    var hop = FirstAdmissibleHop(plan, pair, current, other, at.ArrivalUt, mustArriveByUt);
                    if (hop == null)
                    {
                        continue;
                    }
                    var candidate = new Label(
                        hop.ArriveUt,
                        at.Hops + 1,
                        Math.Min(at.TerminationUt, hop.WindowCloseUt),
                        at.Path + "\u0001" + other,
                        current,
                        hop);
                    if (!best.TryGetValue(other, out var existing) || Better(candidate, existing))
                    {
                        best[other] = candidate;
                    }
                }
            }
        }

        /// <summary>
        /// The earliest hop across <paramref name="pair"/> leaving no sooner than
        /// <paramref name="readyUt"/> that can land, or null. Windows are in time
        /// order and a later departure never lands sooner, so the first admissible
        /// window is the best one.
        /// </summary>
        public static RouteHop? FirstAdmissibleHop(
            ContactPlan plan, PairPlan pair, string from, string to, double readyUt, double? mustArriveByUt)
        {
            foreach (var window in pair.Windows)
            {
                var open = window.OpenUt ?? plan.FromUt;
                var close = window.CloseUt ?? pair.HorizonUt;
                var depart = Math.Max(open, readyUt);
                if (depart >= close)
                {
                    continue;
                }
                var light = LightTime(pair, depart);
                if (light == null)
                {
                    continue;
                }
                var arrive = depart + light.Value;
                if (mustArriveByUt != null && arrive > mustArriveByUt.Value + Tolerance)
                {
                    return null;
                }
                // A window still open at the pair's horizon is not predicted to
                // close, so light landing past the horizon is not refused for it.
                if (window.CloseUt != null && arrive > close)
                {
                    continue;
                }
                return new RouteHop(from, to, depart, arrive, close);
            }
            return null;
        }

        /// <summary>
        /// The light time for a message leaving at <paramref name="departUt"/>, to
        /// where the receiver will be when it lands: the separation at the landing
        /// instant, solved by fixed-point iteration, which converges in a few steps
        /// because nothing in a planetary system moves at a sizeable fraction of
        /// light speed.
        /// </summary>
        public static double? LightTime(PairPlan pair, double departUt)
        {
            var separation = pair.SeparationAt(departUt);
            if (separation == null)
            {
                return null;
            }
            var light = separation.Value / PairPlan.SpeedOfLight;
            for (var i = 0; i < 3; i++)
            {
                var then = pair.SeparationAt(departUt + light);
                if (then == null)
                {
                    break;
                }
                light = then.Value / PairPlan.SpeedOfLight;
            }
            return light;
        }

        private static Dictionary<string, List<(PairPlan Pair, string Other)>> Adjacency(ContactPlan plan)
        {
            var adjacency = new Dictionary<string, List<(PairPlan, string)>>(StringComparer.Ordinal);
            void Add(string from, string to, PairPlan pair)
            {
                if (!adjacency.TryGetValue(from, out var list))
                {
                    list = new List<(PairPlan, string)>();
                    adjacency[from] = list;
                }
                list.Add((pair, to));
            }
            foreach (var pair in plan.Pairs)
            {
                Add(pair.A, pair.B, pair);
                Add(pair.B, pair.A, pair);
            }
            return adjacency;
        }

        private static bool Better(Label a, Label b)
        {
            if (Math.Abs(a.ArrivalUt - b.ArrivalUt) > Tolerance)
            {
                return a.ArrivalUt < b.ArrivalUt;
            }
            if (a.Hops != b.Hops)
            {
                return a.Hops < b.Hops;
            }
            if (Math.Abs(a.TerminationUt - b.TerminationUt) > Tolerance)
            {
                return a.TerminationUt > b.TerminationUt;
            }
            return string.CompareOrdinal(a.Path, b.Path) < 0;
        }

        private static ContactRoute Unwind(Dictionary<string, Label> best, string source, string destination, double sentUt)
        {
            var hops = new List<RouteHop>();
            var node = destination;
            while (!string.Equals(node, source, StringComparison.Ordinal))
            {
                var label = best[node];
                hops.Add(label.Hop!);
                node = label.Previous!;
            }
            hops.Reverse();
            return new ContactRoute(source, destination, sentUt, hops);
        }

        private sealed class Label
        {
            public Label(double arrivalUt, int hops, double terminationUt, string path, string? previous, RouteHop? hop)
            {
                ArrivalUt = arrivalUt;
                Hops = hops;
                TerminationUt = terminationUt;
                Path = path;
                Previous = previous;
                Hop = hop;
            }

            public double ArrivalUt { get; }

            public int Hops { get; }

            public double TerminationUt { get; }

            public string Path { get; }

            public string? Previous { get; }

            public RouteHop? Hop { get; }
        }
    }
}
