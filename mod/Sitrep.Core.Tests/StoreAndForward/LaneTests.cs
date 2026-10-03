using System.Collections.Generic;
using System.Linq;
using Sitrep.Core.StoreAndForward;
using Xunit;

namespace Sitrep.Core.Tests.StoreAndForward
{
    public class LaneTests
    {
        private static readonly LaneKey Lane = new LaneKey(1, "ground:ksc", "vessel:probe");

        private sealed class Craft
        {
            public readonly List<long> Ran = new List<long>();
            public readonly List<ReportMessage> Reports = new List<ReportMessage>();

            public LaneCollector Collector(ControlValueRelease release = ControlValueRelease.RunEvery) =>
                new LaneCollector(Lane, (c, ut) => { Ran.Add(c.LaneSeq); return "ok"; }, Reports.Add, release);

            public IEnumerable<JourneyKind> Kinds(long seq) => Reports.Where(r => r.LaneSeq == seq).Select(r => r.Kind);
        }

        private static CommandMessage Command(long seq, double? gap = null, double deleteAt = 3600.0, string? channel = null) => new CommandMessage
        {
            Id = "cmd-" + seq,
            Lane = Lane,
            LaneSeq = seq,
            GapExpiresUt = gap,
            DeleteAtUt = deleteAt,
            Command = "c",
            Channel = channel,
        };

        private static CancelMessage CancelOf(long from, long through) => new CancelMessage
        {
            Id = "cancel-" + from,
            Lane = Lane,
            FromSeq = from,
            ThroughSeq = through,
            DeleteAtUt = 3600.0,
        };

        [Fact]
        public void CommandsRunInLaneOrderEvenWhenTheyArriveOutOfIt()
        {
            var craft = new Craft();
            var collector = craft.Collector();

            collector.Arrive(Command(2, gap: 3600.0), 10.0);
            Assert.Empty(craft.Ran);
            Assert.Equal(new long[] { 1 }, craft.Reports.Single(r => r.Kind == JourneyKind.Waiting).Missing);

            collector.Arrive(Command(1), 20.0);
            Assert.Equal(new long[] { 1, 2 }, craft.Ran);
            Assert.Equal(2, craft.Reports.Count(r => r.Kind == JourneyKind.Reply));
        }

        [Fact]
        public void AGapReleasesWhenItsExpiryPassesAndALatePredecessorIsDiscarded()
        {
            var craft = new Craft();
            var collector = craft.Collector();

            collector.Arrive(Command(2, gap: 100.0), 10.0);
            collector.Tick(99.0);
            Assert.Empty(craft.Ran);

            collector.Tick(100.0);
            Assert.Equal(new long[] { 2 }, craft.Ran);

            collector.Arrive(Command(1), 150.0);
            Assert.Equal(new long[] { 2 }, craft.Ran);
            Assert.Contains(craft.Reports, r => r.LaneSeq == 1 && r.Kind == JourneyKind.Discarded && r.Detail == "its lane moved on");
        }

        [Fact]
        public void ACommandWithNoGapExpiryNeverWaits()
        {
            var craft = new Craft();
            craft.Collector().Arrive(Command(3, gap: null), 10.0);

            Assert.Equal(new long[] { 3 }, craft.Ran);
        }

        [Fact]
        public void ASecondCopyOfANumberThatRanIsDiscarded()
        {
            var craft = new Craft();
            var collector = craft.Collector();
            collector.Arrive(Command(1), 10.0);

            collector.Arrive(new CommandMessage { Id = "copy", Lane = Lane, LaneSeq = 1, DeleteAtUt = 3600.0, Attempt = 2 }, 20.0);

            Assert.Equal(new long[] { 1 }, craft.Ran);
            Assert.Contains(craft.Reports, r => r.About == "copy" && r.Detail == "a copy already ran");
        }

        [Fact]
        public void ACancelThatArrivesFirstIsStoredAndTheCommandIsRefusedWhenItComes()
        {
            var craft = new Craft();
            var collector = craft.Collector();

            collector.Cancel(CancelOf(1, 1), 5.0);
            Assert.Contains(JourneyKind.CancelStored, craft.Kinds(1));

            collector.Arrive(Command(2, gap: 3600.0), 6.0);
            Assert.Equal(new long[] { 2 }, craft.Ran);

            collector.Arrive(Command(1), 10.0);
            Assert.Equal(new long[] { 2 }, craft.Ran);
            Assert.Contains(craft.Reports, r => r.LaneSeq == 1 && r.Detail == "cancelled");
        }

        [Fact]
        public void ACancelAfterTheCommandRanIsLateAndSaysWhenItRan()
        {
            var craft = new Craft();
            var collector = craft.Collector();
            collector.Arrive(Command(1), 10.0);

            collector.Cancel(CancelOf(1, 1), 20.0);

            var late = craft.Reports.Single(r => r.Kind == JourneyKind.CancelLate);
            Assert.Equal(10.0, late.UntilUt);
        }

        [Fact]
        public void CancellingTheMissingNumberDrainsTheOnesWaitingBehindIt()
        {
            var craft = new Craft();
            var collector = craft.Collector();
            collector.Arrive(Command(2, gap: 3600.0), 10.0);
            collector.Arrive(Command(3, gap: 3600.0), 11.0);

            collector.Cancel(CancelOf(1, 1), 20.0);

            Assert.Equal(new long[] { 2, 3 }, craft.Ran);
        }

        [Fact]
        public void CancellingAWaitingCommandAndEverythingBehindItStopsThemAll()
        {
            var craft = new Craft();
            var collector = craft.Collector();
            collector.Arrive(Command(2, gap: 3600.0), 10.0);
            collector.Arrive(Command(3, gap: 3600.0), 11.0);

            collector.Cancel(CancelOf(2, 4), 20.0);
            collector.Arrive(Command(1), 30.0);
            collector.Arrive(Command(4, gap: 3600.0), 31.0);

            Assert.Equal(new long[] { 1 }, craft.Ran);
            Assert.Equal(2, craft.Reports.Count(r => r.Kind == JourneyKind.Cancelled));
        }

        [Fact]
        public void ACommandArrivingPastItsExpiryIsDeletedAndReported()
        {
            var craft = new Craft();
            craft.Collector().Arrive(Command(1, deleteAt: 50.0), 60.0);

            Assert.Empty(craft.Ran);
            Assert.Contains(JourneyKind.Expired, craft.Kinds(1));
        }

        [Fact]
        public void AWaitingCommandThatOutlivesItsLifetimeExpiresAndTheLaneMovesOn()
        {
            var craft = new Craft();
            var collector = craft.Collector();
            collector.Arrive(Command(2, gap: 3600.0, deleteAt: 100.0), 10.0);

            collector.Tick(101.0);

            Assert.Empty(craft.Ran);
            Assert.Contains(JourneyKind.Expired, craft.Kinds(2));
        }

        [Fact]
        public void ReleasingHeldControlValuesRunsEveryOneOrOnlyTheLatestAsTheReleaseRuleSays()
        {
            void ArriveTogether(LaneCollector collector)
            {
                collector.Arrive(Command(2, gap: 3600.0, channel: "throttle"), 10.0);
                collector.Arrive(Command(3, gap: 3600.0, channel: "throttle"), 11.0);
                collector.Arrive(Command(4, gap: 3600.0), 12.0);
                collector.Arrive(Command(1), 20.0);
            }

            var every = new Craft();
            ArriveTogether(every.Collector(ControlValueRelease.RunEvery));
            Assert.Equal(new long[] { 1, 2, 3, 4 }, every.Ran);

            var latest = new Craft();
            ArriveTogether(latest.Collector(ControlValueRelease.LatestWins));
            Assert.Equal(new long[] { 1, 3, 4 }, latest.Ran);
            Assert.Contains(latest.Reports, r => r.LaneSeq == 2 && r.Detail == "superseded by a later throttle value");
        }

        [Fact]
        public void TheSenderCarriesTheLatestUnresolvedExpiryAndForgetsWhatCanNoLongerArrive()
        {
            var sender = new LaneSender();

            var (first, firstGap) = sender.Assign(0.0, 3600.0);
            var (second, secondGap) = sender.Assign(10.0, 3610.0);
            Assert.Equal(1, first);
            Assert.Null(firstGap);
            Assert.Equal(3600.0, secondGap);

            sender.Resolve(first);
            var (_, thirdGap) = sender.Assign(20.0, 3620.0);
            Assert.Equal(3610.0, thirdGap);

            var (_, afterExpiry) = sender.Assign(4000.0, 7600.0);
            Assert.Null(afterExpiry);
            Assert.Equal(2, second);
        }
    }
}
