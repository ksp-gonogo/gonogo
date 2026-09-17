using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// No Uplink asks KSP which vessel it is reporting on.
    ///
    /// <para><b>What this is guarding.</b> Core stopped answering "the active
    /// vessel" with KSP's answer: while a kerbal is outside, the craft they
    /// stepped out of is what every channel is about, because a one-part kerbal
    /// with no antenna, no resources and no life-support rules is not what
    /// mission control is watching. Core's own reads moved onto that seam and an
    /// Uplink's could not, because the seam lives in an assembly an Uplink may
    /// not reference. So every Uplink went on answering with the kerbal: one of
    /// them reported an EVA suit's comms link while the comms schedule beside it,
    /// which core scopes, drew the ship's route hop by hop.</para>
    ///
    /// <para>The route is <c>Sitrep.Contract</c>'s <c>activeVessel</c>
    /// capability, resolved per call through <c>host.Kernel</c> (see
    /// <see cref="Sitrep.Contract.IActiveVessel"/> and
    /// <see cref="Sitrep.Contract.ActiveVesselQuery"/>). This gate says the
    /// direct read is gone; the capability's own tests say the route works.</para>
    ///
    /// <para><b>Why it is asserted over SOURCE.</b> Every one of these reads sits
    /// in an Uplink's KSP-touching half, which cannot be loaded in a headless
    /// build at all: no project in this repo may reference every Uplink, and one
    /// loading them out of <c>bin/</c> is green whenever they have not been
    /// built. A source walk is the only shape a cross-Uplink gate can take here,
    /// which is the reasoning <see cref="UplinkProjects"/> already carries.</para>
    ///
    /// <para><b>Shrink-only, and strictly.</b> <see cref="Debt"/> names the files
    /// that still read KSP directly and how many times, each with its reason. An
    /// entry leaves only by the reads leaving. A NEW read fails, and so does a
    /// STALE entry: a file listed here that has been fixed fails just as loudly,
    /// because a debt list nobody prunes stops describing anything.</para>
    ///
    /// <para><b>And it plants its own violation.</b> A scan that has stopped
    /// matching reports zero, and zero reads as success. So the counter is shown
    /// a violation it must see and three shapes of prose it must not, because
    /// these Uplinks cite the stock property in doc comments constantly and
    /// always will.</para>
    /// </summary>
    public class UplinkActiveVesselScopeTests
    {
        private const string DirectRead = "FlightGlobals.ActiveVessel";

        /// <summary>
        /// The reads that are deliberately still KSP's, keyed
        /// <c>&lt;Uplink&gt;/&lt;file&gt;</c>, with the count that is expected
        /// and the reason it stands.
        /// </summary>
        /*
         * EMPTY, and it emptied by an Uplink LEAVING rather than by the reads
         * being routed: GonogoMechJebUplink held the only three, and they went
         * with it to the gonogo-uplinks repo still unrouted. So this is not a
         * clean tree so much as a smaller one, and the walk below is what says
         * so: it asserts it found Uplinks to measure before reporting none in
         * breach.
         */
        private static readonly Dictionary<string, int> Debt = new(StringComparer.Ordinal);

        [Fact]
        public void NoUplinkReadsKspsActiveVesselDirectly()
        {
            var offenders = Measure()
                .Where(entry => !Debt.TryGetValue(entry.Key, out var allowed) || entry.Value > allowed)
                .OrderBy(entry => entry.Key, StringComparer.Ordinal)
                .Select(entry => entry.Key + ": " + entry.Value + " direct read(s)")
                .ToList();

            Assert.True(
                offenders.Count == 0,
                "An Uplink must resolve the reported vessel through the activeVessel capability "
                + "(Kernel.ReportedVessel()), never off FlightGlobals. Offending files:\n  "
                + string.Join("\n  ", offenders));
        }

        /// <summary>
        /// The other direction: a debt entry whose reads have gone, or shrunk,
        /// is a line that has stopped describing the repo and has to be pruned
        /// in the commit that fixed it.
        /// </summary>
        [Fact]
        public void EveryDebtEntryStillDescribesTheRepo()
        {
            var measured = Measure();
            var stale = Debt
                .Where(entry => !measured.TryGetValue(entry.Key, out var actual) || actual != entry.Value)
                .OrderBy(entry => entry.Key, StringComparer.Ordinal)
                .Select(entry =>
                    entry.Key + ": listed " + entry.Value + ", measured "
                    + (measured.TryGetValue(entry.Key, out var actual) ? actual : 0))
                .ToList();

            Assert.True(
                stale.Count == 0,
                "This debt list is shrink-only and exact. Prune or tighten these entries in the "
                + "commit that changed them:\n  " + string.Join("\n  ", stale));
        }

        /// <summary>
        /// A walk that finds nothing reports a clean repo. So the walk is pinned
        /// two ways: it must have read source from EVERY Uplink the discovery
        /// found, and over the planted Uplink it must read the fixture's own
        /// files under the keys the debt list is written in, either of which
        /// fails before the counting tests above can pass on an empty set.
        ///
        /// <para>Checked against the discovery rather than against a couple of
        /// filenames, so this names no mod. <c>UplinkIsolationTests</c> already
        /// pins the discovery itself against <c>Gonogo.sln</c> and its plant. The
        /// plant half replaced a floor of a hundred files, which every mod Uplink
        /// leaving for the gonogo-uplinks repo takes to zero.</para>
        /// </summary>
        [Fact]
        public void TheWalkFoundSourceForEveryUplinkItIsJudging()
        {
            var read = UplinkSourceFilesByKey()
                .Select(entry => entry.Key.Split('/')[0])
                .ToHashSet(StringComparer.Ordinal);

            var silent = UplinkProjects.Discover().Keys
                .Where(uplink => !read.Contains(uplink))
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToList();

            Assert.True(silent.Count == 0, "no .cs read for: " + string.Join(", ", silent));

            var plantDirectory = Path.Combine(UplinkProjects.PlantRoot(), UplinkProjects.PlantedUplink);
            var expected = Directory.EnumerateFiles(plantDirectory, "*.cs", SearchOption.TopDirectoryOnly)
                .Select(path => UplinkProjects.PlantedUplink + "/" + Path.GetFileName(path))
                .OrderBy(key => key, StringComparer.Ordinal)
                .ToList();
            var plantRead = UplinkSourceFilesByKey(UplinkProjects.Discover(UplinkProjects.PlantRoot()))
                .Select(entry => entry.Key)
                .OrderBy(key => key, StringComparer.Ordinal)
                .ToList();

            Assert.True(
                expected.Count > 0 && plantRead.SequenceEqual(expected),
                $"Over the planted {UplinkProjects.PlantedUplink} the walk read [{string.Join(", ", plantRead)}], "
                + $"expected exactly [{string.Join(", ", expected)}]. A walk that reads nothing, or keys what it "
                + "reads differently from the debt list, reports a clean repo.");
        }

        /// <summary>
        /// The counter can see a violation, and cannot see prose. Both halves
        /// matter: a pattern that stopped matching reports zero, and a counter
        /// that scored doc comments would make the honest fix impossible, since
        /// naming the stock property is how these files explain what they route
        /// around.
        /// </summary>
        [Fact]
        public void TheCounterSeesAPlantedViolationAndNotPlantedProse()
        {
            Assert.Equal(1, CountDirectReads("            var vessel = FlightGlobals.ActiveVessel;\n"));
            Assert.Equal(0, CountDirectReads("            // was FlightGlobals.ActiveVessel; now the capability\n"));
            Assert.Equal(0, CountDirectReads("    /// <c>FlightGlobals.ActiveVessel</c> is the kerbal during an EVA.\n"));
            Assert.Equal(0, CountDirectReads("// FlightGlobals.ActiveVessel and takes no id, so it is FLIGHT-scoped\n"));
        }

        /// <summary>Every file that still reads KSP directly, and how many times.</summary>
        private static Dictionary<string, int> Measure()
        {
            var measured = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (var (key, path) in UplinkSourceFilesByKey())
            {
                var count = CountDirectReads(File.ReadAllText(path));
                if (count > 0)
                {
                    measured[key] = count;
                }
            }

            return measured;
        }

        private static IEnumerable<(string Key, string Path)> UplinkSourceFilesByKey() =>
            UplinkSourceFilesByKey(UplinkProjects.Discover());

        private static IEnumerable<(string Key, string Path)> UplinkSourceFilesByKey(
            IReadOnlyDictionary<string, string> uplinks)
        {
            foreach (var (uplink, directory) in uplinks.OrderBy(e => e.Key, StringComparer.Ordinal))
            {
                foreach (var sourceDirectory in UplinkProjects.SourceDirectories(directory))
                {
                    if (!Directory.Exists(sourceDirectory))
                    {
                        continue;
                    }

                    foreach (var path in Directory.EnumerateFiles(sourceDirectory, "*.cs", SearchOption.AllDirectories))
                    {
                        if (IsBuildOutput(path))
                        {
                            continue;
                        }

                        var relative = Path.GetRelativePath(sourceDirectory, path).Replace('\\', '/');
                        yield return (Path.GetFileName(sourceDirectory) + "/" + relative, path);
                    }
                }
            }
        }

        private static IEnumerable<string> UplinkSourceFiles() =>
            UplinkSourceFilesByKey().Select(entry => entry.Path);

        private static bool IsBuildOutput(string path)
        {
            var normalised = path.Replace('\\', '/');
            return normalised.Contains("/bin/", StringComparison.Ordinal)
                || normalised.Contains("/obj/", StringComparison.Ordinal);
        }

        /// <summary>
        /// Reads on CODE lines only. A line whose first non-space characters are
        /// <c>//</c> or <c>///</c> is prose about KSP, and these files are full
        /// of it by design: explaining which property the capability replaced is
        /// the point of the comment.
        /// </summary>
        private static int CountDirectReads(string source) =>
            source.Split('\n')
                .Where(line => !line.TrimStart().StartsWith("//", StringComparison.Ordinal))
                .Count(line => line.Contains(DirectRead, StringComparison.Ordinal));
    }
}
