using System.Text.Json;
using System.Threading.Tasks;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// What a pilot aboard the active craft reads of its route to mission control.
    /// <c>comms.link</c> always reads connected there, so the route is a field of
    /// its own, and a centre's screen reads no such field.
    /// </summary>
    public class PilotOutageVantageTests
    {
        private static JsonElement? RouteHome(CentreView view)
        {
            var payload = view.Latest(ChannelEngine.ConnectivityMetaTopic);
            Assert.NotNull(payload);
            using var doc = JsonDocument.Parse(payload!);
            return doc.RootElement.TryGetProperty("routeHome", out var route) ? route.Clone() : (JsonElement?)null;
        }

        private static bool Connected(CentreView view)
        {
            using var doc = JsonDocument.Parse(view.Latest(ChannelEngine.ConnectivityMetaTopic)!);
            return doc.RootElement.GetProperty("connected").GetBoolean();
        }

        [Fact]
        public async Task ThePilotsSeatIsToldTheCraftHasNoRouteHomeWhileConnectedStaysTrue()
        {
            var game = new ScriptedContactGame();
            await using var world = await ReckonedVantageWorld.StartAsync(game, watchTelemetry: true, seatAboardActive: true);
            var (client, view) = await world.SitDownAtAsync(ScriptedContactGame.Active);
            await using var _ = client;

            world.Tick(1);
            world.Tick(2);
            game.ActiveConnected = false;
            world.Tick(3);
            world.Tick(4);
            await ReckonedVantageWorld.SettleAsync(client, view);
            Assert.True(Connected(view));
            Assert.Equal(JsonValueKind.False, RouteHome(view)!.Value.ValueKind);
        }

        [Fact]
        public async Task ACentreIsToldNothingOfARouteHomeAndReadsTheOutageInConnected()
        {
            var game = new ScriptedContactGame();
            await using var world = await ReckonedVantageWorld.StartAsync(game, watchTelemetry: true, seatAboardActive: true);
            game.ActiveConnected = false;
            world.Tick(1);
            world.Tick(2);
            await world.SettleAsync();

            Assert.False(Connected(world.Home));
            Assert.Null(RouteHome(world.Home));
        }
    }
}
