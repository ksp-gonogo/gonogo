using Sitrep.Host.CommandCentres;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Host.Tests.CommandCentres
{
    /// <summary>
    /// The command-centre interface is the KSP-free identity/roster + self-exclusion
    /// view of a vantage/authority. Routing data (the CommNet node / position) lives
    /// in the KSP-layer source that produces it, never on this interface, because
    /// Sitrep.Host references no KSP/Unity assemblies.
    /// </summary>
    public class CommandCentreContractTests
    {
        [Fact]
        public void Centre_ExposesIdKindAndActive()
        {
            ICommandCentre c = new FakeCommandCentre("ksc", CommandCentreKind.GroundStation);
            Assert.Equal("ksc", c.Id);
            Assert.Equal(CommandCentreKind.GroundStation, c.Kind);
            Assert.True(c.IsActiveNow());
        }
    }
}
