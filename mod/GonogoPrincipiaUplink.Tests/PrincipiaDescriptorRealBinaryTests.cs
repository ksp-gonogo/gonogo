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
    /// <para>Local-only by necessity: the builds are about 270 MB each and are a
    /// third party's, so they can never be committed and CI can never run this.
    /// It SKIPS when they are absent rather than failing, which is the same
    /// judgement `map-topic.rawFieldResolution.fixture.test.ts` already settled for
    /// the same reason: an earlier version of that test failed loudly on a missing
    /// local-only input and simply reddened CI forever.</para>
    ///
    /// <para>What it buys, and it is the only thing that can: the synthetic tests
    /// prove the reader is self-consistent, and this proves it agrees with the
    /// bytes Principia actually ships. The expected values were derived
    /// independently, by a separate implementation, before this reader existed.</para>
    /// </summary>
    public class PrincipiaDescriptorRealBinaryTests
    {
        /// <summary>
        /// Measured across all six shipped builds of `2026081218-Levi-Civita`. The
        /// descriptor is byte-identical in every one, which is what lets a hash name
        /// a RELEASE rather than a file.
        /// </summary>
        private const string ExpectedSha256 =
            "b2569d212a9fbbe5334e49ed05f08b464a4e387469231245e3f682f5c6ce11b3";

        private const int ExpectedLength = 76_757;

        private static readonly string[] RelativeBuildPaths =
        {
            "GameData/Principia/Linux/x64/principia.so",
            "GameData/Principia/Linux/x64_AVX_FMA/principia.so",
            "GameData/Principia/macOS/x64/principia.so",
            "GameData/Principia/macOS/x64_AVX_FMA/principia.so",
            "GameData/Principia/Windows/x64/principia.dll",
            "GameData/Principia/Windows/x64_AVX_FMA/principia.dll",
        };

        [Fact]
        public void ReadsTheSameDescriptorOutOfEveryShippedBuild()
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

            var found = new List<string>();
            foreach (var relative in RelativeBuildPaths)
            {
                var path = Path.Combine(installRoot!, relative.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(path))
                {
                    continue;
                }
                found.Add(relative);
                using var stream = File.OpenRead(path);
                var descriptor = PrincipiaDescriptorReader.Read(stream);

                Assert.True(descriptor.Found, relative + ": no descriptor found");
                Assert.Equal(ExpectedLength, descriptor.Length);
                Assert.Equal(ExpectedSha256, descriptor.Sha256);
            }

            if (found.Count == 0)
            {
                // Principia is not installed in an otherwise-present mirror.
                return;
            }
            // Without this the test passes by reading ONE build, and cross-build
            // identity is the whole claim being made.
            Assert.True(
                found.Count >= 2,
                "Only " + found.Count + " build(s) were read, so cross-build identity was not "
                    + "actually exercised: " + string.Join(", ", found));
        }

        [Fact]
        public void TheWholeGateAcceptsTheBuildTheRigActuallyRuns()
        {
            // Every other gate test builds its own bytes, so all of them would pass
            // against a reader that agreed with the test author and not with
            // Principia. This one runs discovery, descriptor, SupportedSet and export
            // reading over the file the game really loads, through the real vetted
            // set, and is the only test that can catch the four agreeing with each
            // other while disagreeing with reality.
            var installRoot = FindInstallRoot();
            if (installRoot == null)
            {
                return;
            }
            var fma = Path.Combine(
                installRoot,
                "GameData/Principia/Linux/x64_AVX_FMA/principia.so"
                    .Replace('/', Path.DirectorySeparatorChar));
            var baseline = Path.Combine(
                installRoot,
                "GameData/Principia/Linux/x64/principia.so"
                    .Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(fma) || !File.Exists(baseline))
            {
                return;
            }

            // Both mapped, as they are on a running game: the loader maps the
            // baseline build to query CPUID through it and never unloads it.
            var verdict = PrincipiaConformanceGate.Check(
                new[] { baseline, fma },
                path => File.OpenRead(path));

            Assert.Equal(PrincipiaConformance.Conformant, verdict.State);
            Assert.True(verdict.MayProceed);
            Assert.Equal(PrincipiaBinaryVariant.X64AvxFma, verdict.Variant);
            Assert.Equal(fma, verdict.ActivePath);
            Assert.Equal(ExpectedSha256, verdict.DescriptorSha256);
            Assert.Equal(170, verdict.ExportCount);
            Assert.NotNull(verdict.ReleaseName);
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
