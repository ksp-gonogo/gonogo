using System;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    /// <summary>
    /// The BINARY LANE: how a channel whose payload is opaque bytes reaches a
    /// client without paying JSON's tax on every byte.
    ///
    /// <para>Every server-to-client frame the protocol has ever written is a
    /// WebSocket BINARY frame carrying UTF-8 JSON, and every one of those
    /// documents opens with <c>{</c> (0x7B): <c>EnvelopeCodec</c>'s every
    /// <c>Write*</c> begins <c>sb.Append('{')</c>, and the client's decode
    /// UTF-8s the bytes and hands the string to <c>parseServerMessage</c>. A
    /// binary-lane frame is the same WebSocket frame with a different first
    /// byte, so the lane needs no transport change on either side, only a
    /// discriminator both decoders check before they decode anything.</para>
    ///
    /// <para><b>The layout, and it is deliberately the dullest thing that
    /// works.</b> A third party must be able to read this off a socket with no
    /// gonogo package installed, so there is no bespoke binary header: the
    /// framing is four bytes, and everything descriptive is the same JSON the
    /// rest of the protocol speaks.</para>
    ///
    /// <code>
    /// offset  size          field
    /// 0       1             MAGIC (0x9E)
    /// 1       1             LANE  (0x01 = stream-binary)
    /// 2       2             u16 big-endian header length H
    /// 4       H             UTF-8 JSON header, a StreamBinary
    /// 4+H     sum(segments) the segments, concatenated, in declaration order
    /// </code>
    ///
    /// <para><b>Why 0x9E cannot collide with a JSON frame.</b> Two independent
    /// reasons, either of which alone would do. A JSON document written by this
    /// protocol always leads with 0x7B. And 0x80-0xBF is the UTF-8
    /// CONTINUATION range, which can never legally lead a UTF-8 document at
    /// all, so the byte is not merely unused-today, it is unusable. The check
    /// is one comparison at each decode seam, before any decoding is
    /// attempted.</para>
    ///
    /// <para><b>Why this format can be as simple as it is.</b> A payload on
    /// this lane is held for light-time before it is revealed, typically 10-60
    /// seconds. That is what pays for TCP. The usual objection to a reliable
    /// transport for voice is that a retransmit lands after the playout
    /// deadline and is therefore useless, but a delay buffer IS a jitter
    /// buffer: at a ten-second hold a retransmit costing tens of milliseconds
    /// (a couple of seconds on a bad link) is still early, so this lane
    /// delivers the ACTUAL bytes where a media track would have concealed the
    /// drop. Lossless-but-late beats lossy-but-sooner once the listener has
    /// already agreed to wait, and there is consequently no sequencing, no
    /// retransmit logic and no loss concealment in the frame: the transport
    /// underneath already did it.</para>
    ///
    /// <para><b>Why the lane byte exists at all when there is only one lane.</b>
    /// So a second one can be added later without touching the frames this
    /// version writes. The regime this lane does NOT suit is a near-zero delay
    /// (a vessel in low orbit is sub-millisecond light-time, which is most of
    /// an early career), where the hold no longer pays for head-of-line
    /// blocking and an unreliable path would win; a future lane can carry that
    /// under a new byte while <see cref="LaneStreamBinary"/> keeps meaning
    /// exactly what it means today.</para>
    ///
    /// <para><b>Why a segment table rather than one opaque blob.</b> Batching
    /// is the point: the per-frame envelope, not the payload encoding, is what
    /// costs, and a producer that sends one 20 ms audio chunk per frame pays it
    /// fifty times a second. A frame therefore carries N segments, and the
    /// header says how long each one is. Core learns only "N runs of bytes, of
    /// these lengths"; it never learns what a segment MEANS. That keeps the
    /// lane codec-agnostic while leaving a batch readable by anything that can
    /// open a socket, which one undifferentiated blob would not: unpacking that
    /// would need the producing Uplink's private sub-framing.</para>
    /// </summary>
    public static class BinaryLane
    {
        /// <summary>
        /// First byte of every binary-lane frame. See the class remarks for why
        /// this value cannot be confused with the leading byte of a JSON frame.
        /// </summary>
        public const byte Magic = 0x9E;

        /// <summary>
        /// Second byte: WHICH binary lane. Today there is exactly one
        /// (<see cref="LaneStreamBinary"/>), and the byte exists so that a
        /// decoder meeting a lane it does not know REFUSES it by name instead
        /// of guessing. A frame is bytes; the one thing a decoder must never do
        /// with an unrecognised one is fall back to treating it as text.
        /// </summary>
        public const byte LaneStreamBinary = 0x01;

        /// <summary>Magic + lane + the two length bytes: the fixed part, before the JSON header.</summary>
        public const int PrefixBytes = 4;

        /// <summary>
        /// What the u16 length field can express. A header past this is a
        /// producer bug (the header holds a topic, a <see cref="Meta"/> and a
        /// length table, none of which is large), not a case to grow the field
        /// for, so the writer throws rather than truncating.
        /// </summary>
        public const int MaxHeaderBytes = 65535;

        /// <summary>
        /// Whether <paramref name="frame"/> leads with <see cref="Magic"/>, the
        /// only question either decode seam asks before it commits to a lane.
        /// A frame too short to hold a prefix is not one: it is answered
        /// <c>false</c> here and refused as malformed by the parse, rather than
        /// being read past its end.
        /// </summary>
        public static bool IsBinaryFrame(byte[] frame, int offset, int count)
        {
            if (frame is null)
            {
                return false;
            }

            return count >= 1 && frame[offset] == Magic;
        }
    }

    /// <summary>
    /// The JSON header of a <see cref="BinaryLane"/> frame: everything about
    /// the delivery except the bytes themselves.
    ///
    /// <para>Deliberately shaped as a sibling of <c>StreamData&lt;T&gt;</c>,
    /// carrying the SAME <see cref="Meta"/> unchanged, so a binary delivery is
    /// subject to the reveal gate, the vantage, the staleness verdict and the
    /// timeline epoch exactly as a JSON channel is: the Courier does not know
    /// which lane a payload will leave on, and nothing here lets a producer opt
    /// out of the delay. Where it differs is that the payload is not in the
    /// document. <see cref="Segments"/> is the length table for the bytes that
    /// follow the header.</para>
    ///
    /// <para><b>Absence discipline.</b> A frame whose segment lengths do not
    /// sum to exactly the bytes remaining after the header is UNREAD: a
    /// truncated or over-long frame is dropped with a named reason and never
    /// substituted by an empty payload, because a listener that is handed zero
    /// segments cannot tell "nobody transmitted" from "the frame arrived
    /// broken".</para>
    /// </summary>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class StreamBinary
    {
#if SITREP_CODEGEN
        [TsProperty(Type = "\"stream-binary\"")]
#endif
        [SitrepUnit(Units.Id)]
        public string Type { get; set; } = "stream-binary";

        [SitrepUnit(Units.Id)]
        public string Topic { get; set; } = "";

        /// <summary>
        /// Byte length of each segment, in the order they appear after the
        /// header. An EMPTY table is legal and means a delivery with no
        /// segments, which is a producer saying "nothing this frame" rather
        /// than a broken frame; it is distinguishable from a broken one
        /// precisely because the sum still matches.
        /// </summary>
        [SitrepUnit(Units.Count)]
        public int[] Segments { get; set; } = Array.Empty<int>();

        public Meta Meta { get; set; } = new();
    }
}
