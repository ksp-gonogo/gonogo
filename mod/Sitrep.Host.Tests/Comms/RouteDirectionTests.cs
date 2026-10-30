using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>A route carries a direction only when every hop of it does.</summary>
    public class RouteDirectionTests
    {
        private static CommsRouteHop Hop(CommsDirection carries) => new CommsRouteHop(1.0, false, null, null, carries);

        [Fact]
        public void ARouteNotFoundCarriesNeitherWay()
        {
            Assert.Equal(CommsDirection.None, RouteDirection.Of(null));
        }

        [Fact]
        public void ARouteWithNoHopToJudgeCarriesBothWays()
        {
            Assert.Equal(CommsDirection.Both, RouteDirection.Of(new List<CommsRouteHop>()));
        }

        [Fact]
        public void ARouteCarriesOnlyWhatEveryHopCarries()
        {
            var hops = new[] { Hop(CommsDirection.Both), Hop(CommsDirection.Forward), Hop(CommsDirection.Both) };

            Assert.Equal(CommsDirection.Forward, RouteDirection.Of(hops));
        }

        [Fact]
        public void TwoHopsThatCarryOppositeWaysCarryNeither()
        {
            var hops = new[] { Hop(CommsDirection.Forward), Hop(CommsDirection.Reverse) };

            Assert.Equal(CommsDirection.None, RouteDirection.Of(hops));
        }

        [Fact]
        public void AHopWithAnUnreadRateDoesNotMakeTheRouteCarryThatWay()
        {
            var hops = new[] { Hop(CommsDirection.Both), new CommsRouteHop(1.0, false, null, null, CommsDirection.Both, CommsDirection.Forward) };

            Assert.Equal(CommsDirection.Reverse, RouteDirection.Of(hops));
            Assert.Equal(CommsDirection.Forward, RouteDirection.Unknown(hops));
        }

        [Fact]
        public void ABrokenHopMakesTheRouteBrokenNotUnknownWhateverElseIsUnread()
        {
            var hops = new[] { Hop(CommsDirection.Reverse), new CommsRouteHop(1.0, false, null, null, CommsDirection.None, CommsDirection.Both) };

            Assert.Equal(CommsDirection.None, RouteDirection.Of(hops));
            Assert.Equal(CommsDirection.Reverse, RouteDirection.Unknown(hops));
        }

        [Fact]
        public void ARouteNotFoundIsBrokenNotUnknown()
        {
            Assert.Equal(CommsDirection.None, RouteDirection.Unknown(null));
        }

        [Theory]
        [InlineData(CommsDirection.Forward, CommsDirection.Reverse)]
        [InlineData(CommsDirection.Reverse, CommsDirection.Forward)]
        [InlineData(CommsDirection.Both, CommsDirection.Both)]
        [InlineData(CommsDirection.None, CommsDirection.None)]
        public void ReadingARouteFromItsOtherEndSwapsTheWays(CommsDirection carried, CommsDirection flipped)
        {
            Assert.Equal(flipped, RouteDirection.Flip(carried));
        }
    }
}
