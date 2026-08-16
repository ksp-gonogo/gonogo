using System;
using System.Linq;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// The search itself, against margin functions whose zeros are known
    /// exactly. Orbits are exercised separately in
    /// <see cref="OrbitVisibilityTests"/>; here nothing is propagated, so a
    /// failure can only be the sweep or the refiner.
    /// </summary>
    public class VisibilitySweepSearchTests
    {
        [Fact]
        public void RefinesEveryZeroOfASineToWithinTheTolerance()
        {
            // sin(2*pi*t/600) crosses at every multiple of 300 s.
            var geometry = new AnalyticGeometry(t => Math.Sin(2.0 * Math.PI * t / 600.0));

            VisibilitySweepResult result = VisibilitySweep.Run(
                geometry, startUt: 1.0, endUt: 1_500.0, stepSeconds: 5.0, refinementToleranceSeconds: 0.01);

            double[] crossings = result.Changes.Select(c => c.Ut).ToArray();
            Assert.Equal(new[] { 300.0, 600.0, 900.0, 1200.0 }, crossings.Select(c => Math.Round(c, 2)));
            Assert.True(result.ClearAtStart);
            Assert.Equal(new[] { false, true, false, true }, result.Changes.Select(c => c.BecameClear));
        }

        [Fact]
        public void EachRefinedCrossingStaysInsideTheGridBracketThatFoundIt()
        {
            var geometry = new AnalyticGeometry(t => Math.Sin(2.0 * Math.PI * t / 600.0));

            VisibilitySweepResult result = VisibilitySweep.Run(geometry, 1.0, 1_500.0, 5.0);

            Assert.NotEmpty(result.Changes);
            foreach (VisibilityChange change in result.Changes)
            {
                Assert.InRange(change.Ut, change.BracketLowUt, change.BracketHighUt);
                Assert.True(change.BracketHighUt - change.BracketLowUt <= 5.0 + 1e-9);
            }
        }

        [Fact]
        public void TheEndOfTheWindowIsSweptEvenWhenItDoesNotLandOnTheStepGrid()
        {
            // A crossing at 997 s with a 10 s step from 0: the last whole step is
            // 990, so only a final sample pinned to endUt can see it.
            var geometry = new AnalyticGeometry(t => 997.0 - t);

            VisibilitySweepResult result = VisibilitySweep.Run(geometry, 0.0, 999.0, 10.0);

            VisibilityChange change = Assert.Single(result.Changes);
            Assert.Equal(997.0, change.Ut, 1);
            Assert.False(change.BecameClear);
        }

        [Fact]
        public void ARunLongerThanTheStepIsFound()
        {
            // A 130 s blackout swept at 60 s: longer than one step, so at least
            // one sample must land inside it wherever the grid happens to fall.
            var geometry = new AnalyticGeometry(t => (t >= 1_000.0 && t <= 1_130.0) ? -1.0 : 1.0);

            VisibilitySweepResult result = VisibilitySweep.Run(geometry, 0.0, 3_000.0, 60.0, 0.01);

            Assert.Equal(2, result.Changes.Count);
            Assert.Equal(1_000.0, result.Changes[0].Ut, 1);
            Assert.Equal(1_130.0, result.Changes[1].Ut, 1);
        }

        [Fact]
        public void ARunShorterThanTheStepCanBeMissedEntirelyWhichIsTheDocumentedLimit()
        {
            // A 5 s blackout falling between two 60 s samples. The sweep reports
            // no change at all, silently: this is the price of the guarantee, and
            // it is asserted here so that nobody later mistakes it for a bug and
            // "fixes" it by bisecting the boolean instead of shrinking the step.
            var geometry = new AnalyticGeometry(t => (t >= 1_010.0 && t <= 1_015.0) ? -1.0 : 1.0);

            VisibilitySweepResult coarse = VisibilitySweep.Run(geometry, 0.0, 3_000.0, 60.0);
            Assert.Empty(coarse.Changes);
            Assert.Equal(120.0, coarse.GuaranteedDetectableRunSeconds);

            VisibilitySweepResult fine = VisibilitySweep.Run(geometry, 0.0, 3_000.0, 1.0, 0.01);
            Assert.Equal(2, fine.Changes.Count);
        }

        [Fact]
        public void AlwaysClearAndAlwaysBlockedBothReportZeroChanges()
        {
            VisibilitySweepResult clear = VisibilitySweep.Run(new AnalyticGeometry(_ => 12_345.0), 0.0, 10_000.0, 5.0);
            VisibilitySweepResult blocked = VisibilitySweep.Run(new AnalyticGeometry(_ => -12_345.0), 0.0, 10_000.0, 5.0);

            Assert.True(clear.ClearAtStart);
            Assert.Empty(clear.Changes);
            Assert.False(blocked.ClearAtStart);
            Assert.Empty(blocked.Changes);
        }

        [Fact]
        public void AGrazingTouchThatOnlyReachesZeroProducesNoCrossing()
        {
            // (t-500)^2 touches zero once and never goes negative, so the path
            // never actually enters the occluder and there is nothing to report.
            var geometry = new AnalyticGeometry(t => (t - 500.0) * (t - 500.0));

            VisibilitySweepResult result = VisibilitySweep.Run(geometry, 0.0, 1_000.0, 5.0);

            Assert.True(result.ClearAtStart);
            Assert.Empty(result.Changes);
        }

        [Fact]
        public void ClearAtReplaysTheStateWithoutReevaluatingTheGeometry()
        {
            var geometry = new AnalyticGeometry(t => (t >= 1_000.0 && t <= 1_500.0) ? -1.0 : 1.0);
            VisibilitySweepResult result = VisibilitySweep.Run(geometry, 0.0, 3_000.0, 10.0, 0.01);

            int evaluationsAfterSweep = geometry.Evaluations;

            Assert.True(result.ClearAt(500.0));
            Assert.False(result.ClearAt(1_200.0));
            Assert.True(result.ClearAt(2_000.0));
            Assert.Equal(evaluationsAfterSweep, geometry.Evaluations);
        }

        [Fact]
        public void AnEmptyOrBackwardsWindowStillReportsTheStartingState()
        {
            var geometry = new AnalyticGeometry(_ => -1.0);

            VisibilitySweepResult result = VisibilitySweep.Run(geometry, 500.0, 500.0, 5.0);

            Assert.False(result.ClearAtStart);
            Assert.Empty(result.Changes);
            Assert.Equal(1, result.SamplesTaken);
        }

        [Theory]
        [InlineData(0.0)]
        [InlineData(-5.0)]
        [InlineData(double.PositiveInfinity)]
        public void ANonPositiveOrInfiniteStepIsRejected(double step)
        {
            var geometry = new AnalyticGeometry(_ => 1.0);

            Assert.Throws<ArgumentOutOfRangeException>(() => VisibilitySweep.Run(geometry, 0.0, 100.0, step));
        }

        [Fact]
        public void AWindowThatWouldNeedMoreSamplesThanTheCapIsRejectedRatherThanHanging()
        {
            var geometry = new AnalyticGeometry(_ => 1.0);

            ArgumentOutOfRangeException error = Assert.Throws<ArgumentOutOfRangeException>(
                () => VisibilitySweep.Run(geometry, 0.0, 1e12, 0.001));
            Assert.Contains("cap", error.Message);
        }
    }
}
