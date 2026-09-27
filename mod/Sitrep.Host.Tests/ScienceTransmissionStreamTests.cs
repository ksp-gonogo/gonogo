using System.Collections.Generic;
using Sitrep.Host.Science;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class ScienceTransmissionStreamTests
    {
        [Fact]
        public void OneResultIsItsPacketCountTimesTheInterval()
        {
            // 5 Mits in 2-Mit packets is three packets, 0.35 s apart.
            Assert.Equal(1.05, ScienceTransmissionStream.Seconds(new List<double> { 5 }, 2, 0.35), 9);
        }

        [Fact]
        public void APartialPacketStillCostsAWholeInterval()
        {
            Assert.Equal(2.0, ScienceTransmissionStream.Seconds(new List<double> { 1.01 }, 1, 1), 9);
        }

        [Fact]
        public void EachFurtherResultWaitsTwoIntervalsBeforeItsFirstPacket()
        {
            // 2 packets + 2 gap intervals + 3 packets, 0.5 s each.
            Assert.Equal(3.5, ScienceTransmissionStream.Seconds(new List<double> { 2, 3 }, 1, 0.5), 9);
        }

        [Fact]
        public void NothingToSendOrNoMeasurableTransmitterAnswersZero()
        {
            Assert.Equal(0, ScienceTransmissionStream.Seconds(new List<double>(), 1, 1));
            Assert.Equal(0, ScienceTransmissionStream.Seconds(new List<double> { 5 }, 0, 1));
            Assert.Equal(0, ScienceTransmissionStream.Seconds(new List<double> { 5 }, 1, 0));
        }
    }
}
