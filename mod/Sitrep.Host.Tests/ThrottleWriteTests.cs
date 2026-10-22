using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class ThrottleWriteTests
    {
        [Fact]
        public void ARequestTheCraftReadsBackIsOk()
        {
            Assert.True(ThrottleWrite.Verify(0.5, 0.5).Success);
            Assert.True(ThrottleWrite.Verify(0.5, 0.505).Success);
        }

        [Fact]
        public void ARequestTheCraftDoesNotHoldIsRefusedNamingBothFigures()
        {
            var result = ThrottleWrite.Verify(0.5, 0.0);
            Assert.False(result.Success);
            Assert.Equal((RefusalCode?)CommandErrorCode.WrongState, result.ErrorCode);
            Assert.Contains("0.5", result.Detail);
            Assert.Contains("reads 0", result.Detail);
        }

        [Fact]
        public void AControlStateThatCannotBeReadIsNotProofOfFailure()
        {
            Assert.True(ThrottleWrite.Verify(1.0, null).Success);
        }
    }
}
