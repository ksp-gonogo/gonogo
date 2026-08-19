using System.Collections.Generic;
using Sitrep.Host.Maneuver;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Turning a burn's delta-v into the two instants a finite burn actually
    /// has. The properties asserted here are physical, not arithmetic: a
    /// craft gets lighter as it burns, so the halves of a burn do NOT take
    /// equal time, and the same burn flown later takes less time than it would
    /// have earlier.
    /// </summary>
    public class BurnTimingTests
    {
        /// <summary>A stage with a mass ratio, so the rocket equation applies.</summary>
        private static BurnTiming.StageBudget Stage(
            double deltaV, double burnTime, double startMass, double endMass) =>
            new BurnTiming.StageBudget
            {
                DeltaV = deltaV,
                BurnTime = burnTime,
                StartMass = startMass,
                EndMass = endMass,
            };

        /// <summary>
        /// The FIRST half of a burn takes longer than the second, because the
        /// craft is heavier for it. A model that splits the duration evenly
        /// about the node is asserting constant mass, which is exactly the
        /// assumption a burn long enough to model breaks.
        /// </summary>
        [Fact]
        public void TheFirstHalfOfABurnTakesLongerThanTheSecond()
        {
            var stages = new List<BurnTiming.StageBudget> { Stage(2000, 100, 10, 5) };

            var window = Assert.Single(BurnTiming.WindowsFor(stages, new List<double> { 1000 }));

            Assert.NotNull(window);
            Assert.True(
                window!.LeadToHalfSeconds > window.TotalSeconds / 2,
                $"lead {window.LeadToHalfSeconds} should exceed half of {window.TotalSeconds}");
        }

        /// <summary>
        /// With no mass change there is nothing for the rocket equation to
        /// bite on, so the split IS even. Pinned because it is the degenerate
        /// case the test above is contrasted against, and because a model that
        /// got this wrong would be wrong everywhere.
        /// </summary>
        [Fact]
        public void AConstantMassStageSplitsEvenly()
        {
            var stages = new List<BurnTiming.StageBudget> { Stage(2000, 100, 10, 10) };

            var window = Assert.Single(BurnTiming.WindowsFor(stages, new List<double> { 1000 }));

            Assert.NotNull(window);
            Assert.Equal(window!.TotalSeconds / 2, window.LeadToHalfSeconds, 6);
        }

        /// <summary>
        /// Burns are a sequence and each one spends what the last left. The
        /// same delta-v flown second takes LESS time, because the craft
        /// carrying it is lighter.
        /// </summary>
        [Fact]
        public void TheSameBurnFlownSecondTakesLessTimeThanFlownFirst()
        {
            var stages = new List<BurnTiming.StageBudget> { Stage(3000, 300, 12, 4) };

            var windows = BurnTiming.WindowsFor(stages, new List<double> { 500, 500 });

            Assert.Equal(2, windows.Count);
            Assert.NotNull(windows[0]);
            Assert.NotNull(windows[1]);
            Assert.True(
                windows[1]!.TotalSeconds < windows[0]!.TotalSeconds,
                $"second burn {windows[1]!.TotalSeconds} should be shorter than first {windows[0]!.TotalSeconds}");
        }

        /// <summary>
        /// A burn the craft cannot afford has no duration, and saying so is the
        /// point. Substituting the time to burn everything it does have would
        /// report a burn it cannot fly as one it can.
        /// </summary>
        [Fact]
        public void ABurnBeyondTheRemainingDeltaVHasNoWindow()
        {
            var stages = new List<BurnTiming.StageBudget> { Stage(1000, 100, 10, 6) };

            Assert.Null(Assert.Single(BurnTiming.WindowsFor(stages, new List<double> { 1500 })));
        }

        /// <summary>
        /// An unaffordable burn does not poison the ones before it. Its own
        /// window is null and the earlier answers stand.
        /// </summary>
        [Fact]
        public void AnUnaffordableBurnDoesNotInvalidateTheOnesBeforeIt()
        {
            var stages = new List<BurnTiming.StageBudget> { Stage(1000, 100, 10, 6) };

            var windows = BurnTiming.WindowsFor(stages, new List<double> { 400, 5000 });

            Assert.NotNull(windows[0]);
            Assert.Null(windows[1]);
        }

        /// <summary>
        /// A burn spanning a staging event accumulates across both stages, so
        /// its duration exceeds what either could deliver alone.
        /// </summary>
        [Fact]
        public void ABurnSpanningAStagingEventAccumulatesAcrossBoth()
        {
            var stages = new List<BurnTiming.StageBudget>
            {
                Stage(500, 50, 10, 8),
                Stage(900, 120, 6, 3),
            };

            var window = Assert.Single(BurnTiming.WindowsFor(stages, new List<double> { 900 }));

            Assert.NotNull(window);
            Assert.True(window!.TotalSeconds > 50, "must include the whole first stage");
        }

        /// <summary>
        /// No stage data at all is not a zero-length burn. It is no answer, and
        /// it is what an unloaded craft produces, since stock computes delta-v
        /// only for a loaded vessel.
        /// </summary>
        [Fact]
        public void NoStageDataYieldsNoWindowRatherThanAZeroLengthBurn()
        {
            var windows = BurnTiming.WindowsFor(
                new List<BurnTiming.StageBudget>(), new List<double> { 100 });

            Assert.Null(Assert.Single(windows));
        }
    }
}
