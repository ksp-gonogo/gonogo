using System.Collections.Generic;
using System.Threading.Tasks;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// What a craft says of itself, such as a lost craft's report of its end,
    /// rides that craft's own link, whichever craft is flown. The relay is three
    /// hundred light-seconds from the far station; the flown lander is one.
    /// </summary>
    public class CraftSaidTests
    {
        private const string Far = ScriptedContactGame.Far;
        private const double T0 = 1000.0;

        private static async Task<(ReckonedVantageWorld World, TestClient Client, CentreView View)> AtFarAsync()
        {
            var world = await ReckonedVantageWorld.StartAsync();
            var (client, view) = await world.SitDownAtAsync(Far, ScriptedContactUplink.CraftReportTopic);
            return (world, client, view);
        }

        private static async Task TickAsync(ReckonedVantageWorld world, TestClient client, CentreView view, params double[] uts)
        {
            foreach (var ut in uts)
            {
                world.Tick(ut);
            }
            await ReckonedVantageWorld.SettleAsync(client, view);
        }

        [Fact]
        public async Task ACraftsReportReachesACentreAtThatCraftsDelayNotTheFlownCrafts()
        {
            var (world, client, view) = await AtFarAsync();
            await using var _ = world;
            await using var __ = client;
            await TickAsync(world, client, view, 1, 2, 300, 302, 700, 702);

            await TickAsync(world, client, view, T0);
            world.Uplink.RelaySays(new Dictionary<string, object?> { ["said"] = "relay" }, T0);
            await TickAsync(world, client, view, T0 + 2, T0 + 10, T0 + 299);
            Reckoned.True(view.Latest(ScriptedContactUplink.CraftReportTopic) == null, "the far station heard the relay's report sooner than the relay's light could carry it");

            await TickAsync(world, client, view, T0 + 303, T0 + 304, T0 + 305);
            Assert.NotNull(view.Latest(ScriptedContactUplink.CraftReportTopic));
        }

        [Fact]
        public async Task ACraftWithNoRouteSaysNothingToAnyCentre()
        {
            var (world, client, view) = await AtFarAsync();
            await using var _ = world;
            await using var __ = client;
            await TickAsync(world, client, view, 1, 2, 300, 302, 700, 702);

            world.Game.RelayConnected = false;
            await TickAsync(world, client, view, 800, 802);
            await TickAsync(world, client, view, T0);
            world.Uplink.RelaySays(new Dictionary<string, object?> { ["said"] = "relay" }, T0);
            await TickAsync(world, client, view, T0 + 2, T0 + 303, T0 + 304, T0 + 3000, T0 + 3002);

            Assert.Null(view.Latest(ScriptedContactUplink.CraftReportTopic));
        }

        [Fact]
        public async Task ACraftDestroyedInContactSaysItsLastWordUnderItsLastDelay()
        {
            var (world, client, view) = await AtFarAsync();
            await using var _ = world;
            await using var __ = client;
            await TickAsync(world, client, view, 1, 2, 300, 302, 700, 702);

            world.Game.DestroyRelay();
            await TickAsync(world, client, view, T0, T0 + 2);
            world.Uplink.RelaySays(new Dictionary<string, object?> { ["said"] = "relay" }, T0);
            await TickAsync(world, client, view, T0 + 4, T0 + 299);
            Reckoned.True(view.Latest(ScriptedContactUplink.CraftReportTopic) == null, "the far station heard a destroyed relay's report sooner than its light could carry it");

            await TickAsync(world, client, view, T0 + 303, T0 + 304, T0 + 305);
            Assert.NotNull(view.Latest(ScriptedContactUplink.CraftReportTopic));
        }
    }
}
