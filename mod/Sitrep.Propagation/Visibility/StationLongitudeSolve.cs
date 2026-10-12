using System;
using System.Collections.Generic;

namespace Sitrep.Propagation.Visibility
{
    /// <summary>
    /// Solves a station body's longitude offset from a residual function, and
    /// says honestly how many answers there are.
    ///
    /// <para>A separation is one number, so one reference measurement fixes the
    /// offset only up to a mirror about the line to the reference: two offsets
    /// reconcile at the instant of the measurement, and only one of them goes on
    /// to reconcile as the body turns. When the reference is far from the body
    /// the two sit close to the same residual at every sampled offset between
    /// them, so a solver that returns the single least residual returns either
    /// at random and reports a clean fit. This type returns every offset that
    /// reconciles, and <see cref="Surviving"/> narrows them against a later
    /// measurement taken after the body has turned.</para>
    ///
    /// <para>Used by the silence predictor's longitude calibration, which
    /// withholds a prediction while more than one offset survives.</para>
    /// </summary>
    public static class StationLongitudeSolve
    {
        private const double CoarseStepDegrees = 1.0;
        private const double FineStepDegrees = 0.1;

        /// <summary>
        /// Every offset in degrees, in (-180, 180], at which
        /// <paramref name="residualMetersAtOffset"/> is a local minimum no larger
        /// than <paramref name="toleranceMeters"/>. Empty when nothing
        /// reconciles. A pair of mirror solutions that coincide, at an extremum of
        /// the projection, comes back as one.
        /// </summary>
        public static IReadOnlyList<double> Candidates(
            Func<double, double> residualMetersAtOffset,
            double toleranceMeters)
        {
            var count = (int)Math.Round(360.0 / CoarseStepDegrees);
            var residual = new double[count];
            for (var i = 0; i < count; i++)
            {
                residual[i] = residualMetersAtOffset(OffsetAt(i));
            }

            var found = new List<double>();
            for (var i = 0; i < count; i++)
            {
                var before = residual[(i + count - 1) % count];
                var after = residual[(i + 1) % count];
                if (!(residual[i] <= before) || !(residual[i] <= after))
                {
                    continue;
                }

                var best = residual[i];
                var bestOffset = OffsetAt(i);
                for (var d = -CoarseStepDegrees; d <= CoarseStepDegrees + 1e-9; d += FineStepDegrees)
                {
                    var offset = Wrap(OffsetAt(i) + d);
                    var r = residualMetersAtOffset(offset);
                    if (r < best)
                    {
                        best = r;
                        bestOffset = offset;
                    }
                }

                if (best <= toleranceMeters && !Contains(found, bestOffset))
                {
                    found.Add(bestOffset);
                }
            }
            return found;
        }

        /// <summary>
        /// The offsets among <paramref name="offsets"/> that still reconcile at
        /// another measurement. Fewer than were passed once the body has turned
        /// far enough for the mirror solution to part from the true one.
        /// </summary>
        public static IReadOnlyList<double> Surviving(
            IEnumerable<double> offsets,
            Func<double, double> residualMetersAtOffset,
            double toleranceMeters)
        {
            var kept = new List<double>();
            foreach (var offset in offsets)
            {
                if (residualMetersAtOffset(offset) <= toleranceMeters)
                {
                    kept.Add(offset);
                }
            }
            return kept;
        }

        private static double OffsetAt(int index) => Wrap(-180.0 + CoarseStepDegrees * (index + 1));

        private static double Wrap(double degrees)
        {
            var wrapped = degrees % 360.0;
            if (wrapped > 180.0) wrapped -= 360.0;
            if (wrapped <= -180.0) wrapped += 360.0;
            return wrapped;
        }

        private static bool Contains(List<double> offsets, double candidate)
        {
            foreach (var existing in offsets)
            {
                var gap = Math.Abs(Wrap(existing - candidate));
                if (gap < 2.0 * CoarseStepDegrees)
                {
                    return true;
                }
            }
            return false;
        }
    }
}
