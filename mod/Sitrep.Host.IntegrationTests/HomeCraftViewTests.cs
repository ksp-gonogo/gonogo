using System.Threading.Tasks;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Home's view of each craft, as the career's books read it from the game's
    /// thread: home's contact with the craft, the last instant it knows of
    /// contact, and its judgement.
    /// </summary>
    public class HomeCraftViewTests
    {
        private const string Active = ScriptedContactGame.ActiveGuid;

        private static ScriptedContactGame HeardByNoCentre()
        {
            var game = new ScriptedContactGame { RelayIsCentre = true, RelayIsEngineCentre = true, ActiveOffTheGround = true };
            game.Unroutable.Add((ScriptedContactGame.Home, Active));
            game.Unroutable.Add((ScriptedContactGame.Far, Active));
            game.Unroutable.Add((ScriptedContactGame.Relay, Active));
            game.Forecasts[Active] = ScriptedContactGame.Forecast(Active, 0.0, 1000.0);
            return game;
        }

        [Fact]
        public async Task ACraftNoCentreHearsReadsSilentThenLostOnceHomeDeclaresIt()
        {
            await using var world = await ReckonedVantageWorld.StartAsync(HeardByNoCentre());

            Ticks(world, 5, 10, 500);
            var silent = world.Uplink.HomeView(Active);
            Assert.NotNull(silent);
            Assert.Equal(CentreContactState.Silent, silent!.Value.Contact);
            Assert.Equal(HomeVerdictState.Silent, silent.Value.Verdict);

            Ticks(world, 1000, 1001);
            var lost = world.Uplink.HomeView(Active)!.Value;
            Assert.Equal(HomeVerdictState.Lost, lost.Verdict);
            Assert.Equal(1, lost.LostSeq);
        }

        [Fact]
        public async Task ACraftHeardAgainReadsInContactWithItsNewestContact()
        {
            var game = HeardByNoCentre();
            await using var world = await ReckonedVantageWorld.StartAsync(game);
            Ticks(world, 5, 10, 500);

            game.Unroutable.Clear();
            Ticks(world, 600, 601, 602);

            var view = world.Uplink.HomeView(Active)!.Value;
            Assert.Equal(CentreContactState.InContact, view.Contact);
            Assert.True(view.LastContactUt >= 600.0);
        }

        [Fact]
        public async Task ADeclarationIsReadAgainAfterALoad()
        {
            await using var world = await ReckonedVantageWorld.StartAsync(HeardByNoCentre());
            Ticks(world, 5, 10, 500, 1000, 1001, 1002);
            var saved = HeardSnapshotCodec.Decode(HeardSnapshotCodec.Encode(world.Engine.HeardSnapshotNow()!));

            world.Engine.NoteGameLoaded(new Sitrep.Core.StoreAndForward.DeliverySnapshot(), saved);
            Ticks(world, 1003, 1004);

            Assert.Equal(HomeVerdictState.Lost, world.Uplink.HomeView(Active)?.Verdict);
        }

        [Fact]
        public async Task ACraftHomeHasNoWordOfHasNoView()
        {
            await using var world = await ReckonedVantageWorld.StartAsync(HeardByNoCentre());
            Ticks(world, 5);

            Assert.Null(world.Uplink.HomeView("no-such-craft"));
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
