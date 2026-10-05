using System.Linq;
using System.Threading.Tasks;
using Sitrep.Core.StoreAndForward;
using Sitrep.Host.Comms;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// What each command centre has heard of each craft is saved with the game.
    /// A load leaves every centre knowing what it knew at the save: it can plan
    /// for and command a craft at once, where it used to be blind to every
    /// craft for one light-time after every load, and it knows nothing that
    /// was still on its way to it when the game was saved.
    ///
    /// <para>The relay is ten light-minutes from the home centre.</para>
    /// </summary>
    public class HeardStatesSavedTests
    {
        private const string Home = ScriptedContactGame.Home;
        private const string Relay = ScriptedContactGame.Relay;

        private static HeardSnapshot? SavedAndReadBack(ReckonedVantageWorld world) =>
            HeardSnapshotCodec.Decode(HeardSnapshotCodec.Encode(world.Engine.HeardSnapshotNow()!));

        [Fact]
        public async Task AfterALoadACentrePlansForAndCommandsACraftItHadHeardOfWhenTheGameWasSaved()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();
            Assert.True(world.Home.PlansPair(Home, Relay));
            var saved = SavedAndReadBack(world);

            world.Engine.NoteGameLoaded(new DeliverySnapshot(), saved);
            world.Tick(703.0);
            world.Tick(704.0);
            await world.SettleAsync();

            Assert.True(world.Home.PlansPair(Home, Relay), "the home centre forgot a craft it had heard of when the game was saved");
            world.Engine.DispatchCommandAndWait(ScriptedContactUplink.RelayCommand, "x", Home, _ => { }, TestBudgets.Op);
            var entry = Assert.Single(Assert.IsType<Sitrep.Contract.PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending);
            Assert.Null(entry.PredictedHeldAt);
            Assert.NotNull(entry.OneWaySeconds);
            world.Tick(704.0 + world.Game.RelayFromHomeSeconds + 30.0);
            Assert.Equal(1, world.Uplink.HandledCount);
        }

        /// <summary>
        /// The relay burned a hundred seconds before the save, and its light was
        /// still five hundred seconds from home. The save carries what home had
        /// heard, which is the old orbit. After the load home still has the old
        /// orbit, and hears of the burn one light-time after the load, when the
        /// relay's state as it stands reaches it.
        /// </summary>
        [Fact]
        public async Task ALoadRevealsNothingACentreHadNotHeardWhenTheGameWasSaved()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            var (client, view) = await world.SitDownAtAsync(Home, SystemViewProvider.VesselsTopic);
            await using var seated = client;
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            world.Game.BurnRelay(1000.0);
            world.Tick(1000.0);
            world.Tick(1100.0);
            await ReckonedVantageWorld.SettleAsync(client, view);
            double Sma() => view.Vessel(ScriptedContactGame.RelayGuid)!.Value.GetProperty("orbit").GetProperty("sma").GetDouble();
            Assert.Equal(ScriptedContactGame.RelayRadius, Sma(), 3);
            var saved = SavedAndReadBack(world);
            var heardAtHome = saved!.Centres.Single(c => c.Centre == Home).States.Single(s => s.Id == Relay);
            Assert.Equal(ScriptedContactGame.RelayRadius, heardAtHome.Orbit!.Value.Sma, 3);

            world.Engine.NoteGameLoaded(new DeliverySnapshot(), saved);
            world.Tick(1101.0);
            world.Tick(1102.0);
            world.Tick(1700.0);
            await ReckonedVantageWorld.SettleAsync(client, view);
            Assert.Equal(ScriptedContactGame.RelayRadius, Sma(), 3);

            world.Tick(1703.0);
            world.Tick(1704.0);
            await ReckonedVantageWorld.SettleAsync(client, view);
            Assert.NotEqual(ScriptedContactGame.RelayRadius, Sma(), 3);
        }

        [Fact]
        public async Task ALoadThatCarriesNothingLeavesEveryCentreToHearAgain()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();

            world.Engine.NoteGameLoaded(new DeliverySnapshot(), null);
            world.Tick(703.0);
            world.Tick(704.0);

            Assert.Null(world.Engine.HeardSnapshotNow()!.Centres.SingleOrDefault(c => c.Centre == Home)?.States.SingleOrDefault(s => s.Id == Relay));
        }
    }
}
