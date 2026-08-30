using System;
using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>
    /// Samples a body's pressure-versus-altitude profile off the game's own
    /// answer, so a client can draw it without modelling the air itself.
    ///
    /// <para>The alternative a client had was <c>P0·exp(-h/H)</c> over a
    /// bundled table of stock bodies. That is wrong twice: the table is keyed
    /// by NAME and a planet pack renames every body, and the exponential is
    /// not the function KSP evaluates. A body with
    /// <c>atmosphereUsePressureCurve</c> set follows a tabulated curve, which
    /// is what stock's own atmospheres and the RealAtmospheres-style packs
    /// use, and <c>CelestialBody</c> carries no scale-height field to build
    /// an honest exponential from in the first place. Sampling
    /// <c>GetPressure</c> is right for all three cases at once.</para>
    ///
    /// <para><b>Why the spacing is chosen rather than fixed.</b> The profile
    /// is read on a LOG pressure axis, so what matters is the error in the log
    /// of the pressure, and a consumer that joins the samples log-linearly
    /// reproduces a pure exponential atmosphere exactly at any spacing. What
    /// it cannot reproduce is real curvature, and where that curvature sits
    /// varies enormously between bodies: RSS Earth's air is spent by 80 km
    /// while Saturn's runs past 1,170 km, so one grid uniform in altitude
    /// either wastes most of its points on near-vacuum or undersamples the
    /// dense end. Bisecting on the measured departure from the chord puts the
    /// points where the curve actually bends, and turns the sample count into
    /// a consequence of an error bound rather than a number picked by
    /// eye.</para>
    ///
    /// <para><b>Why the table stops short of the ceiling.</b> A KSP atmosphere
    /// is hard-cut: <c>GetPressure</c> returns exactly 0 at
    /// <c>atmosphereDepth</c>, and a curve body's last keyframe often plunges
    /// to zero across the final segment. Zero has no log, and no
    /// interpolation in log space can follow a cubic into it, so a table
    /// carried all the way to the ceiling ends in a segment that is 100%
    /// wrong. It also carries nothing: on RSS Pluto the region concerned is
    /// below a millionth of a pascal. The table therefore ends at
    /// <see cref="FloorDecades"/> decades below sea level and a consumer takes
    /// the body's own depth as where the air formally ends.</para>
    /// </summary>
    public static class AtmospherePressureProfile
    {
        /// <summary>
        /// Largest fraction by which a sampled point may depart the log-linear
        /// chord through its neighbours before the segment is split. Measured
        /// against the ten real pressure curves the RSS install ships, the
        /// worst reconstruction error this leaves is 1.12%, on every body but
        /// Pluto (see <see cref="MaxSamples"/>).
        /// </summary>
        public const double Tolerance = 0.01;

        /// <summary>
        /// Hard cap on points per body. <see cref="Tolerance"/> is reached
        /// inside it for every real curve measured but one (16 points for RSS
        /// Mars, 41 for RSS Uranus; only Pluto's near-vacuum runs the cap out,
        /// landing at 1.51%), and the cap is what stops a pathological curve
        /// spending the channel.
        /// </summary>
        public const int MaxSamples = 48;

        /// <summary>
        /// How far below sea-level pressure the table runs.
        ///
        /// <para>Six decades reaches 93.7 km on RSS Earth, where five would
        /// have stopped at 80.3. That band is not decoration: a capsule
        /// crossing it at 7 km/s is still meeting tens of pascals of dynamic
        /// pressure, so it is inside the region this profile is read in, and
        /// the extra decade costs three percentage points of the channel.</para>
        /// </summary>
        public const int FloorDecades = 6;

        /// <summary>Significant figures kept per sample; see <c>AtmosphereEntry.Pressures</c>.</summary>
        private const int SignificantFigures = 6;

        /// <summary>
        /// Interior points probed per segment. A midpoint alone cannot see an
        /// inflection that happens to cross the chord halfway along, and a
        /// curve with a temperature inversion in it has exactly that shape.
        /// </summary>
        private static readonly double[] Probes = { 0.25, 0.5, 0.75 };

        /// <summary>
        /// Builds the profile, or returns false when the body has no air to
        /// describe.
        /// </summary>
        /// <param name="pressureAt">
        /// The game's own answer in kPa at an altitude in metres:
        /// <c>CelestialBody.GetPressure</c>.
        /// </param>
        /// <param name="depth">The body's atmosphere ceiling, metres.</param>
        public static bool TryBuild(
            Func<double, double> pressureAt,
            double depth,
            out double[] altitudes,
            out double[] pressures)
        {
            altitudes = null!;
            pressures = null!;
            if (pressureAt == null || !(depth > 0))
            {
                return false;
            }

            var seaLevel = pressureAt(0);
            if (!IsUsable(seaLevel))
            {
                return false;
            }

            var ceiling = CeilingFor(pressureAt, depth, seaLevel);
            if (ceiling <= 0)
            {
                return false;
            }

            var xs = new List<double> { 0, ceiling };
            while (xs.Count < MaxSamples)
            {
                var worst = 0.0;
                var worstIndex = -1;
                for (var i = 0; i < xs.Count - 1; i++)
                {
                    // Below two metres apart there is nothing left to split.
                    if (xs[i + 1] - xs[i] < 2)
                    {
                        continue;
                    }
                    var error = ChordError(pressureAt, xs[i], xs[i + 1]);
                    if (error > worst)
                    {
                        worst = error;
                        worstIndex = i;
                    }
                }
                if (worstIndex < 0 || worst <= Tolerance)
                {
                    break;
                }
                xs.Insert(worstIndex + 1, Math.Floor((xs[worstIndex] + xs[worstIndex + 1]) / 2));
            }

            altitudes = xs.ToArray();
            pressures = new double[xs.Count];
            for (var i = 0; i < xs.Count; i++)
            {
                pressures[i] = RoundToFigures(pressureAt(xs[i]), SignificantFigures);
            }
            return true;
        }

        /// <summary>
        /// How far a segment's interior departs the log-linear chord through
        /// its ends, as a fraction of the true pressure. Zero for a segment
        /// whose ends or probes are not both usable: there is nothing to
        /// resolve inside a vacuum.
        /// </summary>
        private static double ChordError(Func<double, double> pressureAt, double a, double b)
        {
            var pa = pressureAt(a);
            var pb = pressureAt(b);
            if (!IsUsable(pa) || !IsUsable(pb))
            {
                return 0;
            }
            var logA = Math.Log(pa);
            var logB = Math.Log(pb);
            var worst = 0.0;
            foreach (var f in Probes)
            {
                var truth = pressureAt(a + (b - a) * f);
                if (!IsUsable(truth))
                {
                    continue;
                }
                var chord = Math.Exp(logA * (1 - f) + logB * f);
                var error = Math.Abs(chord - truth) / truth;
                if (error > worst)
                {
                    worst = error;
                }
            }
            return worst;
        }

        /// <summary>
        /// The highest altitude still carrying at least a
        /// <see cref="FloorDecades"/>-decade fraction of sea-level pressure,
        /// or the ceiling itself when the air never thins that far.
        /// </summary>
        private static double CeilingFor(Func<double, double> pressureAt, double depth, double seaLevel)
        {
            var floor = seaLevel * Math.Pow(10, -FloorDecades);
            var top = Math.Floor(depth) - 1;
            if (top <= 0)
            {
                return 0;
            }
            if (pressureAt(top) >= floor)
            {
                return top;
            }

            var low = 0.0;
            var high = top;
            for (var i = 0; i < 50; i++)
            {
                var mid = (low + high) / 2;
                if (pressureAt(mid) >= floor)
                {
                    low = mid;
                }
                else
                {
                    high = mid;
                }
            }
            return Math.Floor(low);
        }

        /// <summary>A pressure a log can be taken of: finite and above zero.</summary>
        private static bool IsUsable(double p)
        {
            return !double.IsNaN(p) && !double.IsInfinity(p) && p > 0;
        }

        /// <summary>
        /// Rounds to <paramref name="figures"/> significant figures, so the
        /// wire carries the precision the value actually has rather than a
        /// seventeen-digit round-trip of a float32 curve evaluation.
        /// </summary>
        private static double RoundToFigures(double value, int figures)
        {
            if (!IsUsable(value))
            {
                return 0;
            }
            var scale = Math.Pow(10, figures - 1 - (int)Math.Floor(Math.Log10(value)));
            return Math.Round(value * scale) / scale;
        }
    }
}
