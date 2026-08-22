using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation;

namespace Sitrep.Host.Propagation
{
    /// <summary>
    /// Turns a <c>vessel.orbit</c> reading into the arc that rides on it, by
    /// integrating against whichever force model the install published.
    ///
    /// <para><b>The seam between the two halves of this slice.</b> The gravity
    /// model comes from an Uplink through a capability, so core never learns which
    /// mod supplied it; the perturbers' positions come from the elected propagation
    /// provider, so nothing here carries a second copy of the two-body solver; and
    /// the integration itself is <see cref="NBodyTrajectory"/>, which is KSP-free
    /// and tested with no game running. What is left here is the request: how far
    /// ahead, at what step, against which bodies.</para>
    ///
    /// <para><b>Nothing is fabricated when a piece is missing.</b> No model is
    /// <see cref="TrajectoryRefusal.NoForceModel"/>; a horizon that names no instant
    /// means no arc is attempted at all, because a curve needs a far end and
    /// inventing one is the failure the whole horizon seam exists to prevent.</para>
    /// </summary>
    public sealed class NBodyArcSource : ITrajectoryArcSource
    {
        /// <summary>
        /// Curves published per second, and the bug it catches.
        ///
        /// <para>Three curves for four vessels at the change-triggered cadence is
        /// about twelve a second. A bug that republishes on every physics frame at
        /// 25 Hz across four vessels is three hundred, so the threshold sits five
        /// times above the real load and well below the regression.</para>
        /// </summary>
        private static readonly PerfBudget CurvesPublished =
            new PerfBudget("Trajectory curves published/sec", threshold: 60, windowSec: 1.0, unit: "samples");

        /// <summary>
        /// The step budget one arc may spend.
        ///
        /// <para>Chosen rather than derived, which is why it is a named constant
        /// somebody can find and change. A period-relative step puts a revolution at
        /// 300 steps, so this is 130 revolutions' worth: comfortably past any
        /// horizon a quarter of a cycle long, and short enough that a request for a
        /// week of a low orbit refuses rather than stalling the tick it runs on.</para>
        /// </summary>
        public const int MaxStepsPerArc = 40_000;

        /// <summary>Points published per curve. See <see cref="TrajectoryArc.SourcePointCount"/> for what the reader is told about the rest.</summary>
        public const int PublishedPoints = 256;

        private readonly Func<GravityModel?> _model;
        private readonly Func<IPropagationProvider?> _propagation;
        private readonly Func<int, IReadOnlyList<PerturbingBody>> _perturbers;

        /// <param name="perturbers">
        /// Which bodies to sum, given the index of the primary the integration is
        /// centred on. Keyed on the primary because the set differs per body and
        /// because whoever can read a body hierarchy is not this assembly.
        /// </param>
        public NBodyArcSource(
            Func<GravityModel?> model,
            Func<IPropagationProvider?> propagation,
            Func<int, IReadOnlyList<PerturbingBody>> perturbers)
        {
            _model = model ?? throw new ArgumentNullException(nameof(model));
            _propagation = propagation ?? throw new ArgumentNullException(nameof(propagation));
            _perturbers = perturbers ?? throw new ArgumentNullException(nameof(perturbers));
        }

        /// <summary>
        /// How far into an arc's own span the answer is reused before integrating
        /// again.
        ///
        /// <para>A FRACTION rather than a number of seconds, because a wall-clock
        /// floor is a warp bug waiting to happen: at 100,000x the same few seconds
        /// of real time is days of UT, and a floor expressed in UT seconds either
        /// re-integrates every tick at 1x or goes badly stale under warp. A fraction
        /// of the arc's own span is the same amount of curve either way.</para>
        /// </summary>
        public const double ReuseFractionOfSpan = 0.2;

        /// <summary>
        /// Relative change in an element that counts as a different orbit.
        ///
        /// <para>Not zero, because the elements move continuously under any real
        /// perturbation and an exact-equality gate would recompute every tick, which
        /// is the regression the budget above exists to catch. A part in ten
        /// thousand is well inside the integrator's own truncation, so a change this
        /// small cannot show on the curve it would produce.</para>
        /// </summary>
        public const double ElementChangeThreshold = 1e-4;

        private readonly object _memoLock = new object();
        private OrbitElements _memoElements;
        private string? _memoVesselId;
        private double _memoFromUt = double.NaN;
        private double _memoToUt = double.NaN;
        private TrajectoryArcAnswer _memo;
        private bool _hasMemo;

        public TrajectoryArcAnswer ArcFor(
            PropagationTarget target, double fromUt, double toUt, int maxPoints)
        {
            var elements = target.Osculating;

            // Triggered on CHANGE rather than on the tick. Without this the whole
            // integration runs on every sample, which is thousands of conic solves a
            // second for a curve nobody could tell from the last one. A reused arc
            // keeps its own fromUt and toUt, so it states the window it actually
            // covers rather than being re-stamped as fresh.
            lock (_memoLock)
            {
                if (_hasMemo
                    && elements != null
                    && string.Equals(_memoVesselId, target.Id, StringComparison.Ordinal)
                    && SameOrbit(_memoElements, elements.Value)
                    && fromUt >= _memoFromUt
                    && fromUt - _memoFromUt < (_memoToUt - _memoFromUt) * ReuseFractionOfSpan)
                {
                    return _memo;
                }
            }

            var answer = Compute(target, fromUt, toUt, maxPoints);

            lock (_memoLock)
            {
                _hasMemo = elements != null;
                _memoElements = elements ?? default;
                _memoVesselId = target.Id;
                _memoFromUt = fromUt;
                _memoToUt = toUt;
                _memo = answer;
            }
            return answer;
        }

        /// <summary>
        /// Whether two element sets describe the same orbit to within
        /// <see cref="ElementChangeThreshold"/>. Angles are compared as plain
        /// differences rather than relative ones: a longitude near zero has no scale
        /// to be relative to, and a relative test there would call every small
        /// change enormous.
        /// </summary>
        private static bool SameOrbit(OrbitElements a, OrbitElements b) =>
            Close(a.Sma, b.Sma)
            && Math.Abs(a.Ecc - b.Ecc) <= ElementChangeThreshold
            && Math.Abs(a.Inc - b.Inc) <= ElementChangeThreshold
            && Math.Abs(a.Lan - b.Lan) <= ElementChangeThreshold
            && Math.Abs(a.ArgPe - b.ArgPe) <= ElementChangeThreshold
            && Close(a.Mu, b.Mu);

        private static bool Close(double a, double b)
        {
            var scale = Math.Max(Math.Abs(a), Math.Abs(b));
            if (scale <= 0.0) return a == b;
            return Math.Abs(a - b) / scale <= ElementChangeThreshold;
        }

        private TrajectoryArcAnswer Compute(
            PropagationTarget target, double fromUt, double toUt, int maxPoints)
        {
            var elements = target.Osculating;
            if (elements == null)
            {
                // No conic to start from is not a refusal about the force model or
                // the budget: nothing was attempted, and saying otherwise would put
                // a remedy on screen for a problem the operator does not have.
                return TrajectoryArcAnswer.NotAttempted();
            }

            var model = _model();
            if (model == null)
            {
                return TrajectoryArcAnswer.Refused(TrajectoryRefusal.NoForceModel);
            }

            var propagation = _propagation();
            if (propagation == null)
            {
                return TrajectoryArcAnswer.NotAttempted();
            }

            var frame = PropagationFrame.CentredOn(target.ParentBodyIndex);
            if (!propagation.CanPropagate(target, frame, fromUt, fromUt))
            {
                return TrajectoryArcAnswer.NotAttempted();
            }

            var start = propagation.Solve(target, frame, fromUt);
            var period = propagation.CharacteristicCycleSeconds(target);
            var request = new NBodyRequest(
                start,
                fromUt,
                toUt,
                elements.Value.Mu,
                _perturbers(target.ParentBodyIndex),
                maxPoints > 1 ? maxPoints : PublishedPoints,
                MaxStepsPerArc,
                NBodyTrajectory.StepFor(period ?? (toUt - fromUt)));

            var answer = NBodyTrajectory.Integrate(
                request, model, target.ParentBodyIndex, propagation);
            if (answer.Arc != null)
            {
                // Recorded on the publish rather than on the integration, and on
                // this thread, because the budget's own store takes no lock. It
                // counts curves that reached a client, which is the quantity the
                // threshold is about.
                CurvesPublished.Record(1.0, fromUt);
            }
            return answer;
        }
    }
}
