using System;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A ground station's <c>CommNode.precisePosition</c> is refreshed only when CommNet
    /// rebuilds, every five seconds with a loaded craft, and while an orbiting craft
    /// moves the world frame it trails by kilometres. The silence geometry places
    /// every node through <c>LivePositionOf</c>, which builds a home node from its
    /// stock surface coordinates at the instant it is read; a direct read anywhere
    /// else in the file puts a station kilometres from where it stands.
    /// </summary>
    public class StationPositionsAreReadLiveTests
    {
        private static readonly Regex Read = new Regex(@"\.precisePosition\b", RegexOptions.Compiled);

        [Fact]
        public void TheSilenceGeometryReadsPrecisePositionOnlyInLivePositionOf()
        {
            var lines = File.ReadAllLines(Path.Combine(GonogoKspDirectory(), "SilenceTracking", "KspVisibilityGeometryFactory.cs"));
            var start = Array.FindIndex(lines, line => line.Contains("Vector3d LivePositionOf(CommNode node)"));
            Assert.True(start >= 0, "LivePositionOf is gone, so this check sees nothing");

            var reads = Enumerable.Range(0, lines.Length)
                .Where(i => Read.IsMatch(Code(lines[i])))
                .ToList();

            Assert.NotEmpty(reads);
            Assert.All(reads, i => Assert.True(i > start && i <= start + 3, "precisePosition read outside LivePositionOf at line " + (i + 1)));
        }

        /* A line with any comment cut off, so a doc comment naming the field is not a read. */
        private static string Code(string line)
        {
            var comment = line.IndexOf("//", StringComparison.Ordinal);
            return comment >= 0 ? line.Substring(0, comment) : line;
        }

        private static string GonogoKspDirectory()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "mod", "Gonogo.KSP");
                if (Directory.Exists(candidate))
                {
                    return candidate;
                }
                dir = dir.Parent;
            }
            throw new DirectoryNotFoundException("Could not locate mod/Gonogo.KSP from " + AppContext.BaseDirectory);
        }
    }
}
