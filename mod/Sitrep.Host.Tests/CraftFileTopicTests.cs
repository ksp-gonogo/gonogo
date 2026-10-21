using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class CraftFileTopicTests
    {
        [Theory]
        [InlineData("Kerbal-X_2", "Kerbal-X_2")]
        [InlineData("Kerbal X v1.2", "Kerbal%20X%20v1%2E2")]
        [InlineData("Ré", "R%C3%A9")]
        [InlineData("a/b", "a%2Fb")]
        public void AFileNameIsOneTopicSegment(string file, string segment)
        {
            Assert.Equal(segment, CraftFileTopic.EscapeSegment(file));
        }

        [Fact]
        public void TheTopicIsKeyedByFacilityAndFile()
        {
            Assert.Equal("spaceCenter.craft.VAB.Wave%20v1%2E2.parts", CraftFileTopic.For("VAB", "Wave v1.2"));
            Assert.Equal("VAB.Probe.parts", CraftFileTopic.Key("VAB", "Probe"));
            Assert.NotEqual(CraftFileTopic.For("VAB", "Probe"), CraftFileTopic.For("SPH", "Probe"));
        }

        [Fact]
        public void TheFileSegmentHoldsNoDot()
        {
            Assert.DoesNotContain('.', CraftFileTopic.EscapeSegment("one.two.three"));
        }
    }
}
