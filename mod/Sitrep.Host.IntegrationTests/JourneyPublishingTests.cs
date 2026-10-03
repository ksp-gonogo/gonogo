using System.Text.Json;
using System.Threading.Tasks;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A journey report reaches the centre that sent the command, and no other,
    /// when its own journey through the network lands there: valid as of when it
    /// was made at its node, delivered a light-time later.
    /// </summary>
    public class JourneyPublishingTests
    {
        private const string Home = ScriptedContactGame.Home;
        private const string Far = ScriptedContactGame.Far;
        private const string Journey = ChannelEngine.JourneyTopic;
        private const double T0 = 1000.0;

        [Fact]
        public async Task AReportIsDeliveredToItsOwnCentreWhenItsJourneyLandsAndToNoOther()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            var (home, atHome) = await world.SitDownAtAsync(Home, Journey);
            var (far, atFar) = await world.SitDownAtAsync(Far, Journey);
            await using var _ = home;
            await using var __ = far;
            world.Tick(T0);
            await Task.WhenAll(ReckonedVantageWorld.SettleAsync(home, atHome), ReckonedVantageWorld.SettleAsync(far, atFar));

            world.Engine.DispatchCommandAndWait(ScriptedContactUplink.RelayCommand, "x", Home, _ => { }, TestBudgets.Op);
            var real = world.Game.RelayFromHomeSeconds;
            foreach (var ut in new[] { T0 + real + 1.0, T0 + (2.0 * real) - 1.0 })
            {
                world.Tick(ut);
            }
            await Task.WhenAll(ReckonedVantageWorld.SettleAsync(home, atHome), ReckonedVantageWorld.SettleAsync(far, atFar));
            Assert.Equal(0, Events(atHome));

            world.Tick(T0 + (2.0 * real) + 1.0);
            await Task.WhenAll(ReckonedVantageWorld.SettleAsync(home, atHome), ReckonedVantageWorld.SettleAsync(far, atFar));

            // The command ran at the relay one light-time out, and the report of
            // it came home one light-time after that.
            Assert.Equal(1, Events(atHome));
            Assert.Contains("\"kind\":" + (int)JourneyEventKind.Ran, atHome.Latest(Journey));
            var (validAt, deliveredAt) = atHome.Stamps[Journey];
            Assert.Equal(T0 + real, validAt, 6);
            Assert.Equal(T0 + (2.0 * real), deliveredAt, 6);
            Assert.Equal(0, Events(atFar));
            Assert.DoesNotContain("\"kind\":" + (int)JourneyEventKind.Ran, atFar.Latest(Journey) ?? "");

            // The journey is state, so a session that sits down afterwards is told it.
            var (late, atLate) = await world.SitDownAtAsync(Home, Journey);
            await using var ___ = late;
            world.Tick(T0 + (2.0 * real) + 2.0);
            await ReckonedVantageWorld.SettleAsync(late, atLate);
            Assert.Equal(1, Events(atLate));
        }

        /// <summary>How many journey events a screen holds, or zero when it has been sent no journey.</summary>
        private static int Events(CentreView view)
        {
            var payload = view.Latest(Journey);
            if (payload == null)
            {
                return 0;
            }
            using var doc = JsonDocument.Parse(payload);
            return doc.RootElement.GetProperty("events").GetArrayLength();
        }
    }
}
