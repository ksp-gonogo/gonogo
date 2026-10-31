using System;
using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>What reading one craft file gave: its part rows, or the reason it gave none.</summary>
    internal readonly struct CraftRead
    {
        private CraftRead(List<object?>? rows, string? failure)
        {
            Rows = rows;
            Failure = failure;
        }

        public List<object?>? Rows { get; }

        public string? Failure { get; }

        public static CraftRead Of(List<object?> rows) => new CraftRead(rows, null);

        public static CraftRead Failed(string failure) => new CraftRead(null, failure);
    }

    /// <summary>
    /// The craft files already read, by path and file version. A read that gave
    /// rows is reused for as long as the file is unchanged. A read that failed is
    /// reused only until its retry time, so a file that was briefly unreadable is
    /// read again without being saved, and a file that never reads is tried once
    /// every <c>retrySeconds</c> rather than every tick.
    /// </summary>
    internal sealed class CraftReadCache
    {
        private readonly double _retrySeconds;
        private readonly Dictionary<string, Entry> _entries = new Dictionary<string, Entry>(StringComparer.Ordinal);

        public CraftReadCache(double retrySeconds)
        {
            _retrySeconds = retrySeconds;
        }

        /// <summary>
        /// True when <paramref name="read"/> still answers for the file: rows that
        /// came from this version of it, or a failure that has not yet waited out
        /// its retry time. False when the file must be read now.
        /// </summary>
        public bool TryGet(string path, long modified, double now, out CraftRead read)
        {
            if (_entries.TryGetValue(path, out var entry)
                && entry.Modified == modified
                && (entry.Read.Rows != null || now < entry.RetryAt))
            {
                read = entry.Read;
                return true;
            }

            read = default;
            return false;
        }

        /// <summary>
        /// Keeps a fresh read. True when it is a failure that should be reported:
        /// the first for this file version, or one for a different reason than the
        /// failure before it.
        /// </summary>
        public bool Store(string path, long modified, double now, CraftRead read)
        {
            var repeated = _entries.TryGetValue(path, out var prior)
                && prior.Modified == modified
                && prior.Read.Rows == null
                && prior.Read.Failure == read.Failure;
            _entries[path] = new Entry(modified, read, now + _retrySeconds);
            return read.Rows == null && !repeated;
        }

        public void Clear()
        {
            _entries.Clear();
        }

        private readonly struct Entry
        {
            public Entry(long modified, CraftRead read, double retryAt)
            {
                Modified = modified;
                Read = read;
                RetryAt = retryAt;
            }

            public long Modified { get; }

            public CraftRead Read { get; }

            public double RetryAt { get; }
        }
    }
}
