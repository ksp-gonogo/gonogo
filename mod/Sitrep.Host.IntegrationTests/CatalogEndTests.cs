using System.Text.Json;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host.Comms;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A destroyed craft stays in each command centre's catalog, marked with how
    /// that centre learned of its end, until the player dismisses it there. The
    /// relay is three hundred light-seconds from the far station and six hundred
    /// from home, and is destroyed in contact at 1000.
    /// </summary>
    public class CatalogEndTests
    {
        private const string Home = ScriptedContactGame.Home;
        private const string Far = ScriptedContactGame.Far;
        private const string Relay = ScriptedContactGame.RelayGuid;
        private const double T0 = 1000.0;

        private sealed class Seated : System.IAsyncDisposable
        {
            public ReckonedVantageWorld World = null!;
            public TestClient FarClient = null!;
            public CentreView FarView = null!;
            public TestClient HomeClient = null!;
            public CentreView HomeView = null!;

            public async Task TickAsync(params double[] uts)
            {
                foreach (var ut in uts)
                {
                    World.Tick(ut);
                }
                await ReckonedVantageWorld.SettleAsync(FarClient, FarView);
                await ReckonedVantageWorld.SettleAsync(HomeClient, HomeView);
            }

            public async ValueTask DisposeAsync()
            {
                await FarClient.DisposeAsync();
                await HomeClient.DisposeAsync();
                await World.DisposeAsync();
            }
        }

        private static async Task<Seated> SeatedAsync()
        {
            var world = await ReckonedVantageWorld.StartAsync(new ScriptedContactGame { RelaySeenFromHomeSeconds = 900.0 });
            var (farClient, farView) = await world.SitDownAtAsync(Far, SystemViewProvider.CatalogTopic);
            var (homeClient, homeView) = await world.SitDownAtAsync(Home, SystemViewProvider.CatalogTopic);
            var seated = new Seated { World = world, FarClient = farClient, FarView = farView, HomeClient = homeClient, HomeView = homeView };
            await seated.TickAsync(1, 2, 700, 702, 950, 952);
            return seated;
        }

        /// <summary>Sends a dismissal from <paramref name="client"/>'s centre and returns the command's answer, as JSON.</summary>
        private static async Task<string> DismissAsync(TestClient client, string vesselId)
        {
            await client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = "dismiss-" + vesselId,
                Command = ContactPlanSource.DismissCommand,
                Args = new System.Collections.Generic.Dictionary<string, object?> { ["vesselId"] = vesselId },
                SentAt = 0.0,
            }));
            var response = await ReceiveTypedAsync<CommandResponse<object?>>(client, System.TimeSpan.FromSeconds(10));
            return JsonSerializer.Serialize(response.Result);
        }

        private static RosterPlaceSource? EndSource(CentreView view)
        {
            var field = view.Vessel(Relay)!.Value.GetProperty("endSource");
            return field.ValueKind == JsonValueKind.Null ? null : (RosterPlaceSource)field.GetInt32();
        }

        [Fact]
        public async Task ADestroyedCraftStaysListedLongAfterItsEndArrives()
        {
            await using var seated = await SeatedAsync();
            seated.World.Game.DestroyRelay();
            await seated.TickAsync(T0, T0 + 2, T0 + 303, T0 + 304, T0 + 603, T0 + 604, T0 + 50_000, T0 + 50_002);

            Assert.Equal(RosterPlaceSource.Heard, EndSource(seated.FarView));
            Assert.Equal(RosterPlaceSource.Heard, EndSource(seated.HomeView));
        }

        [Fact]
        public async Task ARecoveredCraftLeavesTheListWhenWordOfItArrives()
        {
            await using var seated = await SeatedAsync();
            seated.World.Game.DestroyRelay(CraftEnd.Recovered);
            await seated.TickAsync(T0, T0 + 2, T0 + 299);
            Reckoned.True(seated.FarView.Vessel(Relay) != null, "the far station dropped a recovered craft before word of it could arrive");

            await seated.TickAsync(T0 + 303, T0 + 304, T0 + 305);
            Assert.Null(seated.FarView.Vessel(Relay));
        }

        /// <summary>A craft docked into another leaves the game with no word of how, and leaves the list.</summary>
        [Fact]
        public async Task ACraftThatLeavesWithNoWordOfHowLeavesTheList()
        {
            await using var seated = await SeatedAsync();
            seated.World.Game.DestroyRelay(null);
            await seated.TickAsync(T0, T0 + 2, T0 + 303, T0 + 304, T0 + 305);

            Assert.Null(seated.FarView.Vessel(Relay));
        }

        [Fact]
        public async Task ADismissedCraftLeavesOnlyTheCatalogOfTheCentreThatDismissedIt()
        {
            await using var seated = await SeatedAsync();
            seated.World.Game.DestroyRelay();
            await seated.TickAsync(T0, T0 + 2, T0 + 303, T0 + 304, T0 + 603, T0 + 604);
            Assert.NotNull(EndSource(seated.FarView));

            Assert.Contains("\"success\":true", await DismissAsync(seated.FarClient, Relay), System.StringComparison.OrdinalIgnoreCase);
            await seated.TickAsync(T0 + 700, T0 + 701, T0 + 702);

            Assert.Null(seated.FarView.Vessel(Relay));
            Assert.Equal(RosterPlaceSource.Heard, EndSource(seated.HomeView));
        }

        /// <summary>The far station hears of the end at 1300, home at 1600: a dismissal sent from home before then changes nothing.</summary>
        [Fact]
        public async Task ADismissalSentBeforeTheEndHasArrivedChangesNothing()
        {
            await using var seated = await SeatedAsync();
            seated.World.Game.DestroyRelay();
            await seated.TickAsync(T0, T0 + 2, T0 + 303, T0 + 304);

            Assert.Contains("\"success\":true", await DismissAsync(seated.HomeClient, Relay), System.StringComparison.OrdinalIgnoreCase);
            await seated.TickAsync(T0 + 400, T0 + 401, T0 + 603, T0 + 604, T0 + 605);

            Assert.Equal(RosterPlaceSource.Heard, EndSource(seated.HomeView));
        }
    }
}
