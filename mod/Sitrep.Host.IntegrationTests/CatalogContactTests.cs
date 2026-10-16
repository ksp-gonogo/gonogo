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

        private static bool? Link(CentreView view, string vesselId)
        {
            var field = view.Vessel(vesselId)!.Value.GetProperty("commsConnected");
            return field.ValueKind == JsonValueKind.Null ? null : field.GetBoolean();
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

        /// <summary>
        /// The listing of a craft is not read again when only its link changes,
        /// so the link it carries can be the one from the first time it was
        /// read. Each centre lists the link the craft's own report says.
        /// </summary>
        [Theory]
        [InlineData(ScriptedContactGame.Home)]
        [InlineData(ScriptedContactGame.Far)]
        public async Task EachCentreListsTheLinkTheCraftReportsNotAnOlderListing(string centre)
        {
            var world = await ReckonedVantageWorld.StartAsync();
            world.Game.ActiveListedLink = false;
            var (client, view) = await world.SitDownAtAsync(centre, SystemViewProvider.CatalogTopic);
            await using var seated = new Seated { World = world, Client = client, View = view };
            await seated.TickAsync(1, 300, 700, 701, 1000, 1001);

            Assert.True(Link(seated.View, ScriptedContactGame.ActiveGuid));
        }

        /// <summary>
        /// Until the craft's own link report has reached a centre, the centre
        /// does not know the link, and lists it as unknown rather than as the
        /// listing first read for the craft, which is never read again for a
        /// link change.
        /// </summary>
        [Fact]
        public async Task ACentreThatHasNotHeardTheCraftsLinkListsItAsUnknown()
        {
            var world = await ReckonedVantageWorld.StartAsync(new ScriptedContactGame { ActiveListedLink = false, ReportsActiveLink = false });
            var (client, view) = await world.SitDownAtAsync(ScriptedContactGame.Home, SystemViewProvider.CatalogTopic);
            await using var seated = new Seated { World = world, Client = client, View = view };
            await seated.TickAsync(1, 300, 700, 701);

            Assert.NotNull(seated.View.Vessel(ScriptedContactGame.ActiveGuid));
            Assert.Null(Link(seated.View, ScriptedContactGame.ActiveGuid));
        }

        /// <summary>
        /// A craft's link is said when it changes. One said while a centre had
        /// no route to the craft reaches no one there, so when the centre gains
        /// the route it is told the link as it stands, as it is told the
        /// craft's state.
        /// </summary>
        [Fact]
        public async Task ACentreThatGainsARouteToACraftHearsItsLinkAsItStands()
        {
            var world = await ReckonedVantageWorld.StartAsync();
            world.Game.ActiveListedLink = false;
            world.Game.Unroutable.Add((Far, ScriptedContactGame.ActiveGuid));
            var (client, view) = await world.SitDownAtAsync(Far, SystemViewProvider.CatalogTopic);
            await using var seated = new Seated { World = world, Client = client, View = view };
            await seated.TickAsync(1, 300, 301);

            world.Game.Unroutable.Clear();
            await seated.TickAsync(700, 1000, 1001, 1300, 1301);

            Assert.True(Link(seated.View, ScriptedContactGame.ActiveGuid));
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

        /// <summary>
        /// An object with no radio can never be in contact, so a centre that
        /// only sees it lists no contact state and nothing that follows from one,
        /// on every sample, whatever the hearing's verdict is for a silent craft.
        /// </summary>
        [Theory]
        [InlineData(ScriptedContactGame.Home)]
        [InlineData(ScriptedContactGame.Far)]
        public async Task AnObjectWithNoRadioListsNoContactStateOnAnySample(string centre)
        {
            var world = await ReckonedVantageWorld.StartAsync();
            var (client, view) = await world.SitDownAtAsync(centre, SystemViewProvider.CatalogTopic);
            await using var seated = new Seated { World = world, Client = client, View = view };

            foreach (var ut in new[] { 1.0, 300, 700, 701, 1000, 1600, 2100, 2101, 2102 })
            {
                await seated.TickAsync(ut);
                var debris = seated.View.Vessel(ScriptedContactGame.DebrisGuid);
                if (debris == null)
                {
                    continue;
                }
                foreach (var name in new[] { "contact", "lastContactUt", "expectedReturnUt", "overdueAfterUt", "declaredLostUt", "crew" })
                {
                    Assert.Equal(JsonValueKind.Null, debris.Value.GetProperty(name).ValueKind);
                }
            }
            Assert.NotNull(seated.View.Vessel(ScriptedContactGame.DebrisGuid));
        }

        private static CatalogCrew? Crew(CentreView view)
        {
            var field = view.Vessel(Relay)!.Value.GetProperty("crew");
            return field.ValueKind == JsonValueKind.Null ? null : (CatalogCrew)field.GetInt32();
        }

        private static ScriptedContactGame Crewed() => new ScriptedContactGame { RelayCrew = 2 };

        [Fact]
        public async Task ACrewedCraftInContactListsItsCrewAsKnown()
        {
            await using var seated = await AtFarAsync(Crewed());
            await seated.TickAsync(1, 300, 301, 302);

            Assert.Equal(CatalogCrew.Known, Crew(seated.View));
        }

        /// <summary>A craft's crew is heard only over a link: while it is silent the centre lists the crew it last heard, and does not know it.</summary>
        [Fact]
        public async Task ACrewedCraftGoneSilentListsItsCrewAsUnknown()
        {
            await using var seated = await AtFarAsync(Crewed());
            await seated.TickAsync(1, 300, 700, 701);

            seated.World.Game.RelayConnected = false;
            await seated.TickAsync(1000, 1300, 1301);

            Assert.Equal(CatalogContact.Silent, Contact(seated.View));
            Assert.Equal(CatalogCrew.Unknown, Crew(seated.View));
        }

        [Fact]
        public async Task ACrewedCraftDeclaredLostListsItsCrewAsPresumedLost()
        {
            await using var seated = await AtFarAsync(Crewed());
            await seated.TickAsync(1, 300, 700, 701);

            seated.World.Game.RelayConnected = false;
            seated.World.Game.Forecasts[Relay] = ScriptedContactGame.Forecast(Relay, 1000.0, 1500.0);
            await seated.TickAsync(1000, 1300, 1600, 2100, 2101, 2102);

            Assert.Equal(CatalogContact.Lost, Contact(seated.View));
            Assert.Equal(CatalogCrew.PresumedLost, Crew(seated.View));
        }

        [Fact]
        public async Task ACraftWithNoCrewAboardListsNoCrewState()
        {
            await using var seated = await AtFarAsync();
            await seated.TickAsync(1, 300, 301, 302);

            Assert.Null(Crew(seated.View));
        }
    }
}
