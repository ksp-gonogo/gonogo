using System;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// One parachute that is armed or part open, as read with the craft: what it
    /// would give the craft in each of the two states it can still reach, and what
    /// decides whether it gets there.
    /// </summary>
    public sealed class CanopyReading
    {
        public CanopyReading(double semiPerPressure, double fullPerPressure, double deployAltitudeM, double? safeSpeedMs, double openAfterSeconds = 0.0, double rampSeconds = 0.0, double rampStart = 0.0, double rampCurve = 1.0)
        {
            SemiPerPressure = semiPerPressure;
            FullPerPressure = fullPerPressure;
            DeployAltitudeM = deployAltitudeM;
            SafeSpeedMs = safeSpeedMs;
            OpenAfterSeconds = openAfterSeconds;
            RampSeconds = rampSeconds;
            RampStart = rampStart;
            RampCurve = rampCurve;
        }

        /// <summary>
        /// A canopy whose full opening has started: the game calls it deployed while its
        /// drag still climbs from part open to fully open over the opening animation, so
        /// within the gap it can reach full drag at any height.
        /// </summary>
        public static CanopyReading Opening(double semiPerPressure, double fullPerPressure, double rampSeconds = 0.0, double rampStart = 0.0, double rampCurve = 1.0) =>
            new CanopyReading(semiPerPressure, fullPerPressure, double.PositiveInfinity, null, 0.0, rampSeconds, rampStart, rampCurve);

        /// <summary>The acceleration it gives the craft part open, per unit of half the air density times the speed squared, from <see cref="ParachuteDrag.PerPressure"/>.</summary>
        public double SemiPerPressure { get; }

        /// <summary>The same fully open.</summary>
        public double FullPerPressure { get; }

        /// <summary>The height, in metres, below which the game lets the canopy open fully: above sea level or above the ground below the part.</summary>
        public double DeployAltitudeM { get; }

        /// <summary>The speed, in m/s, at which a canopy the game is holding back at the craft's speed would open; null for one that opens now.</summary>
        public double? SafeSpeedMs { get; }

        /// <summary>The least time, in seconds, before its full opening can start: what is left of its part-open animation. Zero where it has started or where that was not read.</summary>
        public double OpenAfterSeconds { get; }

        /// <summary>How long its full opening animation takes, in seconds. Zero where that was not read, which counts as opening at once.</summary>
        public double RampSeconds { get; }

        /// <summary>How far through its full opening animation it is, from 0 to 1, when it starts to count.</summary>
        public double RampStart { get; }

        /// <summary>The power the game raises the animation's progress to for the drag it gives.</summary>
        public double RampCurve { get; }

        /// <summary>
        /// The share of its drag, from part open (0) to fully open (1), the canopy can have
        /// reached <paramref name="elapsed"/> seconds on: nothing until its part-open
        /// animation is done, then its full opening animation climbs at the game's curve.
        /// </summary>
        public double OpenShare(double elapsed)
        {
            if (!(RampSeconds > 0.0))
            {
                return 1.0;
            }
            var progress = Math.Min(1.0, RampStart + Math.Max(0.0, elapsed - OpenAfterSeconds) / RampSeconds);
            return Math.Pow(progress, RampCurve);
        }
    }
}
