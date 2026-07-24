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
