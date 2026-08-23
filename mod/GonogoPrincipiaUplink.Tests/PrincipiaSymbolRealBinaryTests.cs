using System;
using System.Collections.Generic;
using System.IO;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// Reads the REAL shipped Principia builds, when this machine has them.
    ///
    /// <para>Local-only by necessity: the builds are up to 270 MB each and are a
    /// third party's, so they can never be committed and CI can never run this. It
    /// SKIPS when they are absent rather than failing, the same judgement
    /// `PrincipiaDescriptorRealBinaryTests` and
    /// `map-topic.rawFieldResolution.fixture.test.ts` already settled for the same
    /// reason: an earlier version of that test failed loudly on a missing local-only
    /// input and simply reddened CI forever.</para>
    ///
    /// <para>What it buys, and it is the only thing that can: the synthetic suite
    /// beside it proves the reader is self-consistent against headers it wrote
    /// itself, and this proves it agrees with three real toolchains' output. The
    /// expected count and the cross-build identity were derived independently, with
    /// `llvm-nm` and `llvm-objdump`, before this reader existed.</para>
    /// </summary>
    public class PrincipiaSymbolRealBinaryTests
    {
        /// <summary>
        /// Principia's C interface, measured at 170 exports in every one of the six
        /// shipped builds of `2026081218-Levi-Civita`, with the same names in each.
        /// </summary>
        private const int ExpectedInterfaceExports = 170;

        private static readonly (string Path, NativeBinaryFormat Format)[] ShippedBuilds =
        {
            ("GameData/Principia/Linux/x64/principia.so", NativeBinaryFormat.Elf),
            ("GameData/Principia/Linux/x64_AVX_FMA/principia.so", NativeBinaryFormat.Elf),
            // Named `.so` and a Mach-O. This pair is the reason the reader takes the
            // format from the file's own magic.
            ("GameData/Principia/macOS/x64/principia.so", NativeBinaryFormat.MachO),
            ("GameData/Principia/macOS/x64_AVX_FMA/principia.so", NativeBinaryFormat.MachO),
            ("GameData/Principia/Windows/x64/principia.dll", NativeBinaryFormat.Pe),
            ("GameData/Principia/Windows/x64_AVX_FMA/principia.dll", NativeBinaryFormat.Pe),
        };

        [Fact]
        public void EveryShippedBuildExportsTheSameWholeInterface()
        {
            var installRoot = FindInstallRoot();
            if (installRoot == null)
            {
                // Silent on a machine without the mirror, and that is a real cost
                // rather than a free pass: this test cannot tell "no install here"
                // from "the reader broke". It is accepted because the alternative
                // was tried elsewhere in this repo and reddened CI permanently, and
                // because the synthetic suite beside it runs everywhere.
                return;
            }

            var read = new List<string>();
            IReadOnlyList<string>? first = null;
            var firstPath = string.Empty;

            foreach (var build in ShippedBuilds)
            {
                var path = Path.Combine(
                    installRoot!, build.Path.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(path))
                {
                    continue;
                }
                read.Add(build.Path);

                using var stream = File.OpenRead(path);
                var exports = NativeExportReader.Read(stream);

                Assert.True(exports.Found, build.Path + ": " + exports.Reason);
                Assert.Equal(build.Format, exports.Format);

                var api = PrincipiaSymbolGate.InterfaceExports(exports);
                Assert.Equal(ExpectedInterfaceExports, api.Count);

                if (first == null)
                {
                    first = api;
                    firstPath = build.Path;
                    continue;
                }
                // Names, not a count. Two builds can each export 170 functions and
                // not be the same 170, and that difference is exactly the ABI break
                // the gate exists to catch.
                Assert.Equal(first, api);

                // The gate's own answer, against a list taken from another build and
                // another format: what it is asked in the game.
                var check = PrincipiaSymbolGate.Check(exports, first);
                Assert.True(
                    check.Complete,
                    build.Path + " is missing " + string.Join(", ", check.Missing)
                        + " relative to " + firstPath);
            }

            if (read.Count == 0)
            {
                // The mirror is here but Principia is not installed in it.
                return;
            }
            // Without this the test passes by reading ONE build, and agreement
            // across the three formats is the whole claim being made.
            Assert.True(
                read.Count >= 2,
                "Only " + read.Count + " build(s) were read, so cross-build identity was not "
                    + "actually exercised: " + string.Join(", ", read));
        }

        /// <summary>
        /// The local mirror of the rig's KSP install. Walks up from the test binary
        /// to the workspace root rather than assuming a working directory.
        /// </summary>
        private static string? FindInstallRoot()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "local_docs", "syncthing", "kspdata");
                if (Directory.Exists(candidate))
                {
                    return candidate;
                }
                dir = dir.Parent;
            }
            return null;
        }
    }
}
