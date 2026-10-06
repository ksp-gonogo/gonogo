using System.Linq;
using System.Threading.Tasks;
using Sitrep.Core.StoreAndForward;
using Sitrep.Host.Comms;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A game loaded into a scene whose vessel list cannot be read, as an
    /// editor entered by reverting a flight is: the list is empty there for as
    /// long as the player stays. The load is still finished. Each command
    /// centre is given back what the loaded game carried and is told its lists
    /// from that, and no craft is read, none is taken as gone and nothing is
    /// planned until the list can be read again.
    ///
    /// <para>The relay is ten light-minutes from the home centre.</para>
    /// </summary>
    public class ResetWithoutALookTests
    {
        private const string Home = ScriptedContactGame.Home;
        private const string Relay = ScriptedContactGame.Relay;

        private static async Task<(ReckonedVantageWorld World, HeardSnapshot Saved)> LoadedWhereNoCraftAreListedAsync()
        {
            var world = await ReckonedVantageWorld.StartAsync();
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();
            var saved = HeardSnapshotCodec.Decode(HeardSnapshotCodec.Encode(world.Engine.HeardSnapshotNow()!))!;
            Assert.Contains(saved.Centres.Single(c => c.Centre == Home).States, s => s.Id == Relay);

            world.Game.ListNotStanding = true;
            world.Game.OutOfFlight = true;
            world.Engine.NoteGameLoaded(new DeliverySnapshot(), saved);
            world.Tick(702.0);
            world.Tick(702.0);
            return (world, saved);
        }

        [Fact]
        public async Task AScreenAtACentreIsToldTheCraftThatCentreKnewOfWhenTheGameWasSaved()
        {
            var (world, _) = await LoadedWhereNoCraftAreListedAsync();
            await using var _world = world;

            var (client, view) = await world.SitDownAtAsync(Home, SystemViewProvider.VesselsTopic);
            await using var seated = client;
            world.Tick(702.0);
            world.Tick(702.0);
            await ReckonedVantageWorld.SettleAsync(client, view);

            Assert.True(view.Vessel(ScriptedContactGame.RelayGuid) != null, "a centre was told nothing of a craft it knew of, because the game listed no craft to read");
        }

        [Fact]
        public async Task AScreenAtACentreIsToldItsRosterOfCentres()
        {
            var (world, _) = await LoadedWhereNoCraftAreListedAsync();
            await using var _world = world;

            var (client, view) = await world.SitDownAtAsync(Home, ContactPlanSource.RosterTopic);
            await using var seated = client;
            world.Tick(702.0);
            world.Tick(702.0);
            await ReckonedVantageWorld.SettleAsync(client, view);

            var roster = view.Latest(ContactPlanSource.RosterTopic);
            Assert.True(roster != null && roster.Contains(Home), "a centre was told no roster, because the game listed no craft to read");
        }

        /// <summary>
        /// A scene change on the same timeline also leaves the list unread for a
        /// few seconds. Nothing was loaded, every centre knows what it knew, and
        /// nothing is said or planned until the craft can be read again.
        /// </summary>
        [Fact]
        public async Task ASceneChangeWithNoLoadSaysNothingWhileTheListCannotBeRead()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();
            var before = world.Engine.HeardSnapshotNow()!;

            world.Game.ListNotStanding = true;
            var (client, view) = await world.SitDownAtAsync(Home, SystemViewProvider.VesselsTopic);
            await using var seated = client;
            world.Tick(703.0);
            world.Tick(704.0);
            await client.AssertNoMessageArrivesAsync(TestBudgets.Quiet);
            Assert.Null(view.Vessels);
            Assert.Same(before, world.Engine.HeardSnapshotNow());

            world.Game.ListNotStanding = false;
            world.Tick(705.0);
            world.Tick(706.0);
            await ReckonedVantageWorld.SettleAsync(client, view);
            Assert.NotNull(view.Vessel(ScriptedContactGame.RelayGuid));
        }

        [Fact]
        public async Task WhatEachCentreKnewIsGivenBackAtOnceAndNoCraftIsTakenAsGone()
        {
            var (world, saved) = await LoadedWhereNoCraftAreListedAsync();
            await using var _world = world;

            var held = world.Engine.HeardSnapshotNow()!;
            Assert.Contains(held.Centres.Single(c => c.Centre == Home).States, s => s.Id == Relay && s.Exists);

            world.Game.ListNotStanding = false;
            world.Game.OutOfFlight = false;
            foreach (var ut in new[] { 703.0, 704.0, 1400.0, 1402.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();

            var after = world.Engine.HeardSnapshotNow()!;
            Assert.Contains(after.Centres.Single(c => c.Centre == Home).States, s => s.Id == Relay && s.Exists);
            Assert.True(world.Home.PlansPair(Home, Relay), "the home centre made no plan for a craft once the game listed its craft again");
        }
    }
}
