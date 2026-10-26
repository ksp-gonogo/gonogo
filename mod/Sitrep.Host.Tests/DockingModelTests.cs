using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class DockingModelTests
    {
        private static readonly (double, double, double) Right = (1, 0, 0);
        private static readonly (double, double, double) Up = (0, 1, 0);
        private static readonly (double, double, double) Forward = (0, 0, 1);

        [Fact]
        public void ATargetStraightAlongThePortsForwardAxisHasNoSidewaysOffsetHoweverThePortIsOrientedInTheWorld()
        {
            // The port points along world +X; a target 98 m dead ahead of it.
            var (x, y, z) = DockingModel.ToPortFrame(
                world: (98, 0, 0), right: (0, 0, -1), up: (0, 1, 0), forward: (1, 0, 0));
            Assert.Equal(0.0, x, 9);
            Assert.Equal(0.0, y, 9);
            Assert.Equal(98.0, z, 9);
        }

        [Fact]
        public void ASidewaysAndVerticalOffsetLandOnTheMatchingPortAxes()
        {
            var (x, y, z) = DockingModel.ToPortFrame((2, 3, 40), Right, Up, Forward);
            Assert.Equal((2.0, 3.0, 40.0), (x, y, z));
        }

        [Fact]
        public void TheRotationKeepsTheVectorsLength()
        {
            var s = System.Math.Sqrt(0.5);
            var (x, y, z) = DockingModel.ToPortFrame((3, 4, 12), (s, 0, -s), Up, (s, 0, s));
            Assert.Equal(13.0, System.Math.Sqrt(x * x + y * y + z * z), 9);
        }
    }
}
