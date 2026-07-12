using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Xunit;
using Sitrep.Propagation;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// Cross-language conformance: asserts <see cref="KeplerProvider"/> matches
    /// EVERY case in <c>mod/golden-fixtures/propagation.json</c> -- the same
    /// fixture file <c>packages/sitrep-client</c>'s TS <c>solve()</c> is
    /// asserted against (see <c>propagation.test.ts</c>). Both languages
    /// conforming to one shared fixture set is how we prove the C# server
    /// and the TS SDK derive positions IDENTICALLY
    /// (spec-streaming-delay-model.md &#167;4/&#167;5's derived-channel
    /// requirement) -- rather than each language separately "looking
    /// correct" while silently disagreeing with the other.
    ///
    /// Per-case <c>tolerance</c> in the fixture distinguishes:
    /// <list type="bullet">
    /// <item>"csharp-generated" cases: this same <see cref="KeplerProvider"/>'s
    /// own (near machine-precision) output, captured once via a throwaway
    /// generator -- tight relative tolerance (1e-9). This is a regression
    /// pin (catches an accidental future change to this file), not an
    /// independent correctness check.</item>
    /// <item>"published-reference" case (the Vallado COE2RV worked example):
    /// externally-published, 6-significant-figure values -- looser relative
    /// tolerance (1e-3), matching <see cref="KnownInertialVectorTests"/>,
    /// which pins the same case independently.</item>
    /// </list>
    /// </summary>
    public class GoldenFixtureConformanceTests
    {
        private static string FixturesPath([CallerFilePath] string sourceFilePath = "")
        {
            string testDir = Path.GetDirectoryName(sourceFilePath)!;
            return Path.Combine(testDir, "..", "golden-fixtures", "propagation.json");
        }

        private static FixtureFile LoadFixtures()
        {
            string json = File.ReadAllText(FixturesPath());
            var options = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            };
            return JsonSerializer.Deserialize<FixtureFile>(json, options)
                ?? throw new InvalidOperationException("propagation.json deserialized to null");
        }

        [Fact]
        public void GoldenFixtureFileHasExpectedCaseSpread()
        {
            var fixtures = LoadFixtures();

            Assert.True(fixtures.Cases.Length >= 7, $"expected at least 7 fixture cases, found {fixtures.Cases.Length}");

            var ids = new HashSet<string>();
            foreach (var c in fixtures.Cases)
            {
                ids.Add(c.Id);
            }

            Assert.Contains("vallado-coe2rv-earth-tilted", ids);
        }

        [Fact]
        public void KeplerProviderMatchesEveryGoldenFixtureCase()
        {
            var provider = new KeplerProvider();
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

                StateVector state = provider.Solve(elements, testCase.Ut);

                AssertVectorRelativelyClose(
                    testCase.Expected.Position, state.Position, testCase.Tolerance, $"{testCase.Id}.position");
                AssertVectorRelativelyClose(
                    testCase.Expected.Velocity, state.Velocity, testCase.Tolerance, $"{testCase.Id}.velocity");
            }
        }

        private static void AssertVectorRelativelyClose(double[] expected, Vector3d actual, double tolerance, string label)
        {
            AssertComponentRelativelyClose(expected[0], actual.X, tolerance, label + ".x");
            AssertComponentRelativelyClose(expected[1], actual.Y, tolerance, label + ".y");
            AssertComponentRelativelyClose(expected[2], actual.Z, tolerance, label + ".z");
        }

        private static void AssertComponentRelativelyClose(double expected, double actual, double tolerance, string label)
        {
            double scale = Math.Max(Math.Abs(expected), 1.0);
            double relativeDiff = Math.Abs(actual - expected) / scale;

            Assert.True(
                relativeDiff <= tolerance,
                $"{label}: expected {expected}, got {actual} (relative diff {relativeDiff:E3}, tolerance {tolerance:E3})");
        }
    }

    internal sealed class FixtureFile
    {
        [JsonPropertyName("cases")]
        public FixtureCase[] Cases { get; set; } = Array.Empty<FixtureCase>();
    }

    internal sealed class FixtureCase
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = "";

        [JsonPropertyName("source")]
        public string Source { get; set; } = "";

        [JsonPropertyName("tolerance")]
        public double Tolerance { get; set; }

        [JsonPropertyName("elements")]
        public FixtureElements Elements { get; set; } = new();

        [JsonPropertyName("ut")]
        public double Ut { get; set; }

        [JsonPropertyName("expected")]
        public FixtureExpected Expected { get; set; } = new();
    }

    internal sealed class FixtureElements
    {
        [JsonPropertyName("sma")]
        public double Sma { get; set; }

        [JsonPropertyName("ecc")]
        public double Ecc { get; set; }

        [JsonPropertyName("inc")]
        public double Inc { get; set; }

        [JsonPropertyName("lan")]
        public double Lan { get; set; }

        [JsonPropertyName("argPe")]
        public double ArgPe { get; set; }

        [JsonPropertyName("meanAnomalyAtEpoch")]
        public double MeanAnomalyAtEpoch { get; set; }

        [JsonPropertyName("epoch")]
        public double Epoch { get; set; }

        [JsonPropertyName("mu")]
        public double Mu { get; set; }
    }

    internal sealed class FixtureExpected
    {
        [JsonPropertyName("position")]
        public double[] Position { get; set; } = Array.Empty<double>();

        [JsonPropertyName("velocity")]
        public double[] Velocity { get; set; } = Array.Empty<double>();
    }
}
