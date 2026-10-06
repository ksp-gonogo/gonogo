using System;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    /// <summary>
    /// The framing for a channel whose payload is opaque bytes, such as audio,
    /// so it reaches a client without being encoded as JSON.
    ///
    /// <para>Every other server-to-client frame is a WebSocket binary frame
    /// carrying UTF-8 JSON, which always opens with <c>{</c> (0x7B). A
    /// binary-lane frame is the same kind of WebSocket frame with a different
    /// first byte, <see cref="Magic"/>, so a decoder checks that byte before
    /// decoding anything. The framing is four bytes, and everything descriptive
    /// is JSON, so the frame can be read off a socket with no Gonogo package
    /// installed.</para>
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
    /// <para>0x9E cannot lead a JSON frame: this protocol's JSON always leads
    /// with 0x7B, and 0x80 to 0xBF is the UTF-8 continuation range, which can
    /// never start a UTF-8 document.</para>
    ///
    /// <para>A frame carries any number of segments, and the header lists the
    /// length of each. What a segment means is up to the Uplink that sends it;
    /// the lane only delivers the bytes, in order. There is no sequencing,
    /// retransmit or loss concealment in the frame: it travels over the same
    /// reliable WebSocket as everything else.</para>
    /// <internal>
    /// Reliable delivery suits this lane because its payloads are held for
    /// light-time before they are revealed, typically 10 to 60 seconds, and a
    /// delay buffer is a jitter buffer: a retransmit costing tens of
    /// milliseconds is still early, so the listener gets the actual bytes where
    /// a media track would have concealed the drop. The regime it does not suit
    /// is near-zero delay (low orbit), where head-of-line blocking costs and an
    /// unreliable path would win; that would be a new lane byte, which is why
    /// the lane byte exists with only one lane. Segments exist for batching:
    /// the per-frame envelope is what costs, and one 20 ms audio chunk per frame
    /// pays it fifty times a second. A segment table rather than one blob keeps
    /// a batch readable without the producing Uplink's private sub-framing.
    /// </internal>
    /// </summary>
    /// <category>Serialization</category>
    public static class BinaryLane
    {
        /// <summary>
        /// First byte of every binary-lane frame, a byte that never leads a JSON
        /// frame.
        /// </summary>
        public const byte Magic = 0x9E;

        /// <summary>
        /// Second byte: which binary lane, and the only lane defined. A decoder that
        /// meets a lane byte it does not know refuses the frame, naming the
        /// byte, and never falls back to reading it as text.
        /// </summary>
        public const byte LaneStreamBinary = 0x01;

        /// <summary>Magic + lane + the two length bytes: the fixed part, before the JSON header.</summary>
        public const int PrefixBytes = 4;

        /// <summary>
        /// The longest JSON header the 16-bit length field can express. The
        /// writer throws for a longer header rather than truncating it; a header
        /// holds only a topic, a <see cref="Meta"/> and the length table, so
        /// reaching this means far too many segments in one frame.
        /// </summary>
        public const int MaxHeaderBytes = 65535;

        /// <summary>
        /// Whether <paramref name="frame"/> leads with <see cref="Magic"/>, which
        /// is all a decoder checks before treating it as a binary-lane frame.
        /// An empty or null frame returns <c>false</c>; a frame that leads with
        /// the magic byte but is too short to hold a prefix returns <c>true</c>
        /// here and is refused as malformed by the parse, rather than being read
        /// past its end.
        /// </summary>
        /// <param name="frame">The buffer holding the frame.</param>
        /// <param name="offset">Where the frame starts in <paramref name="frame"/>.</param>
        /// <param name="count">How many bytes the frame occupies.</param>
        /// <returns>True when the frame's first byte is <see cref="Magic"/>.</returns>
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
    /// <para>A sibling of <see cref="StreamData{T}"/>, carrying the SAME
    /// <see cref="Meta"/> unchanged, so a binary delivery is subject to the
    /// signal-delay reveal, the vantage and the timeline epoch exactly as a JSON
    /// channel is, and nothing here lets a producer opt out of the delay. Where
    /// it differs is that the payload is not in the document.
    /// <see cref="Segments"/> is the length table for the bytes that follow the
    /// header.</para>
    ///
    /// <para><b>Absence discipline.</b> A frame whose segment lengths do not
    /// sum to exactly the bytes remaining after the header is UNREAD: a
    /// truncated or over-long frame is dropped with a named reason and never
    /// substituted by an empty payload, because a listener that is handed zero
    /// segments cannot tell "nobody transmitted" from "the frame arrived
    /// broken".</para>
    /// </summary>
    /// <category>Stream messages</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class StreamBinary
    {
        /// <summary>The frame type, always <c>"stream-binary"</c>.</summary>
#if SITREP_CODEGEN
        [TsProperty(Type = "\"stream-binary\"")]
#endif
        [SitrepUnit(Units.Id)]
        public string Type { get; set; } = "stream-binary";

        /// <summary>The Topic id this delivery belongs to.</summary>
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

        /// <summary>When the payload was true, when it arrived, and where it was observed from, as on a <c>stream-data</c> frame.</summary>
        public Meta Meta { get; set; } = new();
    }
}
