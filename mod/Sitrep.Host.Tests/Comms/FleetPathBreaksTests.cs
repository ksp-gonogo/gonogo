using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// A break raised against the vessel whose route it was on, for every
    /// vessel in the fleet rather than only the active one.
    ///
    /// <para>Nodes are plain objects named through a table, standing in for
    /// the live comms nodes a real route carries: what is under test is that
    /// each vessel is compared against its own previous route and asked about
    /// through its own node.</para>
    /// </summary>
    public class FleetPathBreaksTests
    {
        private const double C = SignalDelay.SpeedOfLightMetersPerSecond;

        private readonly Dictionary<string, object> _nodes = new Dictionary<string, object>();
        private readonly HashSet<object> _dead = new HashSet<object>();
        private readonly List<(object? From, object? To)> _asked = new List<(object?, object?)>();

        private object Node(string id)
        {
            if (!_nodes.TryGetValue(id, out var node))
            {
                node = new object();
                _nodes[id] = node;
            }
            return node;
        }

        private string? NameOf(object? handle)
        {
            foreach (var entry in _nodes)
            {
                if (ReferenceEquals(entry.Value, handle))
                {
                    return entry.Key;
                }
            }
            return null;
        }

        private IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to)
        {
            _asked.Add((from, to));
            return to != null && _dead.Contains(to) ? null : new List<CommsRouteHop>();
        }

        /// <summary>A route from <paramref name="self"/> through each named node, one light-second per hop.</summary>
        private List<CommsRouteHop> Route(string self, params string[] through)
        {
            var hops = new List<CommsRouteHop>();
            var from = Node(self);
            foreach (var id in through)
            {
                var to = Node(id);
                hops.Add(new CommsRouteHop(C, id == "home", from, to));
                from = to;
            }
            return hops;
        }

        private PathBreak? Observe(FleetPathBreaks breaks, string vessel, List<CommsRouteHop>? route, double ut) =>
            breaks.Observe(vessel, Node(vessel), route, NameOf, 1.0, ut, RouteBetween);

        [Fact]
        public void ABackgroundVesselsDestroyedRelayRaisesABreakAtItsPosition()
        {
            var breaks = new FleetPathBreaks();
            Assert.Null(Observe(breaks, "probe", Route("probe", "relay-a", "relay-b", "home"), 10.0));

            _dead.Add(Node("relay-b"));
            var found = Observe(breaks, "probe", Route("probe", "relay-c", "home"), 11.0);

            Assert.NotNull(found);
            Assert.Equal(11.0, found!.Value.AtUt);
            Assert.Equal(2.0, found.Value.LightSecondsOut, 9);
        }

        [Fact]
        public void TheRouterIsAskedFromTheVesselsOwnNode()
        {
            var breaks = new FleetPathBreaks();
            Observe(breaks, "probe", Route("probe", "relay-a", "home"), 10.0);
            Observe(breaks, "probe", Route("probe", "relay-c", "home"), 11.0);

            Assert.Contains(_asked, q => ReferenceEquals(q.From, Node("probe")) && ReferenceEquals(q.To, Node("relay-a")));
            Assert.DoesNotContain(_asked, q => !ReferenceEquals(q.From, Node("probe")));
        }

        [Fact]
        public void AnOrdinaryRerouteOffLiveRelaysIsNotABreak()
        {
            var breaks = new FleetPathBreaks();
            Observe(breaks, "probe", Route("probe", "relay-a", "relay-b", "home"), 10.0);

            Assert.Null(Observe(breaks, "probe", Route("probe", "relay-c", "home"), 11.0));
        }

        /// <summary>
        /// Two craft sharing a relay, one of them rerouting off it: only the
        /// craft whose route actually lost the relay is compared against a route
        /// that had it, so the other never raises a break for it.
        /// </summary>
        [Fact]
        public void EachVesselIsComparedAgainstItsOwnRoute()
        {
            var breaks = new FleetPathBreaks();
            Observe(breaks, "probe", Route("probe", "relay-a", "home"), 10.0);
            Observe(breaks, "lander", Route("lander", "relay-b", "home"), 10.0);

            _dead.Add(Node("relay-a"));
            var probe = Observe(breaks, "probe", Route("probe", "home"), 11.0);
            var lander = Observe(breaks, "lander", Route("lander", "relay-b", "home"), 11.0);

            Assert.NotNull(probe);
            Assert.Equal(1.0, probe!.Value.LightSecondsOut, 9);
            Assert.Null(lander);
        }

        /// <summary>
        /// Losing every route home is still compared: the relays that left are
        /// asked about like any other, and a dead one is a break.
        /// </summary>
        [Fact]
        public void LosingTheWholeRouteIsABreakWhenTheRelayIsGone()
        {
            var breaks = new FleetPathBreaks();
            Observe(breaks, "probe", Route("probe", "relay-a", "home"), 10.0);

            _dead.Add(Node("relay-a"));
            _dead.Add(Node("home"));
            var found = Observe(breaks, "probe", new List<CommsRouteHop>(), 11.0);

            Assert.NotNull(found);
            Assert.Equal(2.0, found!.Value.LightSecondsOut, 9);
        }

        [Fact]
        public void AnUnnamedNodeRefusesAndForgetsTheRetainedRoute()
        {
            var breaks = new FleetPathBreaks();
            Observe(breaks, "probe", Route("probe", "relay-a", "home"), 10.0);

            var unnamed = Route("probe", "relay-a", "home");
            unnamed[0] = new CommsRouteHop(C, false, Node("probe"), new object());
            Assert.Null(Observe(breaks, "probe", unnamed, 11.0));
            Assert.Equal(0, breaks.Count);

            _dead.Add(Node("relay-a"));
            Assert.Null(Observe(breaks, "probe", Route("probe", "home"), 12.0));
        }

        [Fact]
        public void NothingToReadForgetsTheRetainedRoute()
        {
            var breaks = new FleetPathBreaks();
            Observe(breaks, "probe", Route("probe", "relay-a", "home"), 10.0);

            Assert.Null(Observe(breaks, "probe", null, 11.0));

            _dead.Add(Node("relay-a"));
            Assert.Null(Observe(breaks, "probe", Route("probe", "home"), 12.0));
        }

        /// <summary>A quickload runs UT backwards, and the retained route belongs to the abandoned timeline.</summary>
        [Fact]
        public void UtRunningBackwardsComparesAgainstNothing()
        {
            var breaks = new FleetPathBreaks();
            Observe(breaks, "probe", Route("probe", "relay-a", "home"), 10.0);

            _dead.Add(Node("relay-a"));
            Assert.Null(Observe(breaks, "probe", Route("probe", "home"), 9.5));
        }

        [Fact]
        public void NoRouterIsNoOpinionAndRaisesNothing()
        {
            var breaks = new FleetPathBreaks();
            breaks.Observe("probe", Node("probe"), Route("probe", "relay-a", "home"), NameOf, 1.0, 10.0, null);

            _dead.Add(Node("relay-a"));
            Assert.Null(breaks.Observe("probe", Node("probe"), Route("probe", "home"), NameOf, 1.0, 11.0, null));
        }

        [Fact]
        public void RetainDropsVesselsThatLeftTheSave()
        {
            var breaks = new FleetPathBreaks();
            Observe(breaks, "probe", Route("probe", "relay-a", "home"), 10.0);
            Observe(breaks, "lander", Route("lander", "relay-a", "home"), 10.0);

            breaks.Retain(new HashSet<string> { "lander" });

            Assert.Equal(1, breaks.Count);
            _dead.Add(Node("relay-a"));
            Assert.Null(Observe(breaks, "probe", Route("probe", "home"), 11.0));
            Assert.NotNull(Observe(breaks, "lander", Route("lander", "home"), 11.0));
        }
    }
}
