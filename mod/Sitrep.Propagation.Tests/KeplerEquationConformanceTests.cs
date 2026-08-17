using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Xunit;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// The same contract every solver of Kepler's equation must satisfy, applied to the
    /// C# vanilla THROUGH <see cref="IPropagationProvider"/>, on the same grid as
    /// <c>packages/core/src/kepler-conformance.test.ts</c>.
    ///
    /// <para>The grid comes from <c>mod/golden-fixtures/kepler-equation.json</c> so the two
    /// languages cannot drift apart about what the contract is, in the same way
    /// <c>propagation.json</c> keeps them from drifting about the answers. Read that file's
    /// <c>howThisGridWasChosen</c> before changing any of it: a uniform sweep misses the
    /// defect this suite exists for, and a coarse one misreports where it starts.</para>
    ///
    /// <para><b>This side is expected to pass trivially.</b> If it ever does not, that is a
    /// far larger finding than the client-side bug that prompted the suite, because the
    /// golden fixtures already tie the two languages together and the mod is what the game
    /// acts on.</para>
    ///
    /// <para><b>Reaching E through the seam.</b> The interface answers with a state vector
    /// and not an anomaly, which is correct: nothing outside a provider should be handed a
    /// conic's internals. So the eccentric anomaly is recovered from the state instead, with
    /// the orbit laid flat (inc = lan = argPe = 0) so the perifocal frame IS the answer's
    /// frame and <c>x = a(cos E - e)</c>, <c>y = b sin E</c>. Recovered by
    /// <c>Atan2</c> rather than by <c>Acos</c> on the radius, which would be badly
    /// conditioned near E = 0, exactly where this grid is densest and where the client-side
    /// defect lives.</para>
    /// </summary>
    public class KeplerEquationConformanceTests
    {
        private const double Mu = 3.5316e12;
        private const double Sma = 1.0e6;

        private static string FixturePath([CallerFilePath] string sourceFilePath = "")
        {
            var testDir = Path.GetDirectoryName(sourceFilePath)!;
            return Path.Combine(testDir, "..", "golden-fixtures", "kepler-equation.json");
        }

        private static Grid LoadGrid()
        {
            var json = File.ReadAllText(FixturePath());
            var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
            return JsonSerializer.Deserialize<Grid>(json, options)
                ?? throw new InvalidOperationException("kepler-equation.json deserialized to null");
        }

        private static readonly Grid TheGrid = LoadGrid();

        private static List<double> MeanAnomalies()
        {
            var all = new List<double>(TheGrid.MeanAnomaliesNearZero);
            for (var i = 0; i < TheGrid.MeanAnomalySweepCount; i++)
            {
                all.Add(2.0 * Math.PI * i / TheGrid.MeanAnomalySweepCount);
            }
            return all;
        }

        private static OrbitElements Flat(double ecc, double meanAnomaly) =>
            new OrbitElements(Sma, ecc, 0.0, 0.0, 0.0, meanAnomaly, 0.0, Mu);

        /// <summary>
        /// The eccentric anomaly the provider's own answer implies, recovered from the
        /// state vector rather than asked for, because the seam does not offer it and
        /// should not.
        /// </summary>
        private static double EccentricAnomalyFrom(IPropagationProvider provider, double ecc, double meanAnomaly)
        {
            var target = ThroughTheSeam.Craft(Flat(ecc, meanAnomaly));
            var position = provider.Solve(target, 0.0).Position;

            var cosE = position.X / Sma + ecc;
            var sinE = position.Y / (Sma * Math.Sqrt(1.0 - ecc * ecc));

            // Wrapped into [0, 2pi) rather than left in Atan2's (-pi, pi]. The residual and
            // the round trip are both insensitive to a whole revolution, but the swept-area
            // check is not: past apoapsis Atan2 returns a NEGATIVE angle, and integrating to
            // it runs the sweep backwards from periapsis. That is how this suite's own area
            // check first failed, on its own bug rather than the provider's, which is at
            // least evidence that it has teeth.
            return WrapTwoPi(Math.Atan2(sinE, cosE));
        }

        private static double WrapPi(double radians)
        {
            var twoPi = 2.0 * Math.PI;
            var x = radians % twoPi;
            if (x > Math.PI) x -= twoPi;
            if (x <= -Math.PI) x += twoPi;
            return x;
        }

        private static double Residual(double eccentricAnomaly, double ecc, double meanAnomaly) =>
            Math.Abs(WrapPi(eccentricAnomaly - ecc * Math.Sin(eccentricAnomaly) - meanAnomaly));

        [Fact]
        public void TheVanillaSolvesTheEquationToMachinePrecisionAcrossTheWholeGrid()
        {
            IPropagationProvider provider = new KeplerProvider();
            var failures = new List<string>();

            foreach (var ecc in TheGrid.Eccentricities)
            {
                // The recovery below divides by sin E's scale factor, which is fine for
                // every eccentricity the grid carries but would be a zero for ecc = 1.
                if (ecc >= 1.0) continue;

                foreach (var meanAnomaly in MeanAnomalies())
                {
                    var e = EccentricAnomalyFrom(provider, ecc, meanAnomaly);
                    var residual = Residual(e, ecc, meanAnomaly);
                    if (!(residual <= TheGrid.MaxAbsoluteResidualRadians))
                    {
                        failures.Add($"ecc={ecc} M={meanAnomaly} E={e} residual={residual:E3}");
                    }
                }
            }

            Assert.Empty(failures.GetRange(0, Math.Min(10, failures.Count)));
        }

        [Fact]
        public void TheVanillaRoundTripsWithinTheConditioningOfTheProblem()
        {
            IPropagationProvider provider = new KeplerProvider();
            var failures = new List<string>();

            foreach (var ecc in TheGrid.Eccentricities)
            {
                for (var i = 0; i <= 64; i++)
                {
                    var e = 2.0 * Math.PI * i / 64.0;
                    var meanAnomaly = e - ecc * Math.Sin(e);

                    var back = EccentricAnomalyFrom(provider, ecc, WrapTwoPi(meanAnomaly));
                    var drift = Math.Abs(WrapPi(back - e));

                    // Derived rather than picked: the map M -> E is stiff near periapsis
                    // of a very eccentric orbit, so a fixed tolerance in E would either be
                    // meaningless or fail on conditioning alone where this matters most.
                    var slope = 1.0 / Math.Max(1.0 - ecc * Math.Cos(e), double.Epsilon);
                    var allowed = TheGrid.MaxMeanAnomalyErrorForRoundTripRadians * slope + 1e-12;

                    if (!(drift <= allowed))
                    {
                        failures.Add($"ecc={ecc} E={e} drift={drift:E3} allowed={allowed:E3}");
                    }
                }
            }

            Assert.Empty(failures.GetRange(0, Math.Min(10, failures.Count)));
        }

        /// <summary>
        /// Kepler's SECOND law, which the residual cannot check: a residual is satisfied by
        /// any solver consistent with the equation as written, including one written wrongly.
        /// This derives the same relationship from somewhere else entirely, the swept area,
        /// so a misstated equation fails it while satisfying the residual perfectly.
        ///
        /// <para>The brief asked for externally-published triples for this job. None could
        /// be sourced and verified against a primary source, so this is the substitute; see
        /// <c>publishedTriplesNote</c> in the fixture.</para>
        /// </summary>
        [Fact]
        public void TheVanillaAgreesWithKeplersSecondLaw()
        {
            IPropagationProvider provider = new KeplerProvider();
            var failures = new List<string>();

            foreach (var ecc in new[] { 0.0, 0.5, 0.9, 0.99, 0.999 })
            {
                foreach (var meanAnomaly in new[] { 0.4, 1.0, 2.0, 3.0, 4.5, 6.0 })
                {
                    var e = EccentricAnomalyFrom(provider, ecc, meanAnomaly);
                    var fraction = SweptAreaFraction(e, ecc, TheGrid.AreaLawSimpsonIntervals);
                    var expected = meanAnomaly / (2.0 * Math.PI);
                    var relative = Math.Abs(fraction - expected) / Math.Max(Math.Abs(expected), 1e-12);

                    if (!(relative <= TheGrid.AreaLawRelativeTolerance))
                    {
                        failures.Add($"ecc={ecc} M={meanAnomaly}: swept {fraction} vs {expected}");
                    }
                }
            }

            Assert.Empty(failures.GetRange(0, Math.Min(10, failures.Count)));
        }

        [Fact]
        public void TheAreaLawCheckRejectsAPlausibleWrongSolver()
        {
            // The guard on the guard. An area-law check with no demonstrated ability to
            // fail is the shape of every false green this subsystem has produced. E = M is
            // exact for a circle and wrong for anything else, so it is the most plausible
            // wrong answer there is.
            var atCircular = SweptAreaFraction(2.0, 0.0, TheGrid.AreaLawSimpsonIntervals);
            Assert.True(Math.Abs(atCircular - 2.0 / (2.0 * Math.PI)) < 1e-9);

            var atEccentric = SweptAreaFraction(2.0, 0.9, TheGrid.AreaLawSimpsonIntervals);
            Assert.True(Math.Abs(atEccentric - 2.0 / (2.0 * Math.PI)) > 0.05);
        }

        [Theory]
        [InlineData(1.0)]
        [InlineData(1.4)]
        [InlineData(2.5)]
        public void TheVanillaRefusesAnEccentricityTheEllipticFormDoesNotDescribe(double ecc)
        {
            // The contract, picked rather than left to whichever file a caller happened to
            // reach: at ecc >= 1 the elliptic form does not apply, so a solver refuses
            // rather than returning a number. The C# side refuses through CanPropagate,
            // which is the same refusal every other caller gets.
            IPropagationProvider provider = new KeplerProvider();
            var target = ThroughTheSeam.Craft(Flat(ecc, 1.0));

            Assert.False(provider.CanPropagate(target, 0.0, 0.0));
            Assert.Throws<NotSupportedException>(() => provider.Solve(target, 0.0));
        }

        /// <summary>
        /// The fraction of the ellipse's area swept from periapsis out to eccentric anomaly
        /// <paramref name="eccentricAnomaly"/> by the radius from the occupied focus,
        /// integrated numerically by Simpson's rule over the ellipse's own parametrisation.
        /// Kepler's equation appears nowhere in it.
        /// </summary>
        private static double SweptAreaFraction(double eccentricAnomaly, double ecc, int intervals)
        {
            const double a = 1.0;
            var b = Math.Sqrt(1.0 - ecc * ecc);

            // dA/dE' = (1/2)(x y' - y x') for x = a(cos E' - e), y = b sin E'.
            Func<double, double> integrand = ep =>
                0.5 * ((a * (Math.Cos(ep) - ecc) * (b * Math.Cos(ep)))
                    - (b * Math.Sin(ep) * (-a * Math.Sin(ep))));

            var n = intervals % 2 == 0 ? intervals : intervals + 1;
            var h = eccentricAnomaly / n;
            var total = integrand(0.0) + integrand(eccentricAnomaly);
            for (var i = 1; i < n; i++)
            {
                total += (i % 2 == 0 ? 2.0 : 4.0) * integrand(i * h);
            }

            return h / 3.0 * total / (Math.PI * a * b);
        }

        private static double WrapTwoPi(double angle)
        {
            var twoPi = 2.0 * Math.PI;
            var wrapped = angle % twoPi;
            if (wrapped < 0) wrapped += twoPi;
            return wrapped;
        }

        internal sealed class Grid
        {
            [JsonPropertyName("eccentricities")]
            public double[] Eccentricities { get; set; } = Array.Empty<double>();

            [JsonPropertyName("meanAnomaliesNearZero")]
            public double[] MeanAnomaliesNearZero { get; set; } = Array.Empty<double>();

            [JsonPropertyName("meanAnomalySweepCount")]
            public int MeanAnomalySweepCount { get; set; }

            [JsonPropertyName("maxAbsoluteResidualRadians")]
            public double MaxAbsoluteResidualRadians { get; set; }

            [JsonPropertyName("maxMeanAnomalyErrorForRoundTripRadians")]
            public double MaxMeanAnomalyErrorForRoundTripRadians { get; set; }

            [JsonPropertyName("areaLawRelativeTolerance")]
            public double AreaLawRelativeTolerance { get; set; }

            [JsonPropertyName("areaLawSimpsonIntervals")]
            public int AreaLawSimpsonIntervals { get; set; }
        }
    }
}
