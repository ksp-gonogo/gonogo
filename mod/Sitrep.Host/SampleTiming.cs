using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace Sitrep.Host
{
    /// <summary>Times one named part of a sample while disposed after; inert when the timing is off.</summary>
    public readonly struct SampleTimingScope : IDisposable
    {
        private readonly string? _part;
        private readonly long _started;

        internal SampleTimingScope(string part, long started)
        {
            _part = part;
            _started = started;
        }

        public void Dispose()
        {
            if (_part != null)
            {
                SampleTiming.Add(_part, Stopwatch.GetTimestamp() - _started);
            }
        }
    }

    /// <summary>
    /// Per-part real time of one main-thread game sample, written as one line to the
    /// log per sample: the parts of <c>IKspHost.Sample()</c>, the main-thread captures
    /// of the tick, and the garbage collections that ran during them. Off unless the
    /// install asks for it (the <c>SAMPLE_TIMING</c> node of <c>PluginData/gonogo.cfg</c>, <c>enabled = true</c>), and a call site then costs one
    /// volatile read. Every call is on the game's main thread, so the part list needs
    /// no lock.
    /// </summary>
    public static class SampleTiming
    {
        /// <summary>The parts that took less than this many milliseconds are left out of a line.</summary>
        public const double ShownFromMs = 0.1;

        /// <summary>The most parts one line names, slowest first.</summary>
        public const int MostParts = 14;

        private static volatile bool _enabled;
        private static readonly List<KeyValuePair<string, long>> Parts = new List<KeyValuePair<string, long>>();
        private static int[] _gcAtStart = new int[3];

        public static bool Enabled
        {
            get => _enabled;
            set
            {
                _enabled = value;
                Parts.Clear();
            }
        }

        /// <summary>Starts a sample: forgets the last one's parts and notes the collections so far.</summary>
        public static void Begin()
        {
            if (!_enabled)
            {
                return;
            }
            Parts.Clear();
            _gcAtStart = new[] { GC.CollectionCount(0), GC.CollectionCount(1), GC.CollectionCount(2) };
        }

        public static SampleTimingScope Part(string part) =>
            _enabled ? new SampleTimingScope(part, Stopwatch.GetTimestamp()) : default;

        public static void Add(string part, long stopwatchTicks)
        {
            if (_enabled)
            {
                Parts.Add(new KeyValuePair<string, long>(part, stopwatchTicks));
            }
        }

        /// <summary>
        /// The line for the sample that has just finished, or null while off. A part
        /// recorded more than once in a sample (a group built per vessel) is summed.
        /// </summary>
        public static string? Line(double ut, long totalStopwatchTicks)
        {
            if (!_enabled)
            {
                return null;
            }
            var summed = new Dictionary<string, long>(StringComparer.Ordinal);
            foreach (var part in Parts)
            {
                summed.TryGetValue(part.Key, out var have);
                summed[part.Key] = have + part.Value;
            }
            var ordered = new List<KeyValuePair<string, long>>(summed);
            ordered.Sort((a, b) => b.Value.CompareTo(a.Value));

            var text = new StringBuilder();
            text.Append("sample-timing ut=").Append(ut.ToString("F2", CultureInfo.InvariantCulture));
            text.Append(" total=").Append(Ms(totalStopwatchTicks)).Append("ms");
            text.Append(" gc=")
                .Append(GC.CollectionCount(0) - _gcAtStart[0]).Append('/')
                .Append(GC.CollectionCount(1) - _gcAtStart[1]).Append('/')
                .Append(GC.CollectionCount(2) - _gcAtStart[2]);
            var shown = 0;
            foreach (var part in ordered)
            {
                if (shown == MostParts || part.Value * 1000.0 / Stopwatch.Frequency < ShownFromMs)
                {
                    break;
                }
                text.Append(' ').Append(part.Key).Append('=').Append(Ms(part.Value));
                shown++;
            }
            return text.ToString();
        }

        private static string Ms(long ticks) =>
            (ticks * 1000.0 / Stopwatch.Frequency).ToString("F1", CultureInfo.InvariantCulture);
    }
}
