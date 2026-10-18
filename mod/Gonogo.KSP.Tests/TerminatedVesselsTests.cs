using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>A craft the player ends from the Tracking Station is told apart from one that was lost.</summary>
    public class TerminatedVesselsTests
    {
        public TerminatedVesselsTests() => TerminatedVessels.Clear();

        [Fact]
        public void ADestructionAtTheInstantOfTheTerminationIsTheTerminations()
        {
            TerminatedVessels.Note("v", 500.0);

            Assert.True(TerminatedVessels.Covers("v", 500.0));
            Assert.True(TerminatedVessels.Covers("v", 500.0 + TerminatedVessels.WindowUt));
        }

        [Fact]
        public void ADestructionOfAnotherCraftIsNot()
        {
            TerminatedVessels.Note("v", 500.0);

            Assert.False(TerminatedVessels.Covers("w", 500.0));
        }

        /// <summary>After a quickload the same craft can be destroyed for real, long after a termination the abandoned timeline made.</summary>
        [Fact]
        public void ADestructionLongAfterTheTerminationIsNot()
        {
            TerminatedVessels.Note("v", 500.0);

            Assert.False(TerminatedVessels.Covers("v", 500.0 + TerminatedVessels.WindowUt + 1));
        }

        [Fact]
        public void AForgottenTerminationCoversNothing()
        {
            TerminatedVessels.Note("v", 500.0);
            TerminatedVessels.Forget("v");

            Assert.False(TerminatedVessels.Covers("v", 500.0));
        }
    }
}
