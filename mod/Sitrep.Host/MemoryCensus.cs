using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace Sitrep.Host
{
    /// <summary>
    /// A periodic log line of the managed heap and the size of every long-lived
    /// collection the engine grows on its tick, so a memory climb can be told apart
    /// as managed or native and the collection that grows can be read by name. Off
    /// until <see cref="ReportIntervalSeconds"/> is set, so a player install counts
    /// and logs nothing; a tick then pays one field read.
    ///
    /// <para>Each line starts with <see cref="LogPrefix"/>, then <c>managed=</c> (bytes,
    /// <see cref="GC.GetTotalMemory(bool)"/> without a collection), <c>gen0=</c> (collections
    /// so far), and one <c>name=count</c> pair per counter in registration order.</para>
    /// </summary>
    public sealed class MemoryCensus
    {
        /// <summary>The text every census line starts with.</summary>
        public const string LogPrefix = "[gonogo-census]";

        private readonly object _gate = new object();
        private readonly List<KeyValuePair<string, Func<string>>> _counters = new List<KeyValuePair<string, Func<string>>>();
        private volatile bool _enabled;
        private double _reportIntervalSeconds;
        private long _lastReport;

        /// <summary>True while a report interval is set.</summary>
        public bool Enabled => _enabled;

        /// <summary>
        /// Real seconds between two lines. Zero or less turns the census off; a positive
        /// value turns it on, and the first line is written on the next tick.
        /// </summary>
        public double ReportIntervalSeconds
        {
            get
            {
                lock (_gate)
                {
                    return _reportIntervalSeconds;
                }
            }
            set
            {
                lock (_gate)
                {
                    _reportIntervalSeconds = value > 0 && !double.IsNaN(value) && !double.IsInfinity(value) ? value : 0;
                    _lastReport = 0;
                    _enabled = _reportIntervalSeconds > 0;
                }
            }
        }

        /// <summary>
        /// Adds a named count to every line. <paramref name="count"/> runs on the thread
        /// that calls <see cref="TryTakeReport"/>, so it must be safe to read there.
        /// </summary>
        public void Add(string name, Func<long> count)
        {
            if (count == null) throw new ArgumentNullException(nameof(count));
            Add(name, () => count().ToString(CultureInfo.InvariantCulture));
        }

        /// <summary>
        /// Adds a named fragment to every line, written as <c>name=</c> then the text, or
        /// the text alone when <paramref name="name"/> is empty (for a source that names
        /// its own counts). The same thread rule as the count overload applies.
        /// </summary>
        public void Add(string name, Func<string> text)
        {
            if (name == null) throw new ArgumentNullException(nameof(name));
            if (text == null) throw new ArgumentNullException(nameof(text));
            lock (_gate)
            {
                _counters.Add(new KeyValuePair<string, Func<string>>(name, text));
            }
        }

        /// <summary>
        /// The census line when one is due at <paramref name="stopwatchNow"/>
        /// (<see cref="Stopwatch.GetTimestamp"/>), or null. A counter that throws is
        /// written as <c>name=!</c> and the rest of the line still follows.
        /// </summary>
        public string? TryTakeReport(long stopwatchNow)
        {
            if (!_enabled)
            {
                return null;
            }
            KeyValuePair<string, Func<string>>[] counters;
            lock (_gate)
            {
                if (_lastReport != 0 && (stopwatchNow - _lastReport) / (double)Stopwatch.Frequency < _reportIntervalSeconds)
                {
                    return null;
                }
                _lastReport = stopwatchNow;
                counters = _counters.ToArray();
            }

            var line = new StringBuilder(LogPrefix);
            line.Append(" managed=").Append(GC.GetTotalMemory(false).ToString(CultureInfo.InvariantCulture));
            line.Append(" gen0=").Append(GC.CollectionCount(0).ToString(CultureInfo.InvariantCulture));
            foreach (var counter in counters)
            {
                line.Append(' ');
                if (counter.Key.Length > 0)
                {
                    line.Append(counter.Key).Append('=');
                }
                try
                {
                    line.Append(counter.Value());
                }
                catch (Exception)
                {
                    line.Append("!");
                }
            }
            return line.ToString();
        }
    }
}
