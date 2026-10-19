using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host.Flight;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A craft recovered while it has no link is news the ground raises itself,
    /// so it reaches the centre at once, while a crash of the same craft stays
    /// held for a link that may never return.
    /// </summary>
    public class RecoveryNewsOutOfContactTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        private static KspSnapshot Tick(double ut, bool connected) => new KspSnapshot
        {
            Ut = ut,
            Values = new Dictionary<string, object?> { ["connected"] = connected },
        };

        private static FlightEnded Ended(FlightEndReason reason) => new FlightEnded
        {
            FlightId = "f1",
            VesselId = "f1",
            VesselName = "Probe",
            Reason = reason,
            Ut = 2.5,
        };

        [Fact]
        public async Task ARecoveryOutOfContactReachesTheCentreAtOnce()
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
                await SubscribeAsync(client, FlightTopics.EndedTopic, Timeout);
                engine.TickAndWait(1.0, Tick(1.0, connected: true), Timeout);
                engine.TickAndWait(2.0, Tick(2.0, connected: false), Timeout);

                up.Ended!.Publish(Ended(FlightEndReason.Recovered), 2.5);
                engine.TickAndWait(3.0, Tick(3.0, connected: false), Timeout);

                var data = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Equal(FlightTopics.EndedTopic, data.Topic);
                lock (log)
                {
                    Assert.DoesNotContain(log, line => line.Contains("held " + FlightTopics.EndedTopic));
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ACrashOutOfContactStaysHeld()
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
                await SubscribeAsync(client, FlightTopics.EndedTopic, Timeout);
                engine.TickAndWait(1.0, Tick(1.0, connected: true), Timeout);
                engine.TickAndWait(2.0, Tick(2.0, connected: false), Timeout);

                up.Ended!.Publish(Ended(FlightEndReason.Crashed), 2.5);
                engine.TickAndWait(3.0, Tick(3.0, connected: false), Timeout);

                lock (log)
                {
                    Assert.Contains(log, line => line.Contains("held " + FlightTopics.EndedTopic) && line.Contains("out of contact"));
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class Up : ISitrepUplink
        {
            public IChannelPublisher? Ended;

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "recovery-news-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Event,
                        Topic = FlightTopics.EndedTopic,
                        Delay = DelayRole.Delayed,
                        Delivery = Delivery.ReliableOrdered,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                Ended = host.Publisher(FlightTopics.EndedTopic);
                host.SetConnectivitySource(s => s != null && s.Values.TryGetValue("connected", out var c) ? Convert.ToBoolean(c) : (bool?)null);
            }
        }
    }
}
