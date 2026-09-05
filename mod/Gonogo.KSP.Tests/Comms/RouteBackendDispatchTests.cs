using System;
using System.Collections.Generic;
using CommNet;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// Which ROUTER a node-to-node delay is solved by.
    ///
    /// <para>The graph below is shaped like the one RealAntennas actually flies:
    /// a near relay whose antenna is below <c>minRelayTL</c> and a far one that
    /// is above it. Stock's own Dijkstra (<c>CommNetwork.CreateShortestPathTree</c>
    /// / <c>UpdateShortestPath</c>, maximising a product of per-link signal
    /// strength) knows nothing about a relay tech level and takes the near route.
    /// RA's router refuses to RELAY through a below-minimum antenna at all and
    /// takes the far one. Two different routes over one link set, so two
    /// different light-times, and only one of them is the route the game is
    /// using.</para>
    ///
    /// <para>Stock's walk here is the REAL one: the network is a plain
    /// <see cref="CommNetwork"/> and <c>FindPath</c> is left inherited, exactly
    /// as RealAntennas leaves it. Only <see cref="RelayGatedNetwork.FindClosestWhere"/>
    /// is overridden, which is the one routing method RA does override.</para>
    /// </summary>
    public class RouteBackendDispatchTests
    {
        private const double C = SignalDelay.SpeedOfLightMetersPerSecond;

        private static SignalDelayConfig Enabled() =>
            new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

        /// <summary>
        /// A backend with RealAntennas' routing shape: it asks the network for
        /// the closest node that IS the destination, which is the one routing
        /// method RA overrides. Only <see cref="RouteBetween"/> is real; nothing
        /// else here is exercised. The shipped RA backend does the same thing in
        /// <c>RaRouting.Between</c>, which lives in the RA Uplink and cannot be
        /// referenced from core's own suite.
        /// </summary>
        private sealed class ClosestWhereBackend : ICommsBackend
        {

        public bool? StillCarriesTo(string nodeId) => null;
            public string ProviderId => "test-closest-where";

            public IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to)
            {
                if (from is not CommNode start || to is not CommNode end)
                {
                    return null;
                }
                var path = new CommPath();
                var net = start.Net;
                if (net == null || net.FindClosestWhere(start, path, (_, node) => ReferenceEquals(node, end)) == null)
                {
                    return null;
                }
                var hops = new List<CommsRouteHop>();
                foreach (var link in path)
                {
                    hops.Add(new CommsRouteHop(
                        (link.a.precisePosition - link.b.precisePosition).magnitude,
                        link.a.isHome || link.b.isHome));
                }
                return hops;
            }

            public CommsConnectivity Connectivity() => throw new NotSupportedException();
            public CommsSignalStrength SignalStrength() => throw new NotSupportedException();
            public CommsControlState ControlState() => throw new NotSupportedException();
            public CommsPath Path() => throw new NotSupportedException();
            public CommsNetwork Network() => throw new NotSupportedException();
            public ICommsReachModel ReachModel(object? from, object? to) => throw new NotSupportedException();

            public object? ControlPathTerminus() => throw new NotSupportedException();

            public ICommsOcclusionModel OcclusionModel() => throw new NotSupportedException();

            public ICommsDegradeModel DegradeModel() => throw new NotSupportedException();
        }

        /// <summary>
        /// A network with RealAntennas' routing SHAPE: stock's <c>FindPath</c>
        /// inherited untouched, and <c>FindClosestWhere</c> overridden to apply a
        /// relay gate. The gate is RA's own rule, read off the shipped assembly:
        /// a neighbour is admitted to the frontier only when its receiving
        /// antenna's tech level clears <c>minRelayTL</c>, OR when the caller's
        /// own predicate already accepts it (so a below-minimum node can still be
        /// the DESTINATION, it just cannot carry someone else's traffic).
        /// </summary>
        private sealed class RelayGatedNetwork : CommNetwork
        {
            private readonly HashSet<CommNode> _belowMinimumRelayTechLevel = new HashSet<CommNode>();

            /// <summary>How many times stock's own two-node router was entered.</summary>
            internal int StockSolves { get; private set; }

            internal CommNode AddNodeAt(Vector3d position, bool canRelay = true)
            {
                var node = new CommNode { precisePosition = position };
                node.SetNet(this);
                nodes.Add(node);
                if (!canRelay)
                {
                    _belowMinimumRelayTechLevel.Add(node);
                }
                return node;
            }

            public override bool FindPath(CommNode start, CommPath path, CommNode end)
            {
                StockSolves++;
                return base.FindPath(start, path, end);
            }

            internal void Join(CommNode a, CommNode b, double strength)
            {
                var link = new CommLink
                {
                    a = a,
                    b = b,
                    signalStrength = strength,
                    strengthAR = strength,
                    strengthBR = strength,
                    strengthRR = strength,
                };
                a.Add(b, link);
                b.Add(a, link);
                links.Add(link);
            }

            /// <summary>
            /// RA's router over this deliberately small graph: every simple route
            /// from <paramref name="start"/> whose intermediate nodes all clear
            /// the relay gate, cheapest first by hop count then by distance.
            /// </summary>
            public override CommNode FindClosestWhere(
                CommNode start,
                CommPath path,
                Func<CommNode, CommNode, bool> where)
            {
                path?.Clear();
                foreach (var chain in Routes(start, new List<CommNode> { start }))
                {
                    var end = chain[chain.Count - 1];
                    if (!where(start, end))
                    {
                        continue;
                    }
                    for (var i = 0; i + 1 < chain.Count; i++)
                    {
                        path?.Add(chain[i][chain[i + 1]]);
                    }
                    return end;
                }
                return null;
            }

            private IEnumerable<List<CommNode>> Routes(CommNode from, List<CommNode> walked)
            {
                foreach (var neighbour in from.Keys)
                {
                    if (walked.Contains(neighbour))
                    {
                        continue;
                    }
                    var extended = new List<CommNode>(walked) { neighbour };
                    yield return extended;
                    // The gate: traffic may not be RELAYED onward through a node
                    // whose antenna is below the minimum relay tech level.
                    if (_belowMinimumRelayTechLevel.Contains(neighbour))
                    {
                        continue;
                    }
                    foreach (var longer in Routes(neighbour, extended))
                    {
                        yield return longer;
                    }
                }
            }
        }

        /// <summary>
        /// The four-node graph: origin and target 3c apart, a near relay on the
        /// straight line between them that RA will not relay through, and a far
        /// relay off to one side that it will.
        /// </summary>
        private static RelayGatedNetwork Graph(
            out CommNode origin,
            out CommNode target,
            out double nearSeconds,
            out double farSeconds)
        {
            var net = new RelayGatedNetwork();
            origin = net.AddNodeAt(new Vector3d(0.0, 0.0, 0.0));
            target = net.AddNodeAt(new Vector3d(3.0 * C, 0.0, 0.0));
            var near = net.AddNodeAt(new Vector3d(1.5 * C, 0.0, 0.0), canRelay: false);
            var far = net.AddNodeAt(new Vector3d(1.5 * C, 2.0 * C, 0.0));

            // The near relay is closer, so its links are the stronger ones: on
            // stock's product-of-strength metric that route wins outright.
            net.Join(origin, near, 0.9);
            net.Join(near, target, 0.9);
            net.Join(origin, far, 0.5);
            net.Join(far, target, 0.5);

            nearSeconds = 3.0;
            farSeconds = 5.0;
            return net;
        }

        [Fact]
        public void StockAndRealAntennasRoutersDisagreeOverThisGraph()
        {
            var net = Graph(out var origin, out var target, out var nearSeconds, out var farSeconds);

            var stockPath = new CommPath();
            Assert.True(net.FindPath(origin, stockPath, target));
            Assert.Equal(nearSeconds, LightSeconds(stockPath), 6);

            var raPath = new CommPath();
            Assert.NotNull(net.FindClosestWhere(origin, raPath, (_, node) => ReferenceEquals(node, target)));
            Assert.Equal(farSeconds, LightSeconds(raPath), 6);
        }

        [Fact]
        public void NodeToNodeDelayTakesTheElectedBackendsRoute_NotStocks()
        {
            var net = Graph(out var origin, out var target, out _, out var farSeconds);

            var seconds = FleetCommsReader.ReadNodePath(new ClosestWhereBackend(), origin, target, Enabled());

            Assert.NotNull(seconds);
            Assert.Equal(farSeconds, seconds!.Value, 6);
            // Not merely a different number: stock's router was never entered.
            Assert.Equal(0, net.StockSolves);
        }

        [Fact]
        public void TheVanillaBackendStillRoutesByStocksRules()
        {
            var net = Graph(out var origin, out var target, out var nearSeconds, out _);

            var seconds = FleetCommsReader.ReadNodePath(new CommNetBackend(), origin, target, Enabled());

            Assert.NotNull(seconds);
            Assert.Equal(nearSeconds, seconds!.Value, 6);
            Assert.Equal(1, net.StockSolves);
        }

        private static double LightSeconds(CommPath path)
        {
            var total = 0.0;
            foreach (var link in path)
            {
                total += (link.a.precisePosition - link.b.precisePosition).magnitude;
            }
            return total / C;
        }
    }
}
