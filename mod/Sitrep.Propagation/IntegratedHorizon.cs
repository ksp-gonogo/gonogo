using System;

namespace Sitrep.Propagation
{
    /// <summary>
    /// How far a two-body extrapolation of an INTEGRATED trajectory stays
    /// trustworthy.
    ///
    /// <para>General to any provider that integrates rather than specific to one
    /// mod: the elements such a provider publishes are osculating, so they are
    /// exact at the sample instant and degrade from there. This computes where to
    /// stop trusting them.</para>
    ///
    /// <para><b>The exact rule is a perturbation ratio and this is NOT it.</b> The
    /// error is dominated by along-track drift growing linearly, and the ratio
    /// scales as <c>2 (mu_perturber / mu_primary) (r / d)^3</c>: a measured 20 km
    /// Minmus orbit drifts about 11 m per hour, while an ordinary high-Kerbin
    /// orbit perturbed by the Mun drifts about 19 km per hour. Three orders of
    /// magnitude apart in the same save at the same instant, which is why a
    /// horizon has to be per-sample.</para>
    ///
    /// <para>Computing it needs each perturber's GM and distance, and
    /// <see cref="SystemBody"/> carries neither: it holds a parent index and an
    /// orbit, where the orbit's <c>Mu</c> is the PARENT's. The wire has
    /// <c>BodyEntry.gravParameter</c>, so the data exists, but it does not reach
    /// this layer. Until it does, a provider states a CONSERVATIVE bound from what
    /// it does know, and being conservative is the safe direction: too short
    /// withholds a trajectory that would have been fine, too long draws one that
    /// is wrong.</para>
    ///
    /// <para>The calibration behind the fraction: the handover's own predictions
    /// came in 1.4x and 2.8x LOW against the one measured capture, so anything
    /// derived the same way is good to about a factor of three. A quarter of a
    /// cycle keeps the extrapolation inside the regime where the measured drift
    /// was metres rather than kilometres, with that factor of three to spare.</para>
    /// </summary>
    public static class IntegratedHorizon
    {
        /// <summary>
        /// Fraction of a characteristic cycle an integrated element set is taken
        /// to be good for. Deliberately a named constant: it is a judgement
        /// calibrated against one capture, not a derived quantity, and the next
        /// person should be able to find and change it.
        /// </summary>
        public const double TrustedCycleFraction = 0.25;

        /// <summary>
        /// The last UT an integrated element set answers for, or <c>null</c> when
        /// no cycle is known.
        ///
        /// <para>Null means the caller must NOT publish
        /// <see cref="Sitrep.Contract.PropagationHorizonKind.Until"/> with a
        /// fabricated number. A provider that cannot bound itself has to say so
        /// some other way; inventing a bound is the failure this whole seam
        /// exists to prevent.</para>
        /// </summary>
        public static double? UntilUt(double sampleUt, double? characteristicCycleSeconds)
        {
            if (double.IsNaN(sampleUt) || double.IsInfinity(sampleUt))
            {
                return null;
            }
            var cycle = characteristicCycleSeconds;
            if (cycle == null || double.IsNaN(cycle.Value) || double.IsInfinity(cycle.Value) || cycle.Value <= 0.0)
            {
                return null;
            }
            return sampleUt + (cycle.Value * TrustedCycleFraction);
        }
    }
}
