using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Core;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Engine-level tests for <see cref="ChannelEngine"/> that go BEYOND the
    /// single <c>system.bodies</c> topic <see cref="ReplayToWebSocketEndToEndTests"/>
    /// exercises — proving the multi-topic/multi-command generalization
    /// itself (not just that the retrofitted <c>system.bodies</c> channel
    /// still behaves like <c>GonogoBodiesServer</c> did). See
    /// <c>local_docs/telemetry-mod/extension-sdk-contract-design.md</c> §1.1
    /// (delivery classes) and §4.3 (the <c>delayed</c> command flag).
    /// </summary>
    public class ChannelEngineTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        [Fact]
        public async Task MultipleRegisteredChannelsEmitAndSubscriptionGateIndependently()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterExtension(new MultiChannelTestExtension());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                // Subscribe to "chan.a" only.
                await SubscribeAsync(client, "chan.a", Timeout);

                // A tick carrying data for BOTH channels: only "chan.a" has a
                // subscriber, so only it should ever reach the emitter --
                // the exact outer/inner gate SubscriptionRegistry/ChannelEmitter
                // already prove individually, now proven per-topic through
                // the multi-channel engine.
                engine.TickAndWait(0.0, MultiChannelTestExtension.Snapshot(a: 1, b: 100), Timeout);

                Assert.Equal(1, engine.ChannelCounters("chan.a").Considered);
                Assert.Equal(1, engine.ChannelCounters("chan.a").Emitted);
                Assert.Equal(0, engine.ChannelCounters("chan.b").Considered);
                Assert.Equal(0, engine.ChannelCounters("chan.b").Emitted);

                var deliveredA = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal("chan.a", deliveredA.Topic);
                Assert.Equal(1.0, Convert.ToDouble(deliveredA.Payload));

                // Nothing for chan.b - it was never subscribed.
                await client.AssertNoMessageArrivesAsync(TimeSpan.FromMilliseconds(300));

                // Now subscribe to "chan.b" too and tick again with DIFFERENT
                // values for both - both channels must emit independently
                // (distinct channelId state inside the shared ChannelEmitter/
                // SubscriptionRegistry), and the newly-subscribed "chan.b"
                // gets its own subscribe-triggered keyframe rather than
                // waiting on "chan.a"'s cadence.
                await SubscribeAsync(client, "chan.b", Timeout);
                engine.TickAndWait(1.0, MultiChannelTestExtension.Snapshot(a: 2, b: 200), Timeout);

                Assert.Equal(2, engine.ChannelCounters("chan.a").Emitted);
                Assert.Equal(1, engine.ChannelCounters("chan.b").Emitted);

                var seenTopics = new HashSet<string>();
                for (var i = 0; i < 2; i++)
                {
                    var delivered = await ReceiveStreamDataAsync(client, Timeout);
                    seenTopics.Add(delivered.Topic);
                }
                Assert.Contains("chan.a", seenTopics);
                Assert.Contains("chan.b", seenTopics);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Proves the <see cref="Delivery"/> split: a <c>reliable-ordered</c>
        /// channel's outbox lane is an unbounded FIFO queue that is NEVER
        /// overwritten, so every emitted sample WILL eventually reach the
        /// wire regardless of how the independent outbox pump thread happens
        /// to interleave with the rapid-fire producer below (a genuine
        /// two-thread race — see <see cref="DrainToLatestStreamDataAsync"/>'s
        /// doc comment for the same race acknowledged elsewhere in this
        /// project) — that guarantee is what this test asserts on, not
        /// "coalescing didn't happen this run" (which would be flaky). The
        /// SAME rapid-fire ticks drive a <c>lossy-latest</c> channel too:
        /// its outbox lane CAN coalesce multiple pending writes down to
        /// fewer frames, so this test only asserts the two structurally
        /// guaranteed facts about it: it never receives MORE frames than the
        /// reliable channel (both are Decide-gated identically, so at most
        /// one emission per tick either way), and the LAST value observed
        /// is always the final tick's value.
        /// </summary>
        [Fact]
        public async Task ReliableOrderedNeverDropsAFrameWhileLossyLatestMayCoalesceUnderRapidEmission()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterExtension(new DeliveryClassTestExtension());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, DeliveryClassTestExtension.ReliableTopic, Timeout);
                await SubscribeAsync(client, DeliveryClassTestExtension.LossyTopic, Timeout);

                const int sampleCount = 5;
                for (var i = 0; i < sampleCount; i++)
                {
                    // Both channels read the SAME "value" key, so every tick
                    // emits an identical value sequence on both - only the
                    // DELIVERY LANE differs.
                    engine.TickAndWait(i, DeliveryClassTestExtension.Snapshot(i), Timeout);
                }

                // Structural guarantee, independent of scheduling: the emitter
                // considered/emitted exactly `sampleCount` samples on BOTH
                // channels (Decide-gating doesn't know about delivery class).
                Assert.Equal(sampleCount, engine.ChannelCounters(DeliveryClassTestExtension.ReliableTopic).Emitted);
                Assert.Equal(sampleCount, engine.ChannelCounters(DeliveryClassTestExtension.LossyTopic).Emitted);

                // ONE drain covering both subscribed topics - a second,
                // separate drain call would find the channel already
                // exhausted by the first (see DrainAllStreamDataAsync's doc
                // comment).
                var allFrames = await DrainAllStreamDataAsync(client, TimeSpan.FromMilliseconds(500));
                var reliableFrames = allFrames.FindAll(f => f.Topic == DeliveryClassTestExtension.ReliableTopic);
                var lossyFrames = allFrames.FindAll(f => f.Topic == DeliveryClassTestExtension.LossyTopic);

                // Reliable-ordered: EVERY emitted sample reaches the wire, in
                // order, never coalesced - the FIFO queue guarantees this
                // regardless of the outbox pump's timing.
                Assert.Equal(sampleCount, reliableFrames.Count);
                for (var i = 0; i < sampleCount; i++)
                {
                    Assert.Equal((double)i, Convert.ToDouble(reliableFrames[i].Payload));
                }

                // Lossy-latest: at most as many frames as reliable (never
                // MORE - same Decide gate), and the final value always wins -
                // whether or not any intermediate frame happened to survive
                // the race is deliberately NOT asserted on (would be flaky).
                Assert.True(lossyFrames.Count >= 1 && lossyFrames.Count <= sampleCount);
                Assert.Equal((double)(sampleCount - 1), Convert.ToDouble(lossyFrames[^1].Payload));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void DelayedFalseCommandBypassesTheCourierDelayWhileDelayedTrueWaitsForIt()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 5);
            engine.RegisterExtension(new DelayFlagTestExtension());
            engine.Start();
            try
            {
                var infraResolved = false;
                object? infraResult = null;
                engine.DispatchCommandAndWait(
                    DelayFlagTestExtension.InfraCommand, "x", "vantage-1",
                    result => { infraResolved = true; infraResult = result; },
                    TimeSpan.FromMilliseconds(500));

                // Ground-infrastructure command: resolves on the SAME
                // job-processing step, no Tick/clock-advance needed at all -
                // the Courier's 5s-each-way delay never comes into it.
                Assert.True(infraResolved, "delayed:false command should resolve without any clock advance");
                Assert.Equal("pong:x", infraResult);

                var vesselResolved = false;
                object? vesselResult = null;
                engine.DispatchCommandAndWait(
                    DelayFlagTestExtension.VesselCommand, "y", "vantage-1",
                    result => { vesselResolved = true; vesselResult = result; },
                    TimeSpan.FromMilliseconds(300));

                // Still pending: a normal (delayed:true) command rides the
                // Courier's uplink+downlink delay (2 * 5s = 10s of UT), and
                // no Tick has advanced the clock at all yet.
                Assert.False(vesselResolved, "delayed:true command must not resolve before the Courier's scheduled UT");

                // Advance the clock past the full round trip (dispatch UT 0
                // + 5s uplink + 5s downlink = 10) - the response fires from
                // the ORIGINAL dispatch's still-pending callback, proving it
                // was genuinely delayed rather than lost.
                engine.TickAndWait(10.0, null, Timeout);

                Assert.True(vesselResolved);
                Assert.Equal("pong:y", vesselResult);
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class MultiChannelTestExtension : ISitrepExtension
        {
            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = "test-multi",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = "chan.a",
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                    new ChannelDeclaration
                    {
                        Topic = "chan.b",
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            public void Register(IExtensionHost host)
            {
                host.AddChannelSource("chan.a", s => s != null && s.Values.TryGetValue("a", out var v) ? v : null);
                host.AddChannelSource("chan.b", s => s != null && s.Values.TryGetValue("b", out var v) ? v : null);
            }

            public static KspSnapshot Snapshot(double a, double b)
            {
                return new KspSnapshot { Values = new Dictionary<string, object?> { ["a"] = a, ["b"] = b } };
            }
        }

        private sealed class DeliveryClassTestExtension : ISitrepExtension
        {
            public const string ReliableTopic = "reliable.topic";
            public const string LossyTopic = "lossy.topic";

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = "test-delivery",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = ReliableTopic,
                        Delivery = Delivery.ReliableOrdered,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                    new ChannelDeclaration
                    {
                        Topic = LossyTopic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            public void Register(IExtensionHost host)
            {
                host.AddChannelSource(ReliableTopic, ReadValue);
                host.AddChannelSource(LossyTopic, ReadValue);
            }

            private static object? ReadValue(KspSnapshot? s) =>
                s != null && s.Values.TryGetValue("value", out var v) ? v : null;

            public static KspSnapshot Snapshot(double value)
            {
                return new KspSnapshot { Values = new Dictionary<string, object?> { ["value"] = value } };
            }
        }

        private sealed class DelayFlagTestExtension : ISitrepExtension
        {
            public const string InfraCommand = "infra.ping";
            public const string VesselCommand = "vessel.ping";

            public ExtensionManifest Manifest { get; } = new ExtensionManifest
            {
                Id = "test-delay-flag",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = InfraCommand, Delayed = false },
                    new CommandDeclaration { Command = VesselCommand, Delayed = true },
                },
            };

            public void Register(IExtensionHost host)
            {
                host.AddCommandHandler<string, string>(InfraCommand, args => "pong:" + args);
                host.AddCommandHandler<string, string>(VesselCommand, args => "pong:" + args);
            }
        }
    }
}
