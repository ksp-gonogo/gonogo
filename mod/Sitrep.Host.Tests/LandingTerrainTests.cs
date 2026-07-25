using System.Collections.Generic;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for the pure terrain plane-fit (<see cref="LandingTerrain"/>):
    /// slope, downhill heading, and residual roughness from sampled heights.
    /// </summary>
    public class LandingTerrainTests
    {
        /// <summary>A 3x3 grid at +/- 5 m, heights from h(east, north).</summary>
        private static List<LandingTerrain.Sample> Grid(System.Func<double, double, double> h)
        {
            var samples = new List<LandingTerrain.Sample>();
            foreach (var e in new[] { -5.0, 0.0, 5.0 })
                foreach (var n in new[] { -5.0, 0.0, 5.0 })
                    samples.Add(new LandingTerrain.Sample(e, n, h(e, n)));
            return samples;
        }

        [Fact]
        public void FlatTerrainIsZeroSlopeZeroRoughnessNoHeading()
        {
            var fit = LandingTerrain.FitPlane(Grid((_, _) => 100.0));
            Assert.NotNull(fit);
            Assert.Equal(0.0, fit!.Value.SlopeDeg, 6);
            Assert.Equal(0.0, fit.Value.Roughness, 6);
            Assert.Null(fit.Value.HeadingDeg); // below the noise floor
        }

        [Fact]
        public void UniformInclineRisingNorthFallsSouth()
        {
            // h rises 0.5 m per m north => slope atan(0.5) = 26.565 deg, downhill
            // = south (180 deg), a perfect plane so zero residual roughness.
            var fit = LandingTerrain.FitPlane(Grid((_, n) => 100.0 + 0.5 * n));
            Assert.NotNull(fit);
            Assert.Equal(26.57, fit!.Value.SlopeDeg, 2);
            Assert.NotNull(fit.Value.HeadingDeg);
            Assert.Equal(180.0, fit.Value.HeadingDeg!.Value, 2);
            Assert.Equal(0.0, fit.Value.Roughness, 6);
        }

        [Fact]
        public void UniformInclineRisingEastFallsWest()
        {
            var fit = LandingTerrain.FitPlane(Grid((e, _) => 100.0 + 0.5 * e));
            Assert.NotNull(fit);
            Assert.Equal(26.57, fit!.Value.SlopeDeg, 2);
            Assert.Equal(270.0, fit.Value.HeadingDeg!.Value, 2); // downhill = west
        }

        [Fact]
        public void RoughnessIsResidualAfterRemovingTheSlopePlane()
        {
            // A tilted plane plus a single 3 m bump: slope is still ~the tilt,
            // and the roughness captures the bump, not the tilt.
            var samples = Grid((_, n) => 100.0 + 0.5 * n);
            samples[0] = new LandingTerrain.Sample(
                samples[0].East, samples[0].North, samples[0].Height + 3.0);
            var fit = LandingTerrain.FitPlane(samples);
            Assert.NotNull(fit);
            // Tilt dominates the slope; the bump barely moves it.
            Assert.True(fit!.Value.SlopeDeg > 20 && fit.Value.SlopeDeg < 33);
            // Residual roughness is well above zero because of the bump.
            Assert.True(fit.Value.Roughness > 0.5);
        }

        [Fact]
        public void ReturnsNullBelowThreeSamples()
        {
            Assert.Null(
                LandingTerrain.FitPlane(
                    new List<LandingTerrain.Sample>
                    {
                        new(0, 0, 1),
                        new(1, 0, 1),
                    }));
        }
    }
}
