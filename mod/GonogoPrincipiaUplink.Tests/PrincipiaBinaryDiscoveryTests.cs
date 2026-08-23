using System;
using System.Linq;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The mapping lists here are the paths a running KSP actually reported, read
    /// from its own process on 2026-08-23, not paths invented to suit the code.
    /// That matters for one case in particular: the managed adapter sits in
    /// <c>GameData/Principia/</c> beside the native builds, so a discovery that
    /// matched on "Principia and a library extension" would pick it, and on Windows
    /// both the managed and the native module end in <c>.dll</c>.
    /// </summary>
    public class PrincipiaBinaryDiscoveryTests
    {
        private const string Root =
            "/home/deck/.local/share/Steam/steamapps/common/Kerbal Space Program/GameData";

        private const string Baseline = Root + "/Principia/Linux/x64/principia.so";
        private const string Fma = Root + "/Principia/Linux/x64_AVX_FMA/principia.so";
        private const string ManagedAdapter = Root + "/Principia/ksp_plugin_adapter.dll";
        private const string OurUplink = Root + "/GonogoPrincipiaUplink/Plugins/GonogoPrincipiaUplink.dll";

        [Fact]
        public void PicksTheFmaBuildWhenBothAreMapped()
        {
            // The ordinary case on a machine with FMA, and the one a naive reader
            // gets wrong: the baseline build is ALSO mapped, because the loader maps
            // it first to call CPUID through it and its unload no longer takes
            // effect. Both were live in the game process with an executable segment.
            var selection = PrincipiaBinaryDiscovery.FromMappedModules(
                new[] { ManagedAdapter, Baseline, OurUplink, Fma });

            Assert.True(selection.Found);
            Assert.Equal(PrincipiaBinaryVariant.X64AvxFma, selection.ActiveVariant);
            Assert.Equal(Fma, selection.ActivePath);
            Assert.Equal(2, selection.Mapped.Count);
            Assert.Null(selection.Reason);
        }

        [Fact]
        public void OrderOfTheMappingsDoesNotDecideTheAnswer()
        {
            // A maps file is ordered by address, so the baseline build can appear
            // either side of the FMA build. Whichever comes first must not win.
            var fmaLast = PrincipiaBinaryDiscovery.FromMappedModules(new[] { Baseline, Fma });
            var fmaFirst = PrincipiaBinaryDiscovery.FromMappedModules(new[] { Fma, Baseline });

            Assert.Equal(PrincipiaBinaryVariant.X64AvxFma, fmaLast.ActiveVariant);
            Assert.Equal(PrincipiaBinaryVariant.X64AvxFma, fmaFirst.ActiveVariant);
        }

        [Fact]
        public void PicksTheBaselineBuildWhenItIsTheOnlyOne()
        {
            // A CPU without FMA: the loader keeps what it mapped first.
            var selection = PrincipiaBinaryDiscovery.FromMappedModules(
                new[] { ManagedAdapter, Baseline });

            Assert.True(selection.Found);
            Assert.Equal(PrincipiaBinaryVariant.X64, selection.ActiveVariant);
            Assert.Equal(Baseline, selection.ActivePath);
            Assert.Single(selection.Mapped);
        }

        [Fact]
        public void TheManagedAdapterIsNotANativeBuild()
        {
            // The negative that the rest of the suite rests on. `ksp_plugin_adapter.dll`
            // is mapped whenever Principia is installed at all, so a discovery that
            // accepted it would report a binary on every machine and would report the
            // wrong KIND of file, which no later step could recover from.
            var selection = PrincipiaBinaryDiscovery.FromMappedModules(
                new[] { ManagedAdapter, OurUplink });

            Assert.False(selection.Found);
            Assert.Equal(PrincipiaBinaryVariant.Unknown, selection.ActiveVariant);
            Assert.Null(selection.ActivePath);
            Assert.Empty(selection.Mapped);
        }

        [Fact]
        public void SaysNothingIsMappedRatherThanThatPrincipiaIsAbsent()
        {
            // Read while the game is still booting, this is what you get, and it was
            // read exactly once for real: a first look at a starting process found no
            // Principia at all and the same look minutes later found both builds. The
            // reason has to keep those apart, because "not mapped yet" and "not
            // installed" want different next moves.
            var selection = PrincipiaBinaryDiscovery.FromMappedModules(Array.Empty<string>());

            Assert.False(selection.Found);
            Assert.NotNull(selection.Reason);
            Assert.Contains("booting", selection.Reason!, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public void CollapsesTheManySegmentsOneFileIsMappedAs()
        {
            // A maps file lists a library once per segment: the live read showed the
            // FMA build over six entries and the baseline over seven. The caller
            // wants one binary each, not thirteen.
            var selection = PrincipiaBinaryDiscovery.FromMappedModules(
                Enumerable.Repeat(Baseline, 7).Concat(Enumerable.Repeat(Fma, 6)));

            Assert.Equal(2, selection.Mapped.Count);
            Assert.Equal(PrincipiaBinaryVariant.X64AvxFma, selection.ActiveVariant);
        }

        [Fact]
        public void ReadsWindowsPathsAndTheirNativeModuleName()
        {
            // On Windows the native module and the managed adapter share an
            // extension, so only the directory tells them apart.
            const string root = @"C:\Program Files\Steam\steamapps\common\Kerbal Space Program\GameData\Principia";
            var selection = PrincipiaBinaryDiscovery.FromMappedModules(
                new[] { root + @"\ksp_plugin_adapter.dll", root + @"\Windows\x64_AVX_FMA\principia.dll" });

            Assert.True(selection.Found);
            Assert.Equal(PrincipiaBinaryVariant.X64AvxFma, selection.ActiveVariant);
            Assert.Single(selection.Mapped);
        }

        [Fact]
        public void ASiblingFileInTheVariantDirectoryIsNotTheNativeBuild()
        {
            // The directory check alone would accept this, and mutation testing is
            // how that was found: deleting the file-name check left every other test
            // in this class green. Principia ships a 200 MB `principia.pdb` beside
            // the Windows module, in the SAME variant directory, so directory plus
            // extension is not enough to identify the thing that gets loaded.
            const string root = @"C:\KSP\GameData\Principia\Windows\x64_AVX_FMA";
            var selection = PrincipiaBinaryDiscovery.FromMappedModules(
                new[] { root + @"\principia.pdb" });

            Assert.False(selection.Found);
            Assert.Empty(selection.Mapped);
        }

        [Fact]
        public void AnUnrecognisedDirectoryIsNotGuessedAt()
        {
            // A future third build, or a hand-moved file. Answering Unknown sends the
            // caller to the conformance gate; guessing a variant would have it
            // reporting numbers as the game's that the game never produced.
            var selection = PrincipiaBinaryDiscovery.FromMappedModules(
                new[] { Root + "/Principia/Linux/x64_AVX512/principia.so" });

            Assert.False(selection.Found);
            Assert.Empty(selection.Mapped);
        }

        [Fact]
        public void NoMappingListIsRefusedRatherThanTreatedAsEmpty()
        {
            var selection = PrincipiaBinaryDiscovery.FromMappedModules(null);

            Assert.False(selection.Found);
            Assert.NotNull(selection.Reason);
        }
    }
}
