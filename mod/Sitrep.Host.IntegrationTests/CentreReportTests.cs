using System.Threading.Tasks;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The home centre knows of contact with a craft it cannot hear itself from
    /// a crewed centre that can, once that centre's report has reached home over
    /// the centre's own link, and only for as long as the ground can still hear
    /// the centre.
    ///
    /// <para>The active craft is heard by no ground station: its route ends away
    /// from the ground, and the one station that is not home has no path to it.
    /// The relay is a crewed centre five light-seconds from it, and the home
    /// centre hears the relay three hundred light-seconds out.</para>
    /// </summary>
    public class CentreReportTests
    {
        private const string Active = ScriptedContactGame.ActiveGuid;

        private static ScriptedContactGame HeardOnlyByTheRelay()
        {
            var game = new ScriptedContactGame { RelayIsCentre = true, RelayIsEngineCentre = true, ActiveOffTheGround = true };
            game.Unroutable.Add((ScriptedContactGame.Home, Active));
            game.Unroutable.Add((ScriptedContactGame.Far, Active));
            return game;
        }

        private static CentreContactState? AtHome(ReckonedVantageWorld world) => world.Uplink.HomeContact(Active)?.State;

        [Fact]
        public async Task HomeIsInContactWithACraftOnlyACrewedCentreHearsOnceThatCentresReportArrives()
        {
            await using var world = await ReckonedVantageWorld.StartAsync(HeardOnlyByTheRelay());
            Assert.Equal(ScriptedContactGame.Far, world.Engine.HomeCentre());

            Ticks(world, 5, 10, 300, 309);
            Assert.NotEqual(CentreContactState.InContact, AtHome(world));

            Ticks(world, 310, 320);
            Assert.Equal(CentreContactState.InContact, AtHome(world));
        }

        /// <summary>The relay may still hear the craft, but once the ground has lost the relay, home knows only that it did when it last reported.</summary>
        [Fact]
        public async Task ACrewedCentreTheGroundLosesLeavesHomeSilentSinceItsLastReport()
        {
            await using var world = await ReckonedVantageWorld.StartAsync(HeardOnlyByTheRelay());
            Ticks(world, 5, 10, 320, 700);
            Assert.Equal(CentreContactState.InContact, AtHome(world));

            // The far station loses the relay at 1300 and the home station at 1600; the ground has lost it once both have.
            world.Game.RelayConnected = false;
            Ticks(world, 1000, 1300, 1599);
            Assert.Equal(CentreContactState.InContact, AtHome(world));

            Ticks(world, 1600);
            var contact = world.Uplink.HomeContact(Active)!.Value;
            Assert.Equal(CentreContactState.Silent, contact.State);
            Assert.InRange(contact.LastContactUt!.Value, 10.0, 999.0);
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
