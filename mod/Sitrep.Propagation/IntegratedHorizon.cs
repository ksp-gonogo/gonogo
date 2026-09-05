using System;
using Sitrep.Contract;

namespace Sitrep.Propagation
{
    /// <summary>
    /// How far a two-body extrapolation of an INTEGRATED trajectory stays
    /// trustworthy, TAKEN FROM THE PROVIDER rather than guessed on its behalf.
    ///
    /// <para><b>Why this cannot be a constant.</b> The error is dominated by
    /// along-track drift and the perturbation driving it scales as
    /// <c>2 (mu_perturber / mu_primary) (r / d)^3</c>, so the horizon is a LOCAL
    /// property of one craft at one instant. Measured against a live save on the rig,
    /// nine craft in one save at one instant wanted horizons from 0.05 to 0.28 of
    /// their own orbital cycle, and nothing about a craft's period predicts where in
    /// that range it falls: the two furthest apart were the same relay design around
    /// the same body. A fraction of a cycle applied to all of them is five times too
    /// long for the worst, which is the direction that draws a curve the craft will
    /// not fly.</para>
    ///
    /// <para><b>So the fraction is gone and the question is asked instead.</b>
    /// <see cref="IPropagationProvider.CanPropagate"/> already takes a WINDOW and
    /// already means "will I answer honestly across this", which is the horizon
    /// stated as a predicate. Whoever integrates knows their own force model and can
    /// answer it per craft; this inverts the predicate to recover the instant. No
    /// second capability, no second election, and the one thing that varies by
    /// provider is answered by the provider.</para>
    /// </summary>
    public static class IntegratedHorizon
    {
        /// <summary>
        /// Bisection steps used to recover the instant from the predicate.
        ///
        /// <para>Sixteen halvings resolve the answer to a sixty-five-thousandth of a
        /// characteristic cycle, which is well under a second on any orbit anyone
        /// flies and far finer than the bound itself is knowable. More would spend
        /// provider calls to sharpen a number whose own accuracy is a factor of
        /// two.</para>
        /// </summary>
        public const int RefinementSteps = 16;

        /// <summary>
        /// The last UT the provider will vouch for <paramref name="target"/> from
        /// <paramref name="sampleUt"/>, or <c>null</c> when it vouches for nothing.
        ///
        /// <para>Null means the caller must NOT publish
        /// <see cref="Sitrep.Contract.PropagationHorizonKind.Until"/> with a
        /// fabricated number. A provider that cannot bound itself has to say so some
        /// other way; inventing a bound is the failure this whole seam exists to
        /// prevent.</para>
        ///
        /// <para>The search is bounded above by ONE characteristic cycle, and that
        /// ceiling is a statement rather than a shortcut: a provider answers from the
        /// geometry it can see at <paramref name="sampleUt"/>, and a cycle later the
        /// craft has been everywhere in its orbit, so a window longer than that is
        /// one the sample it was computed from no longer describes. A provider that
        /// vouches for the whole cycle is taken at its word exactly that far.</para>
        /// </summary>
        public static double? UntilUt(
            IPropagationProvider provider, PropagationTarget target, double sampleUt)
        {
            if (provider == null) throw new ArgumentNullException(nameof(provider));
            if (double.IsNaN(sampleUt) || double.IsInfinity(sampleUt))
            {
                return null;
            }

            var frame = PropagationFrame.CentredOn(target.ParentBodyIndex);
            if (!provider.CanPropagate(target, frame, sampleUt, sampleUt))
            {
                // It will not answer for the sample instant itself, so there is no
                // window to look for and no elements to bound.
                return null;
            }

            var cycle = provider.CharacteristicCycleSeconds(target);
            if (cycle == null || double.IsNaN(cycle.Value) || double.IsInfinity(cycle.Value)
                || cycle.Value <= 0.0)
            {
                // No repeat means no scale to search over. A hyperbolic craft reaches
                // here, and Unspecified is the honest answer: the provider may well
                // have a bound, and nothing here is entitled to pick the interval to
                // hunt for it in.
                return null;
            }

            var high = cycle.Value;
            if (provider.CanPropagate(target, frame, sampleUt, sampleUt + high))
            {
                return sampleUt + high;
            }

            var low = 0.0;
            for (var i = 0; i < RefinementSteps; i++)
            {
                var middle = 0.5 * (low + high);
                if (provider.CanPropagate(target, frame, sampleUt, sampleUt + middle))
                {
                    low = middle;
                }
                else
                {
                    high = middle;
                }
            }

            // Zero is a refusal rather than a horizon: elements good for no time at
            // all are elements nothing may be extrapolated from.
            return low > 0.0 ? sampleUt + low : (double?)null;
        }
    }
}
