using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// An event that happens to a craft with no link is held for a link that may
    /// never return, and the host says so, so a missing end or crash record can be
    /// told from one that was never raised.
    /// </summary>
    public class HeldEventLogTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private const string Topic = "held.event";

        private static KspSnapshot Tick(double ut, bool connected) => new KspSnapshot
        {
            Ut = ut,
            Values = new Dictionary<string, object?> { ["connected"] = connected },
        };

        [Fact]
        public async Task AnEventPublishedWhileTheCraftHasNoLinkIsLoggedAsHeld()
        {
            var log = new List<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.SetDiagnosticLog(line => { lock (log) { log.Add(line); } });
            var up = new Up();
            engine.RegisterUplink(up);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);
                engine.TickAndWait(1.0, Tick(1.0, connected: true), Timeout);
                engine.TickAndWait(2.0, Tick(2.0, connected: false), Timeout);

                up.Event!.Publish(new Dictionary<string, object?> { ["what"] = "end" }, 2.5);
                engine.TickAndWait(3.0, Tick(3.0, connected: false), Timeout);

                lock (log)
                {
                    Assert.Contains(log, line => line.Contains("held " + Topic) && line.Contains("out of contact"));
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task SeveralEventsHeldInARowAreLoggedAsOneLine()
        {
            var log = new List<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.SetDiagnosticLog(line => { lock (log) { log.Add(line); } });
            var up = new Up();
            engine.RegisterUplink(up);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);
                engine.TickAndWait(1.0, Tick(1.0, connected: true), Timeout);
                engine.TickAndWait(2.0, Tick(2.0, connected: false), Timeout);

                up.Event!.Publish(new Dictionary<string, object?> { ["what"] = "end" }, 2.5);
                up.Event!.Publish(new Dictionary<string, object?> { ["what"] = "crash" }, 2.6);
                up.Event!.Publish(new Dictionary<string, object?> { ["what"] = "split" }, 2.7);
                engine.TickAndWait(3.0, Tick(3.0, connected: false), Timeout);

                lock (log)
                {
                    Assert.Single(log, line => line.Contains("held " + Topic));
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AnEventPublishedWhileTheCraftHasALinkIsNotLoggedAsHeld()
        {
            var log = new List<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.SetDiagnosticLog(line => { lock (log) { log.Add(line); } });
            var up = new Up();
            engine.RegisterUplink(up);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);
                engine.TickAndWait(1.0, Tick(1.0, connected: true), Timeout);
                up.Event!.Publish(new Dictionary<string, object?> { ["what"] = "end" }, 1.5);
                engine.TickAndWait(2.0, Tick(2.0, connected: true), Timeout);

                lock (log)
                {
                    Assert.DoesNotContain(log, line => line.Contains("held " + Topic));
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class Up : ISitrepUplink
        {
            public IChannelPublisher? Event;

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "held-event-log",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Event,
                        Topic = Topic,
                        Delay = DelayRole.Delayed,
                        Delivery = Delivery.ReliableOrdered,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                Event = host.Publisher(Topic);
                host.SetConnectivitySource(s => s != null && s.Values.TryGetValue("connected", out var c) ? Convert.ToBoolean(c) : (bool?)null);
            }
        }
    }
}
