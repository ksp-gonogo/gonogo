using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A centre with no route to the active craft hears none of the craft's
    /// channels, but the topics addressed to the centre itself still reach it,
    /// and its delay list says it has no route. A centre with a route that has
    /// not yet heard the craft is told no such thing, so a screen there can wait
    /// for a first signal without calling it a lost link.
    /// </summary>
    public class NoRouteCentreAddressedTopicsTests
    {
        private const string Centre = ScriptedContactGame.Home;

        private static bool NoRoute(CentreView view)
        {
            var payload = view.Latest(ContactPlanSource.ActiveVesselDelayTopic);
            Assert.NotNull(payload);
            using var doc = JsonDocument.Parse(payload!);
            return doc.RootElement.GetProperty("noRoute").GetBoolean();
        }

        private static string[] Listed(CentreView view)
        {
            using var doc = JsonDocument.Parse(view.Latest(ContactPlanSource.ActiveVesselDelayTopic)!);
            return doc.RootElement.GetProperty("centres").EnumerateArray().Select(c => c.GetProperty("id").GetString()!).ToArray();
        }

        [Fact]
        public async Task ACentreWithNoRouteToTheActiveCraftHearsNoTelemetryYetIsToldItHasNoRoute()
        {
            var game = new ScriptedContactGame();
            game.NoRouteToActive.Add(Centre);
            game.Unroutable.Add((Centre, ScriptedContactGame.ActiveGuid));
            await using var world = await ReckonedVantageWorld.StartAsync(game);
            var (client, view) = await world.SitDownAtAsync(
                Centre,
                ContactPlanSource.ActiveVesselDelayTopic,
                ScriptedContactUplink.ActiveTelemetryTopic);
            await using var _ = client;

            foreach (var ut in new[] { 1.0, 2.0, 300.0, 301.0, 700.0, 701.0, 1000.0, 1001.0, 2500.0, 2501.0 })
            {
                game.ActiveValue = ut;
                world.Tick(ut);
            }
            await Task.WhenAll(world.SettleAsync(), ReckonedVantageWorld.SettleAsync(client, view));

            Assert.Null(view.Latest(ScriptedContactUplink.ActiveTelemetryTopic));
            Assert.True(NoRoute(view));
            Assert.DoesNotContain(Centre, Listed(view));
        }

        [Fact]
        public async Task ACentreWithARouteThatHasNotHeardTheCraftYetIsNotToldItHasNoRoute()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            var (client, view) = await world.SitDownAtAsync(
                Centre,
                ContactPlanSource.ActiveVesselDelayTopic,
                ScriptedContactUplink.ActiveTelemetryTopic);
            await using var _ = client;

            foreach (var ut in new[] { 1.0, 1.4 })
            {
                world.Game.ActiveValue = ut;
                world.Tick(ut);
            }
            await Task.WhenAll(world.SettleAsync(), ReckonedVantageWorld.SettleAsync(client, view));

            Assert.DoesNotContain(Centre, Listed(view));
            Assert.False(NoRoute(view));
        }
    }
}
