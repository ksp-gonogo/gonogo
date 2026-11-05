using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class MetaVantageCommandsTests
    {
        [Fact]
        public void EveryApprovedCommandSaysWhyItIsExempt()
        {
            Assert.NotEmpty(MetaVantageCommands.Approved);
            foreach (var entry in MetaVantageCommands.Approved)
            {
                Assert.False(string.IsNullOrWhiteSpace(entry.Value), entry.Key);
            }
        }

        [Fact]
        public void AnApprovedCommandPassesAndAnyOtherIsRefused()
        {
            Assert.True(MetaVantageCommands.IsApproved("time.setPaused"));
            Assert.False(MetaVantageCommands.IsApproved("ksp.launch"));
            Assert.False(MetaVantageCommands.IsApproved(null));
        }
    }
}
