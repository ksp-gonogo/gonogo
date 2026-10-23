using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// The science transmissions vessels have sent, each kept with the vessel that sent it: those still being sent,
    /// and the last <see cref="Capacity"/> that have finished. A transmission is
    /// expected when it starts and arrives once the game's clock has passed the
    /// moment its last packet leaves; only an arrived one is on the wire.
    ///
    /// <para>Threading: every member locks, because a command records from the game
    /// thread and the channel releases from the courier thread.</para>
    /// </summary>
    public sealed class ScienceTransmissionLog
    {
        public const int Capacity = 20;

        public const double SameStartSeconds = 2.0;

        private readonly object _gate = new object();
        private readonly List<Entry> _pending = new List<Entry>();
        private readonly List<Entry> _arrived = new List<Entry>();

        /// <summary>Notes a transmission that will have fully left the vessel at <paramref name="completedAt"/>.</summary>
        public void Expect(string vesselId, string? subjectId, string? title, double? mits, double? startedAt, double completedAt)
        {
            lock (_gate)
            {
                _pending.Add(new Entry(vesselId, subjectId, title, mits, startedAt, completedAt));
            }
        }

        /// <summary>
        /// Notes a transmission seen finishing by watching the transmitter. One a command already
        /// recorded, with the same subject starting within <see cref="SameStartSeconds"/>, is left
        /// as the command recorded it, which knew its own length.
        /// </summary>
        public void ExpectObserved(string vesselId, string? subjectId, string? title, double? mits, double startedAt, double completedAt)
        {
            lock (_gate)
            {
                if (_pending.Concat(_arrived).Any(e => e.VesselId == vesselId && e.SubjectId == subjectId
                    && e.StartedAt is double known && Math.Abs(known - startedAt) <= SameStartSeconds))
                {
                    return;
                }
                _pending.Add(new Entry(vesselId, subjectId, title, mits, startedAt, completedAt));
            }
        }

        /// <summary>
        /// Takes back a transmission that was expected and then given up: the transmitter was told
        /// to abort, or the result came back aboard. True when one was taken back, including one
        /// that had already arrived, so the caller republishes the list without it.
        /// </summary>
        public bool Cancel(string vesselId, string? subjectId, double startedAt)
        {
            lock (_gate)
            {
                Predicate<Entry> given = e => e.VesselId == vesselId && e.SubjectId == subjectId
                    && e.StartedAt is double known && Math.Abs(known - startedAt) <= SameStartSeconds;
                var fromPending = _pending.RemoveAll(given) > 0;
                var fromArrived = _arrived.RemoveAll(given) > 0;
                return fromPending || fromArrived;
            }
        }

        /// <summary>
        /// Moves every transmission whose last packet has left by <paramref name="ut"/> from
        /// sending to arrived. Returns the moment the newest of them finished, or null when
        /// none moved, so the caller publishes only on a change and stamps it then.
        /// </summary>
        public double? Release(double ut)
        {
            lock (_gate)
            {
                var due = _pending.Where(e => e.CompletedAt <= ut).OrderBy(e => e.CompletedAt).ToList();
                if (due.Count == 0)
                {
                    return null;
                }
                _pending.RemoveAll(e => e.CompletedAt <= ut);
                _arrived.AddRange(due);
                if (_arrived.Count > Capacity)
                {
                    _arrived.RemoveRange(0, _arrived.Count - Capacity);
                }
                return due[due.Count - 1].CompletedAt;
            }
        }

        /// <summary>The wire payload: the transmissions <paramref name="vesselId"/> has sent that have arrived, oldest first, or null when none has.</summary>
        public List<Dictionary<string, object?>>? ToWire(string vesselId)
        {
            lock (_gate)
            {
                var mine = _arrived.Where(e => e.VesselId == vesselId).ToList();
                if (mine.Count == 0)
                {
                    return null;
                }
                return mine.Select(e => ToWire(new ScienceArrival
                {
                    SubjectId = e.SubjectId,
                    Title = e.Title,
                    DataAmount = e.Mits,
                    StartedAt = e.StartedAt,
                    CompletedAt = e.CompletedAt,
                })).ToList();
            }
        }

        private static Dictionary<string, object?> ToWire(ScienceArrival arrival) => new Dictionary<string, object?>
        {
            ["subjectId"] = arrival.SubjectId,
            ["title"] = arrival.Title,
            ["dataAmount"] = arrival.DataAmount,
            ["startedAt"] = arrival.StartedAt,
            ["completedAt"] = arrival.CompletedAt,
        };

        private readonly struct Entry
        {
            public Entry(string vesselId, string? subjectId, string? title, double? mits, double? startedAt, double completedAt)
            {
                VesselId = vesselId;
                SubjectId = subjectId;
                Title = title;
                Mits = mits;
                StartedAt = startedAt;
                CompletedAt = completedAt;
            }

            public string VesselId { get; }
            public string? SubjectId { get; }
            public string? Title { get; }
            public double? Mits { get; }
            public double? StartedAt { get; }
            public double CompletedAt { get; }
        }
    }
}
