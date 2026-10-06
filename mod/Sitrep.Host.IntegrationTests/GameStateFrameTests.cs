using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A connection is told when the game starts loading and when it stands
    /// again, straight from the engine and not through the clock, which does
    /// not move during a load and so could carry nothing.
    /// </summary>
    public class GameStateFrameTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        private static ChannelEngine Started()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.ResolveCapabilities();
            engine.Start();
            return engine;
        }

        [Fact]
        public async Task AConnectionMadeMidLoadIsToldTheGameIsLoadingRightAfterItsGreeting()
        {
            using var engine = Started();
            try
            {
                engine.SetGameState(GamePhase.Loading, "FLIGHT");

                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await client.HelloAsync(Timeout);
                var told = await client.GameStateAsync(Timeout);
                Assert.Equal(GameState.Loading, told.State);
                Assert.Equal("FLIGHT", told.Scene);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ALoadStartingReachesEveryConnectionAtOnceWithNoTickRunning()
        {
            using var engine = Started();
            try
            {
                await using var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var second = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await first.HelloAsync(Timeout);
                await second.HelloAsync(Timeout);

                engine.SetGameState(GamePhase.Loading, "SPACECENTER");

                Assert.Equal(GameState.Loading, (await first.GameStateAsync(Timeout)).State);
                Assert.Equal(GameState.Loading, (await second.GameStateAsync(Timeout)).State);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task TheNoGameStateReachesAConnectionAtOnceAsWell()
        {
            using var engine = Started();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.HelloAsync(Timeout);

                engine.SetGameState(GamePhase.NoGame, "MAINMENU");

                var told = await client.GameStateAsync(Timeout);
                Assert.Equal(GameState.NoGame, told.State);
                Assert.Equal("MAINMENU", told.Scene);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ReadyWaitsForTheFirstTickSoItNeverOvertakesATimelineReset()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new RewindTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, RewindTestUplink.Topic, Timeout);
                await client.HelloAsync(Timeout);

                engine.TickAndWait(5.0, RewindTestUplink.Snapshot(5.0), Timeout);
                engine.SetGameState(GamePhase.Loading, "FLIGHT");
                Assert.Equal(GameState.Loading, (await client.GameStateAsync(Timeout)).State);

                engine.SetGameState(GamePhase.Ready, "FLIGHT");
                await client.AssertNoGameStateAsync(TestBudgets.Quiet);

                engine.TickAndWait(2.0, RewindTestUplink.Snapshot(2.0), Timeout);

                var reset = await ReceiveTypedAsync<EventMsg>(client, Timeout);
                Assert.Equal("timeline-reset", reset.Name);
                Assert.Equal(GameState.Ready, (await client.GameStateAsync(Timeout)).State);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AReadyThatNoTickFollowsIsReleasedOnceItHasWaitedLongEnough()
        {
            using var engine = Started();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.HelloAsync(Timeout);
                engine.SetGameState(GamePhase.Loading, "EDITOR");
                await client.GameStateAsync(Timeout);

                engine.SetGameState(GamePhase.Ready, "EDITOR");
                engine.ReleaseGameStateWaitingLongerThan(TimeSpan.MaxValue);
                await client.AssertNoGameStateAsync(TestBudgets.Quiet);

                engine.ReleaseGameStateWaitingLongerThan(TimeSpan.Zero);
                Assert.Equal(GameState.Ready, (await client.GameStateAsync(Timeout)).State);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>An editor stands still and nothing in it loads: ticks at one UT must not read as a load.</summary>
        [Fact]
        public async Task TenTicksAtOneUtAfterAnEditorLoadSayNothingMore()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new RewindTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.HelloAsync(Timeout);
                engine.SetGameState(GamePhase.Loading, "EDITOR");
                Assert.Equal(GameState.Loading, (await client.GameStateAsync(Timeout)).State);
                engine.SetGameState(GamePhase.Ready, "EDITOR");

                for (var i = 0; i < 10; i++)
                {
                    engine.TickAndWait(7.0, RewindTestUplink.Snapshot(7.0), Timeout);
                }

                Assert.Equal(GameState.Ready, (await client.GameStateAsync(Timeout)).State);
                await client.AssertNoGameStateAsync(TestBudgets.Quiet);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AConnectionToAnEngineNeverToldAnythingIsToldNothing()
        {
            using var engine = Started();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.HelloAsync(Timeout);

                await client.AssertNoGameStateAsync(TestBudgets.Quiet);
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class RewindTestUplink : ISitrepUplink
        {
            public const string Topic = "test.game-state-rewind";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "test-game-state-rewind",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(Topic, s => s != null && s.Values.TryGetValue("v", out var v) ? v : null);
            }

            public static KspSnapshot Snapshot(double ut) =>
                new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?> { ["v"] = ut } };
        }
    }
}
