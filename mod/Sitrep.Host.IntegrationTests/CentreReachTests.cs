using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Each command centre learns whether it can hear a craft from word that
    /// reaches it, not from the game: a route gained arrives over that route,
    /// and a route lost arrives when the last of what the craft sent stops
    /// arriving, one of that centre's own signal delays after it was lost. The
    /// home centre ten light-minutes from the relay, the far centre five.
    /// </summary>
    public class CentreReachTests
    {
        private const string Home = ScriptedContactGame.Home;
        private const string Far = ScriptedContactGame.Far;
        private const string Relay = ScriptedContactGame.RelayGuid;

        private static double DelayTo(string centre) => centre == Far ? 300.0 : 600.0;

        private static bool? Reaches(ReckonedVantageWorld world, string centre) =>
            world.Uplink.Reach(centre, Relay)?.Reaches(centre);

        [Fact]
        public async Task EachCentreLearnsItCanHearACraftAtItsOwnLightTime()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();

            Ticks(world, 1, 299);
            Assert.Null(Reaches(world, Far));

            Ticks(world, 300, 599);
            Assert.True(Reaches(world, Far));
            Assert.Null(Reaches(world, Home));

            Ticks(world, 600);
            Assert.True(Reaches(world, Home));
        }

        /// <summary>The far centre's own path goes while the relay still talks to the ground: it is silent, and the home centre is not told otherwise.</summary>
        [Fact]
        public async Task ACentreThatLosesItsOwnPathLearnsSoAtItsLastLightTimeAndNoOtherCentreIsMoved()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            Ticks(world, 1, 700);

            world.Game.FarRoutedToRelay = false;
            Ticks(world, 1000, 1299);
            Assert.True(Reaches(world, Far));

            Ticks(world, 1300);
            Assert.False(Reaches(world, Far));
            Assert.Equal(700.0, world.Uplink.Reach(Far, Relay)!.LastReachedAt(Far));

            Ticks(world, 1600, 2000);
            Assert.True(Reaches(world, Home));
        }

        [Fact]
        public async Task ACraftWhoseLinkGoesIsHeardSilentAtEachCentreAtItsOwnLightTime()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            Ticks(world, 1, 700);

            world.Game.RelayConnected = false;
            Ticks(world, 1000, 1299);
            Assert.True(Reaches(world, Far));

            Ticks(world, 1300, 1599);
            Assert.False(Reaches(world, Far));
            Assert.True(Reaches(world, Home));

            Ticks(world, 1600);
            Assert.False(Reaches(world, Home));
            Assert.Equal(700.0, world.Uplink.Reach(Home, Relay)!.LastReachedAt(Home));
        }

        /// <summary>The loss is dated to the tick the game read it on, so the centre hears it one delay after that tick and not one tick later.</summary>
        [Fact]
        public async Task ALostLinkIsHeardOneDelayAfterTheTickTheGameReadItOn()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            for (var ut = 1.0; ut <= 700.0; ut += 1.0)
            {
                world.Tick(ut);
            }
            world.Game.RelayConnected = false;
            world.Tick(1000.0);

            double? heardAt = null;
            for (var ut = 1001.0; ut <= 1700.0 && heardAt == null; ut += 1.0)
            {
                world.Tick(ut);
                if (Reaches(world, Home) == false)
                {
                    heardAt = ut;
                }
            }

            Assert.Equal(1000.0 + DelayTo(Home), heardAt);
            Assert.Equal(1000.0, world.Uplink.Reach(Home, Relay)!.CapturedUt);
        }

        /// <summary>Looks five game seconds apart, as at ten times warp: the board turns from heard to unheard within a tick of the word arriving, not at the next look.</summary>
        [Fact]
        public async Task TheBoardStopsHearingACraftWhenTheWordOfItsLossArrivesWhateverTheLookSpacing()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            world.Uplink.WallPerTick = 0.1f;
            for (var ut = 1.0; ut <= 700.0; ut += 1.0)
            {
                world.Tick(ut);
            }
            world.Game.RelayConnected = false;
            world.Tick(1000.0);

            double? changedAt = null;
            for (var ut = 1001.0; ut <= 1700.0 && changedAt == null; ut += 1.0)
            {
                world.Tick(ut);
                if (world.Uplink.Knowledge.KnowledgeAt(Home, Relay, ut).State != CraftKnowledgeState.Heard)
                {
                    changedAt = ut;
                }
            }

            // The tick that delivers the word runs after the board's refresh, so the board follows by one tick.
            Assert.InRange(changedAt!.Value, 1000.0 + DelayTo(Home), 1000.0 + DelayTo(Home) + 1.0);
        }

        [Fact]
        public async Task ARouteRegainedIsHeardOverThatRoute()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            Ticks(world, 1, 700);
            world.Game.FarRoutedToRelay = false;
            Ticks(world, 1000, 1300);

            world.Game.FarRoutedToRelay = true;
            Ticks(world, 2000, 2299);
            Assert.False(Reaches(world, Far));

            Ticks(world, 2300);
            Assert.True(Reaches(world, Far));
        }

        /// <summary>Every ground station is the home centre's antenna, so a craft whose route ends away from all of them cannot be heard at home, and is still heard by a station its own route reaches.</summary>
        [Fact]
        public async Task ACraftWhoseRouteEndsAwayFromTheGroundIsSilentAtTheHomeCentreAlone()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            var home = world.Engine.HomeCentre()!;
            var other = home == Far ? Home : Far;
            Ticks(world, 1, 700);

            world.Game.RelayOffTheGround = true;
            Ticks(world, 1000, 1000 + DelayTo(home) - 1.0);
            Assert.True(Reaches(world, home));

            Ticks(world, 1000 + DelayTo(home), 2000);
            Assert.False(Reaches(world, home));
            Assert.True(Reaches(world, other));
        }

        /// <summary>A save with no comms network models no blackout: whatever the routes say, every centre hears every craft.</summary>
        [Fact]
        public async Task InASaveWithNoCommsModelEveryCentreHearsTheCraftWhateverItsRoutes()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            world.Uplink.Inputs.SetNetworkModelled(false);
            Ticks(world, 1, 700);

            world.Game.FarRoutedToRelay = false;
            world.Game.RelayOffTheGround = true;
            Ticks(world, 1000, 1300, 1600, 2000);

            Assert.True(Reaches(world, Far));
            Assert.True(Reaches(world, Home));
        }

        private static void Ticks(ReckonedVantageWorld world, params double[] uts)
        {
            foreach (var ut in uts)
            {
                world.Tick(ut);
            }
        }
    }
}
