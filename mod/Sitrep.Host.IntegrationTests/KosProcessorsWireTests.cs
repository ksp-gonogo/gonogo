using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Regression for the <c>kos.processors</c> "subscribed but never any
    /// stream-data" bug (live raw-WS capture): a client subscribing to
    /// <c>kos.processors</c> got the <c>subscribed</c> ack but ZERO
    /// <c>stream-data</c> frames whenever the vessel actually had kOS CPUs.
    ///
    /// <para>Root cause was NOT the delay clock or the keyframe-on-subscribe
    /// path (both fine — an EMPTY list delivered as <c>[]</c>): the channel
    /// payload was a <c>List&lt;KosProcessorInfo&gt;</c>, and <c>KosProcessorInfo</c>
    /// had no wire-flatten in <see cref="Sitrep.Core.Serialization.JsonWriter"/>,
    /// so a NON-EMPTY list threw <c>NotSupportedException</c> at the wire boundary
    /// and fail-softed to nothing — exactly the comms.delay bug the
    /// <c>AppendCommsDelay</c> case had already fixed for that POCO.</para>
    ///
    /// <para>As of the kos migration (2026-07-18), the real
    /// <c>Gonogo.KosUplink.KosExtension.HandleProcessors</c> self-flattens
    /// each <c>KosProcessorInfo</c> via <c>KosProcessorInfoBuilder.Build</c>
    /// before publishing — mirrored by hand below (this project doesn't take
    /// a dependency on the net48 <c>GonogoKosUplink</c> assembly) rather than
    /// publishing the raw POCO. This still proves a non-empty processor list
    /// reaches a raw client end-to-end, now via the self-flattened
    /// dictionary shape.</para>
    /// </summary>
    public class KosProcessorsWireTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        // Mirrors Gonogo.KosUplink.KosExtension exactly: a Delayed channel backed by
        // Publisher + AddSampledSource, whose captured payload is a
        // List<Dictionary<string, object?>> (KosProcessorInfoBuilder's wire
        // shape) published on the Courier handle.
        internal sealed class ProcessorsStyleUplink : ISitrepUplink
        {
            public const string Topic = "kos.processors";
            private IChannelPublisher? _pub;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "kos-proc-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.Delayed,
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                _pub = host.Publisher(Topic);
                host.AddSampledSource(Capture, Handle, Topic);
            }

            // Hand-mirrors KosProcessorInfoBuilder.Build's wire shape — see
            // this class's doc comment for why it's not a direct reference.
            private object? Capture(KspSnapshot? snapshot) => new List<Dictionary<string, object?>>
            {
                new Dictionary<string, object?>
                {
                    ["coreId"] = 7,
                    ["tag"] = "mainframe",
                    ["hasBooted"] = true,
                    ["bootFilePath"] = null,
                    ["processorMode"] = "READY",
                },
            };

            private void Handle(object? captured)
            {
                if (captured is List<Dictionary<string, object?>> list)
                {
                    _pub!.Publish(list, 0.0);
                }
            }
        }

        [Fact]
        public async Task NonEmptyProcessorListReachesARawClient()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new ProcessorsStyleUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ProcessorsStyleUplink.Topic, Timeout);

                // Advancing-UT ticks, like a live flight. The sampled capture runs
                // once subscribed, its publish is enqueued, and the second tick's
                // clock advance flushes the reveal + delivery.
                engine.TickAndWait(1000.0, new KspSnapshot { Ut = 1000.0 }, Timeout);
                engine.TickAndWait(1001.0, new KspSnapshot { Ut = 1001.0 }, Timeout);
                engine.TickAndWait(1002.0, new KspSnapshot { Ut = 1002.0 }, Timeout);

                var delivered = await DrainToLatestStreamDataAsync(client, TimeSpan.FromMilliseconds(500));
                Assert.NotNull(delivered);
                Assert.Equal(ProcessorsStyleUplink.Topic, delivered!.Topic);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
