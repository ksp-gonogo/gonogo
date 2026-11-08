using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class MetaVantageCommandsTests
    {
        [Fact]
        public void TheApprovedCommandsAreExactlyTheTaggedCore()
        {
            var expected = new[]
            {
                "career.contract.accept", "career.contract.cancel", "career.contract.decline",
                "career.crew.fire", "career.crew.hire", "career.facility.upgrade",
                "career.strategy.activate", "career.strategy.deactivate", "career.tech.unlock",
                "ksp.quickload", "ksp.quicksave", "ksp.recover", "ksp.recoverVessel", "ksp.revertToEditor", "ksp.revertToLaunch",
                "ksp.switchVessel", "ksp.toSpaceCenter", "ksp.toTrackingStation",
                "settings.mod.write", "settings.save", "time.setPaused", "time.setWarpIndex",
            };

            Assert.Equal(expected, MetaVantageCommands.Approved);
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
