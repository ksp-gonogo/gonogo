using Xunit;

namespace Sitrep.Host.Tests
{
    public class PausedStageWatchTests
    {
        private const string Craft = "vessel:a";

        [Fact]
        public void AsksOnceWhenTheStageChangesWhilePaused()
        {
            var watch = new PausedStageWatch();
            Assert.False(watch.ShouldRecalculate(Craft, 8, paused: true));
            Assert.True(watch.ShouldRecalculate(Craft, 6, paused: true));
            Assert.False(watch.ShouldRecalculate(Craft, 6, paused: true));
        }

        [Fact]
        public void NeverAsksWhileTimeRuns()
        {
            var watch = new PausedStageWatch();
            watch.ShouldRecalculate(Craft, 8, paused: false);
            Assert.False(watch.ShouldRecalculate(Craft, 6, paused: false));
        }

        [Fact]
        public void ATransitionMadeWhileRunningIsNotAskedForAfterThePause()
        {
            var watch = new PausedStageWatch();
            watch.ShouldRecalculate(Craft, 8, paused: false);
            watch.ShouldRecalculate(Craft, 6, paused: false);
            Assert.False(watch.ShouldRecalculate(Craft, 6, paused: true));
        }

        [Fact]
        public void AnotherVesselIsAFirstSightNotAChange()
        {
            var watch = new PausedStageWatch();
            watch.ShouldRecalculate(Craft, 8, paused: true);
            Assert.False(watch.ShouldRecalculate("vessel:b", 2, paused: true));
        }
    }
}
