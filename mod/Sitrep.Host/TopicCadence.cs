using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;

namespace Sitrep.Host
{
    /// <summary>
    /// How often each pull-style channel is built and considered for publishing, in UT.
    /// Every topic runs at <see cref="SampleCadence.IntervalUt"/> unless a runtime
    /// override names it, so a game with no override behaves exactly as it did before
    /// per-topic cadence existed.
    ///
    /// <para>The sampling gate (<see cref="SampleGate"/>) admits ticks at the fastest
    /// interval any topic asks for, and the engine then skips each channel whose own
    /// interval has not yet elapsed. The whole snapshot is still sampled once per
    /// admitted tick, so a faster topic costs a faster <c>Sample()</c> for every topic,
    /// not only its own build.</para>
    ///
    /// <para>Kept in this assembly rather than on the channel declaration: the
    /// declaration is part of the published contract, and an override is a development
    /// measurement aid that is never offered to a player or an Uplink author.</para>
    /// </summary>
    public sealed class TopicCadence
    {
        /// <summary>The fastest rate an override may ask for, one sample per physics tick at the nominal step.</summary>
        public const double MaxRateHz = 50.0;

        /// <summary>Slack on the elapsed-UT comparison, so a tick that lands a float's width short of an interval still counts.</summary>
        private const double ToleranceUt = 1e-6;

        private static readonly IReadOnlyDictionary<string, double> NoOverrides =
            new Dictionary<string, double>(StringComparer.Ordinal);

        private readonly object _writeGate = new object();
        private readonly Dictionary<string, double> _lastEvaluatedUt = new Dictionary<string, double>(StringComparer.Ordinal);
        private volatile IReadOnlyDictionary<string, double> _overrides = NoOverrides;
        private double _fastestIntervalUt = SampleCadence.IntervalUt;

        /// <summary>
        /// The shortest interval any topic currently asks for: the interval the
        /// sampling gate must admit ticks at. <see cref="SampleCadence.IntervalUt"/>
        /// while no override is faster than it.
        /// </summary>
        public double FastestIntervalUt => Volatile.Read(ref _fastestIntervalUt);

        /// <summary>True while at least one override is in force.</summary>
        public bool HasOverrides => _overrides.Count > 0;

        /// <summary>The UT between two evaluations of <paramref name="topic"/>.</summary>
        public double IntervalUtFor(string topic) =>
            _overrides.TryGetValue(topic, out var interval) ? interval : SampleCadence.IntervalUt;

        /// <summary>
        /// Make <paramref name="topic"/> evaluate <paramref name="hz"/> times per UT
        /// second. Returns false, changing nothing, for a rate that is not a finite
        /// number in (0, <see cref="MaxRateHz"/>].
        /// </summary>
        public bool TrySetRateHz(string topic, double hz, out string? refusal)
        {
            if (string.IsNullOrEmpty(topic))
            {
                refusal = "no topic named";
                return false;
            }
            if (double.IsNaN(hz) || double.IsInfinity(hz) || hz <= 0 || hz > MaxRateHz)
            {
                refusal = "rate " + hz.ToString("R", CultureInfo.InvariantCulture)
                    + " Hz is outside (0, " + MaxRateHz.ToString("R", CultureInfo.InvariantCulture) + "]";
                return false;
            }

            lock (_writeGate)
            {
                var next = new Dictionary<string, double>(StringComparer.Ordinal);
                foreach (var pair in _overrides)
                {
                    next[pair.Key] = pair.Value;
                }
                next[topic] = 1.0 / hz;
                Publish(next);
            }
            refusal = null;
            return true;
        }

        /// <summary>Put every topic back on <see cref="SampleCadence.IntervalUt"/>.</summary>
        public void ClearOverrides()
        {
            lock (_writeGate)
            {
                Publish(new Dictionary<string, double>(StringComparer.Ordinal));
            }
        }

        /// <summary>
        /// The overrides in force as <c>topic=rate Hz</c> pairs in topic order, or
        /// "none". What a result file reports, read back from here rather than echoed
        /// from the request.
        /// </summary>
        public string Describe()
        {
            var current = _overrides;
            return current.Count == 0
                ? "none"
                : string.Join(", ", current
                    .OrderBy(pair => pair.Key, StringComparer.Ordinal)
                    .Select(pair => pair.Key + "=" + (1.0 / pair.Value).ToString("0.###", CultureInfo.InvariantCulture) + " Hz"));
        }

        /// <summary>
        /// Courier-thread-only: whether <paramref name="topic"/> is due at
        /// <paramref name="ut"/>, in which case that UT becomes its last evaluation.
        ///
        /// <para>With no override in force every call is true and nothing is
        /// remembered: the sampling gate alone paces the topics, as it always has,
        /// including the stopped-clock editors where UT does not move between
        /// samples. With one in force a UT that has not advanced past the topic's
        /// last evaluation (a stopped clock, or a quickload that rewound UT) is
        /// due at once, since the forward comparison could never open again.</para>
        /// </summary>
        public bool IsDue(string topic, double ut)
        {
            var overrides = _overrides;
            if (overrides.Count == 0)
            {
                return true;
            }

            var interval = overrides.TryGetValue(topic, out var own) ? own : SampleCadence.IntervalUt;
            if (_lastEvaluatedUt.TryGetValue(topic, out var last)
                && ut > last
                && ut - last < interval - ToleranceUt)
            {
                return false;
            }

            _lastEvaluatedUt[topic] = ut;
            return true;
        }

        /// <summary>Courier-thread-only: forget every last evaluation, as a timeline reset does.</summary>
        public void ResetTimeline() => _lastEvaluatedUt.Clear();

        private void Publish(Dictionary<string, double> next)
        {
            var fastest = SampleCadence.IntervalUt;
            foreach (var interval in next.Values)
            {
                fastest = Math.Min(fastest, interval);
            }
            _overrides = next;
            Volatile.Write(ref _fastestIntervalUt, fastest);
        }
    }
}
