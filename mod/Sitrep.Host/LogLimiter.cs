using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace Sitrep.Host
{
    /// <summary>
    /// Decides which occurrences of a repeating fault reach the log: the first
    /// one in full, then at most one per interval carrying how many were held
    /// back. Used by the host and the KSP plugin to keep a persistent
    /// per-tick fault from filling KSP.log.
    /// </summary>
    public sealed class LogLimiter
    {
        /// <summary>Seconds between lines for one key unless the constructor says otherwise.</summary>
        public const double DefaultIntervalSeconds = 60;

        private sealed class Entry
        {
            public double LastLoggedAt;
            public int Held;
        }

        private readonly Func<double> _nowSeconds;
        private readonly double _intervalSeconds;
        private readonly Dictionary<string, Entry> _entries = new Dictionary<string, Entry>();

        /// <param name="nowSeconds">Monotonic clock in seconds; defaults to a stopwatch.</param>
        /// <param name="intervalSeconds">Minimum seconds between two logged occurrences of one key.</param>
        public LogLimiter(Func<double> nowSeconds = null, double intervalSeconds = DefaultIntervalSeconds)
        {
            _nowSeconds = nowSeconds ?? StopwatchSeconds;
            _intervalSeconds = intervalSeconds;
        }

        /// <summary>
        /// True when this occurrence of <paramref name="key"/> should be logged.
        /// <paramref name="held"/> is how many occurrences since the last logged
        /// one were not: 0 for the first occurrence of a key.
        /// </summary>
        public bool ShouldLog(string key, out int held)
        {
            double now = _nowSeconds();
            lock (_entries)
            {
                if (!_entries.TryGetValue(key, out Entry entry))
                {
                    _entries[key] = new Entry { LastLoggedAt = now };
                    held = 0;
                    return true;
                }

                if (now - entry.LastLoggedAt >= _intervalSeconds)
                {
                    held = entry.Held;
                    entry.Held = 0;
                    entry.LastLoggedAt = now;
                    return true;
                }

                entry.Held++;
                held = 0;
                return false;
            }
        }

        /// <summary>
        /// The line to print for a logged occurrence: the message as given the
        /// first time, then the message followed by how many occurrences the
        /// interval swallowed.
        /// </summary>
        public static string Compose(string message, int held)
        {
            return held == 0
                ? message
                : message + " (" + held + " more since the last line)";
        }

        private static readonly Stopwatch Clock = Stopwatch.StartNew();

        private static double StopwatchSeconds()
        {
            return Clock.Elapsed.TotalSeconds;
        }
    }
}
