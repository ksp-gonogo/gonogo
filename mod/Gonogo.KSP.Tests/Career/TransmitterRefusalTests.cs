using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    public class TransmitterRefusalTests
    {
        [Fact]
        public void ACraftWithAnAntennaButNoLinkYetSaysTheLinkIsNotUp()
        {
            Assert.Equal(TransmitterRefusal.LinkNotUp, TransmitterRefusal.For(antennaAboard: true, linkUp: false));
        }

        [Fact]
        public void ACraftWithNoAntennaSaysThereIsNoDevice()
        {
            Assert.Equal(TransmitterRefusal.NoDevice, TransmitterRefusal.For(antennaAboard: false, linkUp: false));
        }
    }
}
