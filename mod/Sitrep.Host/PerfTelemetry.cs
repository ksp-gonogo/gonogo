using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Text;

namespace Sitrep.Host
{
    /// <summary>One phase's figures for the interval that has just closed, in milliseconds.</summary>
    public readonly struct PhaseSample
    {
        public PhaseSample(string name, double emaMs, double latestMs, double intervalMaxMs, double intervalTotalMs, int count)
        {
            Name = name;
            EmaMs = emaMs;
            LatestMs = latestMs;
            IntervalMaxMs = intervalMaxMs;
            IntervalTotalMs = intervalTotalMs;
            Count = count;
        }

        public string Name { get; }

        /// <summary>Exponential moving average of every recording since the phase was first seen.</summary>
        public double EmaMs { get; }

        /// <summary>The most recent recording, kept across intervals.</summary>
        public double LatestMs { get; }

        /// <summary>The longest recording in the interval, zero when none was made.</summary>
        public double IntervalMaxMs { get; }

        public double IntervalTotalMs { get; }

        /// <summary>Recordings made in the interval.</summary>
        public int Count { get; }
    }

    /// <summary>
    /// Per-phase milliseconds as an exponential moving average, the latest
    /// recording and the interval maximum, which resets each time
    /// <see cref="TakeInterval"/> is called.
    /// </summary>
    public sealed class PhaseTimings
    {
        private const double EmaAlpha = 0.1;

        private readonly object _gate = new object();
        private readonly Dictionary<string, Stat> _phases = new Dictionary<string, Stat>(StringComparer.Ordinal);

        public void Record(string phase, double ms)
        {
            lock (_gate)
            {
                if (!_phases.TryGetValue(phase, out var stat))
                {
                    stat = new Stat { Ema = ms };
                    _phases[phase] = stat;
                }
                else
                {
                    stat.Ema += EmaAlpha * (ms - stat.Ema);
                }
                stat.Latest = ms;
                stat.Max = Math.Max(stat.Max, ms);
                stat.Total += ms;
                stat.Count++;
            }
        }

        /// <summary>Every phase seen so far, by name, and the start of the next interval.</summary>
        public PhaseSample[] TakeInterval()
        {
            lock (_gate)
            {
                var taken = _phases
                    .OrderBy(p => p.Key, StringComparer.Ordinal)
                    .Select(p => new PhaseSample(p.Key, p.Value.Ema, p.Value.Latest, p.Value.Max, p.Value.Total, p.Value.Count))
                    .ToArray();
                foreach (var stat in _phases.Values)
                {
                    stat.Max = 0;
                    stat.Total = 0;
                    stat.Count = 0;
                }
                return taken;
            }
        }

        public void Clear()
        {
            lock (_gate)
            {
                _phases.Clear();
            }
        }

        private sealed class Stat
        {
            public double Ema;
            public double Latest;
            public double Max;
            public double Total;
            public int Count;
        }
    }

    /// <summary>Bytes handed to subscribers per topic, turned into a rate when an interval is taken.</summary>
    public sealed class TopicByteCounter
    {
        private readonly object _gate = new object();
        private readonly Dictionary<string, long> _bytes = new Dictionary<string, long>(StringComparer.Ordinal);

        public void Add(string topic, int bytes)
        {
            lock (_gate)
            {
                _bytes.TryGetValue(topic, out var held);
                _bytes[topic] = held + bytes;
            }
        }

        /// <summary>Bytes per second for each topic over <paramref name="seconds"/>, by topic, and the start of the next interval.</summary>
        public KeyValuePair<string, double>[] TakeInterval(double seconds)
        {
            lock (_gate)
            {
                var span = seconds > 0 ? seconds : 1;
                var taken = _bytes
                    .OrderBy(p => p.Key, StringComparer.Ordinal)
                    .Select(p => new KeyValuePair<string, double>(p.Key, p.Value / span))
                    .ToArray();
                _bytes.Clear();
                return taken;
            }
        }

        public void Clear()
        {
            lock (_gate)
            {
                _bytes.Clear();
            }
        }
    }

    /// <summary>Times the scope it was opened for into <see cref="PerfTelemetry"/>; does nothing when recording was off at the open.</summary>
    public readonly struct PerfScope : IDisposable
    {
        private readonly string? _phase;
        private readonly long _started;

        internal PerfScope(string phase, long started)
        {
            _phase = phase;
            _started = started;
        }

        public void Dispose()
        {
            if (_phase != null)
            {
                PerfTelemetry.RecordTicks(_phase, Stopwatch.GetTimestamp() - _started);
            }
        }
    }

    /// <summary>
    /// Development-only timing recorded around the engine's phases and its frame
    /// writes. Off until a development tool sets <see cref="Enabled"/>, and a
    /// call site then costs one volatile read, so a player install records
    /// nothing. The report is read once an interval through
    /// <see cref="TakeIntervalJson"/>.
    /// </summary>
    public static class PerfTelemetry
    {
        private static readonly object Gate = new object();
        private static readonly PhaseTimings Phases = new PhaseTimings();
        private static readonly TopicByteCounter Bytes = new TopicByteCounter();
        private static volatile bool _enabled;
        private static long _intervalStart;

        public static bool Enabled
        {
            get => _enabled;
            set
            {
                lock (Gate)
                {
                    Phases.Clear();
                    Bytes.Clear();
                    _intervalStart = Stopwatch.GetTimestamp();
                    _enabled = value;
                }
            }
        }

        /// <summary>Opens a scope that records its duration under <paramref name="phase"/> when disposed.</summary>
        public static PerfScope Time(string phase) => _enabled ? new PerfScope(phase, Stopwatch.GetTimestamp()) : default;

        public static void RecordTicks(string phase, long stopwatchTicks)
        {
            if (_enabled)
            {
                Phases.Record(phase, stopwatchTicks * 1000.0 / Stopwatch.Frequency);
            }
        }

        public static void RecordFrameBytes(string topic, int bytes)
        {
            if (_enabled)
            {
                Bytes.Add(topic, bytes);
            }
        }

        /// <summary>
        /// The <c>"phases"</c> and <c>"topicBytesPerSec"</c> members of a report line
        /// for the interval since the last call, or null while recording is off.
        /// </summary>
        public static string? TakeIntervalJson()
        {
            if (!_enabled)
            {
                return null;
            }

            double seconds;
            PhaseSample[] phases;
            KeyValuePair<string, double>[] topics;
            lock (Gate)
            {
                var now = Stopwatch.GetTimestamp();
                seconds = (now - _intervalStart) / (double)Stopwatch.Frequency;
                _intervalStart = now;
                phases = Phases.TakeInterval();
                topics = Bytes.TakeInterval(seconds);
            }
            return Describe(phases, topics);
        }

        internal static string Describe(PhaseSample[] phases, KeyValuePair<string, double>[] topicBytesPerSec)
        {
            var sb = new StringBuilder("\"phases\":{");
            for (var i = 0; i < phases.Length; i++)
            {
                var p = phases[i];
                sb.Append(i == 0 ? "" : ",").Append(Quote(p.Name)).Append(":{")
                    .Append("\"emaMs\":").Append(Number(p.EmaMs))
                    .Append(",\"latestMs\":").Append(Number(p.LatestMs))
                    .Append(",\"maxMs\":").Append(Number(p.IntervalMaxMs))
                    .Append(",\"totalMs\":").Append(Number(p.IntervalTotalMs))
                    .Append(",\"count\":").Append(p.Count.ToString(CultureInfo.InvariantCulture))
                    .Append('}');
            }
            sb.Append("},\"topicBytesPerSec\":{");
            for (var i = 0; i < topicBytesPerSec.Length; i++)
            {
                sb.Append(i == 0 ? "" : ",").Append(Quote(topicBytesPerSec[i].Key)).Append(':').Append(Number(topicBytesPerSec[i].Value));
            }
            return sb.Append('}').ToString();
        }

        private static string Number(double value) => value.ToString("0.###", CultureInfo.InvariantCulture);

        private static string Quote(string text) => "\"" + text.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }
}
