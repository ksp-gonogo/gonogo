using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A topic that is the engine's own state is only built while something is
    /// subscribed, so what is archived describes the engine as it was when the
    /// last subscriber left. A client that subscribes afterwards must be handed
    /// the state as it is now, or nothing, as the first thing it reads.
    /// </summary>
    public class EngineStateCatchUpTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        /// <summary>Subscribes without discarding the catch-up the way the ack-only helper does, and returns once the engine has taken the subscription.</summary>
        private static async Task SubscribeRawAsync(ChannelEngine engine, TestClient client, string topic)
        {
            var before = engine.SubscriberCountFor(topic);
            await client.SendAsync(EnvelopeCodec.WriteSubscribe(new Subscribe { Topic = topic }));
            var deadline = DateTime.UtcNow + Timeout;
            while (engine.SubscriberCountFor(topic) <= before)
            {
                if (DateTime.UtcNow > deadline)
                {
                    throw new TimeoutException("The engine never took the subscription to " + topic);
                }
                await Task.Delay(5);
            }
        }

        private static string Flatten(object? value)
        {
            switch (value)
            {
                case null:
                    return "null";
                case Dictionary<string, object?> map:
                    return "{" + string.Join(",", map.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => p.Key + ":" + Flatten(p.Value))) + "}";
                case System.Collections.IEnumerable list when value is not string:
                    return "[" + string.Join(",", list.Cast<object?>().Select(Flatten)) + "]";
                default:
                    return Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? "";
            }
        }

        private static async Task<string?> FirstFrameAsync(TestClient client, string topic)
        {
            foreach (var frame in await DrainAllStreamDataAsync(client, Quiet))
            {
                if (frame.Topic == topic)
                {
                    return Flatten(frame.Payload);
                }
            }
            return null;
        }

        [Fact]
        public async Task TheGateReportIsNotHandedToANewSubscriberAsItStoodWhenTheLastOneLeft()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new GatedUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                string? before;
                await using (var early = await TestClient.ConnectAsync(engine.BoundPort, Timeout))
                {
                    await SubscribeRawAsync(engine, early, ChannelEngine.UplinkGatesTopic);
                    engine.SampleCommandGatesAt(0.0);
                    engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
                    before = await FirstFrameAsync(early, ChannelEngine.UplinkGatesTopic);
                }
                Assert.NotNull(before);

                uplink.Locked = true;

                await using var late = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeRawAsync(engine, late, ChannelEngine.UplinkGatesTopic);
                engine.TickAndWait(2.0, new KspSnapshot { Ut = 2.0 }, Timeout);
                engine.SampleCommandGatesAt(10.0);
                engine.TickAndWait(3.0, new KspSnapshot { Ut = 3.0 }, Timeout);

                var first = await FirstFrameAsync(late, ChannelEngine.UplinkGatesTopic);
                Assert.NotNull(first);
                Assert.NotEqual(before, first);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ThePendingListIsNotHandedToANewSubscriberAsItStoodWhenTheLastOneLeft()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new PendingUplink());
            engine.RegisterCommandCentreSource(new GroundSource());
            engine.Start();
            try
            {
                await using (var early = await TestClient.ConnectAsync(engine.BoundPort, Timeout))
                {
                    await SubscribeRawAsync(engine, early, ChannelEngine.UplinkPendingTopic);
                    engine.TickAndWait(0.0, PendingUplink.Snapshot(0.0), Timeout);
                    Assert.NotNull(await FirstFrameAsync(early, ChannelEngine.UplinkPendingTopic));
                }

                engine.DispatchCommandAndWait(PendingUplink.Command, "x", "KSC", _ => { }, TestBudgets.Op, label: "run.");
                engine.TickAndWait(1.0, PendingUplink.Snapshot(1.0), Timeout);

                await using var late = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeRawAsync(engine, late, ChannelEngine.UplinkPendingTopic);
                engine.TickAndWait(2.0, PendingUplink.Snapshot(2.0), Timeout);
                var first = await FirstFrameAsync(late, ChannelEngine.UplinkPendingTopic);

                Assert.NotNull(first);
                Assert.Contains("run.", first);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task TheModSettingsAreNotHandedToANewSubscriberAsTheyStoodWhenTheLastOneLeft()
        {
            var clock = 0.0;
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.SetRealClockForTests(() => clock);
            var uplink = new ModUplink();
            engine.RegisterDiscoveredUplinks(new[]
            {
                new UplinkDiscovery.DiscoveredUplink(uplink, ContractVersion.Major, ContractVersion.Minor, uplink.Manifest.Id),
            });
            engine.Start();
            var topic = "settings." + uplink.Manifest.Id;
            try
            {
                string? before;
                await using (var early = await TestClient.ConnectAsync(engine.BoundPort, Timeout))
                {
                    await SubscribeRawAsync(engine, early, topic);
                    engine.SampleModSettings("save");
                    engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
                    before = await FirstFrameAsync(early, topic);
                }
                Assert.NotNull(before);

                uplink.On = true;
                clock = 5.0;
                engine.SampleModSettings("save");

                await using var late = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeRawAsync(engine, late, topic);
                engine.TickAndWait(6.0, new KspSnapshot { Ut = 6.0 }, Timeout);
                var first = await FirstFrameAsync(late, topic);

                Assert.NotNull(first);
                Assert.NotEqual(before, first);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task TheChannelCountersAreNotHandedToANewSubscriberAsTheyStoodWhenTheLastOneLeft()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new CountedUplink());
            engine.SetChannelCounterIntervalForTests(0);
            engine.Start();
            try
            {
                string? before;
                await using (var early = await TestClient.ConnectAsync(engine.BoundPort, Timeout))
                {
                    await SubscribeRawAsync(engine, early, ChannelEngine.ChannelsTopic);
                    engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
                    before = await FirstFrameAsync(early, ChannelEngine.ChannelsTopic);
                }
                Assert.NotNull(before);

                await using (var watcher = await TestClient.ConnectAsync(engine.BoundPort, Timeout))
                {
                    await SubscribeRawAsync(engine, watcher, CountedUplink.Topic);
                    engine.TickAndWait(2.0, new KspSnapshot { Ut = 2.0 }, Timeout);
                    engine.TickAndWait(3.0, new KspSnapshot { Ut = 3.0 }, Timeout);
                }

                await using var late = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeRawAsync(engine, late, ChannelEngine.ChannelsTopic);
                engine.TickAndWait(4.0, new KspSnapshot { Ut = 4.0 }, Timeout);
                var first = await FirstFrameAsync(late, ChannelEngine.ChannelsTopic);

                Assert.NotNull(first);
                Assert.NotEqual(before, first);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static ChannelDeclaration Channel(string topic) => new ChannelDeclaration
        {
            Kind = SampleKind.Continuous,
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Delay = DelayRole.TrueNow,
            Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
        };

        private sealed class CountedUplink : ISitrepUplink
        {
            public const string Topic = "catchup.counted";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "catchup-counted",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration> { Channel(Topic) },
            };

            public void Register(IUplinkHost host) => host.AddChannelSource(Topic, _ => 1.0);
        }

        private sealed class GatedUplink : ISitrepUplink
        {
            private const string Kind = "catchup-gate";

            public volatile bool Locked;

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "catchup-gated",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration
                    {
                        Command = "catchup.go",
                        Delay = DelayRole.TrueNow,
                        Requires = new[] { new CommandRequirement { Kind = Kind } },
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<string, string>("catchup.go", _ => "ok");
                host.AddGateEvaluator(new Gate(this));
            }

            private sealed class Gate : ICommandGateEvaluator
            {
                private readonly GatedUplink _owner;

                public Gate(GatedUplink owner) => _owner = owner;

                public string Kind => GatedUplink.Kind;

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments) =>
                    _owner.Locked
                        ? GateVerdict.NotUnlocked("locked", new MissingUnlock { Kind = UnlockKind.Tech, Id = "t", Name = "T" })
                        : GateVerdict.Pass();
            }
        }

        private sealed class PendingUplink : ISitrepUplink
        {
            public const string Command = "catchup.dispatch";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "catchup-pending",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration> { Channel("catchup.subject") },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.Delayed, Subject = "catchup.subject" },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<string, string>(Command, args => "pong:" + args);
                host.SetConnectivitySource(s => s != null && s.Values.TryGetValue("connected", out var c) ? Convert.ToBoolean(c) : (bool?)null);
                host.SetSignalDelaySource(s => new CommsDelay
                {
                    OneWaySeconds = s != null && s.Values.TryGetValue("delay", out var d) && d != null ? Convert.ToDouble(d) : (double?)null,
                    Source = CommsDelaySource.SignalDelay,
                });
            }

            public static KspSnapshot Snapshot(double ut) => new KspSnapshot
            {
                Ut = ut,
                Values = new Dictionary<string, object?> { ["connected"] = true, ["delay"] = 5.0 },
            };
        }

        private sealed class GroundSource : ICommandCentreSource
        {
            public string ProviderId => "catchup-ground";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                yield return new Centre();
            }

            private sealed class Centre : ICommandCentre
            {
                public string Id => "KSC";
                public string DisplayName => "KSC";
                public CommandCentreKind Kind => CommandCentreKind.GroundStation;
                public int? BodyIndex => null;
                public double? Latitude => null;
                public double? Longitude => null;
                public bool IsActiveNow() => true;
            }
        }

        private sealed class ModUplink : ISitrepUplink, IModSettingsSource
        {
            private static readonly ModSetting Toggle =
                ModSetting.Bool("toggle", "Toggle", ModSettingRefresh.Live);

            public volatile bool On;

            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "catchup-mod", Version = "1.0.0" };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host) { }

            public IReadOnlyList<ModSetting> ListModSettings() => new[] { Toggle };

            public ModSettingValue ReadModSetting(string id) => ModSettingValue.Of(On);
        }
    }
}
