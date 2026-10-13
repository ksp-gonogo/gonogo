using System;
using Gonogo.DevTools;
using Xunit;

namespace Gonogo.KSP.Tests.DevTools
{
    /// <summary>
    /// The teleport request names its mean anomaly in degrees and the game takes
    /// radians. Passing the number through unconverted places the craft a
    /// different distance round the orbit than the request said.
    /// </summary>
    public sealed class TeleportAnomalyTests
    {
        [Theory]
        [InlineData(0.0, 0.0)]
        [InlineData(90.0, Math.PI / 2.0)]
        [InlineData(180.0, Math.PI)]
        [InlineData(360.0, 0.0)]
        [InlineData(-180.0, Math.PI)]
        [InlineData(540.0, Math.PI)]
        public void DegreesBecomeRadiansWithinOneTurn(double degrees, double radians)
        {
            Assert.Equal(radians, TeleportAnomaly.ToRadians(degrees), 12);
        }
    }
}
