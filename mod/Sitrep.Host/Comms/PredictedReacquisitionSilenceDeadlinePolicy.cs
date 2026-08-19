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
    /// went round the far side, when it is due out, and, the part that
    /// actually matters, that it did not show up. A deadline of "1.5 orbits"
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
        /// when it cannot be built honestly, no known stations, an
        /// unsupported reference body, a backend that declares no occlusion
        /// model. Null means "no prediction attempted", which is a different
        /// thing from "no occultation found", and the two produce different
        /// bases.
        /// </summary>
        public delegate IVisibilityGeometry GeometryFactory(SilenceSample sample, double ut);

        /// <summary>
        /// Cycles of forward search, where a cycle is whatever the visibility
        /// geometry repeats on (see <see cref="CycleOf"/>). One cycle would
        /// find an occultation that recurs every time round but could sit
        /// exactly inside a gap for one that does not; two costs nothing extra
        /// worth counting and covers the case where the vessel went dark just
        /// after an emergence.
        ///
        /// <para>Measured against the same cycle as the step, not against the
        /// orbit, which is what keeps the sample count constant: two cycles at
        /// <see cref="SweepStepsPerCycle"/> steps is ~1440 samples whether the
        /// craft is in low orbit or in solar orbit. Sizing the window on a long
        /// orbital period instead would need half a million samples to keep the
        /// same resolution and would simply be refused.</para>
        /// </summary>
        public const double SearchWindowCycles = 2.0;

        /// <summary>
        /// Half a degree of the visibility cycle: the step the predictor spec
        /// settles on, which puts every low orbit at 3-6 s and a Kerbin station
        /// at 30 s, and so resolves any occultation worth naming.
        /// </summary>
        public const double SweepStepsPerCycle = 720.0;

        /// <summary>
        /// The coarsest step still considered a resolution rather than a
        /// guess: five degrees of the cycle. A warp that forces a step longer
        /// than this cannot see an occultation shorter than a tenth of a cycle,
        /// which is most of them, so the honest answer is
        /// <see cref="SilenceDeadlineBasis.WarpLimited"/> and no number.
        /// </summary>
        public const double CoarsestUsefulStepsPerCycle = 72.0;

        /// <summary>
        /// Sweep steps of grace. The sweep resolves a crossing to within a step
        /// (the refiner narrows the reported UT, but the crossing it refines
        /// was found by a grid that could only bracket it to one step), and a
        /// short run can hide between two samples entirely, so four steps
        /// covers the search's own resolution with a factor of two over it.
        /// </summary>
        public const double GraceSweepSteps = 4.0;

        /// <summary>
        /// Observation quanta of grace. A reappearance is only seen on the next
        /// sample after it happens, so one quantum is the wait to observe it and
        /// the second is the same wait on the sample that armed the deadline.
        /// Below this the vessel is not late, it is merely unlooked-at.
        /// </summary>
        public const double GraceObservationQuanta = 2.0;

        /// <summary>
        /// Seconds allowed between the geometric path opening and CommNet
        /// reporting the vessel connected again.
        ///
        /// <para>An ALLOWANCE, not a measurement. The predicted event and the
        /// observed one are not the same event: the sweep predicts line of
        /// sight to a ground station, while what ends the silence is the
        /// backend's own verdict, which routes through relays and applies a
        /// link budget at the shallowest, longest-ranged part of the pass. A
        /// few minutes is the scale of a low-elevation acquisition; nothing
        /// here has measured it, and if it is ever measured this constant is
        /// the one to move.</para>
        /// </summary>
        public const double LinkClosureAllowanceSeconds = 300.0;

        /// <summary>
        /// The least grace worth arming, seconds. The terms above already clear
        /// it at every warp, so it binds only if they are ever retuned
        /// downward: it exists so that a future smaller allowance cannot
        /// silently shrink the grace to a couple of sweep steps, which is
        /// shorter than the operator loop of noticing a craft is late.
        /// </summary>
        public const double MinimumGraceSeconds = 120.0;

        /// <summary>
        /// The most grace that can still be called a deadline, seconds. Half an
        /// hour of slack on an emergence prediction means the moment a craft
        /// would be declared lost is far enough from the moment it was due that
        /// the two are no longer the same event, and on a station-day cycle a
        /// whole further occultation can begin inside it.
        ///
        /// <para>Exceeding it does NOT truncate to it: see
        /// <see cref="SilenceDeadlineBasis.GraceExceedsCeiling"/>. In practice
        /// it binds only at extreme warp against a slow cycle, which is exactly
        /// where the prediction deserves the least trust.</para>
        /// </summary>
        public const double MaximumGraceSeconds = 1800.0;

        /// <summary>
        /// Hard cap on margin evaluations for a single call, so a pathological
        /// orbit cannot turn one capture tick into an unbounded loop. Two
        /// cycles at half-degree steps is ~1440 samples, so this leaves an
        /// order of magnitude of headroom before it ever binds.
        /// </summary>
        public const int MaxSamplesPerEvaluation = 20_000;

        private readonly GeometryFactory _geometryFactory;
        private readonly OrbitalPeriodSilenceDeadlinePolicy _fallback;
        private readonly Func<double> _observationQuantumSeconds;
        private readonly IPropagationProvider _propagator;

        /// <param name="geometryFactory">Builds the path geometry, or returns null when it cannot.</param>
        /// <param name="fallback">The deadline every path falls back to. Defaults to the standard clamp(600, 1.5T, 86400).</param>
        /// <param name="observationQuantumSeconds">
        /// The UT gap between consecutive observations of a vessel's contact
        /// state, i.e. <c>max(sampleIntervalUt, warpRate * fixedDeltaTime)</c>:
        /// about 20 s at 1000x and 2000 s at 100000x. Defaults to 1 s (no
        /// warp). Read as a callback because warp changes between calls.
        ///
        /// <para>One number doing two jobs, deliberately. It floors the sweep
        /// step, because resolving a crossing finer than the samples that would
        /// confirm it buys nothing, and it is a term in the grace, because a
        /// vessel cannot be late by less than the interval at which anyone is
        /// looking.</para>
        /// </param>
        /// <param name="propagator">
        /// The elected propagation capability, which owns both "can this be
        /// propagated at all" and "what does its motion repeat on". Defaults to the
        /// two-body vanilla.
        /// </param>
        public PredictedReacquisitionSilenceDeadlinePolicy(
            GeometryFactory geometryFactory,
            OrbitalPeriodSilenceDeadlinePolicy fallback = null,
            Func<double> observationQuantumSeconds = null,
            IPropagationProvider propagator = null)
        {
            _geometryFactory = geometryFactory ?? throw new ArgumentNullException(nameof(geometryFactory));
            _fallback = fallback ?? new OrbitalPeriodSilenceDeadlinePolicy();
            _observationQuantumSeconds = observationQuantumSeconds ?? (() => 1.0);
            _propagator = propagator ?? new KeplerProvider();
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

            var target = SilenceSampleTarget.Of(sample);
            if (!_propagator.CanPropagate(target, ut, ut))
            {
                // The fallback already ceilings these; predicting an emergence
                // for a trajectory the propagator will not follow would be
                // inventing one.
                return fallback;
            }

            var period = _propagator.CharacteristicCycleSeconds(target);
            if (!IsUsableInstant(ut))
            {
                return fallback;
            }

            // The geometry is built BEFORE the step is chosen, because only the
            // geometry knows which term moves fastest: the sweep is stepped
            // against the station's day for anything slower than it, and the
            // vessel's period is no guide to that. The cost is that a
            // warp-limited call now pays for a geometry it will not sweep,
            // which is a fraction of the ~1440-sample sweep it replaces and is
            // spent at most twice per silence run.
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

            var cycleOrNone = CycleOf(geometry, period);
            if (cycleOrNone == null)
            {
                // Neither the trajectory nor any station in the geometry repeats on
                // anything, so there is no scale to size a step against. Choosing
                // one anyway would publish a detection guarantee the sweep cannot
                // honour, and the sweep's guarantee is stated in steps. Withhold and
                // let the fallback deadline stand, which is always a correct answer.
                return fallback;
            }

            var cycle = cycleOrNone.Value;
            var quantum = Math.Max(_observationQuantumSeconds(), 0.0);
            var step = Math.Max(cycle / SweepStepsPerCycle, quantum);
            if (step > cycle / CoarsestUsefulStepsPerCycle)
            {
                return WithBasis(fallback, SilenceDeadlineBasis.WarpLimited);
            }

            var window = SearchWindowCycles * cycle;
            if (window / step > MaxSamplesPerEvaluation)
            {
                return WithBasis(fallback, SilenceDeadlineBasis.WarpLimited);
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

            // A silence geometry does not explain must not borrow a geometric
            // explanation. If the path was already CLEAR when contact was lost,
            // the craft did not go behind anything - it lost power, or its
            // antenna went out of range, or a link budget failed in plain line
            // of sight. The next time this sweep happens to open a path is some
            // OTHER pass, not that craft's return, and quoting it would be a
            // confident answer to a question the geometry was never asked.
            //
            // Roughly half of all non-geometric losses on a periodically-blocked
            // orbit start clear, so this is the common case rather than a
            // corner: exactly the silences the feature exists to report on.
            double? emergence = null;
            if (!sweep.ClearAtStart)
            {
                foreach (var change in sweep.Changes)
                {
                    if (change.BecameClear && change.Ut > ut)
                    {
                        emergence = change.Ut;
                        break;
                    }
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

            // The grace is the sum of the errors that actually exist between
            // "the path re-opens" and "this craft is reported connected again",
            // and the vessel's orbital period is not one of them. A quarter of
            // a period gave a Minmus relay 845.8 s of slack against a measured
            // 3.3 s of prediction error, and gave a solar-orbit craft 29 days,
            // for the same reason in both cases: it was scaling by a quantity
            // no term in the error is proportional to.
            var grace = (GraceSweepSteps * step)
                + (GraceObservationQuanta * quantum)
                + LinkClosureAllowanceSeconds;
            if (grace < MinimumGraceSeconds)
            {
                grace = MinimumGraceSeconds;
            }

            if (grace > MaximumGraceSeconds)
            {
                // Withheld, not truncated. Clipping the budget to the ceiling
                // and arming anyway would publish a deadline tighter than the
                // error around the moment it is measured from, a number nothing
                // in the sum supports, which is the fabrication the
                // no-occultation and warp-limited paths exist to avoid.
                return WithBasis(fallback, SilenceDeadlineBasis.GraceExceedsCeiling);
            }

            var duration = (emergence.Value - ut) + grace;

            // Never shorter than the policy floor: a predicted emergence 30 s
            // out is a reason to watch, not a reason to declare a vessel lost
            // 30 s later.
            if (duration < fallback.DurationSec && fallback.Basis == SilenceDeadlineBasis.PolicyFloor)
            {
                duration = fallback.DurationSec;
            }

            // And never longer than the fallback would ever run. A craft silent
            // for a day is declared lost whatever the geometry found, which is
            // the fallback's own rule; without this the predicted branch was the
            // one path that could arm a deadline a week out. The prediction
            // itself stays on the wire: an emergence past the ceiling is still
            // the reason to keep watching, it is just no longer the reason to
            // keep the vessel off the lost list.
            if (duration > _fallback.CeilingSec)
            {
                duration = _fallback.CeilingSec;
            }

            return new SilenceDeadline(duration, SilenceDeadlineBasis.PredictedReacquisition, emergence);
        }

        /// <summary>
        /// The cycle the sweep has to resolve: what the geometry says its own
        /// motion repeats on, or the orbital period for a geometry that does
        /// not declare a cadence at all, or null when neither exists.
        ///
        /// <para>Guarded rather than trusted. A cadence of zero or NaN would
        /// divide the step to nothing, and one LONGER than the orbit would
        /// coarsen a step that was already fine enough, so anything that is not
        /// a usable value strictly shorter than the period leaves the period in
        /// place. The step only ever gets finer than it was.</para>
        /// </summary>
        private static double? CycleOf(IVisibilityGeometry geometry, double? period)
        {
            var cadence = geometry as IVisibilityCadence;
            if (cadence == null)
            {
                return period;
            }

            var cycle = cadence.ShortestCycleSeconds;
            if (cycle == null || !IsUsableDuration(cycle.Value))
            {
                return period;
            }
            if (period == null || !IsUsableDuration(period.Value))
            {
                return cycle;
            }
            return cycle.Value < period.Value ? cycle : period;
        }

        private static SilenceDeadline WithBasis(SilenceDeadline deadline, string basis) =>
            new SilenceDeadline(deadline.DurationSec, basis);

        /// <summary>
        /// A DURATION this policy can size a sweep step against.
        ///
        /// <para><c>&gt; 0.0</c> is a real constraint here: a cadence of zero or
        /// less divides the step to nothing (see <see cref="CycleOf"/>), so a
        /// non-positive length is not a short cycle, it is not a cycle.</para>
        /// </summary>
        private static bool IsUsableDuration(double seconds) =>
            !double.IsNaN(seconds) && !double.IsInfinity(seconds) && seconds > 0.0;

        /// <summary>
        /// An INSTANT this policy can sweep from.
        ///
        /// <para>Finiteness only, deliberately. This used to share the duration
        /// guard above, and <c>&gt; 0.0</c> is meaningless for an instant: zero is
        /// not a small quantity, it is the origin, and KSP's universal time
        /// starts there on a new save. <see cref="VisibilitySweep"/> already
        /// draws the same line one layer down, NaN-checking its window bounds
        /// while demanding its refinement tolerance be strictly positive, and
        /// the sibling <see cref="OrbitalPeriodSilenceDeadlinePolicy"/> says as
        /// much by defaulting its own <c>ut</c> to <c>0.0</c>.</para>
        ///
        /// <para>Rejecting <c>ut &lt;= 0</c> cost a whole prediction and said
        /// nothing: the policy returned the fallback deadline, which is a
        /// plausible answer rather than an error, so the loss was silent.</para>
        ///
        /// <para>Nothing downstream divides by <c>ut</c> or cares about its sign:
        /// it is a sweep origin, an ordering operand (<c>change.Ut &gt; ut</c>),
        /// and a subtrahend (<c>emergence - ut</c>, an instant minus an instant
        /// giving a duration). NaN and infinity still want rejecting, because
        /// each would poison the sweep bounds and that subtraction.</para>
        /// </summary>
        private static bool IsUsableInstant(double ut) =>
            !double.IsNaN(ut) && !double.IsInfinity(ut);
    }
}
