using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    public class TransmitterRefusalTests
    {
        [Fact]
        public void ACraftWithAnAntennaWhoseLinkIsStillComingUpSaysTryAgain()
        {
            Assert.Equal(
                TransmitterRefusal.LinkNotUp,
                TransmitterRefusal.For(antennaAboard: true, linkUp: false, linkSettling: true));
        }

        [Fact]
        public void ACraftWithAnAntennaThatStaysUnlinkedSaysItHasNoLink()
        {
            Assert.Equal(
                TransmitterRefusal.NoLink,
                TransmitterRefusal.For(antennaAboard: true, linkUp: false, linkSettling: false));
        }

        [Fact]
        public void ACraftWithNoAntennaSaysThereIsNoDevice()
        {
            Assert.Equal(
                TransmitterRefusal.NoDevice,
                TransmitterRefusal.For(antennaAboard: false, linkUp: false, linkSettling: true));
        }

        [Fact]
        public void TheSettleWindowOpensOnAMarkAndClosesAfterItsSeconds()
        {
            var window = new LinkSettleWindow();
            Assert.False(window.IsSettling(now: 100));

            window.Mark(now: 100);
            Assert.True(window.IsSettling(now: 100 + LinkSettleWindow.Seconds - 1));
            Assert.False(window.IsSettling(now: 100 + LinkSettleWindow.Seconds));
        }
    }
}
