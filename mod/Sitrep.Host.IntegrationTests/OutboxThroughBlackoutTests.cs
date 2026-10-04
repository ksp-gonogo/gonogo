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

        /// <summary>
        /// The rig's blackout. The active craft's route is forty light-seconds
        /// long when the hop it rides stops carrying, so everything the craft
        /// sent in the forty seconds either side of the break ran into it and is
        /// lost. That is true of light from the craft. It is not true of the
        /// centre's own outbox, which never left the ground, and the rig saw it
        /// freeze for the whole outage.
        /// </summary>
        [Fact]
        public async Task ACommandSentInsideTheWindowAPathBreakBlindsStillShowsInTheOutboxAtOnce()
        {
            var (world, game, client, view) = await DarkBehindABreakAsync(ChannelEngine.UplinkPendingTopic);
            await using var w = world;
            await using var c = client;

            world.Engine.DispatchCommandAndWait(ScriptedContactUplink.RelayCommand, "x", Home, _ => { }, TestBudgets.Op);
            world.Tick(1006.0);
            world.Tick(1007.0);
            await ReckonedVantageWorld.SettleAsync(client, view);

            var pending = view.Latest(ChannelEngine.UplinkPendingTopic);
            Assert.NotNull(pending);
            using var doc = JsonDocument.Parse(pending!);
            Assert.Single(doc.RootElement.GetProperty("pending").EnumerateArray());
            var (validAt, deliveredAt) = view.Stamps[ChannelEngine.UplinkPendingTopic];
            Assert.Equal(validAt, deliveredAt);
            Assert.InRange(validAt, 1005.0, 1007.0);
        }

        /// <summary>
        /// The same blackout, and the report of it. A centre notices the silence
        /// when the last light it was owed fails to come, one light-time after
        /// the link went: the outage report is the centre's own observation, not
        /// light the break could catch. On the rig no centre was told of a
        /// five-hundred-second outage until it was over.
        /// </summary>
        [Fact]
        public async Task TheOutageIsReportedOneLightTimeAfterItBeginsThoughAPathBreakBlindsTheCraft()
        {
            var (world, game, client, view) = await DarkBehindABreakAsync(ChannelEngine.ConnectivityMetaTopic);
            await using var w = world;
            await using var c = client;

            for (var ut = 1006.0; ut <= 1039.0; ut += 1.0)
            {
                world.Tick(ut);
            }
            await ReckonedVantageWorld.SettleAsync(client, view);
            Assert.Contains("true", view.Latest(ChannelEngine.ConnectivityMetaTopic));

            for (var ut = 1040.0; ut <= 1045.0; ut += 1.0)
            {
                world.Tick(ut);
            }
            await ReckonedVantageWorld.SettleAsync(client, view);

            Assert.Contains("false", view.Latest(ChannelEngine.ConnectivityMetaTopic));
            var (validAt, deliveredAt) = view.Stamps[ChannelEngine.ConnectivityMetaTopic];
            Assert.InRange(validAt, 1000.0, 1005.0);
            Assert.Equal(40.0, deliveredAt - validAt, 6);
        }

        /// <summary>A session at home, with the active craft forty light-seconds out and five seconds into a blackout that began with a break at the far end of its route.</summary>
        private static async Task<(ReckonedVantageWorld World, ScriptedContactGame Game, TestClient Client, CentreView View)> DarkBehindABreakAsync(string topic)
        {
            var game = new ScriptedContactGame { ActiveSeconds = 40.0, DarkMeasuresNoDelay = true };
            var world = await ReckonedVantageWorld.StartAsync(game);
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            var (client, view) = await world.SitDownAtAsync(Home, topic);
            for (var ut = 950.0; ut <= 999.0; ut += 1.0)
            {
                world.Tick(ut);
            }
            game.ActiveConnected = false;
            game.BreakActivePath(40.0);
            for (var ut = 1000.0; ut <= 1005.0; ut += 1.0)
            {
                world.Tick(ut);
            }
            await ReckonedVantageWorld.SettleAsync(client, view);
            return (world, game, client, view);
        }
    }
}
