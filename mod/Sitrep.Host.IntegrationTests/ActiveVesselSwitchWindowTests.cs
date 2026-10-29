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
    /// The first ticks after the game switches active craft. The new craft's path is
    /// not yet measured, and what the engine holds from the craft left behind (its
    /// rows, its delay) says nothing about it.
    /// </summary>
    public class ActiveVesselSwitchWindowTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;
        private const string VesselA = "aaaaaaaa-0000-0000-0000-000000000000";
        private const string VesselB = "bbbbbbbb-0000-0000-0000-000000000000";
        private const string Topic = "switch-window.onboard";
        private const string Command = "switch-window.order";

        private static KspSnapshot Snap(double ut, string vessel, double? delay, bool connected, double? onboard)
        {
            var values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = vessel, ["name"] = vessel },
                },
                ["delay"] = delay,
                ["connected"] = connected,
            };
            if (onboard.HasValue)
            {
                values["onboard"] = onboard.Value;
            }
            return new KspSnapshot { Ut = ut, Values = values };
        }

        private static void Tick(ChannelEngine engine, KspSnapshot snapshot) =>
            engine.TickAndWait(snapshot.Ut, snapshot, Timeout);

        private static async Task<List<object?>> Payloads(TestClient client) =>
            (await DrainAllStreamDataAsync(client, Quiet)).Where(f => f.Topic == Topic).Select(f => f.Payload).ToList();

        [Fact]
        public async Task ACraftSwitchedToWithNoMeasuredPathIsNotHeardAtNoDelayWhileItsLinkReadsUp()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new SwitchWindowUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);

                foreach (var ut in new[] { 1.0, 2.0, 3.0 })
                {
                    Tick(engine, Snap(ut, VesselA, 45.0, connected: true, onboard: 7.0));
                }
                await Payloads(client);

                Tick(engine, Snap(4.0, VesselB, null, connected: true, onboard: 50.0));

                var heard = await Payloads(client);
                Assert.DoesNotContain(heard, p => p != null && Convert.ToDouble(p) == 50.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ACraftSwitchedToWithNoMeasuredPathIsNotTimedByTheCraftLeftBehind()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new SwitchWindowUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);

                foreach (var ut in new[] { 1.0, 2.0, 3.0 })
                {
                    Tick(engine, Snap(ut, VesselA, 45.0, connected: true, onboard: 7.0));
                }
                await Payloads(client);

                Tick(engine, Snap(4.0, VesselB, null, connected: false, onboard: 50.0));
                foreach (var ut in new[] { 60.0, 61.0 })
                {
                    Tick(engine, Snap(ut, VesselB, null, connected: false, onboard: 50.0));
                }

                var heard = await Payloads(client);
                Assert.DoesNotContain(heard, p => p != null && Convert.ToDouble(p) == 50.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void TheRowsOfTheCraftLeftBehindAreNotKeptForTheCraftSwitchedTo()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new SwitchWindowUplink());
            engine.Start();
            try
            {
                foreach (var ut in new[] { 1.0, 2.0, 3.0 })
                {
                    Tick(engine, Snap(ut, VesselA, 45.0, connected: true, onboard: 7.0));
                }

                Tick(engine, Snap(4.0, VesselB, null, connected: true, onboard: 50.0));

                Assert.Null(engine.MeasuredStampFor(Topic, 4.0));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AReadingHeldAfterASwitchIsHeardOnceThePathIsMeasured()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new SwitchWindowUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);

                foreach (var ut in new[] { 1.0, 2.0, 3.0 })
                {
                    Tick(engine, Snap(ut, VesselA, 45.0, connected: true, onboard: 7.0));
                }
                await Payloads(client);

                Tick(engine, Snap(4.0, VesselB, null, connected: true, onboard: 50.0));
                Tick(engine, Snap(5.0, VesselB, 0.0, connected: true, onboard: 50.0));
                Tick(engine, Snap(6.0, VesselB, 0.0, connected: true, onboard: 51.0));

                var heard = await Payloads(client);
                Assert.Contains(heard, p => p != null && Convert.ToDouble(p) == 51.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AReadingTheCraftSwitchedToSharesWithTheCraftLeftBehindIsHeardOnceThePathIsMeasured()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new SwitchWindowUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);

                foreach (var ut in new[] { 1.0, 2.0, 3.0 })
                {
                    Tick(engine, Snap(ut, VesselA, 45.0, connected: true, onboard: 7.0));
                }
                await Payloads(client);

                Tick(engine, Snap(4.0, VesselB, null, connected: true, onboard: 7.0));
                Tick(engine, Snap(5.0, VesselB, 0.0, connected: true, onboard: 7.0));
                Tick(engine, Snap(6.0, VesselB, 0.0, connected: true, onboard: 7.0));

                var heard = await Payloads(client);
                Assert.NotEmpty(heard);
                Assert.Equal(7.0, Convert.ToDouble(heard.Last()));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AnOrderForTheCraftSwitchedToIsRefusedUntilItsPathIsMeasured()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new SwitchWindowUplink());
            engine.Start();
            try
            {
                foreach (var ut in new[] { 1.0, 2.0, 3.0 })
                {
                    Tick(engine, Snap(ut, VesselA, 45.0, connected: true, onboard: 7.0));
                }
                Tick(engine, Snap(4.0, VesselB, null, connected: true, onboard: 50.0));

                Assert.False(engine.DelayKnown("ground:Kerbal Space Center", ChannelEngine.NodeId));

                Tick(engine, Snap(5.0, VesselB, 3.0, connected: true, onboard: 50.0));

                Assert.True(engine.DelayKnown("ground:Kerbal Space Center", ChannelEngine.NodeId));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AnOrderOnTheLivePathIsRefusedAtThePressWhenNoCraftIsLoaded()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new SwitchWindowUplink());
            engine.SetCentrePlans(_ => null, () => 1);
            engine.Start();
            try
            {
                Tick(engine, Snap(1.0, VesselA, 2.0, connected: true, onboard: 7.0));
                Tick(engine, new KspSnapshot { Ut = 2.0, Values = new Dictionary<string, object?>() });

                object? result = null;
                engine.DispatchCommandAndWait(Command, "x", "ground:Kerbal Space Center", r => result = r, Timeout);

                Assert.Equal(CommandErrorCode.WrongScene, Assert.IsType<CommandResult>(result).ErrorCode);
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class SwitchWindowUplink : ISitrepUplink
        {
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "switch-window-test",
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
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.Delayed, Subject = Topic },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<string, string>(Command, args => "done:" + args);
                host.AddChannelSource(Topic, snapshot =>
                    snapshot != null && snapshot.Values.TryGetValue("onboard", out var raw) ? raw : null);
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
