using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The binary lane's wire format, and the four ways a frame can be wrong.
    ///
    /// <para>Three of the assertions here are PLANTED CONTROLS rather than
    /// checks on the happy path, and they are the ones that matter. A
    /// discriminator that never sees a JSON frame cannot be shown to
    /// discriminate; a refusal path that is never given a malformed frame
    /// reports success by doing nothing. So an ordinary envelope is offered to
    /// the magic-byte check, a frame is written on a lane this build does not
    /// know, and a well-formed frame is truncated by one byte, and each is
    /// asserted to be refused BY NAME.</para>
    /// </summary>
    public class BinaryFrameCodecTests
    {
        private static Meta SampleMeta() => new Meta
        {
            Source = "radio",
            ValidAt = 1000.25,
            Seq = 42,
            DeliveredAt = 1030.25,
            Vantage = "ksc",
            Quality = Quality.Loaded,
            Active = true,
            Staleness = Staleness.Fresh,
            TimelineEpoch = 3,
        };

        private static byte[][] SampleSegments() => new[]
        {
            new byte[] { 0x00, 0x01, 0x02, 0xFF },
            new byte[] { 0x9E, 0x7B, 0x00 },
            new byte[] { 0xAA },
        };

        [Fact]
        public void RoundTripsHeaderAndEverySegmentByteIdentical()
        {
            var segments = SampleSegments();
            var frame = BinaryFrameCodec.WriteStreamBinary(
                new StreamBinary { Topic = "radio.rx.v-1", Meta = SampleMeta() },
                segments);

            Assert.True(BinaryFrameCodec.TryParseStreamBinary(
                frame, 0, frame.Length, out var header, out var read, out var reason), reason);

            Assert.Equal("stream-binary", header.Type);
            Assert.Equal("radio.rx.v-1", header.Topic);
            Assert.Equal(new[] { 4, 3, 1 }, header.Segments);
            Assert.Equal(3, read.Count);
            for (var i = 0; i < segments.Length; i++)
            {
                Assert.Equal(segments[i], read[i]);
            }
        }

        /// <summary>
        /// The whole point of carrying a Meta rather than inventing a lighter
        /// header: a binary delivery is subject to the reveal gate, the vantage
        /// and the staleness verdict exactly as a JSON one is, and none of that
        /// survives if the block does not round trip.
        /// </summary>
        [Fact]
        public void CarriesTheSameMetaAJsonFrameWould()
        {
            var meta = SampleMeta();
            var frame = BinaryFrameCodec.WriteStreamBinary(
                new StreamBinary { Topic = "radio.rx.v-1", Meta = meta },
                SampleSegments());

            Assert.True(BinaryFrameCodec.TryParseStreamBinary(
                frame, 0, frame.Length, out var header, out _, out var reason), reason);

            Assert.Equal(meta.Source, header.Meta.Source);
            Assert.Equal(meta.ValidAt, header.Meta.ValidAt);
            Assert.Equal(meta.Seq, header.Meta.Seq);
            Assert.Equal(meta.DeliveredAt, header.Meta.DeliveredAt);
            Assert.Equal(meta.Vantage, header.Meta.Vantage);
            Assert.Equal(meta.Quality, header.Meta.Quality);
            Assert.Equal(meta.Active, header.Meta.Active);
            Assert.Equal(meta.Staleness, header.Meta.Staleness);
            Assert.Equal(meta.TimelineEpoch, header.Meta.TimelineEpoch);
        }

        [Fact]
        public void FrameLeadsWithTheMagicAndLaneBytes()
        {
            var frame = BinaryFrameCodec.WriteStreamBinary(
                new StreamBinary { Topic = "t", Meta = SampleMeta() },
                new[] { new byte[] { 1 } });

            Assert.Equal(BinaryLane.Magic, frame[0]);
            Assert.Equal(BinaryLane.LaneStreamBinary, frame[1]);
        }

        /// <summary>
        /// PLANTED CONTROL. Every frame the protocol writes today is a JSON
        /// document, and the discriminator's whole claim is that none of them
        /// can be mistaken for a binary one. Asserted against real output from
        /// <see cref="EnvelopeCodec"/> rather than a hand-typed `{`, so the day
        /// something starts writing a leading byte-order mark or a leading
        /// space, this fails rather than the client silently dropping every
        /// telemetry frame.
        /// </summary>
        [Fact]
        public void AnOrdinaryJsonEnvelopeIsNotReadAsABinaryFrame()
        {
            var envelopes = new[]
            {
                EnvelopeCodec.WriteStreamData(new StreamData<object?>
                {
                    Topic = "vessel.state",
                    Payload = new Dictionary<string, object?> { ["altitude"] = 1234.5 },
                    Meta = SampleMeta(),
                }),
                EnvelopeCodec.WriteEventMsg(new EventMsg { Topic = "vessel.state", Name = "subscribed", Meta = SampleMeta() }),
                EnvelopeCodec.WriteErrorMsg(new ErrorMsg { Code = "unknown-topic", Message = "no" }),
            };

            foreach (var json in envelopes)
            {
                var bytes = Encoding.UTF8.GetBytes(json);
                Assert.False(BinaryLane.IsBinaryFrame(bytes, 0, bytes.Length), json);
                Assert.False(BinaryFrameCodec.TryParseStreamBinary(
                    bytes, 0, bytes.Length, out _, out _, out _));
            }
        }

        /// <summary>
        /// PLANTED CONTROL, and the reason the lane byte exists at all: a
        /// decoder meeting a lane it does not know must refuse it by name. The
        /// failure this rules out is the silent one, where the bytes fall
        /// through to a UTF-8 decoder and the resulting mojibake fails JSON
        /// parsing somewhere else entirely, having discarded the one fact worth
        /// reporting.
        /// </summary>
        [Fact]
        public void AnUnknownLaneIsRefusedByName()
        {
            var frame = BinaryFrameCodec.WriteStreamBinary(
                new StreamBinary { Topic = "t", Meta = SampleMeta() },
                new[] { new byte[] { 1, 2, 3 } });
            frame[1] = 0x7F; // a lane no build has ever written

            Assert.False(BinaryFrameCodec.TryParseStreamBinary(
                frame, 0, frame.Length, out _, out var segments, out var reason));
            Assert.Contains("unknown binary lane 0x7F", reason);
            Assert.Empty(segments);
        }

        /// <summary>
        /// PLANTED CONTROL for absence discipline: a truncated frame is UNREAD.
        /// The temptation this rules out is returning the segments that DID
        /// arrive whole, which hands a listener a fragment of a transmission
        /// with nothing to say it is one.
        /// </summary>
        [Fact]
        public void ATruncatedFrameIsUnreadRatherThanPartiallyDelivered()
        {
            var frame = BinaryFrameCodec.WriteStreamBinary(
                new StreamBinary { Topic = "t", Meta = SampleMeta() },
                SampleSegments());

            for (var lost = 1; lost <= 4; lost++)
            {
                var truncated = frame.Take(frame.Length - lost).ToArray();
                Assert.False(BinaryFrameCodec.TryParseStreamBinary(
                    truncated, 0, truncated.Length, out _, out var segments, out var reason));
                Assert.Contains("segment table sums to", reason);
                Assert.Empty(segments);
            }
        }

        /// <summary>
        /// The other direction of the same exactness. A frame carrying MORE
        /// bytes than its table accounts for is a producer whose header and
        /// buffer disagree, and reading the prefix that happens to line up
        /// would deliver part of the disagreement as though it were the whole
        /// message.
        /// </summary>
        [Fact]
        public void AFrameLongerThanItsSegmentTableIsUnread()
        {
            var frame = BinaryFrameCodec.WriteStreamBinary(
                new StreamBinary { Topic = "t", Meta = SampleMeta() },
                SampleSegments());
            var overlong = frame.Concat(new byte[] { 0x00 }).ToArray();

            Assert.False(BinaryFrameCodec.TryParseStreamBinary(
                overlong, 0, overlong.Length, out _, out _, out var reason));
            Assert.Contains("segment table sums to", reason);
        }

        /// <summary>
        /// Zero segments is a LEGAL frame, and it has to be, or "this producer
        /// had nothing to say this tick" has no spelling that a listener can
        /// tell apart from a broken frame. The pairing with the truncation test
        /// above is the actual assertion: same empty segment list, opposite
        /// verdict.
        /// </summary>
        [Fact]
        public void ZeroSegmentsIsALegalFrameAndNotAFailure()
        {
            var frame = BinaryFrameCodec.WriteStreamBinary(
                new StreamBinary { Topic = "radio.rx.v-1", Meta = SampleMeta() },
                Array.Empty<byte[]>());

            Assert.True(BinaryFrameCodec.TryParseStreamBinary(
                frame, 0, frame.Length, out var header, out var segments, out var reason), reason);
            Assert.Empty(header.Segments);
            Assert.Empty(segments);
            Assert.Equal("", reason);
        }

        [Fact]
        public void AHeaderLengthPastTheEndOfTheFrameIsUnread()
        {
            var frame = BinaryFrameCodec.WriteStreamBinary(
                new StreamBinary { Topic = "t", Meta = SampleMeta() },
                new[] { new byte[] { 1, 2, 3 } });
            frame[2] = 0xFF;
            frame[3] = 0xFF;

            Assert.False(BinaryFrameCodec.TryParseStreamBinary(
                frame, 0, frame.Length, out _, out _, out var reason));
            Assert.Contains("header claims", reason);
        }

        [Fact]
        public void AFrameShorterThanThePrefixIsUnread()
        {
            var stub = new byte[] { BinaryLane.Magic, BinaryLane.LaneStreamBinary };
            Assert.False(BinaryFrameCodec.TryParseStreamBinary(
                stub, 0, stub.Length, out _, out _, out var reason));
            Assert.Contains("shorter than the", reason);
        }

        /// <summary>
        /// A negative or fractional segment length is not a short frame, it is
        /// a producer that has lost track of its own buffer. Refusing at the
        /// header keeps the parse from computing an offset out of it.
        /// </summary>
        [Theory]
        [InlineData("-4")]
        [InlineData("2.5")]
        public void ASegmentLengthThatIsNotAByteCountIsRefused(string bad)
        {
            var json = "{\"type\":\"stream-binary\",\"topic\":\"t\",\"segments\":[" + bad + "],"
                + "\"meta\":" + EnvelopeCodec.WriteMeta(SampleMeta()) + "}";

            var ex = Assert.Throws<FormatException>(() => EnvelopeCodec.ParseStreamBinaryHeader(json));
            Assert.Contains("non-negative integer", ex.Message);
        }

        /// <summary>
        /// The length table is DERIVED from the bytes rather than trusted from
        /// the caller, so a producer cannot state a length that disagrees with
        /// what it is writing and hand the far end an undecodable frame for a
        /// reason invisible at this end.
        /// </summary>
        [Fact]
        public void TheSegmentTableIsDerivedFromTheBytesNotFromTheHeaderHandedIn()
        {
            var lying = new StreamBinary { Topic = "t", Meta = SampleMeta(), Segments = new[] { 999 } };
            var frame = BinaryFrameCodec.WriteStreamBinary(lying, new[] { new byte[] { 1, 2 } });

            Assert.True(BinaryFrameCodec.TryParseStreamBinary(
                frame, 0, frame.Length, out var header, out var segments, out var reason), reason);
            Assert.Equal(new[] { 2 }, header.Segments);
            Assert.Equal(new byte[] { 1, 2 }, segments[0]);
        }

        /// <summary>
        /// Batching is the reason the lane exists, so the arithmetic that
        /// justifies it is asserted rather than left in a design document: ten
        /// segments behind one header cost far less per segment than ten
        /// frames would. The ratio is checked loosely (the header carries a
        /// real Meta, whose size moves with the topic string) because the claim
        /// is the ORDER of the saving, not a byte count.
        /// </summary>
        [Fact]
        public void BatchingAmortisesTheHeaderAcrossSegments()
        {
            var chunk = new byte[87];
            var one = BinaryFrameCodec.WriteStreamBinary(
                new StreamBinary { Topic = "radio.rx.v-1", Meta = SampleMeta() },
                new[] { chunk });
            var ten = BinaryFrameCodec.WriteStreamBinary(
                new StreamBinary { Topic = "radio.rx.v-1", Meta = SampleMeta() },
                Enumerable.Range(0, 10).Select(_ => new byte[87]).ToArray());

            var perSegmentUnbatched = one.Length;
            var perSegmentBatched = ten.Length / 10.0;
            Assert.True(
                perSegmentBatched < perSegmentUnbatched / 2.0,
                $"batched {perSegmentBatched:F1} B/segment vs unbatched {perSegmentUnbatched} B/segment");
        }
    }
}
