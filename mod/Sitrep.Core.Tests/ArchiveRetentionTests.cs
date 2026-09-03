using System.Collections.Generic;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Retention, which exists because the archive grew without bound and the cost
    /// was never mainly memory.
    ///
    /// <para><see cref="Courier"/> walks a topic's WHOLE history on every subscribe
    /// to schedule the samples still in flight, skipping everything that has already
    /// arrived. So the work done per subscribe grew with the length of the session
    /// rather than with the number of samples still in flight.</para>
    ///
    /// <para>C#-only, like <see cref="Archive.ResetTimeline"/> beside it. The
    /// TypeScript reference in <c>mod/sitrep-server</c> is a test double that runs
    /// for milliseconds, so unbounded growth is not a defect it can exhibit, and
    /// retention is deliberately not part of the conformed contract. What IS
    /// conformed is read behaviour, which a correct prune preserves inside the
    /// window by construction.</para>
    /// </summary>
    public class ArchiveRetentionTests
    {
        [Fact]
        public void KeepsTheSampleThatIsStillCurrentEvenThoughItIsOld()
        {
            // THE case, and the one a naive prune gets wrong. A slow-changing topic
            // records once and then says nothing for hours. That old sample is still
            // the topic's CURRENT value, because `ReadAtVantage` answers with the
            // latest sample at or before the vantage instant. Dropping everything
            // older than the cutoff deletes it, and the channel then answers null
            // forever with no error anywhere.
            //
            // Three samples on the slow topic rather than one, because `RetainFrom`
            // returns immediately below three: a one-or-two-sample topic asserts the
            // property against a prune that never ran.
            var archive = new Archive();
            archive.Record("vessel.name", "Odyssey I", 100);
            archive.Record("vessel.name", "Odyssey II", 200);
            archive.Record("vessel.name", "Odyssey", 300);
            archive.Record("vessel.altitude", 1.0, 2000);

            archive.PruneBefore(1000);

            var read = archive.ReadAtVantage("vessel.name", "ksc", 0, 1500);
            Assert.NotNull(read);
            Assert.Equal("Odyssey", read!.Value.Value);
            Assert.Equal(300, read.Value.ValidAt);

            // The prune did run: the unreachable middle name is gone, leaving the
            // birth sample and the one still current at the cutoff.
            var kept = archive.Samples("vessel.name");
            Assert.Equal(2, kept.Count);
            Assert.Equal(100, kept[0].ValidAt);
            Assert.Equal(300, kept[1].ValidAt);
        }

        [Fact]
        public void DropsWhatIsNoLongerReachableAndKeepsTheRest()
        {
            var archive = new Archive();
            for (var ut = 0; ut < 10; ut++)
            {
                archive.Record("t", ut, ut * 100);
            }

            archive.PruneBefore(550);

            // 500 is the newest sample at or before the cutoff, so it stays: it is
            // the answer for every read between 500 and 600. The birth sample at 0
            // stays too, against a rewind below every cursor. Everything between
            // them is unreachable and goes.
            var kept = archive.Samples("t");
            Assert.Equal(6, kept.Count);
            Assert.Equal(0, kept[0].ValidAt);
            Assert.Equal(500, kept[1].ValidAt);
            Assert.Equal(900, kept[kept.Count - 1].ValidAt);
        }

        [Fact]
        public void AReadThatCanNoLongerBeAnsweredSaysNothingRatherThanSomethingNewer()
        {
            // The safety property that makes pruning acceptable at all. After a
            // prune, a read that would have needed a dropped sample returns null.
            // The failure that matters is the other one: answering with a sample
            // NEWER than the vantage should be able to see is a future leak, and
            // this asserts it does not happen.
            var archive = new Archive();
            archive.Record("t", "first", 50);
            archive.Record("t", "second", 100);
            archive.Record("t", "old", 200);
            archive.Record("t", "new", 900);

            archive.PruneBefore(800);

            // The prune ran and dropped "second": it is the only sample no vantage
            // at or after the cutoff can reach.
            Assert.Equal(3, archive.Samples("t").Count);

            // Below the topic's birth there is nothing to say, and it says nothing.
            Assert.Null(archive.ReadAtVantage("t", "before-birth", 0, 20));

            // 150 is inside the pruned span, so the sample that would have answered
            // it is gone. The answer is the OLDER survivor, never the newer one.
            var insidePrunedSpan = archive.ReadAtVantage("t", "far", 0, 150);
            Assert.NotNull(insidePrunedSpan);
            Assert.Equal("first", insidePrunedSpan!.Value.Value);

            var atCutoff = archive.ReadAtVantage("t", "near", 0, 850);
            Assert.NotNull(atCutoff);
            Assert.Equal("old", atCutoff!.Value.Value);
        }

        [Fact]
        public void PruningTwiceChangesNothingTheSecondTime()
        {
            var archive = new Archive();
            for (var i = 0; i < 6; i++)
            {
                archive.Record("t", i, i * 10);
            }

            archive.PruneBefore(25);
            var afterFirst = archive.Samples("t").Count;
            archive.PruneBefore(25);

            // Idempotence is worth nothing if the first prune was itself a no-op,
            // which is what a prune that never runs looks like from here. Pin that
            // the first pass actually dropped something before comparing passes.
            Assert.Equal(5, afterFirst);
            Assert.Equal(afterFirst, archive.Samples("t").Count);
        }

        [Fact]
        public void ACutoffBelowEverythingKeepsEverything()
        {
            // Four samples, not two: below three `RetainFrom` returns before it
            // reaches the cutoff scan, so a two-sample topic proves nothing about
            // what a cutoff below everything does.
            var archive = new Archive();
            archive.Record("t", 1, 500);
            archive.Record("t", 2, 600);
            archive.Record("t", 3, 700);
            archive.Record("t", 4, 800);

            archive.PruneBefore(100);

            Assert.Equal(4, archive.Samples("t").Count);
        }

        [Fact]
        public void PrunesToTheLAGGIESTVantageRatherThanTheLatestOne()
        {
            // The cutoff the archive can derive on its own, with no knowledge of
            // delays: every vantage's cursor is where that vantage reads from, and
            // the cursor only ever moves forward. So the oldest cursor bounds what
            // is still reachable. Taking the newest instead would delete data the
            // laggy vantage has not read yet, which is the whole hazard.
            var archive = new Archive();
            for (var i = 0; i < 10; i++)
            {
                archive.Record("t", i, i * 100);
            }

            // A near vantage has read up to 900; a distant one only to 300.
            archive.ReadAtVantage("t", "near", 0, 900);
            archive.ReadAtVantage("t", "distant", 600, 900);

            archive.PruneToVantageCursors();

            var distant = archive.ReadAtVantage("t", "distant", 600, 900);
            Assert.NotNull(distant);
            Assert.Equal(300, distant!.Value.ValidAt);

            // Both halves of the choice, because "distant still reads 300" is also
            // true of an archive that never pruned at all. It DID prune, down to
            // the distant cursor and no further: 100 and 200 are gone, and 400,
            // which pruning to the NEAR cursor would have taken, is still here.
            var kept = archive.Samples("t");
            Assert.Equal(8, kept.Count);
            Assert.DoesNotContain(kept, s => s.ValidAt == 100 || s.ValidAt == 200);
            Assert.Contains(kept, s => s.ValidAt == 400);
        }

        [Fact]
        public void ATopicNoVantageHasReadIsLeftAlone()
        {
            // No cursor means no evidence about what is reachable, and a topic
            // nobody has subscribed to yet is exactly the one whose history a first
            // subscriber will want.
            //
            // Four samples: with two, `RetainFrom` bails on count before the
            // no-cursor guard can be the reason anything survived, so dropping the
            // guard would not have shown up here.
            var archive = new Archive();
            archive.Record("t", 1, 100);
            archive.Record("t", 2, 200);
            archive.Record("t", 3, 300);
            archive.Record("t", 4, 400);

            archive.PruneToVantageCursors();

            Assert.Equal(4, archive.Samples("t").Count);
        }

        [Fact]
        public void RetentionIsBoundedByTheWindowRatherThanBySessionLength()
        {
            // The defect stated as a measurement. A steady 1 Hz topic read by one
            // vantage should not accumulate an hour of samples just because the
            // session lasted an hour.
            var archive = new Archive();
            for (var ut = 0; ut < 3600; ut++)
            {
                archive.Record("t", ut, ut);
                archive.ReadAtVantage("t", "ksc", 5, ut);
                if (ut % 60 == 0)
                {
                    archive.PruneToVantageCursors();
                }
            }

            Assert.True(
                archive.Samples("t").Count < 120,
                "retained " + archive.Samples("t").Count + " samples of 3600, which is not bounded "
                    + "by the delay window");
        }

        [Fact]
        public void KeepsTheBirthSampleSoARewindBelowEveryCursorStillHasAnAnswer()
        {
            // Found by a pre-existing timeline-reset test rather than reasoned out,
            // and pinned here so the reason travels with the rule. A cursor only
            // describes a vantage that exists NOW. A quickload to an instant below
            // every cursor leaves the earliest sample as the only thing that can
            // answer, and pruning purely by cursor had deleted it.
            var archive = new Archive();
            archive.Record("t", "birth", 0);
            archive.Record("t", "early", 25);
            archive.Record("t", "mid", 50);
            archive.Record("t", "peak", 100);
            archive.ReadAtVantage("t", "ksc", 0, 100);

            archive.PruneToVantageCursors();

            // The prune was real: "early" and "mid" sat below the only cursor and
            // are gone. Keeping the birth sample matters precisely because its
            // neighbours do not survive.
            Assert.Equal(2, archive.Samples("t").Count);

            // The quickload: everything ahead of the new timeline goes.
            archive.ResetTimeline(20);

            var afterRewind = archive.ReadAtVantage("t", "fresh", 0, 20);
            Assert.NotNull(afterRewind);
            Assert.Equal("birth", afterRewind!.Value.Value);
        }

        [Fact]
        public void TheCourierActuallyPrunesAsItRecords()
        {
            // The wiring, not the rule. Every other test here calls the prune
            // directly, so all of them pass even if nothing ever invokes it, which
            // is how a mechanism ships inert. This one goes through `Courier.Record`
            // and observes the consequence.
            //
            // What it observes is the accepted COST rather than the benefit, because
            // pruning only ever drops samples no current vantage can reach and so
            // has no effect any current vantage can see. A vantage that arrives
            // LATE, with a delay large enough to put its scene below every existing
            // cursor, is the one thing that can tell: unpruned it would catch up on
            // mid-history, and pruned it gets the birth value.
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);

            var near = new List<object?>();
            courier.SubscribeStream("n", "t", "near", data => near.Add(data.Payload));

            for (var ut = 0; ut <= 300; ut += 10)
            {
                courier.Record("n", "t", "v" + ut, ut);
                clock.AdvanceTo(ut);
            }

            // `near` read at delay 0, so its cursor sits at 300 and everything below
            // it is unreachable, except the birth sample.
            Assert.Equal("v300", near[near.Count - 1]);

            network.SetDelay("far", "n", 250);
            var far = new List<object?>();
            courier.SubscribeStream("n", "t", "far", data => far.Add(data.Payload));

            // far's scene is 300 - 250 = 50. The sample valid at 50 was pruned, so
            // the honest answer is the birth value rather than a mid one.
            Assert.NotEmpty(far);
            Assert.Equal("v0", far[0]);
        }

        [Fact]
        public void KeepsTheEpochOnASurvivingSample()
        {
            // Two epochs and four samples, so this reads the epoch off a sample the
            // prune actually chose to retain rather than off a topic it declined to
            // touch, and a retained sample carrying the WRONG epoch is visible.
            var archive = new Archive();
            archive.Record("t", "a", 100, epoch: 7);
            archive.Record("t", "b", 200, epoch: 7);
            archive.Record("t", "c", 300, epoch: 9);
            archive.Record("t", "d", 900, epoch: 9);

            archive.PruneBefore(800);

            // The retained-at-cutoff sample keeps ITS epoch, which is only visible
            // when the topic carries more than one: reading epoch 7 back off a
            // single-epoch topic says nothing about whether the prune preserved it.
            var kept = archive.Samples("t");
            Assert.Equal(3, kept.Count);
            Assert.Equal(7, kept[0].Epoch);
            Assert.Equal(300, kept[1].ValidAt);
            Assert.Equal(9, kept[1].Epoch);
        }
    }
}
