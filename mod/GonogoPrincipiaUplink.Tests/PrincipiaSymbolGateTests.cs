using System;
using System.IO;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    public class PrincipiaSymbolGateTests
    {
        private static readonly string[] Shipped =
        {
            "principia__AdvanceTime",
            "principia__FlightPlanInsert",
            "principia__VesselVelocity",
        };

        [Fact]
        public void PassesWhenTheBuildExportsEverythingWeMeanToCall()
        {
            var check = PrincipiaSymbolGate.Check(
                new MemoryStream(NativeBinaryFixtures.Elf(Shipped)),
                new[] { "principia__AdvanceTime", "principia__VesselVelocity" });

            Assert.True(check.Complete, check.Reason);
            Assert.Empty(check.Missing);
            Assert.Null(check.Reason);
            Assert.Equal(NativeBinaryFormat.Elf, check.Format);
            Assert.Equal(3, check.ExportCount);
        }

        [Fact]
        public void NamesTheFunctionsTheBuildDoesNotHave()
        {
            // Naming them is the whole value over finding out at call time:
            // Principia's native surface aborts the process rather than returning,
            // so the first bad call is the last thing the player's game does.
            var check = PrincipiaSymbolGate.Check(
                new MemoryStream(NativeBinaryFixtures.Elf(Shipped)),
                new[] { "principia__AdvanceTime", "principia__FlightPlanRebase" });

            Assert.False(check.Complete);
            Assert.Equal(new[] { "principia__FlightPlanRebase" }, check.Missing);
            Assert.Null(check.Reason);
        }

        [Fact]
        public void ABuildItCouldNotReadIsNotAPass()
        {
            var check = PrincipiaSymbolGate.Check(
                new MemoryStream(new byte[] { 0x50, 0x4B, 0x03, 0x04 }), Shipped);

            Assert.False(check.Complete);
            Assert.NotNull(check.Reason);
            // Nothing was compared, so nothing may be reported as absent. A build
            // that could not be read and a build missing every function are
            // different findings and must not arrive looking the same.
            Assert.Empty(check.Missing);
        }

        [Fact]
        public void AnEmptyListOfIntendedFunctionsIsNotAPass()
        {
            // The failure this closes: a caller builds the list from something that
            // comes back empty, and a gate that answers "all zero of them present"
            // certifies a build nobody looked at.
            var check = PrincipiaSymbolGate.Check(
                new MemoryStream(NativeBinaryFixtures.Elf(Shipped)), new string[0]);

            Assert.False(check.Complete);
            Assert.NotNull(check.Reason);
        }

        [Fact]
        public void NoListOfIntendedFunctionsIsNotAPass()
        {
            var check = PrincipiaSymbolGate.Check(
                new MemoryStream(NativeBinaryFixtures.Elf(Shipped)), null);

            Assert.False(check.Complete);
            Assert.NotNull(check.Reason);
        }

        [Fact]
        public void BlankNamesAreNotFunctionsAndDoNotCountAsAnAsk()
        {
            var check = PrincipiaSymbolGate.Check(
                new MemoryStream(NativeBinaryFixtures.Elf(Shipped)), new[] { "", "   " });

            Assert.False(check.Complete);
            Assert.NotNull(check.Reason);
        }

        [Fact]
        public void ANameAskedForTwiceIsReportedOnce()
        {
            var check = PrincipiaSymbolGate.Check(
                new MemoryStream(NativeBinaryFixtures.Elf(Shipped)),
                new[] { "principia__Gone", "principia__Gone" });

            Assert.Equal(new[] { "principia__Gone" }, check.Missing);
        }

        [Fact]
        public void TheSameAnswerComesBackWhateverFormatTheBuildIs()
        {
            // A player on any of the three platforms is checked against one list,
            // which only works because the reader spells a name the same way for
            // all of them.
            var wanted = new[] { "principia__FlightPlanInsert" };

            Assert.True(
                PrincipiaSymbolGate.Check(
                    new MemoryStream(NativeBinaryFixtures.Elf(Shipped)), wanted).Complete);
            Assert.True(
                PrincipiaSymbolGate.Check(
                    new MemoryStream(NativeBinaryFixtures.Pe(Shipped)), wanted).Complete);
            Assert.True(
                PrincipiaSymbolGate.Check(
                    new MemoryStream(NativeBinaryFixtures.MachO(Shipped)), wanted).Complete);
        }

        [Fact]
        public void TheInterfaceIsTheExportsUnderPrincipiasOwnPrefix()
        {
            var exports = NativeExportReader.Read(
                new MemoryStream(NativeBinaryFixtures.Elf(
                    new[] { "principia__AdvanceTime", "memcpy", "principia__AAA", "_ZNSt3foo" })));

            Assert.Equal(
                new[] { "principia__AAA", "principia__AdvanceTime" },
                PrincipiaSymbolGate.InterfaceExports(exports));
        }

        [Fact]
        public void AnUnreadBuildHasNoInterfaceExportsRatherThanThrowing()
        {
            var exports = NativeExportReader.Read(null);

            Assert.Empty(PrincipiaSymbolGate.InterfaceExports(exports));
        }
    }
}
