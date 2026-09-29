using System;
using System.Collections.Generic;
using System.Text;
using Sitrep.Contract;

namespace Sitrep.Contract.Serialization
{
    /// <summary>
    /// Reader/writer for the <see cref="BinaryLane"/> wire frame: the four
    /// framing bytes, the UTF-8 JSON header (written by
    /// <see cref="EnvelopeCodec.WriteStreamBinaryHeader"/>) and the segment
    /// region.
    ///
    /// <para>The JSON header itself is written and read by
    /// <see cref="EnvelopeCodec"/>; this class owns only the byte framing around
    /// it: a magic byte, a lane byte, a big-endian 16-bit header length, the
    /// header, then the segments back to back with their lengths listed in the
    /// header.</para>
    ///
    /// <para><b>A malformed frame is never read as an empty one.</b> Every
    /// failure returns false or throws with a named reason, so an empty segment
    /// list always means the producer sent no segments, never that the frame
    /// arrived broken.</para>
    /// <internal>
    /// EnvelopeCodec's JSON is held byte-for-byte to the TypeScript reference by
    /// the golden fixture; this layer has no JSON twin, and its conformance is
    /// the round trip against the client decoder in binary-frame.test.ts.
    /// </internal>
    /// </summary>
    /// <category>Serialization</category>
    public static class BinaryFrameCodec
    {
        /// <summary>
        /// Frame one delivery: prefix, header, then the segments concatenated
        /// in order.
        ///
        /// <para><paramref name="header"/>'s own <c>Segments</c> is ignored and
        /// overwritten from <paramref name="segments"/>: the length table is
        /// always derived from the bytes written, so it cannot disagree with
        /// them.</para>
        /// </summary>
        /// <param name="header">The frame's header. Its <c>Segments</c> is overwritten with the segment lengths.</param>
        /// <param name="segments">The segments to carry, in order. None may be null.</param>
        /// <returns>The complete frame bytes.</returns>
        /// <exception cref="ArgumentNullException"><paramref name="header"/> or <paramref name="segments"/> is null.</exception>
        /// <exception cref="ArgumentException">A segment is null.</exception>
        /// <exception cref="InvalidOperationException">The encoded header is longer than <see cref="BinaryLane.MaxHeaderBytes"/>.</exception>
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
        /// <para>An unknown lane is refused with its lane byte in the reason,
        /// rather than falling back to reading the bytes as text: a UTF-8 decode
        /// of, say, compressed audio fails JSON parsing somewhere else and loses
        /// the one fact worth reporting. The segment lengths in the header must
        /// sum exactly to the bytes that follow it; a shorter or longer frame is
        /// refused.</para>
        /// </summary>
        /// <param name="frame">The buffer holding the frame.</param>
        /// <param name="offset">Where the frame starts in <paramref name="frame"/>.</param>
        /// <param name="count">How many bytes of <paramref name="frame"/> the frame occupies.</param>
        /// <param name="header">The parsed header on success; null on failure.</param>
        /// <param name="segments">The segments, in order, on success; empty on failure.</param>
        /// <param name="reason">What was wrong on failure; empty on success.</param>
        /// <returns>True when the frame was well formed and read.</returns>
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
