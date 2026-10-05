using System.Text.Json;
using System.Threading.Tasks;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Where an object is can be seen, radio or none, in contact or out. A
    /// sighting reaches a command centre after the straight-line light-time
    /// from the object, through no relay. Everything else about a craft comes
    /// only by its radio.
    ///
    /// <para>The relay's radio route is ten light-minutes from the home centre.
    /// In these tests its straight line is a hundred seconds, unless a test
    /// says otherwise.</para>
    /// </summary>
    public class SeenBySightTests
    {
        private const double T0 = 1000.0;

        private const string Home = ScriptedContactGame.Home;
        private const string Relay = ScriptedContactGame.RelayGuid;
        private const string Debris = ScriptedContactGame.DebrisGuid;

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

        private static async Task<Seated> AtHomeAsync(ScriptedContactGame game)
        {
            var world = await ReckonedVantageWorld.StartAsync(game);
            var (client, view) = await world.SitDownAtAsync(Home, SystemViewProvider.VesselsTopic);
            return new Seated { World = world, Client = client, View = view };
        }

        private static double Sma(CentreView view) => view.Vessel(Relay)!.Value.GetProperty("orbit").GetProperty("sma").GetDouble();

        private static int Crew(CentreView view) => view.Vessel(Relay)!.Value.GetProperty("crewCount").GetInt32();

        [Fact]
        public async Task AnObjectWithNoRadioIsListedWhenItsLightArrivesAndGoesWhenTheLightOfItsGoingDoes()
        {
            await using var seated = await AtHomeAsync(new ScriptedContactGame { DebrisSeenSeconds = 200.0 });
            await seated.TickAsync(1, 2, 3, 199);
            Reckoned.True(seated.View.Vessel(Debris) == null, "home listed an object two hundred light-seconds away before its light could arrive");

            await seated.TickAsync(202, 203, 204);
            var debris = seated.View.Vessel(Debris);
            Assert.NotNull(debris);
            Assert.Equal("Spent stage", debris!.Value.GetProperty("name").GetString());
            Assert.Equal(JsonValueKind.Null, debris.Value.GetProperty("crewCount").ValueKind);
            Assert.Equal(JsonValueKind.Null, debris.Value.GetProperty("commsConnected").ValueKind);

            seated.World.Game.DebrisExists = false;
            await seated.TickAsync(T0, T0 + 2, T0 + 199);
            Reckoned.True(seated.View.Vessel(Debris) != null, "home dropped an object two hundred light-seconds away before the light of its going could arrive");

            await seated.TickAsync(T0 + 203, T0 + 204, T0 + 205);
            Assert.Null(seated.View.Vessel(Debris));
        }

        /// <summary>
        /// The relay burns and takes on crew at the same instant. Where it is
        /// can be seen, and its straight line is a hundred seconds. Its crew is
        /// its own to say, and its radio's route is six hundred.
        /// </summary>
        [Fact]
        public async Task ACraftsLocationArrivesBySightAndEverythingElseOnlyByRadio()
        {
            await using var seated = await AtHomeAsync(new ScriptedContactGame { RelaySeenFromHomeSeconds = 100.0 });
            await seated.TickAsync(1, 2, 700, 702);
            var before = Sma(seated.View);
            Assert.Equal(0, Crew(seated.View));

            seated.World.Game.BurnRelay(T0);
            seated.World.Game.RelayCrew = 2;
            await seated.TickAsync(T0, T0 + 2, T0 + 99);
            Reckoned.True(Sma(seated.View) == before, "home saw a burn a hundred light-seconds away before its light could arrive");

            await seated.TickAsync(T0 + 103, T0 + 104, T0 + 105);
            Reckoned.True(Sma(seated.View) != before, "home has not seen a burn though its light has arrived");
            Reckoned.True(Crew(seated.View) == 0, "home learned of a craft's crew by looking at it");

            await seated.TickAsync(T0 + 599);
            Reckoned.True(Crew(seated.View) == 0, "home learned of a craft's crew before its radio could say");

            await seated.TickAsync(T0 + 603, T0 + 604, T0 + 605);
            Assert.Equal(2, Crew(seated.View));
        }

        /// <summary>
        /// The relay's link is down, so it says nothing. It can still be seen:
        /// its burn reaches home by sight, and its crew, which only it could
        /// say, does not.
        /// </summary>
        [Fact]
        public async Task ACraftOutOfContactIsStillSeen()
        {
            await using var seated = await AtHomeAsync(new ScriptedContactGame { RelaySeenFromHomeSeconds = 100.0 });
            await seated.TickAsync(1, 2, 700, 702);
            var before = Sma(seated.View);

            seated.World.Game.RelayConnected = false;
            await seated.TickAsync(800, 802);
            seated.World.Game.BurnRelay(T0);
            seated.World.Game.RelayCrew = 2;
            await seated.TickAsync(T0, T0 + 2, T0 + 103, T0 + 104, T0 + 105);

            Reckoned.True(Sma(seated.View) != before, "a craft out of contact could not be seen");
            await seated.TickAsync(T0 + 700, T0 + 702);
            Assert.Equal(0, Crew(seated.View));
        }

        /// <summary>
        /// A centre plans from where it knows each craft to be, and it knows that
        /// from the newer of sight and radio. So the relay's burn moves home's
        /// own path for the active craft when its light arrives by sight, five
        /// hundred seconds before its radio could have said.
        /// </summary>
        [Fact]
        public async Task ACentrePlansFromWhereItHasSeenACraftToBe()
        {
            await using var burned = await ReckonedVantageWorld.StartAsync(new ScriptedContactGame { RelaySeenFromHomeSeconds = 100.0 });
            await using var control = await ReckonedVantageWorld.StartAsync(new ScriptedContactGame { RelaySeenFromHomeSeconds = 100.0 });
            async Task TickBothAsync(params double[] uts)
            {
                foreach (var ut in uts)
                {
                    burned.Tick(ut);
                    control.Tick(ut);
                }
                await Task.WhenAll(burned.SettleAsync(), control.SettleAsync());
            }

            await TickBothAsync(1, 2, 700, 702);
            Assert.Equal(control.Home.Path, burned.Home.Path);

            burned.Game.BurnRelay(T0);
            await TickBothAsync(T0, T0 + 2, T0 + 99);
            Reckoned.True(control.Home.Path == burned.Home.Path, "home's path moved before the light of the burn could arrive");

            await TickBothAsync(T0 + 103, T0 + 104, T0 + 106, T0 + 110, T0 + 112);
            Reckoned.True(control.Home.Path != burned.Home.Path, "home's path had not taken a burn it had seen");
        }

        /// <summary>A tracking station that cannot place a vessel sees nothing: an object with no radio is never listed, and a craft is known by its radio alone.</summary>
        [Fact]
        public async Task WhereTheGameTracksNothingBySightACraftIsKnownByItsRadioAlone()
        {
            await using var seated = await AtHomeAsync(new ScriptedContactGame { RelaySeenFromHomeSeconds = 100.0, TracksBySight = false });
            await seated.TickAsync(1, 2, 700, 702);
            Assert.Null(seated.View.Vessel(Debris));
            var before = Sma(seated.View);

            seated.World.Game.BurnRelay(T0);
            await seated.TickAsync(T0, T0 + 2, T0 + 103, T0 + 599);
            Reckoned.True(Sma(seated.View) == before, "home saw a burn where the game tracks nothing by sight");

            await seated.TickAsync(T0 + 603, T0 + 604, T0 + 605);
            Reckoned.True(Sma(seated.View) != before, "home has not heard of a burn though its radio's light has arrived");
        }
    }
}
