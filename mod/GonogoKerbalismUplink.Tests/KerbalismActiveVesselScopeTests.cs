using System;
using System.IO;
using System.Linq;
using Xunit;

namespace Gonogo.KerbalismUplink.Tests
{
    /// <summary>
    /// The repair regression the active-vessel seam introduced, and the seam an
    /// Uplink reaches it through.
    ///
    /// <para><b>What broke.</b> Core started reporting the craft a kerbal
    /// stepped out of rather than the kerbal, so <c>vessel.parts</c> lists the
    /// CRAFT's parts. This backend went on resolving <c>partId</c> against
    /// <c>FlightGlobals.ActiveVessel</c>, which during an EVA is the kerbal and
    /// has one part. Every part id the operator could see came back
    /// <c>no-such-part</c> - and going outside to fix a failed part is the whole
    /// reason the workflow exists.</para>
    ///
    /// <para><b>Why it is asserted over source.</b> The backend reads live
    /// Kerbalism through reflection over a real <c>Vessel</c>; this project
    /// deliberately compiles only the KSP-free half of the Uplink (see its
    /// csproj), so the type cannot be loaded here at all. Same instrument, and
    /// the same reason, as <see cref="KerbalismRepairScopeTests"/>'s own
    /// source-text check.</para>
    /// </summary>
    public class KerbalismActiveVesselScopeTests
    {
        private const string DirectRead = "FlightGlobals.ActiveVessel";

        [Fact]
        public void TheReliabilityBackendResolvesTheVesselThroughTheCapability()
        {
            var source = Read("KerbalismReliabilityBackend.cs");

            // Kernel.ReportedVessel() is the capability query with its fallback
            // attached: absent resolves to NO VESSEL, never to KSP's answer. That
            // rule moved into Sitrep.Contract once nine more Uplinks needed it,
            // because nine copies of it are nine chances for one to grow a
            // `?? FlightGlobals.ActiveVessel`.
            Assert.Contains("ReportedVessel()", source);
        }

        /// <summary>
        /// All three reads, not just the repair. <c>Summary</c> and
        /// <c>Parts</c> feed the very list the operator picks a part id off, so
        /// a repair scoped to the craft while the listing is scoped to the
        /// kerbal would leave the two describing different vehicles.
        /// </summary>
        [Fact]
        public void NoReadInTheReliabilityBackendStillAsksKspDirectly()
        {
            Assert.Equal(0, CountDirectReads(Read("KerbalismReliabilityBackend.cs")));
        }

        /// <summary>
        /// A scan that cannot see a violation reports zero, and zero reads as
        /// success. Plant one, and check a doc comment naming the stock property
        /// is not counted: this Uplink's prose cites it repeatedly and always
        /// will.
        /// </summary>
        [Fact]
        public void TheScanCanSeeAPlantedViolation()
        {
            Assert.Equal(1, CountDirectReads("            var v = FlightGlobals.ActiveVessel;\n"));
            Assert.Equal(0, CountDirectReads("            // var v = FlightGlobals.ActiveVessel;\n"));
            Assert.Equal(0, CountDirectReads("    /// <c>FlightGlobals.ActiveVessel</c> is the kerbal here.\n"));
        }

        /// <summary>
        /// And that the file it is reading is the one that ships: a path that
        /// silently missed would report a clean file forever.
        /// </summary>
        [Fact]
        public void TheScanIsReadingTheShippedBackend()
        {
            Assert.Contains("class KerbalismReliabilityBackend", Read("KerbalismReliabilityBackend.cs"));
        }

        /// <summary>Reads on CODE lines only; a doc comment naming the stock property is prose about KSP.</summary>
        private static int CountDirectReads(string source) =>
            source.Split('\n')
                .Where(line => !line.TrimStart().StartsWith("//", StringComparison.Ordinal))
                .Where(line => !line.TrimStart().StartsWith("///", StringComparison.Ordinal))
                .Count(line => line.Contains(DirectRead));

        private static string Read(string fileName)
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null && !File.Exists(Path.Combine(dir.FullName, "mod", "Gonogo.sln")))
            {
                dir = dir.Parent;
            }
            Assert.NotNull(dir);
            var path = Path.Combine(dir!.FullName, "mod", "GonogoKerbalismUplink", fileName);
            Assert.True(File.Exists(path), fileName + " not found at " + path);
            return File.ReadAllText(path);
        }
    }
}
