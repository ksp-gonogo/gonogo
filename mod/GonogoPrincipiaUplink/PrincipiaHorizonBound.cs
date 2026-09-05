using System;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// One body this Uplink will sum when it bounds a craft's osculating elements:
    /// where to ask the displaced solver for it, and what the force model calls it.
    ///
    /// <para>Two keys because two different tables are being joined. The INDEX is
    /// the propagation seam's vocabulary, and the only way to ask where a body is
    /// without carrying a second copy of two-body motion. The NAME is the gravity
    /// model's, which is configuration the producer ships and is keyed on nothing
    /// else. A body the model does not name is dropped from the sum rather than
    /// guessed at.</para>
    /// </summary>
    public readonly struct PrincipiaPerturber
    {
        public PrincipiaPerturber(string name, int bodyIndex)
        {
            Name = name;
            BodyIndex = bodyIndex;
        }

        public string Name { get; }

        public int BodyIndex { get; }
    }

    /// <summary>
    /// How long this Uplink will vouch for a craft's published osculating elements.
    ///
    /// <para><b>The bound is a LOCAL property and this is what makes it one.</b>
    /// Under n-body physics the elements on the wire are the conic tangent to the
    /// path at the sample instant, and they part company with the path at a rate set
    /// by the perturbing acceleration where that craft actually is. The perturbation
    /// scales as <c>2 (mu_perturber / mu_primary) (r / d)^3</c>, so two craft around
    /// the same body at the same instant can want horizons an order of magnitude
    /// apart. Nothing outside the force model can compute that, which is why the
    /// answer belongs here rather than in core.</para>
    ///
    /// <para><b>Measured, not derived.</b> Every constant below was fixed against a
    /// live save on the rig on 2026-09-05: the mod's own published arc for the active
    /// craft was reproduced to 0.06 m, then the same integration was run against the
    /// two-body extrapolation for every orbiting vessel in the save, at eight phases
    /// each, to find where they part company. The nine ranged from 687 km of orbital
    /// radius to 2600 km and included a Mun orbiter, and the instant at which the
    /// conic was 100 m out came in between 0.050 and 0.277 of each craft's own cycle.
    /// That five-fold spread is exactly what a fixed fraction of a cycle cannot
    /// express, and the fraction core used to apply was five times too long for the
    /// worst of them.</para>
    /// </summary>
    public static class PrincipiaHorizonBound
    {
        /// <summary>
        /// How far the published conic may be from the path it is tangent to before
        /// this Uplink stops vouching for it, metres.
        ///
        /// <para>A hundred metres is not an arbitrary round number: it is what the
        /// flat quarter-cycle rule was implicitly asserting. Measured on the rig, the
        /// 250 km Kerbin relays that rule was tuned against are 96 m off their true
        /// path at exactly the instant it named. Naming the tolerance instead of the
        /// fraction keeps that judgement and lets every other craft scale away from
        /// it.</para>
        /// </summary>
        public const double ToleranceMetres = 100.0;

        /// <summary>
        /// How much sooner the departure arrives than the double integral of the
        /// perturbing acceleration alone predicts.
        ///
        /// <para>A perturbation does not just displace a craft, it changes its period,
        /// and the along-track error from that grows faster than the kinematic
        /// <c>a t^2 / 2</c> the tide gives on its own. Measured across the nine craft,
        /// the instant the kinematic term names overshot the instant the integration
        /// actually crossed 100 m by between 1.1 and 3.7. Four is the next whole
        /// number above the worst of them, so the bound is short for every craft
        /// measured and shortest where the amplification is mildest, which is the
        /// direction that withholds rather than the one that draws a curve nothing
        /// flies.</para>
        /// </summary>
        public const double AlongTrackAmplification = 4.0;

        /// <summary>
        /// The most of a craft's own cycle this will vouch for however calm its
        /// neighbourhood, and the reason there is a ceiling at all.
        ///
        /// <para>The perturbing acceleration is evaluated where the craft is NOW. A
        /// quarter of a revolution later the geometry that produced it has turned
        /// over, so a window longer than that is one the sample it was computed from
        /// no longer describes. A quarter is also the fraction core used to apply
        /// unconditionally, which makes this change strictly one of shortening: no
        /// craft's horizon can come out longer than the one it had.</para>
        /// </summary>
        public const double CycleCeilingFraction = 0.25;

        /// <summary>
        /// One perturber's differential (tidal) acceleration across the craft's
        /// orbit, in metres per second squared. Zero for a body whose distance or
        /// mass is not a usable number, which drops the term rather than poisoning
        /// the sum.
        /// </summary>
        public static double PerturbingAcceleration(
            double craftRadius, double perturberMu, double perturberDistance)
        {
            if (!(craftRadius > 0.0) || !(perturberMu > 0.0) || !(perturberDistance > 0.0)
                || double.IsInfinity(craftRadius) || double.IsInfinity(perturberMu)
                || double.IsInfinity(perturberDistance))
            {
                return 0.0;
            }
            return 2.0 * perturberMu * craftRadius
                / (perturberDistance * perturberDistance * perturberDistance);
        }

        /// <summary>
        /// How many seconds past the sample instant these elements are still worth
        /// <see cref="ToleranceMetres"/>, or <c>null</c> when nothing can be said.
        ///
        /// <para>Null is the refusing answer, and it is what a craft with no cycle
        /// and no measurable perturber gets: the first leaves no scale to state a
        /// ceiling in, the second leaves no rate to divide the tolerance by, and
        /// together they leave nothing to compute. Inventing a span there is the
        /// failure this whole seam exists to prevent.</para>
        /// </summary>
        public static double? SpanSeconds(
            double perturbingAcceleration, double? characteristicCycleSeconds)
        {
            double? ceiling = null;
            var cycle = characteristicCycleSeconds;
            if (cycle != null && cycle.Value > 0.0
                && !double.IsNaN(cycle.Value) && !double.IsInfinity(cycle.Value))
            {
                ceiling = cycle.Value * CycleCeilingFraction;
            }

            if (!(perturbingAcceleration > 0.0) || double.IsInfinity(perturbingAcceleration))
            {
                // Nothing measurable is pulling on it, so the elements are as good as
                // two-body ones and the ceiling is the whole of what we will say.
                return ceiling;
            }

            var span = Math.Sqrt(2.0 * ToleranceMetres / perturbingAcceleration)
                / AlongTrackAmplification;
            if (double.IsNaN(span) || double.IsInfinity(span))
            {
                return ceiling;
            }
            return ceiling == null ? span : Math.Min(span, ceiling.Value);
        }
    }
}
