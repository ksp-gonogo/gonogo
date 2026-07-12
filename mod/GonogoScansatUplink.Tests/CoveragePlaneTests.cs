using Gonogo.ScansatUplink;
using Xunit;

namespace GonogoScansatUplink.Tests
{
    public class CoveragePlaneTests
    {
        [Fact]
        public void Pack_SetsBitMsbFirst_IlonMajor()
        {
            var snapshot = new short[360, 180];
            snapshot[0, 0] = 1; // AltimetryLoRes at ilon=0,ilat=0 -> bitIndex 0

            byte[] packed = CoveragePlane.Pack(snapshot, 1);

            Assert.Equal(0x80, packed[0]); // MSB of byte 0 set
        }

        [Fact]
        public void Pack_SecondCell_SetsSecondBit()
        {
            var snapshot = new short[360, 180];
            snapshot[0, 1] = 1; // ilon=0, ilat=1 -> bitIndex = 0*180+1 = 1

            byte[] packed = CoveragePlane.Pack(snapshot, 1);

            Assert.Equal(0x40, packed[0]); // second-from-MSB bit set
        }

        [Fact]
        public void Pack_OnlyMatchesRequestedType()
        {
            var snapshot = new short[360, 180];
            snapshot[0, 0] = 256; // ResourceHiRes only

            byte[] packedAlt = CoveragePlane.Pack(snapshot, 1); // AltimetryLoRes
            byte[] packedResource = CoveragePlane.Pack(snapshot, 256);

            Assert.Equal(0x00, packedAlt[0]);
            Assert.Equal(0x80, packedResource[0]);
        }

        [Fact]
        public void PlaneChanged_NullLastEmitted_IsTrue()
        {
            var current = new byte[10];
            Assert.True(CoveragePlane.PlaneChanged(null, current));
        }

        [Fact]
        public void PlaneChanged_IdenticalPlanes_IsFalse()
        {
            var a = new byte[] { 1, 2, 3 };
            var b = new byte[] { 1, 2, 3 };
            Assert.False(CoveragePlane.PlaneChanged(a, b));
        }

        [Fact]
        public void PlaneChanged_BitCleared_IsTrue()
        {
            // The R7 correction: shrink (bits un-set) must be detected too,
            // not just growth - a set-only delta model would miss this.
            var lastEmitted = new byte[] { 0xFF };
            var current = new byte[] { 0x7F };
            Assert.True(CoveragePlane.PlaneChanged(lastEmitted, current));
        }
    }
}
