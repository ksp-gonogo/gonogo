using System;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What <see cref="IPropagationFromState"/> promises, for an implementer to run
    /// against their own provider and for core to run against the one it is handed.
    /// </summary>
    public static class PropagationFromStateConformance
    {
        /// <summary>
        /// Asserts the contract for one seed: the same ask gets the same answer, a
        /// span that ends at or before the seed is refused rather than answered or
        /// thrown, and a path that is returned is one a caller can draw: ascending
        /// points that start at the seed, a reached instant that is the last point
        /// and no later than asked, within the point count, on the seed's body, and a
        /// kind that says what it is. A refusal carries no points and says why.
        /// </summary>
        /// <param name="provider">The implementation under test.</param>
        /// <param name="seed">A state the provider is expected to answer for.</param>
        /// <param name="toUt">An instant after the seed's, within the span the provider answers.</param>
        public static void AssertPropagationFromStateContract(IPropagationFromState provider, PropagationSeed seed, double toUt)
        {
            Assert.NotNull(provider);
            var name = provider.GetType().Name;
            Assert.True(toUt > seed.Ut, "the assertion needs an instant after the seed's to ask for");

            const int points = 9;
            var first = provider.PropagateFromState(seed, toUt, points, PropagationCertification.CertifiedOnly);
            var second = provider.PropagateFromState(seed, toUt, points, PropagationCertification.CertifiedOnly);
            Assert.True(
                Same(first, second),
                name + " gave two different answers to the same question. A path is deterministic, so two "
                + "callers asking alike must be able to draw the same curve.");

            var unspecified = provider.PropagateFromState(seed, toUt, points, PropagationCertification.Unspecified);
            Assert.True(
                unspecified.Solved == first.Solved && unspecified.Kind == first.Kind,
                name + " answered Unspecified differently from CertifiedOnly. Anything other than Unbounded "
                + "asks for the accurate answer, so the two are the same ask.");

            AssertWellFormed(name, first, seed, toUt, points);

            foreach (var refused in new[]
            {
                provider.PropagateFromState(seed, seed.Ut, points, PropagationCertification.CertifiedOnly),
                provider.PropagateFromState(seed, seed.Ut - 10.0, points, PropagationCertification.CertifiedOnly),
            })
            {
                Assert.False(
                    refused.Solved,
                    name + " answered a span that ends at or before the seed. That ask is refused.");
                AssertWellFormed(name, refused, seed, seed.Ut, points);
            }
        }

        private static void AssertWellFormed(string name, PropagatedPath path, PropagationSeed seed, double toUt, int maxPoints)
        {
            Assert.NotNull(path);
            Assert.NotNull(path.States);

            if (!path.Solved)
            {
                Assert.True(
                    path.States.Count == 0 && path.ReachedUt == null && path.Kind == TrajectoryKind.Unspecified,
                    name + " refused with points, a reached instant or a kind. A refusal carries none of them.");
                Assert.True(
                    !string.IsNullOrWhiteSpace(path.Refusal),
                    name + " refused without saying why. The refusal is the sentence shown to the operator.");
                return;
            }

            Assert.True(path.Refusal == null && !path.StillWorking, name + " solved a path and also set a refusal or still-working.");
            Assert.True(
                path.Kind != TrajectoryKind.Unspecified,
                name + " returned a path that does not say whether it is a conic or an integrated one.");
            Assert.True(
                path.CentreBodyIndex == seed.ParentBodyIndex,
                name + " returned a path about body " + path.CentreBodyIndex + " for a seed about body "
                + seed.ParentBodyIndex + ". The points are relative to the seed's body.");
            Assert.True(
                path.States.Count >= 2 && path.States.Count <= (maxPoints == 0 ? PropagatedPath.DefaultPoints : maxPoints),
                name + " returned " + path.States.Count + " points for a limit of " + maxPoints + ".");
            Assert.True(
                path.States[0].Ut == seed.Ut,
                name + " returned a path whose first point is not at the seed's instant.");

            for (var i = 0; i < path.States.Count; i++)
            {
                var s = path.States[i];
                Assert.True(
                    Finite(s.Ut) && Finite(s.X) && Finite(s.Y) && Finite(s.Z),
                    name + " returned a point that is not finite, at index " + i + ".");
                Assert.True(
                    i == 0 || s.Ut > path.States[i - 1].Ut,
                    name + " returned points that do not ascend in time, at index " + i + ".");
            }

            var last = path.States[path.States.Count - 1].Ut;
            Assert.True(
                path.ReachedUt == last && last <= toUt,
                name + " reached " + path.ReachedUt + " but its last point is at " + last + " and the ask ended at "
                + toUt + ". ReachedUt is the last point, and never beyond what was asked.");
        }

        private static bool Same(PropagatedPath a, PropagatedPath b)
        {
            if (a.Solved != b.Solved || a.Kind != b.Kind || a.States.Count != b.States.Count || !Equals(a.ReachedUt, b.ReachedUt))
            {
                return false;
            }
            for (var i = 0; i < a.States.Count; i++)
            {
                if (a.States[i].Ut != b.States[i].Ut || a.States[i].X != b.States[i].X
                    || a.States[i].Y != b.States[i].Y || a.States[i].Z != b.States[i].Z)
                {
                    return false;
                }
            }
            return true;
        }

        private static bool Finite(double x) => !double.IsNaN(x) && !double.IsInfinity(x);
    }
}
