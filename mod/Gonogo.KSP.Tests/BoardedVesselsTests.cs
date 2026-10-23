using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>A kerbal who boards a craft is told apart from a vessel that was lost.</summary>
    public class BoardedVesselsTests
    {
        public BoardedVesselsTests() => BoardedVessels.Clear();

        [Fact]
        public void TheDestructionBoardingCausesIsTheBoardings()
        {
            BoardedVessels.Note("kerbal", 500.0);

            Assert.True(BoardedVessels.Covers("kerbal", 500.0));
            Assert.True(BoardedVessels.Covers("kerbal", 500.0 + BoardedVessels.WindowUt));
        }

        [Fact]
        public void TheDestructionOfAnotherVesselIsNot()
        {
            BoardedVessels.Note("kerbal", 500.0);

            Assert.False(BoardedVessels.Covers("other", 500.0));
        }

        /// <summary>After a quickload the same kerbal can die for real, long after a boarding the abandoned timeline made.</summary>
        [Fact]
        public void ADestructionLongAfterTheBoardingIsNot()
        {
            BoardedVessels.Note("kerbal", 500.0);

            Assert.False(BoardedVessels.Covers("kerbal", 500.0 + BoardedVessels.WindowUt + 1));
        }

        [Fact]
        public void TheBoardedVesselIsHiddenFromTheCatalogForAWhileAndNotBefore()
        {
            BoardedVessels.Note("kerbal", 500.0);

            Assert.False(BoardedVessels.Boarded("kerbal", 499.0));
            Assert.True(BoardedVessels.Boarded("kerbal", 503.0));
            Assert.False(BoardedVessels.Boarded("kerbal", 500.0 + BoardedVessels.LingerUt + 1));
            Assert.False(BoardedVessels.Boarded("other", 503.0));
        }
    }
}
