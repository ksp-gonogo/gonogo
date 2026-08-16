using System;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// A <see cref="SilenceDeadlinePolicy"/> that answers "when should this
    /// vessel come back?" from geometry rather than from a multiple of its
    /// orbital period: sweep the radio path forward from the moment contact
    /// was lost, and if it re-opens, say when.
    ///
    /// <para>The operator experience this exists for is knowing that a vessel
    /// went round the far side, when it is due out, and — the part that
    /// actually matters — that it did not show up. A deadline of "1.5 orbits"
    /// cannot express any of that; a predicted emergence UT can.</para>
    ///
    /// <para><b>Every path leads back to a deadline.</b> A prediction is a
    /// bonus, never a precondition. When geometry cannot be built, finds no
    /// occultation, or cannot be resolved at the current warp, this returns
    /// the <see cref="OrbitalPeriodSilenceDeadlinePolicy"/> answer unchanged
    /// and simply withholds the prediction. It never shortens a deadline
    /// because it failed to find something.</para>
    ///
    /// <para><b>Deliberately synchronous, and that is not the end state.</b>
    /// <see cref="SilenceTracker"/> calls the policy inline on the capture
    /// tick, and above ~100x warp that tick runs every frame. A fleet of
    /// relays each re-arming a fresh sweep on every reconnect-then-disconnect
    /// is a stutter. The sample budget below bounds one call, but the real
    /// answer is to slice the scan across ticks behind a bounded queue; that
    /// wraps this class rather than changing it, which is why the geometry
    /// comes in through a factory instead of being built here.</para>
    /// </summary>
    public sealed class PredictedReacquisitionSilenceDeadlinePolicy
    {
        /// <summary>
        /// Builds the path geometry for one vessel's silence, or returns null
        /// when it cannot be built honestly — no known stations, an
        /// unsupported reference body, a backend that declares no occlusion
        /// model. Null means "no prediction attempted", which is a different
        /// thing from "no occultation found", and the two produce different
        /// bases.
        /// </summary>
        public delegate IVisibilityGeometry GeometryFactory(SilenceSample sample, double ut);

        /// <summary>
        /// Periods of forward search. One period would find an occultation
        /// that recurs every orbit but could sit exactly inside a gap for one
        /// that does not; two costs nothing extra worth counting and covers
        /// the case where the vessel went dark just after an emergence.
        /// </summary>
        public const double SearchWindowPeriods = 2.0;

        /// <summary>
        /// Half a degree of orbital arc: the step the predictor spec settles
        /// on, which puts every low orbit at 3-6 s and so resolves any
        /// occultation worth naming.
        /// </summary>
        public const double SweepStepsPerPeriod = 720.0;

        /// <summary>
        /// The coarsest step still considered a resolution rather than a
        /// guess: five degrees of arc. A warp that forces a step longer than
        /// this cannot see an occultation shorter than a tenth of the orbit,
        /// which at these altitudes is most of them, so the honest answer is
        /// <see cref="SilenceDeadlineBasis.WarpLimited"/> and no number.
        /// </summary>
        public const double CoarsestUsefulStepsPerPeriod = 72.0;

        /// <summary>
        /// Grace between predicted emergence and the declare-lost deadline, as
        /// a fraction of the period, floored by
        /// <see cref="MinimumGraceSeconds"/>. A vessel that is one sweep step
        /// late is not lost; a vessel a quarter of an orbit late is worth
        /// declaring on.
        /// </summary>
        public const double GracePeriodFraction = 0.25;

        public const double MinimumGraceSeconds = 300.0;

        /// <summary>
        /// Hard cap on margin evaluations for a single call, so a pathological
        /// orbit cannot turn one capture tick into an unbounded loop. Two
        /// periods at half-degree steps is ~1440 samples, so this leaves an
        /// order of magnitude of headroom before it ever binds.
        /// </summary>
        public const int MaxSamplesPerEvaluation = 20_000;

        private readonly GeometryFactory _geometryFactory;
        private readonly OrbitalPeriodSilenceDeadlinePolicy _fallback;
        private readonly Func<double> _warpStepFloorSeconds;

        /// <param name="geometryFactory">Builds the path geometry, or returns null when it cannot.</param>
        /// <param name="fallback">The deadline every path falls back to. Defaults to the standard clamp(600, 1.5T, 86400).</param>
        /// <param name="warpStepFloorSeconds">
        /// The finest UT step the current warp can actually resolve, i.e.
        /// <c>max(1, warpRate / fps)</c>. Defaults to 1 s (no warp). Read as a
        /// callback because warp changes between calls.
        /// </param>
        public PredictedReacquisitionSilenceDeadlinePolicy(
            GeometryFactory geometryFactory,
            OrbitalPeriodSilenceDeadlinePolicy fallback = null,
            Func<double> warpStepFloorSeconds = null)
        {
            _geometryFactory = geometryFactory ?? throw new ArgumentNullException(nameof(geometryFactory));
            _fallback = fallback ?? new OrbitalPeriodSilenceDeadlinePolicy();
            _warpStepFloorSeconds = warpStepFloorSeconds ?? (() => 1.0);
        }

        /// <summary>
        /// Matches the <see cref="SilenceDeadlinePolicy"/> delegate shape;
        /// inject <c>policy.Evaluate</c> into <see cref="SilenceTracker"/>.
        /// </summary>
        public SilenceDeadline Evaluate(SilenceSample sample, double ut)
        {
            var fallback = _fallback.Evaluate(sample, ut);

            if (sample.Orbit == null || sample.LandedOrSplashed)
            {
                return fallback;
            }

            var o = sample.Orbit.Value;
            if (o.Ecc >= 1.0 || !(o.Sma > 0.0) || !(o.Mu > 0.0))
            {
                // The fallback already ceilings these; predicting an emergence
                // for an escape trajectory would be inventing one.
                return fallback;
            }

            var period = 2.0 * Math.PI * Math.Sqrt(o.Sma * o.Sma * o.Sma / o.Mu);
            if (!IsUsable(period) || !IsUsable(ut))
            {
                return fallback;
            }

            var step = Math.Max(period / SweepStepsPerPeriod, Math.Max(_warpStepFloorSeconds(), 0.0));
            if (step > period / CoarsestUsefulStepsPerPeriod)
            {
                return WithBasis(fallback, SilenceDeadlineBasis.WarpLimited);
            }

            var window = SearchWindowPeriods * period;
            if (window / step > MaxSamplesPerEvaluation)
            {
                return WithBasis(fallback, SilenceDeadlineBasis.WarpLimited);
            }

            IVisibilityGeometry geometry;
            try
            {
                geometry = _geometryFactory(sample, ut);
            }
            catch (Exception)
            {
                // A geometry factory that throws is a broken input, not a
                // reason to declare a vessel lost on a different schedule.
                return fallback;
            }

            if (geometry == null)
            {
                return fallback;
            }

            VisibilitySweepResult sweep;
            try
            {
                sweep = VisibilitySweep.Run(geometry, ut, ut + window, step);
            }
            catch (Exception)
            {
                return fallback;
            }

            double? emergence = null;
            foreach (var change in sweep.Changes)
            {
                if (change.BecameClear && change.Ut > ut)
                {
                    emergence = change.Ut;
                    break;
                }
            }

            if (emergence == null)
            {
                // Two distinct silences, one deadline. Clear throughout means
                // geometry has nothing to say about why this vessel is quiet;
                // blocked throughout means it is behind something and stays
                // there for at least the window we searched. Both withhold a
                // prediction and keep the orbital-period deadline; naming them
                // apart is what lets an operator tell "nothing is in the way"
                // from "it is still behind the Mun".
                return WithBasis(
                    fallback,
                    sweep.ClearAtStart
                        ? SilenceDeadlineBasis.NoOccultation
                        : SilenceDeadlineBasis.NoEmergenceInWindow);
            }

            var grace = Math.Max(GracePeriodFraction * period, MinimumGraceSeconds);
            var duration = (emergence.Value - ut) + grace;

            // Never shorter than the policy floor: a predicted emergence 30 s
            // out is a reason to watch, not a reason to declare a vessel lost
            // 30 s later.
            if (duration < fallback.DurationSec && fallback.Basis == SilenceDeadlineBasis.PolicyFloor)
            {
                duration = fallback.DurationSec;
            }

            return new SilenceDeadline(duration, SilenceDeadlineBasis.PredictedReacquisition, emergence);
        }

        private static SilenceDeadline WithBasis(SilenceDeadline deadline, string basis) =>
            new SilenceDeadline(deadline.DurationSec, basis);

        private static bool IsUsable(double value) =>
            !double.IsNaN(value) && !double.IsInfinity(value) && value > 0.0;
    }
}
