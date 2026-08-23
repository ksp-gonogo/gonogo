using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation;

namespace Sitrep.Host.Propagation
{
    /// <summary>
    /// Propagates from a state a command centre supplies, using the same integrator
    /// that produces the arcs on the wire.
    ///
    /// <para>The same physics as <see cref="NBodyArcSource"/> and a different
    /// question. That source asks where a craft goes from where the game says it IS;
    /// this asks where it goes from where a vantage was TOLD it was, and at
    /// light-time those differ. Sharing the integrator is what makes a prediction
    /// comparable with the observation that later arrives: a divergence between them
    /// then means the model was wrong, rather than that two different models
    /// disagreed.</para>
    ///
    /// <para>The gravity model and the perturber set are supplied rather than looked
    /// up, so this can be exercised without a running game, and so the caller decides
    /// which install's physics is in play.</para>
    /// </summary>
    public sealed class SeededNBodyProvider : ISeededPropagationProvider
    {
        /// <summary>Published points on a seeded arc, matching the streamed ones so a
        /// prediction and an observation are drawn at the same fidelity.</summary>
        private const int DefaultPoints = 128;

        private const int MaxStepsPerArc = 20_000;

        private readonly Func<int, double?> _gravitationalParameter;
        private readonly Func<int, IReadOnlyList<PerturbingBody>> _perturbers;
        private readonly Func<IPropagationProvider?> _propagation;
        private readonly Func<int, GravityModel?> _model;

        public SeededNBodyProvider(
            Func<int, double?> gravitationalParameter,
            Func<int, IReadOnlyList<PerturbingBody>> perturbers,
            Func<IPropagationProvider?> propagation,
            Func<int, GravityModel?> model)
        {
            _gravitationalParameter = gravitationalParameter
                ?? throw new ArgumentNullException(nameof(gravitationalParameter));
            _perturbers = perturbers ?? throw new ArgumentNullException(nameof(perturbers));
            _propagation = propagation ?? throw new ArgumentNullException(nameof(propagation));
            _model = model ?? throw new ArgumentNullException(nameof(model));
        }

        public bool CanSeedFrom(DelayedObservation seed)
        {
            if (!seed.Established)
            {
                return false;
            }
            var mu = _gravitationalParameter(seed.CentreBodyIndex);
            if (mu == null || !(mu.Value > 0) || _propagation() == null)
            {
                return false;
            }
            // The force model is required here as well as in the solve, because this
            // method's whole job is to answer BEFORE a solve is attempted. Checking a
            // strict subset of what the solve checks makes it say yes and then refuse,
            // which is worse than not offering the question.
            var model = _model(seed.CentreBodyIndex);
            return model != null && model.Bodies.Count > 0;
        }

        public SeededTrajectory SolveFrom(DelayedObservation seed, double toUt, int maxPoints)
        {
            if (!CanSeedFrom(seed))
            {
                return SeededTrajectory.Refused(
                    "Nothing here can integrate from that state: either it was never established, "
                        + "or there is no gravitational parameter for the body it is measured "
                        + "about.");
            }

            var mu = _gravitationalParameter(seed.CentreBodyIndex)!.Value;
            var span = toUt - seed.ObservedAtUt;
            if (span <= 0)
            {
                return SeededTrajectory.Refused(
                    "The horizon is at or before the instant the seed state was true.");
            }

            var request = new NBodyRequest(
                seed.State,
                // FROM the observation instant, never from the vantage's view. The
                // craft was in this state THEN, and integrating from the later
                // instant would silently shift the whole trajectory forward by
                // however stale the operator's news already was.
                seed.ObservedAtUt,
                toUt,
                mu,
                _perturbers(seed.CentreBodyIndex),
                maxPoints > 1 ? maxPoints : DefaultPoints,
                MaxStepsPerArc,
                NBodyTrajectory.StepFor(span));

            var answer = NBodyTrajectory.Integrate(
                request, _model(seed.CentreBodyIndex), seed.CentreBodyIndex, _propagation());

            return answer.Arc == null
                ? SeededTrajectory.Refused(
                    "The integrator returned no arc for that seed and horizon.")
                : SeededTrajectory.From(answer.Arc, seed.ObservedAtUt);
        }
    }
}
