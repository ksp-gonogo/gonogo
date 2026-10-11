using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The warp rung a scene reports. The game's own static answers rung 1 in
    /// a scene with no warp controller, the editor among them, and rung 1 is
    /// the first step above real time everywhere else.
    /// </summary>
    public class WarpRungTests
    {
        [Theory]
        [InlineData(0)]
        [InlineData(1)]
        [InlineData(7)]
        public void ASceneWithNoWarpControllerIsAtRealTimeWhateverTheGameAnswers(int answered)
        {
            Assert.Equal(0, WarpRung.Index(hasController: false, answered));
        }

        [Theory]
        [InlineData(0)]
        [InlineData(1)]
        [InlineData(7)]
        public void ASceneWithAWarpControllerReportsTheRungItIsOn(int answered)
        {
            Assert.Equal(answered, WarpRung.Index(hasController: true, answered));
        }
    }
}
