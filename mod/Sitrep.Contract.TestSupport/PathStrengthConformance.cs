using System;
using System.Collections.Generic;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What <see cref="ICommsPathStrength"/> and the
    /// <see cref="IContactLinkStrength"/> it hands back promise, for an
    /// implementer to run against their own backend.
    /// </summary>
    public static class PathStrengthConformance
    {
        /// <summary>
        /// Asserts the contract for one pair: a strength model for an end the
        /// backend does not know is refused and not thrown at, a model that is
        /// returned keeps the link strength's own contract out to
        /// <paramref name="farthestMeters"/>, and a path's strength is a pure
        /// figure from 0 to 1 that is never more than its strongest hop.
        /// </summary>
        /// <param name="backend">The backend under test.</param>
        /// <param name="from">One end, as the backend's own node object.</param>
        /// <param name="to">The other end.</param>
        /// <param name="ut">The instant the antennas are read at.</param>
        /// <param name="farthestMeters">The greatest separation to evaluate the returned model at; greater than zero.</param>
        public static void AssertPathStrengthContract(
            ICommsPathStrength backend, object? from, object? to, double ut, double farthestMeters)
        {
            Assert.NotNull(backend);
            var name = backend.GetType().Name;

            IContactLinkStrength? unknown = null;
            Exception? ex = null;
            try
            {
                unknown = backend.LinkStrength(new object(), new object(), ut);
            }
            catch (Exception thrown)
            {
                ex = thrown;
            }
            Assert.True(
                ex == null && unknown == null,
                name + ".LinkStrength must return null for nodes it does not recognise, not "
                + (ex == null ? "a model" : "throw " + ex.GetType().Name) + ". Null states no strength, "
                + "which is the honest answer for an end the backend knows nothing about.");

            var link = backend.LinkStrength(from, to, ut);
            if (link != null)
            {
                AssertLinkStrengthContract(link, ut, farthestMeters);
            }

            foreach (var hops in new[] { new[] { 1.0 }, new[] { 0.5 }, new[] { 0.9, 0.4 }, new[] { 0.0, 1.0 }, new[] { 0.3, 0.3, 0.3 } })
            {
                var whole = backend.Combine(hops);
                var strongest = 0.0;
                foreach (var hop in hops)
                {
                    strongest = Math.Max(strongest, hop);
                }
                Assert.True(
                    whole >= 0.0 && whole <= strongest,
                    name + ".Combine(" + string.Join(", ", hops) + ") is " + whole + ". A path is worth "
                    + "something from 0 up to its strongest hop: no path is better than every link in it.");
                Assert.True(
                    backend.Combine(hops).Equals(whole),
                    name + ".Combine is pure: asked the same hops twice it answered " + whole + " and then something else.");
            }
        }

        /// <summary>
        /// Asserts a link strength is a pure function with a strength from 0 to
        /// 1 at every separation out to <paramref name="farthestMeters"/>, and
        /// that a separation asked again after others gets the same answer.
        /// </summary>
        /// <param name="link">The strength model under test.</param>
        /// <param name="ut">The instant to evaluate at.</param>
        /// <param name="farthestMeters">The greatest separation to evaluate at; greater than zero.</param>
        public static void AssertLinkStrengthContract(IContactLinkStrength link, double ut, double farthestMeters)
        {
            Assert.NotNull(link);
            Assert.True(farthestMeters > 0.0, "the farthest separation to evaluate at must be greater than zero");
            var name = link.GetType().Name;

            const int samples = 64;
            var first = new double[samples + 1];
            for (var i = 0; i <= samples; i++)
            {
                var separation = farthestMeters * i / samples;
                first[i] = link.FactsAt(ut, separation).HopStrength;
                Assert.True(
                    first[i] >= 0.0 && first[i] <= 1.0,
                    name + ".FactsAt(" + separation + " m) has strength " + first[i] + ". A strength runs "
                    + "from 0, nothing, to 1, full: a centre draws it as a fraction and grades the link by it.");
            }

            // Backwards, so a model carrying state from one call to the next answers differently.
            for (var i = samples; i >= 0; i--)
            {
                var separation = farthestMeters * i / samples;
                var again = link.FactsAt(ut, separation).HopStrength;
                Assert.True(
                    again.Equals(first[i]),
                    name + ".FactsAt(" + separation + " m) gave " + first[i] + " and then " + again + ". A link "
                    + "strength is pure: it is asked from any thread, in any order and many times over.");
            }
        }
    }
}
