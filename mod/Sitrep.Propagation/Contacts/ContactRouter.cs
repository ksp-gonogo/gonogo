using System;
using System.Collections.Generic;
using System.Linq;

namespace Sitrep.Propagation.Contacts
{
    /// <summary>One hop of a route: light leaves one node and lands on the next.</summary>
    public sealed class RouteHop
    {
        public RouteHop(
            string from,
            string to,
            double departUt,
            double arriveUt,
            double windowCloseUt,
            double distanceMeters = double.NaN,
            string? fromDish = null,
            string? toDish = null,
            string? retargetDish = null,
            double turnUt = double.NaN)
        {
            FromDish = fromDish;
            ToDish = toDish;
            RetargetDish = retargetDish;
            TurnUt = turnUt;
            DistanceMeters = distanceMeters;
            From = from;
            To = to;
            DepartUt = departUt;
            ArriveUt = arriveUt;
            WindowCloseUt = windowCloseUt;
        }

        public string From { get; }

        public string To { get; }

        /// <summary>The dish on <see cref="From"/> that carries the hop, when the link model names one. For a retarget hop, the dish turned to carry it.</summary>
        public string? FromDish { get; }

        /// <summary>The dish on <see cref="To"/> the light lands on, when the link model names one.</summary>
        public string? ToDish { get; }

        /// <summary>The dish of <see cref="From"/> that is turned to the next node to carry this hop, or null for a hop on a dish's own aim.</summary>
        public string? RetargetDish { get; }

        /// <summary>When the turn starts for a retarget hop, or NaN.</summary>
        public double TurnUt { get; }

        /// <summary>When the message leaves <see cref="From"/>; later than its arrival there by the time it waits.</summary>
        public double DepartUt { get; }

        /// <summary>When it lands on <see cref="To"/>: departure plus the signal delay to where the receiver will be.</summary>
        public double ArriveUt { get; }

        /// <summary>When the window this hop uses closes, or the pair's horizon when it is still open there.</summary>
        public double WindowCloseUt { get; }

        /// <summary>How far the light crosses, in metres: the separation when it lands. NaN for a hop built without one.</summary>
        public double DistanceMeters { get; }
    }

    /// <summary>
    /// How a route may use a node's retarget windows: a message held at a node
    /// can wait there for an idle dish to be turned to the next node.
    ///
    /// <para>A turn is made only for something its node holds and may turn a
    /// dish for. At the route's source that is anything the source is sending
    /// or passing on. Further on it is only a message every node may turn a
    /// dish for, a command or a cancel; a reply or a journey report turns a
    /// dish only at the node that made it, so a route for one counts no turn
    /// past its source (<see cref="OnTheWay"/>).</para>
    ///
    /// <para>A route that turns a dish is taken only when it arrives sooner
    /// than the best route that turns none by more than the event lasts
    /// (<see cref="EventSeconds"/>), so no dish is borrowed for a gain smaller
    /// than the time it is away.</para>
    /// </summary>
    public sealed class RetargetRouting
    {
        public RetargetRouting(double linkUpSeconds, double awayMarginSeconds, IReadOnlyCollection<string>? onlyAtNodes = null, bool onTheWay = false, Func<string, bool>? mayTurn = null)
        {
            LinkUpSeconds = linkUpSeconds;
            AwayMarginSeconds = awayMarginSeconds;
            OnlyAtNodes = onlyAtNodes;
            OnTheWay = onTheWay;
            MayTurn = mayTurn;
        }

        /// <summary>
        /// Whether a node may turn a dish on its own right now, asked each time a route is
        /// worked out, or null for every node. A window of a node that may not is not a way
        /// through, whatever the plan was made from.
        /// </summary>
        public Func<string, bool>? MayTurn { get; }

        /// <summary>How long after the turn starts the link is up.</summary>
        public double LinkUpSeconds { get; }

        /// <summary>The time a window must have left after the link is up for the message to be sent and the dish turned back.</summary>
        public double AwayMarginSeconds { get; }

        /// <summary>How long a planned event keeps its dish away: the turn, then the send.</summary>
        public double EventSeconds => LinkUpSeconds + AwayMarginSeconds;

        /// <summary>The only nodes whose retarget windows may be used, or null for any node <see cref="OnTheWay"/> allows.</summary>
        public IReadOnlyCollection<string>? OnlyAtNodes { get; }

        /// <summary>Whether nodes past the route's source may turn a dish for the message, as they do for a command or a cancel they hold.</summary>
        public bool OnTheWay { get; }

        /// <summary>The same routing, with <see cref="OnTheWay"/> set to <paramref name="onTheWay"/>.</summary>
        public RetargetRouting WithOnTheWay(bool onTheWay) =>
            onTheWay == OnTheWay ? this : new RetargetRouting(LinkUpSeconds, AwayMarginSeconds, OnlyAtNodes, onTheWay, MayTurn);
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
    /// nodes as a Dijkstra over earliest-arrival labels, with a message free to wait
    /// at a node for its next window. A hop is admitted only if it can land: it
    /// leaves inside a window of its pair, and arrives, one signal delay later at
    /// where the receiver will then be, before that window closes and before the
    /// message's own deadline.</para>
    ///
    /// <para>Ties go, in SABR's order, to the earlier arrival, then fewer hops, then
    /// the later route termination (the soonest a used window closes), then node id
    /// order, so the answer never depends on enumeration order.</para>
    ///
    /// <para>Every search takes a light factor: what a real signal delay is
    /// multiplied by to get the delay the game is set to model, one at real
    /// light speed and less for a faster light. The route is chosen on those
    /// times and each hop is admitted on them, because which route arrives
    /// first, and whether a hop lands before its window closes, both depend on
    /// how long the light takes.</para>
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
            ContactPlan plan, string source, string destination, double sentUt, double? mustArriveByUt = null, double lightFactor = 1.0) =>
            EarliestArrivalAtAny(plan, source, new[] { destination }, sentUt, mustArriveByUt, lightFactor);

        /// <summary>
        /// The earliest-arriving route from <paramref name="source"/> to
        /// whichever of <paramref name="destinations"/> a message sent at
        /// <paramref name="sentUt"/> reaches first, or null when the plan
        /// predicts none. For a message any of several nodes can take, as any
        /// station of a ground network can.
        /// </summary>
        public static ContactRoute? EarliestArrivalAtAny(
            ContactPlan plan, string source, IReadOnlyCollection<string> destinations, double sentUt, double? mustArriveByUt = null, double lightFactor = 1.0)
        {
            if (source == null) throw new ArgumentNullException(nameof(source));
            return EarliestArrivalBetween(plan, new[] { source }, destinations, sentUt, mustArriveByUt, lightFactor);
        }

        /// <summary>
        /// The earliest-arriving route from whichever of
        /// <paramref name="sources"/> a message ready at
        /// <paramref name="sentUt"/> can leave by, to whichever of
        /// <paramref name="destinations"/> it reaches first, or null when the
        /// plan predicts none. For a sender or a receiver that has several
        /// antennas, as a centre that owns a ground network has: the route's
        /// <see cref="ContactRoute.Source"/> and
        /// <see cref="ContactRoute.Destination"/> name the two that were used.
        /// </summary>
        /// <param name="retarget">How the route may use the plan's retarget windows, or null to route on the dishes' own aims alone.</param>
        public static ContactRoute? EarliestArrivalBetween(
            ContactPlan plan,
            IReadOnlyCollection<string> sources,
            IReadOnlyCollection<string> destinations,
            double sentUt,
            double? mustArriveByUt = null,
            double lightFactor = 1.0,
            RetargetRouting? retarget = null)
        {
            if (plan == null) throw new ArgumentNullException(nameof(plan));
            if (sources == null) throw new ArgumentNullException(nameof(sources));
            if (destinations == null) throw new ArgumentNullException(nameof(destinations));
            var turning = Search(plan, sources, destinations, sentUt, mustArriveByUt, lightFactor, retarget);
            if (retarget == null || turning == null || !turning.Hops.Any(h => h.RetargetDish != null))
            {
                return turning;
            }
            var plain = Search(plan, sources, destinations, sentUt, mustArriveByUt, lightFactor, null);
            return plain != null && plain.ArrivalUt - turning.ArrivalUt <= retarget.EventSeconds + Tolerance ? plain : turning;
        }

        /// <summary>
        /// The earliest-arriving routes from <paramref name="sources"/> to every
        /// node of the plan at once, for a message ready at
        /// <paramref name="sentUt"/>. Asking the result for a set of destinations
        /// gives the route <see cref="EarliestArrivalBetween"/> gives for the same
        /// sources, destinations and instant with no retarget routing, without
        /// searching again.
        /// </summary>
        public static EarliestArrivals EarliestArrivalsFrom(
            ContactPlan plan, IReadOnlyCollection<string> sources, double sentUt, double? mustArriveByUt = null, double lightFactor = 1.0)
        {
            if (plan == null) throw new ArgumentNullException(nameof(plan));
            if (sources == null) throw new ArgumentNullException(nameof(sources));
            var best = new Dictionary<string, Label>(StringComparer.Ordinal);
            var order = new List<string>();
            Search(plan, sources, null, sentUt, mustArriveByUt, lightFactor, null, best, order);
            return new EarliestArrivals(sources, sentUt, best, order);
        }

        private static ContactRoute? Search(
            ContactPlan plan,
            IReadOnlyCollection<string> sources,
            IReadOnlyCollection<string> destinations,
            double sentUt,
            double? mustArriveByUt,
            double lightFactor,
            RetargetRouting? retarget)
        {
            var ends = new HashSet<string>(destinations, StringComparer.Ordinal);
            foreach (var source in sources)
            {
                if (ends.Contains(source))
                {
                    return new ContactRoute(source, source, sentUt, new RouteHop[0]);
                }
            }
            ends.IntersectWith(plan.Adjacency.Keys);
            return Search(plan, sources, ends, sentUt, mustArriveByUt, lightFactor, retarget, new Dictionary<string, Label>(StringComparer.Ordinal), null);
        }

        /// <summary>
        /// Settles nodes in order of arrival until one of <paramref name="ends"/> is
        /// settled, which is the route returned, or with no ends until every node
        /// that can be reached is settled. <paramref name="best"/> is left holding
        /// each node's label, final for a settled node, and
        /// <paramref name="order"/> the nodes in the order they were settled.
        /// </summary>
        private static ContactRoute? Search(
            ContactPlan plan,
            IReadOnlyCollection<string> sources,
            HashSet<string>? ends,
            double sentUt,
            double? mustArriveByUt,
            double lightFactor,
            RetargetRouting? retarget,
            Dictionary<string, Label> best,
            List<string>? order)
        {
            var adjacency = plan.Adjacency;
            foreach (var source in sources)
            {
                if (adjacency.ContainsKey(source))
                {
                    best[source] = new Label(sentUt, 0, double.PositiveInfinity, null, source, null, null);
                }
            }
            if (best.Count == 0 || (ends != null && ends.Count == 0))
            {
                return null;
            }

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
                if (ends != null && ends.Contains(current))
                {
                    return Unwind(best, current, sentUt);
                }
                settled.Add(current);
                order?.Add(current);

                var at = best[current];
                foreach (var (pair, other) in adjacency[current])
                {
                    if (settled.Contains(other))
                    {
                        continue;
                    }
                    if (retarget == null)
                    {
                        /*
                         * Most hops tried do not better the label their far node already
                         * has, so the hop and its label are made only for one that does.
                         * A search tries every pair of the plan from both ends, and one
                         * object for each try is most of what routing would allocate.
                         */
                        if (!TryFirstAdmissible(plan, pair, at.ArrivalUt, mustArriveByUt, lightFactor, out var window, out var times))
                        {
                            continue;
                        }
                        var termination = Math.Min(at.TerminationUt, times.CloseUt);
                        if (best.TryGetValue(other, out var held) && !Better(times.ArriveUt, at.Hops + 1, termination, at, other, held))
                        {
                            continue;
                        }
                        best[other] = new Label(times.ArriveUt, at.Hops + 1, termination, at, other, current, HopOver(pair, window, current, other, times));
                        continue;
                    }
                    var hop = FirstAdmissibleHop(plan, pair, current, other, at.ArrivalUt, mustArriveByUt, lightFactor);
                    if ((at.Hops == 0 || retarget.OnTheWay) && (retarget.OnlyAtNodes == null || retarget.OnlyAtNodes.Contains(current)))
                    {
                        var turned = FirstRetargetHop(plan, pair, current, other, at.ArrivalUt, mustArriveByUt, lightFactor, retarget);
                        if (turned != null && (hop == null || turned.ArriveUt < hop.ArriveUt - Tolerance))
                        {
                            hop = turned;
                        }
                    }
                    if (hop == null)
                    {
                        continue;
                    }
                    var candidate = new Label(
                        hop.ArriveUt,
                        at.Hops + 1,
                        Math.Min(at.TerminationUt, hop.WindowCloseUt),
                        at,
                        other,
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
            ContactPlan plan, PairPlan pair, string from, string to, double readyUt, double? mustArriveByUt, double lightFactor = 1.0) =>
            TryFirstAdmissible(plan, pair, readyUt, mustArriveByUt, lightFactor, out var window, out var times)
                ? HopOver(pair, window, from, to, times)
                : null;

        /// <summary>When a hop leaves and lands, the instant its window closes and how far the light crosses.</summary>
        private readonly struct HopTimes
        {
            public HopTimes(double departUt, double arriveUt, double closeUt, double meters)
            {
                DepartUt = departUt;
                ArriveUt = arriveUt;
                CloseUt = closeUt;
                Meters = meters;
            }

            public double DepartUt { get; }

            public double ArriveUt { get; }

            public double CloseUt { get; }

            public double Meters { get; }
        }

        /// <summary>The window and the times of <see cref="FirstAdmissibleHop"/>, with no hop made, or false where that gives none.</summary>
        private static bool TryFirstAdmissible(
            ContactPlan plan, PairPlan pair, double readyUt, double? mustArriveByUt, double lightFactor, out ContactWindow window, out HopTimes times)
        {
            var windows = pair.Windows;
            for (var i = 0; i < windows.Count; i++)
            {
                window = windows[i];
                var open = window.OpenUt ?? plan.FromUt;
                var close = window.CloseUt ?? pair.HorizonUt;
                var depart = Math.Max(open, readyUt);
                if (depart >= close)
                {
                    continue;
                }
                var crossing = Crossing(pair, depart, lightFactor);
                if (crossing == null)
                {
                    continue;
                }
                var arrive = depart + crossing.Value.Seconds;
                if (mustArriveByUt != null && arrive > mustArriveByUt.Value + Tolerance)
                {
                    break;
                }
                // A window still open at the pair's horizon is not predicted to
                // close, so light landing past the horizon is not refused for it.
                if (window.CloseUt != null && arrive > close)
                {
                    continue;
                }
                times = new HopTimes(depart, arrive, close, crossing.Value.Meters);
                return true;
            }
            window = default;
            times = default;
            return false;
        }

        private static RouteHop HopOver(PairPlan pair, ContactWindow window, string from, string to, HopTimes times)
        {
            var forward = string.Equals(from, pair.A, StringComparison.Ordinal);
            return new RouteHop(
                from, to, times.DepartUt, times.ArriveUt, times.CloseUt, times.Meters,
                forward ? window.FromDish : window.ToDish,
                forward ? window.ToDish : window.FromDish);
        }

        /// <summary>
        /// The earliest hop across <paramref name="pair"/> that leaves
        /// <paramref name="from"/> on an idle dish turned to <paramref name="to"/>:
        /// the turn starts at the window's opening or when the message is ready,
        /// the link is up <see cref="RetargetRouting.LinkUpSeconds"/> later, and the
        /// window must still have <see cref="RetargetRouting.AwayMarginSeconds"/>
        /// left. Null when the pair has no such window.
        /// </summary>
        public static RouteHop? FirstRetargetHop(
            ContactPlan plan, PairPlan pair, string from, string to, double readyUt, double? mustArriveByUt, double lightFactor, RetargetRouting retarget)
        {
            foreach (var window in pair.RetargetWindows)
            {
                if (!string.Equals(window.NodeId, from, StringComparison.Ordinal) || !string.Equals(window.PeerId, to, StringComparison.Ordinal))
                {
                    continue;
                }
                if (retarget.MayTurn != null && !retarget.MayTurn(window.NodeId))
                {
                    continue;
                }
                var turn = Math.Max(window.OpenUt, readyUt);
                var depart = turn + retarget.LinkUpSeconds;
                if (depart + retarget.AwayMarginSeconds > window.CloseUt)
                {
                    continue;
                }
                var crossing = Crossing(pair, depart, lightFactor);
                if (crossing == null)
                {
                    continue;
                }
                var arrive = depart + crossing.Value.Seconds;
                if (mustArriveByUt != null && arrive > mustArriveByUt.Value + Tolerance)
                {
                    return null;
                }
                return new RouteHop(from, to, depart, arrive, window.CloseUt, crossing.Value.Meters, window.DishId, null, window.DishId, turn);
            }
            return null;
        }

        /// <summary>
        /// The signal delay for a message leaving at <paramref name="departUt"/>, to
        /// where the receiver will be when it lands: the separation at the landing
        /// instant, solved by fixed-point iteration, which converges in a few steps
        /// because nothing in a planetary system moves at a sizeable fraction of
        /// light speed.
        /// </summary>
        public static double? LightTime(PairPlan pair, double departUt, double lightFactor = 1.0) =>
            Crossing(pair, departUt, lightFactor)?.Seconds;

        /// <summary>The signal delay of <see cref="LightTime"/>, with the separation it was taken over.</summary>
        private static (double Seconds, double Meters)? Crossing(PairPlan pair, double departUt, double lightFactor)
        {
            var separation = pair.SeparationAt(departUt);
            if (separation == null)
            {
                return null;
            }
            var meters = separation.Value;
            var light = meters / PairPlan.SpeedOfLight * lightFactor;
            for (var i = 0; i < 3; i++)
            {
                var then = pair.SeparationAt(departUt + light);
                if (then == null)
                {
                    break;
                }
                meters = then.Value;
                light = meters / PairPlan.SpeedOfLight * lightFactor;
            }
            return (light, meters);
        }

        /// <summary>The route to <paramref name="destination"/> its settled label ends, for the search's own result type.</summary>
        internal static ContactRoute RouteTo(Dictionary<string, Label> best, string destination, double sentUt) => Unwind(best, destination, sentUt);

        /// <summary>
        /// <see cref="Better(Label, Label)"/> for a label not yet made: one that would
        /// arrive at <paramref name="arrivalUt"/> after <paramref name="hops"/> hops by way of
        /// <paramref name="before"/> and then <paramref name="node"/>.
        /// </summary>
        private static bool Better(double arrivalUt, int hops, double terminationUt, Label before, string node, Label b)
        {
            if (Math.Abs(arrivalUt - b.ArrivalUt) > Tolerance)
            {
                return arrivalUt < b.ArrivalUt;
            }
            if (hops != b.Hops)
            {
                return hops < b.Hops;
            }
            if (Math.Abs(terminationUt - b.TerminationUt) > Tolerance)
            {
                return terminationUt > b.TerminationUt;
            }
            return string.CompareOrdinal(before.Path + "\u0001" + node, b.Path) < 0;
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

        private static ContactRoute Unwind(Dictionary<string, Label> best, string destination, double sentUt)
        {
            var hops = new List<RouteHop>();
            var node = destination;
            // A source is the one node on the way back that nothing led to.
            while (best[node].Previous != null)
            {
                var label = best[node];
                hops.Add(label.Hop!);
                node = label.Previous!;
            }
            hops.Reverse();
            return new ContactRoute(node, destination, sentUt, hops);
        }

        internal sealed class Label
        {
            private readonly Label? _before;
            private readonly string _node;
            private string? _path;

            public Label(double arrivalUt, int hops, double terminationUt, Label? before, string node, string? previous, RouteHop? hop)
            {
                ArrivalUt = arrivalUt;
                Hops = hops;
                TerminationUt = terminationUt;
                _before = before;
                _node = node;
                Previous = previous;
                Hop = hop;
            }

            public double ArrivalUt { get; }

            public int Hops { get; }

            public double TerminationUt { get; }

            /// <summary>Every node on the way, in order, which breaks a tie nothing else does. Put together only when a tie asks for it.</summary>
            public string Path => _path ??= _before == null ? _node : _before.Path + "\u0001" + _node;

            public string? Previous { get; }

            public RouteHop? Hop { get; }
        }
    }

    /// <summary>
    /// The earliest-arriving route from one set of sources to every node of a
    /// plan, for a message ready at one instant: the answer
    /// <see cref="ContactRouter.EarliestArrivalBetween"/> gives for any set of
    /// destinations, held so each is read off one search.
    /// </summary>
    public sealed class EarliestArrivals
    {
        private readonly IReadOnlyCollection<string> _sources;
        private readonly double _sentUt;
        private readonly Dictionary<string, ContactRouter.Label> _best;
        private readonly List<string> _settled;

        internal EarliestArrivals(
            IReadOnlyCollection<string> sources, double sentUt, Dictionary<string, ContactRouter.Label> best, List<string> settled)
        {
            _sources = sources;
            _sentUt = sentUt;
            _best = best;
            _settled = settled;
        }

        private static bool Holds(IReadOnlyCollection<string> nodes, string node)
        {
            if (nodes is HashSet<string> set && ReferenceEquals(set.Comparer, StringComparer.Ordinal))
            {
                return set.Contains(node);
            }
            foreach (var one in nodes)
            {
                if (string.Equals(one, node, StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>The earliest-arriving route to whichever of <paramref name="destinations"/> is reached first, or null when the plan predicts none.</summary>
        public ContactRoute? To(IReadOnlyCollection<string> destinations)
        {
            if (destinations == null) throw new ArgumentNullException(nameof(destinations));
            foreach (var source in _sources)
            {
                if (Holds(destinations, source))
                {
                    return new ContactRoute(source, source, _sentUt, new RouteHop[0]);
                }
            }
            // Nodes settle in order of arrival, so the first settled is the one a search for these alone would have stopped at.
            foreach (var node in _settled)
            {
                if (Holds(destinations, node))
                {
                    return ContactRouter.RouteTo(_best, node, _sentUt);
                }
            }
            return null;
        }
    }
}
