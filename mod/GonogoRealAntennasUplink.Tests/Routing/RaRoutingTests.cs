using System;
using System.Collections.Generic;
using CommNet;
using Xunit;

namespace Gonogo.RealAntennasUplink.Tests.Routing
{
    /// <summary>
    /// <see cref="RaRouting"/> against the REAL CommNet types, with the network
    /// shaped the way RealAntennas shapes it: <c>FindClosestWhere</c> overridden
    /// (RA's only routing override) and <c>FindPath</c> left inherited from stock
    /// (which RA never touches).
    ///
    /// <para>What is under test is WHICH router is entered. Reaching stock's is
    /// not a near miss, it is the whole defect: stock's walk has no notion of
    /// RA's minimum relay tech level, so it happily quotes a light-time over a
    /// relay the game refuses to carry traffic through.</para>
    /// </summary>
    public class RaRoutingTests
    {
        /// <summary>A network with RA's routing shape and a counter on each router.</summary>
        private sealed class RaShapedNetwork : CommNetwork
        {
            private readonly Func<CommNode, CommNode, CommNode[]?> _raRoute;

            internal RaShapedNetwork(Func<CommNode, CommNode, CommNode[]?> raRoute) => _raRoute = raRoute;

            internal int StockSolves { get; private set; }

            internal int RaSolves { get; private set; }

            public override bool FindPath(CommNode start, CommPath path, CommNode end)
            {
                StockSolves++;
                return base.FindPath(start, path, end);
            }

            public override CommNode? FindClosestWhere(
                CommNode start,
                CommPath path,
                Func<CommNode, CommNode, bool> where)
            {
                RaSolves++;
                path?.Clear();
                var chain = _raRoute(start, start);
                if (chain == null || !where(start, chain[chain.Length - 1]))
                {
                    return null;
                }
                for (var i = 0; i + 1 < chain.Length; i++)
                {
                    path?.Add(new CommLink { a = chain[i], b = chain[i + 1] });
                }
                return chain[chain.Length - 1];
            }
        }

        private static CommNode NodeAt(CommNetwork net, double x, double y = 0.0, bool isHome = false)
        {
            var node = new CommNode
            {
                precisePosition = new Vector3d(x, y, 0.0),
                isHome = isHome,
            };
            node.SetNet(net);
            return node;
        }

        [Fact]
        public void RoutesThroughRealAntennasOwnRouter_NeverStocks()
        {
            CommNode? origin = null;
            CommNode? relay = null;
            CommNode? target = null;
            var net = new RaShapedNetwork((_, __) => new[] { origin!, relay!, target! });
            origin = NodeAt(net, 0.0);
            relay = NodeAt(net, 300.0, 400.0);
            target = NodeAt(net, 1000.0, isHome: true);

            var hops = RaRouting.Between(origin, target);

            Assert.NotNull(hops);
            Assert.Equal(2, hops!.Count);
            Assert.Equal(500.0, hops[0].DistanceMeters, 6);
            Assert.False(hops[0].TouchesHome);
            Assert.True(hops[1].TouchesHome);
            Assert.Equal(1, net.RaSolves);
            Assert.Equal(0, net.StockSolves);
        }

        [Fact]
        public void ARefusedRoute_IsNull_NeverZero()
        {
            var net = new RaShapedNetwork((_, __) => null);
            var origin = NodeAt(net, 0.0);
            var target = NodeAt(net, 1000.0);

            Assert.Null(RaRouting.Between(origin, target));
            Assert.Equal(0, net.StockSolves);
        }

        [Fact]
        public void AnEndTheRouterReachesButTheCallerDidNotAskFor_IsNotARoute()
        {
            CommNode? origin = null;
            CommNode? somewhereElse = null;
            var net = new RaShapedNetwork((_, __) => new[] { origin!, somewhereElse! });
            origin = NodeAt(net, 0.0);
            somewhereElse = NodeAt(net, 1000.0);
            var target = NodeAt(net, 2000.0);

            Assert.Null(RaRouting.Between(origin, target));
        }

        [Fact]
        public void MissingOrIdenticalNodes_AreNull_AndNeverSolve()
        {
            var net = new RaShapedNetwork((_, __) => throw new InvalidOperationException("must not solve"));
            var node = NodeAt(net, 0.0);

            Assert.Null(RaRouting.Between(null, node));
            Assert.Null(RaRouting.Between(node, null));
            Assert.Null(RaRouting.Between(node, node));
            Assert.Equal(0, net.RaSolves);
            Assert.Equal(0, net.StockSolves);
        }

        [Fact]
        public void AHandleThatIsNotACommNode_IsNull()
        {
            var net = new RaShapedNetwork((_, __) => throw new InvalidOperationException("must not solve"));
            var node = NodeAt(net, 0.0);

            Assert.Null(RaRouting.Between("not-a-node", node));
            Assert.Null(RaRouting.Between(node, 42));
        }
    }
}
