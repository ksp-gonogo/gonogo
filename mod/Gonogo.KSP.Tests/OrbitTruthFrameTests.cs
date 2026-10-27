using System;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class OrbitTruthFrameTests
    {
        [Fact]
        public void AFrozenInverseRotationAngleIsUndoneRatherThanPublished()
        {
            var original = Planetarium.Zup;
            try
            {
                var stored = new Vector3d(700000.0, 0.0, 0.0);

                Planetarium.CelestialFrame.PlanetaryFrame(0.0, 90.0, 0.0, ref Planetarium.Zup);
                var atZero = OrbitTruthFrame.ToFixedFrame(stored);

                Planetarium.CelestialFrame.PlanetaryFrame(0.0, 90.0, 37.0, ref Planetarium.Zup);
                var atFrozen = OrbitTruthFrame.ToFixedFrame(stored);
                var expected = Planetarium.Zup.LocalToWorld(stored);

                Assert.Equal(expected.x, atFrozen[0], 6);
                Assert.Equal(expected.y, atFrozen[1], 6);
                Assert.Equal(expected.z, atFrozen[2], 6);

                var shift = Math.Sqrt(
                    Math.Pow(atFrozen[0] - atZero[0], 2) + Math.Pow(atFrozen[1] - atZero[1], 2) + Math.Pow(atFrozen[2] - atZero[2], 2));
                Assert.True(shift > 100000.0, $"a 37 degree frozen angle must move a 700 km vector by hundreds of km, moved {shift} m");
            }
            finally
            {
                Planetarium.Zup = original;
            }
        }

        [Fact]
        public void TheTruthIsTheStoredVectorsTakenOutOfTheFrameTheyAreHeldIn()
        {
            var original = Planetarium.Zup;
            try
            {
                Planetarium.CelestialFrame.PlanetaryFrame(0.0, 90.0, 37.0, ref Planetarium.Zup);
                var position = new Vector3d(700000.0, 0.0, 0.0);
                var velocity = new Vector3d(0.0, 2200.0, 0.0);

                var truth = OrbitTruthFrame.Read(true, position, velocity);

                Assert.NotNull(truth);
                Assert.Equal(OrbitTruthFrame.ToFixedFrame(position), truth!.Value.Position);
                Assert.Equal(OrbitTruthFrame.ToFixedFrame(velocity), truth.Value.Velocity);
            }
            finally
            {
                Planetarium.Zup = original;
            }
        }

        [Fact]
        public void AnOrbitWithNoReferenceBodyHasNoTruth()
        {
            Assert.Null(OrbitTruthFrame.Read(false, new Vector3d(700000.0, 0.0, 0.0), new Vector3d(0.0, 2200.0, 0.0)));
        }

        [Fact]
        public void AStoredVectorThatIsNotANumberHasNoTruth()
        {
            Assert.Null(OrbitTruthFrame.Read(true, new Vector3d(double.NaN, 0.0, 0.0), new Vector3d(0.0, 2200.0, 0.0)));
            Assert.Null(OrbitTruthFrame.Read(true, new Vector3d(700000.0, 0.0, 0.0), new Vector3d(0.0, double.PositiveInfinity, 0.0)));
        }
    }
}
