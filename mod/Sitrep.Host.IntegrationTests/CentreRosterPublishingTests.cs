using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Sitrep.Host.Comms;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// <c>commandCentre.roster</c> is each command centre's own. A ground
    /// station is on every centre's from the start. A craft that becomes a
    /// command centre, or stops being one, changes a centre's roster when the
    /// craft's own word of it arrives.
    ///
    /// <para>The relay is ten light-minutes from the home centre and five from
    /// the far one.</para>
    /// </summary>
    public class CentreRosterPublishingTests
    {
        private const double T0 = 1000.0;

        private const string Home = ScriptedContactGame.Home;
        private const string Far = ScriptedContactGame.Far;
        private const string Relay = ScriptedContactGame.Relay;

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

        private static async Task<Seated> SeatedAsync()
        {
            var world = await ReckonedVantageWorld.StartAsync();
            var (homeClient, homeView) = await world.SitDownAtAsync(Home, ContactPlanSource.RosterTopic);
            var (farClient, farView) = await world.SitDownAtAsync(Far, ContactPlanSource.RosterTopic);
            return new Seated { World = world, HomeClient = homeClient, HomeView = homeView, FarClient = farClient, FarView = farView };
        }

        private static string[] Ids(CentreView view)
        {
            var payload = view.Latest(ContactPlanSource.RosterTopic);
            if (payload == null)
            {
                return new string[0];
            }
            using var doc = JsonDocument.Parse(payload);
            return doc.RootElement.EnumerateArray().Select(e => e.GetProperty("id").GetString()!).ToArray();
        }

        [Fact]
        public async Task EveryCentreListsTheGroundStationsFromTheStartAndArrivesTheInstantItIsMade()
        {
            await using var seated = await SeatedAsync();
            await seated.TickAsync(1, 2);

            Assert.Equal(new[] { Home, Far }, Ids(seated.HomeView));
            Assert.Equal(new[] { Home, Far }, Ids(seated.FarView));
            var (validAt, deliveredAt) = seated.HomeView.Stamps[ContactPlanSource.RosterTopic];
            Assert.Equal(validAt, deliveredAt);
        }

        [Fact]
        public async Task ACraftThatBecomesACommandCentreJoinsEachCentresRosterWhenItsWordArrives()
        {
            await using var seated = await SeatedAsync();
            await seated.TickAsync(1, 2, 700, 702);
            Assert.DoesNotContain(Relay, Ids(seated.HomeView));

            seated.World.Game.RelayIsCentre = true;
            await seated.TickAsync(T0, T0 + 2, T0 + 12, T0 + 299);
            Reckoned.True(!Ids(seated.FarView).Contains(Relay), "the far centre's roster listed a craft as a command centre before the craft's word of it could arrive");
            Reckoned.True(!Ids(seated.HomeView).Contains(Relay), "the home centre's roster listed a craft as a command centre within seconds");

            await seated.TickAsync(T0 + 301, T0 + 302, T0 + 304);
            Assert.Contains(Relay, Ids(seated.FarView));
            Reckoned.True(!Ids(seated.HomeView).Contains(Relay), "the home centre's roster moved when the far centre heard");

            await seated.TickAsync(T0 + 599);
            Reckoned.True(!Ids(seated.HomeView).Contains(Relay), "the home centre's roster listed the craft one second before its word could arrive");

            await seated.TickAsync(T0 + 601, T0 + 602, T0 + 604);
            Assert.Equal(new[] { Home, Far, Relay }, Ids(seated.HomeView));
        }

        [Fact]
        public async Task ACraftThatStopsBeingACommandCentreStaysOnACentresRosterUntilItsWordArrives()
        {
            await using var seated = await SeatedAsync();
            seated.World.Game.RelayIsCentre = true;
            await seated.TickAsync(1, 2, 700, 702);
            Assert.Contains(Relay, Ids(seated.HomeView));

            seated.World.Game.RelayIsCentre = false;
            await seated.TickAsync(T0, T0 + 2, T0 + 12, T0 + 599);
            Reckoned.True(Ids(seated.HomeView).Contains(Relay), "the home centre's roster dropped a craft before the craft's word that it was no longer a command centre could arrive");

            await seated.TickAsync(T0 + 601, T0 + 602, T0 + 604);
            Assert.DoesNotContain(Relay, Ids(seated.HomeView));
        }

        [Fact]
        public async Task ACommandCentreThatIsDestroyedStaysOnACentresRosterUntilItsSilenceArrives()
        {
            await using var seated = await SeatedAsync();
            seated.World.Game.RelayIsCentre = true;
            await seated.TickAsync(1, 2, 700, 702);

            seated.World.Game.DestroyRelay();
            await seated.TickAsync(T0, T0 + 2, T0 + 299);
            Reckoned.True(Ids(seated.FarView).Contains(Relay), "the far centre's roster dropped a destroyed craft before its silence could arrive");

            await seated.TickAsync(T0 + 301, T0 + 302, T0 + 304);
            Assert.DoesNotContain(Relay, Ids(seated.FarView));
            Reckoned.True(Ids(seated.HomeView).Contains(Relay), "the home centre's roster dropped a destroyed craft when the far centre heard");
        }

        [Fact]
        public async Task ASessionThatSitsDownLaterIsSentItsCentresRoster()
        {
            await using var seated = await SeatedAsync();
            seated.World.Game.RelayIsCentre = true;
            await seated.TickAsync(1, 2, 700, 702);

            var (late, view) = await seated.World.SitDownAtAsync(Home, ContactPlanSource.RosterTopic);
            await using var _ = late;
            seated.World.Tick(703);
            seated.World.Tick(704);
            await ReckonedVantageWorld.SettleAsync(late, view);

            Assert.Equal(new[] { Home, Far, Relay }, Ids(view));
        }
    }
}
