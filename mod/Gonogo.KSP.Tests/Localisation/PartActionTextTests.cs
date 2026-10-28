using System.Collections.Generic;
using Xunit;

namespace Gonogo.KSP.Tests.Localisation
{
    [Collection(nameof(InstalledLocalizerCollection))]
    public class PartActionTextTests
    {
        [Fact]
        public void AGroupTagReadsAsTheTextTheGameShowsForIt()
        {
            using var _ = new InstalledLocalizer(new Dictionary<string, string>
            {
                ["#PARTMOD_GROUP_SCIENCE"] = "Science",
            });

            Assert.Equal("Science", PartActionText.Clean("#PARTMOD_GROUP_SCIENCE"));
        }

        [Fact]
        public void ATagTheTableCannotResolveReadsAsAbsentRatherThanAsTheTag()
        {
            using var _ = new InstalledLocalizer(new Dictionary<string, string>());

            Assert.Null(PartActionText.Clean("#PARTMOD_GROUP_CONFIGURATION"));
        }

        [Fact]
        public void RichTextMarkupIsRemovedAndTheWordsKept()
        {
            using var _ = new InstalledLocalizer(new Dictionary<string, string>());

            Assert.Equal("Configure Unmanned Experiments", PartActionText.Clean("Configure <b>Unmanned Experiments</b>"));
            Assert.Equal("Alert", PartActionText.Clean("<color=#ff0000>Alert</color>"));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("  ")]
        [InlineData("-")]
        [InlineData(" - ")]
        [InlineData("<b></b>")]
        public void AStringWithNoWordsReadsAsAbsent(string? stored)
        {
            using var _ = new InstalledLocalizer(new Dictionary<string, string>());

            Assert.Null(PartActionText.Clean(stored));
        }

        [Fact]
        public void PlainTextWithAHashInsideItIsLeftAlone()
        {
            using var _ = new InstalledLocalizer(new Dictionary<string, string>());

            Assert.Equal("Antenna #2", PartActionText.Clean("Antenna #2"));
        }
    }
}
