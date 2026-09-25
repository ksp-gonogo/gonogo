using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;
using Xunit.Abstractions;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Warping up under a long signal delay: a buffer filled at 1x is revealed
    /// at the warped rate, so one tick releases as many samples per channel as
    /// UT it advanced, up to the whole buffer.
    ///
    /// <para>Every released sample is its own Courier delivery per subscriber,
    /// read, serialised and handed to the outbox; nothing coalesces it before
    /// the outbox, and the outbox's per-topic coalescing only holds while the
    /// Courier outruns the pump. So a release is paid for per sample, and what
    /// these pin is that paying for it stays linear.</para>
    /// </summary>
    public class RevealBurstOnWarpUpTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(300);

        private readonly ITestOutputHelper _output;

        public RevealBurstOnWarpUpTests(ITestOutputHelper output)
        {
            _output = output;
        }

        /// <summary>
        /// Thirty light-minutes of 1x samples on forty channels with two
        /// subscribers, released in the single tick a 100,000x warp-up takes to
        /// sweep them: 144,000 deliveries. Measured at 767 ms; with a pending
        /// delivery found by scanning every other one it did not finish inside
        /// ten seconds.
        /// </summary>
        [Fact]
        public async Task AWholeBufferReleasedInOneTickDrainsInLinearTime()
        {
            const double delay = 1800;
            const int topics = 40;
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BurstProbeUplink(delay, extraStateTopics: topics));
            engine.Start();
            try
            {
                await using var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var second = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                for (var i = 0; i < topics; i++)
                {
                    await SubscribeAsync(first, BurstProbeUplink.ExtraTopic(i), Timeout);
                    await SubscribeAsync(second, BurstProbeUplink.ExtraTopic(i), Timeout);
                }

                var ut = 0.0;
                for (; ut <= delay + 50; ut += 1.0)
                {
                    engine.TickAndWait(ut, BurstProbeUplink.Snapshot(ut), Timeout);
                }
                await DrainAllStreamDataAsync(first, Quiet);
                await DrainAllStreamDataAsync(second, Quiet);

                var clock = System.Diagnostics.Stopwatch.StartNew();
                ut += SampleCadence.IntervalUtAt(100_000);
                engine.TickAndWait(ut, BurstProbeUplink.Snapshot(ut), Timeout);
                var burstMs = clock.ElapsedMilliseconds;
                var frames = await DrainAllStreamDataAsync(first, Quiet);
                _output.WriteLine($"warp-up tick: {burstMs} ms, {frames.Count} frames reached one client");

                // The time bound first, so a slow drain reads as one. Then the
                // whole buffer went in that tick: the newest 1x sample on every
                // channel reached the client.
                Assert.True(burstMs < 5_000, $"the warp-up tick took {burstMs} ms");
                foreach (var i in Enumerable.Range(0, topics))
                {
                    var newest = frames.Where(f => f.Topic == BurstProbeUplink.ExtraTopic(i)).Max(f => f.Meta.ValidAt);
                    Assert.Equal(delay + 50, newest);
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Ten light-minutes at 1x, then 100x on the warped sample cadence,
        /// which is <see cref="SampleCadence.IntervalUtAt"/> of 100 UT per tick.
        /// The ordered lane's contract is that every sample is delivered, so each
        /// tick puts the samples it swept on the wire, in order and once each,
        /// until the buffer is through.
        /// </summary>
        [Fact]
        public async Task TheOrderedLaneDeliversEveryReleasedSampleOnceAndInOrder()
        {
            const double delay = 600;
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new BurstProbeUplink(delay));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, BurstProbeUplink.OrderedTopic, Timeout);

                var ut = 0.0;
                for (; ut <= delay + 100; ut += 1.0)
                {
                    engine.TickAndWait(ut, BurstProbeUplink.Snapshot(ut), Timeout);
                }
                var delivered = (await DrainAllStreamDataAsync(client, Quiet))
                    .Where(f => f.Topic == BurstProbeUplink.OrderedTopic)
                    .Select(f => f.Meta.ValidAt)
                    .ToList();

                var step = SampleCadence.IntervalUtAt(100);
                var sweeps = (int)Math.Ceiling(delay / step) + 1;
                for (var i = 0; i < sweeps; i++)
                {
                    ut += step;
                    engine.TickAndWait(ut, BurstProbeUplink.Snapshot(ut), Timeout);
                }
                delivered.AddRange((await DrainAllStreamDataAsync(client, Quiet))
                    .Where(f => f.Topic == BurstProbeUplink.OrderedTopic)
                    .Select(f => f.Meta.ValidAt));
                _output.WriteLine($"{sweeps} ticks of {step} UT at 100x: {delivered.Count} ordered frames in all");

                var sampled = Enumerable.Range(0, (int)(delay + 101)).Select(t => (double)t).ToList();
                Assert.Equal(sampled, delivered.Take(sampled.Count).ToList());
                Assert.Equal(delivered.Distinct().Count(), delivered.Count);
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class BurstProbeUplink : ISitrepUplink
        {
            public const string OrderedTopic = "burst.ordered";

            private readonly double _delay;
            private readonly int _extra;

            public BurstProbeUplink(double delay, int extraStateTopics = 0)
            {
                _delay = delay;
                _extra = extraStateTopics;
                var channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = ChannelEngine.CommsDelayTopic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.TrueNow,
                    },
                    Declare(OrderedTopic, Delivery.ReliableOrdered),
                };
                for (var i = 0; i < extraStateTopics; i++)
                {
                    channels.Add(Declare(ExtraTopic(i), Delivery.LossyLatest));
                }
                Manifest = new UplinkManifest { Id = "burst-probe", Version = "1.0.0", Channels = channels };
            }

            public static string ExtraTopic(int i) => "burst.state." + i;

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; }

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(ChannelEngine.CommsDelayTopic, _ => new CommsDelay
                {
                    OneWaySeconds = _delay,
                    Source = CommsDelaySource.SignalDelay,
                });
                host.AddChannelSource(OrderedTopic, snapshot => snapshot?.Ut);
                for (var i = 0; i < _extra; i++)
                {
                    host.AddChannelSource(ExtraTopic(i), snapshot => new Dictionary<string, object?>
                    {
                        ["ut"] = snapshot?.Ut,
                        ["a"] = 1.0,
                        ["b"] = "text",
                        ["c"] = new List<object?> { 1.0, 2.0, 3.0 },
                    });
                }
            }

            public static KspSnapshot Snapshot(double ut) =>
                new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?>() };

            private static ChannelDeclaration Declare(string topic, Delivery delivery) => new ChannelDeclaration
            {
                Topic = topic,
                Delivery = delivery,
                Emission = new EmissionPolicy(keyframeIntervalUt: 100_000, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.Delayed,
            };
        }
    }
}
