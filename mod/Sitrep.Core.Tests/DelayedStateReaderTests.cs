using System;
using Sitrep.Contract;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The seam between what the game knows and what a command centre may act on.
    /// Everything here is about one question: can a propagation be seeded from
    /// something the operator has not been told?
    /// </summary>
    public class DelayedStateReaderTests
    {
        private static StateAboutBody? AsState(object? value) =>
            value is double x
                ? new StateAboutBody(
                    new StateVector(new Vector3d(x, 0, 0), new Vector3d(0, x, 0)), 1)
                : (StateAboutBody?)null;

        [Fact]
        public void StampsTheStateWithTheSAMPLESInstantAndNotTheWindowEdge()
        {
            // THE test. A slow channel recorded at 100 and has said nothing since. At
            // now=1000 with a delay of 60 the window edge is 940, but the state being
            // handed over was true at 100. Dating it 940 asserts the craft held that
            // position 840 seconds later than it did, and every propagation seeded
            // from it is then confidently wrong with nothing to notice.
            var archive = new Archive();
            archive.Record("vessel.orbit", 7.0, 100);

            var observed = DelayedStateReader.Read(archive, "vessel.orbit", "ksc", 60, 1000, AsState);

            Assert.True(observed.Established);
            Assert.Equal(100, observed.ObservedAtUt);
            Assert.Equal(940, observed.ViewUt);
            Assert.Equal(840, observed.AgeSeconds);
        }

        [Fact]
        public void RefusesRatherThanFallingBackToWhatTheGameKnows()
        {
            // The craft exists and the game knows exactly where it is. This vantage
            // does not, because nothing has arrived. A state here would be a leak.
            var archive = new Archive();
            archive.Record("vessel.orbit", 7.0, 900);

            var observed = DelayedStateReader.Read(archive, "vessel.orbit", "distant", 600, 1000, AsState);

            Assert.False(observed.Established);
            Assert.Equal(DelayedStateRefusal.NothingArrived, observed.Refusal);
        }

        [Fact]
        public void ANearerVantageSeesWhatADistantOneCannot()
        {
            // Same archive, same instant, two observers. The whole architecture in one
            // assertion: what may be acted on is a property of WHERE YOU ARE.
            var archive = new Archive();
            archive.Record("vessel.orbit", 7.0, 900);

            var near = DelayedStateReader.Read(archive, "vessel.orbit", "near", 10, 1000, AsState);
            var far = DelayedStateReader.Read(archive, "vessel.orbit", "far", 600, 1000, AsState);

            Assert.True(near.Established);
            Assert.False(far.Established);
        }

        [Fact]
        public void UsesTheArchivesOwnSceneWhenTheClampBites()
        {
            // On a receding craft the delay grows faster than UT advances, so the
            // cursor freezes rather than rewinding. A reader that recomputed
            // `now - delay` would get an instant EARLIER than the one the answer came
            // from, see a sample apparently dated after its own view instant, and
            // refuse a perfectly good observation as a future leak.
            var archive = new Archive();
            archive.Record("vessel.orbit", 7.0, 500);

            var first = DelayedStateReader.Read(archive, "vessel.orbit", "receding", 100, 1000, AsState);
            Assert.Equal(900, first.ViewUt);

            // Delay grew by more than UT advanced: raw scene would be 1010 - 200 = 810,
            // behind the 900 already seen.
            var second = DelayedStateReader.Read(archive, "vessel.orbit", "receding", 200, 1010, AsState);

            Assert.True(second.Established);
            Assert.Equal(900, second.ViewUt);
            Assert.True(second.ObservedAtUt <= second.ViewUt);
        }

        [Fact]
        public void ASampleDatedAfterTheViewInstantIsRefusedOnPrinciple()
        {
            // Cannot arise from arrived light, so if it ever does, something upstream
            // is wrong and the safe move is to say nothing. Asserted on the type
            // directly because the archive will not normally produce it.
            var leaked = DelayedObservation.At(default, 1, observedAtUt: 500, viewUt: 400);

            Assert.False(leaked.Established);
            Assert.Contains("future", leaked.Reason!, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public void AnUnknownDelayIsRefusedRatherThanTreatedAsZero()
        {
            // Zero delay is the most dangerous default available: it makes a distant
            // vantage look co-located and shows it everything.
            var archive = new Archive();
            archive.Record("vessel.orbit", 7.0, 100);

            var observed = DelayedStateReader.Read(
                archive, "vessel.orbit", "ksc", double.NaN, 1000, AsState);

            Assert.False(observed.Established);
            Assert.Equal(DelayedStateRefusal.DelayUnknown, observed.Refusal);
        }

        [Fact]
        public void AnUnknownDelayDoesNotPOISONTheVantageForever()
        {
            // Found by mutation: the guard above looked redundant, because a NaN view
            // instant is refused by the observation type anyway. It is not redundant,
            // and what it prevents is worse than a bad answer once.
            //
            // `Math.Max(x, NaN)` is NaN, so a NaN delay reaching the archive writes a
            // NaN cursor for that vantage. Every later read then compares
            // `ValidAt > NaN`, which is false for everything, so the vantage is handed
            // the newest sample in the archive no matter how far away it is. One
            // unknown delay would silently un-delay a command centre for the rest of
            // the session.
            var archive = new Archive();
            archive.Record("vessel.orbit", 7.0, 900);

            DelayedStateReader.Read(archive, "vessel.orbit", "far", double.NaN, 1000, AsState);
            var after = DelayedStateReader.Read(archive, "vessel.orbit", "far", 600, 1000, AsState);

            Assert.False(after.Established);
            Assert.Equal(DelayedStateRefusal.NothingArrived, after.Refusal);
        }

        [Fact]
        public void APayloadThatCarriesNoStateIsRefusedRatherThanZeroed()
        {
            var archive = new Archive();
            archive.Record("vessel.orbit", "not a state", 100);

            var observed = DelayedStateReader.Read(archive, "vessel.orbit", "ksc", 0, 1000, AsState);

            Assert.False(observed.Established);
            Assert.Equal(DelayedStateRefusal.BeyondRetainedHistory, observed.Refusal);
        }

        [Fact]
        public void ADefaultObservationWithholdsRatherThanPermits()
        {
            var untouched = default(DelayedObservation);

            Assert.False(untouched.Established);
        }

        [Fact]
        public void TheStateAndItsCentreSurviveTheRead()
        {
            var archive = new Archive();
            archive.Record("vessel.orbit", 3.0, 100);

            var observed = DelayedStateReader.Read(archive, "vessel.orbit", "ksc", 0, 200, AsState);

            Assert.Equal(3.0, observed.State.Position.X);
            Assert.Equal(3.0, observed.State.Velocity.Y);
            Assert.Equal(1, observed.CentreBodyIndex);
        }
    }
}
