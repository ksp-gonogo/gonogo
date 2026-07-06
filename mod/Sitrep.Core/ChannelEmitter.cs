using System;
using System.Collections.Generic;

namespace Sitrep.Core
{
    /// <summary>
    /// The v1 mod sampled every channel every physics tick into unbounded
    /// memory — this is the perf fix (streaming-slice-1 Track A): a decision
    /// function that scales sampling/emission cost with how much a channel
    /// actually changes, not with how often the host happens to call it.
    ///
    /// Given <c>(channelId, value, ut)</c>, <see cref="Decide"/> answers
    /// emit-or-skip via four gates, in this order:
    ///
    /// 1. Forced keyframe (subscribe / <see cref="Reset"/>) — fully
    ///    unconditional, bypasses every other gate below. A brand-new
    ///    channel (one <see cref="Decide"/> has never been called for)
    ///    starts in this state, so the very first call for any channel is
    ///    always a keyframe.
    /// 2. Keyframe cadence — unconditional emit if
    ///    <c>ut - lastKeyframeUt &gt;= KeyframeIntervalUt</c>, regardless of
    ///    whether the value changed. Evaluated BEFORE the UT-cadence gate
    ///    below and independent of it — a due keyframe is the correctness
    ///    baseline and must not be starved even when
    ///    <c>MinSampleIntervalUt &gt;= KeyframeIntervalUt</c>.
    /// 3. UT-cadence gate — skip if <c>ut - lastSampledUt &lt;
    ///    MinSampleIntervalUt</c>; the channel isn't even considered for a
    ///    CHANGE emission this call. This is the INNER gate;
    ///    <see cref="SubscriptionRegistry"/> is the OUTER one (zero
    ///    subscribers ⇒ the caller should never reach this method at all —
    ///    see that class's doc comment).
    /// 4. Deadband change-gate, itself capped by the max-rate clamp — emit
    ///    only if the value cleared the quantum (numeric) or is not-equal
    ///    (discrete/structured) to the last emitted value, AND at least
    ///    <c>MaxRateIntervalUt</c> has passed since the last CHANGE emission.
    ///
    /// One <see cref="ChannelEmitter"/> instance manages every channel it's
    /// asked about (keyed by <c>channelId</c>) rather than one instance per
    /// channel, per the streaming-slice-1 plan's "given (channelId, value,
    /// ut)" framing — per-channel state is a private dictionary entry,
    /// created lazily on first use.
    ///
    /// All UT, never wall-clock: this class has no notion of "now" beyond
    /// whatever <c>ut</c> the caller passes into each <see cref="Decide"/>
    /// call. Calling <see cref="Decide"/> repeatedly at the SAME ut (e.g. a
    /// host that hasn't advanced the physics clock yet) can never itself
    /// produce more than the gates above already allow — there is no
    /// <c>DateTime.Now</c>/<c>Stopwatch</c> anywhere in this file.
    /// </summary>
    public sealed class ChannelEmitter
    {
        private sealed class ChannelState
        {
            public double? LastSampledUt;
            public double? LastKeyframeUt;
            public double? LastEmittedUt;
            public object? LastEmittedValue;

            // True for a channel that has never emitted yet, and re-armed by
            // NotifySubscribed / Reset. Checked before every other gate in
            // Decide, so it always wins.
            public bool ForceKeyframe = true;

            public long Considered;
            public long Emitted;
        }

        private readonly Func<string, EmissionPolicy> _policyFor;
        private readonly Dictionary<string, ChannelState> _channels = new Dictionary<string, ChannelState>();

        /// <summary>Every channel uses the same policy.</summary>
        public ChannelEmitter(EmissionPolicy uniformPolicy)
            : this(_ => uniformPolicy)
        {
        }

        /// <summary>Per-channel policy, resolved lazily on first use of each channelId.</summary>
        public ChannelEmitter(Func<string, EmissionPolicy> policyFor)
        {
            _policyFor = policyFor;
        }

        public EmissionDecision Decide(string channelId, object? value, double ut)
        {
            var state = GetOrCreateState(channelId);
            state.Considered += 1;

            if (state.ForceKeyframe)
            {
                return EmitKeyframe(state, value, ut);
            }

            var policy = _policyFor(channelId);

            // Keyframe cadence is the correctness baseline -- it must fire on
            // its own schedule regardless of MinSampleIntervalUt, so it's
            // evaluated before that gate (previously this was inverted: a
            // MinSampleIntervalUt >= KeyframeIntervalUt would silently starve
            // every due keyframe). The min-sample gate below now only
            // throttles the CHANGE path.
            var keyframeDue = !state.LastKeyframeUt.HasValue || ut - state.LastKeyframeUt.Value >= policy.KeyframeIntervalUt;
            if (keyframeDue)
            {
                return EmitKeyframe(state, value, ut);
            }

            if (state.LastSampledUt.HasValue && ut - state.LastSampledUt.Value < policy.MinSampleIntervalUt)
            {
                return EmissionDecision.Skip(ut);
            }
            state.LastSampledUt = ut;

            if (!HasChangedBeyondQuantum(state.LastEmittedValue, value, policy.Quantum))
            {
                return EmissionDecision.Skip(ut);
            }

            if (state.LastEmittedUt.HasValue && ut - state.LastEmittedUt.Value < policy.MaxRateIntervalUt)
            {
                return EmissionDecision.Skip(ut);
            }

            return EmitChange(state, value, ut);
        }

        /// <summary>
        /// Call when <see cref="SubscriptionRegistry.Subscribe"/> reports a
        /// genuine 0 -&gt; 1 transition for <paramref name="channelId"/> — the
        /// newly-joined subscriber gets an immediate unconditional keyframe
        /// on the NEXT <see cref="Decide"/> call, rather than waiting out
        /// whatever fraction of <see cref="EmissionPolicy.KeyframeIntervalUt"/>
        /// remains. Cheap/idempotent to call on a channel that hasn't been
        /// seen by <see cref="Decide"/> yet — it's already force-keyframed by
        /// default.
        /// </summary>
        public void NotifySubscribed(string channelId)
        {
            GetOrCreateState(channelId).ForceKeyframe = true;
        }

        /// <summary>
        /// Timeline-reset, mirroring <see cref="IClock.Reset"/> /
        /// <see cref="Courier.ResetTimeline"/> — call this from the same
        /// quickload call site (a backward UT tick) so every channel
        /// re-baselines with an unconditional keyframe on its next
        /// <see cref="Decide"/> call instead of staying gated by
        /// pre-quickload cadence/deadband state that no longer describes the
        /// current timeline.
        ///
        /// <paramref name="ut"/> is accepted purely for call-site symmetry
        /// with those two methods — <see cref="ChannelEmitter"/> has no
        /// independent notion of "now" (see the class doc comment), so there
        /// is nothing here to stamp it against; the effect is entirely
        /// "the next Decide, at whatever ut it's called with, is a keyframe".
        /// </summary>
        public void Reset(double ut)
        {
            _ = ut; // intentionally unused -- see doc comment above.
            foreach (var state in _channels.Values)
            {
                state.ForceKeyframe = true;
            }
        }

        /// <summary>Per-channel emission-rate visibility — see <see cref="EmissionCounters"/>.</summary>
        public EmissionCounters CountersFor(string channelId)
        {
            var state = GetOrCreateState(channelId);
            return new EmissionCounters(state.Considered, state.Emitted);
        }

        private ChannelState GetOrCreateState(string channelId)
        {
            if (!_channels.TryGetValue(channelId, out var state))
            {
                state = new ChannelState();
                _channels[channelId] = state;
            }
            return state;
        }

        private static EmissionDecision EmitKeyframe(ChannelState state, object? value, double ut)
        {
            state.ForceKeyframe = false;
            state.LastSampledUt = ut;
            state.LastKeyframeUt = ut;
            state.LastEmittedUt = ut;
            state.LastEmittedValue = value;
            state.Emitted += 1;
            return EmissionDecision.Emit(EmissionReason.Keyframe, ut, value);
        }

        private static EmissionDecision EmitChange(ChannelState state, object? value, double ut)
        {
            state.LastEmittedUt = ut;
            state.LastEmittedValue = value;
            state.Emitted += 1;
            return EmissionDecision.Emit(EmissionReason.Change, ut, value);
        }

        /// <summary>
        /// Numeric values (double/float/int/long/short/sbyte/byte/uint/ulong/
        /// decimal — boxed, same
        /// as every other heterogeneous channel-value path in this project;
        /// see <c>StreamData&lt;object?&gt;</c> in Courier.cs) compare via the
        /// resolved <see cref="EmissionQuantum"/> deadband. Anything else
        /// (bool, string, or a structured POCO) falls back to <c>Equals</c> —
        /// the "discrete/structured: emit on not-equal" half of the deadband
        /// spec. Deliberately does NOT box into a
        /// <c>Dictionary&lt;string, object&gt;</c> or similar bag anywhere in
        /// this hot path; the only per-call allocation is the boxing already
        /// inherent in the caller's own <c>object?</c> value.
        /// </summary>
        private static bool HasChangedBeyondQuantum(object? lastEmitted, object? value, EmissionQuantum quantum)
        {
            if (TryToDouble(lastEmitted, out var lastNum) && TryToDouble(value, out var num))
            {
                return Math.Abs(num - lastNum) > quantum.Resolve();
            }
            return !Equals(lastEmitted, value);
        }

        private static bool TryToDouble(object? value, out double result)
        {
            switch (value)
            {
                case double d:
                    result = d;
                    return true;
                case float f:
                    result = f;
                    return true;
                case int i:
                    result = i;
                    return true;
                case long l:
                    result = l;
                    return true;
                case short s:
                    result = s;
                    return true;
                case sbyte sb:
                    result = sb;
                    return true;
                case byte b:
                    result = b;
                    return true;
                case uint ui:
                    result = ui;
                    return true;
                case ulong ul:
                    result = ul;
                    return true;
                case decimal m:
                    result = (double)m;
                    return true;
                default:
                    result = 0;
                    return false;
            }
        }
    }
}
