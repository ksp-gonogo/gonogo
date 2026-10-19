using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A topic with a cadence override is built at its own rate while every other
    /// topic keeps one build per UT second, and the cost of each is accounted on
    /// its own, through a real engine and a real subscriber.
    /// </summary>
    public class TopicCadenceEngineTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public async Task AnOverriddenTopicIsBuiltAtItsOwnRateAndTheOthersKeepOneASecond()
        {
            var probe = new CadenceProbeUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(probe);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, CadenceProbeUplink.FastTopic, Timeout);
                await SubscribeAsync(client, CadenceProbeUplink.SteadyTopic, Timeout);

                Assert.True(engine.TrySetTopicRate(CadenceProbeUplink.FastTopic, 10, out var applied), applied);
                Assert.Equal(CadenceProbeUplink.FastTopic + "=10 Hz", applied);

                // A tick every tenth of a UT second for ten seconds: the gate's
                // interval once a topic asks for ten a second.
                for (var i = 0; i <= 100; i++)
                {
                    engine.TickAndWait(1000.0 + i * 0.1, CadenceProbeUplink.Snapshot(), Timeout);
                }

                Assert.InRange(probe.FastBuilds, 100, 101);
                Assert.InRange(probe.SteadyBuilds, 10, 11);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task WithNoOverrideEveryTickBuildsEveryTopicAsItAlwaysDid()
        {
            var probe = new CadenceProbeUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(probe);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, CadenceProbeUplink.FastTopic, Timeout);
                await SubscribeAsync(client, CadenceProbeUplink.SteadyTopic, Timeout);

                for (var i = 0; i < 10; i++)
                {
                    engine.TickAndWait(1000.0 + i, CadenceProbeUplink.Snapshot(), Timeout);
                }

                Assert.Equal(10, probe.FastBuilds);
                Assert.Equal(10, probe.SteadyBuilds);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ATopicWithNoPullChannelIsRefused()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new CadenceProbeUplink());
            engine.Start();
            try
            {
                Assert.False(engine.TrySetTopicRate("no.such.topic", 5, out var message));
                Assert.Contains("no.such.topic", message);
                Assert.False(engine.Cadence.HasOverrides);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task TheCostReportAccountsEachTopicOnItsOwn()
        {
            var probe = new CadenceProbeUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(probe);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, CadenceProbeUplink.FastTopic, Timeout);
                await SubscribeAsync(client, CadenceProbeUplink.SteadyTopic, Timeout);
                engine.TrySetTopicRate(CadenceProbeUplink.FastTopic, 10, out _);
                engine.PublishStats.ReportIntervalSeconds = 3600;

                for (var i = 0; i <= 50; i++)
                {
                    engine.TickAndWait(1000.0 + i * 0.1, CadenceProbeUplink.Snapshot(), Timeout);
                }

                var lines = engine.PublishStats.TryTakeReport(
                    Stopwatch.GetTimestamp() + 3600L * Stopwatch.Frequency, engine.Cadence.Describe());

                Assert.NotNull(lines);
                var fast = Array.Find(lines!, l => l.Contains(CadenceProbeUplink.FastTopic + ":"));
                var steady = Array.Find(lines!, l => l.Contains(CadenceProbeUplink.SteadyTopic + ":"));
                Assert.NotNull(fast);
                Assert.NotNull(steady);
                Assert.Contains("built 51 ", fast);
                Assert.Contains("built 6 ", steady);
                Assert.DoesNotContain("frames 0 ", fast);
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class CadenceProbeUplink : ISitrepUplink
        {
            public const string FastTopic = "cadence.fast";
            public const string SteadyTopic = "cadence.steady";

            private int _fastBuilds;
            private int _steadyBuilds;

            public int FastBuilds => Volatile.Read(ref _fastBuilds);

            public int SteadyBuilds => Volatile.Read(ref _steadyBuilds);

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "test-cadence-probe",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration> { Declare(FastTopic), Declare(SteadyTopic) },
            };

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(FastTopic, _ => (double)Interlocked.Increment(ref _fastBuilds));
                host.AddChannelSource(SteadyTopic, _ => (double)Interlocked.Increment(ref _steadyBuilds));
            }

            public static KspSnapshot Snapshot() => new KspSnapshot
            {
                Values = new Dictionary<string, object?>(),
            };

            private static ChannelDeclaration Declare(string topic) => new ChannelDeclaration
            {
                Kind = SampleKind.Continuous,
                Topic = topic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 100_000, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.TrueNow,
            };
        }
    }
}
