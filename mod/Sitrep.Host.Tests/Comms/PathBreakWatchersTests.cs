using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// Many craft's routes watched at once, each against its own history, and a
    /// break placed on exactly the nodes of the craft it happened to.
    /// </summary>
    public class PathBreakWatchersTests
    {
        private const double C = SignalDelay.SpeedOfLightMetersPerSecond;

        /// <summary>A route of hops each one light-second long, from <paramref name="origin"/>.</summary>
        private static CommsPath Route(string origin, params string[] toNodeIds)
        {
            var hops = new List<CommsHop>();
            var from = origin;
            foreach (var to in toNodeIds)
            {
                hops.Add(new CommsHop { From = from, To = to, DistanceMeters = C });
                from = to;
            }
            return new CommsPath { Hops = hops };
        }

        private static System.Func<string, bool?> Dead(params string[] gone)
        {
            var set = new HashSet<string>(gone);
            return id => !set.Contains(id);
        }

        private static PathBreakWatchers.Subject Craft(
            string key, CommsPath path, System.Func<string, bool?> stillCarries, params string[] nodes) =>
            new PathBreakWatchers.Subject(key, nodes, path, stillCarries);

        /// <summary>
        /// Two craft each lose a different relay's worth of route, and only one
        /// of those relays actually died. The break lands on that craft's node
        /// and nowhere else.
        /// </summary>
        [Fact]
        public void ABreakLandsOnTheCraftWhoseRelayDiedAndNoOther()
        {
            var watchers = new PathBreakWatchers();
            watchers.Observe(new[]
            {
                Craft("far", Route("far", "relay-a", "relay-b", "home"), Dead(), "fleet.far"),
                Craft("near", Route("near", "relay-c", "home"), Dead(), "fleet.near"),
            }, 1.0, 10.0);

            var found = watchers.Observe(new[]
            {
                Craft("far", Route("far", "relay-d", "home"), Dead("relay-b"), "fleet.far"),
                Craft("near", Route("near", "relay-e", "home"), Dead(), "fleet.near"),
            }, 1.0, 11.0);

            var only = Assert.Single(found!);
            Assert.Equal("fleet.far", only.Node);
            Assert.Equal(2.0, only.LightSecondsOut, 9);
        }

        /// <summary>
        /// The craft on screen speaks through two nodes over one route, so one
        /// break is placed on both.
        /// </summary>
        [Fact]
        public void ABreakIsPlacedOnEveryNodeTheCraftSpeaksThrough()
        {
            var watchers = new PathBreakWatchers();
            watchers.Observe(new[] { Craft("ship", Route("ship", "relay-a", "home"), Dead(), "system", "fleet.ship") }, 1.0, 10.0);

            var found = watchers.Observe(new[] { Craft("ship", Route("ship", "relay-b", "home"), Dead("relay-a"), "system", "fleet.ship") }, 1.0, 11.0);

            Assert.Equal(new[] { "system", "fleet.ship" }, found!.Select(b => b.Node).ToArray());
        }

        /// <summary>
        /// A craft that becomes the one on screen keeps its route history: its
        /// relay dying on the very next tick is still seen, and placed on the
        /// nodes it speaks through now.
        /// </summary>
        [Fact]
        public void ACraftKeepsItsRouteHistoryWhenItBecomesTheOneOnScreen()
        {
            var watchers = new PathBreakWatchers();
            watchers.Observe(new[] { Craft("ship", Route("ship", "relay-a", "home"), Dead(), "fleet.ship") }, 1.0, 10.0);

            var found = watchers.Observe(new[] { Craft("ship", Route("ship", "relay-b", "home"), Dead("relay-a"), "system", "fleet.ship") }, 1.0, 11.0);

            Assert.Equal(new[] { "system", "fleet.ship" }, found!.Select(b => b.Node).ToArray());
        }

        /// <summary>
        /// A craft missing from one observation is forgotten, so when it comes
        /// back its new route is compared against nothing: a comparison across
        /// the gap would read every changed hop as a break.
        /// </summary>
        [Fact]
        public void ACraftThatDropsOutIsForgottenAndRaisesNothingOnReturn()
        {
            var watchers = new PathBreakWatchers();
            watchers.Observe(new[] { Craft("far", Route("far", "relay-a", "home"), Dead(), "fleet.far") }, 1.0, 10.0);
            watchers.Observe(new PathBreakWatchers.Subject[0], 1.0, 11.0);

            var found = watchers.Observe(new[] { Craft("far", Route("far", "relay-b", "home"), Dead("relay-a"), "fleet.far") }, 1.0, 12.0);

            Assert.Null(found);
        }

        /// <summary>A quiet tick for every craft is no breaks at all, not an empty set to iterate.</summary>
        [Fact]
        public void NoBreakAnywhereIsNull()
        {
            var watchers = new PathBreakWatchers();
            watchers.Observe(new[] { Craft("far", Route("far", "relay-a", "home"), Dead(), "fleet.far") }, 1.0, 10.0);

            Assert.Null(watchers.Observe(new[] { Craft("far", Route("far", "relay-a", "home"), Dead(), "fleet.far") }, 1.0, 11.0));
        }
    }
}
