using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Sitrep.Host
{
    /// <summary>
    /// An <see cref="IKspHost"/> that replays a previously-captured
    /// <see cref="RecordedSession"/> instead of talking to a live game —
    /// the headless counterpart to <c>Gonogo.KSP</c>'s in-game <c>KspHost</c>
    /// (Task 4). A real capture can contain a UT rewind (an F9 quickload
    /// fires a <c>game-state-load</c> event, then resumes recording from the
    /// loaded save's earlier UT) — <see cref="Step"/> is the driver safe for
    /// that: it consumes the recording in capture order regardless of
    /// whether <c>T</c> goes forward or backward. <see cref="AdvanceTo"/>
    /// remains for curated/test-fixture use where the caller already knows
    /// the exact (monotonic) UTs to target; see its own doc comment for why
    /// it must not be used to drive a live replay.
    /// </summary>
    public sealed class ReplayKspHost : IKspHost
    {
        private readonly List<RecordedEntry> _entries;
        private double _currentUt;
        private int _cursor;
        private RecordedSnapshotPayload? _latestSnapshot;

        public ReplayKspHost(RecordedSession session)
        {
            if (session == null)
            {
                throw new ArgumentNullException(nameof(session));
            }
            _entries = session.Entries;
            _currentUt = session.StartUt;
        }

        /// <summary>Loads a <see cref="RecordedSession"/> from a file written by <see cref="Recorder.Save"/> and constructs a replay host from it.</summary>
        public static ReplayKspHost LoadFromFile(string path)
        {
            var json = Encoding.UTF8.GetString(File.ReadAllBytes(path));
            return new ReplayKspHost(RecordedSessionCodec.Parse(json));
        }

        public double NowUt() => _currentUt;

        public event Action<KspLifecycleEvent> Lifecycle = delegate { };

        /// <summary>
        /// The most recently recorded snapshot with <c>T &lt;= NowUt()</c>,
        /// or an empty snapshot if <see cref="AdvanceTo"/> hasn't reached the
        /// first recorded snapshot yet.
        /// </summary>
        public KspSnapshot Sample()
        {
            var values = _latestSnapshot != null
                ? new Dictionary<string, object?>(_latestSnapshot.Values)
                : new Dictionary<string, object?>();
            return new KspSnapshot { Ut = _currentUt, Values = values };
        }

        /// <summary>
        /// Advances replay time to <paramref name="ut"/>, firing every
        /// not-yet-fired <see cref="Lifecycle"/> event whose recorded
        /// <c>T &lt;= ut</c> — in recorded (timeline) order, each exactly
        /// once — and updating what <see cref="Sample"/> returns to the
        /// latest snapshot entry with <c>T &lt;= ut</c>.
        ///
        /// <para>
        /// UNSAFE for driving a live replay of a recording that may contain
        /// a UT rewind (e.g. a <c>game-state-load</c> quickload): this
        /// method compares each entry's <c>T</c> against the caller's
        /// monotonically-increasing target, so once <paramref name="ut"/>
        /// has passed the pre-rewind peak, the next call silently swallows
        /// every post-rewind entry in one gulp instead of pacing through
        /// them. Only call this with UTs the caller controls exactly (e.g.
        /// a curated test fixture that never rewinds). For driving replay of
        /// an arbitrary/real recording, use <see cref="Step"/> instead — it
        /// never compares two entries' <c>T</c> against each other or a
        /// target and is correct-by-construction for any ordering.
        /// </para>
        /// </summary>
        public void AdvanceTo(double ut)
        {
            while (_cursor < _entries.Count && _entries[_cursor].T <= ut)
            {
                var entry = _entries[_cursor];
                _cursor++;

                if (entry.Kind == "snapshot" && entry.Snapshot != null)
                {
                    _latestSnapshot = entry.Snapshot;
                }
                else if (entry.Kind == "event" && entry.Event != null)
                {
                    Lifecycle.Invoke(new KspLifecycleEvent
                    {
                        Ut = entry.T,
                        Kind = entry.Event.EventKind,
                        Args = new Dictionary<string, object?>(entry.Event.Args),
                    });
                }
            }

            _currentUt = ut;
        }

        /// <summary>
        /// Consumes exactly the next entry in capture order, whatever its
        /// <c>T</c> — including a <c>T</c> that rewinds backward relative to
        /// everything replayed so far, as a real recording's
        /// post-quickload entries do. Sets <see cref="NowUt"/> to the
        /// consumed entry's own <c>T</c>, updates the current snapshot or
        /// fires <see cref="Lifecycle"/> as appropriate, and never compares
        /// the entry's <c>T</c> against anything — so it is
        /// correct-by-construction for any ordering the recording contains.
        /// This is the driver to use for a live replay of a real capture;
        /// see <see cref="AdvanceTo"/> for why it is not.
        /// </summary>
        /// <returns><c>false</c> when there are no more entries to consume (replay is finished).</returns>
        public bool Step()
        {
            if (_cursor >= _entries.Count)
            {
                return false;
            }

            var entry = _entries[_cursor];
            _cursor++;
            _currentUt = entry.T;

            if (entry.Kind == "snapshot" && entry.Snapshot != null)
            {
                _latestSnapshot = entry.Snapshot;
            }
            else if (entry.Kind == "event" && entry.Event != null)
            {
                Lifecycle.Invoke(new KspLifecycleEvent
                {
                    Ut = entry.T,
                    Kind = entry.Event.EventKind,
                    Args = new Dictionary<string, object?>(entry.Event.Args),
                });
            }

            return true;
        }
    }
}
