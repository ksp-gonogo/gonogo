using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command centre's outbox is its own state. What it has sent, and what it
    /// is holding, reaches its screen at once whatever the active craft's link
    /// is doing: the blackout that makes a command wait is exactly when the
    /// operator needs to see it waiting.
    /// </summary>
    public class OutboxThroughBlackoutTests
    {
        private const string Home = ScriptedContactGame.Home;

        [Fact]
        public async Task ACommandSentWhileTheActiveCraftIsDarkShowsInTheCentresOutboxAtOnce()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            var (client, view) = await world.SitDownAtAsync(Home, ChannelEngine.UplinkPendingTopic);
            await using var _ = client;
            world.Tick(703.0);
            await ReckonedVantageWorld.SettleAsync(client, view);

            world.Game.ActiveConnected = false;
            world.Tick(1000.0);
            world.Tick(1001.0);
            await ReckonedVantageWorld.SettleAsync(client, view);

            world.Engine.DispatchCommandAndWait(ScriptedContactUplink.RelayCommand, "x", Home, _ => { }, TestBudgets.Op);
            world.Tick(1002.0);
            await ReckonedVantageWorld.SettleAsync(client, view);

            var pending = view.Latest(ChannelEngine.UplinkPendingTopic);
            Assert.NotNull(pending);
            using var doc = JsonDocument.Parse(pending!);
            var entry = Assert.Single(doc.RootElement.GetProperty("pending").EnumerateArray());
            Assert.Equal(ScriptedContactUplink.RelayCommand, entry.GetProperty("command").GetString());
            var (validAt, deliveredAt) = view.Stamps[ChannelEngine.UplinkPendingTopic];
            Assert.Equal(validAt, deliveredAt);
            Assert.InRange(validAt, 1001.0, 1002.0);
        }

        /// <summary>
        /// The active craft's light-time drops from forty seconds to none while
        /// its link stays up, as a switch to a craft close by does. Telemetry
        /// already on its way still takes its forty seconds. The outbox is not
        /// telemetry and does not wait behind it.
        /// </summary>
        [Fact]
        public async Task TheOutboxDoesNotWaitBehindTelemetryStillInFlightWhenTheLightTimeDrops()
        {
            var game = new ScriptedContactGame { ActiveSeconds = 40.0 };
            await using var world = await ReckonedVantageWorld.StartAsync(game);
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            var (client, view) = await world.SitDownAtAsync(Home, ChannelEngine.UplinkPendingTopic);
            await using var _ = client;
            world.Tick(703.0);
            world.Tick(1000.0);
            await ReckonedVantageWorld.SettleAsync(client, view);

            game.ActiveSeconds = 0.0;
            world.Tick(1001.0);
            world.Engine.DispatchCommandAndWait(ScriptedContactUplink.RelayCommand, "x", Home, _ => { }, TestBudgets.Op);
            world.Tick(1002.0);
            await ReckonedVantageWorld.SettleAsync(client, view);

            var pending = view.Latest(ChannelEngine.UplinkPendingTopic);
            Assert.NotNull(pending);
            using var doc = JsonDocument.Parse(pending!);
            Assert.Single(doc.RootElement.GetProperty("pending").EnumerateArray());
            var (validAt, deliveredAt) = view.Stamps[ChannelEngine.UplinkPendingTopic];
            Assert.Equal(validAt, deliveredAt);
            Assert.InRange(validAt, 1001.0, 1002.0);
        }
    }
}
