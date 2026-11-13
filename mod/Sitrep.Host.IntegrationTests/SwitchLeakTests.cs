using System.Linq;
using System.Threading.Tasks;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A craft the game switches to reaches a command centre no sooner than its
    /// light does. The switch withdraws the readings of the craft left behind at
    /// the switch's own instant, and the new craft's first readings are made at
    /// that same instant: they must still cross under the delay to the new craft,
    /// not under the withdrawal's.
    /// </summary>
    public class SwitchLeakTests
    {
        private const double SignalSeconds = 30.0;
        private const string Craft = "B";
        private const double CraftValue = 50.0;

        [Theory]
        [InlineData(ScriptedContactGame.Far)]
        [InlineData(ScriptedContactGame.Home)]
        public async Task ANewCraftsFirstReadingsReachACentreOnlyAfterTheirDelay(string centre)
        {
            await using var world = await ReckonedVantageWorld.StartAsync(watchTelemetry: true);
            world.Game.ActiveSeconds = SignalSeconds;
            var view = centre == ScriptedContactGame.Far ? world.Far : world.Home;

            // The craft left behind, linked and measured.
            world.Game.ActiveValue = 7.0;
            foreach (var ut in new[] { 1000.0, 1001.0, 1002.0 })
            {
                world.Tick(ut);
            }

            // The switch, with its delay measured on the same tick, as the game measures a connected craft.
            world.Game.ActiveNow = Craft;
            world.Game.ActiveValue = CraftValue;
            foreach (var ut in new[] { 1003.0, 1004.0, 1005.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();

            var early = view.Telemetry.Where(t => t.Value == CraftValue && t.DeliveredAt < 1003.0 + SignalSeconds - 0.5).ToList();
            Assert.True(
                early.Count == 0,
                "the new craft's readings reached " + centre + " before its light could: "
                + string.Join("; ", early.Select(t => "validAt " + t.ValidAt + ", deliveredAt " + t.DeliveredAt)));

            for (var ut = 1010.0; ut <= 1050.0; ut += 5.0)
            {
                world.Tick(ut);
            }
            await world.SettleAsync();

            var landed = view.Telemetry.Where(t => t.Value == CraftValue).ToList();
            Assert.NotEmpty(landed);
            foreach (var frame in landed)
            {
                Assert.True(
                    frame.DeliveredAt - frame.ValidAt >= SignalSeconds - 0.5,
                    "a reading made at " + frame.ValidAt + " reached " + centre + " at " + frame.DeliveredAt
                    + ", " + (frame.DeliveredAt - frame.ValidAt) + " s after it was made, under a delay of " + SignalSeconds);
            }
        }
    }
}
