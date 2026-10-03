using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// A propagation provider that can say how a craft's orbit drifts over hours
    /// and days, for predicting comms contacts, as a seed the caller carries
    /// forward itself.
    ///
    /// <para><b>A companion to <see cref="IPropagationProvider"/>, not a
    /// replacement.</b> Navigation keeps the provider's own solution. A seed is
    /// comms-grade: good enough to place the edge of a contact window to within
    /// seconds, and no better. A provider that cannot say anything useful about
    /// drift is simply not one of these, and the caller carries the craft on its
    /// conic.</para>
    ///
    /// <para><b>Why a seed rather than a position.</b>
    /// <see cref="IPropagationProvider"/> promises deterministic answers, so
    /// everything a long-range position depends on is handed back as data
    /// (the anchor elements, the rates, the span) rather than kept as state
    /// inside the provider. The caller evaluates
    /// <see cref="SecularOrbit.ElementsAt"/> wherever and whenever it likes, on
    /// any thread, and two callers holding the same seed get the same
    /// orbit.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    public interface ISecularPropagation
    {
        /// <summary>
        /// The seed for <paramref name="target"/> as it stands at
        /// <paramref name="ut"/>, or <c>null</c> when this provider has no secular
        /// model for it.
        ///
        /// <para>Null is the REFUSING answer: a body, a craft on an escape or
        /// unclosed orbit, or a craft whose drift the provider cannot rate all
        /// return it, and the caller then carries that target on its conic. A seed
        /// is never returned with rates the provider merely defaulted.</para>
        ///
        /// <para>The anchor's <see cref="OrbitElements.Epoch"/> is the instant the
        /// orientation and phase were taken at, normally <paramref name="ut"/>
        /// itself.</para>
        /// </summary>
        /// <param name="target">The craft, with its osculating elements as the caller has them.</param>
        /// <param name="ut">The universal time the elements were sampled at.</param>
        /// <returns>The seed, or <c>null</c> to refuse.</returns>
        SecularOrbit? SecularOrbitFor(PropagationTarget target, double ut);
    }

    /// <summary>Where a <see cref="SecularOrbit"/>'s shape and rates came from.</summary>
    /// <category>Propagation and models</category>
    public enum SecularBasis
    {
        /// <summary>Mean elements and rates fitted by the provider's own analysis of the integrated trajectory.</summary>
        Analysis,

        /// <summary>Rates estimated from the parent body's oblateness (J2), applied to the craft's own elements.</summary>
        J2Estimate,
    }

    /// <summary>
    /// A craft's orbit as a conic whose orientation and phase turn at constant
    /// rates: the node, the periapsis and the mean anomaly each advance linearly
    /// from the anchor, and the shape stays fixed.
    ///
    /// <para>All rates are radians per second. The mean-anomaly rate is the whole
    /// rate, not a correction to the two-body mean motion.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    public readonly struct SecularOrbit
    {
        /// <summary>Creates a seed.</summary>
        /// <param name="anchor">The elements at the anchor instant, which is the anchor's own <see cref="OrbitElements.Epoch"/>.</param>
        /// <param name="nodeRate">How fast the ascending node turns, in radians per second.</param>
        /// <param name="periapsisRate">How fast the argument of periapsis turns, in radians per second.</param>
        /// <param name="meanAnomalyRate">How fast the mean anomaly advances, in radians per second.</param>
        /// <param name="validUntilUt">The last instant the seed holds to a contact edge's tolerance, or <c>null</c> when its source sets no limit.</param>
        /// <param name="basis">Where the shape and rates came from.</param>
        public SecularOrbit(
            OrbitElements anchor,
            double nodeRate,
            double periapsisRate,
            double meanAnomalyRate,
            double? validUntilUt,
            SecularBasis basis)
        {
            Anchor = anchor;
            NodeRate = nodeRate;
            PeriapsisRate = periapsisRate;
            MeanAnomalyRate = meanAnomalyRate;
            ValidUntilUt = validUntilUt;
            Basis = basis;
        }

        /// <summary>The elements at the anchor instant, <see cref="OrbitElements.Epoch"/>.</summary>
        public OrbitElements Anchor { get; }

        /// <summary>How fast the ascending node turns, in radians per second.</summary>
        public double NodeRate { get; }

        /// <summary>How fast the argument of periapsis turns, in radians per second.</summary>
        public double PeriapsisRate { get; }

        /// <summary>How fast the mean anomaly advances, in radians per second: the whole rate, two-body mean motion included.</summary>
        public double MeanAnomalyRate { get; }

        /// <summary>The last instant the seed holds to a contact edge's tolerance, or <c>null</c> when its source sets no limit.</summary>
        public double? ValidUntilUt { get; }

        /// <summary>Where the shape and rates came from.</summary>
        public SecularBasis Basis { get; }

        /// <summary>
        /// The osculating-equivalent elements at <paramref name="ut"/>: the anchor's
        /// shape, with its node, periapsis and mean anomaly advanced by their rates,
        /// and an epoch of <paramref name="ut"/>.
        /// </summary>
        public OrbitElements ElementsAt(double ut)
        {
            var dt = ut - Anchor.Epoch;
            return new OrbitElements(
                Anchor.Sma,
                Anchor.Ecc,
                Anchor.Inc,
                Wrap(Anchor.Lan + (NodeRate * dt)),
                Wrap(Anchor.ArgPe + (PeriapsisRate * dt)),
                Wrap(Anchor.MeanAnomalyAtEpoch + (MeanAnomalyRate * dt)),
                ut,
                Anchor.Mu);
        }

        private static double Wrap(double radians)
        {
            var turn = 2.0 * Math.PI;
            var wrapped = radians % turn;
            return wrapped < 0.0 ? wrapped + turn : wrapped;
        }
    }
}
