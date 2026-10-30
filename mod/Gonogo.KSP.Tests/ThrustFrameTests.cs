using V = Sitrep.Contract.Vector3d;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A craft at (R, 0, 0) moving along +y has prograde +y and radial +x; the world
    /// frame is left-handed, so the orbit's angular momentum, which is +z in a
    /// right-handed frame, is -z of what the game reports.
    /// </summary>
    public class ThrustFrameTests
    {
        private static readonly V Height = new V(700_000.0, 0.0, 0.0);
        private static readonly V Velocity = new V(0.0, 2000.0, 0.0);

        [Fact]
        public void AThrustAlongTheVelocityIsAllPrograde()
        {
            var split = ThrustFrame.Split(Height, Velocity, new V(0.0, 5.0, 0.0))!.Value;

            Assert.Equal(5.0, split.Prograde, 9);
            Assert.Equal(0.0, split.Radial, 9);
            Assert.Equal(0.0, split.Normal, 9);
        }

        [Fact]
        public void AThrustAwayFromTheBodyIsAllRadial()
        {
            var split = ThrustFrame.Split(Height, Velocity, new V(4.0, 0.0, 0.0))!.Value;

            Assert.Equal(4.0, split.Radial, 9);
            Assert.Equal(0.0, split.Prograde, 9);
        }

        [Fact]
        public void ThePartAlongTheWorldFramesZAxisIsTheNegativeOfTheOrbitsNormal()
        {
            var split = ThrustFrame.Split(Height, Velocity, new V(0.0, 0.0, 2.0))!.Value;

            Assert.Equal(-2.0, split.Normal, 9);
        }

        [Fact]
        public void AMotionAlongTheHeightHasNoFrameToSplitIn()
        {
            Assert.Null(ThrustFrame.Split(Height, new V(100.0, 0.0, 0.0), new V(1.0, 0.0, 0.0)));
            Assert.Null(ThrustFrame.Split(Height, new V(0.0, 0.0, 0.0), new V(1.0, 0.0, 0.0)));
        }
    }
}
