using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The half of the <c>vessel.surface</c> and <c>vessel.landing</c> captures no
    /// test can enter: both walk a live <c>Vessel</c>, so what they gate on is only
    /// visible in the source. The validity rule itself is tested in
    /// <c>LandingModelTests</c>; these hold the captures to it.
    /// </summary>
    public class SurfaceHeightCaptureTests
    {
        [Fact]
        public void KspsHeightFromTerrainIsReadOnlyThroughTheMeasuredHeightRule()
        {
            var reads = Regex.Matches(ReadKspHostSource(), @"\bvessel\.heightFromTerrain\b").Count;

            Assert.True(reads == 1,
                $"KspHost reads vessel.heightFromTerrain {reads} times. The one read belongs in MeasuredHeightFromTerrain, "
                + "because the raw field carries KSP's -1 miss sentinel, the ASL altitude it substitutes for a miss, "
                + "and the value it holds while packed, none of which is a height.");
        }

        [Fact]
        public void TheSurfaceCaptureDoesNotGateOnSituation()
        {
            var body = MethodBody(ReadKspHostSource(), "private static Dictionary<string, object?>? BuildSurface(Vessel vessel, Orbit? orbit)");

            Assert.True(!body.Contains("situation", StringComparison.OrdinalIgnoreCase),
                "BuildSurface gates on the vessel's situation. KSP's ORBITING means a periapsis above the sea-level datum, "
                + "so on an airless body it withholds the height through the braking phase of every descent from orbit.");
        }

        private static string MethodBody(string source, string signature)
        {
            var start = source.IndexOf(signature, StringComparison.Ordinal);
            Assert.True(start >= 0, signature + " was not found in KspHost.cs: this guard can no longer see what it checks");
            var end = source.IndexOf("\n        }", start, StringComparison.Ordinal);
            Assert.True(end > start, "could not find the end of " + signature);
            return source.Substring(start, end - start);
        }

        /// <summary>
        /// KspHost.cs, found by walking up from the test binary. The walk fails
        /// loudly rather than skipping: a source guard that cannot find its
        /// source has not checked anything.
        /// </summary>
        private static string ReadKspHostSource()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            var searched = new List<string>();
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "mod", "Gonogo.KSP", "KspHost.cs");
                searched.Add(candidate);
                if (File.Exists(candidate))
                {
                    return File.ReadAllText(candidate);
                }
                dir = dir.Parent;
            }

            throw new FileNotFoundException(
                "KspHost.cs not found walking up from " + AppContext.BaseDirectory
                + ". Looked at: " + string.Join(", ", searched));
        }
    }
}
