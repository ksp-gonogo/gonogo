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
        /// A throwing channel mapper takes its owner's OTHER channels off the
        /// air with it, which is what rules out "the maneuver mapper threw" as
        /// an explanation for a capture where <c>vessel.maneuver</c> was silent
        /// while <c>vessel.orbit</c> kept delivering. Both belong to the same
        /// <c>vessel</c> uplink, so a throw in one could not have spared the
        /// other.
        ///
        /// <para>Asserted on emit counters rather than on received frames: two
        /// topics reaching the wire have no guaranteed relative order, so
        /// counting deliveries would be racing the outbox pump rather than
        /// testing the property.</para>
        /// </summary>
        [Fact]
        public async Task OneChannelsMapperThrowingSilencesItsSiblingChannelToo()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new SiblingChannelUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                // Both, because ProcessTick only maps a channel that has a
                // subscriber: without one the poisoned mapper never runs at all.
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, SiblingChannelUplink.ThrowingTopic, Timeout);
                await SubscribeAsync(client, SiblingChannelUplink.SiblingTopic, Timeout);

                engine.TickAndWait(0.0, SiblingChannelUplink.Snapshot(poison: false), Timeout);

                var healthyEmits = engine.ChannelCounters(SiblingChannelUplink.SiblingTopic).Emitted;
                Assert.True(healthyEmits > 0, "the sibling channel should emit while its owner is healthy");
                Assert.True(engine.AvailabilityOf(SiblingChannelUplink.UplinkId).IsAvailable);

                engine.TickAndWait(1.0, SiblingChannelUplink.Snapshot(poison: true), Timeout);
                engine.TickAndWait(2.0, SiblingChannelUplink.Snapshot(poison: false), Timeout);

                Assert.False(
                    engine.AvailabilityOf(SiblingChannelUplink.UplinkId).IsAvailable,
                    "a throwing channel mapper must mark its owning uplink Unavailable");
                Assert.Equal(
                    healthyEmits,
                    engine.ChannelCounters(SiblingChannelUplink.SiblingTopic).Emitted);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Two channels under one owner, one of whose mappers throws on demand.
        /// </summary>
        private sealed class SiblingChannelUplink : ISitrepUplink
        {
            public const string UplinkId = "test-sibling-channels";
            public const string ThrowingTopic = "sibling.throws";
            public const string SiblingTopic = "sibling.healthy";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = UplinkId,
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    Channel(ThrowingTopic),
                    Channel(SiblingTopic),
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(ThrowingTopic, s =>
                {
                    if (s != null && s.Values.ContainsKey("poison"))
                    {
                        throw new InvalidOperationException("mapper poisoned");
                    }
                    return 1.0;
                });
                host.AddChannelSource(SiblingTopic, s => s?.Values.Count);
            }

            public static KspSnapshot Snapshot(bool poison)
            {
                var values = new Dictionary<string, object?> { ["ok"] = 1.0 };
                if (poison)
                {
                    values["poison"] = true;
                }
                return new KspSnapshot { Values = values };
            }

            private static ChannelDeclaration Channel(string topic) => new ChannelDeclaration
            {
                Topic = topic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            };
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
