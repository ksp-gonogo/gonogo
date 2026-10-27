using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// What has reached a lens from its commanding centre is a running maximum:
    /// it follows a shortening path forward, holds through a lengthening one,
    /// freezes while there is no path and until one delay after it returns, and
    /// for sites sharing a scope is aged by the longest delay among them.
    /// </summary>
    public class UplinkFrontierTests
    {
        [Fact]
        public void ItFollowsThePathForwardWhileItHolds()
        {
            var frontier = new UplinkFrontier();
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
            frontier.Advance(100.0, 5.0);

            frontier.Advance(200.0, null);
            frontier.Advance(300.0, double.PositiveInfinity);
            Assert.Equal(95.0, frontier.DeliveredUt);
        }

        [Fact]
        public void ARestoredPathDeliversNothingSentDuringTheOutage()
        {
            var frontier = new UplinkFrontier();
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
            scope.Advance("near", 100.0, 5.0);
            scope.Advance("far", 100.0, 30.0);

            scope.Join("late");
            scope.Advance("late", 110.0, null);
            Assert.Equal(70.0, scope.DeliveredUt);
        }
    }
}
