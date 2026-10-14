using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// <see cref="Meta.SampleId"/>: one number per recorded sample, carried by
    /// every delivery of it, so a client can tell the same sample sent twice
    /// from two samples that look alike.
    /// </summary>
    public class CourierSampleIdTests
    {
        private const string Node = "vessel-1";
        private const string Vantage = "KSC";
        private const string Terminal = "console.lines";

        [Fact]
        public void TwoIdenticalChunksAtOneInstantCarryDifferentIds()
        {
            var clock = new ManualClock();
            var courier = new Courier(clock, new StubNetwork());
            var ids = new List<long?>();
            courier.SubscribeStream(Node, Terminal, Vantage, data => ids.Add(data.Meta.SampleId));

            courier.Record(Node, Terminal, "a", 1000, Delivery.ReliableOrdered);
            courier.Record(Node, Terminal, "a", 1000, Delivery.ReliableOrdered);
            clock.AdvanceTo(1000);

            Assert.Equal(2, ids.Count);
            Assert.NotNull(ids[0]);
            Assert.NotNull(ids[1]);
            Assert.NotEqual(ids[0], ids[1]);
        }

        [Fact]
        public void TheCopySentToALaterSubscriberCarriesTheOriginalId()
        {
            var clock = new ManualClock();
            var courier = new Courier(clock, new StubNetwork());
            var first = new List<long?>();
            courier.SubscribeStream(Node, "crash.lastCrash", Vantage, data => first.Add(data.Meta.SampleId));

            courier.Record(Node, "crash.lastCrash", "boom", 1000, Delivery.ReliableOrdered);
            clock.AdvanceTo(1001);

            var again = new List<long?>();
            courier.SubscribeStream(Node, "crash.lastCrash", Vantage, data => again.Add(data.Meta.SampleId));

            Assert.Single(first);
            Assert.Single(again);
            Assert.NotNull(first[0]);
            Assert.Equal(first[0], again[0]);
        }

        [Fact]
        public void EveryRecordedReplaySampleCarriesItsOwnIdAndKeepsItInTheArchive()
        {
            var clock = new ManualClock();
            var courier = new Courier(clock, new StubNetwork());
            var ids = new List<long?>();
            courier.SubscribeStream(Node, "vessel.altitude", Vantage, data => ids.Add(data.Meta.SampleId));

            courier.ReplayRecorded(
                Node,
                "vessel.altitude",
                new[] { new ArchiveSample(10.0, 900), new ArchiveSample(10.0, 900) },
                dumpedAtUt: 1000);
            clock.AdvanceTo(1000);

            Assert.Equal(2, ids.Count);
            Assert.NotEqual(ids[0], ids[1]);
            var late = new List<long?>();
            courier.SubscribeStream(Node, "vessel.altitude", Vantage, data => late.Add(data.Meta.SampleId));
            Assert.Single(late);
            Assert.Equal(ids[1], late[0]);
        }

        [Fact]
        public void ARestoredArchiveKeepsItsIdsAndNeverHandsOneOutAgain()
        {
            var archive = new Archive();
            var kept = archive.Record("t", "x", 1);
            archive.Record("t", "y", 2);

            var restored = Archive.Restore(archive.Snapshot());

            Assert.Equal(kept, restored.Samples("t")[0].SampleId);
            var next = restored.Record("t", "z", 3);
            Assert.DoesNotContain(next, new[] { restored.Samples("t")[0].SampleId, restored.Samples("t")[1].SampleId });
        }

        [Fact]
        public void TheEnvelopeCarriesASampleIdOnlyWhenOneIsSet()
        {
            var without = new Meta { Source = Node, Vantage = Vantage, Active = true };
            Assert.DoesNotContain("sampleId", EnvelopeCodec.WriteMeta(without));
            Assert.Null(EnvelopeCodec.ParseMeta(EnvelopeCodec.WriteMeta(without)).SampleId);

            var with = new Meta { Source = Node, Vantage = Vantage, Active = true, SampleId = 41 };
            Assert.Equal(41, EnvelopeCodec.ParseMeta(EnvelopeCodec.WriteMeta(with)).SampleId);
        }
    }
}
