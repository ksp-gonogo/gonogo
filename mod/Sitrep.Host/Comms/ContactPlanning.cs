using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;

namespace Sitrep.Host.Comms
{
    /// <summary>Everything one plan needs, as data, so the plan can run on any thread.</summary>
    public sealed class ContactPlanRequest
    {
        public ContactPlanRequest(
            IReadOnlyList<PlanNode> nodes,
            IReadOnlyList<PlanPair> pairs,
            IPropagationProvider propagator,
            int frameBodyIndex,
            double fromUt,
            double horizonSeconds,
            IReadOnlyCollection<string>? unsettled = null,
            IRetargetModel? retarget = null)
        {
            Retarget = retarget;
            Nodes = nodes;
            Pairs = pairs;
            Propagator = propagator;
            FrameBodyIndex = frameBodyIndex;
            FromUt = fromUt;
            HorizonSeconds = horizonSeconds;
            Unsettled = unsettled ?? new string[0];
        }

        public IReadOnlyList<PlanNode> Nodes { get; }

        public IReadOnlyList<PlanPair> Pairs { get; }

        /// <summary>What turning each craft's idle dishes could do, from the states the plan was made of, or null when no craft would turn one.</summary>
        public IRetargetModel? Retarget { get; }

        public IPropagationProvider Propagator { get; }

        public int FrameBodyIndex { get; }

        public double FromUt { get; }

        public double HorizonSeconds { get; }

        /// <summary>The nodes reckoned on an orbit that was still changing when it was read, by id.</summary>
        public IReadOnlyCollection<string> Unsettled { get; }

        /// <summary>
        /// Whether this would plan the same contacts as <paramref name="other"/>:
        /// the same nodes going the same way, and the same pairs over the same
        /// links. A craft is going the same way when both requests remember it
        /// under the same object; a surface node, which is remembered under none,
        /// when it has the same id.
        /// </summary>
        public bool Matches(ContactPlanRequest other)
        {
            if (!SameRetarget(Retarget, other.Retarget))
            {
                return false;
            }
            if (Nodes.Count != other.Nodes.Count
                || Pairs.Count != other.Pairs.Count
                || FrameBodyIndex != other.FrameBodyIndex
                || !new HashSet<string>(Unsettled).SetEquals(other.Unsettled))
            {
                return false;
            }
            for (var i = 0; i < Nodes.Count; i++)
            {
                var a = Nodes[i];
                var b = other.Nodes[i];
                if (a.Id != b.Id || a.BodyIndex != b.BodyIndex || !ReferenceEquals(a.Remembered, b.Remembered) || a.ValidUntilUt != b.ValidUntilUt)
                {
                    return false;
                }
            }
            for (var i = 0; i < Pairs.Count; i++)
            {
                var a = Pairs[i];
                var b = other.Pairs[i];
                if (a.A != b.A || a.B != b.B || a.MaxRangeMeters != b.MaxRangeMeters || !Equals(a.Link, b.Link))
                {
                    return false;
                }
            }
            return true;
        }

        private static bool SameRetarget(IRetargetModel? a, IRetargetModel? b)
        {
            if (ReferenceEquals(a, b))
            {
                return true;
            }
            if (!(a is CompositeRetargetModel x) || !(b is CompositeRetargetModel y) || x.Models.Count != y.Models.Count)
            {
                return false;
            }
            foreach (var entry in x.Models)
            {
                if (!y.Models.TryGetValue(entry.Key, out var other) || !ReferenceEquals(entry.Value, other))
                {
                    return false;
                }
            }
            return true;
        }

        /// <summary>The grid step this plan would choose for itself.</summary>
        public double Step() => ContactPlanner.StepFor(Nodes, Propagator, HorizonSeconds);

        /// <summary>
        /// Runs the plan this request describes. Given
        /// <paramref name="remembered"/>, it runs on that grid, starting at the
        /// grid instant at or before <see cref="FromUt"/>, and shares the
        /// positions it solves with every other plan run on it.
        /// </summary>
        public ContactPlan Run(PlanPositions? remembered = null)
        {
            var step = remembered?.StepSeconds ?? Step();
            var fromUt = remembered == null ? FromUt : ContactPlanner.OnGrid(FromUt, step);
            return ContactPlanner.Plan(
                Nodes, Pairs, Propagator, FrameBodyIndex, fromUt, HorizonSeconds, step, ContactPlanSchedule.EdgeToleranceSeconds, remembered, Retarget);
        }
    }

    /// <summary>
    /// The numbers that say when a contact plan, and the craft states it is
    /// made of, are out of date. Comparing orbits rather than positions is what
    /// keeps an n-body propagator, which rewrites a craft's osculating elements
    /// a little every frame, from re-reading every craft every frame: the
    /// tolerances are far wider than that wobble and far narrower than any
    /// burn.
    /// </summary>
    public static class ContactPlanSchedule
    {
        /// <summary>How far ahead a plan predicts.</summary>
        public const double HorizonSeconds = 6 * 3600.0;

        /// <summary>
        /// The least game time between two readings of a craft whose orbit is
        /// moving, and between two plans for a centre whose news is of orbits
        /// that moved. A burn moves the orbit every tick, and a plan made
        /// mid-burn is stale by the next one; a craft arriving or leaving still
        /// re-plans at once.
        /// </summary>
        public const double MinDriftReplanSeconds = 10.0;

        /// <summary>How finely a window's edges are placed.</summary>
        public const double EdgeToleranceSeconds = 1.0;

        /// <summary>The relative change in semi-major axis that counts as a new orbit.</summary>
        public const double SmaTolerance = 1e-4;

        /// <summary>The change in eccentricity that counts as a new orbit.</summary>
        public const double EccTolerance = 1e-4;

        /// <summary>The change in inclination, node or periapsis argument, in radians, that counts as a new orbit.</summary>
        public const double AngleTolerance = 1e-3;

        /// <summary>How far a landed craft or a ground station may move, in metres, before what was read of it is out of date.</summary>
        public const double SurfaceToleranceMeters = 1_000.0;

        /// <summary>
        /// Whether <paramref name="now"/> is a different orbit from
        /// <paramref name="was"/>, past the tolerances above.
        ///
        /// <para>Size and shape are compared as they are. Where the orbit lies
        /// and where the craft is on it are compared by where each set of
        /// elements puts the craft, at the newer epoch and a quarter and half
        /// a turn on, and not angle by angle: the argument of periapsis of a
        /// circular orbit and the node of an equatorial one are not defined,
        /// and the game's values for them wander by degrees from one reading
        /// to the next while the craft goes round the same circle. Read angle
        /// by angle, a coasting craft on such an orbit looked as though it was
        /// burning every ten seconds.</para>
        /// </summary>
        public static bool Moved(OrbitElements was, OrbitElements now)
        {
            if (Math.Abs(now.Sma - was.Sma) > SmaTolerance * Math.Abs(was.Sma)
                || Math.Abs(now.Ecc - was.Ecc) > EccTolerance)
            {
                return true;
            }
            var closed = was.Ecc >= 0.0 && was.Ecc < 1.0 && now.Ecc >= 0.0 && now.Ecc < 1.0
                && was.Sma > 0.0 && now.Sma > 0.0 && was.Mu > 0.0 && now.Mu > 0.0;
            if (!closed)
            {
                // No period to step round, so the angles are all there is to compare.
                return AngleApart(now.Inc, was.Inc) > AngleTolerance
                    || AngleApart(now.Lan, was.Lan) > AngleTolerance
                    || AngleApart(now.ArgPe, was.ArgPe) > AngleTolerance;
            }
            var period = 2.0 * Math.PI * Math.Sqrt(now.Sma * now.Sma * now.Sma / now.Mu);
            var apart = AngleTolerance * Math.Abs(was.Sma);
            foreach (var turn in new[] { 0.0, 0.25, 0.5 })
            {
                var ut = now.Epoch + (turn * period);
                var gap = Sitrep.Propagation.KeplerProvider.StateFrom(now, ut).Position
                    - Sitrep.Propagation.KeplerProvider.StateFrom(was, ut).Position;
                if (gap.Magnitude() > apart)
                {
                    return true;
                }
            }
            return false;
        }

        private static double AngleApart(double a, double b)
        {
            var d = Math.Abs(a - b) % (2.0 * Math.PI);
            return d > Math.PI ? (2.0 * Math.PI) - d : d;
        }
    }

    /// <summary>
    /// Runs one round of contact plans at a time off the calling thread, one
    /// plan per command centre, and hands back the finished round. A plan for a
    /// busy save takes tens of milliseconds, which is too long to hold the
    /// Courier thread for.
    ///
    /// <para>Each plan runs on the grid its own nodes choose, and plans on the
    /// same grid share the positions they solve, from one round to the next. So
    /// two centres that have heard the same news solve each craft once between
    /// them, and a centre re-planning for news of one craft solves only that
    /// craft again. A centre's grid is never chosen from what another centre
    /// has heard.</para>
    /// </summary>
    public sealed class ContactPlanRunner
    {
        private int _running;
        private IReadOnlyDictionary<string, ContactPlan>? _finished;

        // Touched only by the round that is running, and one runs at a time.
        private readonly List<PlanPositions> _positions = new List<PlanPositions>();

        /// <summary>The most positions kept on one grid between rounds; past it that grid is forgotten and solved again as asked for.</summary>
        public const long MaxPositionsKept = 4_000_000;

        /// <summary>The most grids kept between rounds. Centres that disagree about which craft orbits fastest plan on different grids, and few do at once.</summary>
        public const int MaxGridsKept = 4;

        /// <summary>
        /// Starts a round of plans, unless one is already running. Returns
        /// whether it started. With <paramref name="inline"/> the round has also
        /// finished by the time this returns.
        /// </summary>
        /// <param name="byCentre">The plan to run for each centre.</param>
        /// <param name="live">Every remembered node any centre still plans from; positions of the rest are forgotten.</param>
        public bool Offer(
            IReadOnlyDictionary<string, ContactPlanRequest> byCentre,
            ICollection<object> live,
            Action<Exception>? onFailure = null,
            bool inline = false)
        {
            if (Interlocked.CompareExchange(ref _running, 1, 0) != 0)
            {
                return false;
            }
            Action run = () =>
            {
                try
                {
                    Volatile.Write(ref _finished, Run(byCentre, live));
                }
                catch (Exception ex)
                {
                    onFailure?.Invoke(ex);
                }
                finally
                {
                    Volatile.Write(ref _running, 0);
                }
            };
            if (inline)
            {
                run();
                return true;
            }
            Task.Run(run);
            return true;
        }

        private IReadOnlyDictionary<string, ContactPlan> Run(
            IReadOnlyDictionary<string, ContactPlanRequest> byCentre, ICollection<object> live)
        {
            var earliest = double.PositiveInfinity;
            foreach (var request in byCentre.Values)
            {
                earliest = Math.Min(earliest, request.FromUt);
            }
            _positions.RemoveAll(grid => grid.Count > MaxPositionsKept);
            foreach (var grid in _positions)
            {
                grid.Keep(live, earliest);
            }

            var plans = new Dictionary<string, ContactPlan>(StringComparer.Ordinal);
            foreach (var entry in byCentre)
            {
                plans[entry.Key] = entry.Value.Run(GridFor(entry.Value));
            }
            return plans;
        }

        /// <summary>The kept grid <paramref name="request"/> would choose for itself, most recently used last.</summary>
        private PlanPositions GridFor(ContactPlanRequest request)
        {
            var step = request.Step();
            var grid = _positions.Find(kept => kept.FrameBodyIndex == request.FrameBodyIndex && kept.StepSeconds == step);
            if (grid != null)
            {
                _positions.Remove(grid);
            }
            grid ??= new PlanPositions(request.FrameBodyIndex, step);
            _positions.Add(grid);
            if (_positions.Count > MaxGridsKept)
            {
                _positions.RemoveAt(0);
            }
            return grid;
        }

        /// <summary>The round that finished since the last call, if any.</summary>
        public bool TryTake(out IReadOnlyDictionary<string, ContactPlan>? plans)
        {
            plans = Interlocked.Exchange(ref _finished, null);
            return plans != null;
        }

        /// <summary>Whether a round is running now.</summary>
        public bool Running => Volatile.Read(ref _running) != 0;
    }

    /// <summary>
    /// A craft's secular seed, asked of whichever provider offers one, and kept
    /// only if a plan can carry it: a provider that throws, or hands back a seed on
    /// an open orbit, with a rate that is not a number, or a span already over,
    /// leaves the craft on its conic rather than sinking or poisoning the plan.
    /// </summary>
    public static class ContactSeeds
    {
        public static SecularOrbit? Read(ISecularPropagation? provider, PropagationTarget target, double ut)
        {
            if (provider == null)
            {
                return null;
            }
            SecularOrbit? seed;
            try
            {
                seed = provider.SecularOrbitFor(target, ut);
            }
            catch (Exception)
            {
                return null;
            }
            return seed != null && Usable(seed.Value, ut) ? seed : null;
        }

        /// <summary>Whether a plan starting at <paramref name="ut"/> can carry <paramref name="seed"/>.</summary>
        public static bool Usable(SecularOrbit seed, double ut)
        {
            var anchor = seed.Anchor;
            return anchor.Sma > 0.0 && anchor.Ecc >= 0.0 && anchor.Ecc < 1.0 && anchor.Mu > 0.0
                && Finite(anchor.Inc) && Finite(anchor.Lan) && Finite(anchor.ArgPe)
                && Finite(anchor.MeanAnomalyAtEpoch) && Finite(anchor.Epoch)
                && Finite(seed.NodeRate) && Finite(seed.PeriapsisRate) && Finite(seed.MeanAnomalyRate)
                && (seed.ValidUntilUt == null || seed.ValidUntilUt.Value > ut);
        }

        private static bool Finite(double x) => !double.IsNaN(x) && !double.IsInfinity(x);
    }

    /// <summary>A contact plan as the <c>comms.contacts</c> channel carries it.</summary>
    public static class ContactPlanWire
    {
        /// <param name="plan">The plan.</param>
        /// <param name="unsettled">The nodes reckoned on an orbit that was still changing when it was read: every pair with one as an end is marked low confidence.</param>
        public static CommsContacts ToPayload(ContactPlan plan, IReadOnlyCollection<string>? unsettled = null)
        {
            var rough = new HashSet<string>(unsettled ?? new string[0], StringComparer.Ordinal);
            var payload = new CommsContacts
            {
                HorizonUt = plan.HorizonUt,
            };
            foreach (var pair in plan.Pairs)
            {
                var wire = new CommsContactPair
                {
                    A = pair.A,
                    B = pair.B,
                    HorizonUt = pair.HorizonUt,
                    LowConfidence = rough.Contains(pair.A) || rough.Contains(pair.B),
                };
                foreach (var window in pair.Windows)
                {
                    wire.Windows.Add(new CommsContactWindow { OpenUt = window.OpenUt, CloseUt = window.CloseUt, FromDish = window.FromDish, ToDish = window.ToDish });
                }
                foreach (var turn in pair.RetargetWindows)
                {
                    wire.RetargetWindows.Add(new CommsRetargetWindow { Node = turn.NodeId, Dish = turn.DishId, Peer = turn.PeerId, OpenUt = turn.OpenUt, CloseUt = turn.CloseUt });
                }
                payload.Pairs.Add(wire);
            }
            return payload;
        }
    }
}
