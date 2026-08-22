using System;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The geometry is covered by its own tests against margin functions with
    /// known roots; these cover the POLICY, i.e. which of the geometry's
    /// findings becomes a prediction, which becomes a basis, and, the point
    /// of the whole class, that none of them ever shortens a deadline.
    /// </summary>
    public class PredictedReacquisitionSilenceDeadlinePolicyTests
    {
        // Kerbin's mu, and an SMA that makes the period a round-ish 3600 s so
        // the assertions below can be read without a calculator.
        private const double Mu = 3.5316e12;

        private static OrbitElements Circular(double periodSeconds)
        {
            var sma = Math.Pow(Mu * periodSeconds * periodSeconds / (4.0 * Math.PI * Math.PI), 1.0 / 3.0);
            return new OrbitElements(sma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, Mu);
        }

        private static SilenceSample Sample(OrbitElements orbit, bool landed = false) =>
            new SilenceSample("v", connected: false, orbit: orbit, landedOrSplashed: landed, referenceBodyIndex: 1);

        private static double PeriodOf(OrbitElements o) =>
            2.0 * Math.PI * Math.Sqrt(o.Sma * o.Sma * o.Sma / o.Mu);

        /// <summary>
        /// A margin that is blocked until <c>clearsAt</c> and clear after, with
        /// a single continuous zero crossing there. Nothing about the sweep
        /// cares that this is not a real orbit; it cares that the sign changes
        /// exactly once, at a UT the test already knows.
        /// </summary>
        private sealed class OneCrossingGeometry : IVisibilityGeometry
        {
            private readonly double _clearsAt;

            public OneCrossingGeometry(double clearsAt) => _clearsAt = clearsAt;

            public double MarginAt(double ut) => ut - _clearsAt;

            public double SeparationAt(double ut) => 1_000_000.0;
        }

        /// <summary>Clear except for one blocked window, so the sweep starts CLEAR and still finds a later opening.</summary>
        private sealed class BlockedWindowGeometry : IVisibilityGeometry
        {
            private readonly double _from;
            private readonly double _to;

            public BlockedWindowGeometry(double from, double to)
            {
                _from = from;
                _to = to;
            }

            public double MarginAt(double ut)
            {
                if (ut <= _from) return _from - ut + 1.0;
                if (ut >= _to) return ut - _to + 1.0;
                return -Math.Min(ut - _from, _to - ut) - 1.0;
            }

            public double SeparationAt(double ut) => 1_000_000.0;
        }

        /// <summary>
        /// A craft too slow for its own orbit to be the fast term: the path
        /// opens and closes once per rotation of the station's body, with a
        /// single continuous crossing at each edge. Stands in for a real
        /// interplanetary geometry, whose cadence is the station's day for the
        /// same reason.
        /// </summary>
        private sealed class StationDayGeometry : IVisibilityGeometry, IVisibilityCadence
        {
            private readonly double _firstEmergence;
            private readonly double _rotationPeriod;

            public StationDayGeometry(double firstEmergence, double rotationPeriod)
            {
                _firstEmergence = firstEmergence;
                _rotationPeriod = rotationPeriod;
            }

            public double MarginAt(double ut) =>
                Math.Sin(2.0 * Math.PI * (ut - _firstEmergence) / _rotationPeriod);

            public double SeparationAt(double ut) => 1_000_000.0;

            public double? ShortestCycleSeconds => _rotationPeriod;
        }

        private sealed class ConstantMarginGeometry : IVisibilityGeometry
        {
            private readonly double _margin;

            public ConstantMarginGeometry(double margin) => _margin = margin;

            public double MarginAt(double ut) => _margin;

            public double SeparationAt(double ut) => 1_000_000.0;
        }

        [Fact]
        public void PredictsTheEmergenceTheSweepFinds()
        {
            var orbit = Circular(3600.0);
            var onset = 1_000.0;
            var emergence = onset + 900.0;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new OneCrossingGeometry(emergence));

            var deadline = policy.Evaluate(Sample(orbit), ut: onset);

            Assert.Equal(SilenceDeadlineBasis.PredictedReacquisition, deadline.Basis);
            Assert.NotNull(deadline.PredictedReacquisitionUt);
            Assert.Equal(emergence, deadline.PredictedReacquisitionUt!.Value, 1);
        }

        [Fact]
        public void DeadlineIsTheEmergencePlusAGrace()
        {
            var orbit = Circular(3600.0);
            var onset = 1_000.0;
            var emergence = onset + 900.0;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new OneCrossingGeometry(emergence));

            var deadline = policy.Evaluate(Sample(orbit), ut: onset);

            // grace = 4 * (3600/720) + 2 * 1 + 300 = 322
            Assert.Equal(900.0 + 322.0, deadline.DurationSec, 1);
        }

        /// <summary>
        /// The grace is reported, not just spent. It is the error budget around
        /// the predicted return, so it is the only thing on the wire that says
        /// how much confidence to place in that prediction: "back in 15 min" and
        /// "back in 15 min, and we would not call it late for another 5" are
        /// different statements, and without this field they render identically.
        /// </summary>
        [Fact]
        public void TheGraceItArmedIsReportedAlongsideTheDeadline()
        {
            var orbit = Circular(3600.0);
            var onset = 1_000.0;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new OneCrossingGeometry(onset + 900.0));

            var deadline = policy.Evaluate(Sample(orbit), ut: onset);

            Assert.NotNull(deadline.PredictionGraceSec);
            Assert.Equal(322.0, deadline.PredictionGraceSec!.Value, 1);
            // And it is the same number the deadline was built from, rather than
            // a second, separately-derived one that could drift from it.
            Assert.Equal(
                deadline.DurationSec,
                (deadline.PredictedReacquisitionUt!.Value - onset) + deadline.PredictionGraceSec.Value,
                1);
        }

        /// <summary>
        /// No prediction means no budget to report. A grace published next to a
        /// withheld prediction would be an error bar around nothing, which reads
        /// as more certainty than the withholding was meant to convey.
        /// </summary>
        [Fact]
        public void NoGraceIsReportedWhenThePredictionIsWithheld()
        {
            var orbit = Circular(3600.0);
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new ConstantMarginGeometry(1.0));

            var deadline = policy.Evaluate(Sample(orbit), ut: 1_000.0);

            Assert.Null(deadline.PredictedReacquisitionUt);
            Assert.Null(deadline.PredictionGraceSec);
        }

        /// <summary>
        /// The grace is an error budget, and the vessel's orbital period is not
        /// one of the errors. A quarter of a period gave a Minmus relay 845.8 s
        /// of slack against a measured prediction error of 3.3 s, and gave a
        /// solar-orbit craft about 29 days. The terms that do exist are the
        /// sweep's own resolution, the gap between the samples that would
        /// observe a reappearance, and the wait for CommNet to close a link the
        /// geometry has already opened.
        /// </summary>
        [Fact]
        public void AMinmusRelayGetsMinutesOfGraceRatherThanAQuarterOfItsOrbit()
        {
            var orbit = Circular(3_383.0);
            var onset = 1_000.0;
            var emergence = onset + 600.0;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new OneCrossingGeometry(emergence));

            var grace = policy.Evaluate(Sample(orbit), ut: onset).DurationSec - 600.0;

            // 4 * (3383/720) + 2 * 1 + 300 = 320.8, against 845.8 for a quarter period.
            Assert.InRange(grace, 300.0, 400.0);
        }

        [Fact]
        public void ASolarOrbitCraftIsNotGivenWeeksOfGrace()
        {
            var orbit = Circular(1.02e7);
            var onset = 10_000.0;
            var emergence = onset + 2_000.0;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new StationDayGeometry(emergence, KerbinSiderealDay));

            var grace = policy.Evaluate(Sample(orbit), ut: onset).DurationSec - 2_000.0;

            // 4 * (21549/720) + 2 * 1 + 300 = 421.7, against 0.25 * 1.02e7 = 29.5 days.
            Assert.InRange(grace, 300.0, 600.0);
        }

        /// <summary>
        /// Below the sampling quantum a Lost declaration is an artifact of when
        /// the game was looked at rather than a fact about the vessel: at
        /// 1000x the capture tick only sees the fleet every ~20 s of UT, and at
        /// 100000x every ~2000 s. A grace derived from the orbit alone is
        /// identical at every warp, which is the tell that it was never
        /// measuring this.
        /// </summary>
        [Fact]
        public void AGraceAtWarpCoversTheGapBetweenObservations()
        {
            var orbit = Circular(1.02e7);
            var onset = 10_000.0;
            var emergence = onset + 2_000.0;
            const double quantum = 200.0;
            PredictedReacquisitionSilenceDeadlinePolicy Policy(double observationQuantum) =>
                new PredictedReacquisitionSilenceDeadlinePolicy(
                    (sample, ut) => new StationDayGeometry(emergence, KerbinSiderealDay),
                    observationQuantumSeconds: () => observationQuantum);

            var atWarp = Policy(quantum).Evaluate(Sample(orbit), ut: onset).DurationSec - 2_000.0;
            var atRest = Policy(1.0).Evaluate(Sample(orbit), ut: onset).DurationSec - 2_000.0;

            Assert.True(atWarp >= quantum, $"a {quantum}s observation gap needs at least that much grace; got {atWarp}");
            Assert.True(atWarp > atRest, $"warp must widen the grace: {atRest} at rest vs {atWarp} at warp");
        }

        /// <summary>
        /// The discipline the withholding bases exist for, applied to the grace
        /// itself: a computed grace past the ceiling is not truncated to the
        /// ceiling and then declared on, because that publishes a deadline no
        /// term in the sum supports. It withholds, exactly as
        /// <see cref="SilenceDeadlineBasis.NoOccultation"/> and
        /// <see cref="SilenceDeadlineBasis.WarpLimited"/> do.
        /// </summary>
        [Fact]
        public void AGraceWiderThanTheCeilingWithholdsRatherThanTruncating()
        {
            var orbit = Circular(1.02e7);
            var onset = 10_000.0;
            var emergence = onset + 2_000.0;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new StationDayGeometry(emergence, KerbinSiderealDay),
                observationQuantumSeconds: () => 290.0);

            var deadline = policy.Evaluate(Sample(orbit), ut: onset);

            // 4 * 290 + 2 * 290 + 300 = 2040, past the 1800 s ceiling.
            Assert.Equal(SilenceDeadlineBasis.GraceExceedsCeiling, deadline.Basis);
            Assert.Null(deadline.PredictedReacquisitionUt);
            Assert.Equal(
                OrbitalPeriodSilenceDeadlinePolicy.DefaultCeilingSec,
                deadline.DurationSec,
                1);
        }

        /// <summary>
        /// Kerbin's sidereal day, the cadence every prediction against a Kerbin
        /// station actually has.
        /// </summary>
        private const double KerbinSiderealDay = 21_549.425;

        /// <summary>
        /// The sweep has to be stepped against the FASTEST term in the
        /// geometry, and for anything slower than the station's day that is the
        /// day. A solar-orbit craft (T = 1.02e7 s) stepped at T/720 gets 1.5
        /// samples per visibility cycle, so the sweep walks past the first
        /// emergence and reports the next one, a full Kerbin day late. The late
        /// answer is a real emergence (bisection keeps its bracket), just not
        /// the one the craft is due back on, which is what makes this look
        /// perfectly healthy from the outside.
        /// </summary>
        [Fact]
        public void ALongPeriodCraftIsSweptAtTheStationsDayRatherThanItsOwnPeriod()
        {
            // Only the period matters here; the fake geometry never reads the
            // elements, and 1.02e7 s is the solar-orbit case measured in the save.
            var orbit = Circular(1.02e7);
            var onset = 10_000.0;
            var emergence = onset + 2_000.0;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new StationDayGeometry(emergence, KerbinSiderealDay));

            var deadline = policy.Evaluate(Sample(orbit), ut: onset);

            Assert.Equal(SilenceDeadlineBasis.PredictedReacquisition, deadline.Basis);
            Assert.Equal(emergence, deadline.PredictedReacquisitionUt!.Value, 1);
        }

        /// <summary>
        /// The fallback ceilings its answer at a day; the predicted branch used
        /// to have no ceiling at all, so an emergence a week out armed a
        /// deadline a week out. A craft silent for a full day is declared lost
        /// whatever geometry says, and the prediction stays on the wire as the
        /// reason it is worth still watching for.
        /// </summary>
        [Fact]
        public void APredictedDeadlineIsCeilingedTheSameAsTheFallback()
        {
            var orbit = Circular(200_000.0);
            var onset = 1_000.0;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new OneCrossingGeometry(onset + 150_000.0));

            var deadline = policy.Evaluate(Sample(orbit), ut: onset);

            Assert.Equal(SilenceDeadlineBasis.PredictedReacquisition, deadline.Basis);
            Assert.Equal(onset + 150_000.0, deadline.PredictedReacquisitionUt!.Value, 1);
            Assert.Equal(OrbitalPeriodSilenceDeadlinePolicy.DefaultCeilingSec, deadline.DurationSec, 1);
        }

        /// <summary>
        /// The correction the whole feature was gated on. Under this save's
        /// relay ring an LKO craft is geometrically blind 0.0% of the time, so
        /// treating "no occultation" as "nothing to wait for, declare at the
        /// floor" would declare every LKO vessel lost ten minutes after any
        /// blip. It must fall through to the orbital-period deadline instead.
        /// </summary>
        [Fact]
        public void NoOccultationKeepsTheOrbitalPeriodDeadlineInsteadOfCollapsingToTheFloor()
        {
            var orbit = Circular(3600.0);
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new ConstantMarginGeometry(1.0));

            var deadline = policy.Evaluate(Sample(orbit), ut: 1_000.0);

            Assert.Equal(SilenceDeadlineBasis.NoOccultation, deadline.Basis);
            Assert.Null(deadline.PredictedReacquisitionUt);
            Assert.Equal(
                OrbitalPeriodSilenceDeadlinePolicy.DefaultPeriodMultiplier * PeriodOf(orbit),
                deadline.DurationSec,
                1);
            Assert.True(
                deadline.DurationSec > OrbitalPeriodSilenceDeadlinePolicy.DefaultFloorSec,
                "no-occultation must never land on the policy floor");
        }

        [Fact]
        public void BlockedForTheWholeWindowIsNamedApartFromNoOcclusion()
        {
            var orbit = Circular(3600.0);
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new ConstantMarginGeometry(-1.0));

            var deadline = policy.Evaluate(Sample(orbit), ut: 1_000.0);

            Assert.Equal(SilenceDeadlineBasis.NoEmergenceInWindow, deadline.Basis);
            Assert.Null(deadline.PredictedReacquisitionUt);
            Assert.Equal(
                OrbitalPeriodSilenceDeadlinePolicy.DefaultPeriodMultiplier * PeriodOf(orbit),
                deadline.DurationSec,
                1);
        }

        [Fact]
        public void GeometryThatCannotBeBuiltFallsBackWithoutAPrediction()
        {
            var orbit = Circular(3600.0);
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy((sample, ut) => null);

            var deadline = policy.Evaluate(Sample(orbit), ut: 1_000.0);

            Assert.Equal(SilenceDeadlineBasis.OrbitalPeriod, deadline.Basis);
            Assert.Null(deadline.PredictedReacquisitionUt);
        }

        [Fact]
        public void GeometryThatThrowsFallsBackRatherThanPropagating()
        {
            var orbit = Circular(3600.0);
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => throw new InvalidOperationException("no stations"));

            var deadline = policy.Evaluate(Sample(orbit), ut: 1_000.0);

            Assert.Equal(SilenceDeadlineBasis.OrbitalPeriod, deadline.Basis);
            Assert.Null(deadline.PredictedReacquisitionUt);
        }

        [Fact]
        public void WarpTooFastToResolveAnOccultationEmitsWarpLimitedRatherThanANumber()
        {
            var orbit = Circular(3600.0);
            var emergence = 1_900.0;
            // 3600/72 = 50 s is the coarsest step still called a resolution.
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new OneCrossingGeometry(emergence),
                observationQuantumSeconds: () => 60.0);

            var deadline = policy.Evaluate(Sample(orbit), ut: 1_000.0);

            Assert.Equal(SilenceDeadlineBasis.WarpLimited, deadline.Basis);
            Assert.Null(deadline.PredictedReacquisitionUt);
        }

        [Fact]
        public void AnEscapeTrajectoryIsNeverGivenAPredictedEmergence()
        {
            var hyperbolic = new OrbitElements(-1_000_000.0, 1.4, 0, 0, 0, 0, 0, Mu);
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new OneCrossingGeometry(1_500.0));

            var deadline = policy.Evaluate(Sample(hyperbolic), ut: 1_000.0);

            Assert.Equal(SilenceDeadlineBasis.PolicyCeiling, deadline.Basis);
            Assert.Null(deadline.PredictedReacquisitionUt);
        }

        [Fact]
        public void ALandedVesselIsNeverGivenAPredictedEmergence()
        {
            var orbit = Circular(3600.0);
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new OneCrossingGeometry(1_500.0));

            var deadline = policy.Evaluate(Sample(orbit, landed: true), ut: 1_000.0);

            Assert.Equal(SilenceDeadlineBasis.PolicyCeiling, deadline.Basis);
            Assert.Null(deadline.PredictedReacquisitionUt);
        }

        /// <summary>
        /// An emergence a few seconds away is a reason to watch, not a reason
        /// to declare the vessel lost a few seconds later. The floor still
        /// binds.
        /// </summary>
        [Fact]
        public void AnImminentEmergenceStillRespectsThePolicyFloor()
        {
            // A short orbit so 1.5T lands under the 600 s floor.
            var orbit = Circular(200.0);
            var onset = 1_000.0;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new OneCrossingGeometry(onset + 5.0));

            var deadline = policy.Evaluate(Sample(orbit), ut: onset);

            Assert.Equal(SilenceDeadlineBasis.PredictedReacquisition, deadline.Basis);
            Assert.Equal(onset + 5.0, deadline.PredictedReacquisitionUt!.Value, 1);
            Assert.True(
                deadline.DurationSec >= OrbitalPeriodSilenceDeadlinePolicy.DefaultFloorSec,
                $"expected at least the {OrbitalPeriodSilenceDeadlinePolicy.DefaultFloorSec}s floor, got {deadline.DurationSec}");
        }

        /// <summary>
        /// The case that made every vessel in a real save look unpredicted:
        /// silence begins on the first tick after a scene load, before CommNet
        /// exists, so the geometry factory has nothing to work with. The
        /// deadline is armed once on that edge, so without a re-evaluation the
        /// vessel holds an orbital-period deadline for its whole run even after
        /// the geometry becomes available a second later.
        /// </summary>
        [Fact]
        public void ADeadlineArmedBeforeGeometryExistsIsUpgradedOnceItDoes()
        {
            var orbit = Circular(3600.0);
            var emergence = 2_500.0;
            var geometryReady = false;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => geometryReady ? new OneCrossingGeometry(emergence) : null);
            var tracker = new SilenceTracker(policy.Evaluate);
            var silent = new SilenceSample("v", connected: false, orbit: orbit, landedOrSplashed: false);

            tracker.Tick(new[] { silent }, ut: 1_000.0);
            Assert.Equal(SilenceDeadlineBasis.OrbitalPeriod, tracker.TryGetState("v")!.DeadlineBasis);
            Assert.Null(tracker.TryGetState("v")!.PredictedReacquisitionUt);

            geometryReady = true;
            tracker.Tick(new[] { silent }, ut: 1_005.0);

            var state = tracker.TryGetState("v")!;
            Assert.Equal(SilenceDeadlineBasis.PredictedReacquisition, state.DeadlineBasis);
            Assert.Equal(emergence, state.PredictedReacquisitionUt!.Value, 1);
        }

        /// <summary>
        /// A prediction, once made, is never revised: the no-jitter property
        /// the single-shot arming existed for in the first place.
        /// </summary>
        [Fact]
        public void APredictionIsNeverRevisedOnceMade()
        {
            var orbit = Circular(3600.0);
            var emergence = 1_900.0;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new OneCrossingGeometry(emergence));
            var tracker = new SilenceTracker(policy.Evaluate);
            var silent = new SilenceSample("v", connected: false, orbit: orbit, landedOrSplashed: false);

            tracker.Tick(new[] { silent }, ut: 1_000.0);
            var first = tracker.TryGetState("v")!.PredictedReacquisitionUt;
            emergence = 9_999.0;
            tracker.Tick(new[] { silent }, ut: 1_005.0);

            Assert.Equal(first, tracker.TryGetState("v")!.PredictedReacquisitionUt);
        }

        /// <summary>
        /// A late-arriving prediction must never move the deadline EARLIER. The
        /// upgrade evaluates from the silence ORIGIN, so its duration is
        /// measured from a UT hours in the past; writing that over the armed
        /// deadline moved it backwards, and in the worst case behind the
        /// current tick, declaring the vessel Lost in the same call that first
        /// managed to predict its return.
        /// </summary>
        [Fact]
        public void AnUpgradeNeverShortensTheArmedDeadline()
        {
            var orbit = Circular(7_200.0);
            var ready = false;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => ready ? new OneCrossingGeometry(101_800.0) : null);
            var tracker = new SilenceTracker(policy.Evaluate);
            var silent = new SilenceSample("v", connected: false, orbit: orbit, landedOrSplashed: false);

            tracker.Tick(new[] { silent }, ut: 100_000.0);
            var armed = tracker.TryGetState("v")!.DeadlineUt!.Value;

            ready = true;
            tracker.Tick(new[] { silent }, ut: 107_260.0);

            var state = tracker.TryGetState("v")!;
            Assert.True(
                state.DeadlineUt!.Value >= armed,
                $"deadline moved earlier: {armed} -> {state.DeadlineUt.Value}");
        }

        /// <summary>
        /// And never into the past, which is the same bug seen from the other
        /// side: a deadline behind the current tick is instantly overdue and
        /// declares Lost with no amber window at all.
        /// </summary>
        [Fact]
        public void AnUpgradeNeverLandsTheDeadlineInThePast()
        {
            var orbit = Circular(7_200.0);
            var ready = false;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => ready ? new OneCrossingGeometry(101_800.0) : null);
            var tracker = new SilenceTracker(policy.Evaluate);
            var silent = new SilenceSample("v", connected: false, orbit: orbit, landedOrSplashed: false);

            tracker.Tick(new[] { silent }, ut: 100_000.0);
            ready = true;
            tracker.Tick(new[] { silent }, ut: 107_260.0);
            tracker.Tick(new[] { silent }, ut: 107_261.0);

            var state = tracker.TryGetState("v")!;
            Assert.True(
                state.DeadlineUt!.Value > 107_261.0,
                $"deadline {state.DeadlineUt.Value} is already behind the tick");
            Assert.NotEqual(SilenceState.Lost, state.State);
        }

        /// <summary>
        /// The upgrade must be spent whether or not it produced a prediction.
        /// Setting the flag only on success turned "one re-evaluation per
        /// silence run" into a full ~1400-sample sweep on EVERY silent tick for
        /// every vessel the predictor cannot help, which at warp is the stutter
        /// the whole sliced-solver design exists to avoid.
        /// </summary>
        /// <summary>
        /// The retry must survive a geometry that is not ready yet. Spending it
        /// unconditionally burned the single attempt on the tick right after a
        /// save load - the one moment CommNet has not been built - so every
        /// vessel kept an orbital-period deadline for its whole run.
        /// </summary>
        [Fact]
        public void AnUpgradeThatCouldNotLookAtGeometryIsNotSpent()
        {
            var orbit = Circular(3_600.0);
            var ready = false;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => ready ? new OneCrossingGeometry(2_500.0) : null);
            var tracker = new SilenceTracker(policy.Evaluate);
            var silent = new SilenceSample("v", connected: false, orbit: orbit, landedOrSplashed: false);

            tracker.Tick(new[] { silent }, ut: 1_000.0);
            tracker.Tick(new[] { silent }, ut: 1_001.0);
            tracker.Tick(new[] { silent }, ut: 1_002.0);

            ready = true;
            tracker.Tick(new[] { silent }, ut: 1_003.0);

            Assert.Equal(
                SilenceDeadlineBasis.PredictedReacquisition,
                tracker.TryGetState("v")!.DeadlineBasis);
        }

        /// <summary>
        /// A verdict without a prediction must still reach the state. Leaving
        /// no-occultation unwritten meant the wire reported the armed
        /// orbital-period basis forever, so a working sweep was
        /// indistinguishable from one that never ran.
        /// </summary>
        [Fact]
        public void ANonPredictingVerdictIsStillRecorded()
        {
            var orbit = Circular(3_600.0);
            var ready = false;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => ready ? new ConstantMarginGeometry(1.0) : null);
            var tracker = new SilenceTracker(policy.Evaluate);
            var silent = new SilenceSample("v", connected: false, orbit: orbit, landedOrSplashed: false);

            tracker.Tick(new[] { silent }, ut: 1_000.0);
            Assert.Equal(SilenceDeadlineBasis.OrbitalPeriod, tracker.TryGetState("v")!.DeadlineBasis);

            ready = true;
            tracker.Tick(new[] { silent }, ut: 1_001.0);

            var state = tracker.TryGetState("v")!;
            Assert.Equal(SilenceDeadlineBasis.NoOccultation, state.DeadlineBasis);
            Assert.Null(state.PredictedReacquisitionUt);
        }

        [Fact]
        public void AFailedUpgradeIsStillSpent()
        {
            var orbit = Circular(3_600.0);
            var calls = 0;
            // A geometry that IS available and simply finds no occultation:
            // a real verdict, and the expensive one to re-ask.
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) =>
                {
                    calls++;
                    return new ConstantMarginGeometry(1.0);
                });
            var tracker = new SilenceTracker(policy.Evaluate);
            var silent = new SilenceSample("v", connected: false, orbit: orbit, landedOrSplashed: false);

            tracker.Tick(new[] { silent }, ut: 1_000.0);
            var afterArming = calls;
            for (var ut = 1_001.0; ut < 1_010.0; ut += 1.0)
            {
                tracker.Tick(new[] { silent }, ut);
            }

            Assert.True(
                calls - afterArming <= 1,
                $"policy re-evaluated {calls - afterArming} times across 9 silent ticks");
        }

        /// <summary>
        /// A silence that geometry does not explain must not borrow a
        /// geometric explanation. If the path was already CLEAR when contact
        /// was lost, the craft did not go behind anything, it lost power, or
        /// its antenna went out of range, and the next time the sweep happens
        /// to open a path is not that craft's return.
        /// </summary>
        [Fact]
        public void AnEmergenceIsNotPredictedWhenThePathWasAlreadyClearAtLoss()
        {
            var orbit = Circular(3_600.0);
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new BlockedWindowGeometry(1_600.0, 1_900.0));

            var deadline = policy.Evaluate(Sample(orbit), ut: 1_000.0);

            Assert.Null(deadline.PredictedReacquisitionUt);
            Assert.NotEqual(SilenceDeadlineBasis.PredictedReacquisition, deadline.Basis);
        }

        [Fact]
        public void APredictionReachesTheTrackerAndClearsOnReconnect()
        {
            var orbit = Circular(3600.0);
            var emergence = 1_900.0;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new OneCrossingGeometry(emergence));
            var tracker = new SilenceTracker(policy.Evaluate);
            var sample = new SilenceSample("v", connected: false, orbit: orbit, landedOrSplashed: false);

            tracker.Tick(new[] { sample }, ut: 1_000.0);
            var silent = tracker.TryGetState("v")!;
            Assert.Equal(emergence, silent.PredictedReacquisitionUt!.Value, 1);

            tracker.Tick(
                new[] { new SilenceSample("v", connected: true, orbit: orbit, landedOrSplashed: false) },
                ut: 1_950.0);
            Assert.Null(tracker.TryGetState("v")!.PredictedReacquisitionUt);
        }

        /// <summary>
        /// The onset instant is validated for FINITENESS, not for sign.
        ///
        /// <para>One guard used to serve both the onset instant and the cycle
        /// duration, and its <c>&gt; 0.0</c> arm is correct for only one of them.
        /// KSP's universal time starts at zero on a new save, so at <c>ut == 0</c>
        /// the policy withheld every prediction and returned the fallback: a
        /// plausible deadline rather than an error, which is why the loss was
        /// silent.</para>
        ///
        /// <para>Each case asserts the BASIS, not the duration. The fallback and a
        /// real prediction can agree on a number, so a test that only checked
        /// seconds could not tell which path ran, and that indistinguishability
        /// was the original defect rather than a way to detect it.</para>
        [Theory]
        [InlineData(0.0)]      // the origin: a new save's first moment
        [InlineData(1e-9)]     // just above it, the control
        [InlineData(-5_000.0)] // documents the rule; not reachable from the game clock
        public void PredictsFromAnyFiniteOnsetIncludingZeroAndBelow(double onset)
        {
            var orbit = Circular(3600.0);
            var emergence = onset + 900.0;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new OneCrossingGeometry(emergence));

            var deadline = policy.Evaluate(Sample(orbit), ut: onset);

            Assert.Equal(SilenceDeadlineBasis.PredictedReacquisition, deadline.Basis);
            Assert.Equal(emergence, deadline.PredictedReacquisitionUt!.Value, 1);
        }

        /// <summary>
        /// The finiteness arm still bites. Either of these would poison the sweep
        /// bounds and the <c>emergence - ut</c> subtraction, so the fallback is
        /// the right answer here, unlike at zero.
        /// </summary>
        [Theory]
        [InlineData(double.NaN)]
        [InlineData(double.PositiveInfinity)]
        [InlineData(double.NegativeInfinity)]
        public void WithholdsAPredictionForANonFiniteOnset(double onset)
        {
            var orbit = Circular(3600.0);
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new OneCrossingGeometry(1_900.0));

            var deadline = policy.Evaluate(Sample(orbit), ut: onset);

            Assert.NotEqual(SilenceDeadlineBasis.PredictedReacquisition, deadline.Basis);
            Assert.Null(deadline.PredictedReacquisitionUt);
        }

        /// <summary>
        /// The duration guard keeps its <c>&gt; 0.0</c> arm: a cadence of zero
        /// divides the sweep step to nothing, so it is not a short cycle, it is
        /// not a cycle. The orbital period stands in instead, which is
        /// <see cref="PredictedReacquisitionSilenceDeadlinePolicy"/>'s own rule
        /// for a geometry that declares no usable cadence.
        /// </summary>
        [Theory]
        [InlineData(0.0)]
        [InlineData(-60.0)]
        public void ANonPositiveCadenceFallsBackToThePeriodRatherThanSizingAStepFromIt(double cadence)
        {
            var orbit = Circular(3600.0);
            var onset = 1_000.0;
            var emergence = onset + 900.0;
            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => new CadencedOneCrossingGeometry(emergence, cadence));

            var deadline = policy.Evaluate(Sample(orbit), ut: onset);

            // Sized against the 3600 s period, so the grace matches the
            // period-stepped case exactly: 4 * (3600/720) + 2 * 1 + 300 = 322.
            Assert.Equal(SilenceDeadlineBasis.PredictedReacquisition, deadline.Basis);
            Assert.Equal(900.0 + 322.0, deadline.DurationSec, 1);
        }

        /// <summary>
        /// <see cref="OneCrossingGeometry"/> plus a declared cadence, so a test
        /// can drive the duration guard in <c>CycleOf</c>.
        /// </summary>
        private sealed class CadencedOneCrossingGeometry : IVisibilityGeometry, IVisibilityCadence
        {
            private readonly OneCrossingGeometry _inner;

            public CadencedOneCrossingGeometry(double clearsAt, double cadence)
            {
                _inner = new OneCrossingGeometry(clearsAt);
                ShortestCycleSeconds = cadence;
            }

            public double? ShortestCycleSeconds { get; }

            public double MarginAt(double ut) => _inner.MarginAt(ut);

            public double SeparationAt(double ut) => _inner.SeparationAt(ut);
        }

    }
}
