using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// Which vessels the roster and the target list may publish: those whose
    /// orbit the game knows, the same question stock asks before drawing one.
    /// </summary>
    public class OrbitKnowledgeTests
    {
        [Fact]
        public void AnOwnedCraftIsKnown() => Assert.True(OrbitKnowledge.Known(DiscoveryLevels.Owned));

        [Fact]
        public void ATrackedSpaceObjectIsKnown() => Assert.True(OrbitKnowledge.Known(DiscoveryLevels.Unowned));

        [Fact]
        public void AnUntrackedSignalIsNot() => Assert.False(OrbitKnowledge.Known(DiscoveryLevels.Presence));

        [Fact]
        public void ANamedButUntrackedObjectIsNot() =>
            Assert.False(OrbitKnowledge.Known(DiscoveryLevels.Presence | DiscoveryLevels.Name));
    }
}
