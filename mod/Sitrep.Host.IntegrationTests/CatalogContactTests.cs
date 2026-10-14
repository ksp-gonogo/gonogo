using System.Text.Json;
using System.Threading.Tasks;
using Sitrep.Contract;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Each command centre's catalog says whether that centre is in contact
    /// with each craft, as the word of it has reached that centre: the far
    /// station three hundred light-seconds from the relay, the home station six
    /// hundred.
    /// </summary>
    public class CatalogContactTests
    {
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

        private static async Task<Seated> AtFarAsync(ScriptedContactGame? game = null)
        {
            var world = await ReckonedVantageWorld.StartAsync(game);
            var (client, view) = await world.SitDownAtAsync(Far, SystemViewProvider.CatalogTopic);
            return new Seated { World = world, Client = client, View = view };
        }

        private static CatalogContact? Contact(CentreView view)
        {
            var field = view.Vessel(Relay)!.Value.GetProperty("contact");
            return field.ValueKind == JsonValueKind.Null ? null : (CatalogContact)field.GetInt32();
        }

        private static double? Ut(CentreView view, string name)
        {
            var field = view.Vessel(Relay)!.Value.GetProperty(name);
            return field.ValueKind == JsonValueKind.Null ? null : field.GetDouble();
        }

        [Fact]
        public async Task ACentreThatHasHeardTheCraftsRouteListsItInContact()
        {
            await using var seated = await AtFarAsync();
            await seated.TickAsync(1, 300, 301, 302);

            Assert.Equal(CatalogContact.InContact, Contact(seated.View));
            Assert.NotNull(Ut(seated.View, "lastContactUt"));
        }

        [Fact]
        public async Task ACraftWhoseLinkGoesIsListedSilentOnceTheCentreLearnsItSinceItsLastContact()
        {
            await using var seated = await AtFarAsync();
            await seated.TickAsync(1, 300, 700, 701);

            seated.World.Game.RelayConnected = false;
            await seated.TickAsync(1000, 1299);
            Assert.Equal(CatalogContact.InContact, Contact(seated.View));

            await seated.TickAsync(1300, 1301);
            Assert.Equal(CatalogContact.Silent, Contact(seated.View));
            Assert.Equal(701.0, Ut(seated.View, "lastContactUt"));
            Assert.Null(Ut(seated.View, "expectedReturnUt"));
        }

        /// <summary>
        /// The ground expects the relay back at 2000 in its own time, with a hundred
        /// seconds' allowance. The far station hears a return three hundred seconds
        /// after it, so it lists the relay due at 2300 and overdue past 2400.
        /// </summary>
        [Fact]
        public async Task ASilentCraftIsDueBackAndThenOverdueOnTheCentresOwnClock()
        {
            await using var seated = await AtFarAsync();
            await seated.TickAsync(1, 300, 700, 701);

            seated.World.Game.RelayConnected = false;
            seated.World.Game.Forecasts[Relay] = new Comms.CraftForecast(
                "vessel:" + Relay, 1000.0, 1000.0, 9000.0, Comms.SilenceDeadlineBasis.PredictedReacquisition, 2000.0, 100.0);
            await seated.TickAsync(1000, 1300, 1301);
            Assert.Equal(CatalogContact.Silent, Contact(seated.View));
            Assert.Equal(2300.0, Ut(seated.View, "expectedReturnUt"));
            Assert.Equal(2400.0, Ut(seated.View, "overdueAfterUt"));

            await seated.TickAsync(2399, 2400);
            Assert.Equal(CatalogContact.Silent, Contact(seated.View));

            await seated.TickAsync(2401, 2402);
            Assert.Equal(CatalogContact.Overdue, Contact(seated.View));
        }

        [Fact]
        public async Task HomesDeclarationOfLossIsListedOnceItHasReachedTheCentre()
        {
            await using var seated = await AtFarAsync();
            await seated.TickAsync(1, 300, 700, 701);

            seated.World.Game.RelayConnected = false;
            seated.World.Game.Forecasts[Relay] = ScriptedContactGame.Forecast(Relay, 1000.0, 1500.0);
            await seated.TickAsync(1000, 1300, 1600);
            Assert.NotEqual(CatalogContact.Lost, Contact(seated.View));

            await seated.TickAsync(2100, 2101, 2102);
            Assert.Equal(CatalogContact.Lost, Contact(seated.View));
            Assert.NotNull(Ut(seated.View, "declaredLostUt"));
        }
    }
}
