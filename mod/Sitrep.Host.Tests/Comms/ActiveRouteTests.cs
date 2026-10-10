using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class ActiveRouteTests
    {
        private static readonly object A = new object();
        private static readonly object B = new object();

        private static (string, bool)? Name(CommsNodeHandle? handle) =>
            handle == null ? null : ReferenceEquals(handle.As<object>(), A) ? ("a", false) : ("b", true);

        [Fact]
        public void ARouteBecomesHopsThatNameTheirEndsAndKeepTheirLengths()
        {
            var route = new List<CommsRouteHop>
            {
                new CommsRouteHop(5.0, true, CommsNodeHandle.Of(A), CommsNodeHandle.Of(B)),
            };

            var hops = ActiveRoute.Hops(route, Name)!;

            var hop = Assert.Single(hops);
            Assert.Equal("a", hop.From);
            Assert.Equal("b", hop.To);
            Assert.False(hop.FromIsHome);
            Assert.True(hop.ToIsHome);
            Assert.Equal(CommsHopKind.Home, hop.Kind);
            Assert.Equal(5.0, hop.DistanceMeters);
        }

        [Fact]
        public void ARouteSolvedFromTheCentreReadsFromTheCraftWhenReversed()
        {
            var solved = new List<CommsHop>
            {
                new CommsHop { From = "Crater Rim Station", To = "relay", FromIsHome = true, Kind = CommsHopKind.Home, DistanceMeters = 9.0 },
                new CommsHop { From = "relay", To = "craft", Kind = CommsHopKind.Relay, DistanceMeters = 20.0 },
            };

            var shown = ActiveRoute.Reversed(solved);

            Assert.Equal(new[] { ("craft", "relay"), ("relay", "Crater Rim Station") }, shown.Select(h => (h.From, h.To)).ToArray());
            Assert.True(shown[1].ToIsHome);
            Assert.False(shown[1].FromIsHome);
            Assert.Equal(new double?[] { 20.0, 9.0 }, shown.Select(h => h.DistanceMeters).ToArray());
        }

        [Fact]
        public void NoRouteAnEmptyRouteOrAnUnnameableEndIsNoHopsAtAll()
        {
            Assert.Null(ActiveRoute.Hops(null, Name));
            Assert.Null(ActiveRoute.Hops(new List<CommsRouteHop>(), Name));
            Assert.Null(ActiveRoute.Hops(new List<CommsRouteHop> { new CommsRouteHop(5.0, false) }, Name));
        }
    }
}
