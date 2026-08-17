using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;
using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Whether <c>vessel.maneuver</c> reaches a subscriber when the craft has
    /// no nodes queued, which is the overwhelmingly common case and the one
    /// nothing tested.
    ///
    /// <para><b>Why this is not covered by the mapper tests.</b>
    /// <c>VesselViewProviderTests.BuildManeuverNormalizesNullNodesListToEmptyArrayNeverNull</c>
    /// proves <see cref="VesselViewProvider.BuildManeuver"/> returns
    /// <c>Nodes = []</c> rather than null. It cannot prove a frame carrying
    /// that empty list is EMITTED, because the birth gate that would suppress
    /// one lives in <c>ChannelEngine.ProcessTick</c>, downstream of the
    /// mapper. A test adjacent to the property is not a test of it.</para>
    ///
    /// <para>The pair below is deliberate. The empty case alone could pass
    /// against an engine that emits nothing at all if the assertion were
    /// written loosely, so the populated case runs the identical path and
    /// asserts the opposite, which is what makes a green empty case mean
    /// something.</para>
    /// </summary>
    public class ManeuverEmptyPayloadTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        private const string VesselId = "11111111-2222-3333-4444-555555555555";

        [Fact]
        public async Task VesselWithNoNodesQueuedStillDeliversAManeuverFrameCarryingAnEmptyNodeList()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new TestVesselUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, VesselViewProvider.ManeuverTopic, Timeout);

                engine.TickAndWait(0.0, SnapshotWithNodes(null), Timeout);

                var frame = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal(VesselViewProvider.ManeuverTopic, frame.Topic);
                Assert.Empty(NodesOf(frame));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The control for the test above: the same engine, subscription and
        /// assertion helper, with one node present. If this fails, a green
        /// empty case says nothing about the engine and everything about the
        /// harness.
        /// </summary>
        [Fact]
        public async Task VesselWithOneNodeQueuedDeliversThatNodeThroughTheSameSubscription()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new TestVesselUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, VesselViewProvider.ManeuverTopic, Timeout);

                engine.TickAndWait(0.0, SnapshotWithNodes(new List<object?>
                {
                    new Dictionary<string, object?>
                    {
                        ["id"] = "node-1",
                        ["ut"] = 12345.0,
                        ["dvRadial"] = 1.0,
                        ["dvNormal"] = 2.0,
                        ["dvPrograde"] = 300.0,
                        ["dvTotal"] = 300.02,
                    },
                }), Timeout);

                var frame = await ReceiveStreamDataAsync(client, Timeout);
                var node = Assert.Single(NodesOf(frame));
                Assert.Equal("node-1", node.TryGetValue("id", out var id) ? id as string : null);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A vessel group carrying a subject id and, optionally, a raw
        /// maneuver-node list. <paramref name="nodes"/> null reproduces the
        /// no-nodes-queued shape <c>KspHost.BuildManeuverNodes</c> produces,
        /// which returns null rather than an empty list.
        /// </summary>
        private static KspSnapshot SnapshotWithNodes(List<object?>? nodes)
        {
            var vessel = new Dictionary<string, object?>
            {
                ["identity"] = new Dictionary<string, object?> { ["id"] = VesselId },
            };
            if (nodes != null)
            {
                vessel["maneuverNodes"] = nodes;
            }
            return new KspSnapshot { Values = new Dictionary<string, object?> { ["vessel"] = vessel } };
        }

        private static IReadOnlyList<IDictionary<string, object?>> NodesOf(StreamData frame)
        {
            var payload = Assert.IsAssignableFrom<IDictionary<string, object?>>(frame.Payload);
            Assert.True(payload.ContainsKey("nodes"), "vessel.maneuver payload carried no 'nodes' key at all");
            var raw = payload["nodes"] as IEnumerable<object?>;
            Assert.NotNull(raw);
            return raw!.OfType<IDictionary<string, object?>>().ToList();
        }
    }
}
