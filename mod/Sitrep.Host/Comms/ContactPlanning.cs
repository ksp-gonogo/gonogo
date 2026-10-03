using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What one node looked like when a plan was asked for, compact enough to
    /// compare every tick: its id, the body it orbits or stands on, and its
    /// orbit or its place on the surface.
    /// </summary>
    public readonly struct ContactNodeFingerprint
    {
        public ContactNodeFingerprint(string id, int bodyIndex, OrbitElements? orbit, RotatingGroundStation? surface = null)
        {
            Id = id;
            BodyIndex = bodyIndex;
            Orbit = orbit;
            SurfacePoint = surface?.PositionAt(0.0);
        }

        public string Id { get; }

        public int BodyIndex { get; }

        /// <summary>The node's orbit, or null for one fixed to a surface.</summary>
        public OrbitElements? Orbit { get; }

        /// <summary>Where a surface node stands, as its position at UT 0, so two fingerprints of one place compare equal at any time.</summary>
        public Vector3d? SurfacePoint { get; }
    }

    /// <summary>Everything one plan needs, captured on the main thread so the plan can run anywhere.</summary>
    public sealed class ContactPlanRequest
    {
        public ContactPlanRequest(
            IReadOnlyList<PlanNode> nodes,
            IReadOnlyList<PlanPair> pairs,
            IPropagationProvider propagator,
            int frameBodyIndex,
            double fromUt,
            double horizonSeconds,
            IReadOnlyList<ContactNodeFingerprint> fingerprint)
        {
            Nodes = nodes;
            Pairs = pairs;
            Propagator = propagator;
            FrameBodyIndex = frameBodyIndex;
            FromUt = fromUt;
            HorizonSeconds = horizonSeconds;
            Fingerprint = fingerprint;
        }

        public IReadOnlyList<PlanNode> Nodes { get; }

        public IReadOnlyList<PlanPair> Pairs { get; }

        public IPropagationProvider Propagator { get; }

        public int FrameBodyIndex { get; }

        public double FromUt { get; }

        public double HorizonSeconds { get; }

        public IReadOnlyList<ContactNodeFingerprint> Fingerprint { get; }

        /// <summary>Runs the plan this request describes.</summary>
        public ContactPlan Run()
        {
            var step = ContactPlanner.StepFor(Nodes, Propagator, HorizonSeconds);
            return ContactPlanner.Plan(
                Nodes, Pairs, Propagator, FrameBodyIndex, FromUt, HorizonSeconds, step, ContactPlanSchedule.EdgeToleranceSeconds);
        }
    }

    /// <summary>
    /// When the contact plan is out of date: never planned, a node arrived or
    /// left, an orbit or a surface node moved past the plan's tolerance, or half
    /// the horizon has passed. Comparing orbits rather than positions is what keeps an n-body
    /// propagator, which rewrites a craft's osculating elements a little every
    /// frame, from re-planning every frame: the tolerances are far wider than
    /// that wobble and far narrower than any burn.
    /// </summary>
    public sealed class ContactPlanSchedule
    {
        /// <summary>How far ahead a plan predicts.</summary>
        public const double HorizonSeconds = 6 * 3600.0;

        /// <summary>
        /// The least game time between two plans made for an orbit that moved.
        /// A burn moves the orbit every tick, and a plan made mid-burn is stale
        /// by the next one; a node arriving or leaving still re-plans at once.
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

        /// <summary>How far a landed craft may move, in metres, before its plan is out of date.</summary>
        public const double SurfaceToleranceMeters = 1_000.0;

        /// <summary>The last plan asked for, swapped whole so a failure on another thread can forget it safely.</summary>
        private sealed class PlannedState
        {
            public PlannedState(IReadOnlyList<ContactNodeFingerprint> fingerprint, double fromUt)
            {
                Fingerprint = fingerprint;
                FromUt = fromUt;
            }

            public IReadOnlyList<ContactNodeFingerprint> Fingerprint { get; }

            public double FromUt { get; }
        }

        private PlannedState? _planned;

        /// <summary>Whether a plan should be made now for nodes looking like <paramref name="current"/>.</summary>
        public bool Due(IReadOnlyList<ContactNodeFingerprint> current, double nowUt)
        {
            var planned = Volatile.Read(ref _planned);
            if (planned == null)
            {
                return true;
            }
            if (nowUt >= planned.FromUt + (HorizonSeconds / 2.0) || nowUt < planned.FromUt)
            {
                return true;
            }
            if (!SameNodes(planned.Fingerprint, current))
            {
                return true;
            }
            return nowUt >= planned.FromUt + MinDriftReplanSeconds && !Same(planned.Fingerprint, current);
        }

        /// <summary>Records that a plan was started from <paramref name="request"/>.</summary>
        public void Planned(ContactPlanRequest request) =>
            Volatile.Write(ref _planned, new PlannedState(request.Fingerprint, request.FromUt));

        /// <summary>Forgets the last plan, so the next look makes one: for a plan that failed. Safe from any thread.</summary>
        public void Forget() => Volatile.Write(ref _planned, null);

        private static bool SameNodes(IReadOnlyList<ContactNodeFingerprint> a, IReadOnlyList<ContactNodeFingerprint> b)
        {
            if (a.Count != b.Count)
            {
                return false;
            }
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var node in a)
            {
                ids.Add(node.Id);
            }
            foreach (var node in b)
            {
                if (!ids.Contains(node.Id))
                {
                    return false;
                }
            }
            return true;
        }

        private static bool Same(IReadOnlyList<ContactNodeFingerprint> a, IReadOnlyList<ContactNodeFingerprint> b)
        {
            if (a.Count != b.Count)
            {
                return false;
            }
            var byId = new Dictionary<string, ContactNodeFingerprint>(StringComparer.Ordinal);
            foreach (var node in a)
            {
                byId[node.Id] = node;
            }
            foreach (var node in b)
            {
                if (!byId.TryGetValue(node.Id, out var was) || was.BodyIndex != node.BodyIndex)
                {
                    return false;
                }
                if (was.Orbit.HasValue != node.Orbit.HasValue)
                {
                    return false;
                }
                if (node.Orbit.HasValue && Moved(was.Orbit!.Value, node.Orbit.Value))
                {
                    return false;
                }
                if (was.SurfacePoint.HasValue != node.SurfacePoint.HasValue)
                {
                    return false;
                }
                if (node.SurfacePoint.HasValue
                    && (node.SurfacePoint.Value - was.SurfacePoint!.Value).Magnitude() > SurfaceToleranceMeters)
                {
                    return false;
                }
            }
            return true;
        }

        private static bool Moved(OrbitElements was, OrbitElements now) =>
            Math.Abs(now.Sma - was.Sma) > SmaTolerance * Math.Abs(was.Sma)
            || Math.Abs(now.Ecc - was.Ecc) > EccTolerance
            || AngleApart(now.Inc, was.Inc) > AngleTolerance
            || AngleApart(now.Lan, was.Lan) > AngleTolerance
            || AngleApart(now.ArgPe, was.ArgPe) > AngleTolerance;

        private static double AngleApart(double a, double b)
        {
            var d = Math.Abs(a - b) % (2.0 * Math.PI);
            return d > Math.PI ? (2.0 * Math.PI) - d : d;
        }
    }

    /// <summary>
    /// Runs one contact plan at a time off the calling thread and hands back
    /// the finished one. A plan for a busy save takes tens of milliseconds,
    /// which is too long to hold the Courier thread for.
    /// </summary>
    public sealed class ContactPlanRunner
    {
        private int _running;
        private ContactPlan? _finished;

        /// <summary>Starts a plan for <paramref name="request"/>, unless one is already running. Returns whether it started.</summary>
        public bool Offer(ContactPlanRequest request, Action<Exception>? onFailure = null)
        {
            if (Interlocked.CompareExchange(ref _running, 1, 0) != 0)
            {
                return false;
            }
            Task.Run(() =>
            {
                try
                {
                    Volatile.Write(ref _finished, request.Run());
                }
                catch (Exception ex)
                {
                    onFailure?.Invoke(ex);
                }
                finally
                {
                    Volatile.Write(ref _running, 0);
                }
            });
            return true;
        }

        /// <summary>The plan that finished since the last call, if any.</summary>
        public bool TryTake(out ContactPlan? plan)
        {
            plan = Interlocked.Exchange(ref _finished, null);
            return plan != null;
        }

        /// <summary>Whether a plan is running now.</summary>
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
        public static CommsContacts ToPayload(ContactPlan plan)
        {
            var payload = new CommsContacts
            {
                HorizonUt = plan.HorizonUt,
            };
            foreach (var pair in plan.Pairs)
            {
                var wire = new CommsContactPair { A = pair.A, B = pair.B, HorizonUt = pair.HorizonUt };
                foreach (var window in pair.Windows)
                {
                    wire.Windows.Add(new CommsContactWindow { OpenUt = window.OpenUt, CloseUt = window.CloseUt });
                }
                payload.Pairs.Add(wire);
            }
            return payload;
        }
    }
}
