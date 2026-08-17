using System;
using Sitrep.Core;
using Sitrep.Propagation;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The one <see cref="SilenceDeadlinePolicy"/> implementation this pass
    /// ships: <c>clamp(floor, k * cycle, ceiling)</c>, where the cycle is whatever
    /// the elected propagation capability says the craft's motion repeats on. For
    /// the two-body vanilla that is <c>T = 2*pi*sqrt(a^3/mu)</c> off
    /// <see cref="OrbitElements.Sma"/>/<see cref="OrbitElements.Mu"/> (see
    /// <c>local_docs/design/2026-08-15-vessel-officially-lost.md</c>). A low
    /// orbit is declared lost in minutes; a high one gets proportionally
    /// longer. Deliberately simple: a better predictor is future work, this
    /// policy exists to prove the seam, not to be the last word on it.
    ///
    /// <para>Never guesses a cycle it cannot honestly obtain: a landed or splashed
    /// vessel, and any trajectory the provider declines to give a cycle for (a
    /// hyperbolic orbit, degenerate elements, or motion that simply does not
    /// repeat) all fall straight to the ceiling.</para>
    /// </summary>
    public sealed class OrbitalPeriodSilenceDeadlinePolicy
    {
        public const double DefaultFloorSec = 600.0;
        public const double DefaultCeilingSec = GameDayDefaults.StockDaySeconds;
        public const double DefaultPeriodMultiplier = 1.5;

        private readonly double _floorSec;
        private readonly double _ceilingSec;
        private readonly double _periodMultiplier;
        private readonly IPropagationProvider _propagator;

        /// <param name="propagator">
        /// The elected propagation capability, asked for the characteristic cycle
        /// this policy scales. Defaults to the two-body vanilla, whose answer is the
        /// orbital period.
        /// </param>
        public OrbitalPeriodSilenceDeadlinePolicy(
            double floorSec = DefaultFloorSec,
            double ceilingSec = DefaultCeilingSec,
            double periodMultiplier = DefaultPeriodMultiplier,
            IPropagationProvider propagator = null)
        {
            if (!(floorSec > 0)) throw new ArgumentOutOfRangeException(nameof(floorSec));
            if (ceilingSec < floorSec) throw new ArgumentOutOfRangeException(nameof(ceilingSec));
            if (!(periodMultiplier > 0)) throw new ArgumentOutOfRangeException(nameof(periodMultiplier));

            _floorSec = floorSec;
            _ceilingSec = ceilingSec;
            _periodMultiplier = periodMultiplier;
            _propagator = propagator ?? new KeplerProvider();
        }

        /// <summary>
        /// The longest deadline this policy will ever hand out, seconds. Read
        /// by <see cref="PredictedReacquisitionSilenceDeadlinePolicy"/> so a
        /// predicted deadline is ceilinged against the same number rather than
        /// running to whatever the geometry happened to find.
        /// </summary>
        public double CeilingSec => _ceilingSec;

        /// <summary>
        /// Matches the <see cref="SilenceDeadlinePolicy"/> delegate shape;
        /// callers inject <c>new OrbitalPeriodSilenceDeadlinePolicy().Evaluate</c>
        /// into <see cref="SilenceTracker"/>'s constructor. Everything on the
        /// sample beyond the orbit is ignored, as is the silence-onset
        /// <c>ut</c>: this policy scales the period and needs no origin.
        /// <see cref="PredictedReacquisitionSilenceDeadlinePolicy"/> is the
        /// one that does.
        /// </summary>
        public SilenceDeadline Evaluate(SilenceSample sample, double ut = 0.0)
        {
            if (sample.Orbit == null)
            {
                return new SilenceDeadline(_ceilingSec, SilenceDeadlineBasis.NoOrbit);
            }

            if (sample.LandedOrSplashed)
            {
                return new SilenceDeadline(_ceilingSec, SilenceDeadlineBasis.PolicyCeiling);
            }

            // Null is the honest answer for a trajectory that does not repeat, and
            // it lands on the same ceiling the hyperbolic and degenerate cases
            // already used. The branch predates the provider; only its cause moved.
            var period = _propagator.CharacteristicCycleSeconds(SilenceSampleTarget.Of(sample));
            if (period == null)
            {
                return new SilenceDeadline(_ceilingSec, SilenceDeadlineBasis.PolicyCeiling);
            }

            var raw = _periodMultiplier * period.Value;

            if (raw < _floorSec) return new SilenceDeadline(_floorSec, SilenceDeadlineBasis.PolicyFloor);
            if (raw > _ceilingSec) return new SilenceDeadline(_ceilingSec, SilenceDeadlineBasis.PolicyCeiling);
            return new SilenceDeadline(raw, SilenceDeadlineBasis.OrbitalPeriod);
        }
    }
}
