using System.Runtime.CompilerServices;
using Gonogo.KSP.SilenceTracking;
using Xunit;

namespace Gonogo.KSP.Tests.SilenceTracking
{
    /// <summary>
    /// A craft resting on its body is never handed to the orbit-based silence
    /// predictor, whichever surface situation the game files it under.
    /// </summary>
    public class SurfaceCraftSampleTests
    {
        private static Vessel Craft(Vessel.Situations situation, bool landed, bool splashed)
        {
            var vessel = (Vessel)RuntimeHelpers.GetUninitializedObject(typeof(Vessel));
            vessel.situation = situation;
            vessel.Landed = landed;
            vessel.Splashed = splashed;
            return vessel;
        }

        [Fact]
        public void ACraftOnThePadRestsOnTheSurface()
        {
            Assert.True(SilenceForecasts.RestsOnSurface(Craft(Vessel.Situations.PRELAUNCH, landed: true, splashed: false)));
        }

        [Fact]
        public void ALandedOrSplashedCraftRestsOnTheSurface()
        {
            Assert.True(SilenceForecasts.RestsOnSurface(Craft(Vessel.Situations.LANDED, landed: true, splashed: false)));
            Assert.True(SilenceForecasts.RestsOnSurface(Craft(Vessel.Situations.SPLASHED, landed: false, splashed: true)));
        }

        [Fact]
        public void AnOrbitingCraftDoesNot()
        {
            Assert.False(SilenceForecasts.RestsOnSurface(Craft(Vessel.Situations.ORBITING, landed: false, splashed: false)));
        }
    }
}
