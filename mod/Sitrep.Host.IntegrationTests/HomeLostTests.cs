using System.Threading.Tasks;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The home centre alone declares a craft lost, from every centre's word as
    /// it has reached home, and sends the declaration out at each centre's delay
    /// to home.
    ///
    /// <para>In the relay worlds the active craft is heard by no ground station
    /// and by the crewed relay five light-seconds away, which is three hundred
    /// light-seconds from the home ledger.</para>
    /// </summary>
    public class HomeLostTests
    {
        private const string Active = ScriptedContactGame.ActiveGuid;
        private const string Relay = ScriptedContactGame.RelayGuid;

        private static ScriptedContactGame HeardOnlyByTheRelay()
        {
            var game = new ScriptedContactGame { RelayIsCentre = true, RelayIsEngineCentre = true, ActiveOffTheGround = true };
            game.Unroutable.Add((ScriptedContactGame.Home, Active));
            game.Unroutable.Add((ScriptedContactGame.Far, Active));
            game.Forecasts[Active] = ScriptedContactGame.Forecast(Active, 0.0, 1000.0);
            return game;
        }

        private static HomeVerdictState? Verdict(ReckonedVantageWorld world, string vesselId) => world.Uplink.HomeVerdict(vesselId)?.State;

        [Fact]
        public async Task ACraftOnlyACrewedCentreHearsIsNotLostWhileThatCentresReportsReachHome()
        {
            await using var world = await ReckonedVantageWorld.StartAsync(HeardOnlyByTheRelay());

            Ticks(world, 5, 10, 320, 1000, 1001, 2000, 3000, 3001);

            Assert.Equal(HomeVerdictState.Nominal, Verdict(world, Active));
            Assert.Equal(0, world.Uplink.HomeVerdict(Active)!.LostSeq);
        }

        /// <summary>
        /// Cut off from home, the relay can say nothing, so home declares the craft
        /// lost. The relay's report of contact, arriving once it is heard again,
        /// withdraws the declaration and keeps its number.
        /// </summary>
        [Fact]
        public async Task ACrewedCentreCutOffFromHomeLeavesTheCraftLostUntilItsReportArrives()
        {
            await using var world = await ReckonedVantageWorld.StartAsync(HeardOnlyByTheRelay());
            Ticks(world, 5, 10, 320, 700);

            // Home loses the relay once both ground stations have, at 1600. Its last report is from before 1000, so the deadline has run out by 2000.
            world.Game.RelayConnected = false;
            Ticks(world, 1000, 1300, 1599);
            Assert.NotEqual(HomeVerdictState.Lost, Verdict(world, Active));

            Ticks(world, 1600, 1601, 2100, 2101);
            var lost = world.Uplink.HomeVerdict(Active)!.Copy();
            Assert.Equal(HomeVerdictState.Lost, lost.State);
            Assert.Equal(1, lost.LostSeq);

            world.Game.RelayConnected = true;
            Ticks(world, 2200, 2499);
            Assert.Equal(HomeVerdictState.Lost, Verdict(world, Active));

            Ticks(world, 2500, 2501);
            var withdrawn = world.Uplink.HomeVerdict(Active)!;
            Assert.Equal(HomeVerdictState.Nominal, withdrawn.State);
            Assert.Equal(1, withdrawn.LostSeq);
            Assert.Equal(lost.DeclaredLostUt, withdrawn.DeclaredLostUt);
            Assert.NotNull(withdrawn.WithdrawnUt);
        }

        /// <summary>A craft no centre can hear is declared at its deadline, and the relay, three hundred light-seconds from the ledger, hears so that much later.</summary>
        [Fact]
        public async Task TheDeclarationReachesACrewedCentreAtItsDelayToHome()
        {
            var game = HeardOnlyByTheRelay();
            game.Unroutable.Add((ScriptedContactGame.Relay, Active));
            await using var world = await ReckonedVantageWorld.StartAsync(game);

            Ticks(world, 5, 10, 500, 1000, 1001);
            Assert.Equal(HomeVerdictState.Lost, Verdict(world, Active));
            Assert.Equal(1001.0, world.Uplink.HomeVerdict(Active)!.DeclaredLostUt);

            Ticks(world, 1300);
            Assert.NotEqual(HomeVerdictState.Lost, world.Uplink.VerdictHeardAt(ScriptedContactGame.Relay, Active)?.State);

            Ticks(world, 1301);
            Assert.Equal(HomeVerdictState.Lost, world.Uplink.VerdictHeardAt(ScriptedContactGame.Relay, Active)?.State);
        }

        /// <summary>A declaration and its number are saved with what home heard, so a load neither forgets it nor makes it again.</summary>
        [Fact]
        public async Task ADeclarationSurvivesASaveAndLoadWithoutBeingMadeAgain()
        {
            var game = HeardOnlyByTheRelay();
            game.Unroutable.Add((ScriptedContactGame.Relay, Active));
            await using var world = await ReckonedVantageWorld.StartAsync(game);
            Ticks(world, 5, 10, 500, 1000, 1001, 1002);
            var saved = HeardSnapshotCodec.Decode(HeardSnapshotCodec.Encode(world.Engine.HeardSnapshotNow()!));

            world.Engine.NoteGameLoaded(new Sitrep.Core.StoreAndForward.DeliverySnapshot(), saved);
            Ticks(world, 1003, 1004, 1005, 3000, 3001);

            var verdict = world.Uplink.HomeVerdict(Active)!;
            Assert.Equal(HomeVerdictState.Lost, verdict.State);
            Assert.Equal(1, verdict.LostSeq);
            Assert.Equal(1001.0, verdict.DeclaredLostUt);
        }

        [Fact]
        public async Task InASaveWithNoCommsModelNothingIsDeclaredLost()
        {
            var game = HeardOnlyByTheRelay();
            game.Unroutable.Add((ScriptedContactGame.Relay, Active));
            await using var world = await ReckonedVantageWorld.StartAsync(game);
            world.Uplink.Inputs.SetNetworkModelled(false);

            Ticks(world, 5, 10, 500, 1000, 1001, 5000, 5001);

            Assert.NotEqual(HomeVerdictState.Lost, Verdict(world, Active));
        }

        /// <summary>
        /// The relay is heard again just before its deadline, in its own time. Word
        /// of that is six hundred light-seconds from home at the longest, so home's
        /// clock passing the deadline is no reason to declare it.
        /// </summary>
        [Fact]
        public async Task ACraftHeardAgainJustBeforeItsDeadlineIsNeverDeclaredWhileWordOfItIsOnItsWay()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            Ticks(world, 1, 700);

            world.Game.RelayConnected = false;
            world.Game.Forecasts[Relay] = ScriptedContactGame.Forecast(Relay, 1000.0, 2000.0);
            Ticks(world, 1000, 1300, 1600);
            world.Game.RelayConnected = true;
            Ticks(world, 1990, 2000, 2001, 2100, 2290, 2300, 2600, 2601, 3000);

            Assert.NotEqual(HomeVerdictState.Lost, Verdict(world, Relay));
            Assert.Equal(0, world.Uplink.HomeVerdict(Relay)!.LostSeq);
        }

        /// <summary>The same craft not heard again is declared once home has waited out the longest route word of it could take.</summary>
        [Fact]
        public async Task ACraftNotHeardAgainIsDeclaredOnceTheLongestRouteHasBeenWaitedOut()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            Ticks(world, 1, 700);

            world.Game.RelayConnected = false;
            world.Game.Forecasts[Relay] = ScriptedContactGame.Forecast(Relay, 1000.0, 2000.0);
            Ticks(world, 1000, 1300, 1600, 2000, 2001, 2599);
            Assert.NotEqual(HomeVerdictState.Lost, Verdict(world, Relay));

            Ticks(world, 2600, 2601);
            Assert.Equal(HomeVerdictState.Lost, Verdict(world, Relay));
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
