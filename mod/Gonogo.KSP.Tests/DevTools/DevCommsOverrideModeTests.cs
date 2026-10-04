using Xunit;

namespace Gonogo.KSP.Tests.DevTools
{
    /// <summary>
    /// A request file left at <c>restore</c> once forced the active craft's link
    /// CONNECTED for as long as the file stood. Behind the Mun the craft's path
    /// measured zero, the reveal gate was told it was in contact, and telemetry
    /// and commands crossed with no delay. No mode may force a link up.
    /// </summary>
    public class DevCommsOverrideModeTests
    {
        [Theory]
        [InlineData("restore")]
        [InlineData("auto")]
        [InlineData("")]
        [InlineData(null)]
        public void EveryModeButBlackoutLeavesTheLinkToTheRealBackend(string? mode)
        {
            Assert.Null(DevCommsOverride.ModeOf(mode, out var recognised));
            Assert.True(recognised);
        }

        [Fact]
        public void BlackoutForcesTheLinkDown()
        {
            Assert.False(DevCommsOverride.ModeOf("blackout", out var recognised));
            Assert.True(recognised);
        }

        [Fact]
        public void AModeNobodyKnowsIsTheRealBackendAndSaysSo()
        {
            Assert.Null(DevCommsOverride.ModeOf("connected", out var recognised));
            Assert.False(recognised);
        }
    }
}
