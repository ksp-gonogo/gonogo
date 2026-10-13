using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class CraftStateRecorderTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double KerbinRadius = 600_000.0;
        private const int Kerbin = 1;

        private static OrbitElements Orbit(double sma, double ecc = 0.0, double inc = 0.0) =>
            new OrbitElements(sma, ecc, inc, 0.0, 0.0, 0.0, 0.0, KerbinMu);

        private static RotatingGroundStation Surface(double longitudeDeg) =>
            RotatingGroundStation.FromLatitudeLongitude(0.0, longitudeDeg, 0.0, 21_549.425, KerbinRadius, 0.0);

        private static ContactGameNode Craft(string guid, OrbitElements orbit) =>
            ContactGameNode.OrbitingCraft("vessel:" + guid, Kerbin, orbit);

        private static ContactGameLook Look(params ContactGameNode[] nodes) =>
            new ContactGameLook(nodes, new SystemBody[0], Kerbin, (_, __) => 0.0);

        private static readonly ContactGameNode Ksc = ContactGameNode.GroundStation("ground:ksc", Kerbin, Surface(0.0));

        [Fact]
        public void ACraftIsReadTheFirstTimeItIsSeen()
        {
            var recorder = new CraftStateRecorder();

            var batch = recorder.Capture(Look(Craft("a", Orbit(700_000.0)), Ksc), 5.0, null);

            var state = Assert.Single(batch.States);
            Assert.Equal("vessel:a", state.Id);
            Assert.Equal(5.0, state.CapturedUt);
            Assert.True(state.Exists);
            Assert.True(state.Plannable);
            Assert.Equal(700_000.0, state.Orbit!.Value.Sma);
            Assert.Equal(new[] { "a" }, batch.Present);
            Assert.Empty(batch.Gone);
        }

        [Fact]
        public void AStateCarriesTheCraftsLinkToEveryOtherNodeAndNoneToItself()
        {
            var recorder = new CraftStateRecorder();

            var batch = recorder.Capture(Look(Craft("a", Orbit(700_000.0)), Craft("b", Orbit(800_000.0)), Ksc), 0.0, null);

            var a = batch.States.Single(s => s.Id == "vessel:a");
            Assert.Equal(new[] { "ground:ksc", "vessel:b" }, a.Links.Keys.OrderBy(k => k));
        }

        [Fact]
        public void AStationIsNeverRead()
        {
            var recorder = new CraftStateRecorder();

            var batch = recorder.Capture(Look(Ksc), 0.0, null);

            Assert.Empty(batch.States);
            Assert.Empty(batch.Present);
        }

        [Fact]
        public void ACraftReadAgainWhileTheGameListsNothingIsSaidWithTheEntryItWasLastReadWith()
        {
            var recorder = new CraftStateRecorder();
            var roster = new Dictionary<string, IReadOnlyDictionary<string, object?>>
            {
                ["vessel:a"] = new Dictionary<string, object?> { ["vesselId"] = "a", ["name"] = "A", ["situation"] = 3 },
            };
            recorder.Capture(Look(Craft("a", Orbit(700_000.0))), 0.0, null, roster);

            var landed = recorder.Capture(Look(ContactGameNode.LandedCraft("vessel:a", Kerbin, Surface(10.0))), 1.0, null, null);

            Assert.Equal("A", Assert.Single(landed.States).Roster!["name"]);
            Assert.Empty(landed.Gone);
        }

        [Fact]
        public void ACraftThatHasNotMovedIsNotReadAgain()
        {
            var recorder = new CraftStateRecorder();
            recorder.Capture(Look(Craft("a", Orbit(700_000.0))), 0.0, null);

            var batch = recorder.Capture(Look(Craft("a", Orbit(700_010.0, 1e-6, 1e-5))), 500.0, null);

            Assert.Empty(batch.States);
            Assert.Equal(new[] { "a" }, batch.Present);
        }

        [Fact]
        public void ABurnIsReadOnceTheDriftIntervalHasPassed()
        {
            var recorder = new CraftStateRecorder();
            recorder.Capture(Look(Craft("a", Orbit(700_000.0))), 0.0, null);
            var burned = Look(Craft("a", Orbit(900_000.0)));

            Assert.Empty(recorder.Capture(burned, ContactPlanSchedule.MinDriftReplanSeconds / 2.0, null).States);
            Assert.Single(recorder.Capture(burned, ContactPlanSchedule.MinDriftReplanSeconds, null).States);
            Assert.Empty(recorder.Capture(burned, ContactPlanSchedule.MinDriftReplanSeconds + 1.0, null).States);
        }

        /// <summary>
        /// Under warp a pass comes every thousand game seconds, so every craft's
        /// refresh is due at every pass, and reading a craft costs a link model
        /// to every other node. One pass reads no more than its ration of them.
        /// </summary>
        [Fact]
        public void UnderWarpAPassReadsAgainOnlyItsRationOfTheCraftThatAreDue()
        {
            var recorder = new CraftStateRecorder();
            var fleet = Enumerable.Range(0, 12).Select(i => Craft("c" + i, Orbit(700_000.0 + (i * 10_000.0)))).ToArray();
            Assert.Equal(12, recorder.Capture(Look(fleet), 0.0, null).States.Count);

            Assert.InRange(CraftStateRecorder.ReadsAgainPerPass, 1, 2);
            var readAt = new Dictionary<string, List<int>>();
            for (var pass = 1; pass <= 36; pass++)
            {
                var batch = recorder.Capture(Look(fleet), pass * 1_000.0, null);
                Assert.True(batch.States.Count <= CraftStateRecorder.ReadsAgainPerPass, "pass " + pass + " read " + batch.States.Count);
                foreach (var state in batch.States)
                {
                    if (!readAt.TryGetValue(state.Id, out var passes))
                    {
                        readAt[state.Id] = passes = new List<int>();
                    }
                    passes.Add(pass);
                }
            }

            // Longest waiting first, so every craft comes round in turn and none is starved.
            Assert.Equal(12, readAt.Count);
            Assert.All(readAt.Values, passes => Assert.Equal(36 * CraftStateRecorder.ReadsAgainPerPass / 12, passes.Count));
        }

        [Fact]
        public void UnderWarpACraftWhoseOrbitMovedIsReadOnTheNextPassAheadOfEveryRefresh()
        {
            var recorder = new CraftStateRecorder();
            var fleet = Enumerable.Range(0, 12).Select(i => Craft("c" + i, Orbit(700_000.0 + (i * 10_000.0)))).ToArray();
            recorder.Capture(Look(fleet), 0.0, null);
            for (var pass = 1; pass <= 6; pass++)
            {
                recorder.Capture(Look(fleet), pass * 1_000.0, null);
            }

            // The one read most recently, so the last a refresh would come round to.
            fleet[5] = Craft("c5", Orbit(2_000_000.0, 0.2));
            var batch = recorder.Capture(Look(fleet), 7_000.0, null);

            var state = Assert.Single(batch.States);
            Assert.Equal("vessel:c5", state.Id);
            Assert.Equal(2_000_000.0, state.Orbit!.Value.Sma);
        }

        /// <summary>
        /// A craft under thrust under warp has moved again by every pass. It
        /// takes no more than every other pass, so every other craft's refresh
        /// still comes round within twice the fleet's size.
        /// </summary>
        [Fact]
        public void UnderWarpACraftUnderThrustDoesNotStarveTheOthersRefreshes()
        {
            var recorder = new CraftStateRecorder();
            const int fleetSize = 12;
            var fleet = Enumerable.Range(0, fleetSize).Select(i => Craft("c" + i, Orbit(700_000.0 + (i * 10_000.0)))).ToArray();
            recorder.Capture(Look(fleet), 0.0, null);

            var lastRead = fleet.ToDictionary(c => c.Id, _ => 0);
            var longestWait = fleet.ToDictionary(c => c.Id, _ => 0);
            for (var pass = 1; pass <= 120; pass++)
            {
                fleet[0] = Craft("c0", Orbit(700_000.0 + (pass * 5_000.0)));
                foreach (var state in recorder.Capture(Look(fleet), pass * 1_000.0, null).States)
                {
                    longestWait[state.Id] = System.Math.Max(longestWait[state.Id], pass - lastRead[state.Id]);
                    lastRead[state.Id] = pass;
                }
            }
            foreach (var id in lastRead.Keys.ToList())
            {
                longestWait[id] = System.Math.Max(longestWait[id], 120 - lastRead[id]);
            }

            Assert.InRange(longestWait["vessel:c0"], 1, 2);
            var bound = (2 * (fleetSize - 1)) + 2;
            Assert.All(fleet.Skip(1), craft => Assert.InRange(longestWait[craft.Id], 1, bound));
        }

        [Fact]
        public void ACraftSeenForTheFirstTimeIsReadAtOnceWhateverElseIsDue()
        {
            var recorder = new CraftStateRecorder();
            var fleet = Enumerable.Range(0, 6).Select(i => Craft("c" + i, Orbit(700_000.0 + (i * 10_000.0)))).ToList();
            recorder.Capture(Look(fleet.ToArray()), 0.0, null);

            fleet.Add(Craft("new", Orbit(900_000.0)));
            var batch = recorder.Capture(Look(fleet.ToArray()), 1_000.0, null);

            // The arrival is read, and so is every craft that has no link to it yet.
            Assert.Equal(7, batch.States.Count);
        }

        [Fact]
        public void ACraftWhoseListingChangesIsSaidAtOnceWhileItsRefreshWaitsItsTurn()
        {
            var recorder = new CraftStateRecorder();
            var fleet = Enumerable.Range(0, 6).Select(i => Craft("c" + i, Orbit(700_000.0 + (i * 10_000.0)))).ToArray();
            var roster = fleet.ToDictionary(
                c => c.Id,
                c => (IReadOnlyDictionary<string, object?>)new Dictionary<string, object?> { ["vesselId"] = c.Id, ["name"] = "A", ["situation"] = 3 });
            recorder.Capture(Look(fleet), 0.0, null, roster);

            roster["vessel:c5"] = new Dictionary<string, object?> { ["vesselId"] = "vessel:c5", ["name"] = "Renamed", ["situation"] = 3 };
            var batch = recorder.Capture(Look(fleet), 1_000.0, null, roster);

            Assert.Contains(batch.States, s => s.Id == "vessel:c5" && (string?)s.Roster!["name"] == "Renamed");
            Assert.True(batch.States.Count <= 1 + CraftStateRecorder.ReadsAgainPerPass);
        }

        [Fact]
        public void ACraftThatLandsIsReadAtOnce()
        {
            var recorder = new CraftStateRecorder();
            recorder.Capture(Look(Craft("a", Orbit(700_000.0))), 0.0, null);

            var batch = recorder.Capture(Look(ContactGameNode.LandedCraft("vessel:a", Kerbin, Surface(10.0))), 1.0, null);

            Assert.NotNull(Assert.Single(batch.States).Surface);
        }

        [Fact]
        public void ALandedCraftIsReadAgainOnlyOnceItHasMovedPastTheTolerance()
        {
            var recorder = new CraftStateRecorder();
            recorder.Capture(Look(ContactGameNode.LandedCraft("vessel:a", Kerbin, Surface(10.0))), 0.0, null);

            Assert.Empty(recorder.Capture(Look(ContactGameNode.LandedCraft("vessel:a", Kerbin, Surface(10.01))), 1.0, null).States);
            Assert.Single(recorder.Capture(Look(ContactGameNode.LandedCraft("vessel:a", Kerbin, Surface(11.0))), 2.0, null).States);
        }

        /// <summary>
        /// A craft that arrives is a node every earlier craft has no link to,
        /// and a plan pairs two craft by the link the older of their states
        /// holds. Left to the refresh, a relay launched next to a craft would be
        /// planned as unreachable from it for as long as the refresh takes.
        /// </summary>
        [Fact]
        public void ACraftThatArrivesIsLinkedToByEveryCraftAlreadyThere()
        {
            var recorder = new CraftStateRecorder();
            var a = Craft("a", Orbit(700_000.0));
            recorder.Capture(Look(a), 0.0, null);

            var arrived = recorder.Capture(Look(a, Craft("b", Orbit(800_000.0))), 1.0, null);
            Assert.Equal(new[] { "vessel:a", "vessel:b" }, arrived.States.Select(s => s.Id).OrderBy(i => i));
            Assert.Contains("vessel:b", arrived.States.Single(s => s.Id == "vessel:a").Links.Keys);

            var settled = recorder.Capture(Look(a, Craft("b", Orbit(800_000.0))), 2.0, null);
            Assert.Empty(settled.States);
        }

        /// <summary>
        /// What reaches a centre of a craft launched beside another, read as the
        /// game reads them, plans the two as a pair at once.
        /// </summary>
        [Fact]
        public void ARelayLaunchedBesideACraftIsPlannedAsAPairWithItWithoutWaitingForARefresh()
        {
            var recorder = new CraftStateRecorder();
            var a = Craft("a", Orbit(700_000.0));
            var heard = new Dictionary<string, CraftState>();
            foreach (var state in recorder.Capture(Look(a, Ksc), 0.0, null).States)
            {
                heard[state.Id] = state;
            }
            foreach (var state in recorder.Capture(Look(a, Craft("relay", Orbit(800_000.0)), Ksc), 30.0, null).States)
            {
                heard[state.Id] = state;
            }

            var ground = new PlanGround(
                new PlanNode[0],
                new[] { new SystemBody(-1, null), new SystemBody(0, new OrbitElements(13_599_840_256.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.1723328e18)) },
                Kerbin,
                index => KerbinRadius);
            var request = ReckonedPlan.Request(heard.Values.ToList(), ground, 40.0, 3600.0);

            Assert.Contains(request.Pairs, p => (p.A == "vessel:a" && p.B == "vessel:relay") || (p.A == "vessel:relay" && p.B == "vessel:a"));
        }

        /// <summary>
        /// A craft that leaves is not read for: a pair ends when the centre
        /// hears the craft is gone, and a state read now would end it at the
        /// signal delay of whichever craft was read.
        /// </summary>
        [Fact]
        public void NothingIsReadForACraftThatLeavesOrAStationThatWasThereAlready()
        {
            var recorder = new CraftStateRecorder();
            var a = Craft("a", Orbit(700_000.0));
            recorder.Capture(Look(a, Craft("b", Orbit(800_000.0)), Ksc), 0.0, null);

            var left = recorder.Capture(Look(a, Ksc), 3.0, null);
            Assert.Empty(left.States);
            Assert.Equal(new[] { "b" }, left.Gone);
        }

        [Fact]
        public void ACraftThatHasNotMovedIsReadAgainEveryRefreshOnTheOrbitItWasFirstReadOn()
        {
            var recorder = new CraftStateRecorder();
            var first = Assert.Single(recorder.Capture(Look(Craft("a", Orbit(700_000.0))), 0.0, null).States);
            var wobbled = Look(Craft("a", Orbit(700_010.0, 1e-6, 1e-5)));

            Assert.Empty(recorder.Capture(wobbled, CraftStateRecorder.LinkRefreshSeconds - 1.0, null).States);
            var again = recorder.Capture(wobbled, CraftStateRecorder.LinkRefreshSeconds, null).States.Single(s => s.Id == "vessel:a");

            Assert.Equal(CraftStateRecorder.LinkRefreshSeconds, again.CapturedUt);
            Assert.Equal(700_000.0, again.Orbit!.Value.Sma);
            Assert.Same(first.Motion, again.Motion);
            Assert.Empty(first.Links);
        }

        /// <summary>
        /// A craft whose orbit has changed since it was read is, as far as anyone
        /// can tell, still burning, and is reckoned on a conic it is leaving.
        /// </summary>
        [Fact]
        public void ACraftReadWhileItsOrbitIsChangingIsUnsettledUntilItIsFoundHoldingStill()
        {
            var recorder = new CraftStateRecorder();
            var first = Assert.Single(recorder.Capture(Look(Craft("a", Orbit(700_000.0))), 0.0, null).States);
            Assert.True(first.Settled);

            var burning = Assert.Single(recorder.Capture(Look(Craft("a", Orbit(800_000.0))), 20.0, null).States);
            Assert.False(burning.Settled);

            var stillBurning = Assert.Single(recorder.Capture(Look(Craft("a", Orbit(900_000.0))), 30.0, null).States);
            Assert.False(stillBurning.Settled);

            var cutoff = Look(Craft("a", Orbit(900_000.0)));
            Assert.Empty(recorder.Capture(cutoff, 35.0, null).States);
            var settled = Assert.Single(recorder.Capture(cutoff, 40.0, null).States);
            Assert.True(settled.Settled);
            Assert.Equal(900_000.0, settled.Orbit!.Value.Sma);
            Assert.Same(stillBurning.Motion, settled.Motion);
            Assert.Empty(recorder.Capture(cutoff, 50.0, null).States);
        }

        [Fact]
        public void ACraftThatMovedIsGoingSomewhereNew()
        {
            var recorder = new CraftStateRecorder();
            var first = Assert.Single(recorder.Capture(Look(Craft("a", Orbit(700_000.0))), 0.0, null).States);

            var burned = Assert.Single(recorder.Capture(Look(Craft("a", Orbit(900_000.0))), 60.0, null).States);

            Assert.Equal(900_000.0, burned.Orbit!.Value.Sma);
            Assert.NotSame(first.Motion, burned.Motion);
        }

        [Fact]
        public void EveryCraftIsReadAgainAfterATimelineReset()
        {
            var recorder = new CraftStateRecorder();
            var look = Look(Craft("a", Orbit(700_000.0)), Craft("b", Orbit(800_000.0)));
            recorder.Capture(look, 100.0, null);

            recorder.ReadAllAgain();

            Assert.Equal(2, recorder.Capture(look, 101.0, null).States.Count);
            Assert.Empty(recorder.Capture(look, 102.0, null).States);
        }

        [Fact]
        public void ACraftReadAfterTheClockWentBackIsReadAgain()
        {
            var recorder = new CraftStateRecorder();
            var look = Look(Craft("a", Orbit(700_000.0)));
            recorder.Capture(look, 100.0, null);

            Assert.Single(recorder.Capture(look, 50.0, null).States);
        }

        [Fact]
        public void RecordingTellsTheHostOfTheGoneThenThePresentThenTheStates()
        {
            var recorder = new CraftStateRecorder();
            recorder.Capture(Look(Craft("a", Orbit(700_000.0)), Craft("b", Orbit(800_000.0))), 0.0, null);
            var batch = recorder.Capture(Look(Craft("a", Orbit(700_000.0))), 1.0, null);
            var host = new RecordingHost();

            CraftStateRecorder.Record(batch, host);

            Assert.Equal(new[] { "gone b@1", "present a" }, host.Calls);

            host.Calls.Clear();
            CraftStateRecorder.Record(recorder.Capture(Look(Craft("a", Orbit(900_000.0))), 60.0, null), host);
            Assert.Equal(new[] { "present a", "present a", "state a@60" }, host.Calls);
        }

        [Fact]
        public void AGoneStatePlansNothingAndAnOrbitingOnePlansItsOrbit()
        {
            Assert.Null(CraftState.Gone("vessel:a", 0.0).ToPlanNode());

            var recorder = new CraftStateRecorder();
            var state = Assert.Single(recorder.Capture(Look(Craft("a", Orbit(700_000.0))), 0.0, null).States);
            var node = state.ToPlanNode();

            Assert.NotNull(node);
            Assert.Equal("vessel:a", node!.Id);
            Assert.Equal(700_000.0, node.Orbit!.Value.Osculating!.Value.Sma);
        }

        private static IReadOnlyDictionary<string, IReadOnlyDictionary<string, object?>> Roster(params (string Guid, int Crew)[] craft) =>
            craft.ToDictionary(
                c => "vessel:" + c.Guid,
                c => (IReadOnlyDictionary<string, object?>)new Dictionary<string, object?>
                {
                    ["vesselId"] = c.Guid,
                    ["name"] = c.Guid,
                    ["crewCount"] = c.Crew,
                    ["vesselType"] = (int)(c.Guid == "junk" ? VesselType.Debris : VesselType.Probe),
                });

        [Fact]
        public void ACraftIsReadAgainWhenItsOwnListingChangesAndKeepsGoingWhereItWas()
        {
            var recorder = new CraftStateRecorder();
            var look = Look(Craft("a", Orbit(700_000.0)), Ksc);
            var first = recorder.Capture(look, 0.0, null, Roster(("a", 0))).States.Single();
            Assert.Equal(0, first.Roster!["crewCount"]);

            Assert.Empty(recorder.Capture(look, 5.0, null, Roster(("a", 0))).States);
            var boarded = recorder.Capture(look, 6.0, null, Roster(("a", 2))).States.Single();

            Assert.Equal(2, boarded.Roster!["crewCount"]);
            Assert.Equal(6.0, boarded.CapturedUt);
            Assert.Same(first.Motion, boarded.Motion);
        }

        [Fact]
        public void ACraftIsSaidAgainWhenItBecomesACommandCentreAndWhenItStopsBeingOne()
        {
            var recorder = new CraftStateRecorder();
            var plain = Craft("a", Orbit(700_000.0));
            var first = recorder.Capture(Look(plain, Ksc), 0.0, null).States.Single();
            Assert.Null(first.Centre);

            var crewed = Craft("a", Orbit(700_000.0));
            crewed.Centre = new Sitrep.Contract.CommandCentreEntry { Id = "vessel:a", DisplayName = "Alpha", Active = true };
            var boarded = recorder.Capture(Look(crewed, Ksc), 5.0, null).States.Single();
            Assert.Equal("Alpha", boarded.Centre!.DisplayName);
            Assert.Equal(5.0, boarded.CapturedUt);
            Assert.Same(first.Motion, boarded.Motion);

            Assert.Empty(recorder.Capture(Look(crewed, Ksc), 6.0, null).States);

            var left = recorder.Capture(Look(plain, Ksc), 7.0, null).States.Single();
            Assert.Null(left.Centre);
            Assert.Equal(7.0, left.CapturedUt);
        }

        /// <summary>Every object named is this many light-seconds from the one centre.</summary>
        private static ContactGameLook Sighting(ContactGameLook look, double seconds, params string[] guids)
        {
            look.Sight = guids.ToDictionary(
                g => "vessel:" + g,
                g => (IReadOnlyDictionary<string, double>)new Dictionary<string, double> { ["ground:ksc"] = seconds });
            return look;
        }

        [Fact]
        public void AnObjectWithNoRadioIsSeenWhenItAppearsAndSeenToBeGoneOverTheDistanceItWasLastAt()
        {
            var recorder = new CraftStateRecorder();
            ContactGameLook Looking(params string[] guids) => Sighting(Look(Craft("a", Orbit(700_000.0)), Ksc), 40.0, guids);

            var appeared = recorder.Capture(Looking("a", "junk"), 0.0, null, Roster(("a", 0), ("junk", 0)));
            var junk = appeared.Sightings.Single(s => s.Sighting.Id == "vessel:junk");
            Assert.True(junk.Sighting.Exists);
            Assert.Null(junk.Sighting.Place);
            Assert.Equal(40.0, junk.LightSeconds["ground:ksc"]);
            Assert.Equal("junk", junk.Sighting.Listed!["name"]);
            Assert.False(junk.Sighting.Listed.ContainsKey("crewCount"));
            Assert.Equal(new[] { "a" }, appeared.Present);
            Assert.Equal(new[] { "a", "junk" }, appeared.Known.OrderBy(k => k));

            var still = recorder.Capture(Looking("a", "junk"), 700.0, null, Roster(("a", 0), ("junk", 5)));
            Assert.DoesNotContain(still.Sightings, s => s.Sighting.Id == "vessel:junk");

            var went = recorder.Capture(Looking("a"), 701.0, null, Roster(("a", 0)));
            var gone = went.Sightings.Single(s => s.Sighting.Id == "vessel:junk");
            Assert.False(gone.Sighting.Exists);
            Assert.Equal(40.0, gone.LightSeconds["ground:ksc"]);
            Assert.Empty(went.Gone);
        }

        [Fact]
        public void ACraftWithARadioIsSeenToowheneverItHasSomethingNewToSayAndTheSightingCarriesOnlyWhereItIs()
        {
            var recorder = new CraftStateRecorder();
            var look = Sighting(Look(Craft("a", Orbit(700_000.0)), Ksc), 3.0, "a");

            var first = recorder.Capture(look, 0.0, null, Roster(("a", 2)));
            var seen = Assert.Single(first.Sightings).Sighting;
            Assert.Equal("vessel:a", seen.Id);
            Assert.NotNull(seen.Place);
            Assert.Empty(seen.Place!.Links);
            Assert.Null(seen.Place.Roster);
            Assert.Same(first.States.Single().Motion, seen.Place.Motion);
            Assert.False(seen.Listed!.ContainsKey("crewCount"));

            Assert.Empty(recorder.Capture(look, 5.0, null, Roster(("a", 2))).Sightings);
        }

        [Fact]
        public void NothingIsSeenWhereTheGameTracksNothingBySight()
        {
            var recorder = new CraftStateRecorder();

            var batch = recorder.Capture(Look(Craft("a", Orbit(700_000.0)), Ksc), 0.0, null, Roster(("a", 0), ("junk", 0)));

            Assert.Empty(batch.Sightings);
            Assert.Single(batch.States);
        }

        [Fact]
        public void ACentreThatIsNewIsShownEverythingAgain()
        {
            var recorder = new CraftStateRecorder();
            var look = Sighting(Look(Craft("a", Orbit(700_000.0)), Ksc), 3.0, "a", "junk");
            recorder.Capture(look, 0.0, null, Roster(("a", 0), ("junk", 0)));
            Assert.Empty(recorder.Capture(look, 1.0, null, Roster(("a", 0), ("junk", 0))).Sightings);

            var withAnother = Look(Craft("a", Orbit(700_000.0)), Ksc);
            withAnother.Sight = new[] { "a", "junk" }.ToDictionary(
                g => "vessel:" + g,
                g => (IReadOnlyDictionary<string, double>)new Dictionary<string, double> { ["ground:ksc"] = 3.0, ["vessel:crewed"] = 9.0 });
            var again = recorder.Capture(withAnother, 2.0, null, Roster(("a", 0), ("junk", 0)));

            Assert.Equal(new[] { "vessel:a", "vessel:junk" }, again.Sightings.Select(s => s.Sighting.Id).OrderBy(id => id));
            Assert.All(again.Sightings, s => Assert.Equal(9.0, s.LightSeconds["vessel:crewed"]));
        }

        /// <summary>The junk object in view of the centres named, each this many light-seconds away; the radio craft a in view of both.</summary>
        private static ContactGameLook InViewOf(bool junkExists, IReadOnlyDictionary<string, double> junkRow, IReadOnlyDictionary<string, double>? goneRow = null)
        {
            var look = Look(Craft("a", Orbit(700_000.0)), Ksc);
            var sight = new Dictionary<string, IReadOnlyDictionary<string, double>>
            {
                ["vessel:a"] = new Dictionary<string, double> { ["ground:ksc"] = 3.0, ["vessel:crewed"] = 9.0 },
            };
            if (junkExists)
            {
                sight["vessel:junk"] = junkRow;
            }
            look.Sight = sight;
            look.GoneSight = goneRow == null
                ? new Dictionary<string, IReadOnlyDictionary<string, double>>()
                : new Dictionary<string, IReadOnlyDictionary<string, double>> { ["vessel:junk"] = goneRow };
            return look;
        }

        private static readonly IReadOnlyDictionary<string, double> BothSee =
            new Dictionary<string, double> { ["ground:ksc"] = 40.0, ["vessel:crewed"] = 50.0 };

        private static readonly IReadOnlyDictionary<string, double> OnlyKscSees =
            new Dictionary<string, double> { ["ground:ksc"] = 40.0 };

        [Fact]
        public void AnObjectGoneWhileHiddenFromACentreIsSeenGoneOnlyByTheCentresThatHadItInView()
        {
            var recorder = new CraftStateRecorder();
            recorder.Capture(InViewOf(true, BothSee), 0.0, null, Roster(("a", 0), ("junk", 0)));
            recorder.Capture(InViewOf(true, OnlyKscSees), 1.0, null, Roster(("a", 0), ("junk", 0)));

            var went = recorder.Capture(InViewOf(false, OnlyKscSees), 2.0, null, Roster(("a", 0)));

            var gone = went.Sightings.Single(s => s.Sighting.Id == "vessel:junk");
            Assert.False(gone.Sighting.Exists);
            Assert.Equal(new[] { "ground:ksc" }, gone.LightSeconds.Keys);
            Assert.Equal(2.0 + CraftSighting.GoneSightHorizonSeconds, went.Keeps["junk"]);
        }

        [Fact]
        public void ACentreThatDidNotSeeAnObjectGoIsShownItGoneWhenWhereItWouldBeComesIntoView()
        {
            var recorder = new CraftStateRecorder();
            recorder.Capture(InViewOf(true, BothSee), 0.0, null, Roster(("a", 0), ("junk", 0)));
            recorder.Capture(InViewOf(true, OnlyKscSees), 1.0, null, Roster(("a", 0), ("junk", 0)));
            recorder.Capture(InViewOf(false, OnlyKscSees), 2.0, null, Roster(("a", 0)));

            var stillHidden = recorder.Capture(InViewOf(false, OnlyKscSees, goneRow: new Dictionary<string, double>()), 50.0, null, Roster(("a", 0)));
            Assert.DoesNotContain(stillHidden.Sightings, s => s.Sighting.Id == "vessel:junk");
            Assert.Equal(2.0 + CraftSighting.GoneSightHorizonSeconds, stillHidden.Keeps["junk"]);

            var inView = recorder.Capture(
                InViewOf(false, OnlyKscSees, goneRow: new Dictionary<string, double> { ["ground:ksc"] = 41.0, ["vessel:crewed"] = 55.0 }),
                90.0, null, Roster(("a", 0)));
            var gone = inView.Sightings.Single(s => s.Sighting.Id == "vessel:junk");
            Assert.False(gone.Sighting.Exists);
            Assert.Equal(90.0, gone.Sighting.CapturedUt);
            Assert.Equal(new[] { "vessel:crewed" }, gone.LightSeconds.Keys);
            Assert.Equal(55.0, gone.LightSeconds["vessel:crewed"]);
            Assert.Equal(double.NegativeInfinity, inView.Keeps["junk"]);

            var after = recorder.Capture(
                InViewOf(false, OnlyKscSees, goneRow: new Dictionary<string, double> { ["ground:ksc"] = 41.0, ["vessel:crewed"] = 55.0 }),
                91.0, null, Roster(("a", 0)));
            Assert.DoesNotContain(after.Sightings, s => s.Sighting.Id == "vessel:junk");
            Assert.False(after.Keeps.ContainsKey("junk"));
        }

        [Fact]
        public void AnObjectTheLookCanNoLongerPlaceIsNeverSeenGoneByTheCentresStillWaiting()
        {
            var recorder = new CraftStateRecorder();
            recorder.Capture(InViewOf(true, BothSee), 0.0, null, Roster(("a", 0), ("junk", 0)));
            recorder.Capture(InViewOf(true, OnlyKscSees), 1.0, null, Roster(("a", 0), ("junk", 0)));
            recorder.Capture(InViewOf(false, OnlyKscSees), 2.0, null, Roster(("a", 0)));

            var expired = recorder.Capture(InViewOf(false, OnlyKscSees), 3.0, null, Roster(("a", 0)));

            Assert.DoesNotContain(expired.Sightings, s => s.Sighting.Id == "vessel:junk");
            Assert.Equal(double.NegativeInfinity, expired.Keeps["junk"]);
        }

        [Fact]
        public void AnObjectComingIntoACentresViewIsSeenAgain()
        {
            var recorder = new CraftStateRecorder();
            recorder.Capture(InViewOf(true, BothSee), 0.0, null, Roster(("a", 0), ("junk", 0)));
            recorder.Capture(InViewOf(true, OnlyKscSees), 1.0, null, Roster(("a", 0), ("junk", 0)));
            Assert.DoesNotContain(
                recorder.Capture(InViewOf(true, OnlyKscSees), 2.0, null, Roster(("a", 0), ("junk", 0))).Sightings,
                s => s.Sighting.Id == "vessel:junk");

            var back = recorder.Capture(InViewOf(true, BothSee), 3.0, null, Roster(("a", 0), ("junk", 0)));

            var seen = back.Sightings.Single(s => s.Sighting.Id == "vessel:junk");
            Assert.True(seen.Sighting.Exists);
            Assert.Equal(50.0, seen.LightSeconds["vessel:crewed"]);
        }

        [Fact]
        public void AKeepIsRecordedWithTheHost()
        {
            var host = new RecordingHost();
            var batch = new CraftStateRecorder.Batch(
                5.0, new string[0], new CraftState[0], new string[0], keeps: new Dictionary<string, double> { ["junk"] = 99.0 });

            CraftStateRecorder.Record(batch, host);

            Assert.Contains("keep junk@99", host.Calls);
        }

        [Fact]
        public void ACraftThatLosesItsRadioKeepsWhatWasLastHeardOfItAndIsNotCalledGone()
        {
            var recorder = new CraftStateRecorder();
            recorder.Capture(Look(Craft("a", Orbit(700_000.0)), Ksc), 0.0, null, Roster(("a", 0)));

            var silent = recorder.Capture(Look(Ksc), 5.0, null, Roster(("a", 0)));

            Assert.Empty(silent.Gone);
            Assert.Empty(silent.Sightings);
        }

        private sealed class RecordingHost : ICraftStateHost
        {
            public List<string> Calls { get; } = new List<string>();

            public void RecordCraftState(string vesselId, CraftState state, double ut)
            {
                // The engine notes a craft present as it records its state.
                NoteCraftPresent(vesselId, ut);
                Calls.Add("state " + vesselId + "@" + ut);
            }

            public void NoteCraftPresent(string vesselId, double ut) => Calls.Add("present " + vesselId);

            public void RecordCraftGone(string vesselId, double ut) => Calls.Add("gone " + vesselId + "@" + ut);

            public System.Action HearCraftState(string vesselId, string centre, System.Action<CraftState> heard) => () => { };

            public void RecordCraftSighting(string vesselId, CraftSighting sighting, double ut, IReadOnlyDictionary<string, double> lightSeconds) =>
                Calls.Add("seen " + vesselId + "@" + ut);

            public System.Action HearCraftSighting(string vesselId, string centre, System.Action<CraftSighting> seen) => () => { };

            public void KeepCraftUntil(string vesselId, double untilUt) => Calls.Add("keep " + vesselId + "@" + untilUt);

            public System.Action HearCraftLink(string vesselId, string centre, System.Action<bool> heard) => () => { };

            public System.Action HearCraftReach(string vesselId, string centre, System.Action<CraftReach> heard) => () => { };

            public void RecordCentreReport(string vesselId, CentreReport report, double ut) => Calls.Add("report " + vesselId + "@" + ut);

            public System.Action HearCentreReport(string vesselId, string centre, System.Action<CentreReport> heard) => () => { };

            public System.Action HearCraftForecast(string vesselId, string centre, System.Action<CraftForecast> heard) => () => { };

            public void RecordHomeVerdict(string vesselId, HomeVerdict verdict, double ut) => Calls.Add("verdict " + vesselId + "@" + ut);

            public System.Action HearHomeVerdict(string vesselId, string centre, System.Action<HomeVerdict> heard) => () => { };

            public void RecordCraftRadio(string vesselId, ContactRadio radio, double ut) => Calls.Add("radio " + vesselId + "@" + ut);

            public System.Action HearCraftRadio(string vesselId, string centre, System.Action<ContactRadio> heard) => () => { };

            public void OnTimelineReset(System.Action reset)
            {
            }

            public void OnCraftReleased(System.Action<string> released)
            {
            }
        }
    }
}
