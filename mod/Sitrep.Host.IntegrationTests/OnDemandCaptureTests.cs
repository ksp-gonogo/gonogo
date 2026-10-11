using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Core;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A source that captures per body on demand (an Uplink's per-body coverage
    /// grids) decides which bodies to capture from
    /// <see cref="IUplinkHost.IsAnyTopicSubscribed"/>. That predicate reads the
    /// engine's own subscription set, so the trigger is a plain wire
    /// subscription from any consumer: an SDK client, a script, a station's
    /// relay. No widget is involved anywhere here.
    /// </summary>
    public class OnDemandCaptureTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public async Task APlainSubscriptionToOneBodysTopicIsWhatGetsThatBodyCaptured()
        {
            var uplink = new PerBodyCaptureUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
                Assert.Empty(uplink.Captured);

                var topic = PerBodyCaptureUplink.Prefix + "Minmus.8";
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, topic, Timeout);
                engine.TickAndWait(2.0, new KspSnapshot { Ut = 2.0 }, Timeout);

                Assert.Equal(new[] { "Minmus" }, uplink.Captured.Distinct());
                var frame = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal(topic, frame.Topic);

                await client.SendAsync(EnvelopeCodec.WriteUnsubscribe(new Unsubscribe { Topic = topic }));
                var deadline = Stopwatch.StartNew();
                while (engine.IsAnyTopicSubscribed(topic))
                {
                    Assert.True(deadline.Elapsed < Timeout, "the unsubscribe never reached the engine");
                    await Task.Delay(10);
                }
                while (uplink.Captured.TryDequeue(out _)) { }
                engine.TickAndWait(3.0, new KspSnapshot { Ut = 3.0 }, Timeout);

                Assert.Empty(uplink.Captured);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>Captures each body some topic of which is subscribed, the way a per-body coverage source chooses its bodies.</summary>
        private sealed class PerBodyCaptureUplink : ISitrepUplink
        {
            public const string Prefix = "probe.coverage.";
            private static readonly string[] Bodies = { "Kerbin", "Mun", "Minmus" };

            private IUplinkHost? _host;
            private IDynamicChannelSource? _source;

            public ConcurrentQueue<string> Captured { get; } = new ConcurrentQueue<string>();

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "on-demand-capture-probe",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>(),
            };

            public void Register(IUplinkHost host)
            {
                _host = host;
                _source = host.RegisterDynamicNamespace(Prefix, new ChannelDeclaration
                {
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    Requires = Requirement.None,
                });
                host.AddSampledSource(CaptureOnMain, HandleOnCourier, Prefix);
            }

            private object? CaptureOnMain(KspSnapshot? snapshot)
            {
                var watched = Bodies.Where(body => _host!.IsAnyTopicSubscribed(Prefix + body + ".")).ToList();
                foreach (var body in watched) Captured.Enqueue(body);
                return watched.Count == 0 ? null : (watched, snapshot?.Ut ?? 0.0);
            }

            private void HandleOnCourier(object? captured)
            {
                if (captured is not ValueTuple<List<string>, double> capture) return;
                foreach (var body in capture.Item1)
                {
                    _source!.Publisher(body + ".8").Publish(new Dictionary<string, object?> { ["body"] = body }, capture.Item2);
                }
            }
        }
    }
}
