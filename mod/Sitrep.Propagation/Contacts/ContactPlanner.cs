using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation.Visibility;

namespace Sitrep.Propagation.Contacts
{
    /// <summary>
    /// One place that can hold a link: a craft on its orbit, or a point fixed to
    /// a body's surface (a ground station, or a craft that is landed).
    /// </summary>
    public sealed class PlanNode
    {
        private PlanNode(
            string id, int bodyIndex, PropagationTarget? orbit, SecularOrbit? secular, RotatingGroundStation? surface, double? validUntilUt)
        {
            Id = id;
            BodyIndex = bodyIndex;
            Orbit = orbit;
            Secular = secular;
            Surface = surface;
            ValidUntilUt = validUntilUt;
        }

        /// <summary>The node's id, in the <c>commandCentre.roster</c> vocabulary (<c>"ground:&lt;name&gt;"</c>, <c>"vessel:&lt;guid&gt;"</c>).</summary>
        public string Id { get; }

        /// <summary>The body the node orbits, or stands on.</summary>
        public int BodyIndex { get; }

        /// <summary>The node's orbit, for a craft that is not fixed to a surface.</summary>
        public PropagationTarget? Orbit { get; }

        /// <summary>The drift the node's orbit is carried forward with, or null to carry it on its conic.</summary>
        public SecularOrbit? Secular { get; }

        /// <summary>The node's place on its body, for one fixed to the surface.</summary>
        public RotatingGroundStation? Surface { get; }

        /// <summary>How far ahead the node's position can be trusted, or null for the whole plan.</summary>
        public double? ValidUntilUt { get; }

        /// <summary>A craft on its orbit around <paramref name="orbit"/>'s parent body.</summary>
        public static PlanNode Orbiting(string id, PropagationTarget orbit, double? validUntilUt = null) =>
            new PlanNode(id, orbit.ParentBodyIndex, orbit, null, null, validUntilUt);

        /// <summary>
        /// A craft around <paramref name="orbit"/>'s parent body whose orbit drifts
        /// as <paramref name="secular"/> says. It is trusted no further than the
        /// sooner of <paramref name="validUntilUt"/> and the seed's own span.
        /// </summary>
        public static PlanNode Drifting(string id, PropagationTarget orbit, SecularOrbit secular, double? validUntilUt = null) =>
            new PlanNode(id, orbit.ParentBodyIndex, orbit, secular, null, Sooner(validUntilUt, secular.ValidUntilUt));

        /// <summary>A point fixed to the surface of body <paramref name="bodyIndex"/>.</summary>
        public static PlanNode OnSurface(string id, int bodyIndex, RotatingGroundStation surface) =>
            new PlanNode(id, bodyIndex, null, null, surface, null);

        private static double? Sooner(double? a, double? b) =>
            a == null ? b : b == null ? a : Math.Min(a.Value, b.Value);
    }

    /// <summary>Two nodes the plan predicts contact between, with what can block or limit their link.</summary>
    public sealed class PlanPair
    {
        public PlanPair(string a, string b, IReadOnlyList<OccludingBody> occluders, double? maxRangeMeters, IContactLinkModel? link = null)
        {
            A = a;
            B = b;
            Occluders = occluders ?? new OccludingBody[0];
            MaxRangeMeters = maxRangeMeters;
            Link = link;
        }

        /// <summary>One end, by <see cref="PlanNode.Id"/>.</summary>
        public string A { get; }

        /// <summary>The other end, by <see cref="PlanNode.Id"/>.</summary>
        public string B { get; }

        /// <summary>The bodies that can come between the two ends, each with the radius the comms model blocks at.</summary>
        public IReadOnlyList<OccludingBody> Occluders { get; }

        /// <summary>How far the elected comms model carries this link: null for no limit, 0 for none at all.</summary>
        public double? MaxRangeMeters { get; }

        /// <summary>
        /// What the backend says about the link beyond line of sight: where its
        /// dishes point and how wide they see. When present it replaces
        /// <see cref="MaxRangeMeters"/>, whose range it already includes.
        /// </summary>
        public IContactLinkModel? Link { get; }
    }

    /// <summary>One predicted stretch of contact between a pair.</summary>
    public readonly struct ContactWindow
    {
        public ContactWindow(double? openUt, double? closeUt)
        {
            OpenUt = openUt;
            CloseUt = closeUt;
        }

        /// <summary>When contact begins, or null when it is already open at the start of the plan.</summary>
        public double? OpenUt { get; }

        /// <summary>When contact ends, or null when it is still open at the end of the pair's horizon.</summary>
        public double? CloseUt { get; }
    }

    /// <summary>A pair's predicted windows over its horizon.</summary>
    public sealed class PairPlan
    {
        /// <summary>The speed of light, in metres per second.</summary>
        public const double SpeedOfLight = 299_792_458.0;

        private readonly double _fromUt;
        private readonly double _stepSeconds;
        private readonly double[] _separation;

        /// <param name="separationMeters">
        /// The pair's separation at each grid point from <paramref name="fromUt"/>,
        /// <paramref name="stepSeconds"/> apart, which is what a light time is read
        /// from. Empty for a pair planned without it.
        /// </param>
        public PairPlan(
            string a,
            string b,
            double horizonUt,
            IReadOnlyList<ContactWindow> windows,
            double fromUt = 0.0,
            double stepSeconds = 0.0,
            double[]? separationMeters = null)
        {
            A = a;
            B = b;
            HorizonUt = horizonUt;
            Windows = windows;
            _fromUt = fromUt;
            _stepSeconds = stepSeconds;
            _separation = separationMeters ?? new double[0];
        }

        /// <summary>
        /// The pair's separation at <paramref name="ut"/>, in metres, interpolated
        /// between the grid points it was planned on, or null outside them.
        /// </summary>
        public double? SeparationAt(double ut)
        {
            if (_separation.Length == 0 || !(_stepSeconds > 0.0))
            {
                return null;
            }
            var position = (ut - _fromUt) / _stepSeconds;
            if (double.IsNaN(position) || position < 0.0 || position > _separation.Length - 1)
            {
                return null;
            }
            var below = (int)Math.Floor(position);
            if (below >= _separation.Length - 1)
            {
                return _separation[_separation.Length - 1];
            }
            var fraction = position - below;
            return _separation[below] + ((_separation[below + 1] - _separation[below]) * fraction);
        }

        public string A { get; }

        public string B { get; }

        /// <summary>The last instant this pair is predicted for: the plan's horizon, or sooner where either end cannot be propagated that far.</summary>
        public double HorizonUt { get; }

        /// <summary>Every window of contact up to <see cref="HorizonUt"/>, in time order. Empty when the pair never has contact in that span.</summary>
        public IReadOnlyList<ContactWindow> Windows { get; }
    }

    /// <summary>The predicted contact windows for every pair asked about, and what it cost to work them out.</summary>
    public sealed class ContactPlan
    {
        public ContactPlan(double fromUt, double horizonUt, double stepSeconds, IReadOnlyList<PairPlan> pairs, long positionSolves, long marginEvaluations)
        {
            FromUt = fromUt;
            HorizonUt = horizonUt;
            StepSeconds = stepSeconds;
            Pairs = pairs;
            PositionSolves = positionSolves;
            MarginEvaluations = marginEvaluations;
        }

        public double FromUt { get; }

        public double HorizonUt { get; }

        /// <summary>The sweep step: no window shorter than twice this is guaranteed to be found.</summary>
        public double StepSeconds { get; }

        public IReadOnlyList<PairPlan> Pairs { get; }

        /// <summary>How many positions were solved through the propagator, the term that dominates the cost.</summary>
        public long PositionSolves { get; }

        /// <summary>How many pair margins were evaluated, on the grid and while refining crossings.</summary>
        public long MarginEvaluations { get; }
    }

    /// <summary>
    /// Predicts when each pair of nodes can talk, by sweeping a continuous
    /// margin (worst occluder, reach) over a shared time grid.
    ///
    /// <para>Positions on the grid are solved once per node and shared by every
    /// pair the node is in, because with many nodes the propagator, not the
    /// geometry, is the cost: a pair-at-a-time sweep would solve each node once
    /// per pair it belongs to. Only the bisection that refines a crossing solves
    /// off the grid.</para>
    ///
    /// <para>KSP-free and thread-free: every input is captured before the call,
    /// so it can run anywhere.</para>
    /// </summary>
    public static class ContactPlanner
    {
        /// <summary>Grid samples per shortest cycle among the nodes: enough to see a window a seventy-second of a cycle long.</summary>
        public const int StepsPerShortestCycle = 72;

        /// <summary>The grid's sample cap per plan; a longer horizon or a faster node widens the step instead.</summary>
        public const int MaxGridSamples = 20_000;

        /// <summary>The finest step worth sweeping at, in seconds.</summary>
        public const double MinStepSeconds = 1.0;

        /// <summary>
        /// The grid step for these nodes over <paramref name="horizonSeconds"/>:
        /// the shortest orbital or rotation cycle divided by
        /// <see cref="StepsPerShortestCycle"/>, no finer than
        /// <see cref="MinStepSeconds"/> and no finer than the sample cap allows.
        /// </summary>
        public static double StepFor(IReadOnlyList<PlanNode> nodes, IPropagationProvider propagator, double horizonSeconds)
        {
            double? shortest = null;
            foreach (var node in nodes)
            {
                double? cycle = node.Orbit != null
                    ? propagator.CharacteristicCycleSeconds(node.Orbit.Value)
                    : Math.Abs(node.Surface!.Value.RotationPeriodSeconds);
                if (cycle != null && cycle.Value > 0.0 && !double.IsInfinity(cycle.Value)
                    && (shortest == null || cycle.Value < shortest.Value))
                {
                    shortest = cycle.Value;
                }
            }

            var step = shortest == null ? horizonSeconds / MaxGridSamples : shortest.Value / StepsPerShortestCycle;
            step = Math.Max(step, MinStepSeconds);
            return Math.Max(step, horizonSeconds / MaxGridSamples);
        }

        /// <summary>
        /// Predicts every pair's contact windows from <paramref name="fromUt"/>
        /// over <paramref name="horizonSeconds"/>, in a frame centred on body
        /// <paramref name="frameBodyIndex"/>. A pair naming an unknown node is
        /// skipped rather than guessed at.
        /// </summary>
        public static ContactPlan Plan(
            IReadOnlyList<PlanNode> nodes,
            IReadOnlyList<PlanPair> pairs,
            IPropagationProvider propagator,
            int frameBodyIndex,
            double fromUt,
            double horizonSeconds,
            double stepSeconds,
            double refinementToleranceSeconds)
        {
            if (propagator == null) throw new ArgumentNullException(nameof(propagator));
            if (!(stepSeconds > 0.0) || double.IsInfinity(stepSeconds))
            {
                throw new ArgumentOutOfRangeException(nameof(stepSeconds), "The step must be finite and strictly positive; got " + stepSeconds);
            }

            var gridCount = (int)Math.Ceiling(horizonSeconds / stepSeconds);
            var horizonUt = fromUt + (gridCount * stepSeconds);
            var frame = PropagationFrame.CentredOn(frameBodyIndex);
            var cache = new PositionCache(Carried(nodes, propagator, frame, fromUt, horizonUt), propagator, frame, fromUt, stepSeconds, gridCount);

            var plans = new List<PairPlan>();
            foreach (var pair in pairs)
            {
                if (!cache.Has(pair.A) || !cache.Has(pair.B))
                {
                    continue;
                }

                var pairHorizonUt = Math.Min(horizonUt, Math.Min(cache.ValidUntil(pair.A), cache.ValidUntil(pair.B)));
                if (pairHorizonUt <= fromUt)
                {
                    plans.Add(new PairPlan(pair.A, pair.B, fromUt, new ContactWindow[0]));
                    continue;
                }

                // Back off to the last grid point so every sweep sample lands on the cache.
                var lastIndex = (int)Math.Floor(((pairHorizonUt - fromUt) / stepSeconds) + 1e-9);
                var sweepEnd = lastIndex == 0 ? pairHorizonUt : fromUt + (lastIndex * stepSeconds);
                var geometry = new PairGeometry(cache, pair);
                var result = VisibilitySweep.Run(geometry, fromUt, sweepEnd, stepSeconds, refinementToleranceSeconds);
                // At least two samples, so a pair whose horizon falls inside the
                // first step still has a light time across it.
                var samples = Math.Max(lastIndex, 1);
                var separation = new double[samples + 1];
                for (var g = 0; g <= samples; g++)
                {
                    separation[g] = geometry.SeparationAt(fromUt + (g * stepSeconds));
                }
                plans.Add(new PairPlan(pair.A, pair.B, sweepEnd, WindowsOf(result), fromUt, stepSeconds, separation));
            }

            return new ContactPlan(fromUt, horizonUt, stepSeconds, plans, cache.Solves, cache.MarginEvaluations);
        }

        /// <summary>
        /// The nodes the propagator can carry across the plan. A craft it cannot
        /// (one escaping on a hyperbola, under a solver that only follows closed
        /// orbits) is left out, so its pairs go unpredicted rather than sinking
        /// every other pair's plan with it.
        /// </summary>
        private static List<PlanNode> Carried(
            IReadOnlyList<PlanNode> nodes, IPropagationProvider propagator, PropagationFrame frame, double fromUt, double horizonUt)
        {
            var carried = new List<PlanNode>(nodes.Count);
            foreach (var node in nodes)
            {
                if (node.Orbit == null || propagator.CanPropagate(node.Orbit.Value, frame, fromUt, horizonUt))
                {
                    carried.Add(node);
                }
            }
            return carried;
        }

        private static IReadOnlyList<ContactWindow> WindowsOf(VisibilitySweepResult result)
        {
            var windows = new List<ContactWindow>();
            double? openedAt = null;
            var open = result.ClearAtStart;
            foreach (var change in result.Changes)
            {
                if (change.BecameClear == open)
                {
                    continue;
                }
                open = change.BecameClear;
                if (open)
                {
                    openedAt = change.Ut;
                    continue;
                }
                windows.Add(new ContactWindow(openedAt, change.Ut));
                openedAt = null;
            }
            if (open)
            {
                windows.Add(new ContactWindow(openedAt, null));
            }
            return windows;
        }

        /// <summary>
        /// Every node's position, and every occluding body's, at each grid
        /// instant, solved the first time a pair asks and kept for the rest.
        /// </summary>
        private sealed class PositionCache : IContactPositions
        {
            private readonly Dictionary<string, int> _index = new Dictionary<string, int>();
            private readonly PlanNode[] _nodes;
            private readonly Vector3d?[][] _nodeAt;
            private readonly Dictionary<int, Vector3d?[]> _bodyAt = new Dictionary<int, Vector3d?[]>();
            private readonly IPropagationProvider _propagator;
            private readonly PropagationFrame _frame;
            private readonly double _fromUt;
            private readonly double _step;
            private readonly int _count;

            public PositionCache(IReadOnlyList<PlanNode> nodes, IPropagationProvider propagator, PropagationFrame frame, double fromUt, double step, int count)
            {
                _nodes = new PlanNode[nodes.Count];
                _nodeAt = new Vector3d?[nodes.Count][];
                for (var i = 0; i < nodes.Count; i++)
                {
                    _nodes[i] = nodes[i];
                    _index[nodes[i].Id] = i;
                    _nodeAt[i] = new Vector3d?[count + 1];
                }
                _propagator = propagator;
                _frame = frame;
                _fromUt = fromUt;
                _step = step;
                _count = count;
            }

            public long Solves { get; private set; }

            public long MarginEvaluations { get; set; }

            public bool Has(string id) => _index.ContainsKey(id);

            Vector3d? IContactPositions.NodeAt(string nodeId, double ut) => Has(nodeId) ? NodeAt(nodeId, ut) : (Vector3d?)null;

            public double ValidUntil(string id) => _nodes[_index[id]].ValidUntilUt ?? double.PositiveInfinity;

            public Vector3d NodeAt(string id, double ut)
            {
                var n = _index[id];
                var g = GridIndex(ut);
                if (g < 0)
                {
                    return SolveNode(_nodes[n], ut);
                }
                var cached = _nodeAt[n][g];
                if (cached == null)
                {
                    cached = SolveNode(_nodes[n], ut);
                    _nodeAt[n][g] = cached;
                }
                return cached.Value;
            }

            public Vector3d BodyAt(int bodyIndex, double ut)
            {
                var g = GridIndex(ut);
                if (g < 0)
                {
                    return SolveBody(bodyIndex, ut);
                }
                if (!_bodyAt.TryGetValue(bodyIndex, out var row))
                {
                    row = new Vector3d?[_count + 1];
                    _bodyAt[bodyIndex] = row;
                }
                var cached = row[g];
                if (cached == null)
                {
                    cached = SolveBody(bodyIndex, ut);
                    row[g] = cached;
                }
                return cached.Value;
            }

            /// <summary>The grid index <paramref name="ut"/> sits exactly on, or -1 for an instant between grid points.</summary>
            private int GridIndex(double ut)
            {
                var exact = (ut - _fromUt) / _step;
                var g = (int)Math.Round(exact);
                if (g < 0 || g > _count)
                {
                    return -1;
                }
                return Math.Abs((_fromUt + (g * _step)) - ut) <= 1e-9 * Math.Max(1.0, Math.Abs(ut)) ? g : -1;
            }

            private Vector3d SolveNode(PlanNode node, double ut)
            {
                if (node.Orbit != null)
                {
                    Solves++;
                    var orbit = node.Orbit.Value;
                    var target = node.Secular == null
                        ? orbit
                        : PropagationTarget.Vessel(node.Id, orbit.ParentBodyIndex, node.Secular.Value.ElementsAt(ut));
                    return _propagator.Solve(target, _frame, ut).Position;
                }
                return BodyAt(node.BodyIndex, ut) + node.Surface!.Value.PositionAt(ut);
            }

            private Vector3d SolveBody(int bodyIndex, double ut)
            {
                Solves++;
                return _propagator.Solve(PropagationTarget.Body(bodyIndex), _frame, ut).Position;
            }
        }

        /// <summary>One pair's continuous margin: the worst occluder's horizon margin, cut by the link's reach.</summary>
        private sealed class PairGeometry : IVisibilityGeometry
        {
            private readonly PositionCache _cache;
            private readonly PlanPair _pair;
            private bool _linkFailed;

            public PairGeometry(PositionCache cache, PlanPair pair)
            {
                _cache = cache;
                _pair = pair;
            }

            public double MarginAt(double ut)
            {
                _cache.MarginEvaluations++;
                var a = _cache.NodeAt(_pair.A, ut);
                var b = _cache.NodeAt(_pair.B, ut);
                var margin = double.PositiveInfinity;
                foreach (var occluder in _pair.Occluders)
                {
                    var m = ChordOcclusion.HorizonMargin(a, b, _cache.BodyAt(occluder.BodyIndex, ut), occluder.OccludingRadiusMeters);
                    if (m < margin)
                    {
                        margin = m;
                    }
                }
                var link = LinkMarginAt(ut, a, b) ?? RangeReach.MarginAt(_pair.MaxRangeMeters, (a - b).Magnitude());
                if (link != null && link.Value < margin)
                {
                    margin = link.Value;
                }
                return double.IsPositiveInfinity(margin) ? 1.0 : margin;
            }

            public double SeparationAt(double ut) => (_cache.NodeAt(_pair.A, ut) - _cache.NodeAt(_pair.B, ut)).Magnitude();

            /// <summary>
            /// The backend's link margin, or null to fall back to reach. A link model
            /// that throws, or answers with something that is not a number, is
            /// dropped for the rest of the plan: its pair is planned on geometry, as
            /// it would be under a backend with no link model, rather than taking
            /// every other pair down with it.
            /// </summary>
            private double? LinkMarginAt(double ut, Vector3d a, Vector3d b)
            {
                if (_pair.Link == null || _linkFailed)
                {
                    return null;
                }
                try
                {
                    var margin = _pair.Link.MarginAt(ut, a, b, _cache);
                    if (!double.IsNaN(margin) && !double.IsInfinity(margin))
                    {
                        return margin;
                    }
                }
                catch (Exception)
                {
                }
                _linkFailed = true;
                return null;
            }
        }
    }
}
