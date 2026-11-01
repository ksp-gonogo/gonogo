using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class TargetOrbitFreshnessTests
    {
        [Fact]
        public void A_physics_loaded_vessel_target_is_rebuilt_from_its_state()
        {
            Assert.True(TargetOrbitFreshness.RebuildsFromState(isVessel: true, loaded: true, packed: false));
        }

        [Theory]
        [InlineData(true, true, true)]
        [InlineData(true, false, true)]
        [InlineData(true, false, false)]
        [InlineData(false, true, false)]
        public void Anything_else_keeps_the_stored_orbit(bool isVessel, bool loaded, bool packed)
        {
            Assert.False(TargetOrbitFreshness.RebuildsFromState(isVessel, loaded, packed));
        }
    }
}
