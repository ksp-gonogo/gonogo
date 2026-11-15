using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Propagation.Contacts;

namespace Sitrep.Host.Comms
{
    /// <summary>The closed vocabulary of <see cref="CommsNextLoss.Basis"/>.</summary>
    public static class NextLossBasis
    {
        /// <summary>The plan closes the last open route at the instant.</summary>
        public const string PredictedLoss = "predicted-loss";

        /// <summary>In contact through the plan's horizon.</summary>
        public const string NoLossInWindow = "no-loss-in-window";

        /// <summary>No route is open now.</summary>
        public const string OutOfContact = "out-of-contact";

        /// <summary>The centre holds no plan that includes the craft.</summary>
        public const string NotPlanned = "not-planned";

        /// <summary>There is no active craft.</summary>
        public const string NoCraft = "no-craft";
    }

    /// <summary>
    /// When a command centre's own contact plan next has no open route between
    /// it and one craft.
    ///
    /// <para>Route-aware: a craft is in contact while any chain of open windows,
    /// through relays or through any of the centre's own antennas, joins it to
    /// the centre. A handover from one relay to the next keeps the craft in
    /// contact, so the answer is the end of the whole chain and never the end
    /// of one window.</para>
    ///
    /// <para>Windows, not light time: a window's close is the instant the link
    /// ends, and that is what a loss of signal is. The router's own routes are
    /// timed by when a message would land, which is earlier by the signal
    /// delay and is not what an operator calls loss of signal.</para>
    /// </summary>
    public static class ContactLoss
    {
        /// <summary>The fewest boundaries worth searching past; a plan holds a handful of windows per pair.</summary>
        private const int MaxBoundaries = 4096;

        /// <summary>How far past a boundary the state is read, seconds: the boundary itself is the instant a window closes.</summary>
        private const double JustAfterSeconds = 1e-3;

        /// <param name="plan">The centre's own plan, or null when it has none.</param>
        /// <param name="craft">The active craft's id in the roster vocabulary, or null.</param>
        /// <param name="centre">The receiving centre's id.</param>
        /// <param name="home">The home centre, or null.</param>
        /// <param name="antennas">Every ground station, each of which is home's own antenna.</param>
        /// <param name="ut">Now.</param>
        /// <param name="unsettled">The nodes reckoned on an orbit that was still changing.</param>
        /// <param name="liveLink">
        /// Whether the craft's link is up as the centre last heard it: false is out of
        /// contact whatever the plan holds, since a loss is predicted of a link that is
        /// there. Null is no reading yet, which is not a disconnection, and the plan answers.
        /// </param>
        public static CommsNextLoss Next(
            ContactPlan? plan,
            string? craft,
            string centre,
            string? home,
            IReadOnlyCollection<string>? antennas,
            double ut,
            IReadOnlyCollection<string>? unsettled = null,
            bool? liveLink = null) =>
            Next(plan == null || craft == null ? null : new ContactTimeline(plan), plan, craft, centre, home, antennas, ut, unsettled, liveLink);

        /// <param name="timeline">The windows of <paramref name="plan"/> in time order, or null when there is no plan or no craft.</param>
        internal static CommsNextLoss Next(
            ContactTimeline? timeline,
            ContactPlan? plan,
            string? craft,
            string centre,
            string? home,
            IReadOnlyCollection<string>? antennas,
            double ut,
            IReadOnlyCollection<string>? unsettled,
            bool? liveLink)
        {
            if (craft == null)
            {
                return new CommsNextLoss { Basis = NextLossBasis.NoCraft };
            }
            if (liveLink == false)
            {
                var down = new CommsNextLoss { Basis = NextLossBasis.OutOfContact, CoveredToUt = plan?.HorizonUt ?? ut };
                if (plan != null && timeline != null && ut >= plan.FromUt && timeline.Includes(craft))
                {
                    var from = GroundNetwork.EndsOf(craft, home, antennas);
                    var to = GroundNetwork.EndsOf(centre, home, antennas);
                    var now = timeline.Sweep(from, to);
                    down.NextAcquisitionUt = now.ConnectedAt(ut)
                        ? CurrentConnectionStart(timeline, from, to, ut)
                        : NextConnected(timeline, now, ut, HorizonFor(plan, ut));
                }
                return down;
            }
            if (plan == null || timeline == null || ut < plan.FromUt || !timeline.Includes(craft))
            {
                return new CommsNextLoss { Basis = NextLossBasis.NotPlanned, CoveredToUt = plan?.HorizonUt ?? ut };
            }
            var horizon = HorizonFor(plan, ut);
            var result = new CommsNextLoss { CoveredToUt = horizon };
            var sweep = timeline.Sweep(GroundNetwork.EndsOf(craft, home, antennas), GroundNetwork.EndsOf(centre, home, antennas));

            if (!sweep.ConnectedAt(ut))
            {
                result.Basis = NextLossBasis.OutOfContact;
                result.NextAcquisitionUt = NextConnected(timeline, sweep, ut, horizon);
                return result;
            }

            var lowConfidence = unsettled != null && (unsettled.Contains(craft) || unsettled.Contains(centre));
            var boundaries = timeline.Boundaries;
            var searched = 0;
            for (var i = ContactTimeline.FirstAfter(boundaries, ut); i < boundaries.Length && boundaries[i] < horizon; i++)
            {
                if (++searched > MaxBoundaries)
                {
                    break;
                }
                if (!sweep.ConnectedAt(boundaries[i] + JustAfterSeconds))
                {
                    result.Ut = boundaries[i];
                    result.Basis = NextLossBasis.PredictedLoss;
                    result.LowConfidence = lowConfidence;
                    return result;
                }
            }
            result.Basis = NextLossBasis.NoLossInWindow;
            result.LowConfidence = lowConfidence;
            return result;
        }

        /// <summary>
        /// The first window opening before <paramref name="horizon"/> after which the route is joined, or null when the plan holds none.
        /// <paramref name="sweep"/> has been read no later than <paramref name="ut"/>.
        /// </summary>
        private static double? NextConnected(ContactTimeline timeline, ContactTimeline.Reading sweep, double ut, double horizon)
        {
            var opens = timeline.Opens;
            var searched = 0;
            for (var i = ContactTimeline.FirstAfter(opens, ut); i < opens.Length && opens[i] < horizon; i++)
            {
                if (++searched > MaxBoundaries)
                {
                    break;
                }
                if (sweep.ConnectedAt(opens[i] + JustAfterSeconds))
                {
                    return opens[i];
                }
            }
            return null;
        }

        /**
         * The instant the route that joins the sources to the destinations at
         * <paramref name="ut"/> last opened. A live link still reading down while the
         * plan already holds the route open is the centre catching up with a return that
         * has happened, so the acquisition is that return and not a later window, which
         * lies in the part of the plan that is re-solved every frame.
         */
        private static double CurrentConnectionStart(
            ContactTimeline timeline, IReadOnlyCollection<string> sources, IReadOnlyCollection<string> destinations, double ut)
        {
            // The latest opening the route was not joined just before, found reading forward since a reading only moves that way.
            var sweep = timeline.Sweep(sources, destinations);
            var opens = timeline.Opens;
            double? start = null;
            for (var i = 0; i < opens.Length && opens[i] <= ut; i++)
            {
                if (!sweep.ConnectedAt(opens[i] - JustAfterSeconds))
                {
                    start = opens[i];
                }
            }
            return start ?? timeline.Plan.FromUt;
        }

        /// <summary>The plan's horizon, cut to the earliest of any pair's own horizon that still has windows ahead, because past it that pair is unknown.</summary>
        private static double HorizonFor(ContactPlan plan, double ut)
        {
            var horizon = plan.HorizonUt;
            foreach (var pair in plan.Pairs)
            {
                if (pair.HorizonUt < horizon && pair.HorizonUt > ut)
                {
                    horizon = pair.HorizonUt;
                }
            }
            return horizon;
        }
    }

    /// <summary>
    /// Every window of one contact plan in time order, for asking at a run of
    /// rising instants whether any chain of open windows joins two sets of
    /// nodes. A window is open from its opening instant until just before its
    /// closing instant. Built once for a plan and read from any thread.
    /// </summary>
    internal sealed class ContactTimeline
    {
        private readonly Dictionary<string, int> _nodes = new Dictionary<string, int>(StringComparer.Ordinal);
        private readonly List<(int Pair, int Other)>[] _links;
        private readonly int[] _openFromTheStart;
        private readonly double[] _openAt;
        private readonly int[] _openPair;
        private readonly double[] _closeAt;
        private readonly int[] _closePair;
        private readonly double[] _instants;

        public ContactTimeline(ContactPlan plan)
        {
            Plan = plan;
            var links = new List<List<(int, int)>>();
            int NodeOf(string id)
            {
                if (!_nodes.TryGetValue(id, out var index))
                {
                    index = links.Count;
                    _nodes[id] = index;
                    links.Add(new List<(int, int)>());
                }
                return index;
            }

            _openFromTheStart = new int[plan.Pairs.Count];
            var opens = new List<(double At, int Pair)>();
            var closes = new List<(double At, int Pair)>();
            var everyOpen = new List<double>();
            var everyEdge = new List<double>();
            var instants = new List<double> { plan.FromUt };
            for (var p = 0; p < plan.Pairs.Count; p++)
            {
                var pair = plan.Pairs[p];
                var a = NodeOf(pair.A);
                var b = NodeOf(pair.B);
                links[a].Add((p, b));
                links[b].Add((p, a));
                instants.Add(pair.HorizonUt);
                foreach (var window in pair.Windows)
                {
                    if (window.OpenUt is double open && !double.IsNaN(open))
                    {
                        everyOpen.Add(open);
                        everyEdge.Add(open);
                    }
                    if (window.CloseUt is double close && !double.IsNaN(close))
                    {
                        everyEdge.Add(close);
                    }
                    // A window that closes no later than it opens, or has an edge that is not a number, is open at no instant.
                    var opensAt = window.OpenUt ?? double.NegativeInfinity;
                    var closesAt = window.CloseUt ?? double.PositiveInfinity;
                    if (!(opensAt < closesAt))
                    {
                        continue;
                    }
                    if (window.OpenUt == null)
                    {
                        _openFromTheStart[p]++;
                    }
                    else
                    {
                        opens.Add((opensAt, p));
                    }
                    if (window.CloseUt != null)
                    {
                        closes.Add((closesAt, p));
                    }
                }
            }
            _links = links.ToArray();
            opens.Sort((x, y) => x.At.CompareTo(y.At));
            closes.Sort((x, y) => x.At.CompareTo(y.At));
            _openAt = new double[opens.Count];
            _openPair = new int[opens.Count];
            for (var i = 0; i < opens.Count; i++)
            {
                _openAt[i] = opens[i].At;
                _openPair[i] = opens[i].Pair;
            }
            _closeAt = new double[closes.Count];
            _closePair = new int[closes.Count];
            for (var i = 0; i < closes.Count; i++)
            {
                _closeAt[i] = closes[i].At;
                _closePair[i] = closes[i].Pair;
            }
            Opens = Distinct(everyOpen);
            Boundaries = Distinct(everyEdge);
            instants.AddRange(Boundaries);
            _instants = Distinct(instants);
        }

        public ContactPlan Plan { get; }

        /// <summary>Every instant a window of the plan opens at, rising, each once.</summary>
        public double[] Opens { get; }

        /// <summary>Every instant a window of the plan opens or closes at, rising, each once.</summary>
        public double[] Boundaries { get; }

        /// <summary>Whether any pair of the plan has <paramref name="node"/> as an end.</summary>
        public bool Includes(string node) => _nodes.ContainsKey(node);

        /// <summary>
        /// The first instant after <paramref name="ut"/> at which anything read off the plan can
        /// change: a window opening or closing, a pair's own horizon, or the plan's start.
        /// Positive infinity when there is none.
        /// </summary>
        public double NextChangeAfter(double ut)
        {
            var i = FirstAfter(_instants, ut);
            return i < _instants.Length ? _instants[i] : double.PositiveInfinity;
        }

        /// <summary>The index of the first of <paramref name="rising"/> that is greater than <paramref name="ut"/>, or its length.</summary>
        public static int FirstAfter(double[] rising, double ut)
        {
            var lo = 0;
            var hi = rising.Length;
            while (lo < hi)
            {
                var mid = lo + ((hi - lo) / 2);
                if (rising[mid] > ut)
                {
                    hi = mid;
                }
                else
                {
                    lo = mid + 1;
                }
            }
            return lo;
        }

        /// <summary>A reading of whether <paramref name="sources"/> are joined to <paramref name="destinations"/>, starting before the plan's first window.</summary>
        public Reading Sweep(IReadOnlyCollection<string> sources, IReadOnlyCollection<string> destinations) =>
            new Reading(this, sources, destinations);

        private static double[] Distinct(List<double> values)
        {
            values.Sort();
            var distinct = new List<double>(values.Count);
            foreach (var value in values)
            {
                if (distinct.Count == 0 || distinct[distinct.Count - 1] != value)
                {
                    distinct.Add(value);
                }
            }
            return distinct.ToArray();
        }

        /// <summary>
        /// Whether two sets of nodes are joined, asked at instants that never go back.
        /// Each ask moves on only the windows that opened or closed since the last, and
        /// the chain is searched for again only when a pair that was open has closed, or
        /// when nothing joined them and a pair has opened.
        /// </summary>
        public sealed class Reading
        {
            private readonly ContactTimeline _timeline;
            private readonly int[] _open;
            private readonly bool[] _destination;
            private readonly List<int> _sources = new List<int>();
            private readonly bool _sameNode;
            private readonly int[] _visited;
            private readonly Queue<int> _queue = new Queue<int>();
            private int _visit;
            private int _nextOpen;
            private int _nextClose;
            private bool? _joined;
            private bool _pairOpened;
            private bool _pairClosed;

            internal Reading(ContactTimeline timeline, IReadOnlyCollection<string> sources, IReadOnlyCollection<string> destinations)
            {
                _timeline = timeline;
                _open = (int[])timeline._openFromTheStart.Clone();
                _destination = new bool[timeline._links.Length];
                _visited = new int[timeline._links.Length];
                foreach (var destination in destinations)
                {
                    if (timeline._nodes.TryGetValue(destination, out var index))
                    {
                        _destination[index] = true;
                    }
                }
                foreach (var source in sources)
                {
                    _sameNode |= destinations.Contains(source);
                    if (timeline._nodes.TryGetValue(source, out var index))
                    {
                        _sources.Add(index);
                    }
                }
            }

            /// <summary>Whether a chain of windows open at <paramref name="ut"/> joins a source to a destination. <paramref name="ut"/> is no earlier than the last asked.</summary>
            public bool ConnectedAt(double ut)
            {
                if (_sameNode)
                {
                    return true;
                }
                var timeline = _timeline;
                while (_nextOpen < timeline._openAt.Length && timeline._openAt[_nextOpen] <= ut)
                {
                    _pairOpened |= _open[timeline._openPair[_nextOpen++]]++ == 0;
                }
                while (_nextClose < timeline._closeAt.Length && timeline._closeAt[_nextClose] <= ut)
                {
                    _pairClosed |= --_open[timeline._closePair[_nextClose++]] == 0;
                }
                if (_joined == true ? !_pairClosed : _joined == false && !_pairOpened)
                {
                    return _joined.Value;
                }
                _pairOpened = false;
                _pairClosed = false;
                _joined = Search();
                return _joined.Value;
            }

            private bool Search()
            {
                _visit++;
                _queue.Clear();
                foreach (var source in _sources)
                {
                    if (_visited[source] != _visit)
                    {
                        _visited[source] = _visit;
                        _queue.Enqueue(source);
                    }
                }
                while (_queue.Count > 0)
                {
                    foreach (var (pair, other) in _timeline._links[_queue.Dequeue()])
                    {
                        if (_open[pair] <= 0 || _visited[other] == _visit)
                        {
                            continue;
                        }
                        if (_destination[other])
                        {
                            return true;
                        }
                        _visited[other] = _visit;
                        _queue.Enqueue(other);
                    }
                }
                return false;
            }
        }
    }

    /// <summary>
    /// One centre's answer from <see cref="ContactLoss.Next"/>, kept until something it was
    /// worked out from changes. The answer for a plan moves only when an instant passes
    /// at which a window opens or closes, a pair's horizon ends or the plan starts, so
    /// between two such instants it is handed back without being worked out again.
    /// Courier thread only.
    /// </summary>
    public sealed class ContactLossMemo
    {
        private ContactTimeline? _timeline;
        private CommsNextLoss? _figure;
        private string? _craft;
        private string? _centre;
        private string? _home;
        private string[]? _antennas;
        private bool _lowConfidence;
        private bool? _liveLink;
        private double _fromUt;
        private double _untilUt;

        /// <summary>The same answer as <see cref="ContactLoss.Next"/> for the same arguments, as an object of its own each time.</summary>
        public CommsNextLoss Next(
            ContactPlan? plan,
            string? craft,
            string centre,
            string? home,
            IReadOnlyCollection<string>? antennas,
            double ut,
            IReadOnlyCollection<string>? unsettled = null,
            bool? liveLink = null)
        {
            if (plan == null || craft == null)
            {
                // With no plan the answer carries the instant it was asked at, and with no craft it costs nothing.
                _figure = null;
                return ContactLoss.Next(null, plan, craft, centre, home, antennas, ut, unsettled, liveLink);
            }
            var lowConfidence = unsettled != null && (unsettled.Contains(craft) || unsettled.Contains(centre));
            if (_figure != null
                && ReferenceEquals(_timeline!.Plan, plan)
                && ut >= _fromUt
                && ut < _untilUt
                && craft == _craft
                && centre == _centre
                && home == _home
                && liveLink == _liveLink
                && lowConfidence == _lowConfidence
                && SameAntennas(antennas))
            {
                return Copy(_figure);
            }
            if (_timeline == null || !ReferenceEquals(_timeline.Plan, plan))
            {
                _timeline = new ContactTimeline(plan);
            }
            _figure = ContactLoss.Next(_timeline, plan, craft, centre, home, antennas, ut, unsettled, liveLink);
            _craft = craft;
            _centre = centre;
            _home = home;
            _antennas = antennas?.ToArray();
            _lowConfidence = lowConfidence;
            _liveLink = liveLink;
            _fromUt = ut;
            _untilUt = _timeline.NextChangeAfter(ut);
            return Copy(_figure);
        }

        private bool SameAntennas(IReadOnlyCollection<string>? antennas)
        {
            if (antennas == null || _antennas == null)
            {
                return antennas == null && _antennas == null;
            }
            if (antennas.Count != _antennas.Length)
            {
                return false;
            }
            var i = 0;
            foreach (var antenna in antennas)
            {
                if (antenna != _antennas[i++])
                {
                    return false;
                }
            }
            return true;
        }

        private static CommsNextLoss Copy(CommsNextLoss figure) => new CommsNextLoss
        {
            Ut = figure.Ut,
            Basis = figure.Basis,
            NextAcquisitionUt = figure.NextAcquisitionUt,
            CoveredToUt = figure.CoveredToUt,
            LowConfidence = figure.LowConfidence,
        };
    }
}
