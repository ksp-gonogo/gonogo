using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    public class NativeExportReaderTests
    {
        private static readonly string[] Interface =
        {
            "principia__AdvanceTime",
            "principia__FlightPlanInsert",
            "principia__VesselVelocity",
        };

        private static NativeExports Read(byte[] file) =>
            NativeExportReader.Read(new MemoryStream(file));

        [Fact]
        public void ReadsTheExportsOutOfAnElf()
        {
            var exports = Read(NativeBinaryFixtures.Elf(Interface));

            Assert.True(exports.Found, exports.Reason);
            Assert.Equal(NativeBinaryFormat.Elf, exports.Format);
            Assert.Equal(Interface.OrderBy(n => n), exports.Names.OrderBy(n => n));
        }

        [Fact]
        public void ReadsTheExportsOutOfAPe()
        {
            // The fixture's export directory sits at address 0x1000 and file offset
            // 0x400, so this also fails if the reader takes an address for an
            // offset, which every PE table it walks would break on.
            var exports = Read(NativeBinaryFixtures.Pe(Interface));

            Assert.True(exports.Found, exports.Reason);
            Assert.Equal(NativeBinaryFormat.Pe, exports.Format);
            Assert.Equal(Interface.OrderBy(n => n), exports.Names.OrderBy(n => n));
        }

        [Fact]
        public void ReadsAPesNamedExportsAndNotOneEntryFurther()
        {
            // A PE exports more functions than it names, so its directory carries
            // two counts and only one of them bounds the name table. The fixture
            // makes them differ and plants a name in the gap, because with the two
            // equal, as they are in Principia's own build, reading the wrong one is
            // invisible.
            var exports = Read(NativeBinaryFixtures.Pe(Interface));

            foreach (var trap in NativeBinaryFixtures.TrapExports)
            {
                Assert.False(exports.Contains(trap), trap + " was read past the end of the names");
            }
        }

        [Fact]
        public void ReadsTheExportsOutOfAMachO()
        {
            var exports = Read(NativeBinaryFixtures.MachO(Interface));

            Assert.True(exports.Found, exports.Reason);
            Assert.Equal(NativeBinaryFormat.MachO, exports.Format);
            Assert.Equal(Interface.OrderBy(n => n), exports.Names.OrderBy(n => n));
        }

        [Fact]
        public void MachOsLeadingUnderscoreIsNotPartOfTheName()
        {
            // MEASURED on the shipped macOS build, where the export is stored as
            // `_principia__FlightPlanInsert`. A reader that keeps the underscore
            // finds none of the names anyone asks for, and then reports zero
            // matches, which is exactly what a module exporting nothing reports and
            // exactly what a broken parser reports. The bytes here carry the
            // underscore for that reason.
            var exports = Read(NativeBinaryFixtures.MachO(Interface));

            Assert.True(exports.Contains("principia__FlightPlanInsert"));
            Assert.False(exports.Contains("_principia__FlightPlanInsert"));
        }

        [Fact]
        public void OneInterfaceReadsIdenticallyOutOfAllThreeFormats()
        {
            // The property the gate depends on: a name means the same thing whatever
            // the player is running, so one intended list can be checked against any
            // build. Principia's own exports are identical across its six, measured.
            var elf = Read(NativeBinaryFixtures.Elf(Interface));
            var pe = Read(NativeBinaryFixtures.Pe(Interface));
            var mach = Read(NativeBinaryFixtures.MachO(Interface));

            Assert.Equal(elf.Names.OrderBy(n => n), pe.Names.OrderBy(n => n));
            Assert.Equal(elf.Names.OrderBy(n => n), mach.Names.OrderBy(n => n));
        }

        [Fact]
        public void TheFormatComesFromTheBytesAndNotAFileName()
        {
            // Principia's macOS build is a Mach-O called `principia.so`. Nothing
            // here is ever given a name, which is the point: an extension-led guess
            // reads that build as an ELF and finds nothing.
            Assert.Equal(
                NativeBinaryFormat.MachO,
                Read(NativeBinaryFixtures.MachO(Interface)).Format);
            Assert.Equal(NativeBinaryFormat.Elf, Read(NativeBinaryFixtures.Elf(Interface)).Format);
            Assert.Equal(NativeBinaryFormat.Pe, Read(NativeBinaryFixtures.Pe(Interface)).Format);
        }

        [Fact]
        public void AnElfImportIsNotAnExport()
        {
            var exports = Read(NativeBinaryFixtures.Elf(
                new[] { "principia__AdvanceTime" },
                imported: new[] { "memcpy", "principia__NotHere" }));

            Assert.True(exports.Contains("principia__AdvanceTime"));
            Assert.False(exports.Contains("principia__NotHere"));
            Assert.False(exports.Contains("memcpy"));
        }

        [Fact]
        public void AnElfLocalSymbolIsNotAnExport()
        {
            var exports = Read(NativeBinaryFixtures.Elf(
                new[] { "principia__AdvanceTime" },
                local: new[] { "principia__Internal" }));

            Assert.False(exports.Contains("principia__Internal"));
        }

        [Fact]
        public void AMachOImportIsNotAnExport()
        {
            var exports = Read(NativeBinaryFixtures.MachO(
                new[] { "principia__AdvanceTime" },
                imported: new[] { "principia__NotHere" }));

            Assert.True(exports.Contains("principia__AdvanceTime"));
            Assert.False(exports.Contains("principia__NotHere"));
        }

        [Fact]
        public void AMachOLocalSymbolIsNotAnExport()
        {
            var exports = Read(NativeBinaryFixtures.MachO(
                new[] { "principia__AdvanceTime" },
                local: new[] { "principia__Internal" }));

            Assert.False(exports.Contains("principia__Internal"));
        }

        [Fact]
        public void AMachOsDebugEntriesAreNotExports()
        {
            // The shipped macOS build's LC_SYMTAB holds 193,734 entries and most of
            // them are debug records sharing the table with the real symbols. The
            // fixture's record spells out an external definition in its low bits, so
            // it is excluded only by noticing the N_STAB flag first: see the comment
            // on the fixture for why a realistic stab type cannot measure that rule.
            var exports = Read(NativeBinaryFixtures.MachO(
                new[] { "principia__AdvanceTime" },
                debug: new[] { "principia__DebugOnly" }));

            Assert.False(exports.Contains("principia__DebugOnly"));
            Assert.True(exports.Contains("principia__AdvanceTime"));
        }

        [Fact]
        public void AnElfSymbolHiddenFromTheDynamicLinkerIsNotAnExport()
        {
            var exports = Read(NativeBinaryFixtures.Elf(
                new[] { "principia__AdvanceTime" },
                hidden: new[] { "principia__Internal" }));

            Assert.False(exports.Contains("principia__Internal"));
        }

        [Theory]
        [InlineData("elf")]
        [InlineData("pe")]
        [InlineData("macho")]
        public void ReadsEveryNameWhenTheTablesRunPastOneRead(string format)
        {
            // Every loop that reads in windows is exercised here and nowhere else:
            // symbol tables are read 4,096 entries at a time, and string tables
            // through a 256 KB window. 30,000 names of one length fill more than one
            // of each, and the window's end lands mid-name, which is the case that
            // needs a refill from the name's own first byte. The shipped builds are
            // this size and larger, so anything dropped here is dropped there.
            // The exact count is the assertion because a dropped name is otherwise
            // invisible: the ones around it still read.
            var names = new List<string>();
            for (var i = 0; i < 30_000; i++)
            {
                names.Add("principia__Export" + i.ToString("D6"));
            }

            var file = format switch
            {
                "elf" => NativeBinaryFixtures.Elf(names),
                "pe" => NativeBinaryFixtures.Pe(names),
                _ => NativeBinaryFixtures.MachO(names),
            };
            var exports = Read(file);

            Assert.True(exports.Found, exports.Reason);
            Assert.Equal(30_000, exports.Count);
            Assert.True(exports.Contains("principia__Export029999"));
        }

        [Fact]
        public void FindsTheStringTableWhereverDynsymSaysItIs()
        {
            // Read together with `ReadsTheExportsOutOfAnElf`, which places it at the
            // other end: no fixed section index satisfies both, so the sh_link has
            // to be followed. The wrong index in these fixtures lands on a decoy
            // over the symbol bytes, which yields names rather than nothing, so the
            // failure shows up as garbage rather than as an empty read.
            var exports = Read(NativeBinaryFixtures.Elf(Interface, stringTableLast: false));

            Assert.True(exports.Found, exports.Reason);
            Assert.Equal(Interface.OrderBy(n => n), exports.Names.OrderBy(n => n));
        }

        [Fact]
        public void ReadsAnElfWhoseSectionCountLivesInItsFirstSection()
        {
            var exports = Read(NativeBinaryFixtures.Elf(Interface, countInFirstSection: true));

            Assert.True(exports.Found, exports.Reason);
            Assert.Equal(Interface.Length, exports.Count);
        }

        [Fact]
        public void AModuleThatExportsNothingIsARefusalRatherThanAnEmptySuccess()
        {
            // Zero exports and a parser that read the wrong bytes produce the same
            // empty set. Reporting it as a success would let a caller that counts
            // matches conclude a build is fine because it found none of anything.
            var exports = Read(NativeBinaryFixtures.Elf(
                new string[0], imported: new[] { "memcpy" }));

            Assert.False(exports.Found);
            Assert.Equal(NativeBinaryFormat.Elf, exports.Format);
            Assert.NotNull(exports.Reason);
        }

        [Fact]
        public void SaysSoWhenAnElfHasNoDynamicSymbolTable()
        {
            var exports = Read(NativeBinaryFixtures.StrippedElf());

            Assert.False(exports.Found);
            Assert.Contains(".dynsym", exports.Reason!, StringComparison.Ordinal);
        }

        [Fact]
        public void SaysSoWhenAMachOHasNoSymbolTable()
        {
            var exports = Read(NativeBinaryFixtures.MachO(Interface, withoutSymbolTable: true));

            Assert.False(exports.Found);
            Assert.Contains("LC_SYMTAB", exports.Reason!, StringComparison.Ordinal);
        }

        [Fact]
        public void SaysSoWhenAPeExportsOnlyByOrdinal()
        {
            var exports = Read(NativeBinaryFixtures.Pe(Interface, namesByOrdinalOnly: true));

            Assert.False(exports.Found);
            Assert.Contains("ordinal", exports.Reason!, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public void RefusesTheShapesPrincipiaDoesNotShipByName()
        {
            // Each of these is a real thing a file can be, and each refusal says
            // which, so a player reporting one is telling us something.
            var bigEndian = Read(NativeBinaryFixtures.Elf(Interface, byteOrder: 2));
            Assert.False(bigEndian.Found);
            Assert.Contains("little-endian", bigEndian.Reason!, StringComparison.Ordinal);

            var elf32 = Read(NativeBinaryFixtures.Elf(Interface, elfClass: 1));
            Assert.False(elf32.Found);
            Assert.Contains("64-bit", elf32.Reason!, StringComparison.Ordinal);

            var mach32 = Read(NativeBinaryFixtures.MachO(Interface, magic: 0xFEEDFACE));
            Assert.False(mach32.Found);
            Assert.Equal(NativeBinaryFormat.MachO, mach32.Format);
            Assert.Contains("32-bit", mach32.Reason!, StringComparison.Ordinal);

            var universal = Read(NativeBinaryFixtures.MachO(Interface, magic: 0xCAFEBABE));
            Assert.False(universal.Found);
            Assert.Contains("universal", universal.Reason!, StringComparison.Ordinal);
        }

        [Fact]
        public void RefusesAFileThatIsNoNativeModuleAtAll()
        {
            var exports = Read(new byte[] { 0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0 });

            Assert.False(exports.Found);
            Assert.Equal(NativeBinaryFormat.Unknown, exports.Format);
        }

        [Fact]
        public void RefusesADosExecutableThatIsNotAWindowsModule()
        {
            var dos = new byte[128];
            dos[0] = (byte)'M';
            dos[1] = (byte)'Z';

            var exports = Read(dos);

            Assert.False(exports.Found);
            Assert.Equal(NativeBinaryFormat.Pe, exports.Format);
            Assert.NotNull(exports.Reason);
        }

        [Fact]
        public void RefusesAStreamItCannotSeekRatherThanReadingItWrong()
        {
            var exports = NativeExportReader.Read(
                new NonSeekableStream(NativeBinaryFixtures.Elf(Interface)));

            Assert.False(exports.Found);
            Assert.Contains("seek", exports.Reason!, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public void NoStreamIsRefused()
        {
            var exports = NativeExportReader.Read(null);

            Assert.False(exports.Found);
            Assert.NotNull(exports.Reason);
            Assert.Empty(exports.Names);
        }

        [Fact]
        public void ATruncatedElfIsRefusedRatherThanReadShort()
        {
            var whole = NativeBinaryFixtures.Elf(Interface);
            var cut = new byte[whole.Length - 64];
            Array.Copy(whole, cut, cut.Length);

            var exports = Read(cut);

            Assert.False(exports.Found);
            Assert.NotNull(exports.Reason);
        }

        private sealed class NonSeekableStream : MemoryStream
        {
            public NonSeekableStream(byte[] bytes) : base(bytes) { }

            public override bool CanSeek => false;
        }
    }
}
