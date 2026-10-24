using System.Collections.Generic;
using System.Linq;
using Sitrep.Host.Science;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// When a transmission is seen to finish from repeated looks at the transmitter: the one
    /// being sent leaves the queue, so it ends when the next is taken out or the transmitter
    /// goes idle, and one that was abandoned or came back aboard never ends.
    /// </summary>
    public class TransmitterWatchTests
    {
        private static readonly QueuedData Crew = new QueuedData(new object(), "crewReport@KerbinLanded", "Crew Report", 5);
        private static readonly QueuedData Goo = new QueuedData(new object(), "mysteryGoo@KerbinLanded", "Mystery Goo", 10);
        private static readonly IReadOnlyCollection<QueuedData> NothingAboard = new List<QueuedData>();

        private static TransmitterReading Idle(string id = "t") => new TransmitterReading(id, false, false, new List<QueuedData>());

        private static TransmitterReading Busy(string id, params QueuedData[] queue) => new TransmitterReading(id, true, false, queue);

        private static TransmitterReading Busy(params QueuedData[] queue) => Busy("t", queue);

        private static IReadOnlyList<FinishedTransmission> Look(
            TransmitterWatch watch,
            TransmitterReading reading,
            double ut,
            IReadOnlyCollection<QueuedData>? aboard = null) =>
            watch.Observe(new[] { reading }, aboard ?? NothingAboard, ut);

        [Fact]
        public void AResultIsFinishedWhenTheTransmitterGoesIdleNotBefore()
        {
            var watch = new TransmitterWatch();
            Assert.Empty(Look(watch, Busy(Crew), 100));
            Assert.Empty(Look(watch, Busy(), 101));
            Assert.Empty(Look(watch, Busy(), 105));

            var done = Assert.Single(Look(watch, Idle(), 108));

            Assert.Equal("Crew Report", done.Title);
            Assert.Equal(100, done.StartedAt);
            Assert.Equal(108, done.CompletedAt);
        }

        [Fact]
        public void ATransmitterBusyAgainRightAfterAFinishWithNothingQueuedSendsNothingMore()
        {
            var watch = new TransmitterWatch();
            Look(watch, Busy(Crew), 100);
            Look(watch, Busy(), 101);
            var real = Assert.Single(Look(watch, Idle(), 108));
            Assert.Equal("Crew Report", real.Title);

            Assert.Empty(Look(watch, Busy(), 108.5));
            Assert.Empty(Look(watch, Idle(), 112));
        }

        [Fact]
        public void ATransmitterBusyWithNothingInViewLongAfterTheLastFinishStillReportsTheUnseenResult()
        {
            var watch = new TransmitterWatch();
            Look(watch, Busy(Crew), 100);
            Look(watch, Busy(), 101);
            Look(watch, Idle(), 108);

            Look(watch, Busy(), 200);
            var unseen = Assert.Single(Look(watch, Idle(), 210));

            Assert.Null(unseen.Title);
            Assert.Equal(200, unseen.StartedAt);
        }

        [Fact]
        public void TwoBackToBackResultsFinishAtTheirOwnMoments()
        {
            var watch = new TransmitterWatch();
            Look(watch, Busy(Crew, Goo), 100);
            Look(watch, Busy(Goo), 101);

            var first = Assert.Single(Look(watch, Busy(), 110));
            var second = Assert.Single(Look(watch, Idle(), 125));

            Assert.Equal("Crew Report", first.Title);
            Assert.Equal(110, first.CompletedAt);
            Assert.Equal("Mystery Goo", second.Title);
            Assert.Equal(125, second.CompletedAt);
        }

        [Fact]
        public void ATransmissionToldToAbortIsNeverReported()
        {
            var watch = new TransmitterWatch();
            Look(watch, Busy(Crew), 100);
            Look(watch, Busy(), 101);
            Look(watch, new TransmitterReading("t", true, true, new List<QueuedData>()), 103);

            Assert.Empty(Look(watch, Idle(), 104));
        }

        [Fact]
        public void AResultThatIsBackAboardWhenTheTransmitterGoesIdleWasNeverSent()
        {
            var watch = new TransmitterWatch();
            Look(watch, Busy(Crew), 100);
            Look(watch, Busy(), 101);

            Assert.Empty(Look(watch, Idle(), 104, new List<QueuedData> { Crew }));
        }

        [Fact]
        public void ATransmissionFirstSeenWithItsResultAlreadyTakenOutIsReportedWithoutATitle()
        {
            var watch = new TransmitterWatch();
            Look(watch, Busy(), 100);

            var done = Assert.Single(Look(watch, Idle(), 107));

            Assert.Null(done.Title);
            Assert.Null(done.SubjectId);
            Assert.Equal(107, done.CompletedAt);
        }

        [Fact]
        public void AnIdleTransmitterReportsNothing()
        {
            var watch = new TransmitterWatch();

            Assert.Empty(Look(watch, Idle(), 100));
            Assert.Empty(Look(watch, Idle(), 101));
            Assert.False(watch.HasRuns);
        }

        [Fact]
        public void ATransmitterThatVanishesMidRunReportsNothingAndIsForgotten()
        {
            var watch = new TransmitterWatch();
            Look(watch, Busy(Crew), 100);
            Assert.True(watch.HasRuns);

            Assert.Empty(watch.Observe(new List<TransmitterReading>(), NothingAboard, 105));

            Assert.False(watch.HasRuns);
        }

        [Fact]
        public void TwoTransmittersAreFollowedSeparately()
        {
            var watch = new TransmitterWatch();
            watch.Observe(new[] { Busy("a", Crew), Busy("b", Goo) }, NothingAboard, 100);
            watch.Observe(new[] { Busy("a"), Busy("b") }, NothingAboard, 101);

            var done = watch.Observe(new[] { Idle("a"), Busy("b") }, NothingAboard, 105);

            Assert.Equal("Crew Report", Assert.Single(done).Title);
            Assert.True(watch.HasRuns);
            Assert.Equal(new[] { "Mystery Goo" }, watch.Observe(new[] { Idle("b") }, NothingAboard, 109).Select(d => d.Title));
        }

        [Fact]
        public void AnAbortedTransmissionAndEverythingQueuedBehindItIsReportedAbandoned()
        {
            var watch = new TransmitterWatch();
            Look(watch, Busy(Crew, Goo), 100);
            Look(watch, Busy(Goo), 101);
            Look(watch, new TransmitterReading("t", true, true, new List<QueuedData> { Goo }), 103);

            Assert.Empty(Look(watch, Idle(), 104));

            Assert.Equal(new[] { "Crew Report", "Mystery Goo" }, watch.Abandoned.Select(a => a.Title).OrderBy(t => t));
            Assert.All(watch.Abandoned, a => Assert.Equal(100, a.StartedAt));
        }

        [Fact]
        public void AResultBackAboardIsReportedAbandonedAndOneThatWasSentIsNot()
        {
            var watch = new TransmitterWatch();
            Look(watch, Busy(Crew), 100);
            Look(watch, Busy(), 101);

            Look(watch, Idle(), 104, new List<QueuedData> { Crew });

            Assert.Equal("Crew Report", Assert.Single(watch.Abandoned).Title);

            Look(watch, Busy(Goo), 200);
            Look(watch, Busy(), 201);
            Assert.Single(Look(watch, Idle(), 204));
            Assert.Empty(watch.Abandoned);
        }

        [Fact]
        public void ATwoSecondTransmissionIsSeenFinishingOnTheFirstLookAfterItEnds()
        {
            var watch = new TransmitterWatch();
            Look(watch, Busy(Goo), 1719.00);
            Look(watch, Busy(), 1719.02);
            Assert.Empty(Look(watch, Busy(), 2000.0 / 1000 + 1717.5));

            var done = Assert.Single(Look(watch, Idle(), 1721.1));

            Assert.Equal(1719.00, done.StartedAt);
            Assert.Equal(1721.1, done.CompletedAt, 6);
        }
    }
}
