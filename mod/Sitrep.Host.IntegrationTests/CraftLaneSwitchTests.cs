using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
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
        private const string LinkTopic = "comms.link";

        // Each craft's readings are its own base plus the instant they describe, so a frame names its craft.
        private const double BaseA = 1_000_000;
        private const double BaseB = 2_000_000;

        private static double Reading(string vessel, double ut) => (vessel == VesselA ? BaseA : BaseB) + ut;

        private static string CraftOf(double value) => value >= BaseB ? VesselB : VesselA;

        private static KspSnapshot Snap(double ut, string vessel, double? delay, bool connected = true)
        {
            var values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = vessel, ["name"] = vessel },
                    ["reading"] = Reading(vessel, ut),
                },
                ["delay"] = delay,
                ["connected"] = connected,
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

            /// <summary>Each craft whose link the test sets; a craft not named here is in contact and its link is not reported to the engine.</summary>
            public readonly Dictionary<string, bool> Connected = new Dictionary<string, bool>();

            private bool LinkUp(string craft) => !Connected.TryGetValue(craft, out var up) || up;
            public string Active = VesselA;
            public readonly ChannelEngine Engine;

            /// <summary>The craft link channel, when the test reads it: each craft says it is in contact after every tick.</summary>
            public IChannelPublisher? Link;

            public World(ChannelEngine engine) => Engine = engine;

            private void SayLinks(double ut)
            {
                if (Link is not ICraftReadingPublisher perCraft)
                {
                    return;
                }
                foreach (var craft in Delays.Keys)
                {
                    if (craft == Active)
                    {
                        Link.Publish(LinkOf(craft, LinkUp(craft)), ut);
                    }
                    else
                    {
                        perCraft.PublishFor(craft, LinkOf(craft, LinkUp(craft)), ut);
                    }
                }
            }

            /// <summary>One game tick: the active craft through the snapshot, every other craft through its lane, as the background feed writes it.</summary>
            public void Tick(double ut)
            {
                foreach (var craft in Delays)
                {
                    if (craft.Key != Active)
                    {
                        Engine.SetVesselDelay(craft.Key, craft.Value);
                        if (Connected.TryGetValue(craft.Key, out var up))
                        {
                            Engine.SetVesselConnectivity(craft.Key, up);
                        }
                        Engine.WriteCraftSnapshot(craft.Key, CraftOnly(ut, craft.Key));
                    }
                }
                TickAndWaitForOutboxes(Engine, ut, Snap(ut, Active, Delays[Active], LinkUp(Active)), Timeout);
                SayLinks(ut);
            }

            /// <summary>As <see cref="Tick"/>, with every screen's socket too busy to be handed a frame until the tick is over.</summary>
            public void TickOnBusySockets(double ut)
            {
                Engine.HoldLatestFrames(true);
                try
                {
                    foreach (var craft in Delays)
                    {
                        if (craft.Key != Active)
                        {
                            Engine.SetVesselDelay(craft.Key, craft.Value);
                            if (Connected.TryGetValue(craft.Key, out var up))
                            {
                                Engine.SetVesselConnectivity(craft.Key, up);
                            }
                            Engine.WriteCraftSnapshot(craft.Key, CraftOnly(ut, craft.Key));
                        }
                    }
                    Engine.TickAndWait(ut, Snap(ut, Active, Delays[Active], LinkUp(Active)), Timeout);
                }
                finally
                {
                    Engine.HoldLatestFrames(false);
                }
                var deadline = DateTime.UtcNow + Timeout;
                while (Engine.AnySessionHasQueuedFrames() && DateTime.UtcNow < deadline)
                {
                    Thread.Sleep(1);
                }
                SayLinks(ut);
            }
        }

        private static async Task<List<(double Value, double ValidAt, double DeliveredAt)>> Frames(TestClient client) =>
            (await DrainAllStreamDataAsync(client, Quiet))
                .Where(f => f.Topic == Topic && f.Payload != null)
                .Select(f => (Convert.ToDouble(f.Payload), f.Meta.ValidAt, f.Meta.DeliveredAt))
                .ToList();

        private static CommsLink LinkOf(string craft, bool connected) =>
            new CommsLink { Connected = connected, Meta = new PayloadMeta { Source = "vessel:" + craft } };

        /// <summary>Every frame a screen has been sent since the last drain: the craft readings, and the links each naming its craft.</summary>
        private static async Task<(List<(double Value, double ValidAt, double DeliveredAt)> Readings, List<(string Craft, bool? Connected, double ValidAt, double DeliveredAt)> Links)> Both(TestClient client) =>
            Split(await DrainAllStreamDataAsync(client, Quiet));

        private static (List<(double Value, double ValidAt, double DeliveredAt)> Readings, List<(string Craft, bool? Connected, double ValidAt, double DeliveredAt)> Links) Split(List<StreamData<object?>> drained)
        {
            var readings = drained
                .Where(f => f.Topic == Topic && f.Payload != null)
                .Select(f => (Convert.ToDouble(f.Payload), f.Meta.ValidAt, f.Meta.DeliveredAt))
                .ToList();
            var links = new List<(string Craft, bool? Connected, double ValidAt, double DeliveredAt)>();
            foreach (var f in drained.Where(f => f.Topic == LinkTopic && f.Payload != null))
            {
                using var json = JsonDocument.Parse(JsonSerializer.Serialize(f.Payload));
                var root = json.RootElement;
                var source = root.GetProperty("meta").GetProperty("source").GetString() ?? "";
                var connected = root.TryGetProperty("connected", out var c) && c.ValueKind != JsonValueKind.Null ? c.GetBoolean() : (bool?)null;
                links.Add((source.StartsWith("vessel:", StringComparison.Ordinal) ? source.Substring("vessel:".Length) : source, connected, f.Meta.ValidAt, f.Meta.DeliveredAt));
            }
            return (readings, links);
        }

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
        /// the game reported for that craft at that instant. The craft's link is
        /// shown at once too, so no screen reads as awaiting a first signal.
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
            var uplink = new LaneUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var main = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await using var station = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                var screens = new[] { main, station };
                foreach (var screen in screens)
                {
                    await SubscribeAsync(screen, Topic, Timeout);
                    await SubscribeAsync(screen, LinkTopic, Timeout);
                }
                var world = new World(engine) { Link = uplink.Link };
                world.Delays[VesselA] = LightMinutes30;
                world.Delays[VesselB] = LightMinutes30;
                var seen = new[] { new List<(double Value, double ValidAt, double DeliveredAt)>(), new List<(double Value, double ValidAt, double DeliveredAt)>() };
                var links = new[] { new List<(string Craft, bool? Connected, double ValidAt, double DeliveredAt)>(), new List<(string Craft, bool? Connected, double ValidAt, double DeliveredAt)>() };

                async Task Drain()
                {
                    for (var i = 0; i < screens.Length; i++)
                    {
                        var (readings, linkFrames) = await Both(screens[i]);
                        seen[i].AddRange(readings);
                        links[i].AddRange(linkFrames);
                    }
                }

                async Task AssertShownAtOnce(string craft, double switchUt)
                {
                    for (var i = 0; i < screens.Length; i++)
                    {
                        var (fresh, freshLinks) = await Both(screens[i]);
                        seen[i].AddRange(fresh);
                        links[i].AddRange(freshLinks);
                        Assert.True(
                            freshLinks.Any(l => l.Craft == craft && l.Connected == true),
                            "screen " + i + " was not shown " + craft + "'s link at the switch at UT " + switchUt + ", so it reads as awaiting a first signal");
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

                foreach (var linkFrames in links)
                {
                    foreach (var link in linkFrames)
                    {
                        Assert.True(
                            link.DeliveredAt - link.ValidAt >= world.Delays[link.Craft] - 0.01,
                            link.Craft + "'s link as of UT " + link.ValidAt + " reached a screen at " + link.DeliveredAt);
                    }
                }
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
        /// A reading of the craft left behind that arrives on the switch's own tick
        /// is queued for a screen whose socket is still busy, and the new craft's
        /// reading is queued behind it under the same topic. The switch back still
        /// shows the old craft's reading, so its chart has no hole at that instant.
        /// </summary>
        [Fact]
        public async Task AReadingQueuedForABusyScreenAtTheSwitchIsStillShownOnTheSwitchBack()
        {
            const double Delay = 30.0;
            const double Step = 10.0;
            const double ToB = 300.0;
            const double BackToA = 400.0;
            const double End = 600.0;

            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new LaneUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);
                var world = new World(engine);
                world.Delays[VesselA] = Delay;
                world.Delays[VesselB] = Delay;
                var seen = new List<(double Value, double ValidAt, double DeliveredAt)>();

                for (var ut = 0.0; ut < ToB; ut += Step)
                {
                    world.Tick(ut);
                }
                seen.AddRange(await Frames(client));

                world.Active = VesselB;
                world.TickOnBusySockets(ToB);
                for (var ut = ToB + Step; ut < BackToA; ut += Step)
                {
                    world.Tick(ut);
                }
                seen.AddRange(await Frames(client));

                world.Active = VesselA;
                world.Tick(BackToA);
                for (var ut = BackToA + Step; ut <= End; ut += Step)
                {
                    world.Tick(ut);
                }
                seen.AddRange(await Frames(client));

                var history = seen.Where(f => CraftOf(f.Value) == VesselA).Select(f => f.ValidAt).Distinct().OrderBy(v => v).ToList();
                for (var i = 1; i < history.Count; i++)
                {
                    Assert.True(history[i] - history[i - 1] <= Step + 1e-6, "A's history on the screen skips from UT " + history[i - 1] + " to " + history[i]);
                }
                Assert.Contains(ToB - Delay, history);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A craft out of contact keeps saying so into its own link lane, and that
        /// report is not held by the blackout it reports. A switch to the craft
        /// shows its link lost, as of what its last light brought, rather than the
        /// link it had before it went quiet.
        /// </summary>
        [Fact]
        public async Task ABackgroundCraftsLostLinkIsShownOnTheSwitchToIt()
        {
            const double Delay = 10.0;
            const double LostAt = 100.0;
            const double ToB = 200.0;

            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new LaneUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, LinkTopic, Timeout);
                var world = new World(engine) { Link = uplink.Link };
                world.Delays[VesselA] = Delay;
                world.Delays[VesselB] = Delay;

                for (var ut = 0.0; ut < LostAt; ut += 10.0)
                {
                    world.Tick(ut);
                }
                world.Connected[VesselB] = false;
                for (var ut = LostAt; ut < ToB; ut += 10.0)
                {
                    world.Tick(ut);
                }
                await Both(client);

                world.Active = VesselB;
                world.Tick(ToB);
                var drained = await DrainAllStreamDataAsync(client, Quiet);
                var (_, links) = Split(drained);

                var shown = links.Where(l => l.Craft == VesselB).ToList();
                // A report of the link is the answer itself, never a reading held back by the blackout it reports.
                Assert.All(
                    drained.Where(f => f.Topic == LinkTopic && f.Payload != null),
                    f => Assert.True(
                        f.Meta.Staleness != Staleness.Held && f.Meta.Staleness != Staleness.LastBeforeBlackout,
                        "B's link as of UT " + f.Meta.ValidAt + " reached the screen marked " + f.Meta.Staleness));
                Assert.NotEmpty(shown);
                var newest = shown.OrderBy(l => l.ValidAt).Last();
                Assert.True(
                    newest.Connected == false && newest.ValidAt >= LostAt,
                    "the switch to B showed its link as " + newest.Connected + " as of UT " + newest.ValidAt + ", though B lost it at UT " + LostAt);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The crew aboard the active craft read it with no delay through its
        /// blackout, from its lane as every screen now does: its readings as it
        /// takes them, and its link as up with no route home. A screen at any
        /// other vantage reads the link lost.
        /// </summary>
        [Fact]
        public async Task TheOwnSeatReadsItsCraftsLaneLiveThroughABlackout()
        {
            const double Delay = 10.0;
            const double LostAt = 100.0;
            const double End = 200.0;

            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new LaneUplink();
            engine.RegisterUplink(uplink);
            engine.RegisterCommandCentreSource(new SeatOf(VesselA));
            engine.Start();
            try
            {
                var world = new World(engine) { Link = uplink.Link };
                world.Delays[VesselA] = Delay;
                // The seat is a centre once a tick has listed it, so it can be chosen as a vantage.
                world.Tick(0.0);
                await using var seat = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await seat.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "vessel:" + VesselA }));
                await SubscribeAsync(seat, Topic, Timeout);
                await SubscribeAsync(seat, LinkTopic, Timeout);
                await using var ground = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(ground, LinkTopic, Timeout);

                for (var ut = 10.0; ut < LostAt; ut += 10.0)
                {
                    world.Tick(ut);
                }
                world.Connected[VesselA] = false;
                for (var ut = LostAt; ut <= End; ut += 10.0)
                {
                    world.Tick(ut);
                }

                var (readings, seatLinks) = await Both(seat);
                var (_, groundLinks) = await Both(ground);

                Assert.True(
                    readings.Any(f => f.ValidAt > LostAt && f.DeliveredAt - f.ValidAt < 0.01),
                    "the seat read no reading of A taken in its blackout as it was taken: "
                    + string.Join(", ", readings.Select(f => f.ValidAt + "@" + f.DeliveredAt)));
                Assert.True(
                    seatLinks.Any(l => l.Connected == true && l.ValidAt >= LostAt),
                    "the seat did not read A's link as up in its blackout: "
                    + string.Join(", ", seatLinks.Select(l => l.Connected + " " + l.ValidAt + "@" + l.DeliveredAt)));
                Assert.True(
                    groundLinks.Any(l => l.Connected == false && l.ValidAt >= LostAt),
                    "the ground did not read A's link lost: "
                    + string.Join(", ", groundLinks.Select(l => l.Connected + " " + l.ValidAt + "@" + l.DeliveredAt)));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A screen watching the active craft moves from a near command centre to
        /// one farther from the craft, and back. At the far centre nothing reaches
        /// it before the far centre's own delay: it is shown what has arrived
        /// there, which steps back from what the near centre had, and goes on from
        /// it with no hole. Back at the near centre it is shown at once what has
        /// arrived there, and the readings it missed fill in, none twice.
        /// </summary>
        [Fact]
        public async Task AScreenThatMovesToAFartherCentreAndBackIsShownEachCentresOwnArrivals()
        {
            const string Near = "centre.near";
            const string Far = "centre.far";
            const double NearDelay = 10.0;
            const double FarDelay = 40.0;
            const double Step = 2.0;
            const double ToFar = 300.0;
            const double BackToNear = 500.0;
            const double End = 600.0;

            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new LaneUplink());
            engine.RegisterCommandCentreSource(new GroundCentres(Near, Far));
            engine.Start();
            try
            {
                var world = new World(engine);
                world.Delays[VesselA] = NearDelay;
                world.Tick(0.0);
                engine.SetAuthorityDelays(new[] { (Near, VesselA, NearDelay), (Far, VesselA, FarDelay) });

                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = Near }));
                await SubscribeAsync(client, Topic, Timeout);

                // As a screen's client moves: the new centre, then each topic subscribed again, since the mod reads the centre when a topic is subscribed.
                async Task MoveTo(string centre)
                {
                    await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = centre }));
                    await client.SendAsync(EnvelopeCodec.WriteUnsubscribe(new Unsubscribe { Topic = Topic }));
                    await client.SendAsync(EnvelopeCodec.WriteSubscribe(new Subscribe { Topic = Topic }));
                }

                for (var ut = Step; ut <= ToFar; ut += Step)
                {
                    world.Tick(ut);
                }
                var atNear = await Delivered(client);

                await MoveTo(Far);
                for (var ut = ToFar + Step; ut <= BackToNear; ut += Step)
                {
                    world.Tick(ut);
                }
                var atFar = await Delivered(client);

                await MoveTo(Near);
                for (var ut = BackToNear + Step; ut <= End; ut += Step)
                {
                    world.Tick(ut);
                }
                var backAtNear = await Delivered(client);

                var delays = new Dictionary<string, double> { [Near] = NearDelay, [Far] = FarDelay };
                void NoneEarly(IEnumerable<(double ValidAt, double DeliveredAt, string Vantage)> frames)
                {
                    foreach (var frame in frames)
                    {
                        Assert.True(delays.ContainsKey(frame.Vantage), "a reading reached the screen from " + frame.Vantage);
                        Assert.True(
                            frame.DeliveredAt - frame.ValidAt >= delays[frame.Vantage] - 0.01,
                            "a reading made at UT " + frame.ValidAt + " reached the screen at " + frame.Vantage + " at " + frame.DeliveredAt
                            + ", before that centre's delay of " + delays[frame.Vantage] + " s");
                    }
                }

                void NoHole(IEnumerable<double> validAts, string what)
                {
                    var history = validAts.Distinct().OrderBy(v => v).ToList();
                    for (var i = 1; i < history.Count; i++)
                    {
                        Assert.True(history[i] - history[i - 1] <= Step + 1e-6, what + " skips from UT " + history[i - 1] + " to " + history[i]);
                    }
                }

                NoneEarly(atNear.Concat(atFar).Concat(backAtNear));
                var fromFar = atFar.Where(f => f.Vantage == Far).ToList();
                var backFromNear = backAtNear.Where(f => f.Vantage == Near).ToList();

                // Each move shows what has already arrived at the new centre, no older than its own light allows.
                Assert.True(
                    fromFar.Count > 0 && fromFar.Min(f => f.ValidAt) <= ToFar - FarDelay + Step,
                    "the far centre was not shown A as its light had brought it; after the move the screen was sent: "
                    + string.Join(", ", atFar.Take(12).Select(f => f.ValidAt + "@" + f.DeliveredAt + " " + f.Vantage)));
                Assert.True(backFromNear.Max(f => f.ValidAt) >= End - NearDelay - Step, "back at the near centre, A's readings stopped at UT " + backFromNear.Max(f => f.ValidAt));

                NoHole(fromFar.Select(f => f.ValidAt), "the far centre's history");
                NoHole(atNear.Concat(atFar).Concat(backAtNear).Select(f => f.ValidAt), "the screen's history");

                // Back at the near centre the readings it missed are filled in once each.
                var repeated = backFromNear.GroupBy(f => f.ValidAt).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
                Assert.True(repeated.Count == 0, "back at the near centre these readings were sent twice: " + string.Join(", ", repeated));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>Each craft reading a screen has been sent since the last drain, with the centre it was delivered to.</summary>
        private static async Task<List<(double ValidAt, double DeliveredAt, string Vantage)>> Delivered(TestClient client) =>
            (await DrainAllStreamDataAsync(client, Quiet))
                .Where(f => f.Topic == Topic && f.Payload != null)
                .Select(f => (f.Meta.ValidAt, f.Meta.DeliveredAt, f.Meta.Vantage ?? ""))
                .ToList();

        private sealed class GroundCentres : ICommandCentreSource
        {
            private readonly string[] _ids;

            public GroundCentres(params string[] ids) => _ids = ids;

            public string ProviderId => "craft-lane-centres-test";

            public IEnumerable<ICommandCentre> Enumerate() => _ids.Select(id => (ICommandCentre)new Centre(id));

            private sealed class Centre : ICommandCentre
            {
                public Centre(string id) => Id = id;

                public string Id { get; }
                public string DisplayName => Id;
                public CommandCentreKind Kind => CommandCentreKind.GroundStation;
                public int? BodyIndex => null;
                public double? Latitude => null;
                public double? Longitude => null;
                public bool IsActiveNow() => true;
            }
        }

        private sealed class SeatOf : ICommandCentreSource
        {
            private readonly string _craft;

            public SeatOf(string craft) => _craft = craft;

            public string ProviderId => "craft-lane-seat-test";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                yield return new Centre("vessel:" + _craft);
            }

            private sealed class Centre : ICommandCentre
            {
                public Centre(string id) => Id = id;

                public string Id { get; }
                public string DisplayName => "Seat";
                public CommandCentreKind Kind => CommandCentreKind.CrewedVessel;
                public int? BodyIndex => null;
                public double? Latitude => null;
                public double? Longitude => null;
                public bool IsActiveNow() => true;
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
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Discrete,
                        Topic = LinkTopic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.Delayed,
                        FollowsActiveCraft = true,
                    },
                },
            };

            public IChannelPublisher? Link { get; private set; }

            public void Register(IUplinkHost host)
            {
                Link = host.Publisher(LinkTopic);
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
