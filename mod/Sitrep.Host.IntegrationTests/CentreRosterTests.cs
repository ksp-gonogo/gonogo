using System.Text.Json;
using System.Threading.Tasks;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// <c>system.vessels</c> is each command centre's own list: every craft it
    /// has heard of, as it last heard it. A craft's orbit, its crew and whether
    /// its radio answers reach a centre when that craft's light does, and no
    /// centre learns anything from the list sooner.
    ///
    /// <para>The relay is ten light-minutes from the home centre and five from
    /// the far one.</para>
    /// </summary>
    public class CentreRosterTests
    {
        private const double T0 = 1000.0;

        private const string Home = ScriptedContactGame.Home;
        private const string Far = ScriptedContactGame.Far;
        private const string Relay = ScriptedContactGame.RelayGuid;

        private static async Task<(ReckonedVantageWorld World, TestClient HomeClient, CentreView HomeView, TestClient FarClient, CentreView FarView)> SeatedAsync()
        {
            var world = await ReckonedVantageWorld.StartAsync();
            var (homeClient, homeView) = await world.SitDownAtAsync(Home, SystemViewProvider.VesselsTopic);
            var (farClient, farView) = await world.SitDownAtAsync(Far, SystemViewProvider.VesselsTopic);
            return (world, homeClient, homeView, farClient, farView);
        }

        private static async Task TickAsync(
            (ReckonedVantageWorld World, TestClient HomeClient, CentreView HomeView, TestClient FarClient, CentreView FarView) seated,
            params double[] uts)
        {
            foreach (var ut in uts)
            {
                seated.World.Tick(ut);
            }
            await Task.WhenAll(
                ReckonedVantageWorld.SettleAsync(seated.HomeClient, seated.HomeView),
                ReckonedVantageWorld.SettleAsync(seated.FarClient, seated.FarView));
        }

        private static double Sma(CentreView view) => view.Vessel(Relay)!.Value.GetProperty("orbit").GetProperty("sma").GetDouble();

        [Fact]
        public async Task ARemoteCraftsBurnReachesEachCentresListAtThatCentresOwnLightTime()
        {
            var seated = await SeatedAsync();
            await using var world = seated.World;
            await using var home = seated.HomeClient;
            await using var far = seated.FarClient;
            await TickAsync(seated, 1, 2, 700, 702);
            var before = Sma(seated.HomeView);
            Assert.Equal(ScriptedContactGame.RelayRadius, before, 3);
            Assert.Equal(before, Sma(seated.FarView), 3);

            world.Game.BurnRelay(T0);
            await TickAsync(seated, T0, T0 + 2, T0 + 12, T0 + 299);
            Reckoned.True(Sma(seated.FarView) == before, "the far centre's list shows a burn five light-minutes away before its light could arrive");
            Reckoned.True(Sma(seated.HomeView) == before, "the home centre's list shows a burn ten light-minutes away within seconds");

            await TickAsync(seated, T0 + 301, T0 + 302);
            Reckoned.True(Sma(seated.FarView) != before, "the far centre's list has not taken the burn though its light has arrived");
            Reckoned.True(Sma(seated.HomeView) == before, "the home centre's list moved when the far centre heard of the burn");

            await TickAsync(seated, T0 + 599);
            Reckoned.True(Sma(seated.HomeView) == before, "the home centre's list shows the burn one second before its light arrives");

            await TickAsync(seated, T0 + 601, T0 + 602);
            Reckoned.True(Sma(seated.HomeView) != before, "the home centre's list has not taken the burn though its light has arrived");
        }

        [Fact]
        public async Task ACraftACentreHasNotHeardOfIsNotOnItsList()
        {
            var seated = await SeatedAsync();
            await using var world = seated.World;
            await using var home = seated.HomeClient;
            await using var far = seated.FarClient;

            await TickAsync(seated, 1, 2, 3, 299);
            Assert.NotNull(seated.HomeView.Vessel(ScriptedContactGame.ActiveGuid));
            Assert.Null(seated.FarView.Vessel(Relay));
            Assert.Null(seated.HomeView.Vessel(Relay));

            await TickAsync(seated, 301, 302);
            Assert.NotNull(seated.FarView.Vessel(Relay));
            Assert.Null(seated.HomeView.Vessel(Relay));

            await TickAsync(seated, 601, 602);
            Assert.NotNull(seated.HomeView.Vessel(Relay));
        }

        /// <summary>
        /// Crew aboard and whether the radio answers are the craft's state too.
        /// The link going is told by the silence that follows it, which reaches
        /// a centre one of its light-times after the last light the craft sent.
        /// </summary>
        [Fact]
        public async Task ACraftsCrewAndItsLinkChangeOnACentresListWhenTheNewsArrives()
        {
            var seated = await SeatedAsync();
            await using var world = seated.World;
            await using var home = seated.HomeClient;
            await using var far = seated.FarClient;
            await TickAsync(seated, 1, 2, 700, 702);
            Assert.Equal(0, seated.HomeView.Vessel(Relay)!.Value.GetProperty("crewCount").GetInt32());
            Assert.True(seated.HomeView.Vessel(Relay)!.Value.GetProperty("commsConnected").GetBoolean());

            world.Game.RelayCrew = 2;
            await TickAsync(seated, T0, T0 + 2, T0 + 599);
            Assert.Equal(0, seated.HomeView.Vessel(Relay)!.Value.GetProperty("crewCount").GetInt32());
            await TickAsync(seated, T0 + 601, T0 + 602);
            Assert.Equal(2, seated.HomeView.Vessel(Relay)!.Value.GetProperty("crewCount").GetInt32());

            world.Game.RelayConnected = false;
            await TickAsync(seated, 2000, 2002, 2299);
            Assert.True(seated.FarView.Vessel(Relay)!.Value.GetProperty("commsConnected").GetBoolean());
            await TickAsync(seated, 2301, 2302);
            Assert.False(seated.FarView.Vessel(Relay)!.Value.GetProperty("commsConnected").GetBoolean());
            Assert.True(seated.HomeView.Vessel(Relay)!.Value.GetProperty("commsConnected").GetBoolean());
            await TickAsync(seated, 2601, 2602);
            Assert.False(seated.HomeView.Vessel(Relay)!.Value.GetProperty("commsConnected").GetBoolean());
        }

        /// <summary>
        /// A craft with no radio says nothing, so nothing of it can be heard. It
        /// is on every centre's list from the moment it is in the game, as the
        /// ground saw it then, and leaves every list when it is gone.
        /// </summary>
        [Fact]
        public async Task ACraftWithNoRadioIsListedAsTheGroundFirstSawItAndLeavesWhenItIsGone()
        {
            var seated = await SeatedAsync();
            await using var world = seated.World;
            await using var home = seated.HomeClient;
            await using var far = seated.FarClient;

            await TickAsync(seated, 1, 2, 3);
            var debris = seated.HomeView.Vessel(ScriptedContactGame.DebrisGuid);
            Assert.NotNull(debris);
            Assert.Equal("Spent stage", debris!.Value.GetProperty("name").GetString());
            Assert.Equal(JsonValueKind.Null, debris.Value.GetProperty("orbit").ValueKind);
            Assert.NotNull(seated.FarView.Vessel(ScriptedContactGame.DebrisGuid));

            world.Game.DebrisExists = false;
            await TickAsync(seated, 10, 11, 12);
            Assert.Null(seated.HomeView.Vessel(ScriptedContactGame.DebrisGuid));
            Assert.Null(seated.FarView.Vessel(ScriptedContactGame.DebrisGuid));
        }

        [Fact]
        public async Task ACentreIsSentItsListTheInstantItIsMadeAndNoOtherCentres()
        {
            var seated = await SeatedAsync();
            await using var world = seated.World;
            await using var home = seated.HomeClient;
            await using var far = seated.FarClient;
            await TickAsync(seated, 1, 2, 301, 302);

            var (validAt, deliveredAt) = seated.FarView.Stamps[SystemViewProvider.VesselsTopic];
            Assert.Equal(validAt, deliveredAt);
            Assert.NotNull(seated.FarView.Vessel(Relay));
            Assert.Null(seated.HomeView.Vessel(Relay));
        }
    }
}
