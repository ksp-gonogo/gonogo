using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A connection asking for the fast tier on a topic puts that topic, and only
    /// that topic, on the fast rate for as long as some connection still asks,
    /// through a real engine and real subscribers.
    /// </summary>
    public class DataRateDemandTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public async Task AFastTopicIsBuiltTenTimesASecondAndTheOthersOnce()
        {
            var probe = new RateProbeUplink();
            using var engine = StartEngine(probe);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, RateProbeUplink.FastTopic, Timeout);
                await SubscribeAsync(client, RateProbeUplink.SteadyTopic, Timeout);
                await SetRateAsync(client, RateProbeUplink.FastTopic, DataRateTierNames.Fast);
                await WaitForDemandAsync(engine, RateProbeUplink.FastTopic, DataRateTierNames.Fast);

                Assert.Equal(0.1, engine.Cadence.FastestIntervalUt, 9);
                probe.Reset();
                for (var i = 0; i <= 100; i++)
                {
                    engine.TickAndWait(1000.0 + i * 0.1, RateProbeUplink.Snapshot(), Timeout);
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
        public async Task ACapHoldsTheFastTierDownOnlyWhileItsConnectionIsOpen()
        {
            var probe = new RateProbeUplink();
            using var engine = StartEngine(probe);
            try
            {
                await using var asker = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(asker, RateProbeUplink.FastTopic, Timeout);
                await SetRateAsync(asker, RateProbeUplink.FastTopic, DataRateTierNames.Fast);
                await WaitForDemandAsync(engine, RateProbeUplink.FastTopic, DataRateTierNames.Fast);

                var capper = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await capper.SendAsync(EnvelopeCodec.WriteCapRate(new CapRate { Tier = DataRateTierNames.Fast, SamplesPerSecond = 5 }));
                await WaitForFastRateAsync(engine, 5);
                probe.Reset();
                for (var i = 0; i <= 100; i++)
                {
                    engine.TickAndWait(3000.0 + i * 0.1, RateProbeUplink.Snapshot(), Timeout);
                }
                Assert.InRange(probe.FastBuilds, 50, 51);

                await capper.DisposeAsync();
                await WaitForFastRateAsync(engine, DataRateTiers.DefaultFastSamplesPerSecond);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ACapNeverTakesATierBelowTheBaseRateAndTheLowestCapWins()
        {
            var tiers = new DataRateTiers();

            Assert.True(tiers.TrySetCap("a", DataRateTierNames.Fast, 5, out _));
            Assert.True(tiers.TrySetCap("b", DataRateTierNames.Fast, 0.25, out _));
            Assert.Equal(1.0, tiers.SamplesPerSecond(DataRateTierNames.Fast));
            Assert.True(tiers.TrySetCap("b", DataRateTierNames.Fast, null, out _));
            Assert.Equal(5.0, tiers.SamplesPerSecond(DataRateTierNames.Fast));
            tiers.ClearCaps("a");
            Assert.Equal(DataRateTiers.DefaultFastSamplesPerSecond, tiers.SamplesPerSecond(DataRateTierNames.Fast));
            Assert.False(tiers.TrySetCap("a", DataRateTierNames.Base, 5, out _));
            Assert.False(tiers.TrySetCap("a", DataRateTierNames.Fast, 0, out _));
        }

        /// <summary>Waits until the fast tier carries <paramref name="samplesPerSecond"/>.</summary>
        private static async Task WaitForFastRateAsync(ChannelEngine engine, double samplesPerSecond)
        {
            var deadline = DateTime.UtcNow + Timeout;
            while (engine.Cadence.Tiers.SamplesPerSecond(DataRateTierNames.Fast) != samplesPerSecond)
            {
                if (DateTime.UtcNow > deadline)
                {
                    throw new TimeoutException("the fast tier never reached " + samplesPerSecond + " a second");
                }
                await Task.Delay(10);
            }
        }

        [Fact]
        public async Task RetuningTheFastTierChangesTheRateWithoutAnyoneAskingAgain()
        {
            var probe = new RateProbeUplink();
            using var engine = StartEngine(probe);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, RateProbeUplink.FastTopic, Timeout);
                await SetRateAsync(client, RateProbeUplink.FastTopic, DataRateTierNames.Fast);
                await WaitForDemandAsync(engine, RateProbeUplink.FastTopic, DataRateTierNames.Fast);

                Assert.True(engine.Cadence.Tiers.TrySetSamplesPerSecond(DataRateTierNames.Fast, 5, out var refusal), refusal);
                probe.Reset();
                for (var i = 0; i <= 100; i++)
                {
                    engine.TickAndWait(2000.0 + i * 0.1, RateProbeUplink.Snapshot(), Timeout);
                }

                Assert.InRange(probe.FastBuilds, 50, 51);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task TheTopicStaysFastUntilTheLastConnectionAskingLeaves()
        {
            using var engine = StartEngine(new RateProbeUplink());
            try
            {
                await using var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                var second = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(first, RateProbeUplink.FastTopic, Timeout);
                await SubscribeAsync(second, RateProbeUplink.FastTopic, Timeout);
                await SetRateAsync(first, RateProbeUplink.FastTopic, DataRateTierNames.Fast);
                await SetRateAsync(second, RateProbeUplink.FastTopic, DataRateTierNames.Fast);
                await WaitForDemandAsync(engine, RateProbeUplink.FastTopic, DataRateTierNames.Fast);

                await second.DisposeAsync();
                engine.TickAndWait(3000.0, RateProbeUplink.Snapshot(), Timeout);
                await Task.Delay(100);
                engine.TickAndWait(3000.1, RateProbeUplink.Snapshot(), Timeout);
                Assert.Equal(RateProbeUplink.FastTopic, Assert.Single(engine.Cadence.DemandReport()).Topic);

                await first.SendAsync(EnvelopeCodec.WriteUnsubscribe(new Unsubscribe { Topic = RateProbeUplink.FastTopic }));
                await WaitForDemandAsync(engine, RateProbeUplink.FastTopic, null);
                Assert.Equal(SampleCadence.IntervalUt, engine.Cadence.FastestIntervalUt);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ADisconnectWithdrawsTheConnectionsDemand()
        {
            using var engine = StartEngine(new RateProbeUplink());
            try
            {
                var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, RateProbeUplink.FastTopic, Timeout);
                await SetRateAsync(client, RateProbeUplink.FastTopic, DataRateTierNames.Fast);
                await WaitForDemandAsync(engine, RateProbeUplink.FastTopic, DataRateTierNames.Fast);

                await client.DisposeAsync();
                await WaitForDemandAsync(engine, RateProbeUplink.FastTopic, null);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AskingBaseWithdrawsTheDemand()
        {
            using var engine = StartEngine(new RateProbeUplink());
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, RateProbeUplink.FastTopic, Timeout);
                await SetRateAsync(client, RateProbeUplink.FastTopic, DataRateTierNames.Fast);
                await WaitForDemandAsync(engine, RateProbeUplink.FastTopic, DataRateTierNames.Fast);

                await SetRateAsync(client, RateProbeUplink.FastTopic, DataRateTierNames.Base);
                await WaitForDemandAsync(engine, RateProbeUplink.FastTopic, null);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ARateForATopicTheConnectionHasNotSubscribedChangesNothing()
        {
            using var engine = StartEngine(new RateProbeUplink());
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, RateProbeUplink.SteadyTopic, Timeout);
                await SetRateAsync(client, RateProbeUplink.FastTopic, DataRateTierNames.Fast);
                await SetRateAsync(client, RateProbeUplink.SteadyTopic, DataRateTierNames.Fast);
                await WaitForDemandAsync(engine, RateProbeUplink.SteadyTopic, DataRateTierNames.Fast);

                Assert.Equal(RateProbeUplink.SteadyTopic, Assert.Single(engine.Cadence.DemandReport()).Topic);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task TheStreamSaysWhatEachTierIsAndWhichTopicsAreFast()
        {
            using var engine = StartEngine(new RateProbeUplink());
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, RateProbeUplink.FastTopic, Timeout);
                await SubscribeAsync(client, "system.dataRates", Timeout);
                await SetRateAsync(client, RateProbeUplink.FastTopic, DataRateTierNames.Fast);
                await WaitForDemandAsync(engine, RateProbeUplink.FastTopic, DataRateTierNames.Fast);

                string? report = null;
                var deadline = DateTime.UtcNow + Timeout;
                var ut = 4000.0;
                while (report == null && DateTime.UtcNow < deadline)
                {
                    engine.TickAndWait(ut, RateProbeUplink.Snapshot(), Timeout);
                    ut += 1.0;
                    try
                    {
                        var raw = await client.ReceiveAsync(TestBudgets.ReaderPoll);
                        if (raw.Contains("\"system.dataRates\"") && raw.Contains(RateProbeUplink.FastTopic))
                        {
                            report = raw;
                        }
                    }
                    catch (OperationCanceledException)
                    {
                    }
                }

                Assert.NotNull(report);
                Assert.Contains("{\"tier\":\"base\",\"samplesPerSecond\":1}", report);
                Assert.Contains("{\"tier\":\"fast\",\"samplesPerSecond\":10}", report);
                Assert.Contains("{\"topic\":\"" + RateProbeUplink.FastTopic + "\",\"tier\":\"fast\",\"samplesPerSecond\":10}", report);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void TheBaseTierCannotBeRetuned()
        {
            var tiers = new DataRateTiers();
            Assert.False(tiers.TrySetSamplesPerSecond(DataRateTierNames.Base, 5, out _));
            Assert.False(tiers.TrySetSamplesPerSecond(DataRateTierNames.Fast, 0, out _));
            Assert.False(tiers.TrySetSamplesPerSecond("ludicrous", 5, out _));
            Assert.Equal(1.0, tiers.SamplesPerSecond(DataRateTierNames.Base));
            Assert.Equal(DataRateTiers.DefaultFastSamplesPerSecond, tiers.SamplesPerSecond(DataRateTierNames.Fast));
        }

        private static ChannelEngine StartEngine(RateProbeUplink probe)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(probe);
            engine.Start();
            return engine;
        }

        private static Task SetRateAsync(TestClient client, string topic, string tier) =>
            client.SendAsync(EnvelopeCodec.WriteSetRate(new SetRate { Topic = topic, Tier = tier }));

        /// <summary>Waits until the engine's demand for <paramref name="topic"/> is <paramref name="tier"/>, or gone when it is null.</summary>
        private static async Task WaitForDemandAsync(ChannelEngine engine, string topic, string? tier)
        {
            var deadline = DateTime.UtcNow + Timeout;
            while (DateTime.UtcNow < deadline)
            {
                var row = engine.Cadence.DemandReport().FirstOrDefault(r => r.Topic == topic);
                if (tier == null ? row == null : row?.Tier == tier)
                {
                    return;
                }
                await Task.Delay(10);
            }
            throw new TimeoutException("demand for " + topic + " never became " + (tier ?? "nothing"));
        }

        private sealed class RateProbeUplink : ISitrepUplink
        {
            public const string FastTopic = "rate.fast";
            public const string SteadyTopic = "rate.steady";

            private int _fastBuilds;
            private int _steadyBuilds;

            public int FastBuilds => Volatile.Read(ref _fastBuilds);

            public int SteadyBuilds => Volatile.Read(ref _steadyBuilds);

            public void Reset()
            {
                Interlocked.Exchange(ref _fastBuilds, 0);
                Interlocked.Exchange(ref _steadyBuilds, 0);
            }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "test-rate-probe",
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
