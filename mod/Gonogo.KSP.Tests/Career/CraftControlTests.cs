using Gonogo.KSP.Career;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// The saved-craft scan reports what a craft needs to fly with the same rule
    /// the launch applies, so the picker cannot offer a craft the launch refuses.
    /// </summary>
    public class CraftControlTests
    {
        [Fact]
        public void AProbeCoreFliesTheCraftUnmanned()
        {
            var facts = CraftControl.Read(new[] { new CraftPart(0, 0), new CraftPart(0, null) });

            Assert.True(facts.CanFlyUnmanned);
            Assert.Equal(0, facts.MinimumCrew);
            Assert.Equal(0, facts.CrewSeats);
        }

        [Fact]
        public void ACockpitAloneNeedsItsCrewAndSeatsThem()
        {
            var facts = CraftControl.Read(new[] { new CraftPart(2, 1), new CraftPart(0, null) });

            Assert.False(facts.CanFlyUnmanned);
            Assert.Equal(1, facts.MinimumCrew);
            Assert.Equal(2, facts.CrewSeats);
        }

        [Fact]
        public void ACraftWithNoCommandModuleHasNoMinimumCrew()
        {
            var facts = CraftControl.Read(new[] { new CraftPart(3, null), new CraftPart(0, null) });

            Assert.False(facts.CanFlyUnmanned);
            Assert.Null(facts.MinimumCrew);
            Assert.Equal(3, facts.CrewSeats);
        }

        [Fact]
        public void AProbeCoreBesideACockpitStillFliesUnmanned()
        {
            var facts = CraftControl.Read(new[] { new CraftPart(1, 1), new CraftPart(0, 0) });

            Assert.True(facts.CanFlyUnmanned);
            Assert.Equal(0, facts.MinimumCrew);
        }

        [Fact]
        public void TheSmallestCrewAnyModuleNeedsIsTheMinimum()
        {
            var facts = CraftControl.Read(new[] { new CraftPart(3, 3), new CraftPart(1, 1) });

            Assert.Equal(1, facts.MinimumCrew);
        }
    }
}
