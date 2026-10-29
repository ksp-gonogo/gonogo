using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core.StoreAndForward;
using Sitrep.Host;
using Sitrep.Host.Comms;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A producer that remembers what it already sent must not lose a screen's
    /// request for a reading before serving it, and must hear of a timeline
    /// reset so it can forget.
    /// </summary>
    public class ProducerAskTests
    {
        private const string Home = ScriptedContactGame.Home;

        [Fact]
        public async Task ACatalogAskedForWhileTheCraftListCannotBeReadIsSentOnceItCan()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            world.Game.ListNotStanding = true;
            world.Game.OutOfFlight = true;
            world.Engine.NoteGameLoaded(new DeliverySnapshot(), new HeardSnapshot(new HeardAtCentre[0]));
            world.Tick(1.0);
            world.Tick(1.0);

            var (client, view) = await world.SitDownAtAsync(Home, SystemViewProvider.CatalogTopic);
            await using var seated = client;
            world.Tick(1.0);
            await ReckonedVantageWorld.SettleAsync(client, view);
            Assert.Null(view.Vessels);

            world.Game.ListNotStanding = false;
            world.Game.OutOfFlight = false;
            world.Tick(1.0);
            world.Tick(1.0);
            await ReckonedVantageWorld.SettleAsync(client, view);

            Assert.NotNull(view.Vessels);
        }

        [Fact]
        public async Task ARosterAskedForWhileThereIsNoGameIsSentWhenTheGameIsBack()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            var (first, firstView) = await world.SitDownAtAsync(Home, ContactPlanSource.RosterTopic);
            await using var firstSeated = first;
            world.Tick(1.0);
            world.Tick(2.0);
            await ReckonedVantageWorld.SettleAsync(first, firstView);
            Assert.NotNull(firstView.Latest(ContactPlanSource.RosterTopic));

            world.Game.NoGame = true;
            var (late, lateView) = await world.SitDownAtAsync(Home, ContactPlanSource.RosterTopic);
            await using var lateSeated = late;
            world.Tick(3.0);
            await ReckonedVantageWorld.SettleAsync(late, lateView);
            Assert.Null(lateView.Latest(ContactPlanSource.RosterTopic));

            world.Game.NoGame = false;
            world.Tick(4.0);
            world.Tick(5.0);
            await ReckonedVantageWorld.SettleAsync(late, lateView);

            Assert.NotNull(lateView.Latest(ContactPlanSource.RosterTopic));
        }

        [Fact]
        public async Task ANetworkAskedForBeforeTheFirstPlanIsSentOnceThePlanArrives()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            var (client, view) = await world.SitDownAtAsync(Home);
            await using var seated = client;
            world.Tick(1.0);
            world.Tick(2.0);
            world.Tick(700.0);
            world.Tick(702.0);
            await ReckonedVantageWorld.SettleAsync(client, view);

            Assert.NotNull(view.Network);
            Assert.NotNull(view.CommandCentre);
        }

        [Fact]
        public async Task ALensThatMovesWithTwoHoldersReissuesItsReadingToBoth()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new MovingLensUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            engine.SetVesselDelay("aaa", 0.5);
            engine.SetVesselDelay("bbb", 0.5);
            try
            {
                await using var one = await TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                await using var two = await TestClient.ConnectAsync(engine.BoundPort, TestBudgets.Op);
                Assert.Equal("subscribed", (await SubscribeAsync(one, MovingLensUplink.Topic, TestBudgets.Op)).Name);
                Assert.Equal("subscribed", (await SubscribeAsync(two, MovingLensUplink.Topic, TestBudgets.Op)).Name);

                Tick(engine, 1.0);
                Tick(engine, 2.0);
                Tick(engine, 3.0);
                Assert.NotEmpty(await DrainAllStreamDataAsync(one, TestBudgets.Quiet));
                Assert.NotEmpty(await DrainAllStreamDataAsync(two, TestBudgets.Quiet));

                uplink.Site = "vessel:bbb";
                Tick(engine, 4.0);
                Tick(engine, 5.0);
                Tick(engine, 6.0);
                var heardByOne = await DrainAllStreamDataAsync(one, TestBudgets.Quiet);
                var heardByTwo = await DrainAllStreamDataAsync(two, TestBudgets.Quiet);

                Assert.NotEmpty(heardByOne);
                Assert.NotEmpty(heardByTwo);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AnUplinkIsToldWhenTheTimelineIsReset()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new ResetListeningUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                Tick(engine, 100.0);
                Tick(engine, 101.0);
                Assert.Empty(uplink.Resets);

                Tick(engine, 50.0);

                Assert.Equal(new[] { false }, uplink.Resets);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static void Tick(ChannelEngine engine, double ut) =>
            engine.TickAndWait(ut, new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?>() }, TestBudgets.Op);

        private sealed class ResetListeningUplink : ISitrepUplink, IUplinkTimelineListener
        {
            public List<bool> Resets { get; } = new List<bool>();

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "reset-listening-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>(),
            };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
            }

            public void OnTimelineReset(bool saveChanged) => Resets.Add(saveChanged);
        }

        /// <summary>One per-lens reading that never changes, standing at a site the test can move.</summary>
        private sealed class MovingLensUplink : ISitrepUplink
        {
            public const string Topic = "lens.moving.state";

            private IDynamicChannelSource? _lenses;
            private volatile string _site = "vessel:aaa";

            public string Site
            {
                get => _site;
                set => _site = value;
            }

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "moving-lens-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>(),
            };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                _lenses = host.RegisterDynamicNamespace("lens.", new ChannelDeclaration
                {
                    Kind = SampleKind.Continuous,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                    PerLensNode = true,
                    LensSiteForKey = key => key == "moving" ? _site : null,
                });
                host.AddSampledSource(
                    snapshot => snapshot?.Ut,
                    captured =>
                    {
                        if (captured is double ut)
                        {
                            _lenses?.Publisher("moving.state").Publish(new Dictionary<string, object?> { ["steady"] = 1.0 }, ut);
                        }
                    },
                    "lens.");
            }
        }
    }
}
