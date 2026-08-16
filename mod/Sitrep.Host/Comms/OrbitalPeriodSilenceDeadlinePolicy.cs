using System;
using Sitrep.Propagation;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The one <see cref="SilenceDeadlinePolicy"/> implementation this pass
    /// ships: <c>clamp(floor, k * orbitalPeriod, ceiling)</c>, with
    /// <c>T = 2*pi*sqrt(a^3/mu)</c> off <see cref="OrbitElements.Sma"/>/
    /// <see cref="OrbitElements.Mu"/> (see
    /// <c>local_docs/design/2026-08-15-vessel-officially-lost.md</c>). A low
    /// orbit is declared lost in minutes; a high one gets proportionally
    /// longer. Deliberately simple: a better predictor is future work, this
    /// policy exists to prove the seam, not to be the last word on it.
    ///
    /// <para>Never guesses a period it cannot honestly compute: a hyperbolic
    /// orbit (<c>ecc &gt;= 1</c>), a landed/splashed vessel, or a degenerate
    /// <c>Sma</c>/<c>Mu</c> all fall straight to the ceiling rather than
    /// feeding <see cref="Math.Sqrt"/> something meaningless.</para>
    /// </summary>
    public sealed class OrbitalPeriodSilenceDeadlinePolicy
    {
        public const double DefaultFloorSec = 600.0;
        public const double DefaultCeilingSec = 86400.0;
        public const double DefaultPeriodMultiplier = 1.5;

        private readonly double _floorSec;
        private readonly double _ceilingSec;
        private readonly double _periodMultiplier;

        public OrbitalPeriodSilenceDeadlinePolicy(
            double floorSec = DefaultFloorSec,
            double ceilingSec = DefaultCeilingSec,
            double periodMultiplier = DefaultPeriodMultiplier)
        {
            if (!(floorSec > 0)) throw new ArgumentOutOfRangeException(nameof(floorSec));
            if (ceilingSec < floorSec) throw new ArgumentOutOfRangeException(nameof(ceilingSec));
            if (!(periodMultiplier > 0)) throw new ArgumentOutOfRangeException(nameof(periodMultiplier));

            _floorSec = floorSec;
            _ceilingSec = ceilingSec;
            _periodMultiplier = periodMultiplier;
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

            var o = sample.Orbit.Value;
            if (sample.LandedOrSplashed || o.Ecc >= 1.0 || !(o.Sma > 0.0) || !(o.Mu > 0.0))
            {
                return new SilenceDeadline(_ceilingSec, SilenceDeadlineBasis.PolicyCeiling);
            }

            var period = 2.0 * Math.PI * Math.Sqrt(o.Sma * o.Sma * o.Sma / o.Mu);
            var raw = _periodMultiplier * period;

            if (raw < _floorSec) return new SilenceDeadline(_floorSec, SilenceDeadlineBasis.PolicyFloor);
            if (raw > _ceilingSec) return new SilenceDeadline(_ceilingSec, SilenceDeadlineBasis.PolicyCeiling);
            return new SilenceDeadline(raw, SilenceDeadlineBasis.OrbitalPeriod);
        }
    }
}
