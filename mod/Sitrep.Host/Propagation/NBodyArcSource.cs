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

        public TrajectoryArcAnswer ArcFor(
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
