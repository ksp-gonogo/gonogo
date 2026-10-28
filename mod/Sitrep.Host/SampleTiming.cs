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
    /// of the tick, and the garbage collections that ran during them. After the timed
    /// parts come counts, each written <c>#name=n</c>: how many reads a part made, and
    /// <c>#sample.alloc.kb</c>, how far the managed heap grew while the game was sampled.
    /// Off unless the
    /// install asks for it (the <c>SAMPLE_TIMING</c> node of <c>PluginData/gonogo.cfg</c>, <c>enabled = true</c>), and a call site then costs one
    /// volatile read. Every call is on the game's main thread, so the part list needs
    /// no lock.
    /// </summary>
    public static class SampleTiming
    {
        /// <summary>The parts that took less than this many milliseconds are left out of a line.</summary>
        public const double ShownFromMs = 0.1;

        /// <summary>The count that carries the heap growth over <c>IKspHost.Sample()</c>, in KiB.</summary>
        public const string SampleAllocCount = "sample.alloc.kb";

        private static volatile bool _enabled;
        private static readonly List<KeyValuePair<string, long>> Parts = new List<KeyValuePair<string, long>>();
        private static readonly List<KeyValuePair<string, long>> Counts = new List<KeyValuePair<string, long>>();
        private static int[] _gcAtStart = new int[3];
        private static long _heapAtStart;

        public static bool Enabled
        {
            get => _enabled;
            set
            {
                _enabled = value;
                Parts.Clear();
                Counts.Clear();
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
            Counts.Clear();
            _gcAtStart = new[] { GC.CollectionCount(0), GC.CollectionCount(1), GC.CollectionCount(2) };
            _heapAtStart = GC.GetTotalMemory(false);
        }

        /// <summary>
        /// Adds <paramref name="n"/> to the count <paramref name="name"/>, such as the
        /// terrain reads one landing part made. Counts are summed like parts and printed
        /// whatever their size, zero included.
        /// </summary>
        public static void Count(string name, long n)
        {
            if (_enabled)
            {
                Counts.Add(new KeyValuePair<string, long>(name, n));
            }
        }

        /// <summary>
        /// Records <see cref="SampleAllocCount"/>: the growth of the managed heap since
        /// <see cref="Begin"/>, on every thread, so it bounds the sample's own garbage
        /// from above. Left out when a collection ran in between, which would make the
        /// difference meaningless.
        /// </summary>
        public static void MarkSampleAlloc()
        {
            if (!_enabled || GC.CollectionCount(0) != _gcAtStart[0])
            {
                return;
            }
            Count(SampleAllocCount, (GC.GetTotalMemory(false) - _heapAtStart) / 1024);
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
            var ordered = Summed(Parts);
            ordered.Sort((a, b) => b.Value.CompareTo(a.Value));

            var text = new StringBuilder();
            text.Append("sample-timing ut=").Append(ut.ToString("F2", CultureInfo.InvariantCulture));
            text.Append(" total=").Append(Ms(totalStopwatchTicks)).Append("ms");
            text.Append(" gc=")
                .Append(GC.CollectionCount(0) - _gcAtStart[0]).Append('/')
                .Append(GC.CollectionCount(1) - _gcAtStart[1]).Append('/')
                .Append(GC.CollectionCount(2) - _gcAtStart[2]);
            foreach (var part in ordered)
            {
                if (part.Value * 1000.0 / Stopwatch.Frequency < ShownFromMs)
                {
                    break;
                }
                text.Append(' ').Append(part.Key).Append('=').Append(Ms(part.Value));
            }
            foreach (var count in Summed(Counts))
            {
                text.Append(" #").Append(count.Key).Append('=').Append(count.Value.ToString(CultureInfo.InvariantCulture));
            }
            return text.ToString();
        }

        /// <summary>Each name once, with its values summed, in the order each name first appeared.</summary>
        private static List<KeyValuePair<string, long>> Summed(List<KeyValuePair<string, long>> entries)
        {
            var index = new Dictionary<string, int>(StringComparer.Ordinal);
            var summed = new List<KeyValuePair<string, long>>();
            foreach (var entry in entries)
            {
                if (index.TryGetValue(entry.Key, out var at))
                {
                    summed[at] = new KeyValuePair<string, long>(entry.Key, summed[at].Value + entry.Value);
                }
                else
                {
                    index[entry.Key] = summed.Count;
                    summed.Add(entry);
                }
            }
            return summed;
        }

        private static string Ms(long ticks) =>
            (ticks * 1000.0 / Stopwatch.Frequency).ToString("F1", CultureInfo.InvariantCulture);
    }
}
