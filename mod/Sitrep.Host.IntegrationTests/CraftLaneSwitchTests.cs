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
    /// Two craft, each with its own signal delay, both reporting the whole time:
    /// the active one through the active-vessel topic, the other through its lane.
    /// A screen reading the active-vessel topic is shown, at each switch, the
    /// newest reading of the craft switched to that its light has already
    /// brought, and never a reading of either craft before that craft's own delay.
    /// </summary>
    public class CraftLaneSwitchTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;
        private const string VesselA = "aaaaaaaa-0000-0000-0000-000000000000";
        private const string VesselB = "bbbbbbbb-0000-0000-0000-000000000000";
        private const string Topic = "craft-lane-test.flight";

        // Each craft's readings are its own base plus the instant they describe, so a frame names its craft.
        private const double BaseA = 1_000_000;
        private const double BaseB = 2_000_000;

        private static double Reading(string vessel, double ut) => (vessel == VesselA ? BaseA : BaseB) + ut;

        private static string CraftOf(double value) => value >= BaseB ? VesselB : VesselA;

        private static KspSnapshot Snap(double ut, string vessel, double? delay)
        {
            var values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = vessel, ["name"] = vessel },
                    ["reading"] = Reading(vessel, ut),
                },
                ["delay"] = delay,
                ["connected"] = true,
            };
            return new KspSnapshot { Ut = ut, Values = values };
        }

        private static KspSnapshot CraftOnly(double ut, string vessel) => new KspSnapshot
        {
            Ut = ut,
            Values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = vessel, ["name"] = vessel },
                    ["reading"] = Reading(vessel, ut),
                },
            },
        };

        private sealed class World
        {
            public readonly Dictionary<string, double> Delays = new Dictionary<string, double>();
            public string Active = VesselA;
            public readonly ChannelEngine Engine;

            public World(ChannelEngine engine) => Engine = engine;

            /// <summary>One game tick: the active craft through the snapshot, every other craft through its lane, as the background feed writes it.</summary>
            public void Tick(double ut)
            {
                foreach (var craft in Delays)
                {
                    if (craft.Key != Active)
                    {
                        Engine.SetVesselDelay(craft.Key, craft.Value);
                        Engine.WriteCraftSnapshot(craft.Key, CraftOnly(ut, craft.Key));
                    }
                }
                TickAndWaitForOutboxes(Engine, ut, Snap(ut, Active, Delays[Active]), Timeout);
            }
        }

        private static async Task<List<(double Value, double ValidAt, double DeliveredAt)>> Frames(TestClient client) =>
            (await DrainAllStreamDataAsync(client, Quiet))
                .Where(f => f.Topic == Topic && f.Payload != null)
                .Select(f => (Convert.ToDouble(f.Payload), f.Meta.ValidAt, f.Meta.DeliveredAt))
                .ToList();

        private static void NoneEarly(IEnumerable<(double Value, double ValidAt, double DeliveredAt)> frames, IReadOnlyDictionary<string, double> delays)
        {
            foreach (var frame in frames)
            {
                var craft = CraftOf(frame.Value);
                Assert.True(
                    frame.DeliveredAt - frame.ValidAt >= delays[craft] - 0.01,
                    "a reading of " + craft + " made at " + frame.ValidAt + " reached the screen at " + frame.DeliveredAt
                    + ", before its delay of " + delays[craft] + " s");
            }
        }

        [Theory]
        [InlineData(30.0, 10.0)]
        [InlineData(10.0, 30.0)]
        public async Task EachSwitchShowsTheNewCraftsNewestArrivedReadingAtOnceAndNothingEarly(double delayA, double delayB)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new LaneUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);
                var world = new World(engine);
                world.Delays[VesselA] = delayA;
                world.Delays[VesselB] = delayB;

                for (var ut = 1000.0; ut <= 1100.0; ut += 1.0)
                {
                    world.Tick(ut);
                }
                var beforeSwitch = await Frames(client);
                Assert.NotEmpty(beforeSwitch);
                Assert.All(beforeSwitch, f => Assert.Equal(VesselA, CraftOf(f.Value)));

                world.Active = VesselB;
                world.Tick(1101.0);
                var atSwitch = await Frames(client);
                var firstOfB = atSwitch.Where(f => CraftOf(f.Value) == VesselB).ToList();
                Assert.True(firstOfB.Count > 0, "the switch to B showed no reading of B, though B's lane held readings its light had brought");
                // The re-point lands before the tick moves the clock from 1100, so the screen is handed what had reached it by 1100, then what lands by 1101.
                Assert.True(firstOfB.Max(f => f.ValidAt) >= 1100.0 - delayB, "B was shown only as of UT " + firstOfB.Max(f => f.ValidAt));
                Assert.Contains(firstOfB, f => Math.Abs(f.ValidAt - (1101.0 - delayB)) < 1e-6);

                for (var ut = 1102.0; ut <= 1150.0; ut += 1.0)
                {
                    world.Tick(ut);
                }
                var whileB = await Frames(client);

                world.Active = VesselA;
                world.Tick(1151.0);
                var backAtA = await Frames(client);
                var firstOfA = backAtA.Where(f => CraftOf(f.Value) == VesselA).ToList();
                Assert.True(firstOfA.Count > 0, "the switch back to A showed no reading of A, though A's lane kept recording while B was flown");
                Assert.True(firstOfA.Max(f => f.ValidAt) >= 1150.0 - delayA, "A was shown only as of UT " + firstOfA.Max(f => f.ValidAt));
                Assert.Contains(firstOfA, f => Math.Abs(f.ValidAt - (1151.0 - delayA)) < 1e-6);

                for (var ut = 1152.0; ut <= 1200.0; ut += 1.0)
                {
                    world.Tick(ut);
                }
                var after = await Frames(client);

                NoneEarly(beforeSwitch.Concat(atSwitch).Concat(whileB).Concat(backAtA).Concat(after), world.Delays);
                Assert.All(whileB, f => Assert.Equal(VesselB, CraftOf(f.Value)));
                Assert.All(after, f => Assert.Equal(VesselA, CraftOf(f.Value)));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The acceptance case: two craft 30 light-minutes out, an hour flying A,
        /// two minutes on B, then back to A, watched from two screens. Each switch
        /// shows the craft switched to at once, every reading reaches each screen
        /// no sooner than its own craft's delay, and every reading shown is one
        /// the game reported for that craft at that instant.
        /// </summary>
        [Fact]
        public async Task AnHourOnAThenTwoMinutesOnBThenBackShowsNoGapOnEitherSwitch()
        {
            const double LightMinutes30 = 1800.0;
            const double Step = 10.0;
            const double ToB = 3600.0;
            const double BackToA = ToB + 120.0;
            const double End = BackToA + LightMinutes30 + 100.0;

            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new LaneUplink());
            engine.Start();
            try
            {
                await using var main = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var station = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                var screens = new[] { main, station };
                foreach (var screen in screens)
                {
                    await SubscribeAsync(screen, Topic, Timeout);
                }
                var world = new World(engine);
                world.Delays[VesselA] = LightMinutes30;
                world.Delays[VesselB] = LightMinutes30;
                var seen = new[] { new List<(double Value, double ValidAt, double DeliveredAt)>(), new List<(double Value, double ValidAt, double DeliveredAt)>() };

                async Task Drain()
                {
                    for (var i = 0; i < screens.Length; i++)
                    {
                        seen[i].AddRange(await Frames(screens[i]));
                    }
                }

                async Task AssertShownAtOnce(string craft, double switchUt)
                {
                    for (var i = 0; i < screens.Length; i++)
                    {
                        var fresh = await Frames(screens[i]);
                        seen[i].AddRange(fresh);
                        var shown = fresh.Where(f => CraftOf(f.Value) == craft).ToList();
                        Assert.True(
                            shown.Count > 0,
                            "screen " + i + " showed nothing of " + craft + " at the switch at UT " + switchUt + ", though its lane held readings that had arrived");
                        Assert.True(
                            shown.Max(f => f.ValidAt) >= switchUt - LightMinutes30 - Step,
                            "screen " + i + " was shown " + craft + " as of UT " + shown.Max(f => f.ValidAt) + " at the switch at UT " + switchUt
                            + ", older than what its light had brought");
                    }
                }

                for (var ut = 0.0; ut < ToB; ut += Step)
                {
                    world.Tick(ut);
                }
                await Drain();

                world.Active = VesselB;
                world.Tick(ToB);
                await AssertShownAtOnce(VesselB, ToB);

                for (var ut = ToB + Step; ut < BackToA; ut += Step)
                {
                    world.Tick(ut);
                }
                await Drain();

                world.Active = VesselA;
                world.Tick(BackToA);
                await AssertShownAtOnce(VesselA, BackToA);

                for (var ut = BackToA + Step; ut <= End; ut += Step)
                {
                    world.Tick(ut);
                }
                await Drain();

                foreach (var frames in seen)
                {
                    NoneEarly(frames, world.Delays);
                    foreach (var frame in frames)
                    {
                        Assert.Equal(Reading(CraftOf(frame.Value), frame.ValidAt), frame.Value);
                    }

                    // A chart of either craft has no hole: every reading between the first and the last each screen holds, A's two minutes behind B included.
                    foreach (var craft in new[] { VesselA, VesselB })
                    {
                        var history = frames.Where(f => CraftOf(f.Value) == craft).Select(f => f.ValidAt).Distinct().OrderBy(v => v).ToList();
                        Assert.NotEmpty(history);
                        for (var i = 1; i < history.Count; i++)
                        {
                            Assert.True(history[i] - history[i - 1] <= Step + 1e-6, craft + "'s history on a screen skips from UT " + history[i - 1] + " to " + history[i]);
                        }
                    }
                    var aHistory = frames.Where(f => CraftOf(f.Value) == VesselA).Select(f => f.ValidAt).ToList();
                    Assert.True(aHistory.Min() <= Step, "A's history starts at UT " + aHistory.Min());
                    Assert.True(aHistory.Max() >= End - LightMinutes30 - Step, "A's readings stopped at UT " + aHistory.Max());
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The order a switch arrives in from the game, as recorded on the Deck:
        /// the tick that names the new craft active still carries the old craft's
        /// vessel entry, and the new craft's own entry comes a tick later. The
        /// screen follows the game's word, at that tick's own instant.
        /// </summary>
        [Fact]
        public async Task TheScreenFollowsTheCraftTheGameNamesOnTheTickItNamesIt()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new LaneUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);
                const double Delay = 1.3;

                for (var ut = 1000.0; ut <= 1020.0; ut += 1.0)
                {
                    engine.SetVesselDelay(VesselB, Delay);
                    engine.WriteCraftSnapshot(VesselB, CraftOnly(ut, VesselB));
                    TickAndWaitForOutboxes(engine, ut, Named(Snap(ut, VesselA, Delay), VesselA), Timeout);
                }
                await Frames(client);

                // The game names B; the vessel entry is still A's.
                engine.SetVesselDelay(VesselB, Delay);
                TickAndWaitForOutboxes(engine, 1021.0, Named(Snap(1021.0, VesselA, Delay), VesselB), Timeout);

                var atSwitch = await Frames(client);
                var ofB = atSwitch.Where(f => CraftOf(f.Value) == VesselB).ToList();
                Assert.True(ofB.Count > 0, "the screen showed nothing of B on the tick the game named it");
                Assert.All(ofB, f => Assert.True(f.DeliveredAt >= 1021.0, "B's reading was delivered at UT " + f.DeliveredAt + ", before the tick that named B"));
                NoneEarly(atSwitch, new Dictionary<string, double> { [VesselA] = Delay, [VesselB] = Delay });
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A docking pair a few hundred metres apart, both 30 light-seconds from the
        /// centre, switched four times a few seconds apart, with the game naming
        /// each craft a tick before its own entry, as recorded on the Deck. Every
        /// switch shows the craft switched to on the tick the game names it, and no
        /// reading of either reaches the screen before its delay.
        /// </summary>
        [Fact]
        public async Task ADockingPairAtARealDelaySwitchedFourTimesNeverBlanksAndNothingArrivesEarly()
        {
            const double Delay = 30.0;
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new LaneUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);
                var delays = new Dictionary<string, double> { [VesselA] = Delay, [VesselB] = Delay };
                var entry = VesselA;
                var named = VesselA;
                var seen = new List<(double Value, double ValidAt, double DeliveredAt)>();
                void Tick(double ut)
                {
                    var other = entry == VesselA ? VesselB : VesselA;
                    engine.SetVesselDelay(other, Delay);
                    engine.WriteCraftSnapshot(other, CraftOnly(ut, other));
                    TickAndWaitForOutboxes(engine, ut, Named(Snap(ut, entry, Delay), named), Timeout);
                }

                for (var ut = 1000.0; ut <= 1060.0; ut += 1.0)
                {
                    Tick(ut);
                }
                seen.AddRange(await Frames(client));

                var ut2 = 1060.0;
                foreach (var to in new[] { VesselB, VesselA, VesselB, VesselA })
                {
                    named = to;
                    Tick(++ut2);
                    var atSwitch = await Frames(client);
                    seen.AddRange(atSwitch);
                    Assert.True(
                        atSwitch.Any(f => CraftOf(f.Value) == to),
                        "the switch to " + to + " at UT " + ut2 + " showed nothing of it");
                    entry = to;
                    for (var i = 0; i < 4; i++)
                    {
                        Tick(++ut2);
                    }
                    seen.AddRange(await Frames(client));
                }

                NoneEarly(seen, delays);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A craft no screen has ever been shown, on rails for five minutes and read
        /// every 30 UT as the background feed reads it. The first switch to it hands
        /// the screen its newest reading that has crossed, and the last few minutes
        /// of its history, at once.
        /// </summary>
        [Fact]
        public async Task TheFirstEverViewOfACraftOnRailsForMinutesShowsWhatItsLightHasBrought()
        {
            const double Delay = 30.0;
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new LaneUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);

                for (var ut = 1000.0; ut <= 1300.0; ut += 1.0)
                {
                    if ((ut - 1000.0) % 30.0 == 0.0)
                    {
                        engine.SetVesselDelay(VesselB, Delay);
                        engine.WriteCraftSnapshot(VesselB, CraftOnly(ut, VesselB));
                    }
                    TickAndWaitForOutboxes(engine, ut, Named(Snap(ut, VesselA, 5.0), VesselA), Timeout);
                }
                await Frames(client);

                TickAndWaitForOutboxes(engine, 1301.0, Named(Snap(1301.0, VesselA, 5.0), VesselB), Timeout);

                var ofB = (await Frames(client)).Where(f => CraftOf(f.Value) == VesselB).ToList();
                Assert.True(ofB.Count > 0, "the first switch to a craft on rails for five minutes showed nothing of it");
                Assert.Equal(1270.0, ofB.Max(f => f.ValidAt), 3);
                Assert.Contains(ofB, f => f.ValidAt <= 1301.0 - CraftLanePolicy.Current.FirstViewHistoryUt + 30.0);
                Assert.All(ofB, f => Assert.True(f.DeliveredAt - f.ValidAt >= Delay - 0.01, "a reading of B made at " + f.ValidAt + " reached the screen at " + f.DeliveredAt));
            }
            finally
            {
                engine.Stop();
            }
        }

        private static KspSnapshot Named(KspSnapshot snapshot, string active)
        {
            snapshot.Values["activeVessel"] = new Dictionary<string, object?> { ["vesselId"] = active, ["name"] = active };
            return snapshot;
        }

        [Fact]
        public async Task ACraftWhoseDelayWasNeverMeasuredShowsNothingAtTheSwitch()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new LaneUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);

                for (var ut = 1000.0; ut <= 1040.0; ut += 1.0)
                {
                    // B's lane is written with no delay to B ever known.
                    engine.WriteCraftSnapshot(VesselB, CraftOnly(ut, VesselB));
                    TickAndWaitForOutboxes(engine, ut, Snap(ut, VesselA, 5.0), Timeout);
                }
                await Frames(client);

                TickAndWaitForOutboxes(engine, 1041.0, Snap(1041.0, VesselB, null), Timeout);

                var atSwitch = await Frames(client);
                Assert.DoesNotContain(atSwitch, f => CraftOf(f.Value) == VesselB);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task TheActiveCraftsLaneGoesDarkWithTheActiveCraft()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new LaneUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);

                for (var ut = 1000.0; ut <= 1020.0; ut += 1.0)
                {
                    TickAndWaitForOutboxes(engine, ut, Snap(ut, VesselA, 5.0), Timeout);
                }
                await Frames(client);

                for (var ut = 1021.0; ut <= 1060.0; ut += 1.0)
                {
                    var dark = Snap(ut, VesselA, 5.0);
                    dark.Values["connected"] = false;
                    TickAndWaitForOutboxes(engine, ut, dark, Timeout);
                }

                var whileDark = await Frames(client);
                Assert.DoesNotContain(whileDark, f => f.ValidAt >= 1021.0);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ACraftsSavedTanksAreHeldInItsLaneAndReachAScreenAfterItsDelay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new LaneUplink());
            engine.Start();
            try
            {
                var savedTanks = ChannelEngine.LaneTopic(VesselB, ChannelEngine.SavedTanksFact);
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, savedTanks, Timeout);

                for (var ut = 1000.0; ut <= 1040.0; ut += 1.0)
                {
                    engine.SetVesselDelay(VesselB, 15.0);
                    engine.HoldCraftFact(VesselB, ChannelEngine.SavedTanksFact, ut, ut);
                    TickAndWaitForOutboxes(engine, ut, Snap(ut, VesselA, 5.0), Timeout);
                }

                var frames = (await DrainAllStreamDataAsync(client, Quiet)).Where(f => f.Topic == savedTanks && f.Payload != null).ToList();
                Assert.NotEmpty(frames);
                Assert.All(frames, f => Assert.True(f.Meta.DeliveredAt - f.Meta.ValidAt >= 15.0 - 0.01, "saved tanks made at " + f.Meta.ValidAt + " arrived at " + f.Meta.DeliveredAt));
                Assert.All(frames, f => Assert.Equal(f.Meta.ValidAt, Convert.ToDouble(f.Payload)));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void TheActiveCraftsLaneIsTimedByTheActiveCraftsMeasuredDelay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new LaneUplink());
            engine.Start();
            try
            {
                engine.TickAndWait(1.0, Snap(1.0, VesselA, 45.0), Timeout);
                engine.TickAndWait(2.0, Snap(2.0, VesselA, 45.0), Timeout);

                Assert.Equal(45.0, engine.LedgerDelayFor("anywhere", ChannelEngine.FleetNodePrefix + VesselA));
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class LaneUplink : ISitrepUplink
        {
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "craft-lane-test",
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
