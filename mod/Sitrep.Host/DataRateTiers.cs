using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// What each rate tier a widget may ask for stands for, in samples a game
    /// second. The one place that says how fast "fast" is: a widget names a tier,
    /// never a rate, so every tier can be retuned here, at run time, without
    /// touching what asked for it.
    ///
    /// <para>The base tier is the rate every Topic runs at when nobody asks for
    /// more, <see cref="SampleCadence.IntervalUt"/>, and does not move. Every
    /// other tier can be set to any rate in (0, <see cref="TopicCadence.MaxRateHz"/>],
    /// read and written from any thread.</para>
    /// </summary>
    public sealed class DataRateTiers
    {
        /// <summary>The fast tier's rate until something sets another.</summary>
        public const double DefaultFastSamplesPerSecond = 10.0;

        private readonly object _writeGate = new object();
        private volatile IReadOnlyDictionary<string, double> _rates = new Dictionary<string, double>(StringComparer.Ordinal)
        {
            [DataRateTierNames.Base] = 1.0 / SampleCadence.IntervalUt,
            [DataRateTierNames.Fast] = DefaultFastSamplesPerSecond,
        };
        private int _version;

        /// <summary>The most each owner asks each tier to carry, by tier then owner.</summary>
        private volatile IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>> _caps =
            new Dictionary<string, IReadOnlyDictionary<string, double>>(StringComparer.Ordinal);

        /// <summary>Bumped on every change, so a reader can tell its copy is stale without comparing rates.</summary>
        public int Version => Volatile.Read(ref _version);

        /// <summary>True for a tier this table knows.</summary>
        public bool IsKnown(string tier) => _rates.ContainsKey(tier);

        /// <summary>
        /// The samples a game second <paramref name="tier"/> carries now: its set rate,
        /// lowered to the lowest cap any owner holds on it but never below the base
        /// rate. The base rate for a tier this table does not know.
        /// </summary>
        public double SamplesPerSecond(string tier)
        {
            var rates = _rates;
            var baseRate = rates[DataRateTierNames.Base];
            if (!rates.TryGetValue(tier, out var rate))
            {
                return baseRate;
            }
            if (_caps.TryGetValue(tier, out var caps))
            {
                foreach (var cap in caps.Values)
                {
                    rate = Math.Min(rate, cap);
                }
            }
            return Math.Max(baseRate, rate);
        }

        /// <summary>
        /// Hold <paramref name="tier"/> to at most <paramref name="samplesPerSecond"/> for
        /// <paramref name="owner"/>, or withdraw that owner's cap when it is null. Returns
        /// false, changing nothing, for the base tier, an unknown tier, or a rate that is
        /// not a positive finite number.
        /// </summary>
        public bool TrySetCap(string owner, string tier, double? samplesPerSecond, out string? refusal)
        {
            if (tier == DataRateTierNames.Base || !_rates.ContainsKey(tier))
            {
                refusal = "no tier named \"" + tier + "\" can be lowered";
                return false;
            }
            if (samplesPerSecond is { } rate && (double.IsNaN(rate) || double.IsInfinity(rate) || rate <= 0))
            {
                refusal = "rate " + rate.ToString("R", CultureInfo.InvariantCulture) + " is not a positive number";
                return false;
            }

            lock (_writeGate)
            {
                var next = new Dictionary<string, IReadOnlyDictionary<string, double>>(StringComparer.Ordinal);
                foreach (var pair in _caps)
                {
                    next[pair.Key] = pair.Value;
                }
                var owners = next.TryGetValue(tier, out var held)
                    ? new Dictionary<string, double>(held.Count + 1, StringComparer.Ordinal)
                    : new Dictionary<string, double>(StringComparer.Ordinal);
                if (held != null)
                {
                    foreach (var pair in held)
                    {
                        owners[pair.Key] = pair.Value;
                    }
                }
                if (samplesPerSecond is { } capped)
                {
                    owners[owner] = capped;
                }
                // Withdrawing a cap the owner never held changes nothing.
                if (samplesPerSecond == null && !owners.Remove(owner))
                {
                    refusal = null;
                    return true;
                }
                next[tier] = owners;
                _caps = next;
                Interlocked.Increment(ref _version);
            }
            refusal = null;
            return true;
        }

        /// <summary>Withdraw every cap <paramref name="owner"/> holds.</summary>
        public void ClearCaps(string owner)
        {
            foreach (var tier in DataRateTierNames.All)
            {
                if (tier != DataRateTierNames.Base)
                {
                    TrySetCap(owner, tier, null, out _);
                }
            }
        }

        /// <summary>The UT between two samples at <paramref name="tier"/>.</summary>
        public double IntervalUt(string tier) => 1.0 / SamplesPerSecond(tier);

        /// <summary>
        /// Set <paramref name="tier"/> to <paramref name="samplesPerSecond"/>. Returns false,
        /// changing nothing, for the base tier, an unknown tier, or a rate outside
        /// (0, <see cref="TopicCadence.MaxRateHz"/>].
        /// </summary>
        public bool TrySetSamplesPerSecond(string tier, double samplesPerSecond, out string? refusal)
        {
            if (tier == DataRateTierNames.Base)
            {
                refusal = "the base tier is fixed at " + _rates[DataRateTierNames.Base].ToString("R", CultureInfo.InvariantCulture) + " a second";
                return false;
            }
            if (!_rates.ContainsKey(tier))
            {
                refusal = "no tier named \"" + tier + "\"";
                return false;
            }
            if (double.IsNaN(samplesPerSecond) || double.IsInfinity(samplesPerSecond)
                || samplesPerSecond <= 0 || samplesPerSecond > TopicCadence.MaxRateHz)
            {
                refusal = "rate " + samplesPerSecond.ToString("R", CultureInfo.InvariantCulture)
                    + " is outside (0, " + TopicCadence.MaxRateHz.ToString("R", CultureInfo.InvariantCulture) + "]";
                return false;
            }

            lock (_writeGate)
            {
                var next = new Dictionary<string, double>(StringComparer.Ordinal);
                foreach (var pair in _rates)
                {
                    next[pair.Key] = pair.Value;
                }
                next[tier] = samplesPerSecond;
                _rates = next;
                Interlocked.Increment(ref _version);
            }
            refusal = null;
            return true;
        }

        /// <summary>Every tier and the rate it carries now, caps applied, slowest tier first.</summary>
        public List<DataRateTierEntry> Entries()
        {
            var rates = _rates;
            var entries = new List<DataRateTierEntry>(DataRateTierNames.All.Count);
            foreach (var tier in DataRateTierNames.All)
            {
                entries.Add(new DataRateTierEntry { Tier = tier, SamplesPerSecond = rates.ContainsKey(tier) ? SamplesPerSecond(tier) : rates[DataRateTierNames.Base] });
            }
            return entries;
        }

        /// <summary>
        /// The faster of two tiers by their rates now, caps applied. An unknown tier counts as
        /// base, and of two equal rates the first wins.
        /// </summary>
        public string Faster(string left, string right) =>
            SamplesPerSecond(right) > SamplesPerSecond(left) ? right : left;
    }
}
