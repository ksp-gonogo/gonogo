using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// What has reached a lens from its commanding centre is a running maximum:
    /// it follows a shortening path forward, holds through a lengthening one,
    /// holds from the first tick that sees a path and after a lost one returns
    /// until one delay has passed, and for sites sharing a scope is aged by the
    /// longest delay among them. Each case below first opens its path at UT 0,
    /// so the path is known to have stood by the time it asserts.
    /// </summary>
    public class UplinkFrontierTests
    {
        [Fact]
        public void NothingIsDeliveredUntilOneDelayAfterThePathIsFirstSeen()
        {
            var frontier = new UplinkFrontier();
            frontier.Advance(100.0, 5.0);
            Assert.False(frontier.HasDelivered);

            frontier.Advance(104.0, 5.0);
            Assert.False(frontier.HasDelivered);

            frontier.Advance(105.0, 5.0);
            Assert.Equal(100.0, frontier.DeliveredUt);
        }

        [Fact]
        public void ItFollowsThePathForwardWhileItHolds()
        {
            var frontier = new UplinkFrontier();
            frontier.Advance(0.0, 5.0);
            Assert.False(frontier.HasDelivered);

            frontier.Advance(100.0, 5.0);
            Assert.Equal(95.0, frontier.DeliveredUt);

            frontier.Advance(110.0, 5.0);
            Assert.Equal(105.0, frontier.DeliveredUt);
        }

        [Fact]
        public void APathThatLengthensNeverUnlearns()
        {
            var frontier = new UplinkFrontier();
            frontier.Advance(0.0, 5.0);
            frontier.Advance(100.0, 5.0);

            frontier.Advance(110.0, 60.0);
            Assert.Equal(95.0, frontier.DeliveredUt);

            frontier.Advance(120.0, 60.0);
            Assert.Equal(95.0, frontier.DeliveredUt);

            frontier.Advance(170.0, 60.0);
            Assert.Equal(110.0, frontier.DeliveredUt);
        }

        [Fact]
        public void ALostPathFreezesAndNeverFallsBackToTheLastDelay()
        {
            var frontier = new UplinkFrontier();
            frontier.Advance(0.0, 5.0);
            frontier.Advance(100.0, 5.0);

            frontier.Advance(200.0, null);
            frontier.Advance(300.0, double.PositiveInfinity);
            Assert.Equal(95.0, frontier.DeliveredUt);
        }

        [Fact]
        public void ARestoredPathDeliversNothingSentDuringTheOutage()
        {
            var frontier = new UplinkFrontier();
            frontier.Advance(0.0, 5.0);
            frontier.Advance(100.0, 5.0);
            frontier.Advance(200.0, null);

            frontier.Advance(300.0, 8.0);
            Assert.Equal(95.0, frontier.DeliveredUt);

            frontier.Advance(307.0, 8.0);
            Assert.Equal(95.0, frontier.DeliveredUt);

            frontier.Advance(308.0, 8.0);
            Assert.Equal(300.0, frontier.DeliveredUt);

            frontier.Advance(320.0, 8.0);
            Assert.Equal(312.0, frontier.DeliveredUt);
        }

        [Fact]
        public void SitesSharingAScopeAreAgedByTheLongestDelay()
        {
            var scope = new UplinkScopeFrontier();
            scope.Join("near");
            scope.Join("far");
            scope.Advance("near", 0.0, 5.0);
            scope.Advance("far", 0.0, 30.0);
            scope.Advance("near", 100.0, 5.0);
            Assert.False(scope.HasDelivered);

            scope.Advance("far", 100.0, 30.0);
            Assert.Equal(70.0, scope.DeliveredUt);
        }

        [Fact]
        public void AScopeHoldsStillWhileAnyOfItsSitesHasNoPath()
        {
            var scope = new UplinkScopeFrontier();
            scope.Join("near");
            scope.Join("far");
            scope.Advance("near", 0.0, 5.0);
            scope.Advance("far", 0.0, 30.0);
            scope.Advance("near", 100.0, 5.0);
            scope.Advance("far", 100.0, 30.0);

            scope.Advance("near", 200.0, 5.0);
            scope.Advance("far", 200.0, null);
            Assert.Equal(70.0, scope.DeliveredUt);
        }

        [Fact]
        public void ASiteJoiningAScopeNeverTakesBackWhatItHolds()
        {
            var scope = new UplinkScopeFrontier();
            scope.Join("near");
            scope.Join("far");
            scope.Advance("near", 0.0, 5.0);
            scope.Advance("far", 0.0, 30.0);
            scope.Advance("near", 100.0, 5.0);
            scope.Advance("far", 100.0, 30.0);

            scope.Join("late");
            scope.Advance("late", 110.0, null);
            Assert.Equal(70.0, scope.DeliveredUt);
        }
    }
}
