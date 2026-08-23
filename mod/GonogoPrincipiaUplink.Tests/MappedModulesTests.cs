using System.Linq;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// Every fixture line here was copied from the running game's own
    /// <c>/proc/self/maps</c>, not written to suit the parser.
    /// </summary>
    public class MappedModulesTests
    {
        private const string KspRoot =
            "/home/deck/.local/share/Steam/steamapps/common/Kerbal Space Program";

        private const string RealMaps =
            "00400000-00401000 r-xp 00000000 103:08 2868960                           " + KspRoot + "/KSP.x86_64\n"
            + "00600000-00601000 r--p 00000000 103:08 2868960                           " + KspRoot + "/KSP.x86_64\n"
            + "7f7c30c00000-7f7c3184d000 r--p 00000000 103:08 5477                      " + KspRoot + "/GameData/Principia/Linux/x64_AVX_FMA/principia.so\n"
            + "7f7c3184d000-7f7c3206c000 r-xp 00c4d000 103:08 5477                      " + KspRoot + "/GameData/Principia/Linux/x64_AVX_FMA/principia.so\n"
            + "7f7c3206c000-7f7c32320000 r--p 0146c000 103:08 5477                      " + KspRoot + "/GameData/Principia/Linux/x64_AVX_FMA/principia.so\n";

        [Fact]
        public void KeepsAPathWithASpaceInIt()
        {
            // "Kerbal Space Program" has two of them, so the obvious parse (split on
            // whitespace, take the last field) yields "Program/principia.so" and finds
            // no Principia at all on every real install.
            var paths = MappedModules.ParseProcMaps(RealMaps);

            Assert.Contains(
                KspRoot + "/GameData/Principia/Linux/x64_AVX_FMA/principia.so", paths);
        }

        [Fact]
        public void ListsEachFileOnceHoweverManySegmentsItHas()
        {
            // The FMA build appears three times above, and did so six times in the
            // live process.
            var paths = MappedModules.ParseProcMaps(RealMaps);

            Assert.Equal(2, paths.Count);
            Assert.Equal(1, paths.Count(p => p.EndsWith("principia.so")));
        }

        [Fact]
        public void TheParsedListFeedsTheGateToTheRightVariant()
        {
            // The join that matters: what this reader emits has to be what discovery
            // consumes, and nothing else checks the two agree.
            var selection = PrincipiaBinaryDiscovery.FromMappedModules(
                MappedModules.ParseProcMaps(RealMaps));

            Assert.True(selection.Found);
            Assert.Equal(PrincipiaBinaryVariant.X64AvxFma, selection.ActiveVariant);
        }

        [Fact]
        public void SkipsAnonymousMappingsAndPseudoPaths()
        {
            var body =
                "7f0000000000-7f0000001000 rw-p 00000000 00:00 0 \n"
                + "7ffd00000000-7ffd00021000 rw-p 00000000 00:00 0                          [stack]\n"
                + "7ffd000f0000-7ffd000f2000 r-xp 00000000 00:00 0                          [vdso]\n"
                + "00400000-00401000 r-xp 00000000 103:08 1                                 /usr/bin/thing\n";

            var paths = MappedModules.ParseProcMaps(body);

            Assert.Single(paths);
            Assert.Equal("/usr/bin/thing", paths[0]);
        }

        [Fact]
        public void SkipsAFileThatHasBeenDELETEDSinceItWasMapped()
        {
            // Still mapped, but the path no longer names those bytes. Opening it
            // would read a different file and report on the wrong one.
            var body =
                "7f0000000000-7f0000001000 r-xp 00000000 103:08 9  /tmp/old/principia.so (deleted)\n";

            Assert.Empty(MappedModules.ParseProcMaps(body));
        }

        [Fact]
        public void AnEmptyOrAbsentBodyIsAnEmptyListRatherThanAThrow()
        {
            Assert.Empty(MappedModules.ParseProcMaps(null));
            Assert.Empty(MappedModules.ParseProcMaps(""));
        }

        [Fact]
        public void ReadingThisProcessFindsSomethingAndDoesNotThrow()
        {
            // Runs everywhere, including CI: whatever the platform, a live process has
            // at least its own executable mapped. Catches the reader silently
            // returning nothing, which the gate would report as "Principia not
            // mapped" rather than as a broken read.
            var paths = MappedModules.OfThisProcess();

            Assert.NotEmpty(paths);
        }
    }
}
