using System;
using System.Linq;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The sampler's error bound is measured here rather than asserted in a
    /// comment, and it is measured against a REAL atmosphere: the pressure
    /// curve RealSolarSystem ships for Earth, evaluated the way KSP evaluates
    /// it (a Unity <c>AnimationCurve</c> cubic Hermite, in float32). That is
    /// the case the widget this exists for is actually flown in.
    ///
    /// <para>A synthetic exponential is tested alongside it for the opposite
    /// reason: it is the shape a log-linear join reproduces EXACTLY, so it
    /// catches an implementation that has stopped interpolating in log space
    /// at all, which a tolerance check on a real curve would still pass.</para>
    /// </summary>
    public class AtmospherePressureProfileTests
    {
        /// <summary>
        /// RSS Earth's <c>pressureCurve</c>, altitude in metres against
        /// pressure in kPa with the in/out tangents, verbatim from
        /// <c>RealSolarSystem/RSSKopernicus/Earth/Earth.cfg</c>. Ends at a
        /// hard zero at the 140 km ceiling, which is the terminal cliff the
        /// table deliberately stops short of.
        /// </summary>
        private static readonly double[][] RssEarthCurve =
        {
            new[] { 0d, 101.325, 0d, -0.0119729 },
            new[] { 1000d, 89.9537, -0.0107923, -0.0107923 },
            new[] { 2000d, 79.7013, -0.00972759, -0.00972759 },
            new[] { 3000d, 70.4691, -0.00875313, -0.00875313 },
            new[] { 4000d, 62.1620, -0.00787633, -0.00787633 },
            new[] { 5000d, 54.6886, -0.00708329, -0.00708329 },
            new[] { 6000d, 47.9719, -0.00636074, -0.00636074 },
            new[] { 7000d, 41.9470, -0.00569867, -0.00569867 },
            new[] { 8000d, 36.5555, -0.00509376, -0.00509376 },
            new[] { 9000d, 31.7428, -0.00453892, -0.00453892 },
            new[] { 10000d, 27.4635, -0.00402664, -0.00402664 },
            new[] { 12000d, 20.3407, -0.00312205, -0.00312205 },
            new[] { 14000d, 14.8739, -0.00236992, -0.00236992 },
            new[] { 16000d, 10.7657, -0.00175875, -0.00175875 },
            new[] { 18000d, 7.76098, -0.00126703, -0.00126703 },
            new[] { 20000d, 5.61289, -0.000901159, -0.000901159 },
            new[] { 22000d, 4.08419, -0.000643110, -0.000643110 },
            new[] { 24000d, 2.98894, -0.000462653, -0.000462653 },
            new[] { 26000d, 2.19866, -0.000334849, -0.000334849 },
            new[] { 28000d, 1.62536, -0.000243495, -0.000243495 },
            new[] { 30000d, 1.20769, -0.000177736, -0.000177736 },
            new[] { 35000d, 0.588602, -8.25983E-05, -8.25983E-05 },
            new[] { 40000d, 0.296819, -3.96388E-05, -3.96388E-05 },
            new[] { 45000d, 0.154692, -1.97099E-05, -1.97099E-05 },
            new[] { 50000d, 0.0825035, -1.03082E-05, -1.03082E-05 },
            new[] { 55000d, 0.0438832, -5.63677E-06, -5.63677E-06 },
            new[] { 60000d, 0.0227005, -3.07935E-06, -3.07935E-06 },
            new[] { 65000d, 0.0112807, -1.62592E-06, -1.62592E-06 },
            new[] { 70000d, 0.00536204, -8.22892E-07, -8.22892E-07 },
            new[] { 75000d, 0.00243557, -3.94225E-07, -3.94225E-07 },
            new[] { 80000d, 0.00106710, -1.78982E-07, -1.78982E-07 },
            new[] { 85000d, 0.000456872, -7.82929E-08, -7.82929E-08 },
            new[] { 90000d, 0.000192739, -3.34218E-08, -3.34218E-08 },
            new[] { 95000d, 8.12137E-05, -1.38889E-08, -1.38889E-08 },
            new[] { 100000d, 3.52962E-05, -5.69392E-09, -5.69392E-09 },
            new[] { 105000d, 1.62730E-05, -2.40474E-09, -2.40474E-09 },
            new[] { 110000d, 8.14091E-06, -1.04206E-09, -1.04206E-09 },
            new[] { 115000d, 4.55287E-06, -4.76718E-10, -4.76718E-10 },
            new[] { 121920d, 2.40103E-06, -1.98682E-10, -1.98682E-10 },
            new[] { 140000d, 0d, 0d, 0d },
        };

        private const double RssEarthDepth = 140_000;

        /// <summary>
        /// <c>CelestialBody.GetPressure</c> for a curve body: 0 at or above
        /// the ceiling, and Unity's own cubic Hermite below it, evaluated in
        /// float32 because <c>AnimationCurve</c> is a float curve.
        /// </summary>
        private static double RssEarthPressure(double altitude)
        {
            if (altitude >= RssEarthDepth)
            {
                return 0;
            }
            var h = Math.Max(0, altitude);
            if (h <= RssEarthCurve[0][0])
            {
                return RssEarthCurve[0][1];
            }
            var i = 0;
            while (i < RssEarthCurve.Length - 1 && RssEarthCurve[i + 1][0] <= h)
            {
                i++;
            }
            var a = RssEarthCurve[i];
            var b = RssEarthCurve[i + 1];
            var dx = b[0] - a[0];
            var t = (float)((h - a[0]) / dx);
            var t2 = (float)(t * t);
            var t3 = (float)(t2 * t);
            var value =
                (float)(2 * t3 - 3 * t2 + 1) * (float)a[1]
                + (float)(t3 - 2 * t2 + t) * (float)dx * (float)a[3]
                + (float)(-2 * t3 + 3 * t2) * (float)b[1]
                + (float)(t3 - t2) * (float)dx * (float)b[2];
            return Math.Max(0, value);
        }

        private static Func<double, double> Exponential(double p0, double scaleHeight, double depth)
        {
            return altitude => altitude >= depth
                ? 0
                : p0 * Math.Exp(-Math.Max(0, altitude) / scaleHeight);
        }

        /// <summary>Log-linear join, exactly as a client reconstructs the curve.</summary>
        private static double Reconstruct(double[] altitudes, double[] pressures, double altitude)
        {
            if (altitude <= altitudes[0])
            {
                return pressures[0];
            }
            var i = 0;
            while (i < altitudes.Length - 2 && altitudes[i + 1] < altitude)
            {
                i++;
            }
            var f = (altitude - altitudes[i]) / (altitudes[i + 1] - altitudes[i]);
            var a = pressures[i];
            var b = pressures[i + 1];
            if (a <= 0 || b <= 0)
            {
                return a * (1 - f) + b * f;
            }
            return Math.Exp(Math.Log(a) * (1 - f) + Math.Log(b) * f);
        }

        /// <summary>
        /// Largest fraction by which the reconstruction departs the truth,
        /// swept at 100 m over the whole table.
        /// </summary>
        private static double WorstError(
            Func<double, double> truthAt,
            double[] altitudes,
            double[] pressures)
        {
            var worst = 0.0;
            for (var h = 0.0; h <= altitudes[altitudes.Length - 1]; h += 100)
            {
                var truth = truthAt(h);
                if (truth <= 0)
                {
                    continue;
                }
                var error = Math.Abs(Reconstruct(altitudes, pressures, h) - truth) / truth;
                if (error > worst)
                {
                    worst = error;
                }
            }
            return worst;
        }

        [Fact]
        public void ReconstructsTheRealRssEarthCurveInsideTheStatedTolerance()
        {
            Assert.True(AtmospherePressureProfile.TryBuild(
                RssEarthPressure, RssEarthDepth, out var altitudes, out var pressures));

            // The tolerance is the bisection's own criterion, so the swept
            // error can land a little above it between probes; the sampler
            // claims 1% class, not 1% to the digit.
            Assert.True(
                WorstError(RssEarthPressure, altitudes, pressures) < 1.5 * AtmospherePressureProfile.Tolerance,
                $"worst error {WorstError(RssEarthPressure, altitudes, pressures):P3}");
            Assert.InRange(altitudes.Length, 2, AtmospherePressureProfile.MaxSamples);
        }

        [Fact]
        public void IsHundredsOfTimesCloserThanTheExponentialModelOnTheRealCurve()
        {
            /* The model this replaces, on the same body: P0·exp(-h/H) with the
               8.5 km scale height a client would derive for Earth. It is not
               nearly wrong, it is a different function, and over the table's
               own span it reads high by a factor of 16.3 at the top. */
            AtmospherePressureProfile.TryBuild(
                RssEarthPressure, RssEarthDepth, out var altitudes, out var pressures);
            var modelWorst = 0.0;
            for (var h = 0.0; h <= altitudes[altitudes.Length - 1]; h += 100)
            {
                var truth = RssEarthPressure(h);
                if (truth <= 0)
                {
                    continue;
                }
                var modelled = 101.325 * Math.Exp(-h / 8_500);
                modelWorst = Math.Max(modelWorst, Math.Abs(modelled - truth) / truth);
            }
            var sampledWorst = WorstError(RssEarthPressure, altitudes, pressures);

            Assert.True(modelWorst > 5, $"model error {modelWorst:P1}");
            Assert.True(
                sampledWorst < modelWorst / 100,
                $"sampled {sampledWorst:P3} against modelled {modelWorst:P1}");
        }

        [Fact]
        public void ReproducesAPurelyExponentialAtmosphereExactly()
        {
            var pressureAt = Exponential(101.325, 5_600, 70_000);
            Assert.True(AtmospherePressureProfile.TryBuild(
                pressureAt, 70_000, out var altitudes, out var pressures));

            // Log-linear through points on an exponential IS the exponential,
            // so only the six-figure rounding separates them.
            Assert.True(
                WorstError(pressureAt, altitudes, pressures) < 1e-5,
                $"worst error {WorstError(pressureAt, altitudes, pressures):E2}");
            // And it costs almost nothing to say so: two points would do.
            Assert.InRange(altitudes.Length, 2, 4);
        }

        [Fact]
        public void StopsAtThePressureFloorRatherThanAtTheCeiling()
        {
            AtmospherePressureProfile.TryBuild(
                RssEarthPressure, RssEarthDepth, out var altitudes, out var pressures);
            var top = altitudes[altitudes.Length - 1];

            Assert.True(top < RssEarthDepth, "the table must stop short of the hard-zero ceiling");
            Assert.True(
                pressures[pressures.Length - 1] > 0,
                "every sample carries a pressure a log can be taken of");
            /* Landing ON the floor, not near it: the bisection that finds the
               ceiling is exact enough that the last sample is within a factor
               of ten of the declared floor. */
            var ratio = pressures[pressures.Length - 1] / pressures[0];
            var floor = Math.Pow(10, -AtmospherePressureProfile.FloorDecades);
            Assert.InRange(ratio, floor, floor * 10);
        }

        [Fact]
        public void SamplesAscendFromSeaLevelAndPairOneForOne()
        {
            AtmospherePressureProfile.TryBuild(
                RssEarthPressure, RssEarthDepth, out var altitudes, out var pressures);

            Assert.Equal(altitudes.Length, pressures.Length);
            Assert.Equal(0, altitudes[0]);
            Assert.Equal(
                altitudes.OrderBy(x => x).ToArray(),
                altitudes);
            Assert.All(altitudes, a => Assert.True(a >= 0));
            Assert.All(pressures, p => Assert.True(p > 0));
        }

        [Fact]
        public void RoundsEachSampleToSixSignificantFigures()
        {
            AtmospherePressureProfile.TryBuild(
                RssEarthPressure, RssEarthDepth, out _, out var pressures);

            foreach (var p in pressures)
            {
                var scale = Math.Pow(10, 5 - Math.Floor(Math.Log10(p)));
                Assert.Equal(Math.Round(p * scale), p * scale, 6);
            }
        }

        [Fact]
        public void RefusesABodyWithNoAirToDescribe()
        {
            Assert.False(AtmospherePressureProfile.TryBuild(_ => 0, 70_000, out _, out _));
            Assert.False(AtmospherePressureProfile.TryBuild(Exponential(101.325, 5_600, 70_000), 0, out _, out _));
            Assert.False(AtmospherePressureProfile.TryBuild(null!, 70_000, out _, out _));
        }

        [Fact]
        public void KeepsToItsPointBudgetOnACurveNothingCanResolve()
        {
            /* A curve that wiggles faster than any finite table can follow.
               The budget, not the tolerance, is what has to stop this. */
            var random = new Random(7);
            var noise = new double[4096];
            for (var i = 0; i < noise.Length; i++)
            {
                noise[i] = random.NextDouble();
            }
            Func<double, double> pathological = altitude =>
            {
                if (altitude >= 70_000)
                {
                    return 0;
                }
                var i = (int)(Math.Max(0, altitude) / 17) % noise.Length;
                return 101.325 * Math.Exp(-altitude / 5_600) * (0.5 + noise[i]);
            };

            Assert.True(AtmospherePressureProfile.TryBuild(pathological, 70_000, out var altitudes, out _));
            Assert.InRange(altitudes.Length, 2, AtmospherePressureProfile.MaxSamples);
        }
    }
}
