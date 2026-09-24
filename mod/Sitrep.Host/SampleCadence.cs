using System;

namespace Sitrep.Host
{
    /// <summary>
    /// Pure UT-cadence gate for <c>GonogoAddon.FixedUpdate</c> (Track C):
    /// decides whether enough game time has passed to justify the next
    /// (comparatively expensive) <c>IKspHost.Sample()</c> call. Lives here,
    /// not in <c>Gonogo.KSP</c>, per that assembly's own doc comment - it's
    /// the KSP-free logic that gets headless-tested in
    /// <c>Sitrep.Host.Tests</c>.
    ///
    /// Forward cadence: skip until <paramref name="intervalUt"/> UT has
    /// elapsed since the last sample, driven by game time, not tick count.
    /// The interval a caller passes is <see cref="IntervalUtAt"/> of the
    /// current warp rate, so under warp the gate still admits about one
    /// sample per real second rather than one per physics tick.
    ///
    /// Backward jump (F9 quickload): KSP's UT can rewind. A forward-only
    /// <c>ut - lastSampledUt &lt; interval</c> gate goes strongly negative
    /// and is ALWAYS true, so it stalls forever after a quickload - both the
    /// recorder (which must sample unconditionally) and the live stream
    /// (whose <c>GonogoBodiesServer</c> rewind-detection can't even fire,
    /// because <c>Tick</c> is never reached) go dark exactly across the
    /// event most worth capturing. So any <c>ut &lt; lastSampledUt</c> is
    /// treated as an immediate forced resample rather than a gated skip, and
    /// the new (lower) UT becomes the cadence anchor going forward.
    /// </summary>
    public static class SampleCadence
    {
        /// <summary>
        /// The UT the mod leaves between two samples of the game while one
        /// physics tick advances less than this.
        /// </summary>
        public const double IntervalUt = 1.0;

        /// <summary>
        /// The least real time the mod leaves between two samples, in seconds.
        ///
        /// <para>A UT interval alone is satisfied on every physics tick once
        /// warp runs a tick past it, so the sample rate, and every channel's
        /// change rate with it, climbs to the physics rate: thirty-odd samples
        /// a real second at high warp for a stream sized for one. One second,
        /// because at 1x a UT second IS a real one, so the floor never binds at
        /// 1x and warp leaves the wire rate where 1x has it.</para>
        /// </summary>
        public const double FloorRealSec = 1.0;

        /// <summary>
        /// The UT the gate waits between two samples at <paramref name="warpRate"/>:
        /// <see cref="IntervalUt"/>, or <see cref="FloorRealSec"/> of game time
        /// at that rate where that is longer. Expressed through the rate rather
        /// than read off a wall clock, so the UT between two samples is a figure
        /// the mod can state exactly (see <see cref="ObservationQuantumUt"/>).
        /// A rate that is not a positive number is treated as 1x.
        /// </summary>
        public static double IntervalUtAt(double warpRate) =>
            warpRate > 1.0 && !double.IsInfinity(warpRate)
                ? Math.Max(IntervalUt, FloorRealSec * warpRate)
                : IntervalUt;

        /// <summary>
        /// The UT that actually passes between two samples when one physics
        /// tick advances the game by <paramref name="tickUt"/>: the interval
        /// at which anyone is looking.
        ///
        /// <para><paramref name="intervalUt"/> is the gate's interval at the
        /// current rate, <see cref="IntervalUtAt"/>. The gate is only asked
        /// once per tick, so were a single tick to outrun it every tick would
        /// be sampled and the quantum would be the tick itself. Rounding the interval up to a whole
        /// number of ticks below that point is deliberately left out: it is
        /// finer than the interval, and a figure that moved with every sub-step
        /// rate would resend the topic carrying it for nothing.</para>
        /// </summary>
        public static double ObservationQuantumUt(double intervalUt, double tickUt) =>
            tickUt > intervalUt ? tickUt : intervalUt;

        /// <summary>
        /// True when the caller should call <c>Sample()</c> now: first-ever
        /// sample (<paramref name="lastSampledUt"/> is null), a backward UT
        /// jump, or enough forward UT has elapsed.
        /// </summary>
        public static bool ShouldSample(double ut, double? lastSampledUt, double intervalUt)
        {
            if (!lastSampledUt.HasValue)
            {
                return true;
            }

            if (ut < lastSampledUt.Value)
            {
                return true;
            }

            return ut - lastSampledUt.Value >= intervalUt;
        }
    }
}
