using System.Collections.Generic;
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
    /// <c>comms.delay</c>, <c>comms.signal</c> and <c>comms.degrade</c> are
    /// each command centre's own. The delay is the light-time of the path that
    /// centre believes in. The signal and its grading are the active craft's
    /// own reading of its whole path, which reaches a centre no sooner than
    /// light from the farthest node on that path.
    ///
    /// <para>The active craft is one light-second from both centres. The relay
    /// is ten light-minutes from the home centre and five from the far one.</para>
    /// </summary>
    public class CentreLinkReadingsTests
    {
        private const double T0 = 1000.0;

        private const string Home = ScriptedContactGame.Home;
        private const string Far = ScriptedContactGame.Far;

        private static readonly string[] Readings =
        {
            ContactPlanSource.DelayTopic, ContactPlanSource.SignalTopic, ContactPlanSource.DegradeTopic,
        };

        private sealed class Seated : System.IAsyncDisposable
        {
            public ReckonedVantageWorld World = null!;
            public TestClient HomeClient = null!;
            public CentreView HomeView = null!;
            public TestClient FarClient = null!;
            public CentreView FarView = null!;

            public async Task TickAsync(params double[] uts)
            {
                foreach (var ut in uts)
                {
                    World.Tick(ut);
                }
                await Task.WhenAll(
                    ReckonedVantageWorld.SettleAsync(HomeClient, HomeView),
                    ReckonedVantageWorld.SettleAsync(FarClient, FarView));
            }

            public async ValueTask DisposeAsync()
            {
                await HomeClient.DisposeAsync();
                await FarClient.DisposeAsync();
                await World.DisposeAsync();
            }
        }

        private static async Task<Seated> SeatedAsync(ContactRadio? radio = null)
        {
            var world = await ReckonedVantageWorld.StartAsync();
            world.Game.Radio = radio;
            var (homeClient, homeView) = await world.SitDownAtAsync(Home, Readings);
            var (farClient, farView) = await world.SitDownAtAsync(Far, Readings);
            return new Seated { World = world, HomeClient = homeClient, HomeView = homeView, FarClient = farClient, FarView = farView };
        }

        private static double? Delay(CentreView view)
        {
            var payload = view.Latest(ContactPlanSource.DelayTopic);
            if (payload == null)
            {
                return null;
            }
            using var doc = JsonDocument.Parse(payload);
            var seconds = doc.RootElement.GetProperty("oneWaySeconds");
            return seconds.ValueKind == JsonValueKind.Null ? (double?)null : seconds.GetDouble();
        }

        private static double PathSeconds(CentreView view)
        {
            using var doc = JsonDocument.Parse(view.Path!);
            var metres = doc.RootElement.GetProperty("hops").EnumerateArray().Sum(h => h.GetProperty("distanceMeters").GetDouble());
            return metres / SignalDelay.SpeedOfLightMetersPerSecond * ScriptedContactGame.LightFactor;
        }

        private static double? Strength(CentreView view)
        {
            var payload = view.Latest(ContactPlanSource.SignalTopic);
            if (payload == null)
            {
                return null;
            }
            using var doc = JsonDocument.Parse(payload);
            return doc.RootElement.GetProperty("strength").GetDouble();
        }

        private static double? Level(CentreView view)
        {
            var payload = view.Latest(ContactPlanSource.DegradeTopic);
            if (payload == null)
            {
                return null;
            }
            using var doc = JsonDocument.Parse(payload);
            var level = doc.RootElement.GetProperty("level");
            return level.ValueKind == JsonValueKind.Null ? (double?)null : level.GetDouble();
        }

        private static ContactRadio Direct(double strength) => new ContactRadio(
            ScriptedContactGame.Active,
            true,
            strength,
            new CommsDegrade { ModelId = "test", ModelName = "Test grading", Level = 1.0 - strength },
            new[] { new RadioHop(ScriptedContactGame.ActiveGuid, ScriptedContactGame.HomeName, false) });

        private static ContactRadio ThroughTheRelay(double strength) => new ContactRadio(
            ScriptedContactGame.Active,
            true,
            strength,
            new CommsDegrade { ModelId = "test", ModelName = "Test grading", Level = 1.0 - strength },
            new[]
            {
                new RadioHop(ScriptedContactGame.ActiveGuid, ScriptedContactGame.RelayGuid, true),
                new RadioHop(ScriptedContactGame.RelayGuid, ScriptedContactGame.HomeName, false),
            });

        [Fact]
        public async Task ACentresDelayIsTheLightTimeOfThePathItIsShown()
        {
            await using var seated = await SeatedAsync();
            await seated.TickAsync(1, 2, 700, 702);

            var home = Delay(seated.HomeView);
            var far = Delay(seated.FarView);
            Assert.NotNull(home);
            Assert.NotNull(far);
            Assert.Equal(PathSeconds(seated.HomeView), home!.Value, 0);
            Assert.Equal(PathSeconds(seated.FarView), far!.Value, 0);
            Assert.NotEqual(home.Value, far.Value, 0);

            var (validAt, deliveredAt) = seated.HomeView.Stamps[ContactPlanSource.DelayTopic];
            Assert.Equal(validAt, deliveredAt);
        }

        /// <summary>
        /// The relay is destroyed, so the game's own path for the active craft,
        /// and with it the game's own delay, is gone that instant. A centre's
        /// delay stays the light-time of the path it still believes in until
        /// the relay's silence could have reached it.
        /// </summary>
        [Fact]
        public async Task ACentresDelayHoldsUntilTheNewsThatChangesItsPathArrives()
        {
            await using var seated = await SeatedAsync();
            await seated.TickAsync(1, 2, 700, 702);
            Assert.NotNull(Delay(seated.HomeView));

            seated.World.Game.DestroyRelay();
            await seated.TickAsync(T0, T0 + 2, T0 + 12, T0 + 299);
            Assert.NotNull(Delay(seated.FarView));
            Assert.NotNull(Delay(seated.HomeView));

            await seated.TickAsync(T0 + 301, T0 + 302, T0 + 304);
            Assert.Null(Delay(seated.FarView));
            Reckoned.True(Delay(seated.HomeView) != null, "the home centre's delay went when the far centre heard the relay was gone");

            await seated.TickAsync(T0 + 599);
            Reckoned.True(Delay(seated.HomeView) != null, "the home centre's delay went one second before the relay's silence could reach it");

            await seated.TickAsync(T0 + 601, T0 + 602, T0 + 604);
            Assert.Null(Delay(seated.HomeView));
        }

        /// <summary>
        /// The craft's radio reads its whole path at once, far hops included.
        /// The craft is a second away, so its reading would tell a centre what
        /// the relay's link is doing minutes before the relay's own light
        /// could. It does not: it arrives when the relay's light does.
        /// </summary>
        [Fact]
        public async Task AReadingOfAPathThroughARelayReachesACentreNoSoonerThanTheRelaysLight()
        {
            await using var seated = await SeatedAsync(Direct(0.9));
            await seated.TickAsync(1, 2, 3, 4, 700, 702);
            Assert.Equal(0.9, Strength(seated.HomeView)!.Value, 6);
            Assert.Equal(0.9, Strength(seated.FarView)!.Value, 6);
            Assert.Equal(0.1, Level(seated.FarView)!.Value, 6);

            seated.World.Game.Radio = ThroughTheRelay(0.5);
            await seated.TickAsync(T0, T0 + 2, T0 + 12, T0 + 299);
            Reckoned.True(Strength(seated.FarView) == 0.9, "the far centre was shown a reading of the relay's hop before the relay's light could reach it");
            Reckoned.True(System.Math.Abs(Level(seated.FarView)!.Value - 0.1) < 1e-9, "the far centre was shown a grading of the relay's hop before the relay's light could reach it");
            Reckoned.True(Strength(seated.HomeView) == 0.9, "the home centre was shown a reading of the relay's hop within seconds");

            await seated.TickAsync(T0 + 301, T0 + 302, T0 + 304);
            Assert.Equal(0.5, Strength(seated.FarView)!.Value, 6);
            Assert.Equal(0.5, Level(seated.FarView)!.Value, 6);
            Reckoned.True(Strength(seated.HomeView) == 0.9, "the home centre's reading moved when the far centre heard it");

            await seated.TickAsync(T0 + 599);
            Reckoned.True(Strength(seated.HomeView) == 0.9, "the home centre's reading moved one second before the relay's light could reach it");

            await seated.TickAsync(T0 + 601, T0 + 602, T0 + 604);
            Assert.Equal(0.5, Strength(seated.HomeView)!.Value, 6);
        }

        private static ContactRadio ThroughTheRelayOnBand(string band) => new ContactRadio(
            ScriptedContactGame.Active,
            true,
            0.5,
            new CommsDegrade { ModelId = "test", ModelName = "Test grading", Level = 0.5 },
            new[]
            {
                new RadioHop(
                    ScriptedContactGame.ActiveGuid,
                    ScriptedContactGame.RelayGuid,
                    true,
                    new Dictionary<string, object?> { ["test"] = new Dictionary<string, object?> { ["band"] = band } }),
                new RadioHop(ScriptedContactGame.RelayGuid, ScriptedContactGame.HomeName, false),
            });

        /// <summary>The band the first hop of the centre's path says it is on, or null when the hop carries no facts.</summary>
        private static string? Band(CentreView view)
        {
            using var doc = JsonDocument.Parse(view.Path!);
            var hop = doc.RootElement.GetProperty("hops")[0];
            return hop.TryGetProperty("extensions", out var bag)
                ? bag.GetProperty("test").GetProperty("band").GetString()
                : null;
        }

        /// <summary>
        /// A comms backend's own facts about a hop are the craft's radio's to
        /// state. A centre's path carries them once the reading that states
        /// them has reached that centre, on the hop it was measured over, and a
        /// change in them arrives the same way.
        /// </summary>
        [Fact]
        public async Task AHopOnACentresPathCarriesTheBackendsFactsAsThatCentreHeardThem()
        {
            await using var seated = await SeatedAsync(ThroughTheRelayOnBand("S"));
            await seated.TickAsync(1, 2, 299);
            await seated.TickAsync(700, 702, 704);
            Assert.Equal("S", Band(seated.HomeView));
            Assert.Equal("S", Band(seated.FarView));
            using (var doc = JsonDocument.Parse(seated.HomeView.Path!))
            {
                Assert.False(doc.RootElement.GetProperty("hops")[1].TryGetProperty("extensions", out _));
            }

            seated.World.Game.Radio = ThroughTheRelayOnBand("X");
            await seated.TickAsync(T0, T0 + 2, T0 + 12, T0 + 299);
            Reckoned.True(Band(seated.FarView) == "S", "the far centre's path showed a hop's new band before the reading of it could arrive");

            await seated.TickAsync(T0 + 301, T0 + 302, T0 + 304);
            Assert.Equal("X", Band(seated.FarView));
            Reckoned.True(Band(seated.HomeView) == "S", "the home centre's path showed a hop's new band when the far centre heard of it");

            await seated.TickAsync(T0 + 601, T0 + 602, T0 + 604);
            Assert.Equal("X", Band(seated.HomeView));
        }

        [Fact]
        public async Task AHopNoReadingWasMeasuredOverCarriesNoFacts()
        {
            await using var seated = await SeatedAsync(Direct(0.9));
            await seated.TickAsync(1, 2, 3, 4, 700, 702);

            Assert.Null(Band(seated.HomeView));
        }

        [Fact]
        public async Task AReadingOverADirectPathArrivesAtTheCraftsOwnLightTime()
        {
            await using var seated = await SeatedAsync(Direct(0.9));
            await seated.TickAsync(1, 2, 3, 4, 700, 702);

            seated.World.Game.Radio = Direct(0.4);
            await seated.TickAsync(T0, T0 + 0.5);
            Assert.Equal(0.9, Strength(seated.HomeView)!.Value, 6);

            await seated.TickAsync(T0 + 2, T0 + 3, T0 + 4);
            Assert.Equal(0.4, Strength(seated.HomeView)!.Value, 6);
            Assert.Equal(0.4, Strength(seated.FarView)!.Value, 6);
        }

        private static ContactRadio Lost() => new ContactRadio(
            ScriptedContactGame.Active,
            false,
            0.0,
            new CommsDegrade { ModelId = "test", ModelName = "Test grading", Level = 1.0 },
            new RadioHop[0]);

        /// <summary>
        /// The craft's link goes. Its radio then reads nothing at all, and that
        /// reading is how a centre learns the strength fell to nothing: it
        /// arrives one light-time after the loss, as the news that the link is
        /// down does, and the last good reading does not stand through the
        /// outage.
        /// </summary>
        [Theory]
        [InlineData(false)]
        [InlineData(true)]
        public async Task TheReadingThatTheLinkHasGoneArrivesOneLightTimeAfterTheLoss(bool pathBreaks)
        {
            await using var seated = await SeatedAsync(Direct(0.9));
            await seated.TickAsync(1, 2, 3, 4, 700, 702);
            Assert.Equal(0.9, Strength(seated.HomeView)!.Value, 6);

            seated.World.Game.ActiveConnected = false;
            seated.World.Game.Radio = Lost();
            if (pathBreaks)
            {
                seated.World.Game.BreakActivePath(0.5);
            }
            await seated.TickAsync(T0, T0 + 0.5);
            Reckoned.True(Strength(seated.HomeView) == 0.9, "a centre learned the strength had gone before the light of the loss could arrive");

            await seated.TickAsync(T0 + 2, T0 + 3, T0 + 4, T0 + 5);
            Assert.Equal(0.0, Strength(seated.HomeView)!.Value, 6);
            Assert.Equal(1.0, Level(seated.HomeView)!.Value, 6);
            Assert.Equal(0.0, Strength(seated.FarView)!.Value, 6);

            // And when the link is back, the first reading taken in contact arrives as any does.
            seated.World.Game.ActiveConnected = true;
            seated.World.Game.Radio = Direct(0.7);
            await seated.TickAsync(T0 + 100, T0 + 102, T0 + 103, T0 + 104);
            Assert.Equal(0.7, Strength(seated.HomeView)!.Value, 6);
        }

        /// <summary>
        /// A craft that has just been put on screen reads no link for the look
        /// it takes the game to bring its radio up. That one look is not the
        /// link having gone, and no centre is told the strength fell to
        /// nothing. A craft that still reads no link on the next look is
        /// reported as any loss is.
        /// </summary>
        [Fact]
        public async Task TheFirstLookAtACraftJustPutOnScreenIsNotTakenAsItsLinkHavingGone()
        {
            await using var seated = await SeatedAsync(Direct(0.9));
            await seated.TickAsync(1, 2, 3, 4, 700, 702);
            Assert.Equal(0.9, Strength(seated.HomeView)!.Value, 6);

            seated.World.Game.ActiveNow = ScriptedContactGame.RelayGuid;
            seated.World.Game.Radio = null;
            await seated.TickAsync(T0, T0 + 1);

            seated.World.Game.ActiveNow = ScriptedContactGame.ActiveGuid;
            seated.World.Game.Radio = Lost();
            await seated.TickAsync(T0 + 10);
            seated.World.Game.Radio = Direct(0.7);
            await seated.TickAsync(T0 + 11, T0 + 11.5, T0 + 11.9);
            Assert.True(Strength(seated.HomeView) != 0.0, "one look at a craft just put on screen was sent to a centre as its link having gone");

            await seated.TickAsync(T0 + 13, T0 + 14, T0 + 15);
            Assert.Equal(0.7, Strength(seated.HomeView)!.Value, 6);

            // Put on screen again and still reading no link a look later: that is a loss, and it is told.
            seated.World.Game.ActiveNow = ScriptedContactGame.RelayGuid;
            seated.World.Game.Radio = null;
            await seated.TickAsync(T0 + 20, T0 + 21);
            seated.World.Game.ActiveNow = ScriptedContactGame.ActiveGuid;
            seated.World.Game.Radio = Lost();
            await seated.TickAsync(T0 + 30, T0 + 31, T0 + 33, T0 + 34, T0 + 35);
            Assert.Equal(0.0, Strength(seated.HomeView)!.Value, 6);
        }

        [Fact]
        public async Task ASwitchOfActiveCraftSendsNoFrameOfStrengthZeroBeforeTheNewCraftsOwnReading()
        {
            await using var seated = await SeatedAsync(Direct(0.9));
            await seated.TickAsync(1, 2, 3, 4, 700, 702);
            var before = seated.HomeView.SignalStrengths.Count;

            seated.World.Game.ActiveNow = ScriptedContactGame.RelayGuid;
            seated.World.Game.Radio = null;
            await seated.TickAsync(T0, T0 + 1, T0 + 2);
            seated.World.Game.Radio = new ContactRadio(
                ScriptedContactGame.Relay,
                true,
                0.6,
                new CommsDegrade { ModelId = "test", ModelName = "Test grading", Level = 0.4 },
                new[] { new RadioHop(ScriptedContactGame.RelayGuid, ScriptedContactGame.HomeName, false) });
            await seated.TickAsync(T0 + 3, T0 + 4, T0 + 5, T0 + 700, T0 + 702);

            Assert.DoesNotContain(0.0, seated.HomeView.SignalStrengths.Skip(before));
        }

        [Fact]
        public async Task ACentreThatHasHeardNoReadingIsSentNoSignal()
        {
            await using var seated = await SeatedAsync();
            await seated.TickAsync(1, 2, 700, 702);

            Assert.Null(Strength(seated.HomeView));
            Assert.Null(seated.HomeView.Latest(ContactPlanSource.DegradeTopic));
        }

        /// <summary>A reading is state, and an addressed sample is not kept for whoever subscribes after it landed, so it is said again.</summary>
        [Fact]
        public async Task ASessionThatSitsDownLaterIsSentItsCentresDelayAndReading()
        {
            await using var seated = await SeatedAsync(Direct(0.9));
            await seated.TickAsync(1, 2, 3, 4, 700, 702);

            var (late, view) = await seated.World.SitDownAtAsync(Home, Readings);
            await using var _ = late;
            seated.World.Tick(703);
            seated.World.Tick(704);
            await ReckonedVantageWorld.SettleAsync(late, view);

            Assert.NotNull(Delay(view));
            Assert.Equal(0.9, Strength(view)!.Value, 6);
            Assert.Equal(0.1, Level(view)!.Value, 6);
        }
    }
}
