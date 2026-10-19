using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Text;

namespace Sitrep.Host
{
    /// <summary>
    /// Per-topic cost of publishing, windowed and reported as log lines: how many
    /// payloads were built and emitted, how many frames and bytes went to
    /// subscribers, and the real time spent building each payload and serialising
    /// each frame. Off until <see cref="ReportIntervalSeconds"/> is set, so a player
    /// install records and logs nothing.
    ///
    /// <para>A frame is counted once per subscribed connection, after it is
    /// serialised and before it reaches the connection's outbox, so bytes are what
    /// the engine asks the sockets to carry, not what a slow socket managed to
    /// drain.</para>
    ///
    /// <para>Every line starts with <see cref="LogPrefix"/> so one search finds a
    /// whole run.</para>
    /// </summary>
    public sealed class TopicPublishStats
    {
        /// <summary>The text every report line starts with.</summary>
        public const string LogPrefix = "[gonogo-cadence]";

        private readonly object _gate = new object();
        private readonly Dictionary<string, Window> _topics = new Dictionary<string, Window>(StringComparer.Ordinal);
        private long _windowStart;
        private volatile bool _enabled;
        private double _reportIntervalSeconds;

        /// <summary>True while a report interval is set: call sites skip their stopwatch reads otherwise.</summary>
        public bool Enabled => _enabled;

        /// <summary>
        /// Real seconds between two reports. Zero or less turns recording off and
        /// drops what has gathered; a positive value turns it on and starts a fresh window.
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
                    _topics.Clear();
                    _windowStart = Stopwatch.GetTimestamp();
                    _enabled = _reportIntervalSeconds > 0;
                }
            }
        }

        /// <summary>One payload built by the topic's mapper, taking <paramref name="stopwatchTicks"/>.</summary>
        public void RecordBuild(string topic, long stopwatchTicks)
        {
            if (!_enabled)
            {
                return;
            }
            lock (_gate)
            {
                var window = WindowFor(topic);
                window.Builds++;
                window.BuildTicks += stopwatchTicks;
            }
        }

        /// <summary>One built payload that the change gate let through to the Courier.</summary>
        public void RecordEmit(string topic)
        {
            if (!_enabled)
            {
                return;
            }
            lock (_gate)
            {
                WindowFor(topic).Emits++;
            }
        }

        /// <summary>One frame of <paramref name="bytes"/> handed to a connection's outbox, serialised in <paramref name="serializeTicks"/>.</summary>
        public void RecordFrame(string topic, int bytes, long serializeTicks)
        {
            if (!_enabled)
            {
                return;
            }
            lock (_gate)
            {
                var window = WindowFor(topic);
                window.Frames++;
                window.Bytes += bytes;
                window.SerializeTicks += serializeTicks;
            }
        }

        /// <summary>
        /// The report lines for the window that has just closed, or null while the
        /// interval has not elapsed or recording is off. Taking a report starts the
        /// next window. <paramref name="rates"/> is the overrides in force, printed on
        /// the header line so each window says what it measured.
        /// </summary>
        public string[]? TryTakeReport(long nowTimestamp, string rates)
        {
            lock (_gate)
            {
                if (!_enabled)
                {
                    return null;
                }

                var seconds = (nowTimestamp - _windowStart) / (double)Stopwatch.Frequency;
                if (seconds < _reportIntervalSeconds)
                {
                    return null;
                }

                var lines = new List<string>
                {
                    LogPrefix + " window " + Format(seconds, "0.0") + " s, topic rates: " + rates,
                };
                foreach (var pair in _topics.OrderByDescending(p => p.Value.Bytes).ThenBy(p => p.Key, StringComparer.Ordinal))
                {
                    lines.Add(Line(pair.Key, pair.Value, seconds));
                }
                if (_topics.Count == 0)
                {
                    lines.Add(LogPrefix + " nothing published in the window");
                }

                _topics.Clear();
                _windowStart = nowTimestamp;
                return lines.ToArray();
            }
        }

        private static string Line(string topic, Window w, double seconds)
        {
            var sb = new StringBuilder(LogPrefix);
            sb.Append(' ').Append(topic).Append(": ");
            sb.Append("built ").Append(w.Builds).Append(" (").Append(Format(PerSecond(w.Builds, seconds), "0.0")).Append("/s, ");
            sb.Append(Format(Ms(w.BuildTicks), "0.00")).Append(" ms total, ");
            sb.Append(Format(w.Builds == 0 ? 0 : Ms(w.BuildTicks) / w.Builds, "0.000")).Append(" ms each), ");
            sb.Append("emitted ").Append(w.Emits).Append(" (").Append(Format(PerSecond(w.Emits, seconds), "0.0")).Append("/s), ");
            sb.Append("frames ").Append(w.Frames).Append(" (").Append(Format(PerSecond(w.Frames, seconds), "0.0")).Append("/s), ");
            sb.Append(Format(w.Bytes / seconds / 1024.0, "0.0")).Append(" KB/s, ");
            sb.Append("serialise ").Append(Format(Ms(w.SerializeTicks), "0.00")).Append(" ms total");
            return sb.ToString();
        }

        private static double PerSecond(long count, double seconds) => count / seconds;

        private static double Ms(long ticks) => ticks * 1000.0 / Stopwatch.Frequency;

        private static string Format(double value, string format) => value.ToString(format, CultureInfo.InvariantCulture);

        private Window WindowFor(string topic)
        {
            if (!_topics.TryGetValue(topic, out var window))
            {
                window = new Window();
                _topics[topic] = window;
            }
            return window;
        }

        private sealed class Window
        {
            public long Builds;
            public long BuildTicks;
            public long Emits;
            public long Frames;
            public long Bytes;
            public long SerializeTicks;
        }
    }
}
