using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// <c>target.available</c> is the active craft's own list: each other craft
    /// as that craft knows it, by whichever of physics range, a direct radio
    /// link and its command centre tells it soonest.
    ///
    /// <para>The engine's home centre here is the one the scripted game calls
    /// far, five light-minutes from the relay. The active craft is one
    /// light-second from it. A session reads the craft's list one second
    /// after the craft holds it.</para>
    /// </summary>
    public class CraftTargetKnowledgeTests
    {
        private const double T0 = 1000.0;

        private const string Far = ScriptedContactGame.Far;
        private const string Relay = ScriptedContactGame.RelayGuid;

        private sealed class Seated : System.IAsyncDisposable
        {
            public ReckonedVantageWorld World = null!;
            public TestClient Client = null!;
            public CentreView View = null!;

            public async Task TickAsync(params double[] uts)
            {
                foreach (var ut in uts)
                {
                    World.Tick(ut);
                }
                await ReckonedVantageWorld.SettleAsync(Client, View);
            }

            public async ValueTask DisposeAsync()
            {
                await Client.DisposeAsync();
                await World.DisposeAsync();
            }
        }

        private static async Task<Seated> WatchingAsync(ScriptedContactGame game)
        {
            var world = await ReckonedVantageWorld.StartAsync(game);
            var (client, view) = await world.SitDownAtAsync(Far, ContactPlanSource.TargetsTopic);
            return new Seated { World = world, Client = client, View = view };
        }

        private static JsonElement[] Entries(CentreView view)
        {
            var payload = view.Latest(ContactPlanSource.TargetsTopic);
            if (payload == null)
            {
                return new JsonElement[0];
            }
            using var doc = JsonDocument.Parse(payload);
            return doc.RootElement.GetProperty("entries").EnumerateArray().Select(e => e.Clone()).ToArray();
        }

        private static JsonElement? RelayEntry(CentreView view)
        {
            foreach (var entry in Entries(view))
            {
                if (entry.GetProperty("kind").GetInt32() == (int)TargetKind.Vessel && entry.GetProperty("vesselId").GetString() == Relay)
                {
                    return entry;
                }
            }
            return null;
        }

        private static double Sma(CentreView view) => RelayEntry(view)!.Value.GetProperty("orbit").GetProperty("sma").GetDouble();

        private static TargetKnowledge Source(CentreView view) => (TargetKnowledge)RelayEntry(view)!.Value.GetProperty("source").GetInt32();

        [Fact]
        public async Task ACraftDoesNotKnowOfAnotherUntilItsCommandCentreHasToldIt()
        {
            await using var seated = await WatchingAsync(new ScriptedContactGame());
            await seated.TickAsync(1, 2, 3, 299);
            Reckoned.True(RelayEntry(seated.View) == null, "the craft's target list named a craft before its command centre could know of it");
            Assert.Contains(Entries(seated.View), e => e.GetProperty("kind").GetInt32() == (int)TargetKind.Body);

            await seated.TickAsync(301, 302, 303, 305, 306);
            var relay = RelayEntry(seated.View);
            Assert.NotNull(relay);
            Assert.Equal(TargetKnowledge.CommandCentre, Source(seated.View));
            Assert.Equal(Far, relay!.Value.GetProperty("via").GetString());
            Assert.True(relay.Value.GetProperty("asOfUt").GetDouble() <= 3.0);
            Assert.Equal(JsonValueKind.Null, relay.Value.GetProperty("distance").ValueKind);
            Assert.True(relay.Value.GetProperty("isCurrent").GetBoolean());
        }

        /// <summary>
        /// The relay burns. The craft's command centre learns of it five
        /// light-minutes later and tells the craft, a light-second up its
        /// control route, and a session reads the craft's list a light-second
        /// after that. Nothing on the list moves sooner.
        /// </summary>
        [Fact]
        public async Task WhatACraftKnowsOfAnotherIsWhatItsCommandCentreKnewOneControlRouteAgo()
        {
            await using var seated = await WatchingAsync(new ScriptedContactGame());
            await seated.TickAsync(1, 2, 700, 702, 704, 706, 708);
            var before = Sma(seated.View);

            seated.World.Game.BurnRelay(T0);
            await seated.TickAsync(T0, T0 + 2, T0 + 12, T0 + 299);
            Reckoned.True(Sma(seated.View) == before, "the craft's target list showed a burn before its command centre could have told it");

            await seated.TickAsync(T0 + 301, T0 + 302, T0 + 304, T0 + 306, T0 + 308);
            Reckoned.True(Sma(seated.View) != before, "the craft's target list had not taken a burn its command centre had told it of");
            Assert.Equal(TargetKnowledge.CommandCentre, Source(seated.View));
            Assert.Equal(T0, RelayEntry(seated.View)!.Value.GetProperty("asOfUt").GetDouble(), 0);
        }

        [Fact]
        public async Task ACraftWithADirectLinkToAnotherKnowsItOneLightTimeOfThatLinkAgo()
        {
            await using var seated = await WatchingAsync(new ScriptedContactGame { ActiveLinkedToRelaySeconds = 50.0 });
            await seated.TickAsync(1, 2, 700, 702, 704, 706, 708);
            var before = Sma(seated.View);

            seated.World.Game.BurnRelay(T0);
            await seated.TickAsync(T0, T0 + 2, T0 + 49);
            Reckoned.True(Sma(seated.View) == before, "the craft's target list showed a burn before the other craft's own light could reach it");

            await seated.TickAsync(T0 + 51, T0 + 52, T0 + 54, T0 + 56);
            Reckoned.True(Sma(seated.View) != before, "the craft's target list had not taken a burn it had heard of directly");
            Assert.Equal(TargetKnowledge.DirectLink, Source(seated.View));
            Assert.Equal(JsonValueKind.Null, RelayEntry(seated.View)!.Value.GetProperty("via").ValueKind);
        }

        /// <summary>
        /// The relay is coasting and says nothing new. While its link to the
        /// craft is up that silence is itself word, one light-time old, that
        /// nothing has changed; once the link is gone it is word of nothing.
        /// </summary>
        [Fact]
        public async Task ACraftHoldingALiveLinkToAnotherKnowsItUnchangedToOneLightTimeAgoAndNoLaterOnceTheLinkIsGone()
        {
            var game = new ScriptedContactGame { ActiveLinkedToRelaySeconds = 50.0 };
            await using var seated = await WatchingAsync(game);
            await seated.TickAsync(1, 2, 700, 702, 704, 706, 708, T0, T0 + 2, T0 + 4);
            var entry = RelayEntry(seated.View)!.Value;
            var asOf = entry.GetProperty("asOfUt").GetDouble();

            var unchangedTo = entry.GetProperty("unchangedToUt").GetDouble();
            Reckoned.True(unchangedTo > asOf, "the relay's last word was as late as the silence since, so this test shows nothing");
            Reckoned.True(unchangedTo > T0 - 60.0 && unchangedTo <= T0 + 4 - 50.0,
                "a craft with a live link to a coasting craft did not know it unchanged to one light-time ago: " + unchangedTo);

            game.ActiveLinkedToRelaySeconds = null;
            await seated.TickAsync(T0 + 500, T0 + 502, T0 + 504, T0 + 506);
            var after = RelayEntry(seated.View)!.Value.GetProperty("unchangedToUt").GetDouble();
            Reckoned.True(after <= T0 + 6 - 50.0, "silence on a link that had gone was taken as word that nothing changed: " + after);
        }

        /// <summary>
        /// The relay is coasting, its word five minutes on its way to the
        /// craft's command centre, whose own word takes a light-second up the
        /// control route. The centre holds the relay's link as up and hears
        /// nothing new, so it knows the relay unchanged as late as the last
        /// word its own plan has arrived, and the craft knows that a second
        /// later. Once the centre holds the link as down its silence is word
        /// of nothing, and the craft's figure stops where the centre's did.
        /// </summary>
        [Fact]
        public async Task ACraftKnowsAnotherUnchangedAsLateAsItsCommandCentreCouldAndNoLaterOnceThatCentreHoldsTheLinkDown()
        {
            var game = new ScriptedContactGame();
            await using var seated = await WatchingAsync(game);
            // The centre is looked at as the relay's first word reaches it, at 301, so the time that word took is measured as it was.
            await seated.TickAsync(1, 2, 300, 301, 302, 700, 702, 704, 706, 708, T0, T0 + 2, T0 + 4, T0 + 6, T0 + 8);
            Assert.Equal(TargetKnowledge.CommandCentre, Source(seated.View));
            var early = RelayEntry(seated.View)!.Value;
            Assert.Equal(700.0, early.GetProperty("asOfUt").GetDouble());
            // The centre's own plan has a word that left the relay at 700 still on its way, some 557 s of waiting and flight, so its silence says nothing yet.
            Assert.Equal(System.Text.Json.JsonValueKind.Null, early.GetProperty("unchangedToUt").ValueKind);

            // The relay's link drops at 1010, which the centre learns 300 s later.
            game.RelayConnected = false;
            await seated.TickAsync(T0 + 10, T0 + 12, T0 + 260, T0 + 262, T0 + 264, T0 + 266, T0 + 268, T0 + 270);
            var unchangedTo = RelayEntry(seated.View)!.Value.GetProperty("unchangedToUt").GetDouble();
            // The centre still holds the link as up, and by its plan the words sent as late as 708 are in and none sent since.
            Reckoned.True(unchangedTo > 700.0 && unchangedTo <= 708.0, "the craft did not know the relay unchanged as late as its command centre did: " + unchangedTo);

            // By 1600 the plan would have the words sent to 1012 arrived, were the link still held as up.
            await seated.TickAsync(T0 + 308, T0 + 310, T0 + 312, T0 + 314, T0 + 600, T0 + 602, T0 + 604, T0 + 606, T0 + 608, T0 + 610);
            var after = RelayEntry(seated.View)!.Value;
            Assert.Equal(700.0, after.GetProperty("asOfUt").GetDouble());
            Assert.Equal(708.0, after.GetProperty("unchangedToUt").GetDouble());
        }

        [Fact]
        public async Task ACraftSeesAnotherWithinPhysicsRangeAsItIs()
        {
            await using var seated = await WatchingAsync(new ScriptedContactGame { RelayInRange = true });
            await seated.TickAsync(1, 2, 3, 4, 5);

            var relay = RelayEntry(seated.View);
            Assert.NotNull(relay);
            Assert.Equal(TargetKnowledge.InRange, Source(seated.View));
            Assert.Equal(2500.0, relay!.Value.GetProperty("distance").GetDouble());
            var before = Sma(seated.View);

            seated.World.Game.BurnRelay(T0);
            await seated.TickAsync(T0, T0 + 2, T0 + 3, T0 + 4);
            Reckoned.True(Sma(seated.View) != before, "a craft beside another did not see it burn");
        }

        /// <summary>
        /// The craft loses its route home and has nothing in range. It learns
        /// nothing more: when its link returns, the list it held through the
        /// outage is the one from before it, and the burn made meanwhile is on
        /// it only once its centre has told it again.
        /// </summary>
        [Fact]
        public async Task ACraftWithNoRouteKeepsTheListItLastHad()
        {
            await using var seated = await WatchingAsync(new ScriptedContactGame());
            await seated.TickAsync(1, 2, 700, 702, 704, 706, 708);
            var before = Sma(seated.View);

            seated.World.Game.ActiveConnected = false;
            await seated.TickAsync(800, 802);
            seated.World.Game.BurnRelay(T0);
            await seated.TickAsync(T0, T0 + 2, T0 + 400, T0 + 402);
            Assert.Equal(before, Sma(seated.View));

            seated.World.Game.ActiveConnected = true;
            await seated.TickAsync(T0 + 500, T0 + 502, T0 + 504, T0 + 506, T0 + 508);
            Reckoned.True(Sma(seated.View) != before, "the craft's list had not taken what its centre knew once its route was back");
        }
    }
}
