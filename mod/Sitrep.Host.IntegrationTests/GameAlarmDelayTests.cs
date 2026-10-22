using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host.Alarms;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A game alarm whose time the game works out from a craft is that craft's
    /// telemetry: a command centre learns of it one signal delay after the craft,
    /// while a time the player chose reaches it at once.
    /// </summary>
    public class GameAlarmDelayTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        private const string Craft = "probe";
        private const double LightTime = 5.0;

        /// <summary>
        /// Publishes a fixed clock through the production declarations, board and
        /// publication: one periapsis alarm on <see cref="Craft"/> and one plain
        /// time, with the craft at <see cref="LightTime"/>.
        /// </summary>
        private sealed class GameAlarmTestUplink : ISitrepUplink
        {
            private readonly GameAlarmPublication _publication = new GameAlarmPublication();
            private IUplinkHost? _host;
            private IChannelPublisher? _list;
            private IDynamicChannelSource? _crafts;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "game-alarm-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration> { GameAlarmBoard.ListChannel() },
            };

            public void Register(IUplinkHost host)
            {
                _host = host;
                _list = host.Publisher(GameAlarmBoard.ListTopic);
                _crafts = host.RegisterDynamicNamespace(GameAlarmBoard.CraftPrefix, GameAlarmBoard.CraftNamespace());
                host.AddSampledSource(Capture, Handle);
            }

            private object? Capture(KspSnapshot? snapshot)
            {
                var view = GameAlarmBoard.Build(true, new[]
                {
                    new GameAlarmRecord { Id = 1, Kind = GameAlarmKind.Periapsis, Title = "Pe", Ut = 900, Vessel = Craft },
                    new GameAlarmRecord { Id = 2, Kind = GameAlarmKind.Time, Title = "Plan", Ut = 800, Vessel = Craft },
                }, null);
                var host = _host!;
                return (snapshot?.Ut ?? 0, _publication.Next(
                    view,
                    host.IsAnyTopicSubscribed(GameAlarmBoard.ListTopic),
                    craft => host.IsAnyTopicSubscribed(GameAlarmBoard.CraftTopic(craft))));
            }

            private void Handle(object? captured)
            {
                if (captured is not ValueTuple<double, GameAlarmPublishes> tick)
                {
                    return;
                }
                var (ut, publishes) = tick;
                _host!.SetVesselDelay(Craft, LightTime);
                _host.SetVesselConnectivity(Craft, true);
                if (publishes.List != null)
                {
                    _list!.Publish(GameAlarmBoard.ToWire(publishes.List), ut);
                }
                foreach (var craft in publishes.Crafts)
                {
                    _crafts!.Publisher(craft.Key + GameAlarmBoard.CraftSuffix).Publish(GameAlarmBoard.ToWire(craft.Value), ut);
                }
            }

            public UplinkHealth Health() => UplinkHealth.Healthy;
        }

        [Fact]
        public void a_crafts_game_alarms_record_on_that_crafts_own_node()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new GameAlarmTestUplink());

            Assert.Equal(ChannelEngine.FleetNodePrefix + Craft, engine.NodeFor(GameAlarmBoard.CraftTopic(Craft)));
        }

        [Fact]
        public async Task a_craft_derived_game_alarm_is_not_seen_at_a_centre_before_its_light_delay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new GameAlarmTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                var craftTopic = GameAlarmBoard.CraftTopic(Craft);
                await SubscribeAsync(client, GameAlarmBoard.ListTopic, Timeout);
                await SubscribeAsync(client, craftTopic, Timeout);

                for (var ut = 0.0; ut < LightTime; ut += 1.0)
                {
                    engine.TickAndWait(ut, new KspSnapshot { Ut = ut }, Timeout);
                }
                var beforeLightTime = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(beforeLightTime, f => f.Topic == GameAlarmBoard.ListTopic);
                Assert.DoesNotContain(beforeLightTime, f => f.Topic == craftTopic);

                for (var ut = LightTime; ut <= LightTime + 1; ut += 1.0)
                {
                    engine.TickAndWait(ut, new KspSnapshot { Ut = ut }, Timeout);
                }
                var afterLightTime = await DrainAllStreamDataAsync(client, Quiet);
                Assert.Contains(afterLightTime, f => f.Topic == craftTopic);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
