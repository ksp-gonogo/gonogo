using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class CraftCaptureStampTests
    {
        [Fact]
        public void ACaptureWithASnapshotIsStampedWithTheSnapshotsTime()
        {
            Assert.Equal(1234.5, CraftCaptureStamp.Ut(1234.5, () => 9999.0));
        }

        [Fact]
        public void ACaptureWithNoSnapshotIsStampedWithTheGameClockNotZero()
        {
            Assert.Equal(9999.0, CraftCaptureStamp.Ut(null, () => 9999.0));
        }
    }
}
