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

        /// <summary>
        /// A save can carry a centre that was a crewed craft since recovered or
        /// destroyed. It is in no list the game will ever give again, so it is
        /// dropped at the first look after the load and the next save is
        /// written without it.
        /// </summary>
        [Fact]
        public async Task ACentreASaveCarriesThatIsACraftNoLongerInTheGameIsNotCarriedIntoTheNextSave()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();
            var saved = SavedAndReadBack(world)!;
            var atHome = saved.Centres.Single(c => c.Centre == Home);
            var withGhost = new HeardSnapshot(saved.Centres.Append(
                new HeardAtCentre("vessel:recovered-long-ago", atHome.States, atHome.Links, atHome.Radios, atHome.Sightings)).ToList());

            world.Engine.NoteGameLoaded(new DeliverySnapshot(), withGhost);
            world.Tick(703.0);
            world.Tick(704.0);
            await world.SettleAsync();

            var after = world.Engine.HeardSnapshotNow()!;
            Assert.DoesNotContain(after.Centres, c => c.Centre == "vessel:recovered-long-ago");
            Assert.Single(after.Centres.Single(c => c.Centre == Home).States, s => s.Id == Relay);
        }

        /// <summary>
        /// A game loaded at the space centre lists no craft, and every craft is
        /// read again after a load. What a centre is then told carries no list
        /// entry, and the craft stays on its list as it was last listed.
        /// </summary>
        [Fact]
        public async Task ACraftReadAgainAfterALoadOutsideFlightStaysOnACentresList()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            var (client, view) = await world.SitDownAtAsync(Home, SystemViewProvider.VesselsTopic);
            await using var seated = client;
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            await ReckonedVantageWorld.SettleAsync(client, view);
            Assert.NotNull(view.Vessel(ScriptedContactGame.RelayGuid));
            var saved = SavedAndReadBack(world);

            world.Game.OutOfFlight = true;
            world.Engine.NoteGameLoaded(new DeliverySnapshot(), saved);
            foreach (var ut in new[] { 703.0, 704.0, 1400.0, 1402.0, 1404.0 })
            {
                world.Tick(ut);
            }
            await ReckonedVantageWorld.SettleAsync(client, view);

            Assert.True(view.Vessel(ScriptedContactGame.RelayGuid) != null, "a craft left a centre's list because the game, out of flight, listed nothing for it");
        }

        /// <summary>
        /// The game saves a moment after a load, before its vessel list has
        /// been filled and so before the centres have been given back what the
        /// loaded game carried. That save must carry what the loaded game did:
        /// not nothing, and not what was heard on the timeline the load left.
        /// </summary>
        [Fact]
        public async Task ASaveWrittenAfterALoadAndBeforeTheVesselListStandsCarriesWhatTheLoadedGameCarried()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            world.Tick(1.0);
            world.Tick(2.0);
            await world.SettleAsync();
            var early = SavedAndReadBack(world)!;
            Assert.DoesNotContain(early.Centres.Single(c => c.Centre == Home).States, s => s.Id == Relay);
            world.Tick(700.0);
            world.Tick(702.0);
            await world.SettleAsync();
            Assert.Contains(world.Engine.HeardSnapshotNow()!.Centres.Single(c => c.Centre == Home).States, s => s.Id == Relay);

            world.Game.ListNotStanding = true;
            world.Engine.NoteGameLoaded(new DeliverySnapshot(), early);
            world.Tick(3.0);
            world.Tick(4.0);

            var written = world.Engine.HeardSnapshotNow()!;
            Assert.Contains(written.Centres, c => c.Centre == Home);
            Assert.DoesNotContain(written.Centres.Single(c => c.Centre == Home).States, s => s.Id == Relay);
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

        /// <summary>
        /// A process that resumes a game resets its timeline twice, a tick
        /// apart, and only the first reset comes with the load. The second
        /// keeps what the save held, where it used to leave every centre
        /// knowing nothing.
        /// </summary>
        [Fact]
        public async Task AResetOneTickAfterALoadKeepsWhatTheSaveHeld()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();
            var saved = SavedAndReadBack(world);

            world.Engine.NoteGameLoaded(new DeliverySnapshot(), saved, savedUt: 702.0);
            world.Tick(703.0);
            world.Tick(702.5);
            world.Tick(703.5);
            await world.SettleAsync();

            Assert.NotNull(world.Engine.HeardSnapshotNow()!.Centres.SingleOrDefault(c => c.Centre == Home)?.States.SingleOrDefault(s => s.Id == Relay));
        }

        /// <summary>
        /// A quickload turns the clock back before the game hands the save's
        /// own record over. The engine was told what the save held when it was
        /// written, so the rewind restores that, and not what an earlier scene
        /// change had carried: home keeps the newest reading it had at the
        /// save, where it was put back to an older one.
        /// </summary>
        [Fact]
        public async Task AQuickloadRestoresWhatTheNewestSaveHeldThoughTheClockTurnsBackBeforeTheGameHandsItOver()
        {
            var game = new ScriptedContactGame { Radio = ThroughTheRelay(0.9) };
            await using var world = await ReckonedVantageWorld.StartAsync(game);
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();
            // A scene change: the game saves, and loads what it has just saved.
            var atSceneChange = SavedAndReadBack(world);
            world.Engine.NoteSaved(new DeliverySnapshot(), atSceneChange, 702.0);
            world.Engine.NoteSaveReloaded(new DeliverySnapshot(), atSceneChange, 702.0);

            world.Game.Radio = ThroughTheRelay(0.4);
            foreach (var ut in new[] { 1000.0, 1002.0, 1700.0, 1702.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();
            var quicksave = SavedAndReadBack(world);
            Assert.Equal(0.4, quicksave!.Centres.Single(c => c.Centre == Home).Radios.Single().Strength, 6);
            world.Engine.NoteSaved(new DeliverySnapshot(), quicksave, 1702.0);
            world.Tick(1704.0);

            world.Tick(1702.02);
            world.Tick(1703.0);
            await world.SettleAsync();

            Assert.Equal(0.4, world.Engine.HeardSnapshotNow()!.Centres.Single(c => c.Centre == Home).Radios.Single().Strength, 6);
        }

        /// <summary>
        /// Loading an older save than the newest one written turns the clock
        /// back past what the newest held. Nothing of the newer save is
        /// restored: a centre never knows what it had not yet heard.
        /// </summary>
        [Fact]
        public async Task ARewindToBeforeTheNewestSaveRestoresNothingOfIt()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();
            var saved = SavedAndReadBack(world);
            Assert.NotNull(saved!.Centres.Single(c => c.Centre == Home).States.SingleOrDefault(s => s.Id == Relay));
            world.Engine.NoteSaved(new DeliverySnapshot(), saved, 702.0);

            world.Tick(300.0);
            world.Tick(301.0);
            await world.SettleAsync();

            Assert.Null(world.Engine.HeardSnapshotNow()!.Centres.SingleOrDefault(c => c.Centre == Home)?.States.SingleOrDefault(s => s.Id == Relay));
        }

        private static ContactRadio ThroughTheRelay(double strength) => new ContactRadio(
            ScriptedContactGame.Active,
            true,
            strength,
            new Sitrep.Contract.CommsDegrade { ModelId = "test", ModelName = "Test grading", Level = 1.0 - strength },
            new[]
            {
                new RadioHop(ScriptedContactGame.ActiveGuid, ScriptedContactGame.RelayGuid, true),
                new RadioHop(ScriptedContactGame.RelayGuid, ScriptedContactGame.HomeName, false),
            });

        private static double? Strength(CentreView view)
        {
            var payload = view.Latest(ContactPlanSource.SignalTopic);
            if (payload == null)
            {
                return null;
            }
            using var doc = System.Text.Json.JsonDocument.Parse(payload);
            return doc.RootElement.GetProperty("strength").GetDouble();
        }

        /// <summary>
        /// The reading of the craft's radio that home had heard is in the save.
        /// A session that sits down after the load is sent home's signal at
        /// once, where it had none until the craft's next reading had crossed
        /// the ten light-minutes its path runs through. A reading taken after
        /// the save, which had not arrived, is not in it.
        /// </summary>
        [Fact]
        public async Task AfterALoadACentreStillHasTheSignalItHadHeardAndNotTheOneStillOnItsWay()
        {
            var game = new ScriptedContactGame { Radio = ThroughTheRelay(0.9) };
            await using var world = await ReckonedVantageWorld.StartAsync(game);
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            // The reading changes a hundred seconds before the save, five hundred short of home.
            world.Game.Radio = ThroughTheRelay(0.4);
            foreach (var ut in new[] { 1000.0, 1002.0, 1100.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();
            var saved = SavedAndReadBack(world);
            Assert.Equal(0.9, saved!.Centres.Single(c => c.Centre == Home).Radios.Single().Strength, 6);

            world.Engine.NoteGameLoaded(new DeliverySnapshot(), saved);
            var (client, view) = await world.SitDownAtAsync(Home, ContactPlanSource.SignalTopic, ContactPlanSource.DegradeTopic);
            await using var seated = client;
            world.Tick(1101.0);
            world.Tick(1102.0);
            await ReckonedVantageWorld.SettleAsync(client, view);
            Reckoned.True(Strength(view) != 0.4, "the load showed home a reading that had not reached it when the game was saved");
            Assert.Equal(0.9, Strength(view)!.Value, 6);

            world.Tick(1699.0);
            await ReckonedVantageWorld.SettleAsync(client, view);
            Assert.Equal(0.9, Strength(view)!.Value, 6);

            world.Tick(1703.0);
            world.Tick(1704.0);
            await ReckonedVantageWorld.SettleAsync(client, view);
            Assert.Equal(0.4, Strength(view)!.Value, 6);
        }
    }
}
