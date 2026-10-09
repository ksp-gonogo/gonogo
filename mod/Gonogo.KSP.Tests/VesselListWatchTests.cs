using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// Entering the editor by reverting a flight: the list is empty for a while
    /// whatever the game's own state says, and an empty list there is unknown.
    /// </summary>
    public class VesselListWatchTests
    {
        private static bool Stands(VesselListWatch watch, string scene, int listed, int? inGameState, double now) =>
            watch.Stands(scene, scene == "FLIGHT", scene == "FLIGHT", listed, inGameState, now);

        [Fact]
        public void AnEmptyListJustAfterLeavingFlightDoesNotStandEvenWhenTheGameStateIsEmptyToo()
        {
            var watch = new VesselListWatch();
            Assert.True(Stands(watch, "FLIGHT", 5, 5, 0));
            Assert.False(Stands(watch, "EDITOR", 0, 0, 1));
            Assert.True(watch.Settling);
        }

        [Fact]
        public void TheListStandsOnceItIsFilled()
        {
            var watch = new VesselListWatch();
            Stands(watch, "FLIGHT", 5, 5, 0);
            Assert.False(Stands(watch, "EDITOR", 0, 0, 1));
            Assert.True(Stands(watch, "EDITOR", 5, 5, 2));
            Assert.False(watch.Settling);
        }

        [Fact]
        public void AnEmptyListThatStaysEmptyStandsAfterTheGracePeriod()
        {
            var watch = new VesselListWatch();
            Stands(watch, "FLIGHT", 1, 1, 0);
            Assert.False(Stands(watch, "EDITOR", 0, 0, 1));
            Assert.True(Stands(watch, "EDITOR", 0, 0, 1 + VesselListWatch.GraceSeconds));
        }

        [Fact]
        public void ASceneWithNoPriorListIsNotHeldBack()
        {
            var watch = new VesselListWatch();
            Assert.True(Stands(watch, "SPACECENTER", 0, 0, 0));
        }
    }
}
