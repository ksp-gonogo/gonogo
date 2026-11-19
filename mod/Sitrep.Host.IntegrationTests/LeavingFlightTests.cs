using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// When the game, settled and loaded, has no active vessel after one was
    /// active (the Space Center, an editor, a revert, a destroy), a screen
    /// reading an active-vessel topic is sent its withdrawal once, through any
    /// freeze, instead of being left on the craft's last reading. A craft that is
    /// still active but out of contact keeps its readings, and so does a scene
    /// that is still loading.
    /// </summary>
    public class LeavingFlightTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;
        private const string Craft = "aaaaaaaa-0000-0000-0000-000000000000";
        private const string Topic = "leaving-flight-test.flight";
        private const string ActiveVessel = SystemViewProvider.ActiveVesselTopic;
        private const string Record = "leaving-flight-test.record";

        private static KspSnapshot Flying(double ut, bool connected = true) => new KspSnapshot
        {
            Ut = ut,
            Values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = Craft, ["name"] = "Probe" },
                    ["reading"] = 1000.0 + ut,
                },
                ["activeVessel"] = new Dictionary<string, object?> { ["vesselId"] = Craft, ["name"] = "Probe" },
                ["record"] = "crashed at " + ut,
                ["delay"] = 0.0,
                ["connected"] = connected,
            },
        };

        private static KspSnapshot NoCraft(double ut, string? record = null) => new KspSnapshot
        {
            Ut = ut,
            Values = new Dictionary<string, object?> { ["delay"] = null, ["connected"] = null, ["record"] = record },
        };

        private static async Task<(ChannelEngine Engine, TestClient Client)> FlyAsync()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new Up());
            engine.Start();
            var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
            await SubscribeAsync(client, Topic, Timeout);
            engine.TickAndWait(1.0, Flying(1.0), Timeout);
            var first = await ReceiveStreamDataAsync(client, Timeout);
            Assert.NotNull(first.Payload);
            return (engine, client);
        }

        /// <summary>Flies the craft with both the craft Topic and <c>ksp.activeVessel</c> subscribed, returning the newest of each.</summary>
        private static async Task<(ChannelEngine Engine, TestClient Client, Dictionary<string, string> Flying)> FlyWatchingTheActiveVesselAsync()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new Up());
            engine.Start();
            var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
            await SubscribeAsync(client, Topic, Timeout);
            await SubscribeAsync(client, ActiveVessel, Timeout);
            engine.TickAndWait(1.0, Flying(1.0), Timeout);
            return (engine, client, await LatestByTopicAsync(client));
        }

        /// <summary>Every frame that arrives until the stream goes quiet, each as its payload's text.</summary>
        private static async Task<List<string>> AllFramesAsync(TestClient client)
        {
            var seen = new List<string>();
            while (true)
            {
                try
                {
                    var d = await ReceiveStreamDataAsync(client, Quiet);
                    seen.Add(d.Payload?.ToString() ?? "null");
                }
                catch (Exception) { return seen; }
            }
        }

        /// <summary>The newest payload of each topic that arrives until the stream goes quiet, as its text.</summary>
        private static async Task<Dictionary<string, string>> LatestByTopicAsync(TestClient client)
        {
            var latest = new Dictionary<string, string>();
            while (true)
            {
                try
                {
                    var d = await ReceiveStreamDataAsync(client, Quiet);
                    latest[d.Topic] = d.Payload?.ToString() ?? "null";
                }
                catch (Exception) { return latest; }
            }
        }

        /*
         * The client tells "no vessel" from a vessel topic that is merely empty in
         * flight by ksp.activeVessel alone, with no reason on the wire, so the two
         * must agree: with no vessel both have no value, and out of contact the
         * game still names the craft while its readings keep their values.
         */
        [Fact]
        public async Task WithNoVesselTheActiveVesselAndItsTopicsAllHaveNoValue()
        {
            var (engine, client, flying) = await FlyWatchingTheActiveVesselAsync();
            try
            {
                Assert.NotEqual("null", flying[ActiveVessel]);
                Assert.NotEqual("null", flying[Topic]);

                engine.TickAndWait(3.0, NoCraft(3.0), Timeout);
                var left = await LatestByTopicAsync(client);
                Assert.Equal("null", left[ActiveVessel]);
                Assert.Equal("null", left[Topic]);
            }
            finally
            {
                await client.DisposeAsync();
                engine.Stop();
                engine.Dispose();
            }
        }

        [Fact]
        public async Task OutOfContactTheGameStillNamesTheCraftAndItsTopicsKeepTheirValues()
        {
            var (engine, client, flying) = await FlyWatchingTheActiveVesselAsync();
            try
            {
                Assert.NotEqual("null", flying[ActiveVessel]);

                engine.TickAndWait(3.0, Flying(3.0, connected: false), Timeout);
                engine.TickAndWait(4.0, Flying(4.0, connected: false), Timeout);
                engine.TickAndWait(5.0, Flying(5.0, connected: false), Timeout);
                var dark = await LatestByTopicAsync(client);
                if (dark.TryGetValue(ActiveVessel, out var active))
                {
                    Assert.NotEqual("null", active);
                }
                if (dark.TryGetValue(Topic, out var reading))
                {
                    Assert.NotEqual("null", reading);
                }
            }
            finally
            {
                await client.DisposeAsync();
                engine.Stop();
                engine.Dispose();
            }
        }

        [Fact]
        public async Task LeavingFlightWithdrawsTheCraftsReadingForGood()
        {
            var (engine, client) = await FlyAsync();
            try
            {
                engine.TickAndWait(2.0, NoCraft(2.0), Timeout);
                var withdrawn = await DrainToLatestStreamDataAsync(client, Quiet);
                Assert.NotNull(withdrawn);
                Assert.Null(withdrawn!.Payload);

                // Later ticks with no craft may repeat the withdrawal, and never show the craft's reading again.
                engine.TickAndWait(3.0, NoCraft(3.0), Timeout);
                engine.TickAndWait(4.0, NoCraft(4.0), Timeout);
                foreach (var frame in await AllFramesAsync(client))
                {
                    Assert.Equal("null", frame);
                }
            }
            finally
            {
                await client.DisposeAsync();
                engine.Stop();
                engine.Dispose();
            }
        }

        /*
         * A craft launched from the editor is born a moment after the instant the
         * editor launched it, and reverting to the editor rewinds the timeline to
         * that instant. Nothing of the craft is left in the archive then, yet a
         * screen still holds its readings, so the withdrawal must not depend on
         * the archive having anything to withdraw.
         */
        [Fact]
        public async Task RevertingToBeforeTheCraftsFirstReadingStillWithdrawsIt()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new Up());
            engine.Start();
            var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
            try
            {
                await SubscribeAsync(client, Topic, Timeout);
                engine.TickAndWait(100.0, NoCraft(100.0), Timeout);
                for (var ut = 101.0; ut <= 105.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, Flying(ut), Timeout);
                }
                var flying = await DrainToLatestStreamDataAsync(client, Quiet);
                Assert.NotNull(flying?.Payload);

                engine.TickAndWait(100.0, NoCraft(100.0), Timeout);
                engine.TickAndWait(100.5, NoCraft(100.5), Timeout);
                engine.TickAndWait(101.0, NoCraft(101.0), Timeout);
                var after = await AllFramesAsync(client);
                Assert.NotEmpty(after);
                Assert.Equal("null", after[^1]);
            }
            finally
            {
                await client.DisposeAsync();
                engine.Stop();
                engine.Dispose();
            }
        }

        /*
         * A record of what happened to the craft, such as the crash it ended in, is
         * not the craft's present state: it outlives the craft, so the screen that
         * shows the crash as the flight's last record still has it at the Space
         * Center. A record is a reliable-ordered channel; a craft's present state
         * is a latest-value one.
         */
        [Fact]
        public async Task LeavingFlightKeepsARecordOfWhatHappenedToTheCraft()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new Up());
            engine.Start();
            var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
            try
            {
                await SubscribeAsync(client, Record, Timeout);
                engine.TickAndWait(1.0, Flying(1.0), Timeout);
                var recorded = await DrainToLatestStreamDataAsync(client, Quiet);
                Assert.NotNull(recorded?.Payload);

                engine.TickAndWait(2.0, NoCraft(2.0, record: "crashed at 1"), Timeout);
                engine.TickAndWait(3.0, NoCraft(3.0, record: "crashed at 1"), Timeout);
                foreach (var frame in await AllFramesAsync(client))
                {
                    Assert.NotEqual("null", frame);
                }
            }
            finally
            {
                await client.DisposeAsync();
                engine.Stop();
                engine.Dispose();
            }
        }

        /*
         * Deck #464's run: in the editor with no craft, launching from the editor
         * rewinds to the instant before the launch, the craft flies, and reverting
         * rewinds to that instant again. Neither the craft's Topics nor the active
         * vessel had a reading before it, and a screen holds both until the mod
         * sends each one's first frame of the new timeline.
         */
        [Fact]
        public async Task AnEditorLaunchAndRevertLeavesNoActiveVesselAndNoCraftReading()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new Up());
            engine.Start();
            var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
            try
            {
                await SubscribeAsync(client, Topic, Timeout);
                await SubscribeAsync(client, ActiveVessel, Timeout);
                engine.TickAndWait(100.0, NoCraft(100.0), Timeout);
                engine.TickAndWait(104.0, NoCraft(104.0), Timeout);
                engine.TickAndWait(100.0, NoCraft(100.0), Timeout);
                for (var ut = 101.0; ut <= 105.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, Flying(ut), Timeout);
                }
                var flying = await LatestByTopicAsync(client);
                Assert.NotEqual("null", flying[ActiveVessel]);
                Assert.NotEqual("null", flying[Topic]);

                engine.TickAndWait(100.0, NoCraft(100.0), Timeout);
                engine.TickAndWait(100.5, NoCraft(100.5), Timeout);
                engine.TickAndWait(101.0, NoCraft(101.0), Timeout);
                var reverted = await LatestByTopicAsync(client);
                Assert.Equal("null", reverted[ActiveVessel]);
                Assert.Equal("null", reverted[Topic]);
            }
            finally
            {
                await client.DisposeAsync();
                engine.Stop();
                engine.Dispose();
            }
        }

        [Fact]
        public async Task LeavingFlightOutOfContactStillWithdrawsTheCraftsReading()
        {
            var (engine, client) = await FlyAsync();
            try
            {
                engine.TickAndWait(2.0, Flying(2.0, connected: false), Timeout);
                engine.TickAndWait(3.0, NoCraft(3.0), Timeout);
                var withdrawn = await DrainToLatestStreamDataAsync(client, Quiet);
                Assert.NotNull(withdrawn);
                Assert.Null(withdrawn!.Payload);
            }
            finally
            {
                await client.DisposeAsync();
                engine.Stop();
                engine.Dispose();
            }
        }

        [Fact]
        public async Task LossOfSignalWithdrawsNothing()
        {
            var (engine, client) = await FlyAsync();
            try
            {
                engine.TickAndWait(2.0, Flying(2.0, connected: false), Timeout);
                engine.TickAndWait(3.0, Flying(3.0, connected: false), Timeout);
                engine.TickAndWait(4.0, Flying(4.0, connected: false), Timeout);
                var latest = await DrainToLatestStreamDataAsync(client, Quiet);
                Assert.True(latest == null || latest.Payload != null, "a craft out of contact is still active, so its reading is never withdrawn");
            }
            finally
            {
                await client.DisposeAsync();
                engine.Stop();
                engine.Dispose();
            }
        }

        [Fact]
        public async Task ASceneStillLoadingWithdrawsNothing()
        {
            var (engine, client) = await FlyAsync();
            try
            {
                engine.SetGameState(GamePhase.Loading, "SPACECENTER");
                engine.TickAndWait(2.0, NoCraft(2.0), Timeout);
                var latest = await DrainToLatestStreamDataAsync(client, Quiet);
                Assert.True(latest == null || latest.Payload != null, "the world is still being built, so its absent vessel is not news");
            }
            finally
            {
                await client.DisposeAsync();
                engine.Stop();
                engine.Dispose();
            }
        }

        [Fact]
        public async Task FlyingAgainShowsTheCraftAgain()
        {
            var (engine, client) = await FlyAsync();
            try
            {
                engine.TickAndWait(2.0, NoCraft(2.0), Timeout);
                Assert.Null((await DrainToLatestStreamDataAsync(client, Quiet))!.Payload);
                engine.TickAndWait(3.0, Flying(3.0), Timeout);
                var back = await DrainToLatestStreamDataAsync(client, Quiet);
                Assert.NotNull(back);
                Assert.NotNull(back!.Payload);
            }
            finally
            {
                await client.DisposeAsync();
                engine.Stop();
                engine.Dispose();
            }
        }

        private sealed class Up : ISitrepUplink
        {
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "leaving-flight-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Continuous,
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.Delayed,
                        Recordable = true,
                    },
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Discrete,
                        Requires = Requirement.None,
                        Topic = Record,
                        Delivery = Delivery.ReliableOrdered,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.Delayed,
                    },
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Discrete,
                        Requires = Requirement.None,
                        Topic = ActiveVessel,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.TrueNow,
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(Topic, snapshot =>
                    snapshot != null
                    && snapshot.Values.TryGetValue("vessel", out var vessel)
                    && vessel is Dictionary<string, object?> entry
                    && entry.TryGetValue("reading", out var reading)
                        ? reading
                        : null);
                ((ICraftLaneHost)host).FollowActiveCraft(Topic);
                host.AddChannelSource(ActiveVessel, SystemViewProvider.BuildActiveVessel);
                host.AddChannelSource(Record, snapshot =>
                    snapshot != null && snapshot.Values.TryGetValue("record", out var record) ? record : null);
                host.SetSignalDelaySource(snapshot =>
                    new CommsDelay
                    {
                        OneWaySeconds = snapshot != null && snapshot.Values.TryGetValue("delay", out var raw) && raw != null
                            ? Convert.ToDouble(raw)
                            : (double?)null,
                        Source = CommsDelaySource.SignalDelay,
                    });
                host.SetConnectivitySource(snapshot =>
                    snapshot != null && snapshot.Values.TryGetValue("connected", out var raw) && raw != null
                        ? Convert.ToBoolean(raw)
                        : (bool?)null);
            }
        }
    }
}
