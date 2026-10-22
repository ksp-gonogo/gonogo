using System;
using System.Collections.Generic;
using System.Linq;

namespace Sitrep.Host.Science
{
    /// <summary>One result waiting in a transmitter's queue, or being sent from it.</summary>
    public sealed class QueuedData
    {
        public QueuedData(object identity, string? subjectId, string? title, double? mits)
        {
            Identity = identity;
            SubjectId = subjectId;
            Title = title;
            Mits = mits;
        }

        /// <summary>What tells this result from another across polls: the game's own object for it.</summary>
        public object Identity { get; }

        public string? SubjectId { get; }
        public string? Title { get; }
        public double? Mits { get; }
    }

    /// <summary>What one transmitter showed on one poll.</summary>
    public sealed class TransmitterReading
    {
        public TransmitterReading(string id, bool busy, bool aborted, IReadOnlyList<QueuedData> queue)
        {
            Id = id;
            Busy = busy;
            Aborted = aborted;
            Queue = queue;
        }

        public string Id { get; }

        /// <summary>The transmitter is sending, or holding a queue it is about to send.</summary>
        public bool Busy { get; }

        /// <summary>The transmitter has been told to abandon what it is sending.</summary>
        public bool Aborted { get; }

        /// <summary>The results waiting behind the one being sent. The one being sent has already left it.</summary>
        public IReadOnlyList<QueuedData> Queue { get; }
    }

    /// <summary>A result a transmitter finished sending, as the polls saw it.</summary>
    public sealed class FinishedTransmission
    {
        public FinishedTransmission(string? subjectId, string? title, double? mits, double startedAt, double completedAt)
        {
            SubjectId = subjectId;
            Title = title;
            Mits = mits;
            StartedAt = startedAt;
            CompletedAt = completedAt;
        }

        public string? SubjectId { get; }
        public string? Title { get; }
        public double? Mits { get; }
        public double StartedAt { get; }
        public double CompletedAt { get; }
    }

    /// <summary>
    /// Works out from repeated looks at transmitters when each result they send has left the
    /// craft. A transmitter going busy starts a run; the result at the front of its queue is
    /// taken out to be sent, so the run's current result finishes when the next one is taken
    /// out, or when the transmitter goes idle.
    ///
    /// <para>A run in which the transmitter was told to abort sends nothing more, and a result
    /// that is back aboard when the transmitter goes idle was never sent: neither is reported.
    /// A transmission is reported no earlier than the poll that sees it end, so a result is
    /// never claimed to have arrived before it has.</para>
    ///
    /// <para>Threading: not thread safe; the caller polls from one thread.</para>
    /// </summary>
    public sealed class TransmitterWatch
    {
        private readonly Dictionary<string, Run> _runs = new Dictionary<string, Run>(StringComparer.Ordinal);

        /// <summary>Whether any transmitter is being followed through a transmission. Safe to read from another thread.</summary>
        public bool HasRuns => _hasRuns;

        private volatile bool _hasRuns;

        /// <summary>
        /// Takes one poll of every transmitter that exists now and returns the transmissions it
        /// shows finishing. <paramref name="heldAboard"/> is what the craft is holding unsent:
        /// a result in it was returned by an abandoned transmission.
        /// </summary>
        public IReadOnlyList<FinishedTransmission> Observe(
            IReadOnlyList<TransmitterReading> readings,
            IReadOnlyCollection<QueuedData> heldAboard,
            double ut)
        {
            var finished = new List<FinishedTransmission>();
            foreach (var gone in _runs.Keys.Where(id => readings.All(r => r.Id != id)).ToList())
            {
                _runs.Remove(gone);
            }

            foreach (var reading in readings)
            {
                _runs.TryGetValue(reading.Id, out var run);
                if (!reading.Busy)
                {
                    if (run != null)
                    {
                        _runs.Remove(reading.Id);
                        if (!run.Aborted && run.Current != null && !IsAboard(run.Current, heldAboard))
                        {
                            finished.Add(Finish(run.Current, run.StartedAt, ut));
                        }
                    }
                    continue;
                }

                if (run == null)
                {
                    run = new Run(ut);
                    _runs[reading.Id] = run;
                }

                run.Aborted |= reading.Aborted;
                var queued = new HashSet<object>(reading.Queue.Select(q => q.Identity));
                foreach (var taken in run.Waiting.Where(w => !queued.Contains(w.Identity)).ToList())
                {
                    if (run.Current != null && !run.Aborted && !IsAboard(run.Current, heldAboard))
                    {
                        finished.Add(Finish(run.Current, run.StartedAt, ut));
                    }
                    run.Current = taken;
                }
                run.Waiting = reading.Queue.ToList();
                // Nothing queued and nothing taken out in view: a result was taken out before the first look, and its title was never seen.
                if (run.Current == null && run.Waiting.Count == 0)
                {
                    run.Current = new QueuedData(new object(), null, null, null);
                }
            }

            _hasRuns = _runs.Count > 0;
            return finished;
        }

        private static FinishedTransmission Finish(QueuedData data, double startedAt, double completedAt) =>
            new FinishedTransmission(data.SubjectId, data.Title, data.Mits, startedAt, completedAt);

        private static bool IsAboard(QueuedData data, IReadOnlyCollection<QueuedData> heldAboard) =>
            data.SubjectId != null
            && heldAboard.Any(h => h.SubjectId == data.SubjectId
                && (data.Mits == null || h.Mits == null || Math.Abs(h.Mits.Value - data.Mits.Value) < 0.001));

        private sealed class Run
        {
            public Run(double startedAt)
            {
                StartedAt = startedAt;
            }

            public double StartedAt { get; }
            public bool Aborted { get; set; }
            public QueuedData? Current { get; set; }
            public List<QueuedData> Waiting { get; set; } = new List<QueuedData>();
        }
    }
}
