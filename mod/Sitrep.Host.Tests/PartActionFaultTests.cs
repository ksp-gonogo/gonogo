using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class PartActionFaultTests
    {
        [Fact]
        public void AThrowFromAPartThatLeftTheVesselIsASuccess()
        {
            var result = PartActionFault.AfterThrow(partLeftVessel: true, "that part's action threw: Object reference not set");

            Assert.True(result.Success);
        }

        [Fact]
        public void AThrowFromAPartStillOnTheVesselIsARefusalWithMatchingCodeAndSentence()
        {
            var result = PartActionFault.AfterThrow(partLeftVessel: false, "that part's action threw: no fuel");

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.Equal("that part's action threw: no fuel", result.Detail);
        }
    }
}
