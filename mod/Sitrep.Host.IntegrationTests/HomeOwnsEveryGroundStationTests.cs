using System;
using System.Threading.Tasks;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Every ground station is the home centre's own antenna, so its commands
    /// go out through whichever station can reach the craft, as its telemetry
    /// comes in through whichever can hear it.
    ///
    /// <para>No centre is marked home in this world, so the engine takes the
    /// first ground station by id, which is the one the scripted game calls
    /// far. The relay here is over the other station and below that one's
    /// horizon.</para>
    /// </summary>
    public class HomeOwnsEveryGroundStationTests
    {
        private const string Other = ScriptedContactGame.Home;

        [Fact]
        public async Task HomesCommandLeavesThroughTheStationThatCanReachTheRelay()
        {
            var game = new ScriptedContactGame(-7.0 * Math.PI / 18.0) { FarLinkedToRelay = false };
            await using var world = await ReckonedVantageWorld.StartAsync(game);
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0, 704.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();
            var home = world.Engine.HomeCentre()!;
            Assert.NotEqual(Other, home);
            Assert.False(world.Far.PlansContactAt(home, ScriptedContactGame.Relay, 704.0), "the relay is in sight of home's own station, so this proves nothing");
            Assert.True(world.Far.PlansContactAt(Other, ScriptedContactGame.Relay, 704.0), "the relay is in sight of no station");

            world.Engine.DispatchCommandAndWait(ScriptedContactUplink.RelayCommand, "x", home, _ => { }, TestBudgets.Op);
            var entry = Assert.Single(Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending);
            Assert.Null(entry.PredictedHeldAt);
            Assert.NotNull(entry.OneWaySeconds);

            world.Tick(704.0 + world.Game.RelayFromHomeSeconds + 30.0);
            Assert.Equal(1, world.Uplink.HandledCount);
        }
    }
}
