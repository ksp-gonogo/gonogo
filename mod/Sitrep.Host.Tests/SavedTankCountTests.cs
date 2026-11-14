using Xunit;

namespace Sitrep.Host.Tests
{
    public class SavedTankCountTests
    {
        [Fact]
        public void AnOpenTankThatCanGiveItsResourceUpCounts() =>
            Assert.True(SavedTankCount.Counts(flowsBetweenParts: true, flowsOut: true, flowEnabled: true));

        [Fact]
        public void ALockedTankDoesNotCount() =>
            Assert.False(SavedTankCount.Counts(flowsBetweenParts: true, flowsOut: true, flowEnabled: false));

        [Fact]
        public void ATankThatOnlyTakesTheResourceInDoesNotCount() =>
            Assert.False(SavedTankCount.Counts(flowsBetweenParts: true, flowsOut: false, flowEnabled: true));

        [Fact]
        public void AResourceThatNeverFlowsCountsInEveryPartLockedOrNot() =>
            Assert.True(SavedTankCount.Counts(flowsBetweenParts: false, flowsOut: false, flowEnabled: false));
    }
}
