using System;
using System.Collections.Generic;
using CommNet;
using Sitrep.Host.Comms;
using Xunit;
using Sitrep.Contract;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// <see cref="FleetCommsReader.ReadNodePath"/> against the REAL CommNet
    /// types (CommNode / CommLink / CommPath are plain classes, no scene
    /// needed), with only the solver itself faked: the network subclass below
    /// overrides <c>FindPath</c> so a test can say "these two are unroutable" or
    /// "the route is this chain of nodes" without standing up antennas,
    /// occlusion, or a range model. What is under test is the reader's own
    /// decisions -- which absences stay absent, and whether the whole walked
    /// route is measured -- not stock's Dijkstra.
    /// </summary>
    public class FleetCommsReaderTests
    {
        private const double C = SignalDelay.SpeedOfLightMetersPerSecond;

        private static SignalDelayConfig Enabled() =>
            new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

        /// <summary>A CommNetwork whose pathfinding is scripted: null route = unroutable.</summary>
        private sealed class ScriptedNetwork : CommNetwork
        {
            private readonly Func<CommNode, CommNode, CommNode[]?> _route;

            internal ScriptedNetwork(Func<CommNode, CommNode, CommNode[]?> route) => _route = route;

            internal List<(CommNode Start, CommNode End)> Requests { get; } =
                new List<(CommNode, CommNode)>();

            public override bool FindPath(CommNode start, CommPath path, CommNode end)
            {
                Requests.Add((start, end));
                var chain = _route(start, end);
                if (chain == null)
                {
                    return false;
                }

                for (var i = 0; i + 1 < chain.Length; i++)
                {
                    path.Add(new CommLink { a = chain[i], b = chain[i + 1] });
                }
                return true;
            }
        }

        private static CommNode NodeAt(ScriptedNetwork net, double x, bool isHome = false)
        {
            var node = new CommNode
            {
                precisePosition = new Vector3d(x, 0.0, 0.0),
                isHome = isHome,
            };
            node.SetNet(net);
            return node;
        }

        [Fact]
        public void UnroutablePair_IsNull_NeverZero()
        {
            var net = new ScriptedNetwork((_, __) => null);
            var from = NodeAt(net, 0);
            var to = NodeAt(net, C);

            Assert.Null(FleetCommsReader.ReadNodePath(from, to, Enabled()));
        }

        [Fact]
        public void SameNodeAtBothEnds_IsNotARoute_AndNeverAsksTheSolver()
        {
            var net = new ScriptedNetwork((_, __) => throw new InvalidOperationException("must not solve"));
            var node = NodeAt(net, 0);

            Assert.Null(FleetCommsReader.ReadNodePath(node, node, Enabled()));
            Assert.Empty(net.Requests);
        }

        [Fact]
        public void MissingNode_IsNull()
        {
            var net = new ScriptedNetwork((_, __) => throw new InvalidOperationException("must not solve"));
            var node = NodeAt(net, 0);

            Assert.Null(FleetCommsReader.ReadNodePath(null, node, Enabled()));
            Assert.Null(FleetCommsReader.ReadNodePath(node, null, Enabled()));
            Assert.Empty(net.Requests);
        }

        [Fact]
        public void SingleHop_IsTheDistanceBetweenTheTwoNodes()
        {
            ScriptedNetwork? net = null;
            CommNode? from = null;
            CommNode? to = null;
            net = new ScriptedNetwork((_, __) => new[] { from!, to! });
            from = NodeAt(net, 0);
            to = NodeAt(net, C);

            var seconds = FleetCommsReader.ReadNodePath(from, to, Enabled());

            Assert.NotNull(seconds);
            Assert.Equal(1.0, seconds!.Value, 9);
        }

        [Fact]
        public void MultiHopRoute_SumsEveryLeg_NotTheEndToEndChord()
        {
            ScriptedNetwork? net = null;
            CommNode? a = null;
            CommNode? relay = null;
            CommNode? b = null;
            net = new ScriptedNetwork((_, __) => new[] { a!, relay!, b! });
            a = NodeAt(net, 0);
            // The relay sits off to one side, so the route walked (2c + 2c) is
            // four times the 1c chord between the endpoints: measuring the chord
            // would understate the delay by a factor of four.
            relay = new CommNode { precisePosition = new Vector3d(0.5 * C, 2 * C, 0.0) };
            relay.SetNet(net);
            b = NodeAt(net, C, isHome: true);

            var seconds = FleetCommsReader.ReadNodePath(a, b, Enabled());

            var legs = (relay.precisePosition - a.precisePosition).magnitude
                + (b.precisePosition - relay.precisePosition).magnitude;
            Assert.NotNull(seconds);
            Assert.Equal(legs / C, seconds!.Value, 9);
            Assert.True(seconds.Value > 1.0);
        }

        [Fact]
        public void SolvesFromTheGivenStartNode_NotFromWhateverIsHome()
        {
            ScriptedNetwork? net = null;
            CommNode? from = null;
            CommNode? to = null;
            net = new ScriptedNetwork((_, __) => new[] { from!, to! });
            from = NodeAt(net, 0);
            to = NodeAt(net, C);

            FleetCommsReader.ReadNodePath(from, to, Enabled());

            var request = Assert.Single(net.Requests);
            Assert.Same(from, request.Start);
            Assert.Same(to, request.End);
        }

        [Fact]
        public void DelayDisabled_OverARoutedPath_IsAppliedZero()
        {
            ScriptedNetwork? net = null;
            CommNode? from = null;
            CommNode? to = null;
            net = new ScriptedNetwork((_, __) => new[] { from!, to! });
            from = NodeAt(net, 0);
            to = NodeAt(net, C);

            Assert.Equal(0.0, FleetCommsReader.ReadNodePath(from, to, SignalDelayConfig.Off()));
        }
    }
}
