using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// How often each pull-style channel is built and considered for publishing, in UT.
    /// A topic runs at <see cref="SampleCadence.IntervalUt"/> unless a connection asks
    /// for a faster rate tier on it (<see cref="SetDemand"/>, rated by
    /// <see cref="DataRateTiers"/>) or a development override names it. An override
    /// wins outright, slower or faster, so a measurement runs at the rate it set.
    ///
    /// <para>The sampling gate (<see cref="SampleGate"/>) admits ticks at the fastest
    /// interval any topic asks for, and the engine then skips each channel whose own
    /// interval has not yet elapsed. The whole snapshot is still sampled once per
    /// admitted tick, so a faster topic costs a faster <c>Sample()</c> for every topic,
    /// not only its own build.</para>
    ///
    /// <para>An override is a development measurement aid, never offered to a player
    /// or an Uplink author, which is why it names a rate where a demand names a tier.</para>
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
        private static readonly IReadOnlyDictionary<string, string> NoDemand =
            new Dictionary<string, string>(StringComparer.Ordinal);

        private volatile IReadOnlyDictionary<string, double> _overrides = NoOverrides;
        private volatile IReadOnlyDictionary<string, string> _demand = NoDemand;

        /// <param name="tiers">What each rate tier stands for; a fresh default table when null.</param>
        public TopicCadence(DataRateTiers? tiers = null)
        {
            Tiers = tiers ?? new DataRateTiers();
        }

        /// <summary>What each rate tier stands for, in samples a game second.</summary>
        public DataRateTiers Tiers { get; }

        /// <summary>
        /// The shortest interval any topic currently asks for: the interval the
        /// sampling gate must admit ticks at. <see cref="SampleCadence.IntervalUt"/>
        /// while nothing asks for faster. Read on every physics tick, so a tier
        /// retuned in <see cref="Tiers"/> takes effect at once.
        /// </summary>
        public double FastestIntervalUt
        {
            get
            {
                var fastest = SampleCadence.IntervalUt;
                foreach (var interval in _overrides.Values)
                {
                    fastest = Math.Min(fastest, interval);
                }
                foreach (var tier in _demand.Values)
                {
                    fastest = Math.Min(fastest, Tiers.IntervalUt(tier));
                }
                return fastest;
            }
        }

        /// <summary>True while at least one override is in force.</summary>
        public bool HasOverrides => _overrides.Count > 0;

        /// <summary>The UT between two evaluations of <paramref name="topic"/>.</summary>
        public double IntervalUtFor(string topic) => IntervalUtFor(topic, _overrides, _demand);

        private double IntervalUtFor(
            string topic,
            IReadOnlyDictionary<string, double> overrides,
            IReadOnlyDictionary<string, string> demand)
        {
            if (overrides.TryGetValue(topic, out var own))
            {
                return own;
            }
            return demand.TryGetValue(topic, out var tier)
                ? Math.Min(SampleCadence.IntervalUt, Tiers.IntervalUt(tier))
                : SampleCadence.IntervalUt;
        }

        /// <summary>
        /// The fastest tier any connection asks for on <paramref name="topic"/>, or
        /// <see cref="DataRateTierNames.Base"/> to withdraw every demand on it.
        /// </summary>
        public void SetDemand(string topic, string tier)
        {
            lock (_writeGate)
            {
                var current = _demand;
                var isBase = tier == DataRateTierNames.Base;
                if (isBase ? !current.ContainsKey(topic) : current.TryGetValue(topic, out var held) && held == tier)
                {
                    return;
                }
                var next = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (var pair in current)
                {
                    next[pair.Key] = pair.Value;
                }
                if (isBase)
                {
                    next.Remove(topic);
                }
                else
                {
                    next[topic] = tier;
                }
                _demand = next;
            }
        }

        /// <summary>Every topic some connection asks to have above the base tier, sorted by topic.</summary>
        public List<TopicDataRate> DemandReport()
        {
            var demand = _demand;
            var rows = new List<TopicDataRate>(demand.Count);
            foreach (var pair in demand.OrderBy(pair => pair.Key, StringComparer.Ordinal))
            {
                rows.Add(new TopicDataRate
                {
                    Topic = pair.Key,
                    Tier = pair.Value,
                    SamplesPerSecond = Tiers.SamplesPerSecond(pair.Value),
                });
            }
            return rows;
        }

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

        /// <summary>Withdraw every override, leaving each topic on its demanded tier.</summary>
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
        /// <para>With no override or demand in force every call is true and nothing
        /// is remembered: the sampling gate alone paces the topics, including the
        /// stopped-clock editors where UT does not move between samples. With one in
        /// force a UT that has not advanced past the topic's last evaluation (a
        /// stopped clock, or a quickload that rewound UT) is due at once, since the
        /// forward comparison could never open again.</para>
        /// </summary>
        public bool IsDue(string topic, double ut)
        {
            var overrides = _overrides;
            var demand = _demand;
            if (overrides.Count == 0 && demand.Count == 0)
            {
                return true;
            }

            var interval = IntervalUtFor(topic, overrides, demand);
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

        private void Publish(Dictionary<string, double> next) => _overrides = next;
    }
}
