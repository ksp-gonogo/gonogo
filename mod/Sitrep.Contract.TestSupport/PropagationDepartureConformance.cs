using System;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What <see cref="IPropagationDeparture"/> promises, for an implementer to run
    /// against their own provider and for core to run against the one it is
    /// handed.
    /// </summary>
    public static class PropagationDepartureConformance
    {
        /// <summary>
        /// Asserts the contract for one craft over one window: the same question
        /// gets the same answer, an answer is never an empty list, knots ascend and
        /// end at the window's end, and each knot carries finite, non-negative
        /// figures that never fall as the knots go on.
        /// </summary>
        /// <param name="provider">The implementation under test.</param>
        /// <param name="craft">A craft the provider is expected to answer for, with its osculating elements.</param>
        /// <param name="fromUt">The sample instant.</param>
        /// <param name="untilUt">The end of the reach the provider stated for this craft.</param>
        public static void AssertPropagationDepartureContract(
            IPropagationDeparture provider, PropagationTarget craft, double fromUt, double untilUt)
        {
            Assert.NotNull(provider);
            var name = provider.GetType().Name;

            var first = provider.DepartureFor(craft, fromUt, untilUt);
            var second = provider.DepartureFor(craft, fromUt, untilUt);
            Assert.True(
                (first == null) == (second == null) && (first == null || first.Count == second!.Count),
                name + " gave two different answers to the same question. An envelope is deterministic: "
                + "two callers asking alike must read the same cap.");

            if (first == null)
            {
                return;
            }

            Assert.True(
                first.Count > 0,
                name + " returned an empty envelope. Stating no error is null; an empty list reads as an "
                + "error of nothing.");

            var previous = fromUt;
            var previousMetres = 0.0;
            var previousRate = 0.0;
            foreach (var knot in first)
            {
                Assert.True(
                    Finite(knot.UntilUt) && Finite(knot.Metres) && Finite(knot.MetresPerSecond)
                    && knot.Metres >= 0.0 && knot.MetresPerSecond >= 0.0,
                    name + " returned a knot that is not finite and non-negative. A drift it cannot "
                    + "measure is a null envelope, never a knot of NaN or a negative distance.");
                Assert.True(
                    knot.UntilUt > previous,
                    name + " returned knots that do not ascend past the sample instant.");
                Assert.True(
                    knot.Metres >= previousMetres && knot.MetresPerSecond >= previousRate,
                    name + " returned a knot below the one before it. Each knot is the largest drift "
                    + "reached anywhere before it, so the figures never fall.");
                previous = knot.UntilUt;
                previousMetres = knot.Metres;
                previousRate = knot.MetresPerSecond;
            }

            Assert.True(
                Math.Abs(previous - untilUt) <= 1e-6 * Math.Max(1.0, Math.Abs(untilUt)),
                name + " returned an envelope whose last knot ends at " + previous + ", not at the "
                + "reach it was asked about (" + untilUt + ").");
        }

        private static bool Finite(double x) => !double.IsNaN(x) && !double.IsInfinity(x);
    }
}
