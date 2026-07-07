using System;
using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>
    /// The full recorded timeline for one capture session — what Task 2's
    /// <c>Recorder</c> writes to a file and <c>ReplayKspHost</c> reads back.
    /// Raw and additive by design (see the M5b plan's record-format spec): a
    /// new provider just adds keys to a snapshot's
    /// <see cref="RecordedSnapshotPayload.Values"/> (or an event's
    /// <see cref="RecordedEventPayload.Args"/>); the replay side never needs
    /// to understand them, only carry them in order.
    ///
    /// Plain POCOs all the way down (no delegates, no reference-type fields
    /// other than nested POCOs/collections) so Task 2's hand-rolled
    /// <c>Sitrep.Core.Serialization.JsonWriter</c> (already zero-external-dep
    /// — see <c>NanPolicy</c>) can walk this shape directly, with no external
    /// JSON library needed in Sitrep.Host.
    /// </summary>
    public sealed class RecordedSession
    {
        public int SchemaVersion { get; set; }

        /// <summary>UT at the start of the capture. Entries' <see cref="RecordedEntry.T"/> is an absolute UT, not an offset from this.</summary>
        public double StartUt { get; set; }

        /// <summary>Ordered timeline: snapshots and lifecycle events, interleaved exactly as they were captured.</summary>
        public List<RecordedEntry> Entries { get; set; } = new List<RecordedEntry>();
    }

    /// <summary>
    /// One timeline entry. <see cref="Kind"/> is <c>"snapshot"</c> or
    /// <c>"event"</c>; exactly one of <see cref="Snapshot"/> /
    /// <see cref="Event"/> is populated, matching <see cref="Kind"/>. Two
    /// nullable payload slots (rather than a single polymorphic
    /// <c>object? Payload</c> field) keep every field statically typed and
    /// plainly serializable without needing a discriminated-union writer —
    /// Task 2's writer just checks <see cref="Kind"/> and appends whichever
    /// slot is non-null.
    /// </summary>
    public sealed class RecordedEntry
    {
        /// <summary>UT this entry was captured at.</summary>
        public double T { get; set; }

        /// <summary><c>"snapshot"</c> | <c>"event"</c>.</summary>
        public string Kind { get; set; } = "";

        /// <summary>
        /// Recorder provenance: the REAL wall-clock instant (UTC) this entry
        /// was captured at, alongside the in-game <see cref="T"/> (UT).
        /// Wall-clock is fine to stamp here specifically because
        /// <see cref="Recorder"/> is the runtime edge (see its doc comment) -
        /// this is never reconstructed or derived post-hoc, only ever set
        /// once, at capture time. Useful for correlating a recording against
        /// out-of-band evidence (screen recording, Axiom logs, a user's own
        /// account of "what happened") that only has wall-clock timestamps,
        /// since UT alone can't be mapped back to a real-world moment once
        /// warp/pause have been in play.
        /// </summary>
        public DateTime WallClockUtc { get; set; }

        /// <summary>
        /// Recorder provenance: a monotonically increasing counter, one per
        /// <see cref="RecordedEntry"/>, assigned by <see cref="Recorder"/> in
        /// capture order (snapshots and events share one counter - it is NOT
        /// per-kind). Redundant with the entry's position in
        /// <see cref="RecordedSession.Entries"/> today, but self-describing:
        /// a future consumer that filters, reorders, or partially transmits
        /// entries can still detect gaps/duplicates without needing to trust
        /// list order.
        /// </summary>
        public long Seq { get; set; }

        /// <summary>Set when <see cref="Kind"/> == <c>"snapshot"</c>: the <see cref="IKspHost.Sample"/> values captured at <see cref="T"/>.</summary>
        public RecordedSnapshotPayload? Snapshot { get; set; }

        /// <summary>Set when <see cref="Kind"/> == <c>"event"</c>: the <see cref="IKspHost.Lifecycle"/> event captured at <see cref="T"/>.</summary>
        public RecordedEventPayload? Event { get; set; }
    }

    /// <summary>A captured <see cref="KspSnapshot"/>, minus <c>Ut</c> (carried by the owning <see cref="RecordedEntry.T"/> instead).</summary>
    public sealed class RecordedSnapshotPayload
    {
        public Dictionary<string, object?> Values { get; set; } = new Dictionary<string, object?>();
    }

    /// <summary>A captured <see cref="KspLifecycleEvent"/>, minus <c>Ut</c> (carried by the owning <see cref="RecordedEntry.T"/> instead).</summary>
    public sealed class RecordedEventPayload
    {
        public string EventKind { get; set; } = "";

        public Dictionary<string, object?> Args { get; set; } = new Dictionary<string, object?>();
    }
}
