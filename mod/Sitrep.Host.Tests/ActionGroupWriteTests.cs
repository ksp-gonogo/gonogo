using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class ActionGroupWriteTests
    {
        [Fact]
        public void TurningSasOnWithNoSourceIsRefusedWithTheReason()
        {
            var refusal = ActionGroupWrite.SasRefusal(enabling: true, canEngage: false);

            Assert.NotNull(refusal);
            Assert.False(refusal!.Success);
            Assert.Equal(CommandErrorCode.CapabilityMismatch, refusal.ErrorCode);
            Assert.Contains("Pilot", refusal.Detail);
        }

        [Fact]
        public void TheUnavailableReasonIsTheRefusalDetailAndAbsentWhenSasCanEngage()
        {
            Assert.Null(ActionGroupWrite.SasUnavailableReason(canEngage: true));
            Assert.Equal(
                ActionGroupWrite.SasRefusal(enabling: true, canEngage: false)!.Detail,
                ActionGroupWrite.SasUnavailableReason(canEngage: false));
        }

        [Theory]
        [InlineData(true, true)]
        [InlineData(false, true)]
        [InlineData(false, false)]
        public void SasWritesThatCanProceedAreNotRefused(bool enabling, bool canEngage)
        {
            Assert.Null(ActionGroupWrite.SasRefusal(enabling, canEngage));
        }

        [Theory]
        [InlineData(true, true)]
        [InlineData(false, false)]
        [InlineData(true, null)]
        public void AGroupThatReadsBackAsRequestedSucceeds(bool requested, bool? readBack)
        {
            Assert.True(ActionGroupWrite.Verify("SAS", requested, readBack).Success);
        }

        [Fact]
        public void AGroupThatDidNotTakeFailsInsteadOfReportingSuccess()
        {
            var result = ActionGroupWrite.Verify("SAS", requested: true, readBack: false);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.WrongState, result.ErrorCode);
            Assert.Contains("SAS", result.Detail);
        }
    }
}
