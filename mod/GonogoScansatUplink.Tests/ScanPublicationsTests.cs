using System.Collections.Generic;
using System.Linq;
using Gonogo.ScansatUplink;
using Xunit;

namespace GonogoScansatUplink.Tests
{
    /// <summary>
    /// Exercises the COURIER-SIDE half of the F1 capture-on-main /
    /// handle-on-Courier split (<see cref="ScanPublications.Compute"/>). The
    /// load-bearing fact this test embodies: it lives in the HEADLESS test
    /// project (net10.0, NO SCANsat/KSP DLLs referenced), yet drives the ENTIRE
    /// Courier-side path from a hand-built <see cref="ScanCapture"/> payload.
    /// That is only possible because every KSP/SCANsat/stock read now happens
    /// on the main thread in <c>ScansatUplink.CaptureOnMain</c> — the Courier
    /// path (<see cref="ScanPublications.Compute"/>) is provably KSP-free by
    /// construction (it wouldn't compile here otherwise), driven exclusively by
    /// the captured data.
    /// </summary>
    public class ScanPublicationsTests
    {
        // SCANsat's own native coverage grid is ALWAYS 360x180, independent
        // of whatever ScanGrids.Width/Height the height/biome grid uses
        // (Task 4 decoupled the mask payload's declared dims from
        // ScanGrids.Width/Height for exactly this reason) - these fixtures
        // represent realistic coverage arrays, not the height/biome grid
        // size, so they use their own named constants rather than
        // ScanGrids.Width/Height.
        private const int NativeCoverageWidth = 360;
        private const int NativeCoverageHeight = 180;

        private static ScanCapture BuildCapture(short[,] coverage, bool includeHeightBiome)
        {
            return new ScanCapture
            {
                Ut = 5.0,
                BodyName = "Kerbin",
                Coverage = coverage,
                CoveragePercents = new Dictionary<short, double>
                {
                    [1] = 12.5,
                    [2] = 0.0,
                    [8] = 3.0,
                    [16] = 0.0,
                    [128] = 0.0,
                    [256] = 0.0,
                },
                IncludeHeightBiome = includeHeightBiome,
                HeightGrid = ScanGrids.BuildHeights(ScanGrids.Width, ScanGrids.Height, (_, _) => 0.0),
                BiomeEntries = new List<object?>(),
                BiomeIndices = ScanGrids.BuildBiomeIndices(ScanGrids.Width, ScanGrids.Height, (_, _) => -1),
            };
        }

        [Fact]
        public void FirstVisitEmitsHeightBiomeOnceAndAKeyframeForEveryClientType()
        {
            var coverage = new short[NativeCoverageWidth, NativeCoverageHeight];
            coverage[0, 0] = 1 | 8; // AltimetryLoRes(1) + Biome(8) set in one cell.

            var lastHashByBody = new Dictionary<string, ulong>();
            var lastPackedByBodyType = new Dictionary<string, byte[]>();

            var publications = ScanPublications.Compute(
                BuildCapture(coverage, includeHeightBiome: true), lastHashByBody, lastPackedByBodyType);

            // Height + biome once, on the body sub-topic.
            Assert.Single(publications, p => p.Kind == ScanChannelKind.Height && p.SubTopic == "Kerbin");
            Assert.Single(publications, p => p.Kind == ScanChannelKind.Biome && p.SubTopic == "Kerbin");

            // First keyframe: every client SCANtype's coverage + mask emits.
            var coverageTypes = publications
                .Where(p => p.Kind == ScanChannelKind.Coverage)
                .Select(p => p.SubTopic)
                .OrderBy(s => s)
                .ToArray();
            Assert.Equal(
                new[] { "Kerbin.1", "Kerbin.128", "Kerbin.16", "Kerbin.2", "Kerbin.256", "Kerbin.8" },
                coverageTypes);
            Assert.Equal(6, publications.Count(p => p.Kind == ScanChannelKind.Mask));

            // coverage.<body>.<type> carries the SCALAR percentage.
            var loRes = publications.Single(p => p.Kind == ScanChannelKind.Coverage && p.SubTopic == "Kerbin.1");
            Assert.Equal(12.5, loRes.Payload);
            Assert.Equal(5.0, loRes.Ut);
        }

        [Fact]
        public void UnchangedCoverageOnARevisitEmitsNothing()
        {
            var coverage = new short[NativeCoverageWidth, NativeCoverageHeight];
            coverage[0, 0] = 1;

            var lastHashByBody = new Dictionary<string, ulong>();
            var lastPackedByBodyType = new Dictionary<string, byte[]>();

            // First visit primes the gates.
            ScanPublications.Compute(
                BuildCapture(coverage, includeHeightBiome: true), lastHashByBody, lastPackedByBodyType);

            // Revisit: same coverage, height/biome already captured — nothing new.
            var second = ScanPublications.Compute(
                BuildCapture(coverage, includeHeightBiome: false), lastHashByBody, lastPackedByBodyType);

            Assert.Empty(second);
        }

        [Fact]
        public void NoCoverageStillEmitsHeightBiomeOnFirstVisit()
        {
            var lastHashByBody = new Dictionary<string, ulong>();
            var lastPackedByBodyType = new Dictionary<string, byte[]>();

            var capture = BuildCapture(coverage: new short[NativeCoverageWidth, NativeCoverageHeight], includeHeightBiome: true);
            capture.Coverage = null;         // body never scanned yet
            capture.CoveragePercents = null;

            var publications = ScanPublications.Compute(capture, lastHashByBody, lastPackedByBodyType);

            Assert.Equal(2, publications.Count);
            Assert.Contains(publications, p => p.Kind == ScanChannelKind.Height);
            Assert.Contains(publications, p => p.Kind == ScanChannelKind.Biome);
            Assert.DoesNotContain(publications, p => p.Kind == ScanChannelKind.Coverage || p.Kind == ScanChannelKind.Mask);
        }

        [Fact]
        public void FirstVisitPublishesAnomaliesWhenCaptureIncludesThem()
        {
            var coverage = new short[NativeCoverageWidth, NativeCoverageHeight];
            coverage[0, 0] = 1;

            var lastHashByBody = new Dictionary<string, ulong>();
            var lastPackedByBodyType = new Dictionary<string, byte[]>();

            var capture = BuildCapture(coverage, includeHeightBiome: false);
            capture.Anomalies = ScanAnomalies.Build(new List<ScanAnomalies.AnomalyInput>
            {
                new ScanAnomalies.AnomalyInput("KSC Monolith", 285.3, -0.05, known: true, detail: true),
            });

            var publications = ScanPublications.Compute(capture, lastHashByBody, lastPackedByBodyType);

            var anomalyPub = Assert.Single(publications, p => p.Kind == ScanChannelKind.Anomalies);
            Assert.Equal("Kerbin", anomalyPub.SubTopic);
            Assert.Same(capture.Anomalies, anomalyPub.Payload);
            Assert.Equal(5.0, anomalyPub.Ut);
        }

        [Fact]
        public void NullAnomaliesOnCapture_EmitsNoAnomalyPublication()
        {
            var coverage = new short[NativeCoverageWidth, NativeCoverageHeight];
            coverage[0, 0] = 1;

            var lastHashByBody = new Dictionary<string, ulong>();
            var lastPackedByBodyType = new Dictionary<string, byte[]>();

            var capture = BuildCapture(coverage, includeHeightBiome: false);
            capture.Anomalies = null;

            var publications = ScanPublications.Compute(capture, lastHashByBody, lastPackedByBodyType);

            Assert.DoesNotContain(publications, p => p.Kind == ScanChannelKind.Anomalies);
        }

        [Fact]
        public void UnchangedCoverageOnARevisit_DoesNotRepublishAnomalies()
        {
            var coverage = new short[NativeCoverageWidth, NativeCoverageHeight];
            coverage[0, 0] = 1;

            var lastHashByBody = new Dictionary<string, ulong>();
            var lastPackedByBodyType = new Dictionary<string, byte[]>();

            var anomalies = ScanAnomalies.Build(new List<ScanAnomalies.AnomalyInput>
            {
                new ScanAnomalies.AnomalyInput("KSC Monolith", 285.3, -0.05, known: true, detail: true),
            });

            var first = BuildCapture(coverage, includeHeightBiome: true);
            first.Anomalies = anomalies;
            ScanPublications.Compute(first, lastHashByBody, lastPackedByBodyType);

            // Revisit: same coverage grid → bodyChanged is false, so nothing
            // republishes, anomalies included, even though Anomalies is set.
            var second = BuildCapture(coverage, includeHeightBiome: false);
            second.Anomalies = anomalies;
            var publications = ScanPublications.Compute(second, lastHashByBody, lastPackedByBodyType);

            Assert.Empty(publications);
        }

        [Fact]
        public void MaskPayloadWidthHeightReflectTheActualCoverageArraySizeNotScanGridsConstants()
        {
            // 10x5 coverage - deliberately NOT ScanGrids.Width/Height, to prove
            // the mask payload's declared dims come from the coverage array
            // itself (SCANsat's own native grid size), independent of whatever
            // ScanGrids.Width/Height the height/biome grid happens to use.
            var coverage = new short[10, 5];
            coverage[0, 0] = 1;

            var capture = new ScanCapture
            {
                Ut = 1.0,
                BodyName = "Kerbin",
                Coverage = coverage,
                CoveragePercents = new Dictionary<short, double> { [1] = 5.0, [2] = 0.0, [8] = 0.0, [16] = 0.0, [128] = 0.0, [256] = 0.0 },
                IncludeHeightBiome = false,
            };

            var publications = ScanPublications.Compute(capture, new Dictionary<string, ulong>(), new Dictionary<string, byte[]>());

            var maskPub = Assert.Single(publications, p => p.Kind == ScanChannelKind.Mask && p.SubTopic == "Kerbin.1");
            var payload = Assert.IsType<Dictionary<string, object?>>(maskPub.Payload);
            Assert.Equal(10, payload["width"]);
            Assert.Equal(5, payload["height"]);
        }
    }
}
