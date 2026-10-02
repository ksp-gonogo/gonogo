using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;
using Xunit.Abstractions;
using static Sitrep.Host.IntegrationTests.WsTestHarness;
using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A notice computed on a tick reaches the wire on that same tick, beside the
    /// sample it was computed from. A SCET alarm's fired notice is the case: it
    /// is decided in a sampled source's handle from the tick's own capture, and
    /// an operator at 100x reads a notice one tick late as the simulation having
    /// moved on by many game seconds before the banner appears.
    /// </summary>
    public class SameTickNoticeTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        private readonly ITestOutputHelper _output;

        public SameTickNoticeTests(ITestOutputHelper output) => _output = output;

        [Fact]
        public async Task ANoticeDecidedOnATickArrivesWithThatTicksSample()
        {
            const double fireAt = 4.0;
            var uplink = new SameTickNoticeTestUplink(fireAt);
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, SameTickNoticeTestUplink.SampleTopic, Timeout);
                await SubscribeAsync(client, SameTickNoticeTestUplink.NoticeTopic, Timeout);

                int? sampleTick = null;
                int? noticeTick = null;
                for (var tick = 1; tick <= 7; tick++)
                {
                    engine.TickAndWait(tick, new KspSnapshot { Ut = tick }, Timeout);
                    foreach (var (topic, ut) in await DrainAsync(client))
                    {
                        _output.WriteLine($"tick {tick}: {topic} ut={ut}");
                        if (ut != fireAt)
                        {
                            continue;
                        }
                        if (topic == SameTickNoticeTestUplink.SampleTopic)
                        {
                            sampleTick ??= tick;
                        }
                        if (topic == SameTickNoticeTestUplink.NoticeTopic)
                        {
                            noticeTick ??= tick;
                        }
                    }
                }

                Assert.NotNull(sampleTick);
                Assert.NotNull(noticeTick);
                Assert.Equal(sampleTick, noticeTick);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static async Task<List<(string Topic, double Ut)>> DrainAsync(TestClient client)
        {
            var seen = new List<(string, double)>();
            while (true)
            {
                string raw;
                try
                {
                    raw = await client.ReceiveAsync(Quiet);
                }
                catch (OperationCanceledException)
                {
                    return seen;
                }
                if (EnvelopeCodec.ParseServerMessage(raw) is StreamData data)
                {
                    using var doc = JsonDocument.Parse(raw);
                    var payload = doc.RootElement.GetProperty("payload");
                    var ut = payload.ValueKind == JsonValueKind.Number
                        ? payload.GetDouble()
                        : double.Parse(payload.GetRawText(), CultureInfo.InvariantCulture);
                    seen.Add((data.Topic, ut));
                }
            }
        }
    }

    /// <summary>
    /// A tick-driven sample of the game's UT, and a notice published from a
    /// sampled source's handle when that UT reaches <c>fireAt</c>: the shape
    /// <c>Gonogo.KSP.ScetAlarmUplink</c> has, KSP-free.
    /// </summary>
    internal sealed class SameTickNoticeTestUplink : ISitrepUplink
    {
        internal const string SampleTopic = "sametick.sample";
        internal const string NoticeTopic = "sametick.notice";

        private readonly double _fireAt;
        private IChannelPublisher? _notice;

        public SameTickNoticeTestUplink(double fireAt) => _fireAt = fireAt;

        public UplinkHealth Health() => UplinkHealth.Healthy;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "same-tick-notice-test",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = SampleTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Topic = NoticeTopic,
                    Delivery = Delivery.ReliableOrdered,
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(SampleTopic, snapshot => snapshot?.Ut);
            _notice = host.Publisher(NoticeTopic);
            host.AddSampledSource(snapshot => snapshot?.Ut, HandleOnCourier);
        }

        private void HandleOnCourier(object? captured)
        {
            if (captured is double ut && ut == _fireAt)
            {
                _notice?.Publish(ut, ut);
            }
        }
    }
}
