using Gonogo.DevTools;
using Xunit;

namespace Gonogo.KSP.Tests.DevTools
{
    /// <summary>
    /// A teleport that names a height above terrain is placed again, once, with
    /// the orbit moved by exactly the difference, up or down; one that already
    /// stands within the tolerance is left where the orbit put it.
    /// </summary>
    public sealed class TeleportHeightTests
    {
        [Fact]
        public void ACraftBelowTheRequestedHeightIsRaisedByTheShortfall()
        {
            var again = TeleportHeight.Correction(-599.9, 0.1, altitudeM: 100.0, terrainM: 130.0, requestedAboveTerrainM: 8.0);

            Assert.NotNull(again);
            Assert.Equal(-599.862, again!.Value.PeriapsisKm, 6);
            Assert.Equal(0.138, again.Value.ApoapsisKm, 6);
        }

        [Fact]
        public void ACraftAlreadyAtTheRequestedHeightIsNotPlacedAgain()
        {
            Assert.Null(TeleportHeight.Correction(-599.9, 0.1, altitudeM: 138.0, terrainM: 130.0, requestedAboveTerrainM: 8.0));
        }

        [Fact]
        public void AShortfallWithinTheToleranceIsNotPlacedAgain()
        {
            Assert.Null(TeleportHeight.Correction(-599.9, 0.1, altitudeM: 137.6, terrainM: 130.0, requestedAboveTerrainM: 8.0));
        }

        [Fact]
        public void ACraftHigherThanRequestedIsLoweredByTheExcess()
        {
            var again = TeleportHeight.Correction(-599.9, 0.1, altitudeM: 400.0, terrainM: 130.0, requestedAboveTerrainM: 8.0);

            Assert.NotNull(again);
            Assert.Equal(-600.162, again!.Value.PeriapsisKm, 6);
            Assert.Equal(-0.162, again.Value.ApoapsisKm, 6);
        }
    }
}
