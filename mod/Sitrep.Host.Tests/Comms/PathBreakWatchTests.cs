using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// The producer of the DROP EVENT: what turns a route change into a
    /// statement the delay ledger can act on.
    ///
    /// <para>The case that matters most here is the one that must NOT fire. A
    /// reroute and a destruction are the same diff over
    /// <see cref="CommsPath"/>, and treating every departed hop as a break would
    /// delete the in-flight tail on every ordinary route change, which is the
    /// behaviour <c>MiddlemanRerouteTests</c> exists to forbid.</para>
    /// </summary>
    public class PathBreakWatchTests
    {
        private const double C = SignalDelay.SpeedOfLightMetersPerSecond;

        /// <summary>A route of hops each one light-second long, ending at "home".</summary>
        private static CommsPath Route(params string[] toNodeIds)
        {
            var hops = new List<CommsHop>();
            var from = "craft";
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

        /// <summary>
        /// A relay two light-seconds out is destroyed and the craft reroutes.
        /// The break is raised at the position that relay occupied, which is the
        /// quantity <see cref="SignalDelay"/> sums away and nothing else in the
        /// stack carries.
        /// </summary>
        [Fact]
        public void RaisesABreakAtTheDestroyedRelaysOwnPosition()
        {
            var watch = new PathBreakWatch();
            Assert.Null(watch.Observe(Route("relay-a", "relay-b", "home"), 1.0, 10.0, Dead()));

            var found = watch.Observe(Route("relay-c", "home"), 1.0, 11.0, Dead("relay-b"));

            Assert.NotNull(found);
            Assert.Equal(11.0, found!.Value.AtUt);
            Assert.Equal(2.0, found.Value.LightSecondsOut, 9);
        }

        /// <summary>
        /// THE CASE THAT MUST NOT FIRE. The same route change, but every relay
        /// that left is still alive and still carrying: KSP re-solves the
        /// cheapest path every tick, and a relay coming over the horizon changes
        /// the route without anything dying. The tail crossing the old route
        /// arrives, so there is no break.
        /// </summary>
        [Fact]
        public void AnOrdinaryRerouteOffLiveRelaysIsNotABreak()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Route("relay-a", "relay-b", "home"), 1.0, 10.0, Dead());

            Assert.Null(watch.Observe(Route("relay-c", "home"), 1.0, 11.0, Dead()));
        }

        /// <summary>
        /// A backend with no opinion is not evidence. <c>null</c> from
        /// <see cref="ICommsBackend.StillCarriesTo"/> has to behave exactly like
        /// "still carrying", because a wrongly-declared break deletes telemetry
        /// that physically arrived.
        /// </summary>
        [Fact]
        public void ABackendThatCannotSayRaisesNothing()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Route("relay-a", "relay-b", "home"), 1.0, 10.0, Dead());

            Assert.Null(watch.Observe(Route("relay-c", "home"), 1.0, 11.0, _ => null));
        }

        /// <summary>
        /// Losing the route home entirely is the destroyed-vessel case, and it
        /// is an ordinary break rather than a special one: the hops are gone,
        /// they are asked whether they still carry, and the answer partitions
        /// the tail exactly as a reroute onto nothing.
        /// </summary>
        [Fact]
        public void LosingTheRouteHomeEntirelyRaisesTheBreak()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Route("relay-a", "relay-b", "home"), 1.0, 10.0, Dead());

            var found = watch.Observe(
                new CommsPath(), 1.0, 11.0, Dead("relay-a", "relay-b", "home"));

            Assert.NotNull(found);
            Assert.Equal(3.0, found!.Value.LightSecondsOut, 9);
        }

        /// <summary>
        /// When several hops stop carrying at once, the DEEPEST is the break.
        /// Light reaching the far one had to cross the near one first, so a
        /// sample survives exactly when it is past the furthest of them, and one
        /// drop at that position is the whole partition.
        /// </summary>
        [Fact]
        public void TheDeepestOfSeveralSimultaneousBreaksIsTheOneRaised()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Route("relay-a", "relay-b", "relay-c", "home"), 1.0, 10.0, Dead());

            var found = watch.Observe(
                new CommsPath(), 1.0, 11.0, Dead("relay-a", "relay-c"));

            Assert.NotNull(found);
            Assert.Equal(3.0, found!.Value.LightSecondsOut, 9);
        }

        /// <summary>
        /// The break's position is a light-time, so it carries the same
        /// light-speed scale the delay does. A route measured against one scale
        /// and a break against another would partition the tail at a point the
        /// samples were never timed to.
        /// </summary>
        [Fact]
        public void ThePositionCarriesTheLightSpeedScale()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Route("relay-a", "relay-b", "home"), 2.0, 10.0, Dead());

            var found = watch.Observe(new CommsPath(), 2.0, 11.0, Dead("relay-b"));

            Assert.NotNull(found);
            Assert.Equal(1.0, found!.Value.LightSecondsOut, 9);
        }

        /// <summary>
        /// Incomplete geometry raises nothing, matching
        /// <see cref="SignalDelay.Compute"/>'s refusal to total a route with a
        /// hop that has no distance. A position derived from a total nothing
        /// will compute is a fiction.
        /// </summary>
        [Fact]
        public void IncompleteHopGeometryRaisesNothing()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Route("relay-a", "relay-b", "home"), 1.0, 10.0, Dead());

            var blind = new CommsPath
            {
                Hops = new List<CommsHop>
                {
                    new CommsHop { From = "craft", To = "relay-c", DistanceMeters = null },
                },
            };
            Assert.Null(watch.Observe(blind, 1.0, 11.0, Dead("relay-b")));

            // And the retained route is forgotten with it, so the next
            // observation compares against nothing rather than against geometry
            // separated from it by an unmeasured gap.
            Assert.Null(watch.Observe(new CommsPath(), 1.0, 12.0, Dead("relay-b")));
        }

        /// <summary>
        /// THE WARP DOMAIN. A tick that advanced UT by more than the whole
        /// route's light-time raises nothing: the death instant, the ledger
        /// write and every delivery share that one quantum, so there is no
        /// ordering between sent, crossed and broke left to read. Deliver,
        /// because we do not know it did not cross.
        /// </summary>
        [Fact]
        public void ATickLongerThanTheWholeLightTimeRaisesNothing()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Route("relay-a", "relay-b", "home"), 1.0, 10.0, Dead());

            // Three light-seconds of route, four seconds of UT in one tick.
            Assert.Null(watch.Observe(new CommsPath(), 1.0, 14.0, Dead("relay-b")));
        }

        /// <summary>
        /// The same break is raised ONCE. A craft that stays dark for a thousand
        /// ticks would otherwise re-arm the same drop on every one of them, and
        /// each raise dooms a fresh span of whatever it has sent since.
        /// </summary>
        [Fact]
        public void ABreakIsRaisedOnceAndNotOnEveryTickThatFollows()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Route("relay-a", "home"), 1.0, 10.0, Dead());
            Assert.NotNull(watch.Observe(new CommsPath(), 1.0, 11.0, Dead("relay-a")));

            Assert.Null(watch.Observe(new CommsPath(), 1.0, 12.0, Dead("relay-a")));
            Assert.Null(watch.Observe(new CommsPath(), 1.0, 13.0, Dead("relay-a")));
        }

        /// <summary>
        /// Reacquisition is not a break. The retained route is empty and the new
        /// one is full, so nothing left it, and a craft coming back into contact
        /// must not doom the samples it is about to send.
        /// </summary>
        [Fact]
        public void ReacquiringARouteRaisesNothing()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Route("relay-a", "home"), 1.0, 10.0, Dead());
            watch.Observe(new CommsPath(), 1.0, 11.0, Dead("relay-a"));

            Assert.Null(watch.Observe(Route("relay-d", "home"), 1.0, 12.0, Dead("relay-a")));
        }

        /// <summary>
        /// <see cref="PathBreakWatch.Forget"/> drops the comparison outright,
        /// for the transitions where two routes belong to different situations
        /// (delay switched off, a different subject, a quickload). Two unrelated
        /// routes differ in every hop, which would read as a break on the
        /// deepest one.
        /// </summary>
        [Fact]
        public void ForgettingTheRouteDropsTheComparison()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Route("relay-a", "relay-b", "home"), 1.0, 10.0, Dead());

            watch.Forget();

            Assert.Null(watch.Observe(new CommsPath(), 1.0, 11.0, Dead("relay-a", "relay-b")));
        }
    }
}
