using System;
using System.IO;
using System.Text.RegularExpressions;
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
        public void TheOrbitCaptureTakesBothVectorsThroughTheFixedFrame()
        {
            var source = File.ReadAllText(FindKspHost());

            Assert.Contains("[\"truthPosition\"] = OrbitTruthFrame.ToFixedFrame(orbit.pos)", source);
            Assert.Contains("[\"truthVelocity\"] = OrbitTruthFrame.ToFixedFrame(orbit.vel)", source);
            Assert.False(
                Regex.IsMatch(source, @"new\[\] \{ (pos|vel)\.x"),
                "BuildOrbit publishes a raw Orbit.pos or Orbit.vel again");
        }

        private static string FindKspHost()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "mod", "Gonogo.KSP", "KspHost.cs");
                if (File.Exists(candidate))
                {
                    return candidate;
                }
                dir = dir.Parent;
            }
            throw new FileNotFoundException("KspHost.cs");
        }
    }
}
