using System;

namespace Sitrep.Core
{
    /// <summary>
    /// Why a given <see cref="ChannelEmitter.Decide"/> call chose to emit.
    /// <see cref="None"/> is only ever seen on a skipped decision (see
    /// <see cref="EmissionDecision.ShouldEmit"/>) — it is never the reason on
    /// an emitted one.
    /// </summary>
    public enum EmissionReason
    {
        None = 0,
        Keyframe,
        Change,
    }

    /// <summary>
    /// The deadband width a numeric channel must clear before a value change
    /// is considered meaningful. Either an <see cref="Absolute"/> magnitude,
    /// or a <see cref="PercentOfRange"/> fraction of a known value range
    /// (the recommended default per the streaming-slice-1 plan — an absolute
    /// quantum tends to either flood on a wide-range channel or over-suppress
    /// on a narrow one, whereas percent-of-range self-scales). Not consulted
    /// at all for non-numeric (discrete/structured) values — see
    /// <c>ChannelEmitter.HasChangedBeyondQuantum</c>, which falls back to
    /// <c>Equals</c> for those.
    /// </summary>
    public readonly struct EmissionQuantum
    {
        private readonly double _magnitude;
        private readonly double _rangeMin;
        private readonly double _rangeMax;
        private readonly bool _isPercent;

        private EmissionQuantum(double magnitude, double rangeMin, double rangeMax, bool isPercent)
        {
            _magnitude = magnitude;
            _rangeMin = rangeMin;
            _rangeMax = rangeMax;
            _isPercent = isPercent;
        }

        /// <summary>A fixed deadband width in the channel's own units.</summary>
        public static EmissionQuantum Absolute(double quantum)
        {
            if (quantum < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(quantum), "Absolute quantum must be >= 0.");
            }
            return new EmissionQuantum(quantum, 0, 0, isPercent: false);
        }

        /// <summary>
        /// A deadband width expressed as <paramref name="fraction"/> of
        /// <paramref name="rangeMax"/> - <paramref name="rangeMin"/> (e.g.
        /// <c>0.01</c> for a 1% quantum). Resolved once per
        /// <see cref="Resolve"/> call rather than cached, so it stays correct
        /// even if a caller mutates policy between calls (not expected in
        /// practice, but cheap to keep honest).
        /// </summary>
        public static EmissionQuantum PercentOfRange(double fraction, double rangeMin, double rangeMax)
        {
            if (fraction < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(fraction), "Percent-of-range fraction must be >= 0.");
            }
            if (rangeMax < rangeMin)
            {
                throw new ArgumentOutOfRangeException(nameof(rangeMax), "rangeMax must be >= rangeMin.");
            }
            return new EmissionQuantum(fraction, rangeMin, rangeMax, isPercent: true);
        }

        /// <summary>Resolve this quantum to an absolute deadband width.</summary>
        public double Resolve()
        {
            return _isPercent ? _magnitude * (_rangeMax - _rangeMin) : _magnitude;
        }
    }

    /// <summary>
    /// Per-channel emission configuration for <see cref="ChannelEmitter"/>.
    /// Every interval is expressed in UT seconds — never wall-clock — because
    /// the whole point of this policy is to scale sampling/emission cost with
    /// how fast the underlying value actually changes in game time, not with
    /// how often the host happens to call <see cref="ChannelEmitter.Decide"/>
    /// (which, under time-warp, can be every physics tick regardless of UT
    /// throughput).
    /// </summary>
    public sealed class EmissionPolicy
    {
        /// <summary>
        /// Don't even consider (sample) this channel more often than this
        /// many UT seconds since it was last considered — the OUTER-most gate
        /// within <see cref="ChannelEmitter.Decide"/> itself (distinct from
        /// <see cref="SubscriptionRegistry"/>, which gates whether Decide is
        /// called at all). <c>0</c> disables this gate (every call is
        /// considered).
        /// </summary>
        public double MinSampleIntervalUt { get; }

        /// <summary>
        /// Emit unconditionally at least this often, regardless of whether
        /// the value changed — the baseline that makes cold-start,
        /// quickload, and subscriber-eviction/rejoin recoverable without
        /// waiting for the next real change. Must be > 0.
        /// </summary>
        public double KeyframeIntervalUt { get; }

        /// <summary>
        /// The deadband a numeric value must clear (or the not-equal check a
        /// non-numeric value must fail) before a CHANGE emission fires.
        /// Never consulted for keyframe emissions, which are unconditional.
        /// </summary>
        public EmissionQuantum Quantum { get; }

        /// <summary>
        /// Max-rate clamp: even if the deadband keeps re-tripping (a rapidly
        /// oscillating value), don't fire more than one CHANGE emission per
        /// this many UT seconds. Scoped to <see cref="EmissionReason.Change"/>
        /// only — keyframes stay unconditional per their own cadence.
        /// <c>0</c> disables the clamp.
        /// </summary>
        public double MaxRateIntervalUt { get; }

        public EmissionPolicy(
            double keyframeIntervalUt,
            EmissionQuantum quantum,
            double minSampleIntervalUt = 0,
            double maxRateIntervalUt = 0)
        {
            if (keyframeIntervalUt <= 0)
            {
                throw new ArgumentOutOfRangeException(nameof(keyframeIntervalUt), "keyframeIntervalUt must be > 0.");
            }
            if (minSampleIntervalUt < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(minSampleIntervalUt), "minSampleIntervalUt must be >= 0.");
            }
            if (maxRateIntervalUt < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(maxRateIntervalUt), "maxRateIntervalUt must be >= 0.");
            }

            KeyframeIntervalUt = keyframeIntervalUt;
            Quantum = quantum;
            MinSampleIntervalUt = minSampleIntervalUt;
            MaxRateIntervalUt = maxRateIntervalUt;
        }
    }

    /// <summary>
    /// Result of one <see cref="ChannelEmitter.Decide"/> call. A value type —
    /// this is the hot-path return, called at up to physics-tick rate per
    /// channel, so it's kept allocation-free rather than a class.
    /// </summary>
    public readonly struct EmissionDecision
    {
        public bool ShouldEmit { get; }
        public EmissionReason Reason { get; }
        public double Ut { get; }
        public object? Value { get; }

        private EmissionDecision(bool shouldEmit, EmissionReason reason, double ut, object? value)
        {
            ShouldEmit = shouldEmit;
            Reason = reason;
            Ut = ut;
            Value = value;
        }

        internal static EmissionDecision Emit(EmissionReason reason, double ut, object? value)
        {
            return new EmissionDecision(true, reason, ut, value);
        }

        internal static EmissionDecision Skip(double ut)
        {
            return new EmissionDecision(false, EmissionReason.None, ut, null);
        }
    }

    /// <summary>
    /// Per-channel emission-rate visibility, exposed so a mis-tuned channel
    /// (quantum too tight, keyframe interval too short) shows up as a number
    /// somewhere rather than silently tar-pitting the host. See
    /// <see cref="ChannelEmitter.CountersFor"/>.
    /// </summary>
    public readonly struct EmissionCounters
    {
        /// <summary>Total <see cref="ChannelEmitter.Decide"/> calls for this channel, emitted or not.</summary>
        public long Considered { get; }

        /// <summary>Of those, how many actually emitted.</summary>
        public long Emitted { get; }

        /// <summary>Considered but not emitted — gated by cadence, deadband, or max-rate clamp.</summary>
        public long Skipped => Considered - Emitted;

        internal EmissionCounters(long considered, long emitted)
        {
            Considered = considered;
            Emitted = emitted;
        }
    }
}
