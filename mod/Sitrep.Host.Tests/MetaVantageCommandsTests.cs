using Sitrep.Contract;
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

        [Fact]
        public void AnUplinkCommandPassesOnlyWhenItsDeclarationOpensIt()
        {
            var open = new CommandDeclaration { Command = "test.quote", AllowMetaVantage = true };
            var closed = new CommandDeclaration { Command = "test.start" };

            Assert.True(MetaVantageCommands.IsApproved("test.quote", open));
            Assert.False(MetaVantageCommands.IsApproved("test.start", closed));
            Assert.False(MetaVantageCommands.IsApproved("test.start"));
        }
    }
}
