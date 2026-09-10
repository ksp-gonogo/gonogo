using System;
using System.Collections.Generic;
using System.Text;
using Sitrep.Contract;

namespace Sitrep.Core.Serialization
{
    /// <summary>
    /// Reader/writer for the <see cref="BinaryLane"/> wire frame: the four
    /// framing bytes, the UTF-8 JSON header (written by
    /// <see cref="EnvelopeCodec.WriteStreamBinaryHeader"/>) and the segment
    /// region.
    ///
    /// <para>Split from <see cref="EnvelopeCodec"/> on the line between JSON
    /// and BYTES. Everything that produces or consumes a JSON document lives
    /// there and is held byte-for-byte identical to the TypeScript reference by
    /// the golden fixture; this file owns only the envelope around it, which is
    /// not JSON and has no TS-serialization twin to conform to. The equivalent
    /// conformance for this layer is a round trip against the client's decoder,
    /// which is what <c>binary-frame.test.ts</c> holds.</para>
    ///
    /// <para><b>Malformed is UNREAD.</b> Every failure path here returns false
    /// or throws with a named reason, and none of them yields a frame with zero
    /// segments. A caller handed an empty segment list must be able to read it
    /// as a producer that genuinely sent nothing this frame, which is not the
    /// same claim as "the frame arrived broken" and must not be spelled the
    /// same way.</para>
    /// </summary>
    public static class BinaryFrameCodec
    {
        /// <summary>
        /// Frame one delivery: prefix, header, then the segments concatenated
        /// in order.
        ///
        /// <para><paramref name="header"/>'s own <c>Segments</c> is IGNORED and
        /// overwritten from <paramref name="segments"/>. The length table is
        /// derived, never declared: a producer that could state a length
        /// separately from the bytes it is writing is a producer that can state
        /// it wrong, and the resulting frame would be undecodable at the far
        /// end for a reason invisible at this one.</para>
        /// </summary>
        public static byte[] WriteStreamBinary(StreamBinary header, IReadOnlyList<byte[]> segments)
        {
            if (header is null)
            {
                throw new ArgumentNullException(nameof(header));
            }

            if (segments is null)
            {
                throw new ArgumentNullException(nameof(segments));
            }

            var lengths = new int[segments.Count];
            var payloadBytes = 0;
            for (var i = 0; i < segments.Count; i++)
            {
                var segment = segments[i];
                if (segment is null)
                {
                    throw new ArgumentException("segment " + i + " is null", nameof(segments));
                }

                lengths[i] = segment.Length;
                payloadBytes += segment.Length;
            }

            header.Segments = lengths;
            var headerBytes = Encoding.UTF8.GetBytes(EnvelopeCodec.WriteStreamBinaryHeader(header));
            if (headerBytes.Length > BinaryLane.MaxHeaderBytes)
            {
                throw new InvalidOperationException(
                    "binary-lane header is " + headerBytes.Length + " bytes, past the u16 field's "
                    + BinaryLane.MaxHeaderBytes + ": the header holds a topic, a Meta and a length "
                    + "table, so this is a producer batching absurdly many segments into one frame");
            }

            var frame = new byte[BinaryLane.PrefixBytes + headerBytes.Length + payloadBytes];
            frame[0] = BinaryLane.Magic;
            frame[1] = BinaryLane.LaneStreamBinary;
            // Big-endian, the network byte order every other wire format in
            // reach uses, so a third party reading the two bytes by hand gets
            // the obvious answer rather than the platform's.
            frame[2] = (byte)((headerBytes.Length >> 8) & 0xFF);
            frame[3] = (byte)(headerBytes.Length & 0xFF);
            Buffer.BlockCopy(headerBytes, 0, frame, BinaryLane.PrefixBytes, headerBytes.Length);

            var offset = BinaryLane.PrefixBytes + headerBytes.Length;
            for (var i = 0; i < segments.Count; i++)
            {
                var segment = segments[i];
                Buffer.BlockCopy(segment, 0, frame, offset, segment.Length);
                offset += segment.Length;
            }

            return frame;
        }

        /// <summary>
        /// Read a frame back. Returns false, with <paramref name="reason"/>
        /// naming what was wrong, for anything that is not a well-formed frame
        /// of a lane this build knows.
        ///
        /// <para>Refusing an unknown LANE is the load-bearing case and the
        /// reason this returns a reason at all. A decoder that met one and fell
        /// back to treating the bytes as text would hand a UTF-8 decoder a
        /// buffer of compressed audio and get a string of replacement
        /// characters, which then fails JSON parsing somewhere else entirely,
        /// having thrown away the one fact worth reporting.</para>
        /// </summary>
        public static bool TryParseStreamBinary(
            byte[] frame,
            int offset,
            int count,
            out StreamBinary header,
            out IReadOnlyList<byte[]> segments,
            out string reason)
        {
            header = null!;
            segments = Array.Empty<byte[]>();

            if (frame is null || count < BinaryLane.PrefixBytes)
            {
                reason = "frame is shorter than the " + BinaryLane.PrefixBytes + "-byte binary-lane prefix";
                return false;
            }

            if (frame[offset] != BinaryLane.Magic)
            {
                reason = "frame does not lead with the binary-lane magic byte";
                return false;
            }

            var lane = frame[offset + 1];
            if (lane != BinaryLane.LaneStreamBinary)
            {
                reason = "unknown binary lane 0x" + lane.ToString("X2");
                return false;
            }

            var headerLength = (frame[offset + 2] << 8) | frame[offset + 3];
            var headerStart = offset + BinaryLane.PrefixBytes;
            if (headerLength > count - BinaryLane.PrefixBytes)
            {
                reason = "header claims " + headerLength + " bytes, only "
                    + (count - BinaryLane.PrefixBytes) + " remain in the frame";
                return false;
            }

            StreamBinary parsed;
            try
            {
                parsed = EnvelopeCodec.ParseStreamBinaryHeader(
                    Encoding.UTF8.GetString(frame, headerStart, headerLength));
            }
            catch (Exception ex)
            {
                reason = "header is not a readable stream-binary document: " + ex.Message;
                return false;
            }

            var payloadStart = headerStart + headerLength;
            var payloadAvailable = count - BinaryLane.PrefixBytes - headerLength;
            var declared = 0L;
            foreach (var length in parsed.Segments)
            {
                declared += length;
            }

            // Exact, in both directions. A short frame is truncation; a long
            // one means the header and the bytes disagree about what was sent,
            // and reading the prefix that does line up would be reading a
            // fragment of somebody's transmission as though it were the whole.
            if (declared != payloadAvailable)
            {
                reason = "segment table sums to " + declared + " bytes, frame carries "
                    + payloadAvailable;
                return false;
            }

            var result = new byte[parsed.Segments.Length][];
            var cursor = payloadStart;
            for (var i = 0; i < parsed.Segments.Length; i++)
            {
                var length = parsed.Segments[i];
                var segment = new byte[length];
                Buffer.BlockCopy(frame, cursor, segment, 0, length);
                result[i] = segment;
                cursor += length;
            }

            header = parsed;
            segments = result;
            reason = "";
            return true;
        }
    }
}
