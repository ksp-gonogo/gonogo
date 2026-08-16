using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Two halves of one live outage, pinned so the next one is diagnosable in
    /// minutes instead of hours.
    ///
    /// <para>The <c>vessel</c> uplink died on a single <c>AddChannelSource</c>
    /// call for a topic its Manifest had never declared. A Manifest is recorded
    /// BEFORE <c>Register</c> runs, so all twenty <c>vessel.*</c> topics stayed
    /// declared, kept acking subscribes, and delivered nothing ever again. On the
    /// wire that is indistinguishable from a channel that has simply not produced
    /// a value yet, so the app sat on "SYNCING" and the fault read as a
    /// delay-model bug: every Delayed topic dead, every TrueNow topic fine,
    /// purely because the dead uplink happened to own the Delayed ones.</para>
    /// </summary>
    public class DeadUplinkSubscribeTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(400);

        /// <summary>
        /// The failure mode itself, end to end: an uplink whose <c>Register</c>
        /// wires a source for an undeclared topic takes its OWN, properly
        /// declared channels down with it, and a client subscribing to one of
        /// them is acked and then starved indefinitely.
        ///
        /// <para>Pinned deliberately as the current contract rather than "fixed"
        /// by refusing the subscribe: an ack after a fail-soft is load-bearing
        /// elsewhere (see <c>ChannelEngineTests.SubscribeCatchUpThrowRollsBack…</c>,
        /// whose whole point is that a subscriber joining after a poison payload
        /// has already fail-softed the uplink is still acked rather than
        /// orphaned). What is worth changing is the diagnosis path, not this
        /// behaviour: the engine already logs the registration throw with the
        /// offending topic, and that log line is the shortest route to the
        /// cause.</para>
        /// </summary>
        [Fact]
        public async Task AnUplinkThatRegistersAnUndeclaredSourceStarvesItsOwnDeclaredChannels()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new UndeclaredSourceTestUplink());
            engine.Start();
            try
            {
                Assert.False(engine.AvailabilityOf(UndeclaredSourceTestUplink.UplinkId).IsAvailable);

                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                // The declared topic subscribes and ACKS, giving the client every
                // reason to expect samples.
                var ack = await SubscribeAsync(client, UndeclaredSourceTestUplink.DeclaredTopic, Timeout);
                Assert.Equal("subscribed", ack.Name);

                // And then nothing, ever: the channel is never even considered.
                engine.TickAndWait(1.0, Snapshot(1.0), Timeout);
                engine.TickAndWait(2.0, Snapshot(2.0), Timeout);
                await client.AssertNoMessageArrivesAsync(Quiet);
                Assert.Equal(0, engine.ChannelCounters(UndeclaredSourceTestUplink.DeclaredTopic).Considered);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The general property the suite never asserted, and the reason it
        /// stayed green through a live outage of every Delayed topic on the
        /// stream: an ORDINARY Delayed channel (no freeze exemption, no dynamic
        /// namespace, the shape every <c>vessel.*</c> topic has) on a CONNECTED
        /// subject reaches a subscribed client, at live-game magnitudes: UT in
        /// the hundred-thousands, a sub-second light-time, a ~1 s cadence.
        ///
        /// <para>Every existing reveal-gate test drives the disconnect path or
        /// asserts reveal TIMING at toy UTs. None of them pinned plain
        /// "connected and delayed still arrives", so no test could tell the
        /// difference between a working delay model and a dead one. The TrueNow
        /// half is asserted alongside because TrueNow-alive/Delayed-dead was the
        /// live signature.</para>
        /// </summary>
        [Theory]
        [InlineData(0.0, 0.5, 1.0)]
        [InlineData(146206.029389718, 0.1546, 1.02)]
        public async Task AnOrdinaryDelayedChannelOnAConnectedSubjectReachesTheClient(double startUt, double delay, double step)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FreezeGateTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.CommsDelayTopic, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.LinkTopic, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.TrueNowTopic, Timeout);
                await SubscribeAsync(client, FreezeGateTestUplink.DelayedTopic, Timeout);

                for (var i = 0; i < 12; i++)
                {
                    var ut = startUt + (i * step);
                    engine.TickAndWait(
                        ut,
                        FreezeGateTestUplink.Snapshot(ut, connected: true, delay: delay, delayed: 10.0 + i, trueNow: 20.0 + i),
                        Timeout);
                }

                var frames = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(frames, f => f.Topic == FreezeGateTestUplink.TrueNowTopic && f.Payload != null);
                Assert.Contains(frames, f => f.Topic == FreezeGateTestUplink.DelayedTopic && f.Payload != null);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static KspSnapshot Snapshot(double ut) =>
            new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?> { ["declared"] = ut } };

        /// <summary>
        /// The shape that killed the <c>vessel</c> uplink live: a Manifest that
        /// declares its channels, and a <c>Register</c> that wires up a source
        /// for a topic it forgot to declare.
        /// </summary>
        private sealed class UndeclaredSourceTestUplink : ISitrepUplink
        {
            public const string UplinkId = "dead-uplink-test";
            public const string DeclaredTopic = "dead.declared";
            public const string UndeclaredTopic = "dead.undeclared";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = UplinkId,
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = DeclaredTopic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.Delayed,
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(DeclaredTopic, snapshot =>
                    snapshot != null && snapshot.Values.TryGetValue("declared", out var v) ? v : null);
                host.AddChannelSource(UndeclaredTopic, _ => 2.0);
            }
        }
    }
}
