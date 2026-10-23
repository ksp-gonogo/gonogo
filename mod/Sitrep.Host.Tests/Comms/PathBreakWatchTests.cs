using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// The producer of the drop event: what turns a route change into a
    /// statement the delay ledger can act on.
    ///
    /// <para>The case that matters most here is the one that must not fire. A
    /// reroute and a destruction are the same diff over
    /// <see cref="CommsPath"/>, and treating every departed hop as a break would
    /// delete the in-flight tail on every ordinary route change, which is the
    /// behaviour <c>MiddlemanRerouteTests</c> exists to forbid.</para>
    /// </summary>
    public class PathBreakWatchTests
    {
        private const double C = SignalDelay.SpeedOfLightMetersPerSecond;

        private const string Node = "fleet.far";

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
            Assert.Null(watch.Observe(Node, Route("relay-a", "relay-b", "home"), 1.0, 10.0, Dead()));

            var found = watch.Observe(Node, Route("relay-c", "home"), 1.0, 11.0, Dead("relay-b"));

            Assert.NotNull(found);
            Assert.Equal(11.0, found!.Value.AtUt);
            Assert.Equal(2.0, found.Value.LightSecondsOut, 9);
        }

        /// <summary>
        /// The break lands on the node it was observed for and no other: the
        /// engine retires only the samples that node sent, so a break placed on
        /// the wrong node deletes telemetry that arrived.
        /// </summary>
        [Fact]
        public void TheBreakNamesTheNodeWhoseRouteItWas()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Node, Route("relay-a", "relay-b", "home"), 1.0, 10.0, Dead());

            var found = watch.Observe(Node, Route("relay-c", "home"), 1.0, 11.0, Dead("relay-b"));

            Assert.Equal(Node, found!.Value.Node);
        }

        /// <summary>
        /// The case that must not fire. The same route change, but every relay
        /// that left is still alive and still carrying: KSP re-solves the
        /// cheapest path every tick, and a relay coming over the horizon changes
        /// the route without anything dying. The tail crossing the old route
        /// arrives, so there is no break.
        /// </summary>
        [Fact]
        public void AnOrdinaryRerouteOffLiveRelaysIsNotABreak()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Node, Route("relay-a", "relay-b", "home"), 1.0, 10.0, Dead());

            Assert.Null(watch.Observe(Node, Route("relay-c", "home"), 1.0, 11.0, Dead()));
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
            watch.Observe(Node, Route("relay-a", "relay-b", "home"), 1.0, 10.0, Dead());

            Assert.Null(watch.Observe(Node, Route("relay-c", "home"), 1.0, 11.0, _ => null));
        }

        /// <summary>
        /// Losing the route home entirely is an ordinary break rather than a
        /// special one: the hops are gone, the craft is asked whether it still
        /// reaches each of them, and the nearest it cannot reach is the break.
        /// Everything past that hop reads as unreachable too, but only because
        /// reaching it means crossing the break first.
        /// </summary>
        [Fact]
        public void LosingTheRouteHomeEntirelyRaisesTheBreakAtTheNearestLostHop()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Node, Route("relay-a", "relay-b", "home"), 1.0, 10.0, Dead());

            var found = watch.Observe(Node,
                new CommsPath(), 1.0, 11.0, Dead("relay-a", "relay-b", "home"));

            Assert.NotNull(found);
            Assert.Equal(1.0, found!.Value.LightSecondsOut, 9);
        }

        /// <summary>
        /// A relay destroyed with no way round it. The craft can no longer reach
        /// the relay or anything beyond it, so every later hop answers that it
        /// does not carry. What the relay had already passed on is on the far
        /// legs and still arrives, so the break sits at the relay.
        /// </summary>
        [Fact]
        public void ADestroyedRelayWithNoWayRoundBreaksAtTheRelay()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Node, Route("relay-a", "relay-b", "relay-c", "home"), 1.0, 10.0, Dead());

            var found = watch.Observe(Node,
                new CommsPath(), 1.0, 11.0, Dead("relay-b", "relay-c", "home"));

            Assert.NotNull(found);
            Assert.Equal(2.0, found!.Value.LightSecondsOut, 9);
        }

        /// <summary>
        /// A relay chain to Eeloo with the hop lengths the game measured: Relay 8
        /// half a megametre from the probe, then four interplanetary hops to the
        /// Kerbin relay and KSC, 285.97 s of signal delay in all. Eeloo moves
        /// between the probe and Relay 8 at UT 350300527.22 and the route goes
        /// empty. Every frame the probe sent in the 286 s before that had already
        /// crossed the first hop and is on its way down the chain, so it arrives.
        /// Only light that reaches the first hop after it closed is lost.
        /// </summary>
        [Fact]
        public void AnOccludedFirstHopLosesOnlyTheLightThatHadNotCrossedIt()
        {
            const double lossUt = 350300527.22;
            var chain = new CommsPath
            {
                Hops = new List<CommsHop>
                {
                    new CommsHop { From = "probe", To = "relay-8", DistanceMeters = 514_657 },
                    new CommsHop { From = "relay-8", To = "relay-7", DistanceMeters = 13_889_349_221 },
                    new CommsHop { From = "relay-7", To = "relay-5", DistanceMeters = 25_373_843_802 },
                    new CommsHop { From = "relay-5", To = "relay-3", DistanceMeters = 23_233_631_510 },
                    new CommsHop { From = "relay-3", To = "relay-1", DistanceMeters = 23_231_990_461 },
                    new CommsHop { From = "relay-1", To = "ksc", DistanceMeters = 2_864_456 },
                },
            };
            var watch = new PathBreakWatch();
            watch.Observe(Node, chain, 1.0, lossUt - 1.0, Dead());

            var found = watch.Observe(Node, new CommsPath(), 1.0, lossUt,
                Dead("relay-8", "relay-7", "relay-5", "relay-3", "relay-1", "ksc"));

            Assert.NotNull(found);
            var network = new StubNetwork(delay: 285.97);
            network.DropPath(found!.Value.Node, found.Value.AtUt, found.Value.LightSecondsOut);

            Assert.False(network.Lost(Node, 350300232.5));
            Assert.False(network.Lost(Node, 350300242.5));
            Assert.False(network.Lost(Node, 350300522.5));
            Assert.False(network.Lost(Node, lossUt - 0.01));
            Assert.True(network.Lost(Node, lossUt - 0.001));
        }

        /// <summary>
        /// The break's position is a signal delay, so it carries the same
        /// light-speed scale the delay does. A route measured against one scale
        /// and a break against another would partition the tail at a point the
        /// samples were never timed to.
        /// </summary>
        [Fact]
        public void ThePositionCarriesTheLightSpeedScale()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Node, Route("relay-a", "relay-b", "home"), 2.0, 10.0, Dead());

            var found = watch.Observe(Node, new CommsPath(), 2.0, 11.0, Dead("relay-b", "home"));

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
            watch.Observe(Node, Route("relay-a", "relay-b", "home"), 1.0, 10.0, Dead());

            var blind = new CommsPath
            {
                Hops = new List<CommsHop>
                {
                    new CommsHop { From = "craft", To = "relay-c", DistanceMeters = null },
                },
            };
            Assert.Null(watch.Observe(Node, blind, 1.0, 11.0, Dead("relay-b")));

            // And the retained route is forgotten with it, so the next
            // observation compares against nothing rather than against geometry
            // separated from it by an unmeasured gap.
            Assert.Null(watch.Observe(Node, new CommsPath(), 1.0, 12.0, Dead("relay-b")));
        }

        /// <summary>
        /// The warp domain. A tick that advanced UT by more than the whole
        /// route's signal delay raises nothing: the death instant, the ledger
        /// write and every delivery share that one quantum, so there is no
        /// ordering between sent, crossed and broke left to read. Deliver,
        /// because we do not know it did not cross.
        /// </summary>
        [Fact]
        public void ATickLongerThanTheWholeLightTimeRaisesNothing()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Node, Route("relay-a", "relay-b", "home"), 1.0, 10.0, Dead());

            // Three light-seconds of route, four seconds of UT in one tick.
            Assert.Null(watch.Observe(Node, new CommsPath(), 1.0, 14.0, Dead("relay-b")));
        }

        /// <summary>
        /// The same break is raised once. A craft that stays dark for a thousand
        /// ticks would otherwise re-arm the same drop on every one of them, and
        /// each raise dooms a fresh span of whatever it has sent since.
        /// </summary>
        [Fact]
        public void ABreakIsRaisedOnceAndNotOnEveryTickThatFollows()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Node, Route("relay-a", "home"), 1.0, 10.0, Dead());
            Assert.NotNull(watch.Observe(Node, new CommsPath(), 1.0, 11.0, Dead("relay-a")));

            Assert.Null(watch.Observe(Node, new CommsPath(), 1.0, 12.0, Dead("relay-a")));
            Assert.Null(watch.Observe(Node, new CommsPath(), 1.0, 13.0, Dead("relay-a")));
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
            watch.Observe(Node, Route("relay-a", "home"), 1.0, 10.0, Dead());
            watch.Observe(Node, new CommsPath(), 1.0, 11.0, Dead("relay-a"));

            Assert.Null(watch.Observe(Node, Route("relay-d", "home"), 1.0, 12.0, Dead("relay-a")));
        }

        /// <summary>
        /// <see cref="PathBreakWatch.Forget"/> drops the comparison outright,
        /// for the transitions where two routes belong to different situations
        /// (delay switched off, a different subject, a quickload). Two unrelated
        /// routes differ in every hop, which would read as a break on the
        /// nearest one.
        /// </summary>
        [Fact]
        public void ForgettingTheRouteDropsTheComparison()
        {
            var watch = new PathBreakWatch();
            watch.Observe(Node, Route("relay-a", "relay-b", "home"), 1.0, 10.0, Dead());

            watch.Forget();

            Assert.Null(watch.Observe(Node, new CommsPath(), 1.0, 11.0, Dead("relay-a", "relay-b")));
        }
    }
}
