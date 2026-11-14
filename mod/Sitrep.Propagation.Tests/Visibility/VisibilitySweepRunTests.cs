using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// A sweep taken a few steps at a time is the sweep taken in one call: the
    /// same samples, the same crossings, to the last bit.
    /// </summary>
    public class VisibilitySweepRunTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double KerbinRadius = 600_000.0;
        private const double KerbinSiderealDay = 21_549.425;

        /// <summary>A low orbit over one ground station, which the planet hides for most of each pass.</summary>
        private static OrbitToRemoteStationGeometry LowOrbitOverOneStation() =>
            new OrbitToRemoteStationGeometry(
                PropagationTarget.Vessel(
                    "craft", 1, new OrbitElements(KerbinRadius + 250_000.0, 0.01, 0.4, 0.3, 0.2, 0.1, 0.0, KerbinMu)),
                PropagationFrame.CentredOn(1),
                new OccludingBody[0],
                RotatingGroundStation.FromLatitudeLongitude(0.0, 40.0, 0.0, KerbinSiderealDay, KerbinRadius, 0.0),
                KerbinRadius);

        private static string Describe(VisibilitySweepResult sweep)
        {
            var parts = new List<string> { sweep.ClearAtStart.ToString(), sweep.SamplesTaken.ToString(), sweep.StartUt.ToString("R"), sweep.EndUt.ToString("R") };
            foreach (var change in sweep.Changes)
            {
                parts.Add(change.BecameClear + "@" + change.Ut.ToString("R") + "[" + change.BracketLowUt.ToString("R") + "," + change.BracketHighUt.ToString("R") + "]");
            }
            return string.Join(" ", parts);
        }

        [Theory]
        [InlineData(1)]
        [InlineData(7)]
        [InlineData(16)]
        [InlineData(1439)]
        [InlineData(1440)]
        [InlineData(int.MaxValue)]
        public void ASlicedSweepIsTheWholeSweep(int stepsPerSlice)
        {
            var geometry = LowOrbitOverOneStation();
            const double start = 5_000.0;
            const double end = start + (2 * 2_900.0);
            const double step = (end - start) / 1440.0;

            var whole = VisibilitySweep.Run(geometry, start, end, step);
            var run = new VisibilitySweepRun(geometry, start, end, step);
            var slices = 0;
            while (!run.Advance(stepsPerSlice))
            {
                Assert.Null(run.Result);
                slices++;
            }

            Assert.True(whole.Changes.Count >= 2, "the orbit never crossed the horizon, so there is nothing to compare");
            Assert.Equal(Describe(whole), Describe(run.Result!));
            Assert.Equal(stepsPerSlice >= 1440 ? 0 : (1440 - 1) / stepsPerSlice, slices);
        }

        [Fact]
        public void AnEmptyWindowIsOneSample()
        {
            var geometry = LowOrbitOverOneStation();

            var run = new VisibilitySweepRun(geometry, 100.0, 100.0, 10.0);

            Assert.True(run.Advance(1));
            Assert.Equal(Describe(VisibilitySweep.Run(geometry, 100.0, 100.0, 10.0)), Describe(run.Result!));
            Assert.Equal(1, run.Result!.SamplesTaken);
        }

        [Fact]
        public void AWindowPastTheSampleCapIsRefusedBeforeAnySampleIsTaken()
        {
            var geometry = LowOrbitOverOneStation();

            Assert.Throws<ArgumentOutOfRangeException>(() => new VisibilitySweepRun(geometry, 0.0, 1e9, 1.0));
        }
    }
}
