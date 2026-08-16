using System;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The geometry is covered by its own tests against margin functions with
    /// known roots; these cover the POLICY, i.e. which of the geometry's
    /// findings becomes a prediction, which becomes a basis, and — the point
    /// of the whole class — that none of them ever shortens a deadline.
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

            // grace = max(0.25 * 3600, 300) = 900
            Assert.Equal(900.0 + 900.0, deadline.DurationSec, 1);
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
                warpStepFloorSeconds: () => 60.0);

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
    }
}
