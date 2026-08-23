using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The gate end to end: which build is live, what its interface hash is, whether
    /// that release is vetted, and whether the exports are there. Every case is built
    /// from real bytes; nothing here is mocked.
    /// </summary>
    public class PrincipiaConformanceGateTests
    {
        private const string Fma = "/ksp/GameData/Principia/Linux/x64_AVX_FMA/principia.so";
        private const string Baseline = "/ksp/GameData/Principia/Linux/x64/principia.so";

        /// <summary>A descriptor whose content, and therefore whose hash, varies with
        /// the package name, so two different releases can be told apart.</summary>
        private static byte[] Descriptor(string package)
        {
            var name = Encoding.ASCII.GetBytes("serialization/journal.proto");
            var pkg = Encoding.ASCII.GetBytes(package);
            var bytes = new byte[2 + name.Length + 2 + pkg.Length];
            var i = 0;
            bytes[i++] = 0x0A;
            bytes[i++] = (byte)name.Length;
            Array.Copy(name, 0, bytes, i, name.Length);
            i += name.Length;
            bytes[i++] = 0x12;
            bytes[i++] = (byte)pkg.Length;
            Array.Copy(pkg, 0, bytes, i, pkg.Length);
            return bytes;
        }

        private static string ShaOf(byte[] bytes)
        {
            using var sha = SHA256.Create();
            return string.Concat(sha.ComputeHash(bytes).Select(b => b.ToString("x2")));
        }

        /// <summary>An ELF exporting <paramref name="names"/> with a descriptor
        /// appended, which is the shape the gate has to read: both facts live in one
        /// file and are read by different code.</summary>
        private static byte[] Build(IEnumerable<string> names, string package) =>
            NativeBinaryFixtures.Elf(names).Concat(Descriptor(package)).ToArray();

        private static string[] Interface(int count) =>
            Enumerable.Range(0, count).Select(i => "principia__Call" + i).ToArray();

        private static Func<string, Stream?> Serving(params (string Path, byte[] Bytes)[] files) =>
            path =>
            {
                foreach (var file in files)
                {
                    if (file.Path == path)
                    {
                        return new MemoryStream(file.Bytes);
                    }
                }
                return null;
            };

        [Fact]
        public void RecognisesAVettedReleaseOnTheBuildTheGameActuallyLoaded()
        {
            var bytes = Build(Interface(170), "principia.serialization");
            var known = new[]
            {
                new PrincipiaRelease(ShaOf(Descriptor("principia.serialization")), "Levi-Civita", 170),
            };

            var verdict = PrincipiaConformanceGate.Check(
                new[] { Baseline, Fma }, Serving((Fma, bytes)), null, known);

            Assert.Equal(PrincipiaConformance.Conformant, verdict.State);
            Assert.True(verdict.MayProceed);
            // Both builds are mapped, and the FMA one is the live one, so that is the
            // file the gate must have opened.
            Assert.Equal(PrincipiaBinaryVariant.X64AvxFma, verdict.Variant);
            Assert.Equal(Fma, verdict.ActivePath);
            Assert.Equal("Levi-Civita", verdict.ReleaseName);
            Assert.Equal(170, verdict.ExportCount);
        }

        [Fact]
        public void AnUnvettedReleaseIsNotAFailureAndCarriesItsHashOut()
        {
            // The distinction that matters to an operator: "I have not seen this
            // build" is not "this build is broken", and the hash is what turns the
            // first into a vetted entry later.
            var bytes = Build(Interface(170), "principia.serialization.v99");

            var verdict = PrincipiaConformanceGate.Check(
                new[] { Fma }, Serving((Fma, bytes)), null, Array.Empty<PrincipiaRelease>());

            Assert.Equal(PrincipiaConformance.UnknownRelease, verdict.State);
            Assert.False(verdict.MayProceed);
            Assert.Equal(ShaOf(Descriptor("principia.serialization.v99")), verdict.DescriptorSha256);
            Assert.NotNull(verdict.Reason);
        }

        [Fact]
        public void RefusesWhenTheHashSaysOneThingAndTheExportTableAnother()
        {
            // Two instruments reading different parts of the file. If they disagree,
            // one of the readings is wrong, and proceeding on the other would be
            // picking which to believe by luck.
            var bytes = Build(Interface(12), "principia.serialization");
            var known = new[]
            {
                new PrincipiaRelease(ShaOf(Descriptor("principia.serialization")), "Levi-Civita", 170),
            };

            var verdict = PrincipiaConformanceGate.Check(
                new[] { Fma }, Serving((Fma, bytes)), null, known);

            Assert.Equal(PrincipiaConformance.Refused, verdict.State);
            Assert.Contains("disagree", verdict.Reason!, StringComparison.OrdinalIgnoreCase);
            Assert.Equal(12, verdict.ExportCount);
        }

        [Fact]
        public void RefusesAFileWithNoDescriptorRatherThanCallingItUnknown()
        {
            // A file that exports the right names but embeds no interface description
            // is not an unrecognised Principia, it is not a Principia.
            var bytes = NativeBinaryFixtures.Elf(Interface(170));

            var verdict = PrincipiaConformanceGate.Check(new[] { Fma }, Serving((Fma, bytes)));

            Assert.Equal(PrincipiaConformance.Refused, verdict.State);
            Assert.Null(verdict.DescriptorSha256);
        }

        [Fact]
        public void NamesTheFunctionsACallerAskedForAndDidNotGet()
        {
            var bytes = Build(Interface(170), "principia.serialization");

            var verdict = PrincipiaConformanceGate.Check(
                new[] { Fma },
                Serving((Fma, bytes)),
                new[] { "principia__Call3", "principia__NotThere" });

            Assert.Equal(PrincipiaConformance.Refused, verdict.State);
            Assert.Contains("principia__NotThere", verdict.Missing);
            Assert.DoesNotContain("principia__Call3", verdict.Missing);
        }

        [Fact]
        public void NothingMappedIsNotEstablishedRatherThanRefused()
        {
            // A read taken while the game is still booting finds nothing, and that is
            // not a verdict about the build. Refusing here would send an operator
            // hunting for a fault in a file that is about to load correctly.
            var verdict = PrincipiaConformanceGate.Check(
                Array.Empty<string>(), Serving());

            Assert.Equal(PrincipiaConformance.NotEstablished, verdict.State);
            Assert.False(verdict.MayProceed);
        }

        [Fact]
        public void AMappedBuildThatCannotBeOpenedIsRefused()
        {
            var verdict = PrincipiaConformanceGate.Check(new[] { Fma }, _ => null);

            Assert.Equal(PrincipiaConformance.Refused, verdict.State);
            Assert.Equal(Fma, verdict.ActivePath);
        }

        [Fact]
        public void AnOpenThatThrowsIsRefusedRatherThanEscaping()
        {
            // This runs inside the game. A permission error on a player's machine must
            // become a verdict, not an exception through the addon.
            var verdict = PrincipiaConformanceGate.Check(
                new[] { Fma }, _ => throw new UnauthorizedAccessException("denied"));

            Assert.Equal(PrincipiaConformance.Refused, verdict.State);
            Assert.Contains("denied", verdict.Reason!);
        }

        [Fact]
        public void TheDefaultVerdictWithholdsRatherThanPermits()
        {
            // `default` is what a caller gets from an uninitialised field or a struct
            // that never ran. It must not read as permission.
            var untouched = default(PrincipiaConformanceVerdict);

            Assert.Equal(PrincipiaConformance.NotEstablished, untouched.State);
            Assert.False(untouched.MayProceed);
        }
    }
}
