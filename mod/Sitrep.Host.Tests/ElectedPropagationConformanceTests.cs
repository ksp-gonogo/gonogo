using System;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Sitrep.Contract;
using Sitrep.Host.Propagation;
using Sitrep.Propagation;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// What an UNMODIFIED game actually answers, reached the way the mod reaches it:
    /// bootstrap a kernel, register nothing, resolve the <c>"propagation"</c> capability,
    /// and hold whatever comes back to <c>mod/golden-fixtures/propagation.json</c>.
    ///
    /// <para><c>GoldenFixtureConformanceTests</c> pins the same fixtures against
    /// <see cref="KeplerProvider"/> directly, which is the cross-language pin against
    /// <c>packages/sitrep-client/src/propagation.test.ts</c>. This one pins something
    /// different and one layer up: that the ELECTION PATH, with no providers registered,
    /// arrives at a propagator satisfying them. Nothing else checks that the two ends of
    /// that path meet, and a wiring change could silently put an unrelated propagator in
    /// front of every silence prediction while both halves stayed green on their
    /// own.</para>
    ///
    /// <para><b>Deliberately conditional on nothing being elected.</b> It does NOT say
    /// "whatever is elected must match two-body fixtures", and it must never be widened
    /// into saying that: a backend running different physics SHOULD disagree with these
    /// numbers, and a test that punished it for disagreeing would be pressure on a future
    /// provider to match values it has no business matching. The claim is only about the
    /// stock game.</para>
    /// </summary>
    public class ElectedPropagationConformanceTests
    {
        [Fact]
        public void WithNothingElectedTheElectedPropagatorMatchesEveryGoldenFixtureCase()
        {
            var kernel = new Kernel();
            PropagationElection.RegisterCapability(kernel);
            kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });

            var propagator = PropagationElection.Elected(kernel);
            Assert.NotNull(propagator);

            var fixtures = LoadFixtures();
            Assert.NotEmpty(fixtures.Cases);

            foreach (var testCase in fixtures.Cases)
            {
                var elements = new OrbitElements(
                    sma: testCase.Elements.Sma,
                    ecc: testCase.Elements.Ecc,
                    inc: testCase.Elements.Inc,
                    lan: testCase.Elements.Lan,
                    argPe: testCase.Elements.ArgPe,
                    meanAnomalyAtEpoch: testCase.Elements.MeanAnomalyAtEpoch,
                    epoch: testCase.Elements.Epoch,
                    mu: testCase.Elements.Mu);

                // A conic reaches a provider as a target's payload, asked for in the
                // target's own parent frame. There is no element-keyed way in, here or
                // anywhere else, which is the point of the seam.
                var target = PropagationTarget.Vessel("fixture-craft", FixtureParentBody, elements);
                Assert.True(
                    propagator!.CanPropagate(target, testCase.Ut, testCase.Ut),
                    testCase.Id + ": the elected propagator declined a fixture case");

                var state = propagator.Solve(target, testCase.Ut);

                AssertVectorRelativelyClose(
                    testCase.Expected.Position, state.Position, testCase.Tolerance, testCase.Id + ".position");
                AssertVectorRelativelyClose(
                    testCase.Expected.Velocity, state.Velocity, testCase.Tolerance, testCase.Id + ".velocity");
            }
        }

        /// <summary>
        /// The body a fixture's conic is measured against. Which one it is cannot matter:
        /// a fixture describes one orbit with no system around it, and the target and the
        /// frame need only agree on a centre.
        /// </summary>
        private const int FixtureParentBody = 0;

        private static string FixturesPath([CallerFilePath] string sourceFilePath = "")
        {
            var testDir = Path.GetDirectoryName(sourceFilePath)!;
            return Path.Combine(testDir, "..", "golden-fixtures", "propagation.json");
        }

        private static FixtureFile LoadFixtures()
        {
            var json = File.ReadAllText(FixturesPath());
            var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
            return JsonSerializer.Deserialize<FixtureFile>(json, options)
                ?? throw new InvalidOperationException("propagation.json deserialized to null");
        }

        private static void AssertVectorRelativelyClose(
            double[] expected, Vector3d actual, double tolerance, string label)
        {
            AssertComponentRelativelyClose(expected[0], actual.X, tolerance, label + ".x");
            AssertComponentRelativelyClose(expected[1], actual.Y, tolerance, label + ".y");
            AssertComponentRelativelyClose(expected[2], actual.Z, tolerance, label + ".z");
        }

        private static void AssertComponentRelativelyClose(
            double expected, double actual, double tolerance, string label)
        {
            var scale = Math.Max(Math.Abs(expected), 1.0);
            var relativeDiff = Math.Abs(actual - expected) / scale;

            Assert.True(
                relativeDiff <= tolerance,
                label + ": expected " + expected + ", got " + actual
                    + " (relative diff " + relativeDiff.ToString("E3")
                    + ", tolerance " + tolerance.ToString("E3") + ")");
        }

        private sealed class FixtureFile
        {
            public FixtureCase[] Cases { get; set; } = Array.Empty<FixtureCase>();
        }

        private sealed class FixtureCase
        {
            public string Id { get; set; } = "";

            public double Tolerance { get; set; }

            public FixtureElements Elements { get; set; } = new FixtureElements();

            public double Ut { get; set; }

            public FixtureExpected Expected { get; set; } = new FixtureExpected();
        }

        private sealed class FixtureElements
        {
            public double Sma { get; set; }

            public double Ecc { get; set; }

            public double Inc { get; set; }

            public double Lan { get; set; }

            public double ArgPe { get; set; }

            public double MeanAnomalyAtEpoch { get; set; }

            public double Epoch { get; set; }

            public double Mu { get; set; }
        }

        private sealed class FixtureExpected
        {
            public double[] Position { get; set; } = Array.Empty<double>();

            public double[] Velocity { get; set; } = Array.Empty<double>();
        }
    }
}
