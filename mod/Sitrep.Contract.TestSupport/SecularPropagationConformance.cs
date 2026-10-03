using System;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What <see cref="ISecularPropagation"/> promises, for an implementer to run
    /// against their own provider and for core to run against the one it is
    /// handed.
    /// </summary>
    public static class SecularPropagationConformance
    {
        /// <summary>
        /// Asserts the contract for one craft at one instant: the same question
        /// gets the same seed, a body is refused, and a seed that is returned is
        /// one a caller can carry: a closed orbit, finite rates, a span that ends
        /// after it starts, and elements at the anchor that are the anchor.
        /// </summary>
        /// <param name="provider">The implementation under test.</param>
        /// <param name="craft">A craft the provider is expected to answer for, with its osculating elements.</param>
        /// <param name="ut">The instant the elements were sampled at.</param>
        public static void AssertSecularPropagationContract(ISecularPropagation provider, PropagationTarget craft, double ut)
        {
            Assert.NotNull(provider);
            var name = provider.GetType().Name;

            Assert.True(
                provider.SecularOrbitFor(PropagationTarget.Body(craft.ParentBodyIndex), ut) == null,
                name + " returned a secular seed for a BODY. A seed describes a craft's drift; a body's "
                + "place is the provider's ephemeris, and a caller handed a seed for one would carry it "
                + "on the wrong model.");

            var first = provider.SecularOrbitFor(craft, ut);
            var second = provider.SecularOrbitFor(craft, ut);
            Assert.True(
                first.HasValue == second.HasValue && (!first.HasValue || Same(first.Value, second!.Value)),
                name + " gave two different answers to the same question. A seed is deterministic: the "
                + "anchor and rates are its whole state, so two callers asking alike must be able to "
                + "carry the craft to the same place.");

            if (!first.HasValue)
            {
                return;
            }
            var seed = first.Value;
            var anchor = seed.Anchor;

            Assert.True(
                anchor.Sma > 0.0 && anchor.Ecc >= 0.0 && anchor.Ecc < 1.0 && anchor.Mu > 0.0,
                name + " returned a seed on an orbit that is not closed (sma " + anchor.Sma + ", ecc "
                + anchor.Ecc + ", mu " + anchor.Mu + "). Drift is defined for a closed orbit; for anything "
                + "else the answer is null.");

            Assert.True(
                Finite(seed.NodeRate) && Finite(seed.PeriapsisRate) && Finite(seed.MeanAnomalyRate) && seed.MeanAnomalyRate > 0.0,
                name + " returned a seed whose rates are not finite, or whose mean anomaly does not "
                + "advance. A rate it cannot state is a refusal, which is null.");

            Assert.True(
                Finite(anchor.Epoch) && (seed.ValidUntilUt == null || seed.ValidUntilUt.Value > anchor.Epoch),
                name + " returned a seed whose span ends at or before its own anchor ("
                + seed.ValidUntilUt + " against " + anchor.Epoch + "). A seed good for nothing is a "
                + "refusal, which is null.");

            var atAnchor = seed.ElementsAt(anchor.Epoch);
            Assert.True(
                AngleApart(atAnchor.Lan, anchor.Lan) < 1e-12
                && AngleApart(atAnchor.ArgPe, anchor.ArgPe) < 1e-12
                && AngleApart(atAnchor.MeanAnomalyAtEpoch, anchor.MeanAnomalyAtEpoch) < 1e-12,
                name + " returned a seed whose elements at its own anchor are not the anchor. The anchor's "
                + "Epoch is the instant its orientation and phase were taken at.");
        }

        private static bool Same(SecularOrbit a, SecularOrbit b) =>
            a.Anchor.Sma.Equals(b.Anchor.Sma)
            && a.Anchor.Ecc.Equals(b.Anchor.Ecc)
            && a.Anchor.Inc.Equals(b.Anchor.Inc)
            && a.Anchor.Lan.Equals(b.Anchor.Lan)
            && a.Anchor.ArgPe.Equals(b.Anchor.ArgPe)
            && a.Anchor.MeanAnomalyAtEpoch.Equals(b.Anchor.MeanAnomalyAtEpoch)
            && a.Anchor.Epoch.Equals(b.Anchor.Epoch)
            && a.Anchor.Mu.Equals(b.Anchor.Mu)
            && a.NodeRate.Equals(b.NodeRate)
            && a.PeriapsisRate.Equals(b.PeriapsisRate)
            && a.MeanAnomalyRate.Equals(b.MeanAnomalyRate)
            && Nullable.Equals(a.ValidUntilUt, b.ValidUntilUt)
            && a.Basis == b.Basis;

        private static bool Finite(double x) => !double.IsNaN(x) && !double.IsInfinity(x);

        private static double AngleApart(double a, double b)
        {
            var d = Math.Abs(a - b) % (2.0 * Math.PI);
            return d > Math.PI ? (2.0 * Math.PI) - d : d;
        }
    }
}
