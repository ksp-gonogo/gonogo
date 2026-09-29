using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Why the engine decided to put a channel's sample on the wire.
    /// <see cref="None"/> is only ever seen on a skipped decision (see
    /// <see cref="EmissionDecision.ShouldEmit"/>), never on an emitted one.
    /// <internal>
    /// Returned by Sitrep.Core.ChannelEmitter.Decide.
    /// </internal>
    /// </summary>
    /// <category>Channels and emission</category>
    public enum EmissionReason
    {
        /// <summary>Nothing was emitted: the decision was a skip.</summary>
        None = 0,

        /// <summary>
        /// An unconditional emission, sent whether or not the value changed: the
        /// first sample of a channel, the first after a new subscriber, or the
        /// periodic one due every <see cref="EmissionPolicy.KeyframeIntervalUt"/>.
        /// </summary>
        Keyframe,

        /// <summary>The value moved beyond the channel's <see cref="EmissionPolicy.Quantum"/>.</summary>
        Change,
    }

    /// <summary>
    /// The deadband a numeric channel's value must clear before a change is
    /// emitted. Either an <see cref="Absolute"/> width, or a
    /// <see cref="PercentOfRange"/> fraction of a known value range, which
    /// scales itself: an absolute width tends to flood a wide-range channel or
    /// over-suppress a narrow one. Not consulted for non-numeric values, which
    /// emit a change whenever they are not equal (by value) to the last emitted
    /// one.
    /// </summary>
    /// <category>Channels and emission</category>
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
        /// <param name="quantum">The width. Must be 0 or more; 0 emits on any change.</param>
        /// <exception cref="ArgumentOutOfRangeException"><paramref name="quantum"/> is negative.</exception>
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
        /// <paramref name="rangeMax"/> minus <paramref name="rangeMin"/> (for
        /// example <c>0.01</c> for a 1% quantum).
        /// </summary>
        /// <param name="fraction">The fraction of the range, 0 or more.</param>
        /// <param name="rangeMin">The low end of the value's expected range.</param>
        /// <param name="rangeMax">The high end of the value's expected range, at least <paramref name="rangeMin"/>.</param>
        /// <exception cref="ArgumentOutOfRangeException"><paramref name="fraction"/> is negative, or <paramref name="rangeMax"/> is below <paramref name="rangeMin"/>.</exception>
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

        /// <summary>Resolves this quantum to an absolute deadband width, in the channel's own units.</summary>
        /// <returns>The width itself for <see cref="Absolute"/>, or the fraction times the range for <see cref="PercentOfRange"/>.</returns>
        public double Resolve()
        {
            return _isPercent ? _magnitude * (_rangeMax - _rangeMin) : _magnitude;
        }
    }

    /// <summary>
    /// When the engine puts a channel's sample on the wire: its keyframe
    /// cadence, its deadband, and two optional rate gates. Every interval is in
    /// UT seconds, never wall-clock, so emission cost scales with how fast the
    /// value changes in game time rather than with how often the host samples
    /// (which under time warp can be every physics tick). Set on
    /// <see cref="ChannelDeclaration.Emission"/>.
    /// </summary>
    /// <category>Channels and emission</category>
    public sealed class EmissionPolicy
    {
        /// <summary>
        /// The minimum UT seconds between two samples considered for a change
        /// emission. A due keyframe is not held by this gate. <c>0</c> disables
        /// it, so every sample is considered.
        /// <internal>
        /// This is ChannelEmitter.Decide's inner gate; SubscriptionRegistry is
        /// the outer one, deciding whether Decide is called at all.
        /// </internal>
        /// </summary>
        public double MinSampleIntervalUt { get; }

        /// <summary>
        /// Emit unconditionally at least this often, in UT seconds, whether or
        /// not the value changed. This is what lets a client recover after a
        /// cold start, a quickload or a reconnect without waiting for the next
        /// real change. Always greater than 0. Periodic keyframes are also held to at
        /// most one per second of real time, so under heavy time warp they arrive
        /// less often than this interval implies.
        /// </summary>
        public double KeyframeIntervalUt { get; }

        /// <summary>
        /// The deadband a numeric value must clear (or the not-equal check a
        /// non-numeric value must fail) before a change emission fires. Never
        /// consulted for keyframes, which are unconditional.
        /// </summary>
        public EmissionQuantum Quantum { get; }

        /// <summary>
        /// The minimum UT seconds between two change emissions: even if the
        /// deadband keeps tripping (a rapidly oscillating value), no more than
        /// one <see cref="EmissionReason.Change"/> emission fires per this many
        /// UT seconds. Keyframes are not clamped. <c>0</c> disables the clamp.
        /// </summary>
        public double MaxRateIntervalUt { get; }

        /// <summary>Creates an emission policy.</summary>
        /// <param name="keyframeIntervalUt">The keyframe cadence in UT seconds. Must be greater than 0.</param>
        /// <param name="quantum">The deadband a change must clear.</param>
        /// <param name="minSampleIntervalUt">The minimum UT seconds between samples considered for a change. 0 or more; 0 disables it.</param>
        /// <param name="maxRateIntervalUt">The minimum UT seconds between change emissions. 0 or more; 0 disables it.</param>
        /// <exception cref="ArgumentOutOfRangeException">An interval is out of range.</exception>
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
    /// The engine's decision for one sample of one channel: whether to emit it
    /// and why. A value type because it is returned at up to physics-tick rate
    /// per channel.
    /// <internal>
    /// Returned by Sitrep.Core.ChannelEmitter.Decide.
    /// </internal>
    /// </summary>
    /// <category>Channels and emission</category>
    public readonly struct EmissionDecision
    {
        /// <summary>True when the sample goes on the wire.</summary>
        public bool ShouldEmit { get; }

        /// <summary>Why it was emitted; <see cref="EmissionReason.None"/> when <see cref="ShouldEmit"/> is false.</summary>
        public EmissionReason Reason { get; }

        /// <summary>The universal time of the sample that was decided on.</summary>
        public double Ut { get; }

        /// <summary>The sample's value when emitted; null on a skip.</summary>
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
    /// How many samples of one channel were considered and how many emitted,
    /// so a mis-tuned channel (quantum too tight, keyframe interval too short)
    /// shows up as a number rather than silently loading the host.
    /// <internal>
    /// See Sitrep.Core.ChannelEmitter.CountersFor.
    /// </internal>
    /// </summary>
    /// <category>Channels and emission</category>
    public readonly struct EmissionCounters
    {
        /// <summary>Total samples considered for this channel, emitted or not.</summary>
        public long Considered { get; }

        /// <summary>Of those, how many actually emitted.</summary>
        public long Emitted { get; }

        /// <summary>Considered but not emitted: gated by cadence, deadband, or max-rate clamp.</summary>
        public long Skipped => Considered - Emitted;

        internal EmissionCounters(long considered, long emitted)
        {
            Considered = considered;
            Emitted = emitted;
        }
    }
}
