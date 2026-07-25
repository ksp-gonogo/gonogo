using System;
using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>
    /// Pure, KSP-free terrain maths for the <c>vessel.landing</c> channel: a
    /// least-squares plane fit over sampled terrain heights, yielding the slope
    /// angle, the downhill heading, and the RESIDUAL roughness (the bumpiness
    /// left after the tilt is removed, so a smooth incline does not read as
    /// rough). Isolated here (no KSP types, no PQS) so it is unit-testable; the
    /// KSP capture reads <c>PQS.GetSurfaceHeight</c> at a ring of offsets around
    /// an injectable sample-centre point and feeds the heights in as local
    /// east/north/height samples.
    ///
    /// <para>Fitting a plane (not averaging pairwise slopes) is what lets us tell
    /// a uniform incline from a bowl, and separate slope from roughness — the two
    /// distinct hazard axes.</para>
    /// </summary>
    public static class LandingTerrain
    {
        /// <summary>A sampled terrain point in the local tangent plane, metres.</summary>
        public struct Sample
        {
            /// <summary>Metres east of the sample centre.</summary>
            public double East;
            /// <summary>Metres north of the sample centre.</summary>
            public double North;
            /// <summary>Terrain height at this point, metres.</summary>
            public double Height;

            public Sample(double east, double north, double height)
            {
                East = east;
                North = north;
                Height = height;
            }
        }

        /// <summary>The fitted terrain descriptors at a sample centre.</summary>
        public struct Fit
        {
            /// <summary>Slope of the fitted plane, degrees (0 = flat).</summary>
            public double SlopeDeg;
            /// <summary>Downhill heading, degrees clockwise from north; null below the noise floor.</summary>
            public double? HeadingDeg;
            /// <summary>Std-dev of the sampled heights about the fitted plane, metres (the roughness proxy).</summary>
            public double Roughness;
        }

        /// <summary>
        /// Least-squares fit of h = a*east + b*north + c over the samples.
        /// Returns null when there are fewer than 3 samples or the normal
        /// equations are singular (degenerate sample geometry). The downhill
        /// heading is suppressed (null) below <paramref name="headingNoiseFloorDeg"/>,
        /// where the gradient is numerical noise (KER's 0.05-degree precedent).
        /// </summary>
        public static Fit? FitPlane(
            IReadOnlyList<Sample> samples,
            double headingNoiseFloorDeg = 0.05)
        {
            if (samples == null || samples.Count < 3)
                return null;

            double sEE = 0, sNN = 0, sEN = 0, sE = 0, sN = 0, s1 = samples.Count;
            double sEH = 0, sNH = 0, sH = 0;
            foreach (var p in samples)
            {
                sEE += p.East * p.East;
                sNN += p.North * p.North;
                sEN += p.East * p.North;
                sE += p.East;
                sN += p.North;
                sEH += p.East * p.Height;
                sNH += p.North * p.Height;
                sH += p.Height;
            }

            // Solve the 3x3 normal-equation system for [a, b, c] by Cramer's rule.
            // | sEE sEN sE | |a|   |sEH|
            // | sEN sNN sN | |b| = |sNH|
            // | sE  sN  s1 | |c|   |sH |
            double det = Det3(
                sEE, sEN, sE,
                sEN, sNN, sN,
                sE, sN, s1);
            if (Math.Abs(det) < 1e-12)
                return null;

            double a = Det3(
                sEH, sEN, sE,
                sNH, sNN, sN,
                sH, sN, s1) / det;
            double b = Det3(
                sEE, sEH, sE,
                sEN, sNH, sN,
                sE, sH, s1) / det;
            double c = Det3(
                sEE, sEN, sEH,
                sEN, sNN, sNH,
                sE, sN, sH) / det;

            if (double.IsNaN(a) || double.IsNaN(b) || double.IsNaN(c))
                return null;

            double gradient = Math.Sqrt(a * a + b * b);
            double slopeDeg = Math.Atan(gradient) * (180.0 / Math.PI);

            // Downhill direction is the negative gradient (-a east, -b north).
            // Heading clockwise from north = atan2(eastComponent, northComponent).
            double? headingDeg = null;
            if (slopeDeg >= headingNoiseFloorDeg)
            {
                double h = Math.Atan2(-a, -b) * (180.0 / Math.PI);
                if (h < 0)
                    h += 360.0;
                headingDeg = h;
            }

            // Residual roughness: std-dev of height about the fitted plane.
            double sumSq = 0;
            foreach (var p in samples)
            {
                double fitted = a * p.East + b * p.North + c;
                double resid = p.Height - fitted;
                sumSq += resid * resid;
            }
            double roughness = Math.Sqrt(sumSq / samples.Count);

            return new Fit
            {
                SlopeDeg = slopeDeg,
                HeadingDeg = headingDeg,
                Roughness = roughness,
            };
        }

        private static double Det3(
            double a, double b, double c,
            double d, double e, double f,
            double g, double h, double i)
            => a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    }
}
