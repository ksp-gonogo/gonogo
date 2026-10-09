using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for the pure predicted-touchdown search
    /// (<see cref="LandingPredictor.FindImpact"/>). The KSP-frame sampler is
    /// injected, so a synthetic descending sampler exercises the walk.
    /// </summary>
    public class LandingPredictorTests
    {
        [Fact]
        public void ReturnsTheLastAboveSurfacePointBeforeImpact()
        {
            // Altitude falls 100 m per second from 1000 m; lat/lon drift so we
            // can identify the last above-surface step. Impact (< -100) is at
            // t = 11 s; the last above-surface step is t = 10 s (alt 0).
            var hit = LandingPredictor.FindImpact(
                ut => new LandingPredictor.GeoPoint(
                    0.5 * ut, // lat drifts
                    2.0 * ut, // lon drifts
                    1000.0 - 100.0 * ut),
                nowUt: 0,
                horizonSec: 30,
                stepSec: 1);

            Assert.NotNull(hit);
            // Last above-surface step is ut=10 (alt 0 >= -100); ut=11 is -100 (not < -100); ut=12 = -200 < -100 => returns ut=11.
            Assert.Equal(0.5 * 11, hit!.Value.lat, 6);
            Assert.Equal(2.0 * 11, hit.Value.lon, 6);
        }

        [Fact]
        public void TheSiteDoesNotDependOnWhereTheSearchGridStarts()
        {
            // The same trajectory searched from successive frame times: the
            // search grid shifts with nowUt, and the crossing it reports must not.
            var lons = new System.Collections.Generic.List<double>();
            for (double now = 0; now < 5.0; now += 0.7)
            {
                var hit = LandingPredictor.FindImpact(
                    ut => new LandingPredictor.GeoPoint(0.5 * ut, 2.0 * ut, 1000.0 - 100.0 * ut),
                    nowUt: now,
                    horizonSec: 30,
                    stepSec: 5);
                Assert.NotNull(hit);
                lons.Add(hit!.Value.lon);
            }

            Assert.True(
                System.Linq.Enumerable.Max(lons) - System.Linq.Enumerable.Min(lons) < 1e-3,
                "the reported crossing moved with the grid: " + string.Join(", ", lons));
        }

        [Fact]
        public void TheSampleCountStaysBounded()
        {
            var calls = 0;
            LandingPredictor.FindImpact(
                ut =>
                {
                    calls++;
                    return new LandingPredictor.GeoPoint(0, 0, 1000.0 - 100.0 * ut);
                },
                nowUt: 0,
                horizonSec: 1200,
                stepSec: 5);

            Assert.True(calls <= 240 + LandingPredictor.RefinementSteps + 1, "samples: " + calls);
        }

        [Fact]
        public void MeetsAPlateauBeforeSeaLevel()
        {
            // Altitude falls 100 m per second from 6000 m while the ground ahead
            // is a 4000 m plateau: the craft meets it at t = 20 s, 40 s before the
            // sea-level crossing the search used to report.
            var hit = LandingPredictor.FindImpact(
                ut => new LandingPredictor.GeoPoint(0.5 * ut, 2.0 * ut, 6000.0 - 100.0 * ut),
                nowUt: 0.3,
                horizonSec: 120,
                stepSec: 5,
                terrainAt: (lat, lon) => 4000.0,
                terrainCeilingMeters: 5000.0);

            Assert.NotNull(hit);
            Assert.Equal(2.0 * 20, hit!.Value.lon, 2);
        }

        [Fact]
        public void IgnoresTerrainAboveTheCeilingWithoutReadingIt()
        {
            var reads = 0;
            LandingPredictor.FindImpact(
                ut => new LandingPredictor.GeoPoint(0, 0, 9000.0 - 100.0 * ut),
                nowUt: 0,
                horizonSec: 200,
                stepSec: 5,
                terrainAt: (lat, lon) =>
                {
                    reads++;
                    return 0.0;
                },
                terrainCeilingMeters: 5000.0);

            // 5000 m is reached at t = 40 s, the sea-level crossing at ~91 s: the 40 s of walk above the ceiling reads nothing.
            Assert.True(reads <= LandingPredictor.MaxTerrainReads, "reads: " + reads);
            Assert.True(reads >= 1);
        }

        [Fact]
        public void TerrainReadsStayWithinTheAllowanceOverALongLowWalk()
        {
            var reads = 0;
            LandingPredictor.FindImpact(
                ut => new LandingPredictor.GeoPoint(0, 0, 1000.0),
                nowUt: 0,
                horizonSec: 1200,
                stepSec: 5,
                terrainAt: (lat, lon) =>
                {
                    reads++;
                    return 0.0;
                },
                terrainCeilingMeters: 5000.0);

            Assert.True(reads <= LandingPredictor.MaxTerrainReads, "reads: " + reads);
        }

        [Fact]
        public void ReturnsNullWhenStillAirborneAcrossTheHorizon()
        {
            // A shallow descent that never reaches the surface within the horizon.
            var hit = LandingPredictor.FindImpact(
                ut => new LandingPredictor.GeoPoint(0, 0, 5000.0 - 1.0 * ut),
                nowUt: 0,
                horizonSec: 100,
                stepSec: 5);
            Assert.Null(hit);
        }

        [Fact]
        public void ReturnsNullOnDegenerateParameters()
        {
            Assert.Null(
                LandingPredictor.FindImpact(
                    _ => new LandingPredictor.GeoPoint(0, 0, -500), 0, 0, 1));
            Assert.Null(
                LandingPredictor.FindImpact(
                    _ => new LandingPredictor.GeoPoint(0, 0, -500), 0, 30, 0));
        }
    }
}
