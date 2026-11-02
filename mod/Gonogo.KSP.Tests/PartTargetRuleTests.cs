using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class PartTargetRuleTests
    {
        [Fact]
        public void APackedVesselIsRefusedEvenThoughItCountsAsLoaded()
        {
            var refusal = PartTargetRule.RefusalFor(loaded: true, packed: true);

            Assert.NotNull(refusal);
            Assert.Equal(CommandErrorCode.NotClearToProceed, refusal!.Value.Code);
            Assert.Equal(PartTargetRule.OutOfPhysicsRange, refusal.Value.Detail);
        }

        [Fact]
        public void AnUnloadedVesselIsRefused()
        {
            Assert.NotNull(PartTargetRule.RefusalFor(loaded: false, packed: true));
        }

        [Fact]
        public void AnUnpackedLoadedVesselIsNotRefused()
        {
            Assert.Null(PartTargetRule.RefusalFor(loaded: true, packed: false));
        }
    }
}
