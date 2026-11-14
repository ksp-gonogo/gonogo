using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// An Uplink's channel declared to follow the active craft: the active
    /// craft's reading through an ordinary publish, every other craft's through
    /// <see cref="ICraftReadingPublisher"/>. A screen is shown the craft switched
    /// to at once, and never a reading of either craft before its own delay.
    /// </summary>
    public class UplinkCraftLaneTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;
        private const string VesselA = "aaaaaaaa-0000-0000-0000-000000000000";
        private const string VesselB = "bbbbbbbb-0000-0000-0000-000000000000";
        private const string Topic = "lane-uplink-test.supplies";
        private const double BaseB = 2_000_000;

        private static double Reading(string vessel, double ut) => (vessel == VesselA ? 1_000_000 : BaseB) + ut;

        private static string CraftOf(double value) => value >= BaseB ? VesselB : VesselA;

        private static KspSnapshot Snap(double ut, string vessel, double delay) => new KspSnapshot
        {
            Ut = ut,
            Values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = vessel, ["name"] = vessel },
                },
                ["activeVessel"] = new Dictionary<string, object?> { ["vesselId"] = vessel, ["name"] = vessel },
                ["delay"] = delay,
                ["connected"] = true,
            },
        };

        [Theory]
        [InlineData(10.0, 30.0)]
        [InlineData(30.0, 10.0)]
        public async Task EachSwitchShowsTheNewCraftsUplinkReadingAtOnceAndNothingEarly(double delayA, double delayB)
        {
            var uplink = new FollowingUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);
                var delays = new Dictionary<string, double> { [VesselA] = delayA, [VesselB] = delayB };
                var active = VesselA;
                void Tick(double ut)
                {
                    // The game's tick first, as the Uplink reads the craft on the tick it describes.
                    var other = active == VesselA ? VesselB : VesselA;
                    engine.SetVesselDelay(other, delays[other]);
                    TickAndWaitForOutboxes(engine, ut, Snap(ut, active, delays[active]), Timeout);
                    ((ICraftReadingPublisher)uplink.Publisher!).PublishFor(other, Reading(other, ut), ut);
                    uplink.Publisher!.Publish(Reading(active, ut), ut);
                }

                for (var ut = 1000.0; ut <= 1100.0; ut += 1.0)
                {
                    Tick(ut);
                }
                var before = await Frames(client);

                active = VesselB;
                Tick(1101.0);
                var atSwitch = await Frames(client);
                Assert.Contains(atSwitch, f => CraftOf(f.Value) == VesselB && f.ValidAt >= 1100.0 - delayB);

                for (var ut = 1102.0; ut <= 1150.0; ut += 1.0)
                {
                    Tick(ut);
                }
                var whileB = await Frames(client);

                active = VesselA;
                Tick(1151.0);
                var back = await Frames(client);
                Assert.Contains(back, f => CraftOf(f.Value) == VesselA && f.ValidAt >= 1150.0 - delayA);

                foreach (var frame in before.Concat(atSwitch).Concat(whileB).Concat(back))
                {
                    var craft = CraftOf(frame.Value);
                    Assert.True(
                        frame.DeliveredAt - frame.ValidAt >= delays[craft] - 0.01,
                        "a reading of " + craft + " made at " + frame.ValidAt + " reached the screen at " + frame.DeliveredAt);
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task TheRosterNamesTheChannelsThatFollowTheActiveCraft()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FollowingUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinksTopic, Timeout);
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);

                var roster = (await DrainAllStreamDataAsync(client, Quiet)).Last(f => f.Topic == ChannelEngine.UplinksTopic);
                using var json = JsonDocument.Parse(JsonSerializer.Serialize(roster.Payload));
                var following = json.RootElement.GetProperty("delayRoles").GetProperty("followsActiveCraft")
                    .EnumerateArray().Select(e => e.GetString()).ToList();
                Assert.Contains(Topic, following);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AFollowingChannelThatIsReadWithNoDelayIsRefused()
        {
            var uplink = new FollowingUplink(DelayRole.TrueNow);
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);

            var availability = engine.AvailabilityOf(uplink.Manifest.Id);
            Assert.False(availability.IsAvailable);
            Assert.Contains(Topic, availability.Reason!);
        }

        private static async Task<List<(double Value, double ValidAt, double DeliveredAt)>> Frames(TestClient client) =>
            (await DrainAllStreamDataAsync(client, Quiet))
                .Where(f => f.Topic == Topic && f.Payload != null)
                .Select(f => (Convert.ToDouble(f.Payload), f.Meta.ValidAt, f.Meta.DeliveredAt))
                .ToList();

        private sealed class FollowingUplink : ISitrepUplink
        {
            public FollowingUplink(DelayRole delay = DelayRole.Delayed)
            {
                Manifest = new UplinkManifest
                {
                    Id = "lane-uplink-test",
                    Version = "1.0.0",
                    Channels = new List<ChannelDeclaration>
                    {
                        new ChannelDeclaration
                        {
                            Kind = SampleKind.Continuous,
                            Topic = Topic,
                            Delivery = Delivery.LossyLatest,
                            Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                            Delay = delay,
                            FollowsActiveCraft = true,
                        },
                    },
                };
            }

            public IChannelPublisher? Publisher { get; private set; }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; }

            public void Register(IUplinkHost host)
            {
                Publisher = host.Publisher(Topic);
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
