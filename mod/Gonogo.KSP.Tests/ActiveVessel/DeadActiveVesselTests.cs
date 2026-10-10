using System.Runtime.CompilerServices;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests.ActiveVessel
{
    /// <summary>
    /// A craft the game has destroyed is not the craft on screen, even while the
    /// game still holds it as its active vessel: nothing that asks which craft
    /// is active may quote a dead one.
    /// </summary>
    public class DeadActiveVesselTests
    {
        private static Vessel WithState(Vessel.State state)
        {
            var vessel = (Vessel)RuntimeHelpers.GetUninitializedObject(typeof(Vessel));
            vessel.state = state;
            return vessel;
        }

        [Fact]
        public void ADestroyedCraftIsNoLongerReportedAsActive()
        {
            Assert.Null(ActiveVesselScope.Living(WithState(Vessel.State.DEAD)));
        }

        [Fact]
        public void ALivingCraftIsReportedAsActive()
        {
            var vessel = WithState(Vessel.State.ACTIVE);
            Assert.Same(vessel, ActiveVesselScope.Living(vessel));
        }

        [Fact]
        public void NoCraftStaysNoCraft()
        {
            Assert.Null(ActiveVesselScope.Living(null));
        }
    }
}
