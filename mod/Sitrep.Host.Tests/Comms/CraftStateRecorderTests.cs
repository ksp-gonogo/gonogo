using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
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
        /// A craft read because a distant one was launched or destroyed would
        /// carry that news to a centre at its own light-time.
        /// </summary>
        [Fact]
        public void NothingAnotherCraftDoesHasACraftRead()
        {
            var recorder = new CraftStateRecorder();
            var a = Craft("a", Orbit(700_000.0));
            recorder.Capture(Look(a), 0.0, null);

            var arrived = recorder.Capture(Look(a, Craft("b", Orbit(800_000.0))), 1.0, null);
            Assert.Equal("vessel:b", Assert.Single(arrived.States).Id);

            var station = recorder.Capture(Look(a, Craft("b", Orbit(800_000.0)), Ksc), 2.0, null);
            Assert.Empty(station.States);

            var left = recorder.Capture(Look(a, Ksc), 3.0, null);
            Assert.Empty(left.States);
            Assert.Equal(new[] { "b" }, left.Gone);
        }

        [Fact]
        public void ACraftThatHasNotMovedIsReadAgainEveryRefreshOnTheOrbitItWasFirstReadOn()
        {
            var recorder = new CraftStateRecorder();
            var first = Assert.Single(recorder.Capture(Look(Craft("a", Orbit(700_000.0))), 0.0, null).States);
            var wobbled = Look(Craft("a", Orbit(700_010.0, 1e-6, 1e-5)), Craft("b", Orbit(800_000.0)));

            Assert.DoesNotContain(recorder.Capture(wobbled, CraftStateRecorder.LinkRefreshSeconds - 1.0, null).States, s => s.Id == "vessel:a");
            var again = recorder.Capture(wobbled, CraftStateRecorder.LinkRefreshSeconds, null).States.Single(s => s.Id == "vessel:a");

            Assert.Equal(CraftStateRecorder.LinkRefreshSeconds, again.CapturedUt);
            Assert.Equal(700_000.0, again.Orbit!.Value.Sma);
            Assert.Same(first.Motion, again.Motion);
            Assert.Contains("vessel:b", again.Links.Keys);
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

        private sealed class RecordingHost : ICraftStateHost
        {
            public List<string> Calls { get; } = new List<string>();

            public void RecordCraftState(string vesselId, CraftState state, double ut)
            {
                // The engine notes a craft present as it records its state.
                NoteCraftPresent(vesselId);
                Calls.Add("state " + vesselId + "@" + ut);
            }

            public void NoteCraftPresent(string vesselId) => Calls.Add("present " + vesselId);

            public void RecordCraftGone(string vesselId, double ut) => Calls.Add("gone " + vesselId + "@" + ut);

            public System.Action HearCraftState(string vesselId, string centre, System.Action<CraftState> heard) => () => { };

            public void OnTimelineReset(System.Action reset)
            {
            }
        }
    }
}
