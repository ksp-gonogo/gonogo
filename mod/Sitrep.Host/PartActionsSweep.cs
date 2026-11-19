using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>
    /// Paces the walk of every subscribed part's window so that a vessel of
    /// hundreds of parts neither is read more than twice a second nor is read all
    /// in one tick: a sweep starts at most once per <c>minIntervalMs</c> over the
    /// ids subscribed at that moment, and each tick reads only as many of them as
    /// its caller's time allows, carrying on from where the last tick stopped.
    ///
    /// <para>The sweep holds the id list it started with, so the caller counts
    /// subscribed parts once per sweep rather than once per tick, and the cursor
    /// and the list can never be compared across different lists.</para>
    ///
    /// <para>A fresh subscription calls <see cref="Wake"/>, so the part someone
    /// just opened is read on the next tick instead of waiting out the interval.
    /// <see cref="Wake"/> runs on the Courier thread while the rest runs on the
    /// main thread, so the state is locked.</para>
    /// </summary>
    public sealed class PartActionsSweep
    {
        private readonly long _minIntervalMs;
        private readonly object _gate = new object();
        private List<string> _ids = new List<string>();
        private int _cursor;
        private long _startedMs = -1;
        private bool _active;

        public PartActionsSweep(long minIntervalMs)
        {
            _minIntervalMs = minIntervalMs;
        }

        /// <summary>True while a sweep still has parts to read.</summary>
        public bool Active
        {
            get { lock (_gate) { return _active; } }
        }

        /// <summary>True when no sweep is running and the interval since the last one began has passed.</summary>
        public bool Due(long nowMs)
        {
            lock (_gate)
            {
                return !_active && (_startedMs < 0 || nowMs - _startedMs >= _minIntervalMs);
            }
        }

        /// <summary>Begins a sweep over <paramref name="ids"/>. An empty list is a sweep with nothing to read, which still waits out the interval.</summary>
        public void Start(List<string> ids, long nowMs)
        {
            lock (_gate)
            {
                _ids = ids;
                _cursor = 0;
                _startedMs = nowMs;
                _active = ids.Count > 0;
            }
        }

        /// <summary>Every id the current sweep covers, read or not.</summary>
        public List<string> Ids
        {
            get { lock (_gate) { return _ids; } }
        }

        /// <summary>The ids this sweep has not read yet, in order.</summary>
        public List<string> Remaining()
        {
            lock (_gate)
            {
                return _ids.GetRange(_cursor, _ids.Count - _cursor);
            }
        }

        /// <summary>Records that the next <paramref name="read"/> ids were read; the sweep ends when all have been.</summary>
        public void Advance(int read)
        {
            lock (_gate)
            {
                _cursor += read;
                if (_cursor >= _ids.Count)
                {
                    _active = false;
                }
            }
        }

        /// <summary>Starts a sweep on the next tick whatever the interval.</summary>
        public void Wake()
        {
            lock (_gate)
            {
                _active = false;
                _startedMs = -1;
            }
        }
    }
}
